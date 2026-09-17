import axios from 'axios';
import { Jimp } from 'jimp';
import pool from '../../../../db.js';

// ─────────────────────────────────────────────────────────────────────────────
// 📩 RECADOS ANÔNIMOS — mostra todos os recados da tabela `recados_anonimos`
//
// Uso: #msn
// Precisa ser digitado dentro do grupo pra onde os recados devem ir.
// 🔒 Apenas administradores do grupo podem executar esse comando.
// ─────────────────────────────────────────────────────────────────────────────

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
        const groupMetadata = await sock.groupMetadata(from);
        const candidatos = new Set([
            senderId,
            message.key.participant,
            message.key.participantAlt,
        ].filter(Boolean));

        const participante = groupMetadata.participants.find(p => candidatos.has(p.id));

        if (!participante) return false;

        return participante.admin === 'admin' || participante.admin === 'superadmin';
    } catch (err) {
        console.error('⚠️ [RECADOS] Erro ao verificar admin:', err.message);
        return false;
    }
}

// Busca TODOS os recados do banco
async function buscarRecados() {
    const { rows } = await pool.query(
        `SELECT * FROM recados_anonimos ORDER BY id ASC`
    );
    return rows;
}

// ============================================
// 🖼️ IMAGEM — mesmo padrão do musicaHandler:
// baixa o buffer via axios, gera jpegThumbnail
// com Jimp, e só então manda pro WhatsApp.
// Isso evita o problema de mandar buffer cru
// (ex: webp) direto pro sock.sendMessage, que
// é a causa mais comum de "imagem não abre"
// principalmente rodando em Termux.
// ============================================
async function baixarImagemBuffer(url) {
    try {
        const response = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 20000,
            headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'image/*' },
            maxRedirects: 5,
            validateStatus: (status) => status === 200
        });
        return Buffer.from(response.data);
    } catch (err) {
        console.error('⚠️ [RECADOS] Falha ao baixar imagem:', err.message);
        return null;
    }
}

async function gerarThumbnail(buffer, size = 256) {
    try {
        const image = await Jimp.read(buffer);
        image.scaleToFit({ w: size, h: size });
        return await image.getBuffer("image/jpeg");
    } catch (err) {
        console.error('⚠️ [RECADOS] Erro ao gerar thumbnail:', err.message);
        return null;
    }
}

// Normaliza a imagem inteira pra jpeg (não só a thumbnail), do mesmo jeito
// que o musicaHandler normaliza a thumbnail do YouTube. Isso garante que o
// que vai no campo "image:" nunca é um webp/png cru que pode chegar
// quebrado do outro lado.
async function normalizarImagemParaJpeg(buffer, maxW = 1280, maxH = 1280) {
    try {
        const image = await Jimp.read(buffer);
        if (image.bitmap.width > maxW || image.bitmap.height > maxH) {
            image.scaleToFit({ w: maxW, h: maxH });
        }
        return await image.getBuffer("image/jpeg");
    } catch (err) {
        console.error('⚠️ [RECADOS] Erro ao normalizar imagem:', err.message);
        return null;
    }
}

async function sendMediaWithThumbnail(sock, jid, buffer, caption, mentions = []) {
    try {
        const thumb = await gerarThumbnail(buffer, 256);
        await sock.sendMessage(jid, { image: buffer, caption, mentions, jpegThumbnail: thumb });
        console.log('✅ [RECADOS] Imagem enviada com thumbnail!');
        return true;
    } catch (err) {
        console.error('❌ [RECADOS] Erro ao enviar com thumbnail:', err.message);
        try {
            await sock.sendMessage(jid, { image: buffer, caption, mentions });
            console.log('✅ [RECADOS] Imagem enviada sem thumbnail (fallback)!');
            return true;
        } catch (err2) {
            console.error('❌ [RECADOS] Erro ao enviar imagem (fallback):', err2.message);
            return false;
        }
    }
}

// Baixa áudio pra enviar como mensagem de áudio real
async function baixarAudioBuffer(url) {
    try {
        const response = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 20000,
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        return Buffer.from(response.data);
    } catch (err) {
        console.error('⚠️ [RECADOS] Falha ao baixar áudio:', err.message);
        return null;
    }
}

