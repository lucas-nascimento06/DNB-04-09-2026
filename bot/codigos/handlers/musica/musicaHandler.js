// bot/codigos/handlers/musica/musicaHandler.js
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { Jimp } from 'jimp';
import { fileURLToPath } from 'url';
import { baixarMusicaBuffer, obterDadosMusica, buscarUrlPorNome } from './download.util.js';
import pool from '../../../../db.js';
import { flushDC } from '../../features/dcTracker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let processandoMusica = false;
const filaMusicas = [];

// ============================================
// 🪙 CUSTO EM DC PARA LIBERAR UMA MÚSICA (JUKEBOX)
// ============================================
const CUSTO_MUSICA = 30;

// ============================================
// 🖼️ FOTOS LOCAIS DO POSTER (pasta bot/codigos/foto-musicas)
// ✨ Sorteadas ALEATORIAMENTE a cada #play, evitando repetir
//    a mesma imagem duas vezes seguidas.
// ============================================
let ultimoPosterIndice = -1;
const PASTA_FOTOS_MUSICA = path.join(__dirname, '../../foto-musicas');

function listarFotosMusica() {
    try {
        const arquivos = fs.readdirSync(PASTA_FOTOS_MUSICA)
            .filter(f => /\.(jpe?g|png|webp)$/i.test(f))
            .sort(); // ordem estável (alfabética) entre reinícios do bot
        return arquivos;
    } catch (err) {
        console.error('❌ Erro ao listar fotos em foto-musicas:', err.message);
        return [];
    }
}

