import pool from '../../../../db.js';
import { downloadMediaMessage } from '@whiskeysockets/baileys';
import { Jimp } from "jimp";

const PRAZO_DESAFIO_HORAS = 24;
const INTERVALO_EXPIRACAO_SQL = '24 hours';

// Cache do metadata dos grupos (evita chamar a API do WhatsApp a cada mensagem)
const METADATA_TTL_MS = 5 * 60 * 1000;
const metadataCache = new Map();

// Cache global para armazenar mensagens das provas (evita perder dados entre confirmações)
const cacheProvas = new Map();

function extractDigits(number) {
    if (!number) return null;
    return number.replace(/@.*$/, '').replace(/\D/g, '');
}

function getNumeroReal(message) {
    if (message.key.participantAlt) return message.key.participantAlt;
    if (message.key.participant) return message.key.participant;
    return message.key.remoteJid;
}

/**
 * Menções e reply ficam em lugares diferentes dependendo do tipo da mensagem:
 * texto puro -> extendedTextMessage.contextInfo
 * foto/vídeo com legenda -> imageMessage.contextInfo / videoMessage.contextInfo
 */
function getContextInfo(message) {
    const m = message.message;
    if (!m) return null;
    return m.extendedTextMessage?.contextInfo
        || m.imageMessage?.contextInfo
        || m.videoMessage?.contextInfo
        || m.documentMessage?.contextInfo
        || m.audioMessage?.contextInfo
        || m.stickerMessage?.contextInfo
        || null;
}

/** Pega o texto (ou legenda) da mensagem, seja qual for o tipo. */
function extrairTextoDaMensagem(message) {
    const m = message.message;
    if (!m) return '';
    return m.conversation
        || m.extendedTextMessage?.text
        || m.imageMessage?.caption
        || m.videoMessage?.caption
        || m.documentMessage?.caption
        || '';
}

async function obterMetadata(sock, groupId, forcar = false) {
    const cached = metadataCache.get(groupId);
    if (!forcar && cached && Date.now() - cached.ts < METADATA_TTL_MS) {
        return cached.meta;
    }
    const meta = await sock.groupMetadata(groupId);
    metadataCache.set(groupId, { meta, ts: Date.now() });
    return meta;
}

async function isAdmin(sock, groupId, userId) {
    try {
        // Sem cache aqui de propósito: o status de admin precisa estar sempre atualizado
        const meta = await sock.groupMetadata(groupId);
        const participante = meta.participants.find(p => {
            const idDigits = extractDigits(p.id);
            const phoneDigits = extractDigits(p.phoneNumber);
            return idDigits === userId || phoneDigits === userId;
        });
        return participante?.admin === 'admin' || participante?.admin === 'superadmin';
    } catch (err) {
        console.error('[desafioleilaoHandler] Erro ao checar admin:', err.message);
        return false;
    }
}

/**
 * Converte um JID (que pode ser @lid ou @s.whatsapp.net) no número de telefone real.
 * Se não conseguir resolver, devolve os dígitos do próprio JID (comportamento antigo).
 */
async function resolverNumeroRealDoMencionado(sock, groupId, mentionedJid) {
    if (!mentionedJid) return null;

    if (mentionedJid.endsWith('@s.whatsapp.net')) {
        return extractDigits(mentionedJid);
    }

    const buscar = (meta) => {
        const participante = meta.participants.find(
            p => p.id === mentionedJid || p.lid === mentionedJid
        );
        const numeroReal = participante?.jid || participante?.phoneNumber || participante?.pn || participante?.participantAlt;
        if (numeroReal && !String(numeroReal).includes('@lid')) {
            return extractDigits(numeroReal);
        }
        return null;
    };

    try {
        let resultado = buscar(await obterMetadata(sock, groupId));
        if (resultado) return resultado;

        // Não achou no cache: pode ser alguém que entrou depois, tenta atualizar uma vez
        resultado = buscar(await obterMetadata(sock, groupId, true));
        if (resultado) return resultado;
    } catch (err) {
        console.error('[resolverNumeroRealDoMencionado] Erro:', err.message);
    }

    return extractDigits(mentionedJid);
}

/**
 * Para IDs já salvos no banco (ex.: admin_id de desafios antigos que foram gravados com LID).
 * Se os dígitos baterem com o LID de algum participante, devolve o telefone real dele.
 * Caso contrário devolve o próprio valor salvo.
 */
async function resolverIdSalvo(sock, groupId, idSalvo) {
    if (!idSalvo) return idSalvo;

    try {
        const meta = await obterMetadata(sock, groupId);
        const participante = meta.participants.find(p =>
            extractDigits(p.id) === idSalvo || extractDigits(p.lid) === idSalvo
        );
        const numeroReal = participante?.phoneNumber || participante?.jid || participante?.pn;
        if (numeroReal && !String(numeroReal).includes('@lid')) {
            return extractDigits(numeroReal);
        }
    } catch (err) {
        console.warn('[desafioleilaoHandler] Erro ao resolver ID salvo:', err.message);
    }

    return idSalvo;
}

