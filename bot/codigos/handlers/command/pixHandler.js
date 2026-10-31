// ARQUIVO: bot/codigos/handlers/command/pixHandler.js

import { randomInt } from 'crypto';
import pool from '../../../../db.js';
import { flushDC } from '../../features/dcTracker.js';
import { generateWAMessageFromContent, proto } from '@whiskeysockets/baileys';
import { garantirTabelaExtrato, registrarExtrato } from './bancoHandler.js'; // 🏦 extrato

// ---------------------------------------------------------------
// Geração de chave aleatória (letras + números)
// Formato: DC-K7M2-X9PQ
// Sem 0/O e 1/I/L para ninguém confundir ao digitar.
// ---------------------------------------------------------------
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function blocoAleatorio(tamanho) {
    let s = '';
    for (let i = 0; i < tamanho; i++) {
        s += ALFABETO[randomInt(ALFABETO.length)];
    }
    return s;
}

function gerarChave() {
    return { emoji: '🔑', chave: `DC-${blocoAleatorio(4)}-${blocoAleatorio(4)}` };
}

// Reconhece o formato novo (DC-XXXX-XXXX) e também as chaves antigas
// (palavras com hífen terminando em 3 dígitos), para quem já tem chave.
const REGEX_CHAVE = /\bDC-[A-Z0-9]{4}-[A-Z0-9]{4}\b|[A-ZÀ-Ú0-9]+(?:-[A-ZÀ-Ú0-9]+)*-\d{3}/i;

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

// Tira emoji/espaços e deixa só LETRAS, NÚMEROS e hífen (em maiúsculo)
function normalizarChave(texto) {
    return texto.toUpperCase().replace(/[^A-ZÀ-Ú0-9-]/g, '');
}

// Busca o dono de uma chave (ignora maiúscula/minúscula, para
// funcionar também com chaves antigas salvas com letras minúsculas).
async function buscarDonoDaChave(chave) {
    const res = await pool.query(
        `SELECT user_id FROM damas_pix_keys WHERE UPPER(chave) = $1`,
        [normalizarChave(chave)]
    );
    return res.rows[0]?.user_id || null;
}

// Busca a chave da pessoa; se não tiver, gera uma nova.
async function gerarOuBuscarChave(userId) {
    const existente = await pool.query(
        `SELECT chave, emoji FROM damas_pix_keys WHERE user_id = $1`,
        [userId]
    );
    if (existente.rows[0]) return { ...existente.rows[0], criouAgora: false };

    // Tenta gerar uma chave única (até 10 tentativas)
    for (let i = 0; i < 10; i++) {
        const { emoji, chave } = gerarChave();
        try {
            await pool.query(
                `INSERT INTO damas_pix_keys (user_id, chave, emoji) VALUES ($1, $2, $3)`,
                [userId, chave, emoji]
            );
            return { chave, emoji, criouAgora: true };
        } catch (e) {
            if (e.code !== '23505') throw e; // 23505 = duplicada, tenta outra
            // Se o user_id já existe (corrida entre duas mensagens), usa a existente
            const jaExiste = await pool.query(
                `SELECT chave, emoji FROM damas_pix_keys WHERE user_id = $1`,
                [userId]
            );
            if (jaExiste.rows[0]) return { ...jaExiste.rows[0], criouAgora: false };
        }
    }
    throw new Error('Não consegui gerar chave única');
}

// Resolve um JID (pode ser LID) para o número real de telefone.
// Retorna null se não conseguir (melhor falhar do que criar carteira no LID).
async function resolverNumeroReal(sock, groupId, jid) {
    if (!jid) return null;
    if (jid.endsWith('@s.whatsapp.net')) return extractDigits(jid);

    try {
        const meta = await sock.groupMetadata(groupId);
        const participante = meta.participants.find(p => p.id === jid);
        const numeroReal =
            participante?.jid ||
            participante?.phoneNumber ||
            participante?.pn ||
            participante?.participantAlt;
        if (numeroReal) return extractDigits(numeroReal);
    } catch (err) {
        console.error('[pixHandler] Erro ao resolver número real:', err.message);
    }
    return null;
}

