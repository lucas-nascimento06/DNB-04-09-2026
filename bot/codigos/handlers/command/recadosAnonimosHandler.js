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
        console.log(`🔐 [DEBUG] Verificando se ${senderId} é admin...`);
        const groupMetadata = await sock.groupMetadata(from);
        const candidatos = new Set([
            senderId,
            message.key.participant,
            message.key.participantAlt,
        ].filter(Boolean));

        const participante = groupMetadata.participants.find(p => candidatos.has(p.id));

        if (!participante) {
            console.log(`❌ [DEBUG] Participante não encontrado`);
            return false;
        }

        const isAdmin = participante.admin === 'admin' || participante.admin === 'superadmin';
        console.log(`${isAdmin ? '✅' : '❌'} [DEBUG] Admin: ${isAdmin}`);
        return isAdmin;
    } catch (err) {
        console.error('⚠️ [RECADOS] Erro ao verificar admin:', err.message);
        return false;
    }
}

// Busca TODOS os recados do banco
async function buscarRecados() {
    try {
        console.log('🗄️  [DEBUG] Buscando recados do banco...');
        const { rows } = await pool.query(
            `SELECT * FROM recados_anonimos ORDER BY id ASC`
        );
        console.log(`✅ [DEBUG] ${rows.length} recado(s) encontrado(s)`);
        if (rows.length > 0) {
            console.log('📋 [DEBUG] Primeiro recado:', JSON.stringify(rows[0], null, 2));
        }
        return rows;
    } catch (err) {
        console.error('❌ [DEBUG] Erro ao buscar recados:', err.message);
        throw err;
    }
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
        console.log(`🔽 [DEBUG] Iniciando download: ${url}`);
        const response = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 30000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'image/*'
            },
            maxRedirects: 5,
            validateStatus: (status) => status === 200
        });
        const tamanho = response.data.length;
        console.log(`✅ [DEBUG] Imagem baixada com sucesso: ${tamanho} bytes`);
        return Buffer.from(response.data);
    } catch (err) {
        console.error(`❌ [DEBUG] Falha ao baixar imagem: ${err.message}`);
        return null;
    }
}

async function gerarThumbnail(buffer, size = 256) {
    try {
        console.log(`🎨 [DEBUG] Gerando thumbnail ${size}x${size}...`);
        const image = await Jimp.read(buffer);
        image.scaleToFit({ w: size, h: size });
        const thumb = await image.getBuffer("image/jpeg");
        console.log(`✅ [DEBUG] Thumbnail gerado: ${thumb.length} bytes`);
        return thumb;
    } catch (err) {
        console.error(`❌ [DEBUG] Erro ao gerar thumbnail: ${err.message}`);
        return null;
    }
}

// Normaliza a imagem inteira pra jpeg (não só a thumbnail)
async function normalizarImagemParaJpeg(buffer, maxW = 1280, maxH = 1280) {
    try {
        console.log(`🖼️  [DEBUG] Normalizando imagem para JPEG (máx ${maxW}x${maxH})...`);
        const image = await Jimp.read(buffer);
        console.log(`ℹ️  [DEBUG] Dimensões originais: ${image.bitmap.width}x${image.bitmap.height}`);
        
        if (image.bitmap.width > maxW || image.bitmap.height > maxH) {
            console.log(`📏 [DEBUG] Redimensionando...`);
            image.scaleToFit({ w: maxW, h: maxH });
        }
        
        const jpeg = await image.getBuffer("image/jpeg");
        console.log(`✅ [DEBUG] Imagem normalizada: ${jpeg.length} bytes`);
        return jpeg;
    } catch (err) {
        console.error(`❌ [DEBUG] Erro ao normalizar imagem: ${err.message}`);
        return null;
    }
}

async function sendMediaWithThumbnail(sock, jid, buffer, caption, mentions = []) {
    try {
        console.log(`📤 [DEBUG] Gerando thumbnail para envio...`);
        const thumb = await gerarThumbnail(buffer, 256);
        
        console.log(`📨 [DEBUG] Enviando mídia com thumbnail (${buffer.length} bytes)...`);
        await sock.sendMessage(jid, {
            image: buffer,
            caption,
            mentions,
            jpegThumbnail: thumb
        });
        console.log('✅ [DEBUG] Imagem enviada com thumbnail!');
        return true;
    } catch (err) {
        console.error(`❌ [DEBUG] Erro ao enviar com thumbnail: ${err.message}`);
        try {
            console.log(`⚠️  [DEBUG] Tentando fallback: enviar sem thumbnail...`);
            await sock.sendMessage(jid, { image: buffer, caption, mentions });
            console.log('✅ [DEBUG] Imagem enviada sem thumbnail (fallback)!');
            return true;
        } catch (err2) {
            console.error(`❌ [DEBUG] Erro ao enviar imagem (fallback): ${err2.message}`);
            return false;
        }
    }
}

