import { randomInt } from 'crypto';
import pool from '../../../../db.js';

// ─────────────────────────────────────────────────────────────────────────────
// 📩 RECADOS ANÔNIMOS — Versão 2.9 (Base64, RÁPIDO & SEM FALHAS NO TERMUX)
//
// Uso: #msn
// Precisa ser digitado dentro do grupo pra onde os recados devem ir.
// 🔒 Apenas administradores do grupo podem executar esse comando.
//
// ✨ v2.9 - NOVA:
//   • REMOVER RESPONDENDO A MENSAGEM: responda o recado com #rmsn (ou #r msn)
//     e o bot descobre o código sozinho. Nada de digitar código!
//   • O bot guarda o ID de cada mensagem enviada (coluna msg_ids), então
//     funciona até no grupo principal, onde o código não aparece no texto.
//   • Continua aceitando o código digitado: #rmsn VGv78 | #rmsnVGv78 | #r msn VGv78
//
// ✨ v2.8:
//   • SOFT DELETE: recados removidos são marcados como 'removido', não deletados
//   • Auditoria preservada: pode ver histórico de removidos
//   • Contagem corrigida: #dados mostra números precisos
//   • Reverter removido: UPDATE removido = FALSE se foi por engano
//
// Histórico de versões:
// 🔧 v2.1: só busca recados 'pendente' e marca como 'enviado' após cada envio.
// 🧪 v2.2: grupo de TESTE (GRUPOS_TESTE).
// 🔖 v2.3: CÓDIGO + MODERAÇÃO: #rmsn 4821 | #rmsn4821 | #r msn 4821
// 🎲 v2.4: CÓDIGOS ALEATÓRIOS E ILIMITADOS (4 dígitos, cresce sozinho).
// ✨ v2.5: CÓDIGOS ALFANUMÉRICOS (ex: VGv78), correções de race condition
// ✨ v2.6: Teste funciona igual ao principal, coluna enviado_teste
// ✨ v2.7: Teste não gasta pendentes do principal
// ✨ v2.8: SOFT DELETE - recados removidos preservam auditoria
// ✨ v2.9: REMOVER RESPONDENDO A MENSAGEM DO RECADO
// ─────────────────────────────────────────────────────────────────────────────

// IDs dos grupos de TESTE (mesmo comportamento do principal, mas mostra o código)
const GRUPOS_TESTE = [
    '120363410625671149@g.us', // grupo de teste
];

// ID do grupo PRINCIPAL (envia só os pendentes e marca como 'enviado')
const GRUPO_PRINCIPAL = '120363412511975026@g.us';

// 🔖 Mostrar o código dentro da mensagem do recado no grupo principal?
const MOSTRAR_CODIGO_NO_PRINCIPAL = false;

// 🎲 Códigos aleatórios alfanuméricos (ex: VGv78). Começam com 5 caracteres e
// crescem sozinhos (6, 7...) quando mais da metade das combinações está ocupada.
// Sem caracteres confusos (0/O, 1/I/l). A busca ignora maiúscula/minúscula.
const TAMANHO_MINIMO = 5;
const TAMANHO_COLUNA = 12; // limite do VARCHAR no banco
const LETRAS = 'ABCDEFGHJKMNPQRSTUVWXYZ'; // sem I, L, O
const NUMEROS = '23456789';               // sem 0 e 1
const SIMBOLOS_EFETIVOS = LETRAS.length + NUMEROS.length; // 31 (maiúsc = minúsc)

// 🔒 Trava: evita dois #msn rodando ao mesmo tempo no mesmo grupo
const emExecucao = new Set();

// Envia mensagem citando (quoted) corretamente: quoted vai nas OPÇÕES
function enviar(sock, jid, content, quoted) {
    return quoted
        ? sock.sendMessage(jid, content, { quoted })
        : sock.sendMessage(jid, content);
}

function esperar(ms) {
    return new Promise(r => setTimeout(r, ms));
}

function resolverSenderId(message) {
    const key = message.key;
    if (key.participantAlt && key.participantAlt.endsWith('@s.whatsapp.net')) {
        return key.participantAlt;
    }
    if (key.participant && key.participant.endsWith('@s.whatsapp.net')) {
        return key.participant;
    }
    return key.participant || key.remoteJid;
}

