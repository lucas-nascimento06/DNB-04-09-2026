import pool from '../../../../db.js';
import { downloadMediaMessage } from '@whiskeysockets/baileys';
import fs from 'fs';
import path from 'path';
import { Jimp } from 'jimp';
import { anunciosCache } from './leilaoCache.js';
import { isBloqueado } from './casalBloqueioUtils.js';
import { obterNomeUsuario } from '../../features/nomesTracker.js';

const PASTA_LEILOES = path.resolve('./bot/temp/leiloes');
if (!fs.existsSync(PASTA_LEILOES)) fs.mkdirSync(PASTA_LEILOES, { recursive: true });

const mensagensJaProcessadas = new Set();
function jaProcessou(messageId) {
    if (!messageId) return false;
    if (mensagensJaProcessadas.has(messageId)) return true;
    mensagensJaProcessadas.add(messageId);
    setTimeout(() => mensagensJaProcessadas.delete(messageId), 60_000);
    return false;
}

function extractDigits(number) {
    if (!number) return null;
    return number.replace(/@.*$/, '').replace(/\D/g, '');
}

function normalizarComando(texto) {
    return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function parseValorDC(bruto) {
    let s = bruto.trim();
    if (s.includes(',')) {
        s = s.replace(/\./g, '').replace(',', '.');
    } else if (s.includes('.')) {
        const partes = s.split('.');
        if (partes[partes.length - 1].length === 3) {
            s = partes.join('');
        }
    }
    return parseFloat(s);
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
        console.error('[leilaoHandler] Erro ao checar admin:', err.message);
        return false;
    }
}