// Baixa áudio pra enviar como mensagem de áudio real
async function baixarAudioBuffer(url) {
    try {
        console.log(`🔽 [DEBUG] Baixando áudio: ${url}`);
        const response = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 30000,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });
        const tamanho = response.data.length;
        console.log(`✅ [DEBUG] Áudio baixado: ${tamanho} bytes`);
        return Buffer.from(response.data);
    } catch (err) {
        console.error(`❌ [DEBUG] Falha ao baixar áudio: ${err.message}`);
        return null;
    }
}

async function enviarRecado(sock, from, recado) {
    const texto = `💌❤️❥❥═══ *RECADINHO DO CORAÇAO* ═══❥❥❤️💌

💌🥰 *Um recado anônimo* *para* @${recado.numero_destinatario}

${recado.content}

_© damas da night_`;
    const mentions = [`${recado.numero_destinatario}@s.whatsapp.net`];

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`📤 [RECADO #${recado.id}] Iniciando envio para @${recado.numero_destinatario}`);
    console.log(`${'═'.repeat(60)}`);

    try {
        // Envia foto se tiver
        if (recado.photo_url) {
            console.log(`\n📸 [RECADO #${recado.id}] Processando foto...`);
            const imagemBrutaBuffer = await baixarImagemBuffer(recado.photo_url);

            if (imagemBrutaBuffer) {
                console.log(`✅ [RECADO #${recado.id}] Foto baixada com sucesso`);
                const imagemJpegBuffer = await normalizarImagemParaJpeg(imagemBrutaBuffer);

                if (imagemJpegBuffer) {
                    console.log(`✅ [RECADO #${recado.id}] Foto normalizada, enviando com thumbnail...`);
                    const enviado = await sendMediaWithThumbnail(sock, from, imagemJpegBuffer, texto, mentions);
                    if (!enviado) {
                        console.log(`⚠️  [RECADO #${recado.id}] Thumbnail falhou, enviando só texto...`);
                        await sock.sendMessage(from, { text: texto, mentions });
                        console.log(`✅ [RECADO #${recado.id}] Texto enviado (fallback)`);
                    }
                } else {
                    console.warn(`⚠️  [RECADO #${recado.id}] Normalização com Jimp falhou, tentando buffer bruto...`);
                    const enviado = await sendMediaWithThumbnail(sock, from, imagemBrutaBuffer, texto, mentions);
                    if (!enviado) {
                        console.log(`⚠️  [RECADO #${recado.id}] Fallback falhou, enviando só texto...`);
                        await sock.sendMessage(from, { text: texto, mentions });
                        console.log(`✅ [RECADO #${recado.id}] Texto enviado (fallback 2)`);
                    }
                }
            } else {
                console.warn(`⚠️  [RECADO #${recado.id}] Download da foto falhou, enviando só texto`);
                await sock.sendMessage(from, { text: texto, mentions });
                console.log(`✅ [RECADO #${recado.id}] Texto enviado (sem foto)`);
            }
        } else {
            // Sem foto - envia texto puro
            console.log(`\n📝 [RECADO #${recado.id}] Sem foto, enviando texto puro...`);
            await sock.sendMessage(from, {
                text: texto,
                mentions
            });
            console.log(`✅ [RECADO #${recado.id}] Texto enviado com sucesso`);
        }

        // Envia áudio se tiver
        if (recado.music_url) {
            console.log(`\n🎵 [RECADO #${recado.id}] Processando áudio...`);
            await new Promise(r => setTimeout(r, 1000)); // Delay antes de áudio
            const audioBuffer = await baixarAudioBuffer(recado.music_url);

            if (audioBuffer) {
                try {
                    console.log(`📨 [RECADO #${recado.id}] Enviando áudio (${audioBuffer.length} bytes)...`);
                    await sock.sendMessage(from, {
                        audio: audioBuffer,
                        mimetype: 'audio/mpeg',
                        ptt: false
                    });
                    console.log(`✅ [RECADO #${recado.id}] Áudio enviado com sucesso`);
                } catch (err) {
                    console.error(`❌ [RECADO #${recado.id}] Erro ao enviar áudio: ${err.message}`);
                    console.log(`⚠️  [RECADO #${recado.id}] Enviando link do áudio...`);
                    await sock.sendMessage(from, { text: `🎵 Áudio: ${recado.music_url}` });
                }
            } else {
                console.warn(`⚠️  [RECADO #${recado.id}] Download do áudio falhou`);
                await sock.sendMessage(from, { text: `🎵 Áudio: ${recado.music_url}` });
            }
        }

        console.log(`\n✅ [RECADO #${recado.id}] FINALIZADO COM SUCESSO\n`);

    } catch (err) {
        console.error(`\n❌ [RECADO #${recado.id}] ERRO CRÍTICO: ${err.message}`);
        console.error(`Stack: ${err.stack}\n`);
        // Continua mesmo se falhar, pra não quebrar a fila de recados
    }
}

