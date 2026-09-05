// messageHandler.js
import AutoTagHandler from '../../moderation/autoTagHandler.js';
import ReplyTagHandler from '../../moderation/replyTagHandler.js';
import olhinhoHandler from './olhinhoHandler.js';
import alertaHandler from '../../moderation/alertaHandler.js';

import {
    handleSignos
} from '../../moderation/signosHandler.js';
import {
    handleGroupCommands
} from '../../utils/redefinirFecharGrupo.js';
import {
    handleOwnerMenu
} from '../../features/menuOwner.js';
import pool from '../../../../db.js';
import {
    moderacaoAvancada
} from '../../moderation/removerCaracteres.js';
import {
    handleAntiLink
} from '../../moderation/antilink.js';
import {
    processCommandPriorities
} from '../../handlers/command/commandPriorities.js';
import {
    handleBasicCommands,
    handleGroupUpdate
} from './messageHelpers.js';
import {
    handleStickerCommand
} from '../../features/stickerHandler.js';
import {
    processarComandoRegras
} from '../../features/boasVindas.js';
import {
    configurarDespedida
} from '../../features/despedidaMembro.js';
import {
    handlePoemas,
    handleAtualizarPoemas
} from '../command/poema.js';
import {
    handleReloadConfig,
    handleDedicatoriaCommands
} from '../musica/dedicatoriaHandler.js';
import {
    handleBanMessage
} from '../../moderation/banHandler.js';
import {
    handleNotCommand
} from '../command/notCommandHandler.js';
import {
    handleChamarCommand
} from '../command/chamarHandler.js';
import {
    golpeHandler
} from '../command/golpeHandler.js';
import {
    responderNaturalmente,
    ativarIA,
    pausarIA,
    isIAAtiva
} from '../../utils/mistralClient.js';
import {
    handleSalvaContato,
    handleListarContatos
} from '../command/contatoHandler.js';
import {
    enviarMayaSticker
} from '../../utils/mayaStickerSender.js';
import confissoesHandler from './confissoesHandler.js';
import {
    perfilHandler,
    atualizarPerfilHandler
} from '../command/perfilHandler.js';
import {
    handleBomDia,
    handleBoaTarde,
    handleBoaNoite,
    handleAtualizarSaudacoes,
} from '../command/saudacoesHandler.js';

// ✅ IMPORTS — rainha / ranking
import {
    ativosHandler,
    inativosHandler
} from '../command/ativosHandler.js';
import {
    rankdamasHandler
} from '../command/rankdamasHandler.js';
import {
    rainhaHandler
} from '../command/rainhaHandler.js';
import {
    trackMensagem
} from '../../features/mensagensTracker.js';

// 💰 IMPORTS — sistema de DC (Damas Coins)
import {
    trackDC
} from '../../features/dcTracker.js';
import {
    dcHandler
} from '../command/dcHandler.js';
import {
    dcTransferHandler
} from '../command/dcTransferHandler.js';
import {
    handleResetDcCommand
} from '../command/resetDcHandler.js';

// 🔨 IMPORT — sistema de leilão (tudo agrupado no commandHandlers.js)
import {
    handleLeilaoCommands
} from '../command/commandHandlers.js';

// 🐄 IMPORT — medidor de gado
import {
    gadoCommandHandler
} from '../command/gadoHandler.js';

// 🍺 IMPORT — teste do bêbado
import {
    bebadoCommandHandler
} from '../command/bebadoHandler.js';

const autoTag = new AutoTagHandler();
const replyTag = new ReplyTagHandler();

const OWNER_NUMBERS = ['555195201826', '5521972337640'];
const DEBUG_MODE = process.env.DEBUG === 'true';

