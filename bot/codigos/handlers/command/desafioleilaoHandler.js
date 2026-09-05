// ARQUIVO: bot/codigos/handlers/command/desafioleilaoHandler.js
// Gerencia desafios enviados durante os leilões (#desafio e #pronto)
// ✨ VERSÃO MELHORADA - #pronto sem ID obrigatório
// ✨ AJUSTE: #pronto @admin agora notifica o admin marcado e o registro
//    enviado pra sala de leilões inclui o #ID do desafio pra rastreio.
// 🔧 FIX: removida comparação frágil que bloqueava o envio do registro
//    quando GRUPO_LEILOES_ID era configurado com o ID do grupo de admins.
//    Agora só checa se a variável de ambiente está definida.
// 🔧 FIX 2: encaminhamento de mídia pro grupo de registros agora também
//    funciona quando a comprovação veio por REPLY/QUOTE numa foto/vídeo
//    já mandada no grupo (antes só funcionava se a mídia vinha direto
//    como legenda do #pronto).
//
// 🔧 FIX 3: parou de usar "forward" pra reencaminhar a mídia de comprovação
//    pro grupo de admins. O forward reenviava a mensagem ORIGINAL, que ainda
//    tinha o texto "#pronto" na legenda/reply — isso fazia esse texto "ecoar"
//    de volta pro bot dentro do próprio grupo de admins, disparando o handler
//    de novo por engano (e mandando "você não tem desafio pendente" lá).
//    Agora a mídia é baixada e reenviada limpa, sem nenhuma legenda.
//
// ✨ AJUSTE 4 (prazo de 24h + aviso de desafio não cumprido):
//    - O prazo do desafio passou de 3 dias pra 24 horas (ver PRAZO_DESAFIO_HORAS).
//    - Foi adicionado um verificador (verificarDesafiosExpirados) que roda
//      periodicamente, encontra desafios ainda "pendente" cujo prazo de 24h
//      já estourou, manda um aviso na SALA DE ADMINS marcando o casal e o
//      admin que criou, e marca o desafio como "expirado" no banco (pra não
//      avisar de novo).
//    - Pra isso funcionar de verdade, é preciso:
//        1) Chamar iniciarVerificadorDesafiosExpirados(sock) uma vez, no
//           arquivo principal do bot, depois que o `sock` conectar (ver
//           exemplo de uso no comentário logo acima da função, mais abaixo).
//        2) Garantir que a coluna de status na tabela damas_desafios aceite
//           o valor 'expirado' (se for um ENUM/CHECK constraint no banco,
//           rodar uma migration liberando esse valor).
//
// ██████████████████████████████████████████████████████████████████
// ██                                                                ██
// ██   MAPA DOS DOIS GRUPOS USADOS NESSE ARQUIVO:                  ██
// ██                                                                ██
// ██   1) GRUPO ONDE O LEILÃO ACONTECE (comandos #desafio/#pronto) ██
// ██      ID: 120363413774574277@g.us                              ██
// ██      -> NÃO fica hardcoded aqui no código. Esse ID vem sempre ██
// ██         de "from = message.key.remoteJid", ou seja, é o       ██
// ██         próprio grupo de onde a mensagem #desafio/#pronto foi ██
// ██         mandada. O bot responde ali mesmo automaticamente.    ██
// ██                                                                ██
// ██   2) GRUPO DOS ADMINS (recebe só o registro/aviso de desafio  ██
// ██      concluído, não roda comandos)                            ██
// ██      ID: 120363429213248144@g.us                              ██
// ██      -> Esse ID FICA CONFIGURADO NO .env, na variável         ██
// ██         GRUPO_LEILOES_ID. Procure mais abaixo neste arquivo   ██
// ██         por "const GRUPO_LEILOES = process.env..." para ver   ██
// ██         onde ele é lido e usado.                               ██
// ██                                                                ██
// ██████████████████████████████████████████████████████████████████

import pool from '../../../../db.js';
// ⚠️ AJUSTE: troque '@whiskeysockets/baileys' pelo pacote baileys que o
//    projeto já usa (ex: '@adiwajshing/baileys'), se for diferente —
//    dá pra conferir olhando o import do "sock" lá no arquivo principal do bot.
import { downloadMediaMessage } from '@whiskeysockets/baileys';
// 🖼️ Mesmo pacote usado no boasvindas.js pra gerar thumbnail da imagem —
//    sem o "jpegThumbnail", a imagem às vezes não aparece direito (fica
//    só carregando) em algumas sessões, principalmente rodando no Termux.
import { Jimp } from "jimp";