// 🔒 Verifica se quem mandou o comando é admin do grupo
async function verificarSeEhAdmin(sock, from, message, senderId) {
    try {
        console.log(`🔐 [DEBUG] Verificando se ${senderId} é admin...`);
        const groupMetadata = await sock.groupMetadata(from);
        const candidatos = new Set([
            senderId,
            message.key.participant,
            message.key.participantAlt,
        ].filter(Boolean));

        const participante = groupMetadata.participants.find(p => candidatos.has(p.id));

        if (!participante) {
            console.log(`❌ [DEBUG] Participante não encontrado`);
            return false;
        }

        const isAdmin = participante.admin === 'admin' || participante.admin === 'superadmin';
        console.log(`${isAdmin ? '✅' : '❌'} [DEBUG] Admin: ${isAdmin}`);
        return isAdmin;
    } catch (err) {
        console.error('⚠️ [RECADOS] Erro ao verificar admin:', err.message);
        return false;
    }
}

// ============================================
// 🗑️ SOFT DELETE - Colunas de Auditoria
// ============================================

let colunasOk = false;
async function garantirColunas() {
    if (colunasOk) return;

    // Coluna de código para remoção
    await pool.query(`ALTER TABLE recados_anonimos ADD COLUMN IF NOT EXISTS codigo VARCHAR(${TAMANHO_COLUNA})`);
    await pool.query(`ALTER TABLE recados_anonimos ALTER COLUMN codigo TYPE VARCHAR(${TAMANHO_COLUNA})`);
    await pool.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS recados_anonimos_codigo_uidx
         ON recados_anonimos (codigo) WHERE codigo IS NOT NULL`
    );
    // Garante que VGv78 e vgV78 nunca existam ao mesmo tempo
    await pool.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS recados_anonimos_codigo_upper_uidx
         ON recados_anonimos (UPPER(codigo)) WHERE codigo IS NOT NULL`
    );

    // Coluna de teste: marca como enviado no teste SEM alterar o status
    await pool.query(`ALTER TABLE recados_anonimos ADD COLUMN IF NOT EXISTS enviado_teste BOOLEAN DEFAULT FALSE`);

    // ✨ v2.8 - SOFT DELETE COLUMNS
    await pool.query(`ALTER TABLE recados_anonimos ADD COLUMN IF NOT EXISTS removido BOOLEAN DEFAULT FALSE`);
    await pool.query(`ALTER TABLE recados_anonimos ADD COLUMN IF NOT EXISTS removed_at TIMESTAMP`);

    // Índice pra queries de soft delete serem rápidas
    await pool.query(`CREATE INDEX IF NOT EXISTS recados_anonimos_removido_idx ON recados_anonimos (removido)`);

    // ✨ v2.9 - IDs das mensagens enviadas no WhatsApp (pra remover respondendo a mensagem)
    await pool.query(`ALTER TABLE recados_anonimos ADD COLUMN IF NOT EXISTS msg_ids TEXT[]`);

    colunasOk = true;
    console.log(`✅ [DEBUG] Todas as colunas prontas (código, enviado_teste, removido, removed_at, msg_ids)`);
}

// ============================================
// 🔖 CÓDIGOS DOS RECADOS
// ============================================

// Sorteia um código alfanumérico do tamanho pedido, com letras maiúsculas
// e minúsculas misturadas (ex: VGv78)
function gerarTextoAleatorio(tamanho) {
    let s = '';
    for (let i = 0; i < tamanho; i++) {
        if (randomInt(0, SIMBOLOS_EFETIVOS) < NUMEROS.length) {
            s += NUMEROS[randomInt(0, NUMEROS.length)];
        } else {
            const letra = LETRAS[randomInt(0, LETRAS.length)];
            s += randomInt(0, 2) === 0 ? letra : letra.toLowerCase();
        }
    }
    return s;
}