// 📋 Modelo do poster de confissão (comando #poster)
const MODELO_POSTER =
    `🎭 *CONFISSÃO ANÔNIMA* - 📮 *correio eletrônico* 💌💕 #confissao

✍️ Escreva uma mensagem para aquela pessoa especial que você gosta e admira no grupo:📜


*------------------------------*

💬 *ESCREVA SUA MENSAGEM AQUI:* 

....

📲 *WHATSAPP DA PESSOA:* 

+55...

*------------------------------*


ℹ️ *COMO FUNCIONA:* 

✅ Após preencher o pôster, copie e cole-o no PV do bot.

#damasdanight #confissao #amizade #paquera #romancenoar`;
// ============================================
// 🏠 IDs DOS GRUPOS
// ============================================
const GRUPO_PRINCIPAL = '120363412511975026@g.us';
const GRUPO_ADMINS = '120363409228091157@g.us';
const GRUPO_CONTROLE = '120363409394983918@g.us';

const MEDIA_TYPES = [
    'imageMessage',
    'videoMessage',
    'audioMessage',
    'stickerMessage',
    'documentMessage',
    'voiceMessage',
    'ptvMessage',
    'documentWithCaptionMessage',
];

// ===========================================
// 🔥 CACHE PARA EVITAR DUPLICATAS
// ===========================================
const processedMessages = new Set();
const MESSAGE_CACHE_LIMIT = 200;

function cleanMessageCache() {
    if (processedMessages.size > MESSAGE_CACHE_LIMIT) {
        const toDelete = processedMessages.size - MESSAGE_CACHE_LIMIT;
        const iterator = processedMessages.values();
        for (let i = 0; i < toDelete; i++) {
            processedMessages.delete(iterator.next().value);
        }
    }
}

function getMessageUniqueId(messageKey) {
    const {
        remoteJid,
        id,
        fromMe,
        participant
    } = messageKey;
    return `${remoteJid}_${id}_${fromMe}_${participant || 'none'}`;
}

function resolverRemetenteReal(message) {
    const key = message.key;

    if (key.participantAlt?.endsWith('@s.whatsapp.net')) {
        return key.participantAlt;
    }

    if (key.participant?.endsWith('@s.whatsapp.net')) {
        return key.participant;
    }

    if (key.participantAlt && !key.participantAlt.endsWith('@lid')) {
        return key.participantAlt;
    }

    return null;
}

