// bot/codigos/handlers/musica/dedicatoriaHandler.js
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { fileURLToPath } from 'url';
import { Jimp } from 'jimp';

import { baixarMusicaBuffer, obterDadosMusica, buscarUrlPorNome } from './download.util.js';
// 🪙 DC (JUKEBOX) — mesmos imports do musicaHandler.js
// (este arquivo fica em bot/codigos/handlers/musica/)
import pool from '../../../../db.js';
import { flushDC } from '../../features/dcTracker.js';

// ─────────────────────────────────────────────────────────────────────────────
// 🎙️ SISTEMA DE DEDICATÓRIA MUSICAL - ESTILO RÁDIO ROMÂNTICA
// Uso: #play 30dc [música] @pessoa
// Exemplo: #play 30dc Sonho de Ícaro @monica
// ─────────────────────────────────────────────────────────────────────────────

const URL_CONFIG = 'https://raw.githubusercontent.com/lucas-nascimento06/dedicatoria-music-radio-dmng/refs/heads/main/dedicatoria-config.json';

// 🖼️ Poster LOCAL (bot/codigos/foto-musicas/radio-damas.png)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// handlers/musica → sobe 2 níveis (bot/codigos) → foto-musicas
const POSTER_LOCAL = path.join(__dirname, '..', '..', 'foto-musicas', 'radio-damas.png');
// 🖼️ Poster do POEMA final (bot/codigos/foto-musicas/radio-damas-poemas.png)
const POSTER_POEMAS_LOCAL = path.join(__dirname, '..', '..', 'foto-musicas', 'radio-damas-poemas.png');

let config = null;
let processandoDedicatoria = false;
const filaDedicatorias = [];

// ============================================
// 🪙 CUSTO EM DC PARA LIBERAR UMA DEDICATÓRIA (JUKEBOX)
// ============================================
const CUSTO_MUSICA = 30;

// ── CARREGAMENTO DO CONFIG ───────────────────────────────────────────────────

export async function carregarConfigDedicatoria() {
    try {
        console.log('🔄 Carregando config de dedicatória...');
        const response = await axios.get(URL_CONFIG, {
            headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
            timeout: 15000
        });
        config = response.data;
        console.log('✅ Config de dedicatória carregada!');
        return true;
    } catch (err) {
        console.error('❌ Erro ao carregar config dedicatória:', err.message);
        throw err;
    }
}

// Tenta recarregar se config for null, em vez de lançar erro fatal
async function garantirConfig() {
    if (!config) {
        console.warn('⚠️ Config não carregada, tentando recarregar...');
        try {
            await carregarConfigDedicatoria();
        } catch (err) {
            console.error('❌ Falha ao recarregar config:', err.message);
            config = null;
        }
    }
}

// ── HELPERS ──────────────────────────────────────────────────────────────────

function limparNomeArquivo(nome) {
    return nome.replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, '_').substring(0, 100);
}

function formatarDuracao(segundos) {
    if (!segundos) return '0:00';
    const minutos = Math.floor(segundos / 60);
    const segs = segundos % 60;
    return `${minutos}:${segs.toString().padStart(2, '0')}`;
}

function fraseAleatoria(de, para, musica, artista) {
    if (!config?.frases_romanticas?.length) {
        return `🎵 ${de} dedicou *${musica}* de *${artista}* para ${para} 💖`;
    }
    const frases = config.frases_romanticas;
    const idx = Math.floor(Math.random() * frases.length);
    return frases[idx].template
        .replace(/{de}/g, de)
        .replace(/{para}/g, para)
        .replace(/{musica}/g, musica)
        .replace(/{artista}/g, artista);
}

// ── MENSAGENS SIMPLES (mensagens.*) ─────────────────────────────────────────
function getMensagem(chave, variaveis = {}) {
    if (!config?.mensagens) {
        console.warn(`⚠️ getMensagem("${chave}"): config.mensagens não disponível`);
        return '';
    }
    let texto = config.mensagens[chave] || '';
    if (!texto) {
        console.warn(`⚠️ getMensagem: chave "${chave}" não encontrada em config.mensagens`);
    }
    for (const [k, v] of Object.entries(variaveis)) {
        texto = texto.replace(new RegExp(`{${k}}`, 'g'), v ?? '');
    }
    return texto;
}