// ---------------------------------------------------------------
// Leitura da mensagem respondida (reply)
// ---------------------------------------------------------------
function getContextInfo(message) {
    return message.message?.extendedTextMessage?.contextInfo || null;
}

// Junta todo texto possível da mensagem citada (inclui mensagem com botão)
function textoDaMensagemCitada(message) {
    let q = getContextInfo(message)?.quotedMessage;
    if (!q) return '';

    // desembrulha viewOnce / ephemeral
    q = q.viewOnceMessage?.message
        || q.viewOnceMessageV2?.message
        || q.ephemeralMessage?.message
        || q;

    const partes = [
        q.conversation,
        q.extendedTextMessage?.text,
        q.imageMessage?.caption,
        q.interactiveMessage?.body?.text
    ];

    // a chave também vem no botão "Copiar chave"
    const botoes = q.interactiveMessage?.nativeFlowMessage?.buttons || [];
    for (const b of botoes) {
        try {
            const p = JSON.parse(b.buttonParamsJson || '{}');
            if (p.copy_code) partes.push(p.copy_code);
        } catch { /* ignora */ }
    }

    return partes.filter(Boolean).join('\n');
}

// ---------------------------------------------------------------
// #pix  →  gera (ou mostra) a chave PIX da pessoa
// ---------------------------------------------------------------
export async function pixHandler(sock, message) {
    const from = message.key.remoteJid;
    try {
        await garantirTabela();

        const userId = extractDigits(getNumeroReal(message));
        const mencaoJid = `${userId}@s.whatsapp.net`; // 👤 quem será mencionado como titular

        const { chave, criouAgora } = await gerarOuBuscarChave(userId);

        await flushDC();
        const saldoRes = await pool.query(
            `SELECT saldo FROM damas_dc_wallets WHERE user_id = $1`,
            [userId]
        );
        const saldo = Number(saldoRes.rows[0]?.saldo || 0);

        // ✨ Layout do Banco Damas (com titular mencionado)
        const textoBanco =
            `💸⃤ *BANCO DAMAS* 💲💸\n\n` +
            (criouAgora
                ? `✨ *CHAVE PIX GERADA COM SUCESSO!*\n\n`
                : `💠 *SUA CHAVE PIX*\n\n`) +
            `👤 *Titular da chave:* @${userId}\n` +
            `🔑 *Chave PIX:* \`${chave}\`\n` +
            `💰 *Saldo disponível:* ${saldo.toLocaleString('pt-BR')} DCs\n\n` +
            `━━━━━━━━━━━━━━━━━━\n\n` +
            `📲 *Para receber DCs:* compartilhe sua chave com quem vai transferir.\n\n` +
            `💸 *Para enviar DCs:*\n` +
            `\`#e CHAVE VALOR\`\n` +
            `Ou responda à mensagem da pessoa com:\n` +
            `\`#e VALOR\`\n\n` +
            `🏦 *BANCO DAMAS* — Seu dinheiro, suas regras! 💲`;

        // Tenta mandar com botão "Copiar chave"
        try {
            const msg = generateWAMessageFromContent(from, {
                viewOnceMessage: {
                    message: {
                        messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2 },
                        interactiveMessage: proto.Message.InteractiveMessage.create({
                            body: proto.Message.InteractiveMessage.Body.create({ text: textoBanco }),
                            contextInfo: { mentionedJid: [mencaoJid] }, // 👈 menção do titular
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
            // Se o botão falhar, manda do jeito antigo (com menção)
            await sock.sendMessage(from, { text: textoBanco, mentions: [mencaoJid] }, { quoted: message });
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
// #e / #enviar  →  transfere DCs
//
// Formas de usar:
//   #e CHAVE 100                    (tudo em uma linha)
//   CHAVE <enter> #e 100            (chave colada + comando no fim)
//   #e @pessoa 100                  (marcando a pessoa)
//   (responder a #pix do bot)  #e 100
//   (responder msg de alguém)  #e 100
// ---------------------------------------------------------------
export async function enviarPixHandler(sock, message, content) {
    const from = message.key.remoteJid;
    try {
        await garantirTabela();
        await garantirTabelaExtrato();
        await flushDC();

        const remetenteId = extractDigits(getNumeroReal(message));
        const ctx = getContextInfo(message);

        // --- 1) Limpa o texto: tira o comando, as @menções e acha a chave ---
        let texto = (content || '').replace(/#(?:enviar|e)\b/gi, ' ');
        texto = texto.replace(/@\S+/g, ' ');

        const matchChave = texto.match(REGEX_CHAVE);
        const chave = matchChave ? normalizarChave(matchChave[0]) : null;
        if (matchChave) texto = texto.replace(matchChave[0], ' ');

        // --- 2) Valor = último número que sobrou ---
        const matchValor = texto.trim().match(/(\d+(?:[.,]\d+)?)\s*$/);
        const valor = matchValor ? parseFloat(matchValor[1].replace(',', '.')) : NaN;

        if (!Number.isFinite(valor) || valor <= 0) {
            await sock.sendMessage(from, {
                text: '⚠️ Informe o valor.\n\n' +
                      '*#e CHAVE 100*\n' +
                      '*#e @pessoa 100*\n' +
                      'ou responda uma mensagem com *#e 100*'
            }, { quoted: message });
            return;
        }

        // --- 3) Descobre o destinatário (ordem de prioridade) ---
        let destinatarioId = null;

        // 3a) chave digitada/colada na mensagem
        if (chave) {
            destinatarioId = await buscarDonoDaChave(chave);
            if (!destinatarioId) {
                await sock.sendMessage(from, {
                    text: '❌ Chave PIX não encontrada.'
                }, { quoted: message });
                return;
            }
        }

        // 3b) pessoa marcada com @
        if (!destinatarioId) {
            const mentionedJid = ctx?.mentionedJid?.[0];
            if (mentionedJid) {
                destinatarioId = await resolverNumeroReal(sock, from, mentionedJid);
                if (!destinatarioId) {
                    await sock.sendMessage(from, {
                        text: '❌ Não consegui identificar essa pessoa. Peça para ela mandar *#pix* e use a chave.'
                    }, { quoted: message });
                    return;
                }
                await gerarOuBuscarChave(destinatarioId); // garante que ela tenha chave
            }
        }

        // 3c) chave dentro da mensagem respondida (ex: o #pix do bot)
        if (!destinatarioId) {
            const citado = textoDaMensagemCitada(message);
            const mc = citado.match(REGEX_CHAVE);
            if (mc) {
                destinatarioId = await buscarDonoDaChave(mc[0]);
            }
        }

        // 3d) autor da mensagem respondida (se não for o próprio bot)
        if (!destinatarioId && ctx?.participant) {
            const botIds = [sock.user?.id, sock.user?.lid]
                .filter(Boolean)
                .map(id => extractDigits(id.split(':')[0]));
            const autorDigits = extractDigits(ctx.participant.split(':')[0]);

            if (!botIds.includes(autorDigits)) {
                destinatarioId = await resolverNumeroReal(sock, from, ctx.participant);
                if (destinatarioId) {
                    await gerarOuBuscarChave(destinatarioId); // gera a chave na hora se não tiver
                }
            }
        }

        if (!destinatarioId) {
            await sock.sendMessage(from, {
                text: '⚠️ Não achei para quem enviar.\n\n' +
                      'Use: *#e CHAVE 100*\n' +
                      'ou marque a pessoa: *#e @pessoa 100*\n' +
                      'ou responda a mensagem dela com *#e 100*'
            }, { quoted: message });
            return;
        }

        if (destinatarioId === remetenteId) {
            await sock.sendMessage(from, {
                text: '⚠️ Você não pode enviar PIX para si mesma(o)!'
            }, { quoted: message });
            return;
        }

        // --- 4) Transação ---
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
                // 🏦 registra no extrato dentro da mesma transação
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