// Gera um código aleatório que ainda não existe. `usados` guarda os códigos
// em MAIÚSCULAS (a comparação ignora maiúscula/minúscula). O tamanho sobe
// sozinho quando mais da metade das combinações daquele tamanho está ocupada.
function gerarCodigoUnico(usados) {
    let tamanho = TAMANHO_MINIMO;
    while (true) {
        let ocupados = 0;
        for (const c of usados) if (c.length === tamanho) ocupados++;
        if (ocupados < (SIMBOLOS_EFETIVOS ** tamanho) / 2) break;
        tamanho++;
    }
    if (tamanho > TAMANHO_COLUNA) throw new Error('Limite de tamanho de código atingido.');

    while (true) {
        const codigo = gerarTextoAleatorio(tamanho);
        if (!usados.has(codigo.toUpperCase())) {
            usados.add(codigo.toUpperCase());
            return codigo;
        }
    }
}

async function carregarCodigosEmUso() {
    const { rows } = await pool.query(`SELECT codigo FROM recados_anonimos WHERE codigo IS NOT NULL AND removido = FALSE`);
    return new Set(rows.map(r => String(r.codigo).toUpperCase()));
}

// Dá um código aleatório e único pra cada recado que ainda não tem.
// Códigos antigos (01, 02...) continuam valendo.
async function garantirCodigos(recados) {
    const semCodigo = recados.filter(r => !r.codigo);
    if (semCodigo.length === 0) return;

    let usados = await carregarCodigosEmUso();

    for (const recado of semCodigo) {
        let salvo = false;

        for (let tentativa = 1; tentativa <= 5 && !salvo; tentativa++) {
            const codigo = gerarCodigoUnico(usados);
            try {
                // "AND codigo IS NULL": nunca sobrescreve um código já dado por outra execução
                const res = await pool.query(
                    `UPDATE recados_anonimos SET codigo = $1 WHERE id = $2 AND codigo IS NULL`,
                    [codigo, recado.id]
                );

                if (res.rowCount === 0) {
                    // Outra execução já deu código a esse recado: usa o que está no banco
                    const { rows } = await pool.query(
                        `SELECT codigo FROM recados_anonimos WHERE id = $1`, [recado.id]
                    );
                    recado.codigo = rows[0]?.codigo ?? null;
                } else {
                    recado.codigo = codigo;
                    console.log(`🔖 [DEBUG] Recado #${recado.id} recebeu o código ${codigo}`);
                }
                salvo = true;
            } catch (err) {
                if (err.code === '23505') {
                    // Código já foi tomado por outra execução: recarrega e sorteia de novo
                    console.warn(`⚠️  [DEBUG] Código ${codigo} colidiu, sorteando outro...`);
                    usados = await carregarCodigosEmUso();
                } else {
                    throw err;
                }
            }
        }

        if (!salvo) throw new Error(`Não consegui gerar código único para o recado #${recado.id}`);
    }
}

// ✨ v2.8 - SOFT DELETE: marca como removido em vez de deletar
async function removerRecadoPorCodigo(codigo) {
    const { rows } = await pool.query(
        `UPDATE recados_anonimos 
         SET removido = TRUE, 
             removed_at = NOW()
         WHERE UPPER(codigo) = UPPER($1) AND removido = FALSE
         RETURNING id, codigo, numero_destinatario, status`,
        [codigo]
    );
    return rows[0] || null;
}

// ============================================
// ↩️ v2.9 — DESCOBRIR O CÓDIGO PELA MENSAGEM RESPONDIDA
// ============================================

// Guarda no banco os IDs das mensagens que o bot mandou pro WhatsApp (texto/foto/áudio)
async function salvarMsgIds(recadoId, ids) {
    if (!ids || ids.length === 0) return;
    try {
        await pool.query(
            `UPDATE recados_anonimos
             SET msg_ids = COALESCE(msg_ids, ARRAY[]::text[]) || $2::text[]
             WHERE id = $1`,
            [recadoId, ids]
        );
        console.log(`🧷 [DEBUG] Recado #${recadoId}: ${ids.length} ID(s) de mensagem salvo(s)`);
    } catch (err) {
        // Não derruba o envio: no pior caso, esse recado só não poderá ser removido por resposta
        console.error(`⚠️  [DEBUG] Erro ao salvar msg_ids do recado #${recadoId}: ${err.message}`);
    }
}

