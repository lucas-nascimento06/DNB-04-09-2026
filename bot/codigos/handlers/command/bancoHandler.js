// ARQUIVO: bot/codigos/handlers/command/bancoHandler.js
// 🏦 Banco Damas — #saldo, #extrato e #milionarios (top 7)

import pool from '../../../../db.js';
import { flushDC } from '../../features/dcTracker.js';
import { generateWAMessageFromContent, proto } from '@whiskeysockets/baileys';

const MEDALHAS = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣'];
const TOP_MILIONARIOS = 7;
const MAX_BOTOES_COPIAR = 5;

/**
 * Envia texto com botões "Copiar" (um por chave PIX única).
 * Cada item de `chaves` é { n, chave, outro }.
 * Se o envio interativo falhar, manda o texto normal.
 */
async function enviarComBotoesCopiar(sock, from, quoted, texto, mentions, chaves) {
    try {
        const buttons = chaves.map(({ n, chave, outro }) => ({
            name: 'cta_copy',
            buttonParamsJson: JSON.stringify({
                display_text: chaves.length > 1
                    ? `📋 Copiar pix de ${String(outro).slice(-4)}`
                    : '📋 Copiar chave',
                id: `copiar_pix_${n}`,
                copy_code: chave
            })
        }));

        const msg = generateWAMessageFromContent(from, {
            viewOnceMessage: {
                message: {
                    messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2 },
                    interactiveMessage: proto.Message.InteractiveMessage.create({
                        body: proto.Message.InteractiveMessage.Body.create({ text: texto }),
                        contextInfo: { mentionedJid: mentions },
                        nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({ buttons })
                    })
                }
            }
        }, quoted ? { quoted } : {});

        await sock.relayMessage(from, msg.message, {
            messageId: msg.key.id,
            additionalNodes: [{
                tag: 'biz',
                attrs: {},
                content: [{
                    tag: 'interactive',
                    attrs: { type: 'native_flow', v: '1' },
                    content: [{ tag: 'native_flow', attrs: { v: '9', name: 'mixed' } }]
                }]
            }]
        });
    } catch (e) {
        console.error('[extratoHandler] Botões copiar falharam, usando texto:', e.message);
        await sock.sendMessage(from, { text: texto, mentions }, quoted ? { quoted } : {});
    }
}

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

function fmtData(d) {
    return new Date(d).toLocaleString('pt-BR', {
        timeZone: 'America/Fortaleza',
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// ---------------------------------------------------------------
// Tabela do extrato (criada automaticamente, uma vez)
// ---------------------------------------------------------------
let tabelaOk = false;
export async function garantirTabelaExtrato() {
    if (tabelaOk) return;
    await pool.query(`
        CREATE TABLE IF NOT EXISTS damas_pix_extrato (
            id        BIGSERIAL PRIMARY KEY,
            de_user   TEXT NOT NULL,
            para_user TEXT NOT NULL,
            valor     NUMERIC NOT NULL,
            criado_em TIMESTAMPTZ DEFAULT NOW()
        )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_pix_extrato_de   ON damas_pix_extrato (de_user, criado_em DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_pix_extrato_para ON damas_pix_extrato (para_user, criado_em DESC)`);
    tabelaOk = true;
}

/**
 * Registra uma transferência no extrato.
 * Chamar DENTRO da transação do #enviar, passando o `client` da transação,
 * para que o extrato só seja gravado se o COMMIT acontecer.
 */
export async function registrarExtrato(client, de, para, valor) {
    await client.query(
        `INSERT INTO damas_pix_extrato (de_user, para_user, valor) VALUES ($1, $2, $3)`,
        [de, para, valor]
    );
}

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
                `📄 *#extrato* — suas últimas movimentações\n` +
                `🔑 *#pix* — sua chave PIX`
        }, { quoted: message });
    } catch (err) {
        console.error('[saldoHandler] Erro:', err.message);
        await sock.sendMessage(from, { text: '❌ Erro ao consultar seu saldo.' }, { quoted: message });
    }
}