// ── POSTERS (posters.*) ──────────────────────────────────────────────────────
function getPosterCaption(chave, variaveis = {}) {
    if (!config?.posters) {
        console.warn(`⚠️ getPosterCaption("${chave}"): config.posters não disponível`);
        return '';
    }
    let texto = config.posters[chave] || '';
    if (!texto) {
        console.warn(`⚠️ getPosterCaption: chave "${chave}" não encontrada em config.posters`);
    }
    for (const [k, v] of Object.entries(variaveis)) {
        texto = texto.replace(new RegExp(`{${k}}`, 'g'), v ?? '');
    }
    return texto;
}

// Monta caption com fallback: tenta posters, depois mensagens, depois texto padrão
function montarCaption(chave, variaveis = {}, fallbackTexto = '') {
    return getPosterCaption(chave, variaveis)
        || getMensagem(chave, variaveis)
        || fallbackTexto;
}

async function gerarThumbnail(buffer, size = 256) {
    try {
        const image = await Jimp.read(buffer);
        image.scaleToFit({ w: size, h: size });
        return await image.getBuffer("image/jpeg");
    } catch (err) {
        console.error('Erro ao gerar thumbnail:', err);
        return null;
    }
}

// Resolver sender real (evita @lid e JID de grupo)
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

// ============================================
// 🪙 FUNÇÕES DE DC (JUKEBOX) — iguais às do musicaHandler.js
// ============================================
function extractDigits(number) {
    if (!number) return null;
    return number.replace(/@.*$/, '').replace(/\D/g, '');
}

// Mesma lógica do musicaHandler/dcHandler/dcTransferHandler/lanceHandler/
// arrematarHandler: prioriza participantAlt pra bater com o user_id que o
// dcTracker.js usa pra creditar DC (evita cobrar de um @lid diferente).
function getNumeroReal(message) {
    if (message.key.participantAlt) return message.key.participantAlt;
    if (message.key.participant) return message.key.participant;
    return message.key.remoteJid;
}