// Lê o que o admin respondeu: ID da mensagem citada + texto dela
function lerMensagemRespondida(message) {
    const ctx =
        message.message?.extendedTextMessage?.contextInfo ||
        message.message?.imageMessage?.contextInfo ||
        null;

    if (!ctx?.stanzaId) return null;

    const q = ctx.quotedMessage || {};
    const texto =
        q.conversation ||
        q.extendedTextMessage?.text ||
        q.imageMessage?.caption ||
        q.videoMessage?.caption ||
        '';

    return { stanzaId: ctx.stanzaId, texto };
}

// Descobre o código do recado a partir da mensagem que foi respondida.
//  1) pelo ID da mensagem guardado no banco (funciona no principal, mesmo sem código no texto)
//  2) pelo texto citado ("Cód: XXXXX" ou "#rmsn XXXXX") — funciona pra recados antigos do teste
async function descobrirCodigoPelaResposta(message) {
    const resposta = lerMensagemRespondida(message);
    if (!resposta) return null;

    const { rows } = await pool.query(
        `SELECT codigo FROM recados_anonimos WHERE $1 = ANY(msg_ids) AND codigo IS NOT NULL LIMIT 1`,
        [resposta.stanzaId]
    );
    if (rows[0]?.codigo) {
        console.log(`↩️  [DEL] Código ${rows[0].codigo} achado pelo ID da mensagem respondida`);
        return rows[0].codigo;
    }

    const m =
        resposta.texto.match(/C[óo]d:\s*\*?\s*([a-z0-9]{2,})/i) ||
        resposta.texto.match(/#r\s*msn\s*([a-z0-9]{2,})/i);
    if (m) {
        console.log(`↩️  [DEL] Código ${m[1]} achado no texto da mensagem respondida`);
        return m[1];
    }

    return null;
}

// Busca os recados do banco (COM BASE64!)
//  - principal: status = 'pendente' E NOT removido
//  - teste:     status = 'pendente' E ainda não enviado no teste E NOT removido
async function buscarRecados(modoTeste = false) {
    try {
        console.log(`🗄️  [DEBUG] Buscando recados (${modoTeste ? 'pendentes ainda não enviados no teste' : 'só pendentes'})...`);

        const sql = modoTeste
            ? `SELECT * FROM recados_anonimos
               WHERE status = 'pendente' AND enviado_teste IS NOT TRUE AND removido = FALSE
               ORDER BY id ASC`
            : `SELECT * FROM recados_anonimos WHERE status = 'pendente' AND removido = FALSE ORDER BY id ASC`;

        const { rows } = await pool.query(sql);
        console.log(`✅ [DEBUG] ${rows.length} recado(s) encontrado(s)`);

        if (rows.length > 0) {
            const { photo_base64, music_base64, ...resto } = rows[0];
            console.log('📋 [DEBUG] Primeiro recado:', JSON.stringify({
                ...resto,
                photo_base64: photo_base64 ? `[${photo_base64.length} chars]` : null,
                music_base64: music_base64 ? `[${music_base64.length} chars]` : null,
            }, null, 2));
        }
        return rows;
    } catch (err) {
        console.error('❌ [DEBUG] Erro ao buscar recados:', err.message);
        throw err;
    }
}

// Marca um recado como enviado. Tenta 2x pra reduzir o risco de reenvio.
async function marcarComoEnviado(recadoId) {
    for (let tentativa = 1; tentativa <= 2; tentativa++) {
        try {
            await pool.query(
                `UPDATE recados_anonimos SET status = 'enviado' WHERE id = $1`,
                [recadoId]
            );
            console.log(`🗃️  [DEBUG] Recado #${recadoId} marcado como 'enviado' no banco`);
            return;
        } catch (err) {
            console.error(`⚠️  [DEBUG] Erro ao marcar recado #${recadoId} como enviado (tentativa ${tentativa}): ${err.message}`);
            if (tentativa < 2) await esperar(500);
        }
    }
    // Não relança: o recado já foi entregue no WhatsApp. Fica só no log.
    // Se isso falhar, o recado pode ser reenviado na próxima rodada.
}

// 🧪 Marca um recado como enviado NO TESTE (não altera o 'status', então o principal ainda o vê)
async function marcarComoEnviadoTeste(recadoId) {
    for (let tentativa = 1; tentativa <= 2; tentativa++) {
        try {
            await pool.query(
                `UPDATE recados_anonimos SET enviado_teste = TRUE WHERE id = $1`,
                [recadoId]
            );
            console.log(`🧪 [DEBUG] Recado #${recadoId} marcado como enviado no TESTE (status intacto)`);
            return;
        } catch (err) {
            console.error(`⚠️  [DEBUG] Erro ao marcar recado #${recadoId} no teste (tentativa ${tentativa}): ${err.message}`);
            if (tentativa < 2) await esperar(500);
        }
    }
}

// ============================================
// 🖼️ BASE64 PURO — sem download externo!
// ============================================
async function gerarThumbnailDoBase64(base64String, size = 256) {
    try {
        console.log(`🎨 [DEBUG] Gerando thumbnail do base64...`);
        const buffer = Buffer.from(base64String, 'base64');

        try {
            const { Jimp } = await import('jimp');
            const image = await Jimp.read(buffer);
            image.scaleToFit({ w: size, h: size });
            const thumb = await image.getBuffer("image/jpeg");
            console.log(`✅ [DEBUG] Thumbnail gerado: ${thumb.length} bytes`);
            return thumb;
        } catch (jimpErr) {
            console.warn(`⚠️  [DEBUG] Jimp não disponível, enviando sem thumbnail`);
            return null;
        }
    } catch (err) {
        console.error(`❌ [DEBUG] Erro ao gerar thumbnail: ${err.message}`);
        return null;
    }
}

// mostrarCodigoNoTexto: coloca a linha do código DENTRO do recado
// (sempre no grupo de teste; no principal só se a flag estiver ligada)
// ✨ v2.9: devolve a lista de IDs das mensagens enviadas (texto/foto/áudio)
async function enviarRecado(sock, from, recado, mostrarCodigoNoTexto = false) {
    const linhaCodigo = mostrarCodigoNoTexto && recado.codigo
        ? `\n🔖 *Cód: ${recado.codigo}*\n🗑️ _Para remover essa mensagem digite:_ *#rmsn ${recado.codigo}*\n`
        : '';

    const texto = `💌❤️❥❥═══ *RECADINHO DO CORAÇAO* ═══❥❥❤️💌

💌🥰 *Um recado anônimo* *para* @${recado.numero_destinatario}

${recado.content}
${linhaCodigo}
_© damas da night_`;
    const mentions = [`${recado.numero_destinatario}@s.whatsapp.net`];

    const idsEnviados = [];
    const guardarId = (enviada) => {
        if (enviada?.key?.id) idsEnviados.push(enviada.key.id);
    };

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`📤 [RECADO #${recado.id}] Iniciando envio para @${recado.numero_destinatario}`);
    console.log(`${'═'.repeat(60)}`);

    try {
        // 📸 FOTO — Usa Base64 do banco!
        if (recado.photo_base64) {
            console.log(`\n📸 [RECADO #${recado.id}] Processando foto...`);

            try {
                const fotoBuffer = Buffer.from(recado.photo_base64, 'base64');
                console.log(`✅ [RECADO #${recado.id}] Foto do banco: ${fotoBuffer.length} bytes`);

                const thumb = await gerarThumbnailDoBase64(recado.photo_base64, 256);

                console.log(`📨 [RECADO #${recado.id}] Enviando foto...`);
                const enviada = await sock.sendMessage(from, {
                    image: fotoBuffer,
                    caption: texto,
                    mentions,
                    jpegThumbnail: thumb // pode ser null, é ok
                });
                guardarId(enviada);
                console.log(`✅ [RECADO #${recado.id}] Foto enviada com sucesso`);
            } catch (err) {
                console.error(`❌ [RECADO #${recado.id}] Erro ao enviar foto: ${err.message}`);
                console.log(`⚠️  [RECADO #${recado.id}] Enviando só texto...`);
                const enviada = await sock.sendMessage(from, { text: texto, mentions });
                guardarId(enviada);
            }
        } else {
            console.log(`\n📝 [RECADO #${recado.id}] Sem foto, enviando texto puro...`);
            const enviada = await sock.sendMessage(from, { text: texto, mentions });
            guardarId(enviada);
            console.log(`✅ [RECADO #${recado.id}] Texto enviado com sucesso`);
        }

        // 🎵 ÁUDIO — Usa Base64 do banco!
        if (recado.music_base64) {
            console.log(`\n🎵 [RECADO #${recado.id}] Processando áudio...`);
            await esperar(1000);

            try {
                const audioBuffer = Buffer.from(recado.music_base64, 'base64');
                console.log(`✅ [RECADO #${recado.id}] Áudio do banco: ${audioBuffer.length} bytes`);

                console.log(`📨 [RECADO #${recado.id}] Enviando áudio...`);
                const enviada = await sock.sendMessage(from, {
                    audio: audioBuffer,
                    mimetype: 'audio/mpeg',
                    ptt: false
                });
                guardarId(enviada);
                console.log(`✅ [RECADO #${recado.id}] Áudio enviado com sucesso`);
            } catch (err) {
                console.error(`❌ [RECADO #${recado.id}] Erro ao enviar áudio: ${err.message}`);
                console.log(`⚠️  [RECADO #${recado.id}] Áudio com problemas`);
            }
        }

        console.log(`\n✅ [RECADO #${recado.id}] FINALIZADO COM SUCESSO\n`);
        return idsEnviados;

    } catch (err) {
        console.error(`\n❌ [RECADO #${recado.id}] ERRO CRÍTICO: ${err.message}`);
        console.error(`Stack: ${err.stack}\n`);
        throw err; // repassa pro loop, pra NÃO marcar como enviado se algo crítico falhou
    }
}

