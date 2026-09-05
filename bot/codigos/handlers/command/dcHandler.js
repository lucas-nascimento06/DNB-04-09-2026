// ARQUIVO: bot/codigos/handlers/command/dcHandler.js

import pool from '../../../../db.js';
import { flushDC } from '../../features/dcTracker.js';

function extractDigits(number) {
    if (!number) return null;
    return number.replace(/@.*$/, '').replace(/\D/g, '');
}

function getNumeroReal(message) {
    if (message.key.participantAlt) return message.key.participantAlt;
    if (message.key.participant) return message.key.participant;
    return message.key.remoteJid;
}

export async function dcHandler(sock, message) {
    const from = message.key.remoteJid;
    try {
        // Garante que qualquer DC ganho recentemente (ainda no buffer, aguardando
        // o flush periódico de 30s) já esteja gravado antes de mostrar o saldo.
        // Isso evita a pessoa achar que "não está contando" quando na real só
        // está aguardando o próximo ciclo de gravação em lote.
        await flushDC();

        const numeroCompleto = getNumeroReal(message);
        const userId = extractDigits(numeroCompleto);

        const result = await pool.query(
            `SELECT saldo FROM damas_dc_wallets WHERE user_id = $1`,
            [userId]
        );

        const saldo = Number(result.rows[0]?.saldo || 0);
        const saldoFormatado = saldo.toLocaleString('pt-BR');

        const texto = `💰 *CARTEIRA VIRTUAL DO DAMAS* 💲💸
🪙 Você possui *${saldoFormatado} DC* — Damas Coins
━━━━━━━━━━━━━━━━━━
🏦 Moeda oficial do Grupo Damas

🎴 Com seus DC você pode:
🔨 Participar dos leilões
🎴 Comprar figurinhas
💸 Transferir para amigos
🎁 Enviar DC durante os leilões

🤑 Junte seus DC e torne-se o Tio Patinhas do Damas!`;

        await sock.sendMessage(from, {
            text: texto
        }, { quoted: message });
    } catch (err) {
        console.error('[dcHandler] Erro:', err.message);
        await sock.sendMessage(from, { text: '❌ Erro ao consultar seu saldo de DC.' });
    }
}