// Cobra o custo em DC de forma atômica (evita corrida caso a pessoa mande
// dois #play muito rápido). Retorna { sucesso, saldoAtual }.
async function cobrarDcMusica(userId, valor) {
    // Garante que DCs recentes (ainda no buffer do dcTracker, aguardando o
    // flush periódico) já estejam gravados antes de checar o saldo.
    await flushDC();

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const saldoResult = await client.query(
            `SELECT saldo FROM damas_dc_wallets WHERE user_id = $1 FOR UPDATE`,
            [userId]
        );
        const saldoAtual = Number(saldoResult.rows[0]?.saldo || 0);

        if (saldoAtual < valor) {
            await client.query('ROLLBACK');
            return { sucesso: false, saldoAtual };
        }

        await client.query(
            `UPDATE damas_dc_wallets SET saldo = saldo - $1, atualizado_em = NOW() WHERE user_id = $2`,
            [valor, userId]
        );

        await client.query('COMMIT');
        return { sucesso: true, saldoAtual: saldoAtual - valor };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

// ── PARSEAR COMANDO ──────────────────────────────────────────────────────────
// Aceita as variações (igual ao musicaHandler):
//   "#play música @pessoa"            (formato antigo)
//   "#play30dc música @pessoa"
//   "#play 30dc música @pessoa"
//   "#play 30 dc música @pessoa"
// A palavra "dc" é sempre exigida pra remover o número do termo — assim
// "#play 21 guns @pessoa" continua buscando "21 guns".
// O número digitado é só sintaxe/lembrete — o valor cobrado é sempre CUSTO_MUSICA.
function parsearComando(content, message) {
    let semPrefixo = content
        .replace(/^#play/i, '')
        .trim();

    const matchComDc = semPrefixo.match(/^(\d+)\s*dc\b\s*(.*)$/i);
    if (matchComDc) {
        semPrefixo = matchComDc[2].trim();
    }

    const mentionedJids =
        message.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];

    const atMatch = semPrefixo.match(/@(\S+)/);
    const nomeExibicao = atMatch
        ? atMatch[1].replace(/\d+/g, '').trim() || null
        : null;

    const termoLimpo = semPrefixo
        .replace(/@\d+/g, '')
        .replace(/@\w+/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    console.log(`🧹 [DEDICATÓRIA] Termo limpo: "${termoLimpo}"`);

    // termo pode vir vazio: o handler principal mostra a mensagem de uso
    return { termo: termoLimpo, mentionedJids, nomeExibicao };
}

// ── 🖼️ POSTER LOCAL ──────────────────────────────────────────────────────────
// Lê do disco uma única vez e mantém em memória: as próximas dedicatórias
// são instantâneas (sem download).
let posterCache = null;
let posterThumbCache = null;
// Poster usado na frase romântica/poema final
let posterPoemasCache = null;
let posterPoemasThumbCache = null;

async function carregarPosterLocal() {
    if (posterCache) return posterCache;

    try {
        posterCache = await fs.promises.readFile(POSTER_LOCAL);
        console.log(`✅ Poster local carregado: ${posterCache.length} bytes`);
        return posterCache;
    } catch (err) {
        console.warn(`⚠️ Poster local não encontrado em ${POSTER_LOCAL}:`, err.message);
        return null;
    }
}

async function carregarPosterPoemasLocal() {
    if (posterPoemasCache) return posterPoemasCache;

    try {
        posterPoemasCache = await fs.promises.readFile(POSTER_POEMAS_LOCAL);
        console.log(`✅ Poster de poemas carregado: ${posterPoemasCache.length} bytes`);
        return posterPoemasCache;
    } catch (err) {
        console.warn(`⚠️ Poster de poemas não encontrado em ${POSTER_POEMAS_LOCAL}:`, err.message);
        return null;
    }
}

function extrairVideoId(url) {
    const patterns = [
        /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
        /\/vi_webp\/([a-zA-Z0-9_-]{11})\//,
        /\/vi\/([a-zA-Z0-9_-]{11})\//,
        /^([a-zA-Z0-9_-]{11})$/
    ];
    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match) return match[1];
    }
    return null;
}

async function baixarThumbnail(url) {
    const videoId = extrairVideoId(url);
    const urls = videoId ? [
        `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
        `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
        url
    ] : [url];

    for (const u of urls) {
        try {
            const response = await axios.get(u, {
                responseType: 'arraybuffer',
                timeout: 10000,
                headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'image/*' },
                validateStatus: s => s === 200
            });
            const buf = Buffer.from(response.data);
            if (buf.length < 5000) continue;
            const image = await Jimp.read(buf);
            image.scaleToFit({ w: 1280, h: 720 });
            return await image.getBuffer("image/jpeg");
        } catch { continue; }
    }
    return null;
}

// ── PROCESSAMENTO PRINCIPAL ──────────────────────────────────────────────────

