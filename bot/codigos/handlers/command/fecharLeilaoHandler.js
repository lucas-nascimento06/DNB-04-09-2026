// ARQUIVO: bot/codigos/handlers/command/fecharLeilaoHandler.js
// (mesma pasta onde já ficam leilaoHandler.js, lanceHandler.js, etc.)
//
// #fecharleilao / #fl — Admin, em qualquer lugar do grupo.
//
// 🆕 NOVO COMPORTAMENTO: o #fl NÃO PEDE CONFIRMAÇÃO e NÃO MEXE EM CASAL.
//
// ÚNICA forma de uso:
//
//   "#fl" (ou "#fecharleilao"), sozinho, sem reply e sem código
//   -> fecha e apaga DE UMA VEZ, sem pedir confirmação, TODOS os leilões
//      (abertos e arrematados) desse grupo. Não precisa marcar ninguém,
//      não precisa responder nenhuma postagem, não precisa informar código.
//
// O #fl SÓ apaga os registros do leilão (damas_dc_leiloes, damas_dc_lances,
// damas_dc_leiloes_mensagens). Ele NÃO libera casal nenhum, mesmo que algum
// leilão já esteja 'arrematado'. Pra isso existe o comando separado #dcasal
// (liberação de casal), que roda sem precisar marcar nada — ver
// dcasalHandler.js.
//
// A transferência de DC + formação/bloqueio do casal continuam acontecendo
// SOMENTE em #arrematar (arrematarHandler.js) ou no fechamento automático
// ao bater o valor máximo (lanceHandler.js, que reaproveita a mesma lógica).

import pool from '../../../../db.js';
import { anunciosCache } from './leilaoCache.js';

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
        console.error('[fecharLeilaoHandler] Erro ao checar admin:', err.message);
        return false;
    }
}

// Apaga tudo relacionado ao leilão: lances -> mensagens vinculadas -> o próprio leilão.
// Precisa apagar as tabelas filhas primeiro por causa de FOREIGN KEY (leilao_id).
async function apagarLeilaoCompleto(client, leilaoId) {
    await client.query(`DELETE FROM damas_dc_lances WHERE leilao_id = $1`, [leilaoId]);
    await client.query(`DELETE FROM damas_dc_leiloes_mensagens WHERE leilao_id = $1`, [leilaoId]);
    await client.query(`DELETE FROM damas_dc_leiloes WHERE id = $1`, [leilaoId]);
}

// content = texto da mensagem, ex: "#fecharleilao" ou "#fl"
export async function handleFecharLeilaoCommand(sock, message, content) {
    const from = message.key.remoteJid;
    if (!from.endsWith('@g.us')) return false;

    const match = content.match(/^#(?:fecharleilao|fl)\b/i);
    if (!match) return false;

    const remetenteCompleto = getNumeroReal(message);
    const adminId = extractDigits(remetenteCompleto);

    const ehAdmin = await isAdmin(sock, from, adminId);
    if (!ehAdmin) {
        await sock.sendMessage(from, {
            text: '🚫 Só administradores podem fechar leilões.'
        }, { quoted: message });
        return true;
    }

    // ========================================================
    // Fecha e apaga tudo do grupo NA HORA, sem pedir confirmação.
    // ========================================================
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const leiloesResult = await client.query(
            `SELECT * FROM damas_dc_leiloes
             WHERE grupo_id = $1 AND status IN ('aberto', 'arrematado')
             FOR UPDATE`,
            [from]
        );

        if (leiloesResult.rowCount === 0) {
            await client.query('ROLLBACK');
            await sock.sendMessage(from, {
                text: '✅ Já está tudo limpo por aqui. Pode chamar o próximo leilão!'
            }, { quoted: message });
            return true;
        }

        for (const leilao of leiloesResult.rows) {
            await apagarLeilaoCompleto(client, leilao.id);
            anunciosCache.delete(leilao.id);
        }

        await client.query('COMMIT');

        await sock.sendMessage(from, {
            text: `🗑️ *${leiloesResult.rowCount} leilão(ões) fechado(s) e removido(s)!*\n\n` +
                  `✅ Pronto pra começar o próximo leilao.`
        }, { quoted: message });

        return true;

    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('[handleFecharLeilaoCommand] Erro ao fechar leilões:', err.message);
        await sock.sendMessage(from, {
            text: '❌ Erro ao fechar os leilões. Tente novamente.'
        }, { quoted: message });
        return true;
    } finally {
        client.release();
    }
}