// ============================================
// 🎯 HANDLER PRINCIPAL
// ============================================
export async function handleMessages(sock, message) {
    try {
        const uniqueId = getMessageUniqueId(message.key);
        if (processedMessages.has(uniqueId)) return;

        processedMessages.add(uniqueId);
        cleanMessageCache();

        if (!message?.key || !message?.message) return;

        const from = message.key.remoteJid;
        const userId = message.key.participant || message.key.remoteJid;
        const messageKey = message.key;

        // 🔧 Procura entre TODAS as chaves da mensagem por um tipo de mídia conhecido
        const messageKeys = Object.keys(message.message || {});
        const messageType = messageKeys.find(k => MEDIA_TYPES.includes(k)) || messageKeys[0];
        const isMediaMessage = MEDIA_TYPES.includes(messageType);

        const content =
            message.message.conversation ||
            message.message.extendedTextMessage?.text ||
            message.message.imageMessage?.caption ||
            message.message.videoMessage?.caption ||
            message.message.documentWithCaptionMessage?.message?.documentMessage?.caption ||
            '';

        // ============================================
        // 🛡️ CONTROLE DE MENSAGENS DO BOT
        // ============================================
        if (message.key.fromMe) {
            const lowerContent = content.toLowerCase().trim();
            const trimmedContent = content.trim();

            if (lowerContent.includes('#all damas')) {
                if (DEBUG_MODE) console.log('✅ Bot usando #all damas - permitido');
            } else if (
                trimmedContent.startsWith('#') ||
                trimmedContent.startsWith('!') ||
                trimmedContent.startsWith('@')
            ) {
                if (DEBUG_MODE) console.log('✅ Comando do bot - permitido');
            } else {
                if (DEBUG_MODE) console.log('⏭️ Ignorado: mensagem comum do bot');
                return;
            }
        }

        if (!content?.trim() && !isMediaMessage) return;

        if (DEBUG_MODE) {
            console.log(
                `📨 [${new Date().toLocaleTimeString()}] Tipo: ${messageType} | ` +
                `isMedia: ${isMediaMessage} | ${userId} em ${from}: ` +
                `${content.substring(0, 50)}${content.length > 50 ? '...' : ''}`
            );
        }

        const lowerContent = content.toLowerCase().trim();

        // ============================================
        // 📝 REGISTRAR MENSAGEM (apenas no grupo principal)
        // ============================================
        if (from === GRUPO_PRINCIPAL && !message.key.fromMe) {
            trackMensagem(sock, message).catch(err =>
                console.error('❌ [mensagensTracker] trackMensagem:', err.message)
            );

            if (!lowerContent.startsWith('#') && !lowerContent.startsWith('!')) {
                trackDC(sock, message).catch(err =>
                    console.error('❌ [dcTracker] trackDC:', err.message)
                );
            }
        }

        // 💾 #salva / #s e #contato / #c
        if (lowerContent.startsWith('#salva') || lowerContent.startsWith('#s ')) {
            await handleSalvaContato(sock, message);
            return;
        }

        if (lowerContent === '#contato' || lowerContent === '#contatos' || lowerContent === '#c') {
            await handleListarContatos(sock, message);
            return;
        }

        // ============================================
        // 👑 MENU OWNER
        // ============================================
        if (lowerContent === '#dmlukownner') {
            const ownerHandled = await handleOwnerMenu(
                sock, from, userId, content, OWNER_NUMBERS, message
            );
            if (ownerHandled) {
                if (DEBUG_MODE) console.log('✅ Menu owner processado');
                return;
            }
        }

        // 📮 Comando #poster
        if (from.endsWith('@g.us') && lowerContent === '#poster') {
            if (DEBUG_MODE) console.log('📮 Comando #poster detectado!');

            let mentions = [];
            try {
                const groupMetadata = await sock.groupMetadata(from);
                mentions = groupMetadata.participants.map(p => p.id);
            } catch (error) {
                console.error('❌ Erro ao obter participantes para #poster:', error.message);
            }

            await sock.sendMessage(from, {
                text: MODELO_POSTER,
                mentions
            });
            console.log(`📮 Poster enviado marcando ${mentions.length} pessoas`);
            return;
        }

        // 🎵 Comando #atualizaraudios
        if (olhinhoHandler.isComandoAtualizar && olhinhoHandler.isComandoAtualizar(message)) {
            await olhinhoHandler.handleComandoAtualizar(sock, message);
            return;
        }

        // 👁️ Reações de olhinho
        const isReaction = await olhinhoHandler.handleReactionFromMessage(sock, message);
        if (isReaction) return;

        // 🛡️ Moderação em grupos
        if (from.endsWith('@g.us')) {
            await Promise.all([
                moderacaoAvancada(sock, message),
                handleAntiLink(sock, message, from),
            ]);
        }

        // 🔥 ReplyTag
        if (message.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
            const replyResult = await replyTag.processReply(
                sock, from, userId, content, messageKey, message
            );
            if (replyResult?.processed) return;
        }

        const replyAdminHandled = await replyTag.handleAdminCommands(sock, from, userId, content);
        if (replyAdminHandled) return;

        // 📋 Comando #regras
        if (lowerContent.startsWith('#regras')) {
            const regrasProcessed = await processarComandoRegras(sock, message);
            if (regrasProcessed) return;
        }

        // 📜 Poemas
        if (lowerContent === '#poema' || lowerContent === '#poemas' || lowerContent === '#poe') {
            if (DEBUG_MODE) console.log('📜 Comando #poemas detectado!');
            await handlePoemas(sock, message, [], from);
            return;
        }

        if (lowerContent === '#atualizarpoemas') {
            if (DEBUG_MODE) console.log('🔄 Comando #atualizarpoemas detectado!');
            await handleAtualizarPoemas(sock, message, [], from);
            return;
        }

        // ============================================
        // 💘 GOLPE
        // ============================================
        if (lowerContent.includes('#golpe')) {
            if (DEBUG_MODE) console.log('💘 Comando #golpe detectado!');
            await golpeHandler(sock, message, from);
            return;
        }

        // 🎙️ Dedicatória musical
        if (lowerContent.startsWith('#play')) {
            const dedicatoriaHandled = await handleDedicatoriaCommands(sock, message, from);
            if (dedicatoriaHandled) return;
        }

        // 🎵 Atualizar config de dedicatória
        if (lowerContent === '#atualizarmusicas') {
            if (DEBUG_MODE) console.log('🔄 Comando #atualizarmusicas detectado!');
            const reloadHandled = await handleReloadConfig(sock, message, from);
            if (reloadHandled) return;
        }

        // 🚨 #alerta
        if (lowerContent === '#atualizarregras' || lowerContent.includes('#alerta')) {
            if (DEBUG_MODE) console.log(`🔍 Comando detectado: ${lowerContent}`);
            const alertaProcessed = await alertaHandler(sock, message);
            if (alertaProcessed) {
                if (DEBUG_MODE) console.log('✅ Comando processado pelo alertaHandler');
                return;
            }
        }

        // 🎨 Sticker
        if (lowerContent.startsWith('#stk')) {
            await handleStickerCommand(sock, message);
            return;
        }

        // ✅ 🚫 BANIMENTO
        if (from.endsWith('@g.us') && content?.includes('#ban')) {
            await handleBanMessage(sock, message);
            return;
        }

        // ✅ 🚫 #not — MODERAÇÃO
        if (from.endsWith('@g.us')) {
            const notHandled = await handleNotCommand(sock, message);
            if (notHandled) return;
        }

        // ============================================
        // ✅ #chm, #ok e #vip
        // ============================================
        if (from.endsWith('@g.us')) {
            const chamarHandled = await handleChamarCommand(sock, message, content, from);
            if (chamarHandled) return;
        }

        // ============================================
        // 🐄 MEDIDOR DE GADO — #gado / !gado
        // ============================================
        if (lowerContent.startsWith('#gado') || lowerContent.startsWith('!gado')) {
            if (DEBUG_MODE) console.log('🐄 Comando #gado detectado!');
            const mentionedJid = message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            await gadoCommandHandler(sock, message, from, mentionedJid);
            return;
        }

        // ============================================
        // 🍺 TESTE DO BÊBADO — #bebado / !bebado
        // ============================================
        if (lowerContent.startsWith('#bebado') || lowerContent.startsWith('!bebado')) {
            if (DEBUG_MODE) console.log('🍺 Comando #bebado detectado!');
            const mentionedJid = message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            await bebadoCommandHandler(sock, message, from, mentionedJid);
            return;
        }

        // ============================================
        // 💰 SISTEMA DE DC (Damas Coins) — #dc
        // ============================================
        if (lowerContent === '#dc') {
            if (DEBUG_MODE) console.log('💰 Comando #dc detectado!');
            await dcHandler(sock, message);
            return;
        }

        // 💸 Transferência de DC entre membros
        if (lowerContent.startsWith('#emprestar')) {
            if (DEBUG_MODE) console.log('💸 Comando #emprestar detectado!');
            await dcTransferHandler(sock, message, content);
            return;
        }

        // 🔄 Reset geral da carteira de DC
        if (lowerContent === '#resetardc' || lowerContent === '#rdc') {
            if (DEBUG_MODE) console.log('🔄 Comando #resetardc/#rdc detectado!');
            const resetDcHandled = await handleResetDcCommand(sock, message, content);
            if (resetDcHandled) return;
        }

        // ============================================
        // 🔨 SISTEMA DE LEILÃO (tudo agrupado no commandHandlers.js:
        // #leilao, #lance, #fecharleilao/#fl, #rl/#resetarleilao, #desafio/#pronto)
        // ============================================
        const leilaoHandled = await handleLeilaoCommands(sock, message, content, from);
        if (leilaoHandled) return;

        // ============================================
        // 👑 COMANDOS RAINHA / RANKING
        // ============================================
        if (from.endsWith('@g.us')) {
            const _getMeta = async () => {
                const meta = await sock.groupMetadata(from);
                const admList = meta.participants.filter(p => p.admin).map(p => p.id);
                return {
                    admList
                };
            };

            if (lowerContent === '#rainhadamas') {
                if (DEBUG_MODE) console.log('👑 Comando #rainhadamas detectado');
                await rainhaHandler(sock, message);
                return;
            }

            if (lowerContent === '#ativos') {
                if (DEBUG_MODE) console.log('🟢 Comando #ativos detectado');
                const {
                    admList
                } = await _getMeta();
                await ativosHandler(sock, message, admList);
                return;
            }

            if (lowerContent === '#inativos') {
                if (DEBUG_MODE) console.log('🔴 Comando #inativos detectado');
                const {
                    admList
                } = await _getMeta();
                await inativosHandler(sock, message, admList, GRUPO_PRINCIPAL);
                return;
            }

            if (lowerContent === '#rankdamas') {
                if (DEBUG_MODE) console.log('🏆 Comando #rankdamas detectado');
                await rankdamasHandler(sock, message);
                return;
            }
        }

        // ============================================
        // 🎭 PERFIL
        // ============================================
        if (lowerContent.includes('#perfil')) {
            if (DEBUG_MODE) console.log('🎭 Comando #perfil detectado!');
            await perfilHandler(sock, message);
            return;
        }

        if (lowerContent === '#atualizarperfil') {
            if (DEBUG_MODE) console.log('🔄 Comando #atualizarperfil detectado!');
            await atualizarPerfilHandler(sock, message);
            return;
        }

        // ============================================
        // ☀️ SAUDAÇÕES
        // ============================================
        if (lowerContent === '#bomdia' || lowerContent === '#bd') {
            if (DEBUG_MODE) console.log('☀️ Comando #bomdia detectado!');
            await handleBomDia(sock, message, [], from);
            return;
        }

        if (lowerContent === '#boatarde' || lowerContent === '#bt') {
            if (DEBUG_MODE) console.log('🌇 Comando #boatarde detectado!');
            await handleBoaTarde(sock, message, [], from);
            return;
        }

        if (lowerContent === '#boanoite' || lowerContent === '#bn') {
            if (DEBUG_MODE) console.log('🌃 Comando #boanoite detectado!');
            await handleBoaNoite(sock, message, [], from);
            return;
        }

        if (lowerContent === '#atualizarsaudacoes') {
            if (DEBUG_MODE) console.log('🔄 Comando #atualizarsaudacoes detectado!');
            await handleAtualizarSaudacoes(sock, message, [], from);
            return;
        }

        // 🔮 Signos
        const signosHandled = await handleSignos(sock, message);
        if (signosHandled) {
            if (DEBUG_MODE) console.log('✅ Comando de signos processado');
            return;
        }

        // 🔒 Comandos de grupo
        const groupCommandHandled = await handleGroupCommands(sock, message);
        if (groupCommandHandled) {
            if (DEBUG_MODE) console.log('✅ Comando de grupo processado');
            return;
        }

        // ============================================
        // 🤖 CONTROLE DA IA — #ativar / #pausar
        // ============================================
        if (from === GRUPO_CONTROLE && !message.key.fromMe) {
            if (lowerContent === '#ativar') {
                if (DEBUG_MODE) console.log('🟢 Comando #ativar recebido no grupo de controle');
                ativarIA(GRUPO_PRINCIPAL);
                ativarIA(GRUPO_CONTROLE);
                await sock.sendMessage(from, {
                    text: '🟢 IA ativada nos dois grupos!'
                }, {
                    quoted: message
                });
                return;
            }

            if (lowerContent === '#pausar') {
                if (DEBUG_MODE) console.log('🔴 Comando #pausar recebido no grupo de controle');
                pausarIA(GRUPO_PRINCIPAL);
                pausarIA(GRUPO_CONTROLE);
                await sock.sendMessage(from, {
                    text: '🔴 IA pausada nos dois grupos!'
                }, {
                    quoted: message
                });
                return;
            }
        }

        // ============================================
        // 🔀 COMANDOS POR PRIORIDADE
        // ============================================

        // 💌 Confissão anônima — mensagem vinda do PRIVADO
        if (!from.endsWith('@g.us') && !message.key.fromMe) {
            const confissaoHandled = await confissoesHandler.handlePrivateMessage(
                sock, message, from, userId, content
            );
            if (confissaoHandled) return;
        }

        const handled = await processCommandPriorities(
            sock, message, from, userId, content,
            OWNER_NUMBERS, autoTag, pool, {
                messageType,
                isMediaMessage
            }
        );

        if (!handled) {
            await handleBasicCommands(sock, message, from, userId, content, pool, {
                messageType,
                isMediaMessage,
            });
        }

        // ============================================
        // 🤖 RESPOSTA NATURAL COM IA
        // ============================================
        if (
            (from === GRUPO_PRINCIPAL || from === GRUPO_CONTROLE) &&
            !message.key.fromMe &&
            isIAAtiva(from) &&
            content?.trim() &&
            !content.trim().startsWith('#') &&
            !content.trim().startsWith('!')
        ) {
            const remetente = resolverRemetenteReal(message) || userId;

            const stickerEnviado = await enviarMayaSticker(sock, from, content.trim(), message);

            if (!stickerEnviado) {
                const resposta = await responderNaturalmente(remetente, content.trim());
                if (resposta) {
                    await sock.sendMessage(from, {
                        text: resposta
                    }, {
                        quoted: message
                    });
                }
            }
        }

    } catch (err) {
        console.error('❌ Erro ao processar mensagem:', err.message);
        if (DEBUG_MODE) console.error(err.stack);
    }
}