export async function handleRecadosAnonimosCommand(sock, message, from) {
    const content =
        message.message?.conversation ||
        message.message?.extendedTextMessage?.text || '';

    if (!/^#msn$/i.test(content.trim())) return false;

    console.log(`\n${'█'.repeat(60)}`);
    console.log(`█ COMANDO #MSN DETECTADO`);
    console.log(`█ Grupo: ${from}`);
    console.log(`${'█'.repeat(60)}\n`);

    const senderId = resolverSenderId(message);

    // 🔒 Apenas administradores podem disparar
    const ehAdmin = await verificarSeEhAdmin(sock, from, message, senderId);

    if (!ehAdmin) {
        console.log(`❌ ${senderId} não é admin, rejeitando comando`);
        await sock.sendMessage(from, {
            text: '🚫 Esse comando é exclusivo para administradores do grupo.',
            mentions: [senderId],
            quoted: message
        });
        return true;
    }

    try {
        console.log(`✅ ${senderId} é admin, proceedendo...\n`);

        const recados = await buscarRecados();

        if (recados.length === 0) {
            console.log(`📭 Nenhum recado encontrado`);
            await sock.sendMessage(from, {
                text: '📭 Nenhum recado anônimo.',
                mentions: [senderId],
                quoted: message
            });
            return true;
        }

        console.log(`\n${'█'.repeat(60)}`);
        console.log(`█ INICIANDO ENVIO DE ${recados.length} RECADO(S)`);
        console.log(`${'█'.repeat(60)}\n`);

        await sock.sendMessage(from, {
            text: `📬 Enviando ${recados.length} recado(s)...\n⏳ Aguarde...`,
            mentions: [senderId],
            quoted: message
        });

        let enviados = 0;
        let falhados = 0;
        const erros = [];

        for (let i = 0; i < recados.length; i++) {
            const recado = recados[i];
            try {
                console.log(`\n[${i + 1}/${recados.length}] Processando recado #${recado.id}...`);
                await enviarRecado(sock, from, recado);
                enviados++;
            } catch (err) {
                console.error(`❌ [HANDLER] Erro ao enviar recado #${recado.id}: ${err.message}`);
                falhados++;
                erros.push(`#${recado.id}: ${err.message}`);
            }
            // Delay entre recados
            if (i < recados.length - 1) {
                console.log(`⏱️  Aguardando 1.2s antes do próximo recado...`);
                await new Promise(r => setTimeout(r, 1200));
            }
        }

        console.log(`\n${'█'.repeat(60)}`);
        console.log(`█ RESUMO DO ENVIO`);
        console.log(`█ ✅ Enviados: ${enviados}`);
        console.log(`█ ❌ Falhados: ${falhados}`);
        console.log(`█ Total: ${recados.length}`);
        console.log(`${'█'.repeat(60)}\n`);

        const resumo = `✅ *CONCLUÍDO!*\n\n📊 Estatísticas:\n• ✅ ${enviados} recado(s) enviado(s)\n• ❌ ${falhados} falharam${falhados > 0 ? `\n\n⚠️ Erros:\n${erros.map(e => `• ${e}`).join('\n')}` : ''}`;

        await sock.sendMessage(from, {
            text: resumo,
            mentions: [senderId]
        });

    } catch (err) {
        console.error('❌ [RECADOS] Erro geral:', err.message);
        console.error('Stack:', err.stack);
        await sock.sendMessage(from, {
            text: `❌ Erro ao enviar recados: ${err.message}\n\nTenta de novo.`,
            mentions: [senderId],
            quoted: message
        });
    }

    return true;
}