// ⏰ Prazo que o casal tem pra cumprir o desafio antes de virar "expirado"
//    e disparar o aviso na sala de admins. Usado no TEXTO da mensagem do
//    #desafio (ex: "Vocês têm 24 horas"). Deixa sempre em 24 aqui —
//    quem controla o tempo real da checagem é o INTERRUPTOR 1 logo abaixo.
const PRAZO_DESAFIO_HORAS = 24;

// ██████████████████████████████████████████████████████████████████
// ██  🔧 INTERRUPTOR 1 de 2 — TEMPO REAL QUE O VERIFICADOR CONSIDERA ██
// ██  "EXPIRADO" (o texto do INTERVAL usado na query do banco)      ██
// ██                                                                 ██
// ██  Pra TESTAR rápido, comente a linha de PRODUÇÃO (coloca // na  ██
// ██  frente) e descomente a linha de TESTE (tira o // da frente).  ██
// ██                                                                 ██
// ██  🚨 DEPOIS DO TESTE, VOLTA PRA PRODUÇÃO — senão todo desafio    ██
// ██     real vira "não cumprido" 1 minuto depois de criado.        ██
// ██████████████████████████████████████████████████████████████████
// const INTERVALO_EXPIRACAO_SQL = `${PRAZO_DESAFIO_HORAS} hours`;   // 👈 PRODUÇÃO (deixa assim no dia a dia)
const INTERVALO_EXPIRACAO_SQL = '1 minutes';                    // 👈 TESTE (1 minuto) — descomenta essa linha E comenta a de cima

function extractDigits(number) {
    if (!number) return null;
    return number.replace(/@.*$/, '').replace(/\D/g, '');
}

function getNumeroReal(message) {
    if (message.key.participantAlt) return message.key.participantAlt;
    if (message.key.participant) return message.key.participant;
    return message.key.remoteJid;
}

async function isAdmin(sock, groupId, userId) {
    try {
        const meta = await sock.groupMetadata(groupId);
        const participante = meta.participants.find(p => {
            const idDigits = extractDigits(p.id);
            const phoneDigits = extractDigits(p.phoneNumber);
            return idDigits === userId || phoneDigits === userId;
        });
        return participante?.admin === 'admin' || participante?.admin === 'superadmin';
    } catch (err) {
        console.error('[desafioleilaoHandler] Erro ao checar admin:', err.message);
        return false;
    }
}

