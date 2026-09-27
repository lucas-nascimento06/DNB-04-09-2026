import pool from '../../../../db.js';
import { downloadMediaMessage } from '@whiskeysockets/baileys';
import { Jimp } from "jimp";

const PRAZO_DESAFIO_HORAS = 24;
const INTERVALO_EXPIRACAO_SQL = '24 hours';
const MAX_PESSOAS_DESAFIO = 50;

// Cache do metadata dos grupos (evita chamar a API do WhatsApp a cada mensagem)
const METADATA_TTL_MS = 5 * 60 * 1000;
const metadataCache = new Map();

// Cache global para armazenar mensagens das provas (evita perder dados entre confirmações)
const cacheProvas = new Map();

function extractDigits(number) {
    if (!number) return null;
    return number.replace(/@.*$/, '').replace(/\D/g, '');
}

/**
 * Monta o JID usado para @mencionar alguém no sendMessage.
 * Se o valor guardado já é um JID completo (ex.: "146690715685110@lid",
 * porque não foi possível resolver o telefone real), usa ele direto —
 * assim o WhatsApp consegue pelo menos tentar resolver a menção certa,
 * em vez de virar um número solto sem nome e sem link (o LID colado
 * com "@s.whatsapp.net" na ponta é um JID inválido).
 * Se for só dígitos (telefone real já resolvido), completa com @s.whatsapp.net.
 */
function jidParaMencao(id) {
    if (!id) return null;
    return String(id).includes('@') ? id : `${id}@s.whatsapp.net`;
}

function getNumeroReal(message) {
    if (message.key.participantAlt) return message.key.participantAlt;
    if (message.key.participant) return message.key.participant;
    return message.key.remoteJid;
}

/**
 * Menções e reply ficam em lugares diferentes dependendo do tipo da mensagem:
 * texto puro -> extendedTextMessage.contextInfo
 * foto com legenda -> imageMessage.contextInfo
 * vídeo com legenda -> videoMessage.contextInfo
 */
function getContextInfo(message) {
    const m = message.message;
    if (!m) return null;
    return m.extendedTextMessage?.contextInfo
        || m.imageMessage?.contextInfo
        || m.videoMessage?.contextInfo
        || null;
}

/** Pega o texto (ou legenda) da mensagem, seja qual for o tipo. */
function extrairTextoDaMensagem(message) {
    const m = message.message;
    if (!m) return '';
    return m.conversation
        || m.extendedTextMessage?.text
        || m.imageMessage?.caption
        || m.videoMessage?.caption
        || '';
}

async function obterMetadata(sock, groupId, forcar = false) {
    const cached = metadataCache.get(groupId);
    if (!forcar && cached && Date.now() - cached.ts < METADATA_TTL_MS) {
        return cached.meta;
    }
    const meta = await sock.groupMetadata(groupId);
    metadataCache.set(groupId, { meta, ts: Date.now() });
    return meta;
}

