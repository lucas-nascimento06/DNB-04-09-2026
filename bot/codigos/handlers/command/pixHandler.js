// ARQUIVO: bot/codigos/handlers/command/pixHandler.js

import pool from '../../../../db.js';
import { flushDC } from '../../features/dcTracker.js';
import { generateWAMessageFromContent, proto } from '@whiskeysockets/baileys';
import { garantirTabelaExtrato, registrarExtrato } from './bancoHandler.js'; // 🏦 NOVO: extrato

// ---------------------------------------------------------------
// Palavras para gerar as chaves (emoji, palavra)
// ---------------------------------------------------------------
const PALAVRAS = [
    ['🏦', 'BANQUEIRO-DO-PIX-DC'],
    ['💅', 'DIVA-DO-GRUPO-DC'],
    ['🧙', 'BRUXA-DO-PIX-DC'],
    ['🍕', 'PIZZA-NO-PIX-DC'],
    ['🕵️', 'DETETIVE-DO-DC']
];

// ---------------------------------------------------------------
// Criação automática da tabela (roda só uma vez)
// ---------------------------------------------------------------
let tabelaOk = false;
async function garantirTabela() {
    if (tabelaOk) return;
    await pool.query(`
        CREATE TABLE IF NOT EXISTS damas_pix_keys (
            user_id   TEXT PRIMARY KEY,
            chave     TEXT UNIQUE NOT NULL,
            emoji     TEXT NOT NULL,
            criado_em TIMESTAMP DEFAULT NOW()
        )
    `);
    tabelaOk = true;
}

// ---------------------------------------------------------------
// Utilitários
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

// Tira emoji/espaços e deixa só LETRAS, NÚMEROS e hífen
function normalizarChave(texto) {
    return texto.toUpperCase().replace(/[^A-ZÀ-Ú0-9-]/g, '');
}

function gerarChave() {
    const [emoji, palavra] = PALAVRAS[Math.floor(Math.random() * PALAVRAS.length)];
    const numero = Math.floor(100 + Math.random() * 900); // 100–999
    return { emoji, chave: `${palavra}-${numero}` };
}

// ---------------------------------------------------------------
// #pix  →  gera (ou mostra) a chave PIX da pessoa
// ---------------------------------------------------------------
export async function pixHandler(sock, message) {
    const from = message.key.remoteJid;
    try {
        await garantirTabela();

        const userId = extractDigits(getNumeroReal(message));

        // Já tem chave? Só mostra.
        let res = await pool.query(
            `SELECT chave, emoji FROM damas_pix_keys WHERE user_id = $1`,
            [userId]
        );

        let criouAgora = false;
        if (!res.rows[0]) {
            // Tenta gerar uma chave única (até 10 tentativas)
            for (let i = 0; i < 10; i++) {
                const { emoji, chave } = gerarChave();
                try {
                    await pool.query(
                        `INSERT INTO damas_pix_keys (user_id, chave, emoji) VALUES ($1, $2, $3)`,
                        [userId, chave, emoji]
                    );
                    res = { rows: [{ chave, emoji }] };
                    criouAgora = true;
                    break;
                } catch (e) {
                    if (e.code !== '23505') throw e; // 23505 = duplicada, tenta outra
                    // Se o user_id já existe (corrida entre duas mensagens), busca a existente
                    const existente = await pool.query(
                        `SELECT chave, emoji FROM damas_pix_keys WHERE user_id = $1`,
                        [userId]
                    );
                    if (existente.rows[0]) {
                        res = existente;
                        break;
                    }
                }
            }
            if (!res.rows[0]) throw new Error('Não consegui gerar chave única');
        }

        await flushDC();
        const saldoRes = await pool.query(
            `SELECT saldo FROM damas_dc_wallets WHERE user_id = $1`,
            [userId]
        );
        const saldo = Number(saldoRes.rows[0]?.saldo || 0);
        const { chave } = res.rows[0];

        const textoBanco =
            `🏦 *BANCO DAMAS*\n\n` +
            (criouAgora ? `Sua chave PIX foi gerada!\n\n` : `Sua chave PIX:\n\n`) +
            `🔑 ${chave}\n\n` +
            `💰 Saldo: ${saldo.toLocaleString('pt-BR')} DCs`;

        // Tenta mandar com botão "Copiar chave"
        try {
            const msg = generateWAMessageFromContent(from, {
                viewOnceMessage: {
                    message: {
                        messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2 },
                        interactiveMessage: proto.Message.InteractiveMessage.create({
                            body: proto.Message.InteractiveMessage.Body.create({ text: textoBanco }),
                            nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
                                buttons: [{
                                    name: 'cta_copy',
                                    buttonParamsJson: JSON.stringify({
                                        display_text: 'Copiar chave',
                                        id: 'copiar_pix',
                                        copy_code: chave
                                    })
                                }]
                            })
                        })
                    }
                }
            }, { quoted: message });

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
            console.error('[pixHandler] Botão copiar falhou, usando texto:', e.message);
            // Se o botão falhar, manda do jeito antigo
            await sock.sendMessage(from, { text: textoBanco }, { quoted: message });
            await sock.sendMessage(from, { text: chave });
        }
    } catch (err) {
        console.error('[pixHandler] Erro:', err.message);
        await sock.sendMessage(from, {
            text: '❌ Erro ao gerar sua chave PIX.'
        }, { quoted: message });
    }
}