async function enviarRecado(sock, from, recado) {
    const texto = `💌❤️❥❥═══ *RECADINHO DO CORAÇAO* ═══❥❥❤️💌

💌🥰 *Um recado anônimo* *para* @${recado.numero_destinatario}

${recado.content}

_© damas da night_`;
    const mentions = [`${recado.numero_destinatario}@s.whatsapp.net`];

    // Envia foto se tiver — agora baixando e normalizando o buffer,
    // igual o musicaHandler faz com a thumbnail do YouTube.
    if (recado.photo_url) {
        const imagemBrutaBuffer = await baixarImagemBuffer(recado.photo_url);

        if (imagemBrutaBuffer) {
            const imagemJpegBuffer = await normalizarImagemParaJpeg(imagemBrutaBuffer);

            if (imagemJpegBuffer) {
                const enviado = await sendMediaWithThumbnail(sock, from, imagemJpegBuffer, texto, mentions);
                if (!enviado) {
                    await sock.sendMessage(from, { text: texto, mentions });
                }
            } else {
                // Não conseguiu processar com Jimp — tenta mandar o buffer
                // bruto mesmo assim, como último recurso.
                console.warn('⚠️ [RECADOS] Normalização falhou, tentando enviar buffer bruto.');
                const enviado = await sendMediaWithThumbnail(sock, from, imagemBrutaBuffer, texto, mentions);
                if (!enviado) {
                    await sock.sendMessage(from, { text: texto, mentions });
                }
            }
        } else {
            // Falhou o download — manda só o texto, sem quebrar o fluxo.
            console.warn(`⚠️ [RECADOS] Não deu pra baixar a foto do recado #${recado.id}, enviando sem imagem.`);
            await sock.sendMessage(from, { text: texto, mentions });
        }
    } else {
        await sock.sendMessage(from, {
            text: texto,
            mentions
        });
    }

    // Envia áudio se tiver
    if (recado.music_url) {
        const audioBuffer = await baixarAudioBuffer(recado.music_url);

        if (audioBuffer) {
            try {
                await sock.sendMessage(from, {
                    audio: audioBuffer,
                    mimetype: 'audio/mpeg',
                    ptt: false
                });
            } catch (err) {
                console.error(`⚠️ [RECADOS] Falha ao enviar áudio #${recado.id}:`, err.message);
                await sock.sendMessage(from, { text: `🎵 ${recado.music_url}` });
            }
        } else {
            await sock.sendMessage(from, { text: `🎵 ${recado.music_url}` });
        }
    }
}

export async function handleRecadosAnonimosCommand(sock, message, from) {
    const content =
        message.message?.conversation ||
        message.message?.extendedTextMessage?.text || '';

    if (!/^#msn$/i.test(content.trim())) return false;

    const senderId = resolverSenderId(message);

    // 🔒 Apenas administradores podem disparar
    const ehAdmin = await verificarSeEhAdmin(sock, from, message, senderId);

    if (!ehAdmin) {
        await sock.sendMessage(from, {
            text: '🚫 Esse comando é exclusivo para administradores do grupo.',
            mentions: [senderId],
            quoted: message
        });
        return true;
    }

    try {
        const recados = await buscarRecados();

        if (recados.length === 0) {
            await sock.sendMessage(from, {
                text: '📭 Nenhum recado anônimo.',
                mentions: [senderId],
                quoted: message
            });
            return true;
        }

        await sock.sendMessage(from, {
            text: `📬 Enviando ${recados.length} recado(s)...`,
            mentions: [senderId],
            quoted: message
        });

        for (const recado of recados) {
            await enviarRecado(sock, from, recado);
            await new Promise(r => setTimeout(r, 800));
        }

        console.log(`✅ [RECADOS] ${recados.length} recado(s) enviado(s) no grupo ${from}`);

    } catch (err) {
        console.error('❌ [RECADOS] Erro:', err.message);
        await sock.sendMessage(from, {
            text: '❌ Erro ao buscar recados. Tenta de novo.',
            mentions: [senderId],
            quoted: message
        });
    }

    return true;
}