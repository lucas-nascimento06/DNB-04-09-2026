// ARQUIVO: bot/codigos/handlers/command/bancoHandler.js
// 🏦 Banco Damas — #saldo e #ricos (top 7)

import pool from '../../../../db.js';
import { flushDC } from '../../features/dcTracker.js';

const MEDALHAS = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣'];
const TOP_MILIONARIOS = 7;

// ---------------------------------------------------------------
// Utilitários (mesmos padrões do pixHandler / rankdamasHandler)
// ---------------------------------------------------------------
function extractDigits(number) {
    if (!number) return null;
    return number.replace(/@.*$/, '').replace(/\D/g, '');
}

function getNumeroReal(message) {
    if (message.key.participantAlt) return message.key.participantAlt;
    if (message.key.participant) return message.key.participant;
    return message.key.remoteJid;
}

function digitos(id = '') {
    return id.replace(/[:@].*$/, '').replace(/\D/g, '');
}

function resolverJidLimpo(m) {
    if (m.participantAlt && m.participantAlt.endsWith('@s.whatsapp.net')) {
        return m.participantAlt.replace('@s.whatsapp.net', '');
    }
    if (m.participant && m.participant.endsWith('@s.whatsapp.net')) {
        return m.participant.replace('@s.whatsapp.net', '');
    }
    return m.phoneNumber ?? digitos(m.id);
}

const fmtDC = (n) => Number(n || 0).toLocaleString('pt-BR');

// ---------------------------------------------------------------
// #saldo
// ---------------------------------------------------------------
export async function saldoHandler(sock, message) {
    const from = message.key.remoteJid;
    try {
        await flushDC();
        const userId = extractDigits(getNumeroReal(message));

        const res = await pool.query(
            `SELECT saldo FROM damas_dc_wallets WHERE user_id = $1`,
            [userId]
        );
        const saldo = Number(res.rows[0]?.saldo || 0);

        await sock.sendMessage(from, {
            text:
                `💸⃤ *BANCO DAMAS* 💲💸\n\n` +
                `💰 Seu saldo: *${fmtDC(saldo)} DCs*\n\n` +
                `🔑 *#gpix* — sua chave PIX`
        }, { quoted: message });
    } catch (err) {
        console.error('[saldoHandler] Erro:', err.message);
        await sock.sendMessage(from, { text: '❌ Erro ao consultar seu saldo.' }, { quoted: message });
    }
}

// ---------------------------------------------------------------
// #milionarios  →  top 7 maiores saldos (do grupo onde foi pedido)
// Formato: DAMAS RICH CLUB
// ---------------------------------------------------------------
export async function milionariosHandler(sock, message) {
    const from = message.key.remoteJid;
    try {
        await flushDC();

        // A carteira é global (não guarda grupo), então filtramos pelos
        // membros do grupo atual para o ranking ser "do grupo".
        let membros = null;
        if (from.endsWith('@g.us')) {
            try {
                const meta = await sock.groupMetadata(from);
                membros = new Set(meta.participants.map(resolverJidLimpo));
            } catch (e) {
                console.warn('[milionariosHandler] Sem metadados do grupo, usando ranking geral:', e.message);
            }
        }

        const res = await pool.query(
            `SELECT user_id, saldo
               FROM damas_dc_wallets
              WHERE saldo > 0
           ORDER BY saldo DESC
              LIMIT 300`
        );

        let lista = res.rows;
        if (membros) {
            const doGrupo = lista.filter(r => membros.has(r.user_id));
            if (doGrupo.length) {
                lista = doGrupo;
            } else if (lista.length) {
                console.warn('[milionariosHandler] Nenhuma carteira bateu com os membros do grupo; usando ranking geral.');
            }
        }
        lista = lista.slice(0, TOP_MILIONARIOS);

        if (!lista.length) {
            await sock.sendMessage(from, {
                text: '💸⃤ *BANCO DAMAS* 💲💸\n\n📭 Ainda não há milionários por aqui.'
            }, { quoted: message });
            return;
        }

        const mentions = [];
        const linhas = lista.map((r, i) => {
            mentions.push(`${r.user_id}@s.whatsapp.net`);
            return `${MEDALHAS[i]} @${r.user_id} ━━ ${fmtDC(r.saldo)} DCs`;
        });

        const texto =
`𓆩 ♛ 💎 𝐃𝐀𝐌𝐀𝐒 𝐑𝐈𝐂𝐇 𝐂𝐋𝐔𝐁 💎 ♛ 𓆪
　　　 💵 𝑳𝒖𝒙𝒐 • 𝑷𝒐𝒅𝒆𝒓 • 𝑹𝒊𝒒𝒖𝒆𝒛𝒂 💰
　　　　　💸 🤑 💲 ✨

👑 *RANKING DOS MILIONÁRIOS* 👑

${linhas.join('\n')}

╰━━━ 🏦 BANCO DAMAS 🏦 ━━━╯
💸 Riqueza em movimento 💸
\u200E☘️ ܁˖ 𝟕𝟕𝟕 ˗ˋˏ💰ˎˊ˗`;

        await sock.sendMessage(from, { text: texto, mentions }, { quoted: message });
    } catch (err) {
        console.error('[milionariosHandler] Erro:', err.message);
        await sock.sendMessage(from, { text: '❌ Erro ao gerar o ranking.' }, { quoted: message });
    }
}