async function isAdmin(sock, groupId, userId) {
    try {
        // Sem cache aqui de propósito: o status de admin precisa estar sempre atualizado
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

/**
 * Converte um JID (que pode ser @lid ou @s.whatsapp.net) no número de telefone real.
 * Se não conseguir resolver, devolve os dígitos do próprio JID (comportamento antigo).
 */
async function resolverNumeroRealDoMencionado(sock, groupId, mentionedJid) {
    if (!mentionedJid) return null;

    if (mentionedJid.endsWith('@s.whatsapp.net')) {
        return extractDigits(mentionedJid);
    }

    const buscar = (meta) => {
        const participante = meta.participants.find(
            p => p.id === mentionedJid || p.lid === mentionedJid
        );
        const numeroReal = participante?.jid || participante?.phoneNumber || participante?.pn || participante?.participantAlt;
        if (numeroReal && !String(numeroReal).includes('@lid')) {
            return extractDigits(numeroReal);
        }
        return null;
    };

    try {
        let resultado = buscar(await obterMetadata(sock, groupId));
        if (resultado) return resultado;

        // Não achou no cache: pode ser alguém que entrou depois, tenta atualizar uma vez
        resultado = buscar(await obterMetadata(sock, groupId, true));
        if (resultado) return resultado;
    } catch (err) {
        console.error('[resolverNumeroRealDoMencionado] Erro:', err.message);
    }

    // Não conseguiu achar o telefone real (comum quando a pessoa só aparece
    // como @lid no grupo). Mantém o JID original completo (com "@lid"),
    // em vez de extrair só os dígitos — dígitos de LID colados com
    // "@s.whatsapp.net" na hora de mencionar viram um JID inválido, e o
    // WhatsApp mostra um número gigante solto ao invés do nome da pessoa.
    console.warn(`[resolverNumeroRealDoMencionado] Não resolvi telefone real para ${mentionedJid}, mantendo JID original`);
    return mentionedJid;
}

/**
 * Para IDs já salvos no banco (ex.: admin_id de desafios antigos que foram gravados com LID).
 * Se os dígitos baterem com o LID de algum participante, devolve o telefone real dele.
 * Caso contrário devolve o próprio valor salvo.
 */
async function resolverIdSalvo(sock, groupId, idSalvo) {
    if (!idSalvo) return idSalvo;

    try {
        const meta = await obterMetadata(sock, groupId);
        const participante = meta.participants.find(p =>
            extractDigits(p.id) === idSalvo || extractDigits(p.lid) === idSalvo
        );
        const numeroReal = participante?.phoneNumber || participante?.jid || participante?.pn;
        if (numeroReal && !String(numeroReal).includes('@lid')) {
            return extractDigits(numeroReal);
        }
    } catch (err) {
        console.warn('[desafioleilaoHandler] Erro ao resolver ID salvo:', err.message);
    }

    return idSalvo;
}

function extrairTextoExtra(content) {
    // Remove o #pronto (e o ID colado nele, se houver) de onde ele estiver no texto,
    // remove as menções e limpa os espaços.
    return (content || '')
        .replace(/#pronto\b(?:[ \t]+(?:id)?\d+\b)?/gi, ' ')
        .replace(/@[\w.]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

async function gerarThumbnail(buffer, size = 256) {
    try {
        const image = await Jimp.read(buffer);
        await image.scaleToFit(size, size);
        return await image.getBuffer("image/png");
    } catch (err) {
        console.warn('[desafioleilaoHandler] Erro ao gerar thumbnail:', err.message);
        return null;
    }
}

/**
 * Reenvia uma mídia "limpa" (sem o comando na legenda) para o grupo de destino.
 * Funciona com imageMessage e videoMessage — qualquer outro tipo de mídia é ignorado.
 */
async function reenviarMidiaLimpa(sock, grupoDestino, mensagemComMidia, opcoes = {}) {
    const { caption = '', mentions = [] } = opcoes;
    const conteudo = mensagemComMidia.message;
    if (!conteudo) return false;

    const tipoMidia = conteudo.imageMessage
        ? 'imageMessage'
        : conteudo.videoMessage
            ? 'videoMessage'
            : null;

    if (!tipoMidia) return false;

    const mensagemSemComando = {
        ...mensagemComMidia,
        message: {
            ...conteudo,
            [tipoMidia]: {
                ...conteudo[tipoMidia],
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

    const payload = tipoMidia === 'imageMessage'
        ? { image: buffer }
        : { video: buffer };

    if (tipoMidia === 'imageMessage') {
        const thumb = await gerarThumbnail(buffer, 256);
        if (thumb) payload.jpegThumbnail = thumb;
    } else {
        // Vídeo: não geramos thumbnail com Jimp (não é imagem), reaproveita o thumb original se existir
        const thumbOriginal = conteudo.videoMessage?.jpegThumbnail;
        if (thumbOriginal) payload.jpegThumbnail = thumbOriginal;
    }

    if (caption) {
        payload.caption = caption;
        if (mentions.length) payload.mentions = mentions;
    }

    try {
        await sock.sendMessage(grupoDestino, payload);
    } catch (err) {
        console.warn('[desafioleilaoHandler] Erro ao enviar mídia:', err.message);
        return false;
    }

    return true;
}

/**
 * Detecta um "tipo sugerido" de comprovação a partir da descrição do desafio.
 * Isso é usado só para exibir uma instrução mais bonitinha na mensagem de criação
 * do desafio — NÃO é mais usado para bloquear a confirmação (ver validarComprovacao).
 */
function detectarTipoComprovacao(descricao) {
    const desc = descricao.toLowerCase();
    const temFoto = desc.includes('foto') || desc.includes('selfie') || desc.includes('screenshot');
    const temVideo = desc.includes('vídeo') || desc.includes('video');
    const temTexto = desc.includes('texto') || desc.includes('escrever') || desc.includes('poema');

    if ((temFoto || temVideo) && temTexto) return 'foto_texto';
    if (temVideo) return 'video';
    if (temFoto) return 'foto';
    if (temTexto) return 'texto';

    return 'qualquer';
}

/**
 * Valida a comprovação enviada.
 * Regra atual: aceita QUALQUER combinação de foto, vídeo ou texto — sozinhos ou juntos.
 * Ou seja: só texto ✅ | só foto ✅ | só vídeo ✅ | foto+texto ✅ | vídeo+texto ✅.
 * Só é rejeitado se não vier nada disso (ex.: só um sticker, áudio, ou mensagem vazia).
 */
function validarComprovacao(message, content) {
    const msg = message.message;
    if (!msg) return false;

    const temImagemDireta = !!msg.imageMessage;
    const temVideoDireto = !!msg.videoMessage;
    const temTexto = extrairTextoExtra(content).length >= 3;

    const quoted = getContextInfo(message)?.quotedMessage;
    const temImagemNoQuote = !!quoted?.imageMessage;
    const temVideoNoQuote = !!quoted?.videoMessage;

    const temImagem = temImagemDireta || temImagemNoQuote;
    const temVideo = temVideoDireto || temVideoNoQuote;

    return temImagem || temVideo || temTexto;
}

/**
 * Gera mensagem de erro quando nenhuma comprovação válida foi encontrada
 * (nem foto, nem vídeo, nem texto).
 */
function gerarMensagemErroComprovacao() {
    return `📸🎥✍️ Você precisa enviar uma *foto*, um *vídeo* ou um *texto* como comprovação ` +
           `(ou responder a uma foto/vídeo com uma explicação).\n\n` +
           `Tente novamente!`;
}

/**
 * Extrai e serializa a comprovação (imagem, vídeo ou texto) para armazenar no banco
 * Também armazena a mensagem completa em cache para poder recuperar depois
 */
async function extrairComprovacao(message, content, userId) {
    const msg = message.message;
    if (!msg) return null;

    const temMidiaDireta = !!msg.imageMessage || !!msg.videoMessage;

    if (temMidiaDireta) {
        // Recupera o texto que pode vir junto da mídia
        const textoExtra = extrairTextoExtra(content);

        // Armazena a mensagem completa em cache
        const chaveCache = `prova_${userId}_${Date.now()}`;
        cacheProvas.set(chaveCache, {
            message,
            tipo: 'midia_direta',
            userId,
            textoExtra: textoExtra.length >= 3 ? textoExtra : null,
            timestamp: Date.now()
        });

        // Serializa com referência ao cache
        return JSON.stringify({
            tipo: 'midia_direta',
            cacheKey: chaveCache,
            userId,
            textoExtra: textoExtra.length >= 3 ? textoExtra : null
        });
    }

    const contextInfo = getContextInfo(message);
    const quotedMsg = contextInfo?.quotedMessage;
    if (quotedMsg?.imageMessage || quotedMsg?.videoMessage) {
        // Recupera o texto que pode vir junto do reply
        const textoExtra = extrairTextoExtra(content);

        // Armazena o quote em cache
        const chaveCache = `prova_${userId}_${Date.now()}`;
        cacheProvas.set(chaveCache, {
            message: {
                key: {
                    remoteJid: message.key.remoteJid,
                    id: contextInfo.stanzaId,
                    participant: contextInfo.participant,
                    fromMe: false
                },
                message: quotedMsg
            },
            tipo: 'midia_quoted',
            userId,
            textoExtra: textoExtra.length >= 3 ? textoExtra : null,
            timestamp: Date.now()
        });

        return JSON.stringify({
            tipo: 'midia_quoted',
            cacheKey: chaveCache,
            userId,
            textoExtra: textoExtra.length >= 3 ? textoExtra : null
        });
    }

    const textoRestante = extrairTextoExtra(content);
    if (textoRestante.length >= 3) {
        return JSON.stringify({
            tipo: 'texto',
            conteudo: textoRestante,
            userId
        });
    }

    return null;
}

/**
 * Recupera a comprovação do cache ou reconstrói a partir dos dados serializados
 */
function recuperarComprovacao(comprovacaoJson) {
    try {
        const comprovacao = JSON.parse(comprovacaoJson);

        if (comprovacao.tipo === 'midia_direta' || comprovacao.tipo === 'midia_quoted') {
            if (comprovacao.cacheKey && cacheProvas.has(comprovacao.cacheKey)) {
                const cached = cacheProvas.get(comprovacao.cacheKey);
                // Adiciona o textoExtra se estiver na comprovação serializada
                if (comprovacao.textoExtra && !cached.textoExtra) {
                    cached.textoExtra = comprovacao.textoExtra;
                }
                return cached;
            }
        }

        if (comprovacao.tipo === 'texto') {
            return {
                tipo: 'texto',
                conteudo: comprovacao.conteudo,
                userId: comprovacao.userId
            };
        }
    } catch (err) {
        console.warn('[desafioleilaoHandler] Erro ao recuperar comprovação:', err.message);
    }

    return null;
}

/**
 * ✅ RETROCOMPATÍVEL: Extrai lista de participantes de um desafio
 * Se for novo (com participantes_json), usa isso
 * Se for antigo (com casal_id1/2), reconstrói a lista
 */
function extrairParticipantes(desafio) {
    if (desafio.participantes_json) {
        return desafio.participantes_json.split(',').filter(p => p);
    }
    // Fallback para desafios antigos (casal)
    const participantes = [];
    if (desafio.casal_id1) participantes.push(desafio.casal_id1);
    if (desafio.casal_id2) participantes.push(desafio.casal_id2);
    return participantes;
}

/**
 * ✅ RETROCOMPATÍVEL: Extrai provas de um desafio
 * Se for novo (com provas_json), usa isso
 * Se for antigo (com prova_casal_1/2), reconstrói o objeto
 */
function extrairProvas(desafio) {
    if (desafio.provas_json) {
        try {
            return typeof desafio.provas_json === 'string' 
                ? JSON.parse(desafio.provas_json) 
                : desafio.provas_json;
        } catch (err) {
            console.warn('[desafioleilaoHandler] Erro ao parsear provas_json:', err.message);
            return {};
        }
    }
    // Fallback para desafios antigos (casal)
    const provas = {};
    if (desafio.prova_casal_1 && desafio.casal_id1) {
        provas[desafio.casal_id1] = desafio.prova_casal_1;
    }
    if (desafio.prova_casal_2 && desafio.casal_id2) {
        provas[desafio.casal_id2] = desafio.prova_casal_2;
    }
    return provas;
}

async function handleDesafioCommand(sock, message, content) {
    const from = message.key.remoteJid;
    if (!from.endsWith('@g.us')) return false;

    const match = content.match(/#desafio\b\s*/i);
    if (!match) return false;

    try {
        const remetenteCompleto = getNumeroReal(message);
        const adminIdBruto = extractDigits(remetenteCompleto);
        const ehAdmin = await isAdmin(sock, from, adminIdBruto);
        
        if (!ehAdmin) {
            await sock.sendMessage(from, {
                text: '🚫 Só administradores podem enviar desafios.'
            }, { quoted: message });
            return true;
        }

        const adminId = await resolverNumeroRealDoMencionado(sock, from, remetenteCompleto);
        const mentions = getContextInfo(message)?.mentionedJid || [];
        
        if (mentions.length < 1 || mentions.length > MAX_PESSOAS_DESAFIO) {
            await sock.sendMessage(from, {
                text: `⚠️ Marque entre 1 e ${MAX_PESSOAS_DESAFIO} pessoas para receber o desafio.\n\n*Exemplo:* \`#desafio @maria @joão tirar uma selfie juntos 📸\``
            }, { quoted: message });
            return true;
        }

        // Resolve todos os números
        const pessoas = [];
        for (const mention of mentions) {
            const numero = await resolverNumeroRealDoMencionado(sock, from, mention);
            if (numero && !pessoas.includes(numero)) {
                pessoas.push(numero);
            }
        }

        if (pessoas.length < 1) {
            await sock.sendMessage(from, {
                text: '⚠️ Não consegui resolver os números das pessoas mencionadas.'
            }, { quoted: message });
            return true;
        }

        // Verifica se há desafio pendente para esse grupo de pessoas
        const pessoasOrdenadas = pessoas.sort().join(',');
        
        // ✅ RETROCOMPATÍVEL: busca em ambos os formatos
        let ativo = null;
        
        if (pessoas.length === 2) {
            // Verifica formato antigo (casal)
            ativo = await pool.query(
                `SELECT id FROM damas_desafios 
                 WHERE grupo_id = $1 
                 AND status = 'pendente'
                 AND (
                    (casal_id1 = $2 AND casal_id2 = $3) OR
                    (casal_id1 = $3 AND casal_id2 = $2)
                 )`,
                [from, pessoas[0], pessoas[1]]
            );
        }
        
        // Se não achou, ou se são 3+, verifica formato novo
        if (ativo?.rowCount === 0 || !ativo) {
            ativo = await pool.query(
                `SELECT id FROM damas_desafios 
                 WHERE grupo_id = $1 
                 AND status = 'pendente'
                 AND participantes_json = $2`,
                [from, pessoasOrdenadas]
            );
        }

        if (ativo && ativo.rowCount > 0) {
            await sock.sendMessage(from, {
                text: `⚠️ Esse grupo de pessoas já tem um desafio pendente! ⏳\n\nConcluam o atual antes de receber um novo.`,
                mentions: pessoas.map(p => jidParaMencao(p))
            }, { quoted: message });
            return true;
        }

        // Remove o #desafio e TODAS as menções (@numero, @lid, etc.) do texto,
        // não importa quantas sejam — assim nenhum resto de ID/LID fica
        // grudado na descrição, tipo "@146690715685110 @37753383346386".
        let descricao = content
            .replace(/#desafio\b\s*/i, '')
            .replace(/@[\w.]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        if (!descricao || descricao.length < 3) {
            await sock.sendMessage(from, {
                text: `⚠️ Descreva o desafio.\n\n*Exemplo:* \`#desafio @maria @joão tirar uma selfie juntos 📸\``
            }, { quoted: message });
            return true;
        }

        const tipoComprovacao = detectarTipoComprovacao(descricao);

        // ✅ RETROCOMPATÍVEL: insere em ambos os formatos
        let insertResult;
        
        if (pessoas.length === 2) {
            // Formato antigo + novo
            insertResult = await pool.query(
                `INSERT INTO damas_desafios 
                 (grupo_id, casal_id1, casal_id2, participantes_json, descricao, admin_id, status, tipo_comprovacao_requerida)
                 VALUES ($1, $2, $3, $4, $5, $6, 'pendente', $7)
                 RETURNING id`,
                [from, pessoas[0], pessoas[1], pessoasOrdenadas, descricao, adminId, tipoComprovacao]
            );
        } else {
            // Formato novo
            insertResult = await pool.query(
                `INSERT INTO damas_desafios 
                 (grupo_id, participantes_json, descricao, admin_id, status, tipo_comprovacao_requerida)
                 VALUES ($1, $2, $3, $4, 'pendente', $5)
                 RETURNING id`,
                [from, pessoasOrdenadas, descricao, adminId, tipoComprovacao]
            );
        }

        const desafioId = insertResult.rows[0].id;
        const agora = new Date().toLocaleString('pt-BR', { 
            dateStyle: 'short', 
            timeStyle: 'short' 
        });

        // A comprovação aceita qualquer combinação de foto, vídeo ou texto,
        // então a instrução é sempre a mesma, independente do que a descrição sugere.
        const instrucaoTipo = `📸🎥✍️ Vocês têm *${PRAZO_DESAFIO_HORAS} horas* pra completar! ` +
            `Pode mandar foto, vídeo, texto ou uma combinação deles.\n\n`;

        const listaParticipantes = pessoas.map(p => `@${p}`).join(', ');

        // ✅ DELETE da mensagem do usuário
        try {
            await sock.sendMessage(from, { delete: message.key });
        } catch (err) {
            console.warn('[desafioleilaoHandler] Erro ao deletar mensagem do usuário:', err.message);
        }

        // Envia a resposta do bot
        await sock.sendMessage(from, {
            text: `🎯 *DESAFIO RECEBIDO!* 🎯\n\n` +
                  `👥 Participantes: ${listaParticipantes}\n\n` +
                  `💪 *Tarefa:* ${descricao}\n\n` +
                  `⏰ *Horário:* ${agora}\n` +
                  `👮 *Enviado por:* @${adminId}\n\n` +
                  `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                  instrucaoTipo +
                  `✅ Quando acabar, um de vocês manda:\n` +
                  `*#pronto* (marcando um admin, se quiser notificar direto)\n\n` +
                  `🔥 Vamos lá! 💪`,
            mentions: [...pessoas.map(p => jidParaMencao(p)), jidParaMencao(adminId)]
        });

        console.log(`✅ [desafioleilaoHandler] Desafio #${desafioId} criado`);
        console.log(`   Participantes: ${pessoas.join(', ')}`);
        console.log(`   Descrição: ${descricao}`);
        console.log(`   Tipo comprovação (sugerido): ${tipoComprovacao}`);
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

async function handleProntoCommand(sock, message, content) {
    const from = message.key.remoteJid;
    if (!from.endsWith('@g.us')) return false;

    const match = content.match(/#pronto\b(?:\s+(?:id)?(\d+))?/i);
    if (!match) return false;

    try {
        const numeroCompleto = getNumeroReal(message);
        const userId = await resolverNumeroRealDoMencionado(sock, from, numeroCompleto);

        let desafioId = match[1] ? parseInt(match[1], 10) : null;

        const mentionedRaw = getContextInfo(message)?.mentionedJid || [];
        let adminMencionadoId = null;
        if (mentionedRaw.length > 0) {
            adminMencionadoId = await resolverNumeroRealDoMencionado(sock, from, mentionedRaw[0]);
        }

        if (!desafioId) {
            // ✅ RETROCOMPATÍVEL: busca em ambos os formatos
            let desafioResult = await pool.query(
                `SELECT id FROM damas_desafios 
                 WHERE grupo_id = $1 
                 AND status IN ('pendente', 'confirmado', 'confirmado_por_um')
                 AND (casal_id1 = $2 OR casal_id2 = $2)
                 ORDER BY criado_em DESC
                 LIMIT 1`,
                [from, userId]
            );

            if (desafioResult.rowCount === 0) {
                // Tenta formato novo
                desafioResult = await pool.query(
                    `SELECT id FROM damas_desafios 
                     WHERE grupo_id = $1 
                     AND status IN ('pendente', 'confirmado')
                     AND participantes_json LIKE $2
                     ORDER BY criado_em DESC
                     LIMIT 1`,
                    [from, `%${userId}%`]
                );
            }

            if (desafioResult.rowCount === 0) {
                await sock.sendMessage(from, {
                    text: `⚠️ Você não tem nenhum desafio pendente no momento.`
                }, { quoted: message });
                return true;
            }

            desafioId = desafioResult.rows[0].id;
        }

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
        const participantes = extrairParticipantes(desafio);

        if (!participantes.includes(userId)) {
            await sock.sendMessage(from, {
                text: `🚫 *Acesso negado!*\n\n` +
                      `Só os participantes do desafio podem confirmá-lo.`,
                mentions: participantes.map(p => jidParaMencao(p))
            }, { quoted: message });
            return true;
        }

        if (!validarComprovacao(message, content)) {
            await sock.sendMessage(from, {
                text: `🚨 *COMPROVAÇÃO INVÁLIDA!* 🚨\n\n` +
                      gerarMensagemErroComprovacao() + `\n\n` +
                      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                      `*Tarefa:* ${desafio.descricao}`
            }, { quoted: message });
            return true;
        }

        if (desafio.status === 'concluido') {
            const dataConclusao = new Date(desafio.concluido_em).toLocaleString('pt-BR');
            await sock.sendMessage(from, {
                text: `ℹ️ Esse desafio já foi concluído em ${dataConclusao}.`
            }, { quoted: message });
            return true;
        }

        const comprovacao = await extrairComprovacao(message, content, userId);
        let provas = extrairProvas(desafio);
        
        if (provas[userId]) {
            await sock.sendMessage(from, {
                text: `ℹ️ Você já confirmou este desafio. Aguarde os outros participantes.`
            }, { quoted: message });
            return true;
        }

        provas[userId] = comprovacao;
        const todosConfirmaram = Object.keys(provas).length === participantes.length;

        // ✅ RETROCOMPATÍVEL: atualiza em ambos os formatos quando aplicável
        let updateQuery, updateParams;
        
        if (participantes.length === 2 && desafio.casal_id1 && desafio.casal_id2) {
            // Formato antigo com 2 pessoas
            if (todosConfirmaram) {
                // Ambas confirmaram - atualiza formato antigo
                const colunaPróxima = userId === desafio.casal_id1 ? 'prova_casal_1' : 'prova_casal_2';
                updateQuery = `UPDATE damas_desafios 
                 SET status = 'concluido', concluido_em = NOW(), concluido_por = $1, ${colunaPróxima} = $2, provas_json = $3
                 WHERE id = $4
                 RETURNING *`;
                updateParams = [userId, comprovacao, JSON.stringify(provas), desafioId];
            } else {
                // Apenas uma confirmou - usa formato antigo
                if (userId === desafio.casal_id1) {
                    updateQuery = `UPDATE damas_desafios 
                     SET status = 'confirmado_por_um', confirmado_por_casal_1 = $1, prova_casal_1 = $2, provas_json = $3
                     WHERE id = $4
                     RETURNING *`;
                } else {
                    updateQuery = `UPDATE damas_desafios 
                     SET status = 'confirmado_por_um', confirmado_por_casal_2 = $1, prova_casal_2 = $2, provas_json = $3
                     WHERE id = $4
                     RETURNING *`;
                }
                updateParams = [userId, comprovacao, JSON.stringify(provas), desafioId];
            }
        } else {
            // Formato novo (3+ pessoas ou desafio novo)
            if (todosConfirmaram) {
                updateQuery = `UPDATE damas_desafios 
                 SET status = 'concluido', concluido_em = NOW(), concluido_por = $1, provas_json = $2
                 WHERE id = $3
                 RETURNING *`;
                updateParams = [userId, JSON.stringify(provas), desafioId];
            } else {
                updateQuery = `UPDATE damas_desafios 
                 SET status = 'confirmado', provas_json = $1
                 WHERE id = $2
                 RETURNING *`;
                updateParams = [JSON.stringify(provas), desafioId];
            }
        }

        const updateResult = await pool.query(updateQuery, updateParams);
        const desafioAtualizado = updateResult.rows[0];

        if (!todosConfirmaram) {
            const confirmados = Object.keys(provas).length;
            const faltam = participantes.length - confirmados;
            
            // ✅ DELETE da mensagem do usuário
            try {
                await sock.sendMessage(from, { delete: message.key });
            } catch (err) {
                console.warn('[desafioleilaoHandler] Erro ao deletar mensagem #pronto:', err.message);
            }
            
            // ✅ Construir lista de confirmados e faltantes
            const confirmadosIds = Object.keys(provas);
            const listaConfirmados = confirmadosIds.map(id => `✅ @${id}`).join('\n');
            const faltantesIds = participantes.filter(p => !confirmadosIds.includes(p));
            const listaFaltantes = faltantesIds.map(id => `⏳ @${id}`).join('\n');
            
            const mensagemProgresso = `📋 *PROGRESSO DO DESAFIO #${desafioId}*\n\n` +
                                     `✅ *Confirmados (${confirmados}/${participantes.length}):*\n${listaConfirmados}\n\n` +
                                     `⏳ *Faltando (${faltam}):*\n${listaFaltantes}`;
            
            // Envia no grupo principal — marca especificamente quem ainda falta confirmar
            await sock.sendMessage(from, {
                text: `✅ *CONFIRMAÇÃO RECEBIDA!* ✨\n\n` +
                      `@${userId} confirmou o desafio!\n\n` +
                      `⏳ Faltam ${faltam} participante(s):\n${listaFaltantes}\n\n` +
                      `🎯 *Desafio:* ${desafio.descricao}`,
                mentions: faltantesIds.map(p => jidParaMencao(p))
            });
            
            // ✅ Envia lista atualizada para sala de registro
            const GRUPO_LEILOES = process.env.GRUPO_LEILOES_ID;
            if (GRUPO_LEILOES) {
                try {
                    await sock.sendMessage(GRUPO_LEILOES, {
                        text: mensagemProgresso,
                        mentions: [...confirmadosIds.map(p => jidParaMencao(p)), ...faltantesIds.map(p => jidParaMencao(p))]
                    });
                } catch (err) {
                    console.warn('[desafioleilaoHandler] Erro ao enviar progresso para grupo de registro:', err.message);
                }
            }
            
            console.log(`✅ [desafioleilaoHandler] Desafio #${desafioId} confirmado por ${userId} (${confirmados}/${participantes.length})`);
            return true;
        }

        // Todos confirmaram
        const dataEnvio = new Date(desafio.criado_em).toLocaleString('pt-BR', { 
            dateStyle: 'short', 
            timeStyle: 'short' 
        });
        const dataConclusao = new Date(desafioAtualizado.concluido_em).toLocaleString('pt-BR', {
            dateStyle: 'short',
            timeStyle: 'short'
        });

        const mentionsConclusao = participantes.map(p => jidParaMencao(p));
        const listaParticipantesStr = participantes.map(p => `@${p}`).join(', ');
        
        let linhaAdminMencionado = '';
        if (adminMencionadoId && !participantes.includes(adminMencionadoId)) {
            mentionsConclusao.push(jidParaMencao(adminMencionadoId));
            linhaAdminMencionado = `\n👮 *Admin notificado:* @${adminMencionadoId}`;
        }

        // ✅ DELETE da mensagem do usuário
        try {
            await sock.sendMessage(from, { delete: message.key });
        } catch (err) {
            console.warn('[desafioleilaoHandler] Erro ao deletar mensagem final:', err.message);
        }

        // Mensagem de conclusão
        const mensagemConclusao = `✅ *DESAFIO COMPLETADO!* 🎉\n\n` +
                                 `👏 Parabéns ${listaParticipantesStr}!\n\n` +
                                 `🎯 *Desafio:* ${desafio.descricao}\n` +
                                 `📅 *Concluído:* ${dataConclusao}` +
                                 linhaAdminMencionado + `\n\n` +
                                 `🔥 Vocês foram incríveis!`;

        // Envia no grupo principal
        await sock.sendMessage(from, {
            text: mensagemConclusao,
            mentions: mentionsConclusao
        });
        
        // ✅ Envia também na sala de registro
        const GRUPO_LEILOES_CONCLUSAO = process.env.GRUPO_LEILOES_ID;
        if (GRUPO_LEILOES_CONCLUSAO) {
            try {
                const adminCriadorReal = await resolverIdSalvo(sock, from, desafio.admin_id);
                const mentionsConclusaoRegistro = [
                    ...participantes.map(p => jidParaMencao(p)),
                    jidParaMencao(adminCriadorReal)
                ];
                
                if (adminMencionadoId && !participantes.includes(adminMencionadoId)) {
                    mentionsConclusaoRegistro.push(jidParaMencao(adminMencionadoId));
                }
                
                await sock.sendMessage(GRUPO_LEILOES_CONCLUSAO, {
                    text: mensagemConclusao,
                    mentions: mentionsConclusaoRegistro
                });
            } catch (err) {
                console.warn('[desafioleilaoHandler] Erro ao enviar conclusão para grupo de registro:', err.message);
            }
        }

        const GRUPO_LEILOES = process.env.GRUPO_LEILOES_ID;

        if (GRUPO_LEILOES) {
            const adminCriadorReal = await resolverIdSalvo(sock, from, desafio.admin_id);
            const mentionsRegistro = [
                ...participantes.map(p => jidParaMencao(p)),
                jidParaMencao(adminCriadorReal)
            ];
            
            let linhaAdminMencionadoRegistro = '';
            if (adminMencionadoId && !participantes.includes(adminMencionadoId)) {
                mentionsRegistro.push(jidParaMencao(adminMencionadoId));
                linhaAdminMencionadoRegistro = `\n🔔 *Notificado:* @${adminMencionadoId}`;
            }

            const registroTexto = 
                `📋 *DESAFIO CONCLUÍDO* ✅\n` +
                `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                `🆔 *ID:* #${desafioId}\n` +
                `👥 *Participantes:* ${listaParticipantesStr}\n` +
                `🎯 *Tarefa:* ${desafio.descricao}\n` +
                `👮 *Admin que criou:* @${adminCriadorReal}` +
                linhaAdminMencionadoRegistro + `\n` +
                `📅 *Enviado:* ${dataEnvio}\n` +
                `✅ *Concluído:* ${dataConclusao}\n` +
                `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

            try {
                // Envia provas de todos
                for (const [userProva, comprovacaoJson] of Object.entries(provas)) {
                    const comprov = recuperarComprovacao(comprovacaoJson);
                    if (!comprov) continue;

                    if (comprov.tipo === 'texto') {
                        await sock.sendMessage(GRUPO_LEILOES, {
                            text: `📸 *Comprovação de:* @${userProva}\n💬 _"${comprov.conteudo}"_`,
                            mentions: [jidParaMencao(userProva)]
                        });
                    } else if (comprov.tipo === 'midia_direta' || comprov.tipo === 'midia_quoted') {
                        let legenda = `📸 *Comprovação de:* @${userProva}`;

                        try {
                            const comprovJsonParsed = JSON.parse(comprovacaoJson);
                            if (comprovJsonParsed.textoExtra) {
                                legenda += `\n💬 _"${comprovJsonParsed.textoExtra}"_`;
                            }
                        } catch (err) {
                            // Ignora
                        }

                        if (comprov.textoExtra && !legenda.includes(comprov.textoExtra)) {
                            legenda = `📸 *Comprovação de:* @${userProva}\n💬 _"${comprov.textoExtra}"_`;
                        }

                        try {
                            await reenviarMidiaLimpa(sock, GRUPO_LEILOES, comprov.message, {
                                caption: legenda,
                                mentions: [jidParaMencao(userProva)]
                            });
                        } catch (err) {
                            console.warn(`[desafioleilaoHandler] Erro ao enviar imagem de ${userProva}:`, err.message);
                        }
                    }
                }

                await sock.sendMessage(GRUPO_LEILOES, {
                    text: registroTexto,
                    mentions: mentionsRegistro
                });
                console.log(`📋 [desafioleilaoHandler] Registro do desafio #${desafioId} enviado pro grupo de admins`);
            } catch (err) {
                console.warn('[desafioleilaoHandler] Erro ao enviar registro:', err.message);
            }
        }

        console.log(`✅ [desafioleilaoHandler] Desafio #${desafioId} concluído`);
        console.log(`   Participantes: ${participantes.join(', ')}`);
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

async function verificarDesafiosExpirados(sock) {
    const GRUPO_LEILOES = process.env.GRUPO_LEILOES_ID;
    if (!GRUPO_LEILOES) return;

    try {
        const expirados = await pool.query(
            `SELECT * FROM damas_desafios
             WHERE status = 'pendente'
             AND criado_em <= NOW() - INTERVAL '${INTERVALO_EXPIRACAO_SQL}'`
        );

        for (const desafio of expirados.rows) {
            try {
                const adminCriadorReal = await resolverIdSalvo(sock, desafio.grupo_id, desafio.admin_id);
                const participantes = extrairParticipantes(desafio);
                const listaParticipantesStr = participantes.map(p => `@${p}`).join(', ');

                await sock.sendMessage(GRUPO_LEILOES, {
                    text: `⏰ *DESAFIO NÃO CUMPRIDO!* ⚠️\n\n` +
                          `🆔 *ID:* #${desafio.id}\n` +
                          `👥 *Participantes:* ${listaParticipantesStr}\n` +
                          `🎯 *Tarefa:* ${desafio.descricao}\n` +
                          `👮 *Admin que criou:* @${adminCriadorReal}\n\n` +
                          `🚫 O prazo de *${PRAZO_DESAFIO_HORAS} horas* acabou e eles não concluíram o desafio.`,
                    mentions: [
                        ...participantes.map(p => jidParaMencao(p)),
                        jidParaMencao(adminCriadorReal)
                    ]
                });

                await pool.query(
                    `UPDATE damas_desafios SET status = 'expirado' WHERE id = $1`,
                    [desafio.id]
                );

                console.log(`⏰ [desafioleilaoHandler] Desafio #${desafio.id} expirado — admins avisados`);
            } catch (err) {
                console.warn(`[desafioleilaoHandler] Erro ao avisar expiração #${desafio.id}:`, err.message);
            }
        }
    } catch (err) {
        console.error('[desafioleilaoHandler] Erro ao verificar desafios expirados:', err.message);
    }
}

export function iniciarVerificadorDesafiosExpirados(sock, intervaloMinutos = 30) {
    verificarDesafiosExpirados(sock);
    return setInterval(() => verificarDesafiosExpirados(sock), intervaloMinutos * 60 * 1000);
}

export async function handleDesafioleilaoCommand(sock, message, content) {
    const textos = [];
    if (typeof content === 'string' && content.trim()) textos.push(content);

    const textoDaMensagem = extrairTextoDaMensagem(message);
    if (textoDaMensagem && textoDaMensagem.trim() && !textos.includes(textoDaMensagem)) {
        textos.push(textoDaMensagem);
    }

    for (const texto of textos) {
        if (await handleDesafioCommand(sock, message, texto)) return true;
        if (await handleProntoCommand(sock, message, texto)) return true;
    }
    return false;
}