// ============================================
// 🗑️ REMOVER RECADO (soft delete)
//   • respondendo a mensagem do recado:  #rmsn   |   #r msn
//   • digitando o código:                #rmsn VGv78 | #rmsnVGv78 | #r msn VGv78
// ============================================
async function handleDelRecado(sock, message, from, codigoDigitado) {
    // Só age nos grupos liberados. Em qualquer outro grupo ignora em silêncio
    // (assim não atrapalha algum outro comando #rmsn que exista no bot).
    const grupoPermitido = GRUPOS_TESTE.includes(from) || from === GRUPO_PRINCIPAL;
    if (!grupoPermitido) return false;

    const senderId = resolverSenderId(message);

    const ehAdmin = await verificarSeEhAdmin(sock, from, message, senderId);
    if (!ehAdmin) {
        console.log(`❌ ${senderId} não é admin, rejeitando #rmsn`);
        await enviar(sock, from, {
            text: '🚫 Esse comando é exclusivo para administradores do grupo.',
            mentions: [senderId]
        }, message);
        return true;
    }

    try {
        await garantirColunas();

        // Código digitado tem prioridade. Se não digitou, tenta pela mensagem respondida.
        let codigo = codigoDigitado;

        if (!codigo) {
            codigo = await descobrirCodigoPelaResposta(message);

            if (!codigo) {
                const respondeu = !!lerMensagemRespondida(message);
                console.log(`🔎 [DEL] Sem código digitado e ${respondeu ? 'não consegui achar o recado da mensagem respondida' : 'nenhuma mensagem respondida'}`);
                await enviar(sock, from, {
                    text: respondeu
                        ? '❓ Não consegui identificar o recado dessa mensagem.\nResponda a mensagem *do recado* com *#rmsn* ou digite *#rmsn CÓDIGO*.'
                        : '↩️ Responda a mensagem do recado com *#rmsn* (ou digite *#rmsn CÓDIGO*).',
                    mentions: [senderId]
                }, message);
                return true;
            }
        }

        const removido = await removerRecadoPorCodigo(codigo);

        if (!removido) {
            console.log(`🔎 [DEL] Nenhum recado ativo com o código ${codigo}`);
            await enviar(sock, from, {
                text: `❓ Não achei nenhum recado ativo com o código *${codigo}*.`,
                mentions: [senderId]
            }, message);
            return true;
        }

        console.log(`🗑️  [DEL] Recado #${removido.id} (código ${codigo}, status ${removido.status}) marcado como removido por ${senderId}`);
        await enviar(sock, from, {
            text: `╭━━〔 🗑️ 𝐑𝐄𝐂𝐀𝐃𝐎 𝐑𝐄𝐌𝐎𝐕𝐈𝐃𝐎 〕━━╮

🚫 O recado *${removido.codigo || codigo}* foi removido
por conter conteúdo inadequado.

🛡️ 𝐌𝐨𝐝𝐞𝐫𝐚𝐜̧𝐚̃𝐨 𝐃𝐚𝐦𝐚𝐬 𝐝𝐚 𝐍𝐢𝐠𝐡𝐭

╰━━━━━━━━━━━━━━━━━━━━╯`,
            mentions: [senderId]
        }, message);
    } catch (err) {
        console.error('❌ [DEL] Erro ao remover recado:', err.message);
        await enviar(sock, from, {
            text: `❌ Erro ao remover o recado: ${err.message}`,
            mentions: [senderId]
        }, message);
    }

    return true;
}

