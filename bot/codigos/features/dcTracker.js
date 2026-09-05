import pool from '../../../db.js';

const DC_POR_MENSAGEM = 1; // ajuste aqui quanto vale cada mensagem

// 🎯 Só esse grupo conta DC. Mensagens de qualquer outro grupo são ignoradas.
const GRUPO_PRINCIPAL = '120363413774574277@g.us';

const processedDC = new Set();
const CACHE_LIMIT = 200;

// ⚙️ Configuração do batching
const FLUSH_INTERVAL_MS = 30 * 1000; // escreve no banco a cada 30s
const FLUSH_MAX_BUFFER = 50;         // ou antes, se acumular 50 mensagens

// Buffer em memória com as mensagens pendentes de gravar
let pendingBuffer = [];
let flushing = false;

const TIPOS_VALIDOS = new Set([
    'conversation', 'extendedTextMessage', 'imageMessage', 'videoMessage',
    'stickerMessage', 'audioMessage', 'voiceMessage', 'ptvMessage',
    'documentMessage', 'documentWithCaptionMessage', 'gifMessage',
]);

function extractDigits(number) {
    if (!number) return null;
    return number.replace(/@.*$/, '').replace(/\D/g, '');
}

function isProcessed(key) {
    const id = `${key.remoteJid}_${key.id}`;
    if (processedDC.has(id)) return true;
    processedDC.add(id);
    if (processedDC.size > CACHE_LIMIT) {
        const it = processedDC.values();
        for (let i = 0; i < processedDC.size - CACHE_LIMIT; i++) processedDC.delete(it.next().value);
    }
    return false;
}

function desembrulhar(msg) {
    if (msg?.ephemeralMessage?.message) return desembrulhar(msg.ephemeralMessage.message);
    if (msg?.viewOnceMessage?.message) return desembrulhar(msg.viewOnceMessage.message);
    if (msg?.viewOnceMessageV2?.message) return desembrulhar(msg.viewOnceMessageV2.message);
    if (msg?.editedMessage?.message) return desembrulhar(msg.editedMessage.message);
    return msg;
}

function getTipo(msg) {
    for (const tipo of Object.keys(msg)) {
        if (TIPOS_VALIDOS.has(tipo)) return tipo;
    }
    return null;
}

function getNumeroReal(message) {
    if (message.key.participantAlt) return message.key.participantAlt;
    if (message.key.participant) return message.key.participant;
    return null;
}

/**
 * Chamada a cada mensagem recebida. Agora NÃO bate no banco diretamente —
 * só valida e empilha no buffer em memória. A escrita real acontece no flush.
 */
export async function trackDC(sock, message) {
    try {
        // 🎯 Só conta DC se a mensagem for do grupo principal
        if (message?.key?.remoteJid !== GRUPO_PRINCIPAL) return;
        if (message.key.fromMe) return;
        if (isProcessed(message.key)) return;

        let msg = message.message;
        if (!msg) return;
        msg = desembrulhar(msg);
        if (!msg) return;

        const tipo = getTipo(msg);
        if (!tipo) return;

        const numeroCompleto = getNumeroReal(message);
        if (!numeroCompleto) return;
        const numeroLimpo = extractDigits(numeroCompleto);
        if (!numeroLimpo || numeroLimpo.length < 10) return;

        const grupoId = message.key.remoteJid;
        const messageId = message.key.id;

        pendingBuffer.push({
            grupoId,
            userId: numeroLimpo,
            messageId,
            tipo,
            dcGanho: DC_POR_MENSAGEM,
        });

        console.log(`🧾 [DC] Enfileirado +${DC_POR_MENSAGEM} DC para ${numeroLimpo} (buffer: ${pendingBuffer.length})`);

        if (pendingBuffer.length >= FLUSH_MAX_BUFFER) {
            flushDC().catch(err => console.error('[trackDC] Erro no flush por limite:', err.message));
        }
    } catch (err) {
        console.error('[trackDC] Erro:', err.message);
    }
}

/**
 * Escreve todo o buffer acumulado no banco em duas queries em lote,
 * não importa quantas mensagens tenham se acumulado.
 */
export async function flushDC() {
    if (flushing) return;
    if (pendingBuffer.length === 0) return;

    flushing = true;
    const batch = pendingBuffer;
    pendingBuffer = [];

    try {
        const values = [];
        const placeholders = batch.map((item, i) => {
            const base = i * 5;
            values.push(item.grupoId, item.userId, item.messageId, item.tipo, item.dcGanho);
            return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`;
        }).join(', ');

        const insertResult = await pool.query(
            `INSERT INTO damas_dc_messages (grupo_id, user_id, message_id, tipo, dc_ganho)
             VALUES ${placeholders}
             ON CONFLICT (grupo_id, message_id) DO NOTHING
             RETURNING user_id, dc_ganho`,
            values
        );

        if (insertResult.rowCount === 0) {
            console.log(`💾 [DC] Flush: 0 mensagens novas de um lote de ${batch.length} (todas já contadas)`);
            return;
        }

        const ganhosPorUsuario = new Map();
        for (const row of insertResult.rows) {
            const atual = ganhosPorUsuario.get(row.user_id) || 0;
            ganhosPorUsuario.set(row.user_id, atual + Number(row.dc_ganho));
        }

        const walletValues = [];
        const walletPlaceholders = [...ganhosPorUsuario.entries()].map(([userId, ganho], i) => {
            const base = i * 2;
            walletValues.push(userId, ganho);
            return `($${base + 1}, $${base + 2})`;
        }).join(', ');

        await pool.query(
            `INSERT INTO damas_dc_wallets (user_id, saldo)
             VALUES ${walletPlaceholders}
             ON CONFLICT (user_id)
             DO UPDATE SET saldo = damas_dc_wallets.saldo + EXCLUDED.saldo, atualizado_em = NOW()`,
            walletValues
        );

        console.log(`💰 [DC] Flush concluído: ${insertResult.rowCount} mensagens novas, ${ganhosPorUsuario.size} usuário(s) atualizado(s)`);
    } catch (err) {
        console.error('[flushDC] Erro:', err.message);
        pendingBuffer = batch.concat(pendingBuffer);
    } finally {
        flushing = false;
    }
}

setInterval(() => {
    flushDC().catch(err => console.error('[trackDC] Erro no flush periódico:', err.message));
}, FLUSH_INTERVAL_MS);

async function flushOnExit() {
    if (pendingBuffer.length === 0) return;
    console.log(`🛑 [DC] Encerrando: gravando ${pendingBuffer.length} mensagem(ns) pendente(s) antes de sair...`);
    await flushDC();
}

process.on('SIGINT', async () => { await flushOnExit(); process.exit(0); });
process.on('SIGTERM', async () => { await flushOnExit(); process.exit(0); });