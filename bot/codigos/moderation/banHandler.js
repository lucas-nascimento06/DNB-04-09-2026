// banHandler.js

import { addToBlacklist } from '../moderation/blacklist/blacklistFunctions.js';

const GRUPO_PRINCIPAL = '120363412511975026@g.us';
const GRUPO_ADMINS    = '120363431558953171@g.us';
const GRUPO_TESTE     = '120363411421369576@g.us';

// Grupos onde o #ban funciona
const GRUPOS_PERMITIDOS_BAN = new Set([GRUPO_PRINCIPAL, GRUPO_ADMINS, GRUPO_TESTE]);

// ─── Utilitários de identificação ───────────────────────────────────────────
const clean = v => (v || '').split('@')[0].replace(/:\d+$/, '');

// Compara um participante do grupo com qualquer identificador (@lid, @s.whatsapp.net, número)
function matchesParticipant(p, id) {
    if (!id) return false;
    const target = clean(id);
    if (!target) return false;
    return [p.id, p.lid, p.jid, p.phoneNumber].some(x => x && (x === id || clean(x) === target));
}

// Desembrulha mensagens temporárias / "ver uma vez" / editadas
function unwrapMessage(msg) {
    let m = msg;
    for (let i = 0; i < 4 && m; i++) {
        const inner =
            m.ephemeralMessage?.message ||
            m.viewOnceMessage?.message ||
            m.viewOnceMessageV2?.message ||
            m.documentWithCaptionMessage?.message ||
            null;
        if (!inner) break;
        m = inner;
    }
    return m;
}