async function processarDedicatoria(sock, from, termo, senderId, mentionedJids, nomeExibicao, originalMessage) {
    const caminhoTemp = path.join('./downloads', `temp_dedic_${Date.now()}.mp3`);

    const numeroRemetente = senderId.split('@')[0];
    const nomeQuemPediu = `@${numeroRemetente}`;

    const destinatarioJid = mentionedJids.length > 0 ? mentionedJids[0] : null;
    const nomeDestinatario = destinatarioJid
        ? `@${destinatarioJid.split('@')[0]}`
        : (nomeExibicao ? `@${nomeExibicao}` : 'você');
    const allMentions = [senderId, ...(destinatarioJid ? [destinatarioJid] : [])];

    const replyContext = {
        stanzaId: originalMessage.key.id,
        participant: originalMessage.key.participant || originalMessage.key.remoteJid,
        quotedMessage: originalMessage.message
    };

    try {
        // ── 1. POSTER INICIAL (LOCAL) ────────────────────────────────────────
        const posterBuffer = await carregarPosterLocal();

        const captionAviso = montarCaption('aviso_inicial', {
            destinatario: nomeDestinatario,
            remetente: nomeQuemPediu,
            termo
        }, `🎵 Procurando *${termo}* para ${nomeDestinatario}... aguarde!`);

        if (posterBuffer) {
            // Miniatura em cache: é sempre a mesma imagem
            if (!posterThumbCache) posterThumbCache = await gerarThumbnail(posterBuffer, 256);
            const thumb = posterThumbCache;

            try {
                await sock.sendMessage(from, {
                    image: posterBuffer,
                    caption: captionAviso,
                    mentions: allMentions,
                    jpegThumbnail: thumb,
                    contextInfo: replyContext
                });
                console.log('✅ Poster da dedicatória enviado!');
            } catch (e) {
                console.warn('⚠️ Falha ao enviar poster, enviando texto:', e.message);
                await sock.sendMessage(from, {
                    text: captionAviso,
                    mentions: allMentions,
                    quoted: originalMessage
                });
            }
        } else {
            await sock.sendMessage(from, {
                text: captionAviso,
                mentions: allMentions,
                quoted: originalMessage
            });
        }

        // ── 2. BUSCA A MÚSICA ────────────────────────────────────────────────
        console.log(`🔍 [DEDICATÓRIA] Buscando: "${termo}"`);
        const urlResult = await buscarUrlPorNome(termo);
        const dados = await obterDadosMusica(urlResult);
        console.log(`🎵 Encontrada: ${dados.titulo} — ${dados.autor}`);

        // ── 3. THUMBNAIL + INFO ──────────────────────────────────────────────
        let thumbnailBuffer = null;
        if (dados.thumbnailUrl) thumbnailBuffer = await baixarThumbnail(dados.thumbnailUrl);

        const captionInfo = montarCaption('musica_encontrada', {
            titulo: dados.titulo,
            artista: dados.autor,
            duracao: formatarDuracao(dados.duracao),
            remetente: nomeQuemPediu,
            destinatario: nomeDestinatario
        }, `🎶 *${dados.titulo}* — ${dados.autor}\n⏱️ ${formatarDuracao(dados.duracao)}`);

        if (thumbnailBuffer) {
            const thumb = await gerarThumbnail(thumbnailBuffer, 256);
            try {
                await sock.sendMessage(from, {
                    image: thumbnailBuffer,
                    caption: captionInfo,
                    mentions: allMentions,
                    jpegThumbnail: thumb,
                    contextInfo: replyContext
                });
            } catch {
                await sock.sendMessage(from, { text: captionInfo, mentions: allMentions });
            }
        } else {
            await sock.sendMessage(from, { text: captionInfo, mentions: allMentions });
        }

        // ── 4. DOWNLOAD DO ÁUDIO ─────────────────────────────────────────────
        console.log(`⬇️ [DEDICATÓRIA] Baixando áudio...`);
        const result = await baixarMusicaBuffer(urlResult);
        const nomeFormatado = limparNomeArquivo(`${dados.autor} - ${dados.titulo}`);
        const nomeArquivo = `${nomeFormatado}.mp3`;
        const caminhoFinal = path.join('./downloads', nomeArquivo);

        fs.writeFileSync(caminhoTemp, result.buffer);
        if (fs.existsSync(caminhoFinal)) fs.unlinkSync(caminhoFinal);
        fs.renameSync(caminhoTemp, caminhoFinal);

        // ── 5. ENVIA O ÁUDIO ─────────────────────────────────────────────────
        console.log(`📤 [DEDICATÓRIA] Enviando: ${nomeArquivo}`);
        await sock.sendMessage(from, {
            audio: fs.readFileSync(caminhoFinal),
            mimetype: 'audio/mpeg',
            fileName: nomeArquivo,
            ptt: false,
            contextInfo: replyContext
        });

        // ── 6. MENSAGEM ROMÂNTICA FINAL (POEMA) ──────────────────────────────
        const nomeParaExibicao = destinatarioJid
            ? destinatarioJid.split('@')[0]
            : (nomeExibicao || 'você');

        const mensagemRomantica = fraseAleatoria(
            `@${numeroRemetente}`,
            `@${nomeParaExibicao}`,
            dados.titulo,
            dados.autor
        );

        await new Promise(r => setTimeout(r, 800));

        const posterPoemaBuffer = await carregarPosterPoemasLocal();

        if (posterPoemaBuffer) {
            if (!posterPoemasThumbCache) posterPoemasThumbCache = await gerarThumbnail(posterPoemaBuffer, 256);
            const thumbPoema = posterPoemasThumbCache;

            try {
                await sock.sendMessage(from, {
                    image: posterPoemaBuffer,
                    caption: mensagemRomantica,
                    mentions: allMentions,
                    jpegThumbnail: thumbPoema
                });
            } catch (e) {
                console.warn('⚠️ Falha ao enviar poster do poema, enviando texto:', e.message);
                await sock.sendMessage(from, {
                    text: mensagemRomantica,
                    mentions: allMentions
                });
            }
        } else {
            await sock.sendMessage(from, {
                text: mensagemRomantica,
                mentions: allMentions
            });
        }

        if (fs.existsSync(caminhoFinal)) fs.unlinkSync(caminhoFinal);
        console.log(`✅ [DEDICATÓRIA] Concluída com sucesso!`);

    } catch (err) {
        console.error('❌ [DEDICATÓRIA] Erro:', err.message);
        if (fs.existsSync(caminhoTemp)) fs.unlinkSync(caminhoTemp);

        const chaveErro = err.message?.includes('timeout') ? 'erro_timeout' : 'erro_nao_encontrado';

        // Fallback seguro se config.mensagens não estiver disponível
        const mensagemErro = getMensagem(chaveErro, { termo })
            || (chaveErro === 'erro_timeout'
                ? `⏱️ Tempo esgotado ao buscar *${termo}*. Tente novamente.`
                : `❌ Não encontrei *${termo}*. Tente outro nome ou artista.`);

        await sock.sendMessage(from, {
            text: `${nomeQuemPediu}\n\n${mensagemErro}`,
            mentions: [senderId],
            quoted: originalMessage
        });
    }
}

