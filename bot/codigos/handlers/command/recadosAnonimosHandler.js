// bot/codigos/handlers/command/recadosAnonimosHandler.js
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import pool from '../../../../db.js';

// ─────────────────────────────────────────────────────────────────────────────
// 📩 RECADOS ANÔNIMOS — envia pro grupo os recados pendentes da tabela
// `recados_anonimos` (Neon/Postgres via pg.Pool, mesmo client do resto do bot)
//
// Uso: #msn
// Precisa ser digitado dentro do grupo pra onde os recados devem ir.
//
// ⚠️ A tabela `recados_anonimos` é escrita por outro aplicativo (o que gera o
// link de "mandar recado"), então o bot NÃO mexe no schema dela (sem ALTER
// TABLE, sem coluna nova). Pra saber quais recados já foram mandados, o bot
// guarda o próprio controle localmente, em bot/data/recadosAnonimosState.json
// (mesmo padrão já usado em bot/data/groups.json).
// ─────────────────────────────────────────────────────────────────────────────

const STATE_PATH = path.join('./bot/data', 'recadosAnonimosState.json');

function lerUltimoIdEnviado() {
    try {
        if (!fs.existsSync(STATE_PATH)) return 0;
        const data = JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8'));
        return data.ultimoIdEnviado || 0;
    } catch (err) {
        console.error('⚠️ [RECADOS] Erro ao ler state, assumindo 0:', err.message);
        return 0;
    }
}

function salvarUltimoIdEnviado(id) {
    try {
        fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
        fs.writeFileSync(STATE_PATH, JSON.stringify({ ultimoIdEnviado: id }, null, 2));
    } catch (err) {
        console.error('⚠️ [RECADOS] Erro ao salvar state:', err.message);
    }
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

async function buscarRecadosPendentes() {
    const ultimoId = lerUltimoIdEnviado();
    const { rows } = await pool.query(
        `SELECT * FROM recados_anonimos WHERE id > $1 ORDER BY id ASC`,
        [ultimoId]
    );
    return rows;
}

// Baixa o arquivo de música/áudio pra enviar como mensagem de áudio real
// (em vez de mandar o link, que não toca dentro do WhatsApp)
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
    const texto = `💌✨ *CORREIO SECRETO • DAMAS DA NIGHT* ✨💌

📩 Um recado anônimo para @${recado.numero_destinatario} 💙💞

${recado.content}`;
    const mentions = [`${recado.numero_destinatario}@s.whatsapp.net`];

    try {
        if (recado.photo_url) {
            await sock.sendMessage(from, {
                image: { url: recado.photo_url },
                caption: texto,
                mentions
            });
        } else {
            await sock.sendMessage(from, {
                text: texto,
                mentions
            });
        }
    } catch (err) {
        console.error(`⚠️ [RECADOS] Falha ao enviar recado #${recado.id} com foto:`, err.message);
        await sock.sendMessage(from, { text: texto, mentions });
    }

    // 🎵 Se tiver música, baixa o mp3 e manda como áudio tocável de verdade
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
            // se não conseguiu baixar, manda o link como fallback
            await sock.sendMessage(from, { text: `🎵 ${recado.music_url}` });
        }
    }

    // ✅ Só avança o marcador depois que o envio deu certo, pra não perder
    // um recado em caso de erro no meio da fila.
    salvarUltimoIdEnviado(recado.id);
}

export async function handleRecadosAnonimosCommand(sock, message, from) {
    const content =
        message.message?.conversation ||
        message.message?.extendedTextMessage?.text || '';

    if (!/^#msn$/i.test(content.trim())) return false;

    const senderId = resolverSenderId(message);

    try {
        const recados = await buscarRecadosPendentes();

        if (recados.length === 0) {
            await sock.sendMessage(from, {
                text: '📭 Nenhum recado anônimo pendente no momento.',
                mentions: [senderId],
                quoted: message
            });
            return true;
        }

        await sock.sendMessage(from, {
            text: `📬 Enviando ${recados.length} recado(s) anônimo(s)...`,
            mentions: [senderId],
            quoted: message
        });

        for (const recado of recados) {
            await enviarRecado(sock, from, recado);
            // pequeno delay entre envios pra não levar rate-limit do WhatsApp
            await new Promise(r => setTimeout(r, 800));
        }

        console.log(`✅ [RECADOS] ${recados.length} recado(s) enviado(s) no grupo ${from}`);

    } catch (err) {
        console.error('❌ [RECADOS] Erro ao processar recados anônimos:', err.message);
        await sock.sendMessage(from, {
            text: '❌ Deu erro ao buscar os recados no banco. Tenta de novo em instantes.',
            mentions: [senderId],
            quoted: message
        });
    }

    return true;
}