function limparNomeArquivo(nome) {
    return nome
        .replace(/[<>:"/\\|?*]/g, '')
        .replace(/\s+/g, '_')
        .substring(0, 100);
}

// ============================================
// ✍️ v2 — NORMALIZA "# play" -> "#play"
// Remove só o(s) espaço(s) logo depois do "#". Necessário porque este
// handler relê a mensagem crua (message.message.*) e não o texto que o
// messageHandler já normalizou.
// ============================================
function normalizarTexto(texto) {
    if (!texto) return '';
    return texto.replace(/#[ \t]+(?=\S)/g, '#');
}

// ============================================
// 🧹 REMOVE SUFIXO "- Topic" DO NOME DO ARTISTA
// (vem de canais auto-gerados do YouTube, ex: "Leandro & Leonardo - Topic")
// ============================================
function limparNomeArtista(nome) {
    if (!nome) return nome;
    return nome
        .replace(/\s*-\s*Topic\s*$/i, '')
        .trim();
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

function formatarDuracao(segundos) {
    if (!segundos) return '0:00';
    const minutos = Math.floor(segundos / 60);
    const segs = segundos % 60;
    return `${minutos}:${segs.toString().padStart(2, '0')}`;
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
        if (match) {
            console.log(`✅ VideoID extraído: ${match[1]}`);
            return match[1];
        }
    }
    return null;
}

function gerarUrlsThumbnail(url) {
    const videoId = extrairVideoId(url);
    if (!videoId) return [url];
    console.log(`🔄 Gerando URLs alternativas para VideoID: ${videoId}`);
    return [
        `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
        `https://i.ytimg.com/vi/${videoId}/sddefault.jpg`,
        `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
        `https://i.ytimg.com/vi/${videoId}/default.jpg`,
        url
    ];
}

async function baixarThumbnailComJimp(url) {
    const urlsParaTestar = gerarUrlsThumbnail(url);
    console.log(`📋 Total de URLs para testar: ${urlsParaTestar.length}`);

    for (let i = 0; i < urlsParaTestar.length; i++) {
        const urlAtual = urlsParaTestar[i];
        try {
            console.log(`🖼️ Tentativa ${i + 1}/${urlsParaTestar.length}: ${urlAtual}`);
            const response = await axios.get(urlAtual, {
                responseType: 'arraybuffer',
                timeout: 10000,
                headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'image/*' },
                maxRedirects: 5,
                validateStatus: (status) => status === 200
            });

            const imageBuffer = Buffer.from(response.data);
            console.log(`📦 Buffer baixado: ${imageBuffer.length} bytes`);

            if (imageBuffer.length < 5000) {
                console.log(`⚠️ Imagem muito pequena, tentando próxima...`);
                continue;
            }

            const image = await Jimp.read(imageBuffer);
            console.log(`📐 Dimensões originais: ${image.bitmap.width}x${image.bitmap.height}`);

            if (image.bitmap.width > 1280 || image.bitmap.height > 720) {
                image.scaleToFit({ w: 1280, h: 720 });
            }

            const processedBuffer = await image.getBuffer("image/jpeg");
            console.log(`✅ Imagem processada: ${processedBuffer.length} bytes`);

            if (processedBuffer.length > 5 * 1024 * 1024) {
                image.scaleToFit({ w: 640, h: 360 });
                return await image.getBuffer("image/jpeg");
            }

            return processedBuffer;
        } catch (error) {
            console.log(`⚠️ Falha na URL ${i + 1}: ${error.message}`);
        }
    }

    console.error('❌ Todas as URLs de thumbnail falharam');
    return null;
}

// ============================================
// 🖼️ POSTER INICIAL — lido SOMENTE da pasta local foto-musicas,
// escolhido de forma ALEATÓRIA. Não busca mais nenhuma imagem por link.
// Se a pasta estiver vazia ou der erro, retorna null (o fluxo já
// trata isso enviando só o texto, sem imagem).
// ============================================
async function baixarImagemPoster() {
    try {
        const fotos = listarFotosMusica();

        if (fotos.length === 0) {
            console.warn('⚠️ Nenhuma foto encontrada em foto-musicas. Nenhum poster será enviado.');
            return null;
        }

        let indice = Math.floor(Math.random() * fotos.length);

        // Se sorteou a mesma da vez anterior, empurra pra outra posição
        // (só faz sentido quando existe mais de uma foto na pasta)
        if (fotos.length > 1 && indice === ultimoPosterIndice) {
            indice = (indice + 1 + Math.floor(Math.random() * (fotos.length - 1))) % fotos.length;
        }

        ultimoPosterIndice = indice;

        const nomeArquivo = fotos[indice];
        const caminhoCompleto = path.join(PASTA_FOTOS_MUSICA, nomeArquivo);

        console.log(`🖼️ Poster local sorteado [${indice + 1}/${fotos.length}]: ${nomeArquivo}`);

        const buffer = fs.readFileSync(caminhoCompleto);
        console.log(`✅ Poster local lido: ${(buffer.length / 1024).toFixed(2)} KB`);
        return buffer;
    } catch (error) {
        console.error('❌ Erro ao ler poster local:', error.message);
        return null;
    }
}

async function sendMediaWithThumbnail(sock, jid, buffer, caption, mentions = []) {
    try {
        const thumb = await gerarThumbnail(buffer, 256);
        await sock.sendMessage(jid, { image: buffer, caption, mentions, jpegThumbnail: thumb });
        console.log('✅ Imagem enviada com thumbnail!');
        return true;
    } catch (err) {
        console.error('❌ Erro ao enviar com thumbnail:', err.message);
        try {
            await sock.sendMessage(jid, { image: buffer, caption, mentions });
            console.log('✅ Imagem enviada sem thumbnail (fallback)!');
            return true;
        } catch (err2) {
            console.error('❌ Erro ao enviar imagem (fallback):', err2.message);
            return false;
        }
    }
}

// ============================================
// 🪙 FUNÇÕES DE DC (JUKEBOX)
// ============================================
function extractDigits(number) {
    if (!number) return null;
    return number.replace(/@.*$/, '').replace(/\D/g, '');
}

// ✅ FIX: em grupos com privacidade LID ativada, "message.key.participant"
// pode vir como um @lid (identificador oculto) diferente do número real
// usado pelo dcTracker.js pra creditar DC (que prioriza participantAlt).
// Sem essa função, o musicaHandler cobrava DC de um user_id diferente do
// que tinha saldo, e por isso a compra sempre dava "saldo insuficiente"
// mesmo com o #dc mostrando saldo correto. Mesma lógica usada em
// dcHandler.js, dcTransferHandler.js, lanceHandler.js e arrematarHandler.js.
function getNumeroReal(message) {
    if (message.key.participantAlt) return message.key.participantAlt;
    if (message.key.participant) return message.key.participant;
    return message.key.remoteJid;
}

// Cobra o custo da música em DC, de forma atômica (evita corrida caso a
// pessoa mande dois #play muito rápido). Retorna { sucesso, saldoAtual }.
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

async function processarFila() {
    if (processandoMusica || filaMusicas.length === 0) return;
    processandoMusica = true;
    const { sock, from, termo, senderId, messageKey, originalMessage } = filaMusicas.shift();
    try {
        await baixarEEnviarMusica(sock, from, termo, senderId, messageKey, originalMessage);
    } catch (error) {
        console.error('Erro ao processar música da fila:', error);
    } finally {
        processandoMusica = false;
        if (filaMusicas.length > 0) setTimeout(() => processarFila(), 2000);
    }
}

async function baixarEEnviarMusica(sock, from, termo, senderId, messageKey, originalMessage) {
    const caminhoCompleto = path.join('./downloads', `temp_${Date.now()}.mp3`);
    let dados = null;
    let url = null;

    try {
        // ── 1. POSTER INICIAL ────────────────────────────────────────────────
        console.log('📸 Iniciando download do poster...');
        const posterBuffer = await baixarImagemPoster();

        const captionPoster =
            `👏🍻 *DﾑMﾑS* 💃🔥 *Dﾑ* *NIGӇԵ* 💃🎶🍾🍸\n\n` +
            `@${senderId.split('@')[0]}\n\n` +
            `🎧🎶 Preparando pra te entregar o hit: "${termo}"! 🎶💃🕺🔥\n\n` +
            `💡 *DICA DE OURO:* 🎯\n` +
            `Para resultados mais precisos use:\n` +
            `📝 *#play [cantor/banda - música]*\n` +
            `✨ Exemplo: _#play Bon Jovi - Always_`;

        if (posterBuffer) {
            console.log('✅ Poster carregado, enviando...');
            const enviado = await sendMediaWithThumbnail(sock, from, posterBuffer, captionPoster, [senderId]);
            if (!enviado) {
                await sock.sendMessage(from, { text: captionPoster, mentions: [senderId], quoted: originalMessage });
            }
        } else {
            await sock.sendMessage(from, { text: captionPoster, mentions: [senderId], quoted: originalMessage });
        }

        // ── 2. BUSCA DADOS DA MÚSICA ─────────────────────────────────────────
        console.log(`🔍 Buscando: ${termo}`);
        url = await buscarUrlPorNome(termo);

        console.log(`📊 Obtendo dados da música...`);
        dados = await obterDadosMusica(url);

        // 🧹 Remove sufixo "- Topic" (canais auto-gerados do YouTube)
        dados.autor = limparNomeArtista(dados.autor);
        dados.titulo = limparNomeArtista(dados.titulo);

        console.log(`📄 Dados obtidos: ${dados.titulo} - ${dados.autor}`);

        // ── 3. THUMBNAIL + INFO ──────────────────────────────────────────────
        let thumbnailEnviada = false;
        if (dados.thumbnailUrl) {
            console.log(`🖼️ Processando thumbnail...`);
            const thumbnailBuffer = await baixarThumbnailComJimp(dados.thumbnailUrl);

            if (thumbnailBuffer) {
                try {
                    const thumb = await gerarThumbnail(thumbnailBuffer, 256);
                    await new Promise(resolve => setTimeout(resolve, 500));
                    await sock.sendMessage(from, {
                        image: thumbnailBuffer,
                        caption:
                            `👏🍻 *DﾑMﾑS* 💃🔥 *Dﾑ* *NIGӇԵ* 💃🎶🍾🍸\n\n` +
                            `♫♪♩·.¸¸.·♩♪♫ ෴💞෴ ෴💞෴\n\n` +
                            `🎼 *${dados.titulo}*\n` +
                            `🎙️ *${dados.autor}*\n` +
                            `⏰ Duração: ${formatarDuracao(dados.duracao)}\n\n` +
                            `♫♪♩·.¸¸.·♩♪♫ ෴💞෴ ෴💞෴\n\n` +
                            `#NoitePerfeita #DamasDaNight #VibeBoa\n\n` +
                            `@${senderId.split('@')[0]}\n\n` +
                            `💃✨🅢🅘🅝🅣🅐 🅞 🅡🅘🅣🅜🅞. 🅑🅡🅘🅛🅗🅔 🅝🅐 🅟🅘🅢🅣🅐✨🕺\n` +
                            `⬇️ 𝙱𝙰𝙸𝚇𝙰𝙽𝙳𝙾 𝚂𝙴𝚄 𝙷𝙸𝚃... 🎧\n💃 𝙿𝚁𝙴𝙿𝙰𝚁𝙰 𝙿𝚁𝙰 𝙳𝙰𝙽𝙲̧𝙰𝚁! 🕺\n`+
                            `🔥 𝙰 𝙵𝙴𝚂𝚃𝙰 𝚅𝙰𝙸 𝙲𝙾𝙼𝙴𝙲̧𝙰𝚁! 🎉`,
                        jpegThumbnail: thumb,
                        mentions: [senderId],
                        contextInfo: {
                            stanzaId: originalMessage.key.id,
                            participant: originalMessage.key.participant || originalMessage.key.remoteJid,
                            quotedMessage: originalMessage.message
                        }
                    });
                    console.log(`✅ Thumbnail enviada!`);
                    thumbnailEnviada = true;
                } catch (sendErr) {
                    console.error('❌ Erro ao enviar thumbnail:', sendErr.message);
                }
            }
        }

        if (!thumbnailEnviada) {
            await sock.sendMessage(from, {
                text:
                    `💃🔥 *DﾑMﾑS Dﾑ NIGӇԵ* 🔥💃\n\n` +
                    `🎵 *${dados.titulo}*\n` +
                    `🎤 *${dados.autor}*\n` +
                    `⏱️ Duração: ${formatarDuracao(dados.duracao)}\n\n` +
                    `@${senderId.split('@')[0]}\n\n` +
                    `⬇️ Baixando... 🎧`,
                mentions: [senderId],
                contextInfo: {
                    stanzaId: originalMessage.key.id,
                    participant: originalMessage.key.participant || originalMessage.key.remoteJid,
                    quotedMessage: originalMessage.message
                }
            });
        }

        // ── 4. DOWNLOAD E ENVIO DO ÁUDIO ─────────────────────────────────────
        console.log(`⬇️ Baixando áudio: ${dados.titulo} - ${dados.autor}`);
        const result = await baixarMusicaBuffer(url);

        const nomeFormatado = limparNomeArquivo(`${dados.autor} - ${dados.titulo}`);
        const nomeArquivo = `${nomeFormatado}.mp3`;
        const caminhoFinal = path.join('./downloads', nomeArquivo);

        fs.writeFileSync(caminhoCompleto, result.buffer);
        if (fs.existsSync(caminhoFinal)) fs.unlinkSync(caminhoFinal);
        fs.renameSync(caminhoCompleto, caminhoFinal);

        console.log(`📤 Enviando áudio: ${nomeArquivo}`);
        try {
            const sentAudio = await sock.sendMessage(from, {
                audio: fs.readFileSync(caminhoFinal),
                mimetype: 'audio/mpeg',
                fileName: nomeArquivo,
                ptt: false,
                contextInfo: {
                    stanzaId: originalMessage.key.id,
                    participant: originalMessage.key.participant || originalMessage.key.remoteJid,
                    quotedMessage: originalMessage.message
                }
            });
            console.log(`✅ Áudio enviado!`, sentAudio?.key);
        } catch (audioErr) {
            console.error(`❌ Erro ao enviar áudio:`, audioErr.message);
        }

        if (fs.existsSync(caminhoFinal)) fs.unlinkSync(caminhoFinal);

        console.log(`✅ Música enviada com sucesso!`);

    } catch (err) {
        console.error('❌ Erro ao processar música:', err);
        if (fs.existsSync(caminhoCompleto)) fs.unlinkSync(caminhoCompleto);

        let mensagemErro = `❌ Ops! Não consegui baixar "${termo}".`;
        if (err.message?.includes('EBUSY')) {
            mensagemErro += '\n⏳ Bot ocupado, tente novamente em instantes.';
        } else if (err.message?.includes('No video found')) {
            mensagemErro += '\n🔍 Não encontrei. Tente: [música - cantor/banda]';
        } else if (err.message?.includes('timeout')) {
            mensagemErro += '\n⏱️ Tempo esgotado. Tente uma música mais curta.';
        }

        await sock.sendMessage(from, {
            text: `@${senderId.split('@')[0]}\n\n${mensagemErro}`,
            mentions: [senderId],
            quoted: originalMessage
        });
    }
}

export async function handleMusicaCommands(sock, message, from) {
    const contentBruto = message.message?.conversation ||
                         message.message?.extendedTextMessage?.text || '';

    // ✍️ "# play" -> "#play" (este handler relê a mensagem crua)
    const content = normalizarTexto(contentBruto);
    const contentTrim = content.trim();

    // Aceita "#play" seguido de dígito, espaço, ou fim de string —
    // cobre "#play30dc...", "#play 30dc...", "#play djavan..." etc,
    // sem depender de espaço fixo logo após o "#play".
    if (!/^#play(?=\d|\s|$)/i.test(contentTrim)) return false;

    // Se tiver @menção = é dedicatória, deixa o dedicatoriaHandler tratar
    const temMencaoNoTexto = /@\S+/.test(content);
    const temMencaoResolvida = (message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.length || 0) > 0;
    if (temMencaoNoTexto || temMencaoResolvida) return false;

    // Aceita as variações: "#play djavan oceano" (formato antigo),
    // "#play30dc djavan oceano", "#play 30dc djavan oceano" e
    // "#play 30 dc djavan oceano". A palavra "dc" é sempre exigida pra
    // remover o número do termo — assim "#play 21 guns" continua
    // buscando "21 guns" (o "21" não some por engano).
    // O número digitado é só sintaxe/lembrete — o valor cobrado é sempre
    // o de CUSTO_MUSICA, definido acima.
    const restante = contentTrim.replace(/^#play/i, '').trim();

    let termo = restante;
    const matchComDc = restante.match(/^(\d+)\s*dc\b\s*(.*)$/i);
    if (matchComDc) {
        termo = matchComDc[2].trim();
    }

    // ✅ FIX: antes era "message.key.participant || message.key.remoteJid",
    // que em grupos com privacidade LID ativada podia gerar um ID diferente
    // do usado pelo dcTracker.js pra creditar DC (que prioriza
    // participantAlt). Agora usa getNumeroReal(), igual aos outros handlers
    // de DC (dcHandler, dcTransferHandler, lanceHandler, arrematarHandler).
    const senderId = getNumeroReal(message);
    const messageKey = message.key;
    const originalMessage = message;

    console.log(`👤 SenderId extraído: ${senderId}`);

    if (!termo) {
        await sock.sendMessage(from, {
            text: `@${senderId.split('@')[0]}\n\nUso correto: *#play ${CUSTO_MUSICA}dc [cantor/banda - música]*\nExemplo: _#play ${CUSTO_MUSICA}dc Bon Jovi - Always_`,
            mentions: [senderId],
            quoted: originalMessage
        });
        return true;
    }

    // ── 🪙 JUKEBOX: COBRA O CUSTO EM DC ANTES DE LIBERAR A MÚSICA ────────
    const senderIdDigits = extractDigits(senderId);
    let cobranca;
    try {
        cobranca = await cobrarDcMusica(senderIdDigits, CUSTO_MUSICA);
    } catch (err) {
        console.error('[handleMusicaCommands] Erro ao cobrar DC:', err.message);
        await sock.sendMessage(from, {
            text: `@${senderId.split('@')[0]}\n\n❌ Deu erro ao consultar seu saldo de DC. Tenta de novo daqui a pouco.`,
            mentions: [senderId],
            quoted: originalMessage
        });
        return true;
    }

    if (!cobranca.sucesso) {
        await sock.sendMessage(from, {
            text: `@${senderId.split('@')[0]}\n\n❌ Saldo insuficiente! 🪙\nVocê tem apenas *${cobranca.saldoAtual.toLocaleString('pt-BR')} DC*, e a música custa *${CUSTO_MUSICA} DC*.\n\n💬 Continue conversando no grupo Damas e juntando suas DCs pra pedir músicas! 💃🕺`,
            mentions: [senderId],
            quoted: originalMessage
        });
        return true;
    }

    await sock.sendMessage(from, {
        text: `💃 🅟🅔🅓🅘🅓🅞 🅜🅤🅢🅘🅒🅐🅛 🕺\n` +
              `👤 @${senderId.split('@')[0]} pediu ${termo}\n\n` +
              `✅ Pagamento confirmado!\n` +
              `🪙 ${CUSTO_MUSICA} *DCs debitados da carteira*.\n\n` +
              `🔊 .¸¸.·♩♪♫ *SEGURA ESSA, DﾑMﾑS!* ♫♪♩·.¸¸.·\n` +
              `🎶 Solta o som! 🍻🔥\n\n` +
              `💬 Continue conversando no grupo DﾑMﾑS e juntando suas DCs pra pedir mais músicas! 💃🕺`,
        mentions: [senderId],
        quoted: originalMessage
    });
    // ──────────────────────────────────────────────────────────────────────

    filaMusicas.push({ sock, from, termo, senderId, messageKey, originalMessage });

    if (filaMusicas.length > 1) {
        await sock.sendMessage(from, {
            text: `@${senderId.split('@')[0]}\n\n⏳ Sua música está na fila! Posição: ${filaMusicas.length}\n💃 Aguarde um momento... 🎵`,
            mentions: [senderId],
            quoted: originalMessage
        });
    }

    processarFila();
    return true;
}