// ── FILA ─────────────────────────────────────────────────────────────────────

async function processarFila() {
    if (processandoDedicatoria || filaDedicatorias.length === 0) return;
    processandoDedicatoria = true;

    const item = filaDedicatorias.shift();
    try {
        await processarDedicatoria(
            item.sock, item.from, item.termo,
            item.senderId, item.mentionedJids,
            item.nomeExibicao, item.originalMessage
        );
    } catch (err) {
        console.error('Erro na fila de dedicatórias:', err);
    } finally {
        processandoDedicatoria = false;
        if (filaDedicatorias.length > 0) setTimeout(() => processarFila(), 2000);
    }
}

// ── RELOAD CONFIG VIA COMANDO ────────────────────────────────────────────────

export async function handleReloadConfig(sock, message, from) {
    const content =
        message.message?.conversation ||
        message.message?.extendedTextMessage?.text || '';

    if (!/^#atualizarmusicas$/i.test(content.trim())) return false;

    const senderId = resolverSenderId(message);

    await sock.sendMessage(from, {
        text: '🔄 Recarregando configuração do GitHub...',
        mentions: [senderId],
        quoted: message
    });

    try {
        await carregarConfigDedicatoria();

        // Também limpa o cache dos posters locais, caso você tenha trocado as imagens
        posterCache = null;
        posterThumbCache = null;
        posterPoemasCache = null;
        posterPoemasThumbCache = null;

        await sock.sendMessage(from, {
            text: '✅ Config atualizada com sucesso! Novas frases e poster já estão valendo.',
            mentions: [senderId],
            quoted: message
        });
        console.log('✅ [RELOAD] Config recarregada via comando.');
    } catch (err) {
        await sock.sendMessage(from, {
            text: `❌ Erro ao recarregar config: ${err.message}`,
            mentions: [senderId],
            quoted: message
        });
        console.error('❌ [RELOAD] Falha ao recarregar config:', err.message);
    }

    return true;
}

// ── HANDLER PRINCIPAL ────────────────────────────────────────────────────────

export async function handleDedicatoriaCommands(sock, message, from) {
    const content =
        message.message?.conversation ||
        message.message?.extendedTextMessage?.text || '';

    // Aceita "#play" seguido de dígito, espaço, ou fim de string —
    // cobre "#play30dc...", "#play 30dc...", "#play sonho..." etc.
    if (!/^#play(?=\d|\s|$)/i.test(content.trim())) return false;

    const temMencaoNoTexto = /@\S+/.test(content);
    const temMencaoResolvida =
        (message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.length || 0) > 0;

    // Sem @menção = é #play normal, deixa o musicaHandler tratar
    if (!temMencaoNoTexto && !temMencaoResolvida) return false;

    const parsed = parsearComando(content.trim(), message);
    if (!parsed) return false;

    const { termo, mentionedJids, nomeExibicao } = parsed;

    const senderId = resolverSenderId(message);
    console.log(`🎙️ [DEDICATÓRIA] senderId resolvido: ${senderId}`);

    // Garante config antes de usar getMensagem
    await garantirConfig();

    if (!termo) {
        const textoUso = getMensagem('uso_comando')
            || `📌 Uso correto: *#play ${CUSTO_MUSICA}dc [música] @pessoa*\nExemplo: _#play ${CUSTO_MUSICA}dc Sonho de Ícaro @monica_`;
        await sock.sendMessage(from, {
            text: textoUso,
            mentions: [senderId],
            quoted: message
        });
        return true;
    }

    // ── 🪙 JUKEBOX: COBRA O CUSTO EM DC ANTES DE LIBERAR A DEDICATÓRIA ───
    // Usa getNumeroReal() (igual ao musicaHandler) pra bater com o user_id
    // que o dcTracker.js usa pra creditar DC.
    const senderIdDC = getNumeroReal(message);
    const senderIdDigits = extractDigits(senderIdDC);

    let cobranca;
    try {
        cobranca = await cobrarDcMusica(senderIdDigits, CUSTO_MUSICA);
    } catch (err) {
        console.error('[handleDedicatoriaCommands] Erro ao cobrar DC:', err.message);
        await sock.sendMessage(from, {
            text: `@${senderId.split('@')[0]}\n\n❌ Deu erro ao consultar seu saldo de DC. Tenta de novo daqui a pouco.`,
            mentions: [senderId],
            quoted: message
        });
        return true;
    }

    if (!cobranca.sucesso) {
        await sock.sendMessage(from, {
            text: `@${senderId.split('@')[0]}\n\n❌ Saldo insuficiente! 🪙\nVocê tem apenas *${cobranca.saldoAtual.toLocaleString('pt-BR')} DC*, e a dedicatória custa *${CUSTO_MUSICA} DC*.\n\n💬 Continue conversando no grupo Damas e juntando suas DCs pra dedicar músicas! 💃🕺`,
            mentions: [senderId],
            quoted: message
        });
        return true;
    }

    const destinatarioConfirm = mentionedJids.length > 0
        ? `@${mentionedJids[0].split('@')[0]}`
        : (nomeExibicao ? `@${nomeExibicao}` : 'alguém especial');

    await sock.sendMessage(from, {
        text: `💌 🅓🅔🅓🅘🅒🅐🅣🅞́🅡🅘🅐 🅜🅤🅢🅘🅒🅐🅛 💌\n` +
              `👤 @${senderId.split('@')[0]} dedicou *${termo}* para ${destinatarioConfirm}\n\n` +
              `✅ Pagamento confirmado!\n` +
              `🪙 ${CUSTO_MUSICA} *DCs debitados da carteira*.\n\n` +
              `💬 Continue conversando no grupo DﾑMﾑS e juntando suas DCs pra dedicar mais músicas! 💃🕺`,
        mentions: [senderId, ...mentionedJids.slice(0, 1)],
        quoted: message
    });
    // ──────────────────────────────────────────────────────────────────────

    filaDedicatorias.push({
        sock, from, termo, senderId,
        mentionedJids, nomeExibicao,
        originalMessage: message
    });

    if (filaDedicatorias.length > 1) {
        const textoFila = getMensagem('na_fila', { posicao: filaDedicatorias.length })
            || `⏳ Sua dedicatória está na posição ${filaDedicatorias.length} da fila.`;
        await sock.sendMessage(from, {
            text: textoFila,
            mentions: [senderId],
            quoted: message
        });
    }

    processarFila();
    return true;
}

// Inicialização
carregarConfigDedicatoria().catch(err =>
    console.error('❌ Erro ao inicializar config dedicatória:', err)
);