function getMentions(message) {
    const direto = message.message?.imageMessage?.contextInfo?.mentionedJid;
    const viaReply = message.message?.extendedTextMessage?.contextInfo?.mentionedJid;
    return direto || viaReply || [];
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

async function obterParticipantesGrupo(sock, groupId) {
    try {
        const groupMetadata = await sock.groupMetadata(groupId);
        const participantes = groupMetadata.participants.map(p => p.id);
        console.log(`👥 [leilaoHandler] ${participantes.length} participantes encontrados`);
        return participantes;
    } catch (err) {
        console.error('[leilaoHandler] Erro ao obter participantes do grupo:', err.message);
        return [];
    }
}

async function gerarThumbnail(buffer, size = 256) {
    try {
        const image = await Jimp.read(buffer);
        await image.resize({ w: size, h: size });
        return await image.getBuffer("image/png");
    } catch (err) {
        console.error("[leilaoHandler] Erro ao gerar thumbnail:", err.message);
        return null;
    }
}

function gerarCodigoCompatibilidade() {
    return Math.random().toString(36).substring(2, 6).toUpperCase();
}

export async function handleLeilaoCommand(sock, message, content) {
    const from = message.key.remoteJid;
    if (!from.endsWith('@g.us')) return false;

    const normalizado = normalizarComando(content).trim();
    if (!/^#leilao\b/i.test(normalizado)) return false;

    if (jaProcessou(message.key.id)) {
        console.log(`⏭️ [leilaoHandler] Mensagem ${message.key.id} já processada, ignorando duplicata.`);
        return true;
    }

    try {
        const remetenteCompleto = getNumeroReal(message);
        const adminId = extractDigits(remetenteCompleto);

        const ehAdmin = await isAdmin(sock, from, adminId);
        if (!ehAdmin) {
            await sock.sendMessage(from, {
                text: '🚫 Só administradores podem criar leilões.'
            }, { quoted: message });
            return true;
        }

        const mentions = getMentions(message);
        if (mentions.length < 1) {
            await sock.sendMessage(from, {
                text: '⚠️ Marque a pessoa que vai ser leiloada.\n\n*Exemplo:* `#leilao @pessoa 500dc 2000dc`'
            }, { quoted: message });
            return true;
        }
        const leiloadoId = await resolverNumeroRealDoMencionado(sock, from, mentions[0]);

        const leiloadoNome = (await obterNomeUsuario(leiloadoId)) || leiloadoId;
        
        console.log(`👤 [leilaoHandler] Nome obtido: "${leiloadoNome}"`);

        if (leiloadoId === adminId) {
            await sock.sendMessage(from, {
                text: '⚠️ Você não pode se auto-leiloar.'
            }, { quoted: message });
            return true;
        }

        const textoSemMencao = normalizado.replace(/@\d+/g, '').trim();
        const valorMatch = textoSemMencao.match(/^#leilao\s+([\d.,]+)\s*dc\s+([\d.,]+)\s*dc\b/i);
        if (!valorMatch) {
            await sock.sendMessage(from, {
                text: '⚠️ Formato inválido. Você precisa informar o valor *mínimo* e o *máximo* do leilão.\n\n' +
                      '*Exemplo:* `#leilao @pessoa 500dc 2000dc`'
            }, { quoted: message });
            return true;
        }

        const valorInicial = parseValorDC(valorMatch[1]);
        const valorMaximo = parseValorDC(valorMatch[2]);

        if (isNaN(valorInicial) || valorInicial <= 0) {
            await sock.sendMessage(from, {
                text: '⚠️ Valor *mínimo* inválido.\n\n*Exemplo:* `#leilao @pessoa 500dc 2000dc`'
            }, { quoted: message });
            return true;
        }

        if (isNaN(valorMaximo) || valorMaximo <= 0) {
            await sock.sendMessage(from, {
                text: '⚠️ Valor *máximo* inválido.\n\n*Exemplo:* `#leilao @pessoa 500dc 2000dc`'
            }, { quoted: message });
            return true;
        }

        if (valorMaximo <= valorInicial) {
            await sock.sendMessage(from, {
                text: `⚠️ O valor *máximo* (${valorMaximo.toLocaleString('pt-BR')} DC) precisa ser maior que o *mínimo* (${valorInicial.toLocaleString('pt-BR')} DC).`
            }, { quoted: message });
            return true;
        }

        const temImagem = !!message.message?.imageMessage;
        const quotedMessage = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        const imagemCitada = quotedMessage?.imageMessage;
        if (!temImagem && !imagemCitada) {
            await sock.sendMessage(from, {
                text: '⚠️ Envie a foto da pessoa com a legenda *#leilao @pessoa <min>dc <max>dc*, ou responda a foto com o comando.'
            }, { quoted: message });
            return true;
        }

        const ativoResult = await pool.query(
            `SELECT id FROM damas_dc_leiloes WHERE grupo_id = $1 AND status = 'aberto'`,
            [from]
        );
        if (ativoResult.rowCount > 0) {
            await sock.sendMessage(from, {
                text: '⚠️ Já existe um leilão em andamento nesse grupo. Feche com *#arrematar* + *#fl* antes de abrir outro.'
            }, { quoted: message });
            return true;
        }

        if (await isBloqueado(from, leiloadoId)) {
            await sock.sendMessage(from, {
                text: `⚠️ @${leiloadoId} já está em um casal ativo.`,
                mentions: [`${leiloadoId}@s.whatsapp.net`]
            }, { quoted: message });
            return true;
        }

        let mensagemParaBaixar = message;
        if (!temImagem && imagemCitada) {
            const contextInfo = message.message.extendedTextMessage.contextInfo;
            mensagemParaBaixar = {
                key: {
                    remoteJid: from, id: contextInfo.stanzaId, fromMe: false, participant: contextInfo.participant
                },
                message: quotedMessage
            };
        }
        const buffer = await downloadMediaMessage(mensagemParaBaixar, 'buffer', {});
        const fotoPath = path.join(PASTA_LEILOES, `${message.key.id}.jpg`);
        fs.writeFileSync(fotoPath, buffer);

        let thumb = null;
        try {
            thumb = await gerarThumbnail(buffer, 256);
        } catch (thumbErr) {
            console.warn('⚠️ [leilaoHandler] Não foi possível gerar thumbnail:', thumbErr.message);
        }

        const codigo = gerarCodigoCompatibilidade();

        const insertResult = await pool.query(
            `INSERT INTO damas_dc_leiloes
                (grupo_id, admin_id, leiloado_id, leiloado_nome, foto_message_id, foto_path, valor_inicial, valor_atual, valor_maximo, status, codigo)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8, 'aberto', $9)
             RETURNING id`,
            [from, adminId, leiloadoId, leiloadoNome, message.key.id, fotoPath, valorInicial, valorMaximo, codigo]
        );
        const leilaoId = insertResult.rows[0].id;

        const leiloadoJid = `${leiloadoId}@s.whatsapp.net`;

        console.log(`🎯 [leilaoHandler] Leiloado JID: ${leiloadoJid}`);

        const anuncioOptions = {
            image: buffer,
            mimetype: 'image/jpeg',
            caption: `🏛️🔨 *LEILÃO ABERTO* 🔨🏛️\n\n` +
                `📷 @${leiloadoId}\n\n` +
                `💰 *Lance inicial:* ${valorInicial.toLocaleString('pt-BR')} DC\n` +
                `🏆 *Lance máximo:* ${valorMaximo.toLocaleString('pt-BR')} DC\n\n` +
                `👑 O(a) vencedor(a) fica como dono(a) por *3 dias*!\n\n` +
                `🎯 *Dê seu lance:*\n` +
                `\`#lance <valor>dc\`\nou\n\`#l <valor>dc\`\n\n` +
                `🚨 Ao atingir *${valorMaximo.toLocaleString('pt-BR')} DC*, o leilão será encerrado automaticamente.\n\n` +
                `🔥 *Que comece o leilão!*`,
            mentions: [leiloadoJid]
        };
        if (thumb) anuncioOptions.jpegThumbnail = thumb;

        const anuncio = await sock.sendMessage(from, anuncioOptions);
        const anuncioMessageId = anuncio.key.id;

        await pool.query(
            `UPDATE damas_dc_leiloes SET anuncio_message_id = $1 WHERE id = $2`,
            [anuncioMessageId, leilaoId]
        );
        anunciosCache.set(leilaoId, anuncio);

        await pool.query(
            `INSERT INTO damas_dc_leiloes_mensagens (message_id, leilao_id) VALUES ($1, $2)
             ON CONFLICT (message_id) DO NOTHING`,
            [anuncioMessageId, leilaoId]
        );

        try {
            await sock.sendMessage(from, { delete: message.key });
        } catch (delErr) {
            console.warn('⚠️ [leilaoHandler] Não foi possível apagar a mensagem de comando original:', delErr.message);
        }

        return true;

    } catch (err) {
        console.error('[handleLeilaoCommand] Erro:', err.message);
        await sock.sendMessage(from, {
            text: '❌ Erro ao criar o leilão.'
        }, { quoted: message });
        return true;
    }
}

export { obterParticipantesGrupo };