// ---------------------------------------------------------------
// #extrato  →  últimas 10 transferências PIX (enviadas e recebidas)
// Tudo em UMA mensagem (cabeçalho + movimentações + botões copiar)
// - A chave PIX aparece escrita só na 1ª vez que cada pessoa surge
// - Os botões "Copiar" são deduplicados por chave
// ---------------------------------------------------------------
export async function extratoHandler(sock, message) {
    const from = message.key.remoteJid;
    try {
        await garantirTabelaExtrato();
        await flushDC();
        const userId = extractDigits(getNumeroReal(message));

        const saldoRes = await pool.query(
            `SELECT saldo FROM damas_dc_wallets WHERE user_id = $1`,
            [userId]
        );
        const saldo = Number(saldoRes.rows[0]?.saldo || 0);

        const res = await pool.query(
            `SELECT e.de_user, e.para_user, e.valor, e.criado_em,
                    kd.chave AS chave_de,
                    kp.chave AS chave_para
               FROM damas_pix_extrato e
          LEFT JOIN damas_pix_keys kd ON kd.user_id = e.de_user
          LEFT JOIN damas_pix_keys kp ON kp.user_id = e.para_user
              WHERE e.de_user = $1 OR e.para_user = $1
           ORDER BY e.criado_em DESC
              LIMIT 10`,
            [userId]
        );

        const cabecalho = `💸⃤  *BANCO DAMAS — EXTRATO* 💰\n\n💰 Saldo atual: *${fmtDC(saldo)} DCs*`;

        if (!res.rows.length) {
            await sock.sendMessage(from, {
                text: `${cabecalho}\n\n📭 Nenhuma transferência PIX registrada ainda.`
            }, { quoted: message });
            return;
        }

        const mentions = [];
        const chavesUnicas = new Map();   // chave -> { chave, outro }
        const chavesMostradas = new Set(); // chaves já escritas no texto

        const blocos = res.rows.map((r, i) => {
            const n = i + 1;
            const entrou = r.para_user === userId;
            const outro = entrou ? r.de_user : r.para_user;
            const chaveOutro = entrou ? r.chave_de : r.chave_para;

            const jid = `${outro}@s.whatsapp.net`;
            if (!mentions.includes(jid)) mentions.push(jid);

            // guarda só a primeira ocorrência de cada chave (para os botões)
            if (chaveOutro && !chavesUnicas.has(chaveOutro)) {
                chavesUnicas.set(chaveOutro, { chave: chaveOutro, outro });
            }

            let bloco = `*${n}.* ` + (entrou ? `🟢 ➕ *${fmtDC(r.valor)} DCs*\n` : `🔴 ➖ *${fmtDC(r.valor)} DCs*\n`);
            bloco += entrou ? `⠀⠀⠀ 👤 de @${outro}\n` : `⠀⠀⠀ 👤 para @${outro}\n`;

            // escreve a chave só na primeira vez que ela aparece
            if (chaveOutro && !chavesMostradas.has(chaveOutro)) {
                bloco += `⠀⠀⠀ 🔑 pix : ${chaveOutro}\n`;
                chavesMostradas.add(chaveOutro);
            }

            bloco += `⠀⠀⠀ 🕒 ${fmtData(r.criado_em)}`;
            return bloco;
        });

        const chaves = [...chavesUnicas.values()]
            .slice(0, MAX_BOTOES_COPIAR)
            .map((c, idx) => ({ n: idx + 1, chave: c.chave, outro: c.outro }));

        const texto =
            `${cabecalho}\n\n` +
            `📄 *Últimas ${res.rows.length} movimentações:*\n\n` +
            blocos.join('\n\n');

        if (chaves.length) {
            await enviarComBotoesCopiar(sock, from, message, texto, mentions, chaves);
        } else {
            await sock.sendMessage(from, { text: texto, mentions }, { quoted: message });
        }
    } catch (err) {
        console.error('[extratoHandler] Erro:', err.message);
        await sock.sendMessage(from, { text: '❌ Erro ao gerar seu extrato.' }, { quoted: message });
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