export async function handleBanMessage(c, message) {
    try {
        const { key } = message;
        const msg = unwrapMessage(message.message);
        const from = key.remoteJid;

        if (!GRUPOS_PERMITIDOS_BAN.has(from)) return;

        const isFromAdminGroup = from === GRUPO_ADMINS;

        // IDs do bot (id normal + lid)
        const botIds = [c.user?.id, c.user?.lid].filter(Boolean);
        const isBot = id => botIds.some(b => clean(b) === clean(id));

        // Possíveis identificadores de quem mandou o comando.
        // Se a mensagem é do próprio número do bot (fromMe), key.participant vem vazio.
        const senderIds = [
            key.participant,
            key.participantAlt,
            key.fromMe ? c.user?.id  : null,
            key.fromMe ? c.user?.lid : null,
        ].filter(Boolean);

        const groupMetadata = await c.groupMetadata(from);

        const text = (msg?.extendedTextMessage?.text || msg?.conversation || '');
        console.log('[ban] from:', from, '| fromMe:', key.fromMe, '| senders:', senderIds,
            '| text:', text,
            '| mentioned:', msg?.extendedTextMessage?.contextInfo?.mentionedJid);

        // ─── Detecção do comando #ban ───────────────────────────────────────
        let isBanCommand = false;

        if (msg?.imageMessage?.caption?.toLowerCase().includes('#ban')) {
            isBanCommand = true;
        }

        if (
            msg?.extendedTextMessage?.text?.toLowerCase().includes('#ban') &&
            msg?.extendedTextMessage?.contextInfo?.participant
        ) {
            isBanCommand = true;
        }

        if (
            msg?.extendedTextMessage?.text?.toLowerCase().includes('#ban') &&
            msg?.extendedTextMessage?.contextInfo?.mentionedJid?.length > 0
        ) {
            isBanCommand = true;
        }

        const messageContent = msg?.extendedTextMessage?.text || msg?.conversation;

        if (messageContent) {
            const lower = messageContent.toLowerCase();
            if (/^#ban\s+@/.test(lower) || /^@[^\s]+\s+#ban/.test(lower)) {
                isBanCommand = true;
            }
        }

        if (!isBanCommand) return;

        // ─── Verifica se quem mandou é admin ────────────────────────────────
        const isAdmin = groupMetadata.participants.some(p =>
            p.admin && senderIds.some(s => matchesParticipant(p, s))
        );

        if (!isAdmin) {
            await c.sendMessage(from, {
                text: '👏🍻 *DﾑMﾑS* 💃🔥 *Dﾑ* *NIGӇԵ* 💃🎶🍾🍸\n\n❌ *Acesso Negado!*\n\n⚠️ Somente *administradores* podem executar este comando.'
            });
            console.log('[ban] Ação não permitida, o remetente não é administrador. senders:', senderIds);
            return;
        }

        const targetGroup = isFromAdminGroup ? GRUPO_PRINCIPAL : from;

        // ─── #ban em imagem ─────────────────────────────────────────────────
        if (msg?.imageMessage) {
            const imageCaption = msg.imageMessage.caption;
            if (imageCaption?.toLowerCase().includes('#ban')) {
                const imageSender = msg.imageMessage.contextInfo?.participant;
                if (imageSender && !isBot(imageSender)) {
                    const resolvedTarget = await resolveParticipantId(c, targetGroup, imageSender);
                    if (!resolvedTarget) {
                        await c.sendMessage(from, { text: '⚠️ Não foi possível identificar o usuário no grupo.' });
                        return;
                    }
                    await deleteCommandMessage(c, from, key);
                    await executeBanUser(c, targetGroup, resolvedTarget, from);
                    return;
                }
            }
        }

        // ─── #ban em resposta/quote ─────────────────────────────────────────
        if (msg?.extendedTextMessage) {
            const commentText = msg.extendedTextMessage.text;
            if (commentText?.toLowerCase().includes('#ban')) {
                const quotedMessage     = msg.extendedTextMessage.contextInfo;
                const targetMessageId   = quotedMessage?.stanzaId;
                const targetParticipant = quotedMessage?.participant;
                const temMencao         = quotedMessage?.mentionedJid?.length > 0;

                // Se tem menção explícita, a menção tem prioridade (tratada abaixo)
                if (targetParticipant && !isBot(targetParticipant) && !temMencao) {
                    const resolvedTarget = await resolveParticipantId(c, targetGroup, targetParticipant);
                    if (!resolvedTarget) {
                        await c.sendMessage(from, { text: '⚠️ Não foi possível identificar o usuário no grupo.' });
                        return;
                    }

                    if (targetMessageId) {
                        await deleteMessage(c, from, {
                            remoteJid:   from,
                            id:          targetMessageId,
                            participant: targetParticipant
                        });
                        await new Promise(resolve => setTimeout(resolve, 500));
                    }

                    await deleteCommandMessage(c, from, key);
                    await executeBanUser(c, targetGroup, resolvedTarget, from);
                    return;
                }
            }
        }

        // ─── #ban com menção direta ─────────────────────────────────────────
        if (messageContent) {
            const lower        = messageContent.toLowerCase().trim();
            const contextInfo  = msg?.extendedTextMessage?.contextInfo;
            const mentionedJid = contextInfo?.mentionedJid;

            if (mentionedJid?.length > 0) {
                const targetJid = mentionedJid[0];
                if (targetJid && !isBot(targetJid)) {
                    const resolvedTarget = await resolveParticipantId(c, targetGroup, targetJid);
                    if (!resolvedTarget) {
                        await c.sendMessage(from, { text: '⚠️ Não foi possível identificar o usuário no grupo.' });
                        return;
                    }
                    await deleteCommandMessage(c, from, key);
                    await executeBanUser(c, targetGroup, resolvedTarget, from);
                }
                return;
            }

            // Fallback — número digitado (ex.: #ban @5586999999999)
            const match1   = lower.match(/^#ban\s+@([^\s]+)/);
            const match2   = lower.match(/^@([^\s]+)\s+#ban/);
            const rawToken = (match1?.[1] || match2?.[1] || '').replace(/\D/g, '');

            if (rawToken.length >= 8) {
                const targetMetadata = await c.groupMetadata(targetGroup);
                const userToBan = targetMetadata.participants.find(p => {
                    const pPhone  = (p.phoneNumber || '').replace(/\D/g, '');
                    const pDigits = clean(p.id);
                    return pDigits.includes(rawToken)  ||
                           rawToken.includes(pDigits)  ||
                           (pPhone && (pPhone.includes(rawToken) || rawToken.includes(pPhone)));
                });

                if (userToBan && !isBot(userToBan.id)) {
                    await deleteCommandMessage(c, from, key);
                    await executeBanUser(c, targetGroup, userToBan.id, from);
                } else {
                    console.warn(`[ban] Usuário com token "${rawToken}" não encontrado no grupo ${targetGroup}`);
                    await c.sendMessage(from, { text: '⚠️ Usuário não encontrado no grupo com o número informado.' });
                }
                return;
            }

            // Texto digitado à mão (ex.: "#ban @lima") sem menção real e sem número
            await c.sendMessage(from, {
                text: '⚠️ Não consegui identificar o usuário. Marque a pessoa na lista de menção (nome azul), responda a mensagem dela com #ban ou digite o número completo.'
            });
            return;
        }

    } catch (error) {
        console.error('Erro ao processar a mensagem:', error);
    }
}

// ─── resolveParticipantId ────────────────────────────────────────────────────
async function resolveParticipantId(c, groupId, participantId) {
    try {
        if (!participantId) return null;

        console.log(`🔍 Resolvendo: ${participantId} no grupo ${groupId}`);
        const meta = await c.groupMetadata(groupId);

        // Estratégia 1: casa por id, lid, jid ou phoneNumber
        const byId = meta.participants.find(p => matchesParticipant(p, participantId));
        if (byId) {
            console.log(`✅ participante encontrado na lista: ${byId.id}`);
            return byId.id;
        }

        // Estratégia 2: por dígitos (sufixo)
        const rawDigits = clean(participantId);
        const byDigits = meta.participants.find(p => {
            const phone   = clean(p.phoneNumber);
            const pDigits = clean(p.id);
            return pDigits === rawDigits ||
                   pDigits.endsWith(rawDigits) ||
                   rawDigits.endsWith(pDigits) ||
                   (phone && (
                       phone === rawDigits ||
                       phone.endsWith(rawDigits) ||
                       rawDigits.endsWith(phone)
                   ));
        });

        if (byDigits) {
            console.log(`✅ resolvido por dígitos: ${byDigits.id}`);
            return byDigits.id;
        }

        console.warn(`⚠️ Não resolveu: ${participantId} (rawDigits: ${rawDigits})`);
        console.log('[ban] amostra de participantes:', JSON.stringify(meta.participants.slice(0, 3), null, 2));
        return null;

    } catch (err) {
        console.error('Erro ao resolver participantId:', err.message);
        return null;
    }
}

// ─── executeBanUser ─────────────────────────────────────────────────────────
async function executeBanUser(c, groupId, userId, commandOrigin) {
    try {
        const targetMetadata = await c.groupMetadata(groupId);

        const matchedParticipant = targetMetadata.participants.find(p => matchesParticipant(p, userId));

        if (matchedParticipant?.admin) {
            const userNumber = clean(matchedParticipant.phoneNumber) || clean(userId);
            await c.sendMessage(commandOrigin, {
                text: `👏🍻 *DﾑMﾑS* 💃🔥 *Dﾑ* *NIGӇԵ* 💃🎶🍾🍸\n\n⚠️ *Ação não permitida!*\n\n❌ Não é possível remover @${userNumber} pois é *administrador* do grupo.`,
                mentions: [matchedParticipant.id]
            });
            console.log('[ban] O usuário é administrador e não pode ser banido.');
            return;
        }

        const idParaRemover = matchedParticipant?.id || userId;

        // Número real para a blacklist
        let phoneDigits = clean(userId).replace(/\D/g, ''); // fallback

        if (matchedParticipant?.phoneNumber) {
            phoneDigits = clean(matchedParticipant.phoneNumber).replace(/\D/g, '');
            console.log(`✅ Número real extraído via phoneNumber: ${phoneDigits}`);
        } else if (matchedParticipant?.id?.endsWith('@s.whatsapp.net')) {
            phoneDigits = clean(matchedParticipant.id).replace(/\D/g, '');
        } else {
            console.warn(`⚠️ phoneNumber não encontrado para ${userId}, usando fallback: ${phoneDigits}`);
        }

        // 1. Remove do grupo
        await c.groupParticipantsUpdate(groupId, [idParaRemover], 'remove');
        console.log(`✅ Usuário ${idParaRemover} removido do grupo ${groupId}`);

        // 2. Adiciona na blacklist
        const motivo = `Banido via #ban em ${new Date().toLocaleDateString('pt-BR')}`;
        const resultBlacklist = await addToBlacklist(phoneDigits, motivo);
        console.log(`✅ Blacklist: ${resultBlacklist}`);

        // 3. Confirma e auto-deleta após 5 segundos
        const sentConfirm = await c.sendMessage(commandOrigin, {
            text: `👏🍻 *DﾑMﾑS* 💃🔥 *Dﾑ* *NIGӇԵ* 💃🎶🍾🍸\n\n🚫 @${phoneDigits} foi *removido e adicionado à blacklist* com sucesso!`,
            mentions: [idParaRemover]
        });

        setTimeout(async () => {
            try {
                await c.sendMessage(commandOrigin, {
                    delete: {
                        remoteJid: commandOrigin,
                        fromMe:    true,
                        id:        sentConfirm.key.id
                    }
                });
                console.log('✅ Mensagem de confirmação auto-deletada');
            } catch (err) {
                console.warn(`⚠️ Não foi possível auto-deletar confirmação: ${err.message}`);
            }
        }, 5000);

    } catch (error) {
        console.error('Erro ao banir usuário:', error);
    }
}

// ─── Helpers ────────────────────────────────────────────────────────────────
const deleteMessage = async (sock, groupId, messageKey) => {
    const delays = [0, 100, 500, 1000, 2000, 5000];

    for (let i = 0; i < delays.length; i++) {
        try {
            if (delays[i] > 0) await new Promise(r => setTimeout(r, delays[i]));
            const key = {
                remoteJid:   messageKey.remoteJid || groupId,
                fromMe:      false,
                id:          messageKey.id,
                participant: messageKey.participant
            };
            await sock.sendMessage(groupId, { delete: key });
            console.log(`✅ Mensagem do usuário deletada (tentativa ${i + 1})`);
            return true;
        } catch (error) {
            if (i === delays.length - 1) {
                console.log(`⚠️ Não foi possível deletar mensagem do usuário: ${error.message}`);
            }
        }
    }
    return false;
};

const deleteCommandMessage = async (sock, groupId, messageKey) => {
    const delays = [0, 100, 500, 1000, 2000, 5000];

    for (let i = 0; i < delays.length; i++) {
        try {
            if (delays[i] > 0) await new Promise(r => setTimeout(r, delays[i]));
            const key = {
                remoteJid:   messageKey.remoteJid || groupId,
                fromMe:      !!messageKey.fromMe,
                id:          messageKey.id,
                participant: messageKey.participant
            };
            await sock.sendMessage(groupId, { delete: key });
            console.log(`✅ Comando #ban deletado (tentativa ${i + 1})`);
            return true;
        } catch (error) {
            console.log(`❌ Tentativa ${i + 1} de deletar comando falhou`);
        }
    }
    return false;
};