// ✂️ Extrai só o texto "livre" que a pessoa escreveu no #pronto — tira o
//    comando, um possível ID numérico e as menções (@admin etc), sobrando
//    só a frase que ela realmente digitou (ex: "Fizemos o que foi combinado").
function extrairTextoExtra(content) {
    return content
        .replace(/#pronto\b\s*/i, '')
        .replace(/^(?:id)?\d+\s*/i, '')
        .replace(/@[\w.]+/g, '')
        .trim();
}

// 🖼️ Mesma função do boasvindas.js — gera uma miniatura (thumbnail) da
//    imagem com o Jimp. Sem isso, o WhatsApp/Baileys às vezes manda a
//    imagem sem preview, e ela não aparece em algumas sessões (comum no
//    Termux, por causa dos recursos mais limitados do aparelho).
async function gerarThumbnail(buffer, size = 256) {
    try {
        const image = await Jimp.read(buffer);
        await image.resize({ w: size, h: size });
        return await image.getBuffer("image/png");
    } catch (err) {
        console.warn('[desafioleilaoHandler] Não foi possível gerar thumbnail:', err.message);
        return null;
    }
}

// 📥➡️📤 Baixa a mídia de uma mensagem (direta ou reconstruída a partir de um
//    quote) e reenvia pro grupo de destino já com a LEGENDA DE ATRIBUIÇÃO
//    (quem mandou + o que escreveu) embutida na própria mídia, em vez de
//    mandar como mensagem separada — assim tudo chega junto, de uma vez.
//    "opcoes.caption" e "opcoes.mentions" já vêm prontos de quem chamou.
async function reenviarMidiaLimpa(sock, grupoDestino, mensagemComMidia, opcoes = {}) {
    const { caption = '', mentions = [] } = opcoes;
    const conteudo = mensagemComMidia.message;
    if (!conteudo) return false;

    const tipo = ['imageMessage', 'videoMessage', 'documentMessage', 'audioMessage', 'stickerMessage']
        .find(t => conteudo[t]);
    if (!tipo) return false;

    // 🧹 Apaga a legenda ORIGINAL do objeto antes de baixar a mídia (pode ter
    //    "#pronto ..." dentro) — a legenda final é sempre a "caption" que
    //    passamos por parâmetro, nunca a original.
    const mensagemSemComando = {
        ...mensagemComMidia,
        message: {
            ...conteudo,
            [tipo]: {
                ...conteudo[tipo],
                caption: ''
            }
        }
    };

    const buffer = await downloadMediaMessage(
        mensagemSemComando,
        'buffer',
        {},
        { reuploadRequest: sock.updateMediaMessage }
    );

    // Só imagem, vídeo e documento suportam "caption" no WhatsApp.
    const suportaCaption = tipo === 'imageMessage' || tipo === 'videoMessage' || tipo === 'documentMessage';

    const payload = {};
    if (tipo === 'imageMessage') {
        payload.image = buffer;

        // 🖼️ Mesmo esquema do boasvindas.js: gera o thumbnail ANTES de
        // mandar e injeta como "jpegThumbnail". Se não conseguir gerar,
        // manda mesmo assim sem o thumbnail (não trava o fluxo).
        const thumb = await gerarThumbnail(buffer, 256);
        if (thumb) payload.jpegThumbnail = thumb;
    } else if (tipo === 'videoMessage') {
        payload.video = buffer;
    } else if (tipo === 'documentMessage') {
        payload.document = buffer;
        payload.mimetype = conteudo.documentMessage.mimetype;
        payload.fileName = conteudo.documentMessage.fileName || 'comprovacao';
    } else if (tipo === 'audioMessage') {
        payload.audio = buffer;
        payload.mimetype = conteudo.audioMessage.mimetype || 'audio/ogg; codecs=opus';
        payload.ptt = !!conteudo.audioMessage.ptt;
    } else if (tipo === 'stickerMessage') {
        payload.sticker = buffer;
    }

    if (suportaCaption && caption) {
        payload.caption = caption;
        if (mentions.length) payload.mentions = mentions;
    }

    try {
        await sock.sendMessage(grupoDestino, payload);
    } catch (err) {
        // 🔁 Se o envio da mídia falhar por qualquer motivo, retorna false —
        // quem chamou essa função já manda a legenda como texto puro nesse
        // caso, pra não perder a informação de quem mandou a comprovação.
        console.warn('[desafioleilaoHandler] Erro ao enviar mídia:', err.message);
        return false;
    }

    // Áudio e figurinha não têm campo de legenda no WhatsApp — nesse caso,
    // manda a atribuição como uma mensagem de texto logo em seguida, senão
    // ela se perderia.
    if (!suportaCaption && caption) {
        await sock.sendMessage(grupoDestino, { text: caption, mentions });
    }

    return true;
}

// 📎 Verifica se a mensagem tem alguma COMPROVAÇÃO anexada — pode ser:
//    - foto, vídeo, documento ou áudio (direto ou como resposta/reply)
//    - OU um texto descrevendo o que foi feito (ex: "#pronto tiramos a selfie
//      e mandamos no privado do admin")
//    O que NÃO passa é vir vazio: só "#pronto" ou só "#pronto @admin", sem
//    nenhum texto extra nem mídia junto.
function temComprovacao(message, content) {
    const msg = message.message;
    if (!msg) return false;

    // Mídia mandada DIRETO junto com o #pronto (como legenda da foto/vídeo, por ex.)
    const temMidiaDireta = !!(
        msg.imageMessage ||
        msg.videoMessage ||
        msg.documentMessage ||
        msg.audioMessage ||
        msg.stickerMessage
    );
    if (temMidiaDireta) return true;

    // Mídia anexada via RESPOSTA (reply) a uma mensagem de mídia já existente
    const quoted = msg.extendedTextMessage?.contextInfo?.quotedMessage;
    if (quoted) {
        const temMidiaNoQuote = !!(
            quoted.imageMessage ||
            quoted.videoMessage ||
            quoted.documentMessage ||
            quoted.audioMessage ||
            quoted.stickerMessage
        );
        if (temMidiaNoQuote) return true;
    }

    // Texto extra além do comando/ID/menção (ex: descrição do que fizeram)
    const textoRestante = extrairTextoExtra(content);
    if (textoRestante.length >= 3) return true;

    return false;
}

async function resolverNumeroRealDoMencionado(sock, groupId, mentionedJid) {
    if (mentionedJid.endsWith('@s.whatsapp.net')) {
        return extractDigits(mentionedJid);
    }

    try {
        const meta = await sock.groupMetadata(groupId);
        const participante = meta.participants.find(p => p.id === mentionedJid);
        const numeroReal = participante?.jid || participante?.phoneNumber || participante?.pn || participante?.participantAlt;
        if (numeroReal) return extractDigits(numeroReal);
    } catch (err) {
        console.error('[resolverNumeroRealDoMencionado] Erro:', err.message);
    }

    return extractDigits(mentionedJid);
}

// ============================================================
// 🎯 COMANDO #desafio — Admin envia desafio pro casal
// ============================================================
async function handleDesafioCommand(sock, message, content) {
    const from = message.key.remoteJid;
    if (!from.endsWith('@g.us')) return false;

    // Detecta "#desafio" em qualquer posição da mensagem (não só no início)
    const match = content.match(/#desafio\b\s*/i);
    if (!match) return false;

    try {
        const remetenteCompleto = getNumeroReal(message);
        const adminId = extractDigits(remetenteCompleto);

        const ehAdmin = await isAdmin(sock, from, adminId);
        if (!ehAdmin) {
            await sock.sendMessage(from, {
                text: '🚫 Só administradores podem enviar desafios.'
            }, { quoted: message });
            return true;
        }

        const mentions = message.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
        if (mentions.length < 2) {
            await sock.sendMessage(from, {
                text: '⚠️ Marque 2 pessoas pra receber o desafio.\n\n*Exemplo:* `#desafio @maria @joão tirar uma selfie juntos 📸`'
            }, { quoted: message });
            return true;
        }

        const pessoa1 = await resolverNumeroRealDoMencionado(sock, from, mentions[0]);
        const pessoa2 = await resolverNumeroRealDoMencionado(sock, from, mentions[1]);

        if (pessoa1 === pessoa2) {
            await sock.sendMessage(from, {
                text: '⚠️ As duas pessoas do casal não podem ser a mesma!'
            }, { quoted: message });
            return true;
        }

        let descricao = content.replace(/#desafio\b\s*/i, '');
        mentions.forEach(mention => {
            descricao = descricao.replace(new RegExp(`@[\\w.]+`), '').trim();
        });

        descricao = descricao.trim();

        if (!descricao || descricao.length < 3) {
            await sock.sendMessage(from, {
                text: '⚠️ Descreva o desafio.\n\n*Exemplo:* `#desafio @maria @joão tirar uma selfie juntos 📸`'
            }, { quoted: message });
            return true;
        }

        // Verifica se já existe desafio ativo pra esse casal
        const ativo = await pool.query(
            `SELECT id FROM damas_desafios 
             WHERE grupo_id = $1 
             AND status = 'pendente'
             AND (
                (casal_id1 = $2 AND casal_id2 = $3) OR
                (casal_id1 = $3 AND casal_id2 = $2)
             )`,
            [from, pessoa1, pessoa2]
        );

        if (ativo.rowCount > 0) {
            await sock.sendMessage(from, {
                text: `⚠️ Esse casal já tem um desafio pendente! ⏳\n\nConcluam o atual antes de receber um novo.`
            }, { 
                mentions: [`${pessoa1}@s.whatsapp.net`, `${pessoa2}@s.whatsapp.net`],
                quoted: message 
            });
            return true;
        }

        // Insere o desafio no banco
        const insertResult = await pool.query(
            `INSERT INTO damas_desafios 
             (grupo_id, casal_id1, casal_id2, descricao, admin_id, status)
             VALUES ($1, $2, $3, $4, $5, 'pendente')
             RETURNING id`,
            [from, pessoa1, pessoa2, descricao, adminId]
        );

        const desafioId = insertResult.rows[0].id;
        const agora = new Date().toLocaleString('pt-BR', { 
            dateStyle: 'short', 
            timeStyle: 'short' 
        });

        // 🎯 Envia o desafio pros dois no grupo
        await sock.sendMessage(from, {
            text: `🎯 *DESAFIO RECEBIDO!* 🎯\n\n` +
                  `👥 Casal: @${pessoa1} & @${pessoa2}\n\n` +
                  `💪 *Tarefa:* ${descricao}\n\n` +
                  `⏰ *Horário:* ${agora}\n` +
                  `👮 *Enviado por:* @${adminId}\n\n` +
                  `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                  `📸 Vocês têm *${PRAZO_DESAFIO_HORAS} horas* pra completar!\n\n` +
                  `✅ Quando acabar, um de vocês manda:\n` +
                  `*#pronto* (marcando um admin, se quiser notificar direto)\n\n` +
                  `🔥 Vamos lá! 💪`,
            mentions: [`${pessoa1}@s.whatsapp.net`, `${pessoa2}@s.whatsapp.net`, `${adminId}@s.whatsapp.net`]
        });

        console.log(`✅ [desafioleilaoHandler] Desafio #${desafioId} criado`);
        console.log(`   Casal: ${pessoa1} & ${pessoa2}`);
        console.log(`   Descrição: ${descricao}`);
        console.log(`   Admin: ${adminId}`);
        return true;

    } catch (err) {
        console.error('[desafioleilaoHandler] Erro ao enviar desafio:', err.message);
        await sock.sendMessage(from, {
            text: '❌ Erro ao enviar o desafio. Tente novamente.'
        }, { quoted: message });
        return true;
    }
}

// ============================================================
// ✅ COMANDO #pronto — Casal confirma que completou desafio
//    Aceita: #pronto | #pronto id123 | #pronto @admin
//    A menção (@admin) é só pra NOTIFICAR/marcar um admin — quem
//    identifica o desafio continua sendo quem ENVIOU a mensagem
//    (tem que ser um dos dois do casal).
// ============================================================
async function handleProntoCommand(sock, message, content) {
    const from = message.key.remoteJid;
    if (!from.endsWith('@g.us')) return false;

    // Detecta "#pronto" em qualquer posição da mensagem (não só no início).
    // Aceita: #pronto, #pronto id123, #pronto 123 (a @menção é tratada à parte)
    const match = content.match(/#pronto\b(?:\s+(?:id)?(\d+))?/i);
    if (!match) return false;

    try {
        const numeroCompleto = getNumeroReal(message);
        const userId = extractDigits(numeroCompleto);

        let desafioId = match[1] ? parseInt(match[1], 10) : null;

        // 👮 Se a pessoa marcou alguém no #pronto, é o admin sendo notificado
        // (não é usado pra identificar o desafio, só pra marcar/avisar na sala de leilões)
        const mentionedRaw = message.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
        let adminMencionadoId = null;
        if (mentionedRaw.length > 0) {
            adminMencionadoId = await resolverNumeroRealDoMencionado(sock, from, mentionedRaw[0]);
        }

        // 🔍 Se não passou ID, busca o desafio PENDENTE do casal (baseado em quem ENVIOU)
        if (!desafioId) {
            const desafioResult = await pool.query(
                `SELECT id FROM damas_desafios 
                 WHERE grupo_id = $1 
                 AND status = 'pendente'
                 AND (casal_id1 = $2 OR casal_id2 = $2)
                 ORDER BY criado_em DESC
                 LIMIT 1`,
                [from, userId]
            );

            if (desafioResult.rowCount === 0) {
                await sock.sendMessage(from, {
                    text: `⚠️ Você não tem nenhum desafio pendente no momento.`
                }, { quoted: message });
                return true;
            }

            desafioId = desafioResult.rows[0].id;
        }

        // 📋 Busca o desafio completo
        const desafioResult = await pool.query(
            `SELECT * FROM damas_desafios WHERE id = $1 AND grupo_id = $2`,
            [desafioId, from]
        );

        if (desafioResult.rowCount === 0) {
            await sock.sendMessage(from, {
                text: `⚠️ Desafio #${desafioId} não encontrado.`
            }, { quoted: message });
            return true;
        }

        const desafio = desafioResult.rows[0];

        // ✅ Valida se quem está respondendo é um dos dois do casal
        if (userId !== desafio.casal_id1 && userId !== desafio.casal_id2) {
            await sock.sendMessage(from, {
                text: `🚫 *Acesso negado!*\n\n` +
                      `Só @${desafio.casal_id1} ou @${desafio.casal_id2} podem completar esse desafio.`,
                mentions: [`${desafio.casal_id1}@s.whatsapp.net`, `${desafio.casal_id2}@s.whatsapp.net`]
            }, { quoted: message });
            return true;
        }

        // 📎 Exige alguma comprovação (foto, vídeo ou texto) — não deixa
        //    passar um "#pronto" vazio, sem nada além da menção do admin.
        if (!temComprovacao(message, content)) {
            await sock.sendMessage(from, {
                text: `🚨 *OPA, CALMA AÍ!* 🚨\n\n` +
                      `📎 Seu *#pronto* chegou *sem nenhuma comprovação* — e isso a gente não aceita! 🙅\n\n` +
                      `Pra marcar o desafio como concluído, *precisa vir junto com uma prova* de que vocês realmente fizeram:\n\n` +
                      `📸 *Uma foto* (pode vir com texto explicando também)\n` +
                      `🎥 *Um vídeo* (pode vir com texto explicando também)\n` +
                      `✍️ *Ou só um texto* contando em detalhes como foi\n\n` +
                      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                      `✅ *Formas certas de mandar:*\n\n` +
                      `1️⃣ Manda a foto/vídeo com a legenda \`#pronto\`\n` +
                      `2️⃣ Responde (reply) numa foto/vídeo já mandada no grupo, escrevendo \`#pronto\`\n` +
                      `3️⃣ Escreve o \`#pronto\` junto com um texto explicando:\n` +
                      `   _"#pronto tiramos a selfie no shopping e já mandamos aqui no grupo!"_\n\n` +
                      `⚠️ *E não esquece:* marca *qualquer admin* junto, assim: \`#pronto @admin\`\n\n` +
                      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                      `Manda de novo com a comprovação e tá tudo certo! 🔥`
            }, { quoted: message });
            return true;
        }

        // 🔄 Se já foi concluído antes, avisa
        if (desafio.status === 'concluido') {
            const dataConclusao = new Date(desafio.concluido_em).toLocaleString('pt-BR');
            await sock.sendMessage(from, {
                text: `ℹ️ Esse desafio já foi concluído em ${dataConclusao}.`
            }, { quoted: message });
            return true;
        }

        // 🔧 Marca como concluído
        const updateResult = await pool.query(
            `UPDATE damas_desafios 
             SET status = 'concluido', concluido_em = NOW(), concluido_por = $1
             WHERE id = $2
             RETURNING *`,
            [userId, desafioId]
        );

        const desafioAtualizado = updateResult.rows[0];
        const dataEnvio = new Date(desafio.criado_em).toLocaleString('pt-BR', { 
            dateStyle: 'short', 
            timeStyle: 'short' 
        });
        const dataConclusao = new Date(desafioAtualizado.concluido_em).toLocaleString('pt-BR', {
            dateStyle: 'short',
            timeStyle: 'short'
        });

        // 🎉 Resposta no grupo (marcando os dois + admin notificado, se houver)
        const mentionsConclusao = [`${desafio.casal_id1}@s.whatsapp.net`, `${desafio.casal_id2}@s.whatsapp.net`];
        let linhaAdminMencionado = '';
        if (adminMencionadoId) {
            mentionsConclusao.push(`${adminMencionadoId}@s.whatsapp.net`);
            linhaAdminMencionado = `\n👮 *Admin notificado:* @${adminMencionadoId}`;
        }

        await sock.sendMessage(from, {
            text: `✅ *DESAFIO COMPLETADO!* 🎉\n\n` +
                  `👏 Parabéns @${desafio.casal_id1} e @${desafio.casal_id2}!\n\n` +
                  `🎯 *Desafio:* ${desafio.descricao}\n` +
                  `📅 *Concluído:* ${dataConclusao}` +
                  linhaAdminMencionado + `\n\n` +
                  `🔥 Vocês foram incríveis!`,
            mentions: mentionsConclusao
        });

        // ██████████████████████████████████████████████████████████████
        // ██  ID DO GRUPO QUE RECEBE OS REGISTROS (GRUPO DOS ADMINS)   ██
        // ██  Configurado no arquivo .env, variável GRUPO_LEILOES_ID   ██
        // ██  Valor que deve estar no .env: 120363429213248144@g.us    ██
        // ██  (NÃO é o grupo onde o leilão acontece — é o grupo priv-  ██
        // ██   ado dos admins que só recebe os avisos/registros)       ██
        // ██████████████████████████████████████████████████████████████
        const GRUPO_LEILOES = process.env.GRUPO_LEILOES_ID;

        if (GRUPO_LEILOES) {
            const mentionsRegistro = [
                `${desafio.casal_id1}@s.whatsapp.net`,
                `${desafio.casal_id2}@s.whatsapp.net`,
                `${desafio.admin_id}@s.whatsapp.net`
            ];
            let linhaAdminMencionadoRegistro = '';
            if (adminMencionadoId) {
                mentionsRegistro.push(`${adminMencionadoId}@s.whatsapp.net`);
                linhaAdminMencionadoRegistro = `\n🔔 *Notificado:* @${adminMencionadoId}`;
            }

            const registroTexto = 
                `📋 *DESAFIO CONCLUÍDO* ✅\n` +
                `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                `🆔 *ID:* #${desafioId}\n` +
                `👥 *Casal:* @${desafio.casal_id1} & @${desafio.casal_id2}\n` +
                `🎯 *Tarefa:* ${desafio.descricao}\n` +
                `👮 *Admin que criou:* @${desafio.admin_id}` +
                linhaAdminMencionadoRegistro + `\n` +
                `📅 *Enviado:* ${dataEnvio}\n` +
                `✅ *Concluído:* ${dataConclusao}\n` +
                `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

            try {
                // 📸 Se a comprovação veio como mídia DIRETA (foto/vídeo/áudio/
                // documento anexado no próprio #pronto), encaminha ela também
                // pro grupo de admins, além do resumo em texto logo abaixo.
                //
                // 🔧 FIX: se a comprovação veio por REPLY/QUOTE numa foto/vídeo
                // já mandada antes no grupo, a mídia direta do #pronto está
                // vazia — precisamos pegar a mídia de dentro do quotedMessage
                // e reconstruir uma "mensagem" mínima pra poder encaminhar.
                const temMidiaDireta = !!(
                    message.message?.imageMessage ||
                    message.message?.videoMessage ||
                    message.message?.documentMessage ||
                    message.message?.audioMessage
                );

                const contextInfo = message.message?.extendedTextMessage?.contextInfo;
                const quotedMsg = contextInfo?.quotedMessage;
                const temMidiaNoQuote = !!(
                    quotedMsg?.imageMessage ||
                    quotedMsg?.videoMessage ||
                    quotedMsg?.documentMessage ||
                    quotedMsg?.audioMessage
                );

                // 🏷️ Monta a legenda de atribuição (quem mandou + o que
                // escreveu) UMA vez só — ela vai embutida na própria mídia
                // (como "caption") em vez de virar uma mensagem separada.
                const textoDoCasal = extrairTextoExtra(content);
                const legendaAtribuicao = `📸 *Comprovação de:* @${desafio.casal_id1} e @${desafio.casal_id2}` +
                      (textoDoCasal.length >= 3 ? `\n💬 _"${textoDoCasal}"_` : '');
                const mentionsAtribuicao = [`${desafio.casal_id1}@s.whatsapp.net`, `${desafio.casal_id2}@s.whatsapp.net`];

                let midiaEnviada = false;
                if (temMidiaDireta) {
                    // Mídia veio direto como legenda do #pronto → baixa e reenvia com a atribuição
                    midiaEnviada = await reenviarMidiaLimpa(sock, GRUPO_LEILOES, message, {
                        caption: legendaAtribuicao,
                        mentions: mentionsAtribuicao
                    });
                } else if (temMidiaNoQuote) {
                    // Mídia veio via reply a uma mensagem anterior → reconstrói
                    // uma mensagem mínima em cima do quote pra conseguir baixar
                    const quotedFakeMessage = {
                        key: {
                            remoteJid: from,
                            id: contextInfo.stanzaId,
                            participant: contextInfo.participant,
                            fromMe: false
                        },
                        message: quotedMsg
                    };
                    midiaEnviada = await reenviarMidiaLimpa(sock, GRUPO_LEILOES, quotedFakeMessage, {
                        caption: legendaAtribuicao,
                        mentions: mentionsAtribuicao
                    });
                }

                // 📝 Se não tinha mídia nenhuma (comprovação só por texto), ou
                // se por algum motivo o reenvio da mídia falhou, manda a
                // atribuição como mensagem de texto normal — assim ela nunca
                // se perde.
                if (!midiaEnviada) {
                    await sock.sendMessage(GRUPO_LEILOES, {
                        text: legendaAtribuicao,
                        mentions: mentionsAtribuicao
                    });
                }

                await sock.sendMessage(GRUPO_LEILOES, {
                    text: registroTexto,
                    mentions: mentionsRegistro
                });
                console.log(`📋 [desafioleilaoHandler] Registro do desafio #${desafioId} enviado pro grupo de admins`);
                if (temMidiaDireta) console.log(`   Mídia encaminhada: direta (legenda do #pronto)`);
                if (temMidiaNoQuote) console.log(`   Mídia encaminhada: via reply/quote`);
            } catch (err) {
                console.warn('[desafioleilaoHandler] Erro ao enviar registro:', err.message);
            }
        } else {
            console.warn('[desafioleilaoHandler] GRUPO_LEILOES_ID não configurado no .env — registro não enviado.');
        }

        console.log(`✅ [desafioleilaoHandler] Desafio #${desafioId} concluído`);
        console.log(`   Casal: ${desafio.casal_id1} & ${desafio.casal_id2}`);
        console.log(`   Concluído por: ${userId}`);
        if (adminMencionadoId) console.log(`   Admin notificado: ${adminMencionadoId}`);
        return true;

    } catch (err) {
        console.error('[desafioleilaoHandler] Erro ao processar pronto:', err.message);
        await sock.sendMessage(from, {
            text: '❌ Erro ao processar a conclusão do desafio. Tente novamente.'
        }, { quoted: message });
        return true;
    }
}

// ============================================================
// ⏰ VERIFICADOR DE DESAFIOS EXPIRADOS (prazo de 24h estourado)
//    Roda periodicamente (ver iniciarVerificadorDesafiosExpirados),
//    busca todo desafio ainda "pendente" cujo prazo já passou, avisa
//    a SALA DE ADMINS marcando o casal + o admin que criou, e marca
//    o desafio como "expirado" no banco (pra não avisar de novo).
// ============================================================
async function verificarDesafiosExpirados(sock) {
    const GRUPO_LEILOES = process.env.GRUPO_LEILOES_ID;
    if (!GRUPO_LEILOES) {
        console.warn('[desafioleilaoHandler] GRUPO_LEILOES_ID não configurado — não é possível avisar desafios expirados.');
        return;
    }

    try {
        // 👆 Essa query usa o INTERRUPTOR 1 (INTERVALO_EXPIRACAO_SQL, lá em
        // cima do arquivo) pra decidir o que conta como "expirado".
        const expirados = await pool.query(
            `SELECT * FROM damas_desafios
             WHERE status = 'pendente'
             AND criado_em <= NOW() - INTERVAL '${INTERVALO_EXPIRACAO_SQL}'`
        );

        for (const desafio of expirados.rows) {
            try {
                await sock.sendMessage(GRUPO_LEILOES, {
                    text: `⏰ *DESAFIO NÃO CUMPRIDO!* ⚠️\n\n` +
                          `🆔 *ID:* #${desafio.id}\n` +
                          `👥 *Casal:* @${desafio.casal_id1} & @${desafio.casal_id2}\n` +
                          `🎯 *Tarefa:* ${desafio.descricao}\n` +
                          `👮 *Admin que criou:* @${desafio.admin_id}\n\n` +
                          `🚫 O prazo de *${PRAZO_DESAFIO_HORAS} horas* acabou e eles não concluíram o desafio.`,
                    mentions: [
                        `${desafio.casal_id1}@s.whatsapp.net`,
                        `${desafio.casal_id2}@s.whatsapp.net`,
                        `${desafio.admin_id}@s.whatsapp.net`
                    ]
                });

                // 🔧 Marca como "expirado" pra esse desafio parar de aparecer
                // nas buscas por "pendente" e não gerar aviso de novo.
                await pool.query(
                    `UPDATE damas_desafios SET status = 'expirado' WHERE id = $1`,
                    [desafio.id]
                );

                console.log(`⏰ [desafioleilaoHandler] Desafio #${desafio.id} expirado — admins avisados`);
            } catch (err) {
                console.warn(`[desafioleilaoHandler] Erro ao avisar expiração do desafio #${desafio.id}:`, err.message);
            }
        }
    } catch (err) {
        console.error('[desafioleilaoHandler] Erro ao verificar desafios expirados:', err.message);
    }
}

// 🚀 Chame essa função UMA VEZ no arquivo principal do bot, depois que o
//    `sock` conectar, pra ligar a checagem periódica de desafios expirados.
//    Exemplo de uso lá no arquivo principal:
//
//        import { iniciarVerificadorDesafiosExpirados } from './handlers/command/desafioleilaoHandler.js';
//        // ... depois que sock conectar:
//        iniciarVerificadorDesafiosExpirados(sock);
//
//    Por padrão checa a cada 30 minutos — dá pra mudar passando o segundo
//    argumento (em minutos), ex: iniciarVerificadorDesafiosExpirados(sock, 15).
export function iniciarVerificadorDesafiosExpirados(sock, intervaloMinutos = 30) {
    // Roda uma vez logo de cara (pra não esperar 30min pelo primeiro check)
    verificarDesafiosExpirados(sock);
    return setInterval(() => verificarDesafiosExpirados(sock), intervaloMinutos * 60 * 1000);
}

// ============================================================
// 📤 Export das duas funções
// ============================================================
export async function handleDesafioleilaoCommand(sock, message, content) {
    // Tenta #desafio primeiro
    if (await handleDesafioCommand(sock, message, content)) return true;
    
    // Se não foi #desafio, tenta #pronto
    if (await handleProntoCommand(sock, message, content)) return true;
    
    return false;
}