export async function handleRecadosAnonimosCommand(sock, message, from) {
    const content =
        message.message?.conversation ||
        message.message?.extendedTextMessage?.text || '';

    // 🗑️ #rmsn  (respondendo o recado)  |  #rmsn VGv78  |  #rmsnVGv78  |  #r msn VGv78
    // O código é OPCIONAL: sem ele, o bot descobre pela mensagem respondida.
    const matchDel = content.trim().match(/^#r\s*msn(?:\s*([a-z0-9]{2,}))?$/i);
    if (matchDel) {
        return await handleDelRecado(sock, message, from, matchDel[1] || null);
    }

    if (!/^#msn$/i.test(content.trim())) return false;

    // 🧪 Grupo de teste? (funciona igual ao principal, mas mostra o código no recado)
    const modoTeste = GRUPOS_TESTE.includes(from);

    // 🔖 Código DENTRO do texto do recado: sempre no teste; no principal só se a flag estiver ligada.
    const mostrarCodigoNoTexto = modoTeste || MOSTRAR_CODIGO_NO_PRINCIPAL;

    console.log(`\n${'█'.repeat(60)}`);
    console.log(`█ COMANDO #MSN DETECTADO`);
    console.log(`█ Grupo: ${from}`);
    console.log(`█ Versão: 2.9 (BASE64 + STATUS + CÓDIGO + SOFT DELETE + REMOVER POR RESPOSTA)`);
    console.log(`█ Modo: ${modoTeste ? '🧪 TESTE (pendentes ainda não vistos no teste, marca enviado_teste, mostra código)' : '🚀 NORMAL (só pendentes, marca como enviado)'}`);
    console.log(`${'█'.repeat(60)}\n`);

    // 🚫 Só funciona no grupo de teste e no grupo principal
    const grupoPermitido = modoTeste || from === GRUPO_PRINCIPAL;

    if (!grupoPermitido) {
        console.log(`🚫 Grupo ${from} não está autorizado para o #msn, ignorando`);
        await enviar(sock, from, {
            text: '🚫 Esse comando não está liberado para este grupo.'
        }, message);
        return true;
    }

    const senderId = resolverSenderId(message);

    // 🔒 Apenas administradores podem disparar
    const ehAdmin = await verificarSeEhAdmin(sock, from, message, senderId);

    if (!ehAdmin) {
        console.log(`❌ ${senderId} não é admin, rejeitando comando`);
        await enviar(sock, from, {
            text: '🚫 Esse comando é exclusivo para administradores do grupo.',
            mentions: [senderId]
        }, message);
        return true;
    }

    // 🔒 Já tem um #msn rodando neste grupo? Não deixa começar outro.
    if (emExecucao.has(from)) {
        console.log(`⏳ #msn já está em andamento em ${from}, ignorando`);
        await enviar(sock, from, {
            text: '⏳ Já tem um envio de recados em andamento. Aguarde terminar.',
            mentions: [senderId]
        }, message);
        return true;
    }
    emExecucao.add(from);

    try {
        console.log(`✅ ${senderId} é admin, prosseguindo...\n`);

        await garantirColunas();

        const recados = await buscarRecados(modoTeste);

        if (recados.length === 0) {
            console.log(`📭 Nenhum recado pendente encontrado`);
            await enviar(sock, from, {
                text: '📭 Nenhum recado anônimo pendente.',
                mentions: [senderId]
            }, message);
            return true;
        }

        // 🔖 Garante que todo recado desta rodada tenha um código
        await garantirCodigos(recados);

        console.log(`\n${'█'.repeat(60)}`);
        console.log(`█ INICIANDO ENVIO DE ${recados.length} RECADO(S) PENDENTE(S)`);
        console.log(`█ ⚡ MODO RÁPIDO: Base64 do banco (SEM DOWNLOADS!)`);
        console.log(`${'█'.repeat(60)}\n`);

        // Aviso inicial IGUAL nos dois grupos
        await enviar(sock, from, {
            text: `📬 Enviando ${recados.length} recado(s)...\n⏳ Aguarde...`,
            mentions: [senderId]
        }, message);

        let enviados = 0;
        let falhados = 0;
        const erros = [];

        const tempoInicio = Date.now();

        for (let i = 0; i < recados.length; i++) {
            const recado = recados[i];
            try {
                console.log(`\n[${i + 1}/${recados.length}] Processando recado #${recado.id} (código ${recado.codigo})...`);
                const idsEnviados = await enviarRecado(sock, from, recado, mostrarCodigoNoTexto);
                enviados++;

                // ✨ v2.9: guarda os IDs das mensagens enviadas (permite remover respondendo a mensagem)
                await salvarMsgIds(recado.id, idsEnviados);

                // Marca SÓ depois do envio ter dado certo:
                //  - teste:     marca enviado_teste (o principal continua vendo como pendente)
                //  - principal: marca status = 'enviado'
                if (modoTeste) {
                    await marcarComoEnviadoTeste(recado.id);
                } else {
                    await marcarComoEnviado(recado.id);
                }
            } catch (err) {
                console.error(`❌ [HANDLER] Erro ao enviar recado #${recado.id}: ${err.message}`);
                falhados++;
                erros.push(`#${recado.id}: ${err.message}`);
                // Não marca como enviado — continua com o status atual pra ser
                // tentado de novo na próxima rodada do #msn.
            }
            // Delay entre recados
            if (i < recados.length - 1) {
                console.log(`⏱️  Aguardando 1.2s antes do próximo recado...`);
                await esperar(1200);
            }
        }

        const tempoTotal = ((Date.now() - tempoInicio) / 1000).toFixed(2);

        console.log(`\n${'█'.repeat(60)}`);
        console.log(`█ RESUMO DO ENVIO`);
        console.log(`█ ✅ Enviados: ${enviados}`);
        console.log(`█ ❌ Falhados: ${falhados}`);
        console.log(`█ Total: ${recados.length}`);
        console.log(`█ ⏱️  Tempo: ${tempoTotal}s`);
        console.log(`${'█'.repeat(60)}\n`);

        // Só avisa no grupo se algum recado falhou.
        if (falhados > 0) {
            await sock.sendMessage(from, {
                text: `⚠️ ${falhados} recado(s) não foram enviados e continuam pendentes. Rode #msn de novo pra tentar outra vez.\n${erros.map(e => `• ${e}`).join('\n')}`,
                mentions: [senderId]
            });
        }

    } catch (err) {
        console.error('❌ [RECADOS] Erro geral:', err.message);
        console.error('Stack:', err.stack);
        await enviar(sock, from, {
            text: `❌ Erro ao enviar recados: ${err.message}\n\nTenta de novo.`,
            mentions: [senderId]
        }, message);
    } finally {
        // 🔓 Sempre libera a trava, mesmo se der erro
        emExecucao.delete(from);
    }

    return true;
}