function extrairTextoExtra(content) {
    // Remove o #pronto (e o ID colado nele, se houver) de onde ele estiver no texto,
    // remove as menções e limpa os espaços.
    return (content || '')
        .replace(/#pronto\b(?:[ \t]+(?:id)?\d+\b)?/gi, ' ')
        .replace(/@[\w.]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

async function gerarThumbnail(buffer, size = 256) {
    try {
        const image = await Jimp.read(buffer);
        await image.scaleToFit(size, size);
        return await image.getBuffer("image/png");
    } catch (err) {
        console.warn('[desafioleilaoHandler] Erro ao gerar thumbnail:', err.message);
        return null;
    }
}

async function reenviarMidiaLimpa(sock, grupoDestino, mensagemComMidia, opcoes = {}) {
    const { caption = '', mentions = [] } = opcoes;
    const conteudo = mensagemComMidia.message;
    if (!conteudo) return false;

    const tipo = ['imageMessage', 'videoMessage', 'documentMessage', 'audioMessage', 'stickerMessage']
        .find(t => conteudo[t]);
    if (!tipo) return false;

    const mensagemSemComando = {
        ...mensagemComMidia,
        message: {
            ...conteudo,
            [tipo]: {
                ...conteudo[tipo],
                caption: ''
            }
        }
    };

    const buffer = await downloadMediaMessage(
        mensagemSemComando,
        'buffer',
        {},
        { reuploadRequest: sock.updateMediaMessage }
    );

    const suportaCaption = tipo === 'imageMessage' || tipo === 'videoMessage' || tipo === 'documentMessage';

    const payload = {};
    if (tipo === 'imageMessage') {
        payload.image = buffer;
        const thumb = await gerarThumbnail(buffer, 256);
        if (thumb) payload.jpegThumbnail = thumb;
    } else if (tipo === 'videoMessage') {
        payload.video = buffer;
    } else if (tipo === 'documentMessage') {
        payload.document = buffer;
        payload.mimetype = conteudo.documentMessage.mimetype;
        payload.fileName = conteudo.documentMessage.fileName || 'comprovacao';
    } else if (tipo === 'audioMessage') {
        payload.audio = buffer;
        payload.mimetype = conteudo.audioMessage.mimetype || 'audio/ogg; codecs=opus';
        payload.ptt = !!conteudo.audioMessage.ptt;
    } else if (tipo === 'stickerMessage') {
        payload.sticker = buffer;
    }

    if (suportaCaption && caption) {
        payload.caption = caption;
        if (mentions.length) payload.mentions = mentions;
    }

    try {
        await sock.sendMessage(grupoDestino, payload);
    } catch (err) {
        console.warn('[desafioleilaoHandler] Erro ao enviar mídia:', err.message);
        return false;
    }

    if (!suportaCaption && caption) {
        await sock.sendMessage(grupoDestino, { text: caption, mentions });
    }

    return true;
}

/**
 * Detecta o tipo de comprovação esperado a partir da descrição do desafio
 * Retorna: 'foto', 'video', 'texto', 'foto_texto', 'video_texto', 'qualquer'
 */
function detectarTipoComprovacao(descricao) {
    const desc = descricao.toLowerCase();
    const temFoto = desc.includes('foto') || desc.includes('selfie') || desc.includes('screenshot');
    const temVideo = desc.includes('vídeo') || desc.includes('video');
    const temTexto = desc.includes('texto') || desc.includes('escrever') || desc.includes('poema');

    if (temVideo && temTexto) return 'video_texto';
    if (temFoto && temTexto) return 'foto_texto';
    if (temVideo) return 'video';
    if (temFoto) return 'foto';
    if (temTexto) return 'texto';
    
    return 'qualquer'; // Padrão: aceita qualquer coisa
}

/**
 * Valida se a comprovação correspond ao tipo esperado
 */
function validarComprovacao(message, content, tipoEsperado) {
    const msg = message.message;
    if (!msg) return false;

    const temMidiaDireta = !!(
        msg.imageMessage ||
        msg.videoMessage ||
        msg.documentMessage ||
        msg.audioMessage ||
        msg.stickerMessage
    );

    const temTexto = extrairTextoExtra(content).length >= 3;

    const quoted = getContextInfo(message)?.quotedMessage;
    const temMidiaNoQuote = !!(
        quoted?.imageMessage ||
        quoted?.videoMessage ||
        quoted?.documentMessage ||
        quoted?.audioMessage
    );

    const temMidia = temMidiaDireta || temMidiaNoQuote;

    // Validação rigorosa por tipo
    if (tipoEsperado === 'foto') {
        // Só aceita foto/vídeo/documento, não aceita texto puro
        return temMidia;
    }

    if (tipoEsperado === 'video') {
        // Só aceita vídeo especificamente
        if (temMidiaDireta) {
            return !!msg.videoMessage;
        }
        if (temMidiaNoQuote) {
            return !!quoted.videoMessage;
        }
        return false;
    }

    if (tipoEsperado === 'texto') {
        // Só aceita texto, sem mídia
        return temTexto && !temMidia;
    }

    if (tipoEsperado === 'foto_texto') {
        // Obrigatório: foto/vídeo/documento + texto
        return temMidia && temTexto;
    }

    if (tipoEsperado === 'video_texto') {
        // Obrigatório: vídeo + texto
        let temVideo = false;
        if (temMidiaDireta) {
            temVideo = !!msg.videoMessage;
        } else if (temMidiaNoQuote) {
            temVideo = !!quoted.videoMessage;
        }
        return temVideo && temTexto;
    }

    // 'qualquer': aceita foto/vídeo/documento ou texto
    return temMidia || temTexto;
}

/**
 * Gera mensagem de erro clara sobre qual tipo de comprovação é esperado
 */
function gerarMensagemErroComprovacao(tipoEsperado) {
    const mensagens = {
        'foto': `📸 Esse desafio pede *FOTO* (ou vídeo/documento).\n\n` +
                `Envie uma foto/vídeo e tente novamente!`,
        'video': `🎥 Esse desafio pede *VÍDEO*.\n\n` +
                `Envie um vídeo e tente novamente!`,
        'texto': `✍️ Esse desafio pede apenas *TEXTO*.\n\n` +
                `Envie uma mensagem de texto (sem foto/vídeo) e tente novamente!`,
        'foto_texto': `📸 + ✍️ Esse desafio pede *FOTO E TEXTO*.\n\n` +
                     `Você precisa enviar:\n` +
                     `1️⃣ Uma foto/vídeo com legenda\n` +
                     `2️⃣ OU responder a foto com um texto explicando\n\n` +
                     `E depois mandar \`#pronto\``,
        'video_texto': `🎥 + ✍️ Esse desafio pede *VÍDEO E TEXTO*.\n\n` +
                      `Você precisa enviar:\n` +
                      `1️⃣ Um vídeo com legenda\n` +
                      `2️⃣ OU responder ao vídeo com um texto explicando\n\n` +
                      `E depois mandar \`#pronto\``
    };

    return mensagens[tipoEsperado] || `❌ Tipo de comprovação inválido.`;
}

/**
 * Extrai e serializa a comprovação (mídia ou texto) para armazenar no banco
 * Também armazena a mensagem completa em cache para poder recuperar depois
 */
async function extrairComprovacao(message, content, userId) {
    const msg = message.message;
    if (!msg) return null;

    const temMidiaDireta = !!(
        msg.imageMessage ||
        msg.videoMessage ||
        msg.documentMessage ||
        msg.audioMessage ||
        msg.stickerMessage
    );

    if (temMidiaDireta) {
        // Recupera o texto que pode vir junto da mídia
        const textoExtra = extrairTextoExtra(content);
        
        // Armazena a mensagem completa em cache
        const chaveCache = `prova_${userId}_${Date.now()}`;
        cacheProvas.set(chaveCache, {
            message,
            tipo: 'midia_direta',
            userId,
            textoExtra: textoExtra.length >= 3 ? textoExtra : null,
            timestamp: Date.now()
        });

        // Serializa com referência ao cache
        return JSON.stringify({
            tipo: 'midia_direta',
            cacheKey: chaveCache,
            userId,
            textoExtra: textoExtra.length >= 3 ? textoExtra : null
        });
    }

    const contextInfo = getContextInfo(message);
    const quotedMsg = contextInfo?.quotedMessage;
    if (quotedMsg) {
        const temMidiaNoQuote = !!(
            quotedMsg.imageMessage ||
            quotedMsg.videoMessage ||
            quotedMsg.documentMessage ||
            quotedMsg.audioMessage
        );
        if (temMidiaNoQuote) {
            // Recupera o texto que pode vir junto do reply
            const textoExtra = extrairTextoExtra(content);
            
            // Armazena o quote em cache
            const chaveCache = `prova_${userId}_${Date.now()}`;
            cacheProvas.set(chaveCache, {
                message: {
                    key: {
                        remoteJid: message.key.remoteJid,
                        id: contextInfo.stanzaId,
                        participant: contextInfo.participant,
                        fromMe: false
                    },
                    message: quotedMsg
                },
                tipo: 'midia_quoted',
                userId,
                textoExtra: textoExtra.length >= 3 ? textoExtra : null,
                timestamp: Date.now()
            });

            return JSON.stringify({
                tipo: 'midia_quoted',
                cacheKey: chaveCache,
                userId,
                textoExtra: textoExtra.length >= 3 ? textoExtra : null
            });
        }
    }

    const textoRestante = extrairTextoExtra(content);
    if (textoRestante.length >= 3) {
        return JSON.stringify({
            tipo: 'texto',
            conteudo: textoRestante,
            userId
        });
    }

    return null;
}

/**
 * Recupera a comprovação do cache ou reconstrói a partir dos dados serializados
 */
function recuperarComprovacao(comprovacaoJson) {
    try {
        const comprovacao = JSON.parse(comprovacaoJson);
        
        if (comprovacao.tipo === 'midia_direta' || comprovacao.tipo === 'midia_quoted') {
            if (comprovacao.cacheKey && cacheProvas.has(comprovacao.cacheKey)) {
                const cached = cacheProvas.get(comprovacao.cacheKey);
                // Adiciona o textoExtra se estiver na comprovação serializada
                if (comprovacao.textoExtra && !cached.textoExtra) {
                    cached.textoExtra = comprovacao.textoExtra;
                }
                return cached;
            }
        }
        
        if (comprovacao.tipo === 'texto') {
            return {
                tipo: 'texto',
                conteudo: comprovacao.conteudo,
                userId: comprovacao.userId
            };
        }
    } catch (err) {
        console.warn('[desafioleilaoHandler] Erro ao recuperar comprovação:', err.message);
    }
    
    return null;
}

async function handleDesafioCommand(sock, message, content) {
    const from = message.key.remoteJid;
    if (!from.endsWith('@g.us')) return false;

    const match = content.match(/#desafio\b\s*/i);
    if (!match) return false;

    try {
        const remetenteCompleto = getNumeroReal(message);

        // Dígitos "crus" do remetente (podem ser LID) — usados só para checar se é admin
        const adminIdBruto = extractDigits(remetenteCompleto);

        const ehAdmin = await isAdmin(sock, from, adminIdBruto);
        if (!ehAdmin) {
            await sock.sendMessage(from, {
                text: '🚫 Só administradores podem enviar desafios.'
            }, { quoted: message });
            return true;
        }

        // Número de telefone REAL do admin — é esse que vai pro banco e pras menções
        const adminId = await resolverNumeroRealDoMencionado(sock, from, remetenteCompleto);

        const mentions = getContextInfo(message)?.mentionedJid || [];
        if (mentions.length < 2) {
            await sock.sendMessage(from, {
                text: '⚠️ Marque 2 pessoas pra receber o desafio.\n\n*Exemplo:* `#desafio @maria @joão tirar uma selfie juntos 📸`'
            }, { quoted: message });
            return true;
        }

        const pessoa1 = await resolverNumeroRealDoMencionado(sock, from, mentions[0]);
        const pessoa2 = await resolverNumeroRealDoMencionado(sock, from, mentions[1]);

        if (pessoa1 === pessoa2) {
            await sock.sendMessage(from, {
                text: '⚠️ As duas pessoas do casal não podem ser a mesma!'
            }, { quoted: message });
            return true;
        }

        let descricao = content.replace(/#desafio\b\s*/i, '');
        mentions.forEach(mention => {
            descricao = descricao.replace(new RegExp(`@[\\w.]+`), '').trim();
        });

        descricao = descricao.trim();

        if (!descricao || descricao.length < 3) {
            await sock.sendMessage(from, {
                text: '⚠️ Descreva o desafio.\n\n*Exemplo:* `#desafio @maria @joão tirar uma selfie juntos 📸`'
            }, { quoted: message });
            return true;
        }

        // Detecta o tipo de comprovação esperado
        const tipoComprovacao = detectarTipoComprovacao(descricao);

        const ativo = await pool.query(
            `SELECT id FROM damas_desafios 
             WHERE grupo_id = $1 
             AND status = 'pendente'
             AND (
                (casal_id1 = $2 AND casal_id2 = $3) OR
                (casal_id1 = $3 AND casal_id2 = $2)
             )`,
            [from, pessoa1, pessoa2]
        );

        if (ativo.rowCount > 0) {
            await sock.sendMessage(from, {
                text: `⚠️ Esse casal já tem um desafio pendente! ⏳\n\nConcluam o atual antes de receber um novo.`
            }, { 
                mentions: [`${pessoa1}@s.whatsapp.net`, `${pessoa2}@s.whatsapp.net`],
                quoted: message 
            });
            return true;
        }

        const insertResult = await pool.query(
            `INSERT INTO damas_desafios 
             (grupo_id, casal_id1, casal_id2, descricao, admin_id, status, tipo_comprovacao_requerida)
             VALUES ($1, $2, $3, $4, $5, 'pendente', $6)
             RETURNING id`,
            [from, pessoa1, pessoa2, descricao, adminId, tipoComprovacao]
        );

        const desafioId = insertResult.rows[0].id;
        const agora = new Date().toLocaleString('pt-BR', { 
            dateStyle: 'short', 
            timeStyle: 'short' 
        });

        let instrucaoTipo = '';
        if (tipoComprovacao === 'foto') {
            instrucaoTipo = `📸 Vocês têm *${PRAZO_DESAFIO_HORAS} horas* pra tirar a FOTO e completar!\n\n`;
        } else if (tipoComprovacao === 'video') {
            instrucaoTipo = `🎥 Vocês têm *${PRAZO_DESAFIO_HORAS} horas* pra gravar o VÍDEO e completar!\n\n`;
        } else if (tipoComprovacao === 'texto') {
            instrucaoTipo = `✍️ Vocês têm *${PRAZO_DESAFIO_HORAS} horas* pra escrever e completar!\n\n`;
        } else if (tipoComprovacao === 'foto_texto') {
            instrucaoTipo = `📸 + ✍️ Vocês têm *${PRAZO_DESAFIO_HORAS} horas* pra enviar FOTO + TEXTO!\n\n`;
        } else if (tipoComprovacao === 'video_texto') {
            instrucaoTipo = `🎥 + ✍️ Vocês têm *${PRAZO_DESAFIO_HORAS} horas* pra enviar VÍDEO + TEXTO!\n\n`;
        } else {
            instrucaoTipo = `📸 Vocês têm *${PRAZO_DESAFIO_HORAS} horas* pra completar!\n\n`;
        }

        await sock.sendMessage(from, {
            text: `🎯 *DESAFIO RECEBIDO!* 🎯\n\n` +
                  `👥 Casal: @${pessoa1} & @${pessoa2}\n\n` +
                  `💪 *Tarefa:* ${descricao}\n\n` +
                  `⏰ *Horário:* ${agora}\n` +
                  `👮 *Enviado por:* @${adminId}\n\n` +
                  `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                  instrucaoTipo +
                  `✅ Quando acabar, um de vocês manda:\n` +
                  `*#pronto* (marcando um admin, se quiser notificar direto)\n\n` +
                  `🔥 Vamos lá! 💪`,
            mentions: [`${pessoa1}@s.whatsapp.net`, `${pessoa2}@s.whatsapp.net`, `${adminId}@s.whatsapp.net`]
        });

        console.log(`✅ [desafioleilaoHandler] Desafio #${desafioId} criado`);
        console.log(`   Casal: ${pessoa1} & ${pessoa2}`);
        console.log(`   Descrição: ${descricao}`);
        console.log(`   Tipo comprovação: ${tipoComprovacao}`);
        console.log(`   Admin: ${adminId}`);
        return true;

    } catch (err) {
        console.error('[desafioleilaoHandler] Erro ao enviar desafio:', err.message);
        await sock.sendMessage(from, {
            text: '❌ Erro ao enviar o desafio. Tente novamente.'
        }, { quoted: message });
        return true;
    }
}

async function handleProntoCommand(sock, message, content) {
    const from = message.key.remoteJid;
    if (!from.endsWith('@g.us')) return false;

    const match = content.match(/#pronto\b(?:\s+(?:id)?(\d+))?/i);
    if (!match) return false;

    try {
        const numeroCompleto = getNumeroReal(message);

        // Número real de quem mandou o #pronto (mesmo formato salvo em casal_id1/casal_id2)
        const userId = await resolverNumeroRealDoMencionado(sock, from, numeroCompleto);

        let desafioId = match[1] ? parseInt(match[1], 10) : null;

        const mentionedRaw = getContextInfo(message)?.mentionedJid || [];
        let adminMencionadoId = null;
        if (mentionedRaw.length > 0) {
            adminMencionadoId = await resolverNumeroRealDoMencionado(sock, from, mentionedRaw[0]);
        }

        if (!desafioId) {
            const desafioResult = await pool.query(
                `SELECT id FROM damas_desafios 
                 WHERE grupo_id = $1 
                 AND status IN ('pendente', 'confirmado_por_um')
                 AND (casal_id1 = $2 OR casal_id2 = $2)
                 ORDER BY criado_em DESC
                 LIMIT 1`,
                [from, userId]
            );

            if (desafioResult.rowCount === 0) {
                await sock.sendMessage(from, {
                    text: `⚠️ Você não tem nenhum desafio pendente no momento.`
                }, { quoted: message });
                return true;
            }

            desafioId = desafioResult.rows[0].id;
        }

        const desafioResult = await pool.query(
            `SELECT * FROM damas_desafios WHERE id = $1 AND grupo_id = $2`,
            [desafioId, from]
        );

        if (desafioResult.rowCount === 0) {
            await sock.sendMessage(from, {
                text: `⚠️ Desafio #${desafioId} não encontrado.`
            }, { quoted: message });
            return true;
        }

        const desafio = desafioResult.rows[0];

        if (userId !== desafio.casal_id1 && userId !== desafio.casal_id2) {
            await sock.sendMessage(from, {
                text: `🚫 *Acesso negado!*\n\n` +
                      `Só @${desafio.casal_id1} ou @${desafio.casal_id2} podem completar esse desafio.`,
                mentions: [`${desafio.casal_id1}@s.whatsapp.net`, `${desafio.casal_id2}@s.whatsapp.net`]
            }, { quoted: message });
            return true;
        }

        // ⚠️ VALIDAÇÃO RIGOROSA DO TIPO DE COMPROVAÇÃO
        const tipoEsperado = desafio.tipo_comprovacao_requerida || 'qualquer';
        
        if (!validarComprovacao(message, content, tipoEsperado)) {
            await sock.sendMessage(from, {
                text: `🚨 *COMPROVAÇÃO INVÁLIDA!* 🚨\n\n` +
                      gerarMensagemErroComprovacao(tipoEsperado) + `\n\n` +
                      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                      `*Tarefa:* ${desafio.descricao}`
            }, { quoted: message });
            return true;
        }

        if (desafio.status === 'concluido') {
            const dataConclusao = new Date(desafio.concluido_em).toLocaleString('pt-BR');
            await sock.sendMessage(from, {
                text: `ℹ️ Esse desafio já foi concluído em ${dataConclusao}.`
            }, { quoted: message });
            return true;
        }

        // Extrai a comprovação para armazenar
        const comprovacao = await extrairComprovacao(message, content, userId);

        let jaConfirmou = false;
        let novoStatus = 'confirmado_por_um';
        
        if (desafio.status === 'confirmado_por_um') {
            if ((userId === desafio.casal_id1 && desafio.confirmado_por_casal_1) ||
                (userId === desafio.casal_id2 && desafio.confirmado_por_casal_2)) {
                jaConfirmou = true;
            } else {
                novoStatus = 'concluido';
            }
        }

        if (jaConfirmou) {
            await sock.sendMessage(from, {
                text: `ℹ️ Você já confirmou este desafio. Aguarde a confirmação do outro membro do casal.`
            }, { quoted: message });
            return true;
        }

        let updateQuery, updateParams;
        if (novoStatus === 'confirmado_por_um') {
            if (userId === desafio.casal_id1) {
                updateQuery = `UPDATE damas_desafios 
                 SET status = $1, confirmado_por_casal_1 = $2, prova_casal_1 = $3
                 WHERE id = $4
                 RETURNING *`;
                updateParams = [novoStatus, userId, comprovacao, desafioId];
            } else {
                updateQuery = `UPDATE damas_desafios 
                 SET status = $1, confirmado_por_casal_2 = $2, prova_casal_2 = $3
                 WHERE id = $4
                 RETURNING *`;
                updateParams = [novoStatus, userId, comprovacao, desafioId];
            }
        } else {
            // Segundo membro confirmando - armazena sua prova também
            const colunaPróxima = userId === desafio.casal_id1 ? 'prova_casal_1' : 'prova_casal_2';
            updateQuery = `UPDATE damas_desafios 
             SET status = 'concluido', concluido_em = NOW(), concluido_por = $1, ${colunaPróxima} = $2
             WHERE id = $3
             RETURNING *`;
            updateParams = [userId, comprovacao, desafioId];
        }

        const updateResult = await pool.query(updateQuery, updateParams);
        const desafioAtualizado = updateResult.rows[0];

        if (novoStatus === 'confirmado_por_um') {
            const outraMembro = userId === desafio.casal_id1 ? desafio.casal_id2 : desafio.casal_id1;
            await sock.sendMessage(from, {
                text: `✅ *CONFIRMAÇÃO RECEBIDA!* ✨\n\n` +
                      `@${userId} confirmou que o desafio foi realizado!\n\n` +
                      `⏳ Agora é a vez de @${outraMembro} confirmar também.\n\n` +
                      `🎯 *Desafio:* ${desafio.descricao}`,
                mentions: [`${userId}@s.whatsapp.net`, `${outraMembro}@s.whatsapp.net`]
            });
            console.log(`✅ [desafioleilaoHandler] Desafio #${desafioId} confirmado por ${userId}`);
            return true;
        }

        const dataEnvio = new Date(desafio.criado_em).toLocaleString('pt-BR', { 
            dateStyle: 'short', 
            timeStyle: 'short' 
        });
        const dataConclusao = new Date(desafioAtualizado.concluido_em).toLocaleString('pt-BR', {
            dateStyle: 'short',
            timeStyle: 'short'
        });

        const mentionsConclusao = [`${desafio.casal_id1}@s.whatsapp.net`, `${desafio.casal_id2}@s.whatsapp.net`];
        let linhaAdminMencionado = '';
        if (adminMencionadoId) {
            mentionsConclusao.push(`${adminMencionadoId}@s.whatsapp.net`);
            linhaAdminMencionado = `\n👮 *Admin notificado:* @${adminMencionadoId}`;
        }

        await sock.sendMessage(from, {
            text: `✅ *DESAFIO COMPLETADO!* 🎉\n\n` +
                  `👏 Parabéns @${desafio.casal_id1} e @${desafio.casal_id2}!\n\n` +
                  `🎯 *Desafio:* ${desafio.descricao}\n` +
                  `📅 *Concluído:* ${dataConclusao}` +
                  linhaAdminMencionado + `\n\n` +
                  `🔥 Vocês foram incríveis!`,
            mentions: mentionsConclusao
        });

        const GRUPO_LEILOES = process.env.GRUPO_LEILOES_ID;

        if (GRUPO_LEILOES) {
            // Garante o número real do admin que criou (corrige desafios antigos salvos com LID)
            const adminCriadorReal = await resolverIdSalvo(sock, from, desafio.admin_id);

            const mentionsRegistro = [
                `${desafio.casal_id1}@s.whatsapp.net`,
                `${desafio.casal_id2}@s.whatsapp.net`,
                `${adminCriadorReal}@s.whatsapp.net`
            ];
            let linhaAdminMencionadoRegistro = '';
            if (adminMencionadoId) {
                mentionsRegistro.push(`${adminMencionadoId}@s.whatsapp.net`);
                linhaAdminMencionadoRegistro = `\n🔔 *Notificado:* @${adminMencionadoId}`;
            }

            const registroTexto = 
                `📋 *DESAFIO CONCLUÍDO* ✅\n` +
                `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                `🆔 *ID:* #${desafioId}\n` +
                `👥 *Casal:* @${desafio.casal_id1} & @${desafio.casal_id2}\n` +
                `🎯 *Tarefa:* ${desafio.descricao}\n` +
                `👮 *Admin que criou:* @${adminCriadorReal}` +
                linhaAdminMencionadoRegistro + `\n` +
                `📅 *Enviado:* ${dataEnvio}\n` +
                `✅ *Concluído:* ${dataConclusao}\n` +
                `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

            try {
                // PROVA DO CASAL 1
                if (desafioAtualizado.prova_casal_1) {
                    const comprov1 = recuperarComprovacao(desafioAtualizado.prova_casal_1);
                    if (comprov1) {
                        if (comprov1.tipo === 'texto') {
                            await sock.sendMessage(GRUPO_LEILOES, {
                                text: `📸 *Comprovação de:* @${desafio.casal_id1}\n💬 _"${comprov1.conteudo}"_`,
                                mentions: [`${desafio.casal_id1}@s.whatsapp.net`]
                            });
                        } else if (comprov1.tipo === 'midia_direta' || comprov1.tipo === 'midia_quoted') {
                            let legendaAtribuicao1 = `📸 *Comprovação de:* @${desafio.casal_id1}`;
                            
                            // Recupera o texto se houver (da cache ou da comprovação serializada)
                            try {
                                const comprovJson1 = JSON.parse(desafioAtualizado.prova_casal_1);
                                if (comprovJson1.textoExtra) {
                                    legendaAtribuicao1 += `\n💬 _"${comprovJson1.textoExtra}"_`;
                                }
                            } catch (err) {
                                // Ignora se não conseguir fazer parse
                            }
                            
                            // Se não tiver na serialização, tenta da cache
                            if (comprov1.textoExtra) {
                                legendaAtribuicao1 = `📸 *Comprovação de:* @${desafio.casal_id1}\n💬 _"${comprov1.textoExtra}"_`;
                            }
                            
                            const mentionsAtribuicao1 = [`${desafio.casal_id1}@s.whatsapp.net`];
                            
                            try {
                                await reenviarMidiaLimpa(sock, GRUPO_LEILOES, comprov1.message, {
                                    caption: legendaAtribuicao1,
                                    mentions: mentionsAtribuicao1
                                });
                            } catch (err) {
                                console.warn('[desafioleilaoHandler] Erro ao enviar mídia do casal 1:', err.message);
                            }
                        }
                    }
                }

                // PROVA DO CASAL 2
                if (desafioAtualizado.prova_casal_2) {
                    const comprov2 = recuperarComprovacao(desafioAtualizado.prova_casal_2);
                    if (comprov2) {
                        if (comprov2.tipo === 'texto') {
                            await sock.sendMessage(GRUPO_LEILOES, {
                                text: `📸 *Comprovação de:* @${desafio.casal_id2}\n💬 _"${comprov2.conteudo}"_`,
                                mentions: [`${desafio.casal_id2}@s.whatsapp.net`]
                            });
                        } else if (comprov2.tipo === 'midia_direta' || comprov2.tipo === 'midia_quoted') {
                            let legendaAtribuicao2 = `📸 *Comprovação de:* @${desafio.casal_id2}`;
                            
                            // Recupera o texto se houver (da cache ou da comprovação serializada)
                            try {
                                const comprovJson2 = JSON.parse(desafioAtualizado.prova_casal_2);
                                if (comprovJson2.textoExtra) {
                                    legendaAtribuicao2 += `\n💬 _"${comprovJson2.textoExtra}"_`;
                                }
                            } catch (err) {
                                // Ignora se não conseguir fazer parse
                            }
                            
                            // Se não tiver na serialização, tenta da cache
                            if (comprov2.textoExtra) {
                                legendaAtribuicao2 = `📸 *Comprovação de:* @${desafio.casal_id2}\n💬 _"${comprov2.textoExtra}"_`;
                            }
                            
                            const mentionsAtribuicao2 = [`${desafio.casal_id2}@s.whatsapp.net`];
                            
                            try {
                                await reenviarMidiaLimpa(sock, GRUPO_LEILOES, comprov2.message, {
                                    caption: legendaAtribuicao2,
                                    mentions: mentionsAtribuicao2
                                });
                            } catch (err) {
                                console.warn('[desafioleilaoHandler] Erro ao enviar mídia do casal 2:', err.message);
                            }
                        }
                    }
                }

                await sock.sendMessage(GRUPO_LEILOES, {
                    text: registroTexto,
                    mentions: mentionsRegistro
                });
                console.log(`📋 [desafioleilaoHandler] Registro do desafio #${desafioId} enviado pro grupo de admins`);
            } catch (err) {
                console.warn('[desafioleilaoHandler] Erro ao enviar registro:', err.message);
            }
        }

        console.log(`✅ [desafioleilaoHandler] Desafio #${desafioId} concluído`);
        console.log(`   Casal: ${desafio.casal_id1} & ${desafio.casal_id2}`);
        console.log(`   Concluído por: ${userId}`);
        if (adminMencionadoId) console.log(`   Admin notificado: ${adminMencionadoId}`);
        return true;

    } catch (err) {
        console.error('[desafioleilaoHandler] Erro ao processar pronto:', err.message);
        await sock.sendMessage(from, {
            text: '❌ Erro ao processar a conclusão do desafio. Tente novamente.'
        }, { quoted: message });
        return true;
    }
}

async function verificarDesafiosExpirados(sock) {
    const GRUPO_LEILOES = process.env.GRUPO_LEILOES_ID;
    if (!GRUPO_LEILOES) return;

    try {
        const expirados = await pool.query(
            `SELECT * FROM damas_desafios
             WHERE status = 'pendente'
             AND criado_em <= NOW() - INTERVAL '${INTERVALO_EXPIRACAO_SQL}'`
        );

        for (const desafio of expirados.rows) {
            try {
                // Garante o número real do admin (corrige desafios antigos salvos com LID)
                const adminCriadorReal = await resolverIdSalvo(sock, desafio.grupo_id, desafio.admin_id);

                await sock.sendMessage(GRUPO_LEILOES, {
                    text: `⏰ *DESAFIO NÃO CUMPRIDO!* ⚠️\n\n` +
                          `🆔 *ID:* #${desafio.id}\n` +
                          `👥 *Casal:* @${desafio.casal_id1} & @${desafio.casal_id2}\n` +
                          `🎯 *Tarefa:* ${desafio.descricao}\n` +
                          `👮 *Admin que criou:* @${adminCriadorReal}\n\n` +
                          `🚫 O prazo de *${PRAZO_DESAFIO_HORAS} horas* acabou e eles não concluíram o desafio.`,
                    mentions: [
                        `${desafio.casal_id1}@s.whatsapp.net`,
                        `${desafio.casal_id2}@s.whatsapp.net`,
                        `${adminCriadorReal}@s.whatsapp.net`
                    ]
                });

                await pool.query(
                    `UPDATE damas_desafios SET status = 'expirado' WHERE id = $1`,
                    [desafio.id]
                );

                console.log(`⏰ [desafioleilaoHandler] Desafio #${desafio.id} expirado — admins avisados`);
            } catch (err) {
                console.warn(`[desafioleilaoHandler] Erro ao avisar expiração #${desafio.id}:`, err.message);
            }
        }
    } catch (err) {
        console.error('[desafioleilaoHandler] Erro ao verificar desafios expirados:', err.message);
    }
}

export function iniciarVerificadorDesafiosExpirados(sock, intervaloMinutos = 30) {
    verificarDesafiosExpirados(sock);
    return setInterval(() => verificarDesafiosExpirados(sock), intervaloMinutos * 60 * 1000);
}

export async function handleDesafioleilaoCommand(sock, message, content) {
    // Além do "content" recebido, lê o texto/legenda direto da mensagem.
    // Assim o comando funciona em qualquer posição e em qualquer tipo de mensagem
    // (texto, foto ou vídeo com legenda), mesmo que o "content" venha incompleto.
    const textos = [];
    if (typeof content === 'string' && content.trim()) textos.push(content);

    const textoDaMensagem = extrairTextoDaMensagem(message);
    if (textoDaMensagem && textoDaMensagem.trim() && !textos.includes(textoDaMensagem)) {
        textos.push(textoDaMensagem);
    }

    for (const texto of textos) {
        if (await handleDesafioCommand(sock, message, texto)) return true;
        if (await handleProntoCommand(sock, message, texto)) return true;
    }
    return false;
}