// ---------------------------------------------------------------
// #enviar CHAVE valor  →  transfere DCs usando a chave PIX
// ---------------------------------------------------------------
export async function enviarPixHandler(sock, message, content) {
    const from = message.key.remoteJid;
    try {
        await garantirTabela();
        await garantirTabelaExtrato(); // 🏦 NOVO: garante a tabela do extrato
        await flushDC();

        const remetenteId = extractDigits(getNumeroReal(message));

        // content esperado: "#enviar DIVA-DO-GRUPO-DC-498 100"
        const partes = content.trim().split(/\s+/);
        const valorTxt = partes[partes.length - 1];
        const chaveTxt = partes.slice(1, -1).join('');

        const valor = parseFloat(String(valorTxt).replace(',', '.'));
        if (!chaveTxt || !Number.isFinite(valor) || valor <= 0) {
            await sock.sendMessage(from, {
                text: '⚠️ Use: *#enviar CHAVE VALOR*\nEx: *#enviar DIVA-DO-GRUPO-DC-498 100*'
            }, { quoted: message });
            return;
        }

        const chave = normalizarChave(chaveTxt);
        const dest = await pool.query(
            `SELECT user_id FROM damas_pix_keys WHERE chave = $1`,
            [chave]
        );
        if (!dest.rows[0]) {
            await sock.sendMessage(from, {
                text: '❌ Chave PIX não encontrada.'
            }, { quoted: message });
            return;
        }
        const destinatarioId = dest.rows[0].user_id;

        if (destinatarioId === remetenteId) {
            await sock.sendMessage(from, {
                text: '⚠️ Você não pode enviar PIX para si mesma(o)!'
            }, { quoted: message });
            return;
        }

        let saldoInsuficiente = null;

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Trava a linha e confere o saldo dentro da transação
            const s = await client.query(
                `SELECT saldo FROM damas_dc_wallets WHERE user_id = $1 FOR UPDATE`,
                [remetenteId]
            );
            const saldo = Number(s.rows[0]?.saldo || 0);

            if (saldo < valor) {
                await client.query('ROLLBACK');
                saldoInsuficiente = saldo;
            } else {
                await client.query(
                    `UPDATE damas_dc_wallets SET saldo = saldo - $1, atualizado_em = NOW() WHERE user_id = $2`,
                    [valor, remetenteId]
                );
                await client.query(
                    `INSERT INTO damas_dc_wallets (user_id, saldo) VALUES ($1, $2)
                     ON CONFLICT (user_id)
                     DO UPDATE SET saldo = damas_dc_wallets.saldo + $2, atualizado_em = NOW()`,
                    [destinatarioId, valor]
                );
                // 🏦 NOVO: registra no extrato dentro da mesma transação
                await registrarExtrato(client, remetenteId, destinatarioId, valor);
                await client.query('COMMIT');
            }
        } catch (err) {
            await client.query('ROLLBACK').catch(() => {});
            throw err;
        } finally {
            client.release();
        }

        if (saldoInsuficiente !== null) {
            const falta = valor - saldoInsuficiente;
            await sock.sendMessage(from, {
                text: `❌ *SALDO INSUFICIENTE!*\n\n` +
                      `💰 Você tem: *${saldoInsuficiente.toLocaleString('pt-BR')} DCs*\n` +
                      `💸 Tentou enviar: *${valor.toLocaleString('pt-BR')} DCs*\n` +
                      `📉 Faltam: *${falta.toLocaleString('pt-BR')} DCs*`
            }, { quoted: message });
            return;
        }

        await sock.sendMessage(from, {
            text: `💸 *TRANSFERÊNCIA REALIZADA!*\n\n` +
                  `👤 Destinatário: @${destinatarioId}\n` +
                  `💰 Valor: ${valor.toLocaleString('pt-BR')} DCs\n\n` +
                  `✅ Operação concluída!\n\n` +
                  `🏦 Banco Damas agradece!`,
            mentions: [`${destinatarioId}@s.whatsapp.net`]
        }, { quoted: message });
    } catch (err) {
        console.error('[enviarPixHandler] Erro:', err.message);
        await sock.sendMessage(from, {
            text: '❌ Erro ao processar o PIX.'
        }, { quoted: message });
    }
}