// ============================================
// 📌 HANDLERS AUXILIARES
// ============================================
export async function handleReactions(sock, reaction) {
    try {
        await olhinhoHandler.handleReaction(sock, reaction);
    } catch (err) {
        console.error('❌ Erro ao processar reação:', err.message);
    }
}

export async function updateGroupOnJoin(sock, groupId) {
    try {
        const count = await autoTag.updateGroup(sock, groupId);
        if (DEBUG_MODE) console.log(`✅ Grupo ${groupId}: ${count} membros`);
    } catch (error) {
        console.error('❌ Erro ao atualizar grupo:', error.message);
    }
}

export async function handleGroupParticipantsUpdate(sock, update) {
    try {
        await handleGroupUpdate(sock, update);

        if (update.action === 'remove') {
            if (DEBUG_MODE) {
                console.log(`\n👋 ========= PROCESSANDO SAÍDA/REMOÇÃO =========`);
                console.log(`🎬 Ação detectada: "${update.action}"`);
                console.log(`👮 Author (quem executou): ${update.author}`);
                console.log(`👥 Total de participantes afetados: ${update.participants.length}`);
            }

            await configurarDespedida(sock, update);

            if (DEBUG_MODE) {
                console.log(`✅ Despedida processada`);
                console.log(`==============================================\n`);
            }
        }

    } catch (err) {
        console.error('❌ Erro ao processar atualização de participantes:', err.message);
        if (DEBUG_MODE) console.error(err.stack);
    }
}

export function getCacheStats() {
    return {
        totalProcessed: processedMessages.size,
        cacheLimit: MESSAGE_CACHE_LIMIT,
        usagePercent: ((processedMessages.size / MESSAGE_CACHE_LIMIT) * 100).toFixed(1),
    };
}

export function clearMessageCache() {
    const size = processedMessages.size;
    processedMessages.clear();
    if (DEBUG_MODE) console.log(`🧹 Cache limpo: ${size} mensagens`);
}