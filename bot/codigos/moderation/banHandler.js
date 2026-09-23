// banHandler.js

import { addToBlacklist } from '../moderation/blacklist/blacklistFunctions.js';

const GRUPO_PRINCIPAL = '120363412511975026@g.us';
const GRUPO_ADMINS    = '120363409228091157@g.us';

export async function handleBanMessage(c, message) {
    try {
        const { key, message: msg } = message;
        const from      = key.remoteJid;
        const sender    = key.participant || key.remoteJid;
        const senderAlt = key.participantAlt || null;

        const isFromAdminGroup = from === GRUPO_ADMINS;
        const isFromMainGroup  = from === GRUPO_PRINCIPAL;
        if (!isFromAdminGroup && !isFromMainGroup) return;

        const botId = c.user.id;
        const groupMetadata = await c.groupMetadata(from);

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

        // Menção direta: só extendedTextMessage carrega mentionedJid
        if (
            msg?.extendedTextMessage?.text?.toLowerCase().includes('#ban') &&
            msg?.extendedTextMessage?.contextInfo?.mentionedJid?.length > 0
        ) {
            isBanCommand = true;
        }

        // Prioriza extendedTextMessage pois é o único que carrega contextInfo/mentionedJid
        const messageContent = msg?.extendedTextMessage?.text || msg?.conversation;

        if (messageContent) {
            const lower = messageContent.toLowerCase();
            if (
                /^#ban\s+@/.test(lower) ||
                /^@[^\s]+\s+#ban/.test(lower)
            ) {
                isBanCommand = true;
            }
        }

        if (!isBanCommand) return;

        // ─── Verifica se quem mandou é admin ────────────────────────────────
        const isAdmin = groupMetadata.participants.some(p => {
            if (!p.admin) return false;
            if (p.id === sender || p.id === senderAlt) return true;
            const pDigits = p.id.split('@')[0].replace(/:\d+$/, '');
            const sDigits = sender.split('@')[0].replace(/:\d+$/, '');
            const aDigits = senderAlt ? senderAlt.split('@')[0].replace(/:\d+$/, '') : '';
            return pDigits === sDigits || (aDigits && pDigits === aDigits);
        });

        if (!isAdmin) {
            await c.sendMessage(from, {
                text: '👏🍻 *DﾑMﾑS* 💃🔥 *Dﾑ* *NIGӇԵ* 💃🎶🍾🍸\n\n❌ *Acesso Negado!*\n\n⚠️ Somente *administradores* podem executar este comando.'
            });
            console.log('Ação não permitida, o remetente não é um administrador.');
            return;
        }

        const targetGroup = isFromAdminGroup ? GRUPO_PRINCIPAL : from;

        // ─── Processar #ban em imagem ───────────────────────────────────────
        // CORRIGIDO: era msg.imageMessage.context?.participant (campo inexistente)
        if (msg?.imageMessage) {
            const imageCaption = msg.imageMessage.caption;
            if (imageCaption?.toLowerCase().includes('#ban')) {
                const imageSender = msg.imageMessage.contextInfo?.participant;
                if (imageSender && imageSender !== botId) {
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

        // ─── Processar #ban em resposta/quote ───────────────────────────────
        if (msg?.extendedTextMessage) {
            const commentText = msg.extendedTextMessage.text;
            if (commentText?.toLowerCase().includes('#ban')) {
                const quotedMessage     = msg.extendedTextMessage.contextInfo;
                const targetMessageId   = quotedMessage?.stanzaId;
                const targetParticipant = quotedMessage?.participant;

                if (targetParticipant && targetParticipant !== botId) {
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

        // ─── Processar #ban com menção direta ───────────────────────────────
        if (messageContent) {
            const lower        = messageContent.toLowerCase().trim();
            const contextInfo  = msg?.extendedTextMessage?.contextInfo;
            const mentionedJid = contextInfo?.mentionedJid;

            if (mentionedJid?.length > 0) {
                const targetJid = mentionedJid[0];
                if (targetJid && targetJid !== botId) {
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

            // Fallback — extrai dígitos do texto e busca no grupo (usado pela sala de admins)
            const match1   = lower.match(/^#ban\s+@([^\s]+)/);
            const match2   = lower.match(/^@([^\s]+)\s+#ban/);
            const rawToken = (match1?.[1] || match2?.[1] || '').replace(/\D/g, '');

            if (rawToken.length >= 8) {
                const targetMetadata = await c.groupMetadata(targetGroup);
                const userToBan = targetMetadata.participants.find(p => {
                    const pPhone  = (p.phoneNumber || '').replace(/\D/g, '');
                    const pDigits = p.id.split('@')[0].replace(/:\d+$/, '');
                    return pDigits.includes(rawToken)  ||
                           rawToken.includes(pDigits)  ||
                           (pPhone && (pPhone.includes(rawToken) || rawToken.includes(pPhone)));
                });

                if (userToBan && userToBan.id !== botId) {
                    await deleteCommandMessage(c, from, key);
                    await executeBanUser(c, targetGroup, userToBan.id, from);
                } else {
                    console.warn(`⚠️ Usuário com token "${rawToken}" não encontrado no grupo ${targetGroup}`);
                    await c.sendMessage(from, { text: `⚠️ Usuário não encontrado no grupo com o número informado.` });
                }
            }

            return;
        }

    } catch (error) {
        console.error('Erro ao processar a mensagem:', error);
    }
}

// ─── resolveParticipantId ────────────────────────────────────────────────────
// CORRIGIDO: agora tenta bater o @lid diretamente na lista de participantes
// antes de tentar resolver por dígitos. Isso resolve o caso do grupo principal
// onde menções chegam como @lid (ID interno do WhatsApp MD), que não contém
// dígitos de telefone para comparar.
async function resolveParticipantId(c, groupId, participantId) {
    try {
        if (!participantId) return null;

        // Já é @s.whatsapp.net válido → retorna direto
        if (isValidParticipant(participantId)) {
            console.log(`✅ participantId já válido: ${participantId}`);
            return participantId;
        }

        console.log(`🔍 Resolvendo: ${participantId} no grupo ${groupId}`);
        const meta = await c.groupMetadata(groupId);

        // ── Estratégia 1: bate o id direto na lista (resolve @lid do grupo principal) ──
        // Quando a menção vem de dentro do grupo principal, o WhatsApp envia o
        // participant como @lid. Esse @lid já está na lista de participantes — basta
        // encontrá-lo diretamente. O Baileys aceita @lid no groupParticipantsUpdate.
        const byId = meta.participants.find(p => p.id === participantId);
        if (byId) {
            console.log(`✅ id encontrado direto na lista: ${byId.id}`);
            return byId.id;
        }

        // ── Estratégia 2: resolve por dígitos (usado pela sala de admins com número digitado) ──
        const rawDigits = participantId.split('@')[0].replace(/:\d+$/, '');
        console.log(`🔍 Tentando por dígitos: ${rawDigits}`);

        const byDigits = meta.participants.find(p => {
            const phone   = (p.phoneNumber || '').split('@')[0].replace(/\D/g, '');
            const pDigits = p.id.split('@')[0].replace(/:\d+$/, '');
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
        return null;

    } catch (err) {
        console.error('Erro ao resolver participantId:', err.message);
        return null;
    }
}

// ─── executeBanUser ─────────────────────────────────────────────────────────
async function executeBanUser(c, groupId, userId, commandOrigin) {
    try {
        // Busca metadados ANTES de remover para garantir que o participante ainda está listado
        const targetMetadata = await c.groupMetadata(groupId);

        const isUserAdmin = targetMetadata.participants.some(
            p => p.id === userId && p.admin
        );

        if (isUserAdmin) {
            const userNumber = userId.split('@')[0];
            await c.sendMessage(commandOrigin, {
                text: `👏🍻 *DﾑMﾑS* 💃🔥 *Dﾑ* *NIGӇԵ* 💃🎶🍾🍸\n\n⚠️ *Ação não permitida!*\n\n❌ Não é possível remover @${userNumber} pois é *administrador* do grupo.`,
                mentions: [userId]
            });
            console.log('O usuário é administrador e não pode ser banido.');
            return;
        }

        // ─── Extrai o número real via phoneNumber dos metadados ──────────────
        let phoneDigits = userId.split('@')[0].replace(/\D/g, ''); // fallback

        const rawDigits = userId.split('@')[0].replace(/:\d+$/, '');
        const matchedParticipant = targetMetadata.participants.find(p => {
            const pDigits = p.id.split('@')[0].replace(/:\d+$/, '');
            return pDigits === rawDigits;
        });

        if (matchedParticipant?.phoneNumber) {
            phoneDigits = matchedParticipant.phoneNumber.split('@')[0].replace(/\D/g, '');
            console.log(`✅ Número real extraído via phoneNumber: ${phoneDigits}`);
        } else {
            console.warn(`⚠️ phoneNumber não encontrado para ${userId}, usando fallback: ${phoneDigits}`);
        }

        // 1. Remove do grupo
        await c.groupParticipantsUpdate(groupId, [userId], 'remove');
        console.log(`✅ Usuário ${userId} removido do grupo ${groupId}`);

        // 2. Adiciona na blacklist com o número real
        const motivo = `Banido via #ban em ${new Date().toLocaleDateString('pt-BR')}`;
        const resultBlacklist = await addToBlacklist(phoneDigits, motivo);
        console.log(`✅ Blacklist: ${resultBlacklist}`);

        // 3. Confirma e auto-deleta após 5 segundos
        const sentConfirm = await c.sendMessage(commandOrigin, {
            text: `👏🍻 *DﾑMﾑS* 💃🔥 *Dﾑ* *NIGӇԵ* 💃🎶🍾🍸\n\n🚫 @${phoneDigits} foi *removido e adicionado à blacklist* com sucesso!`,
            mentions: [userId]
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
                console.log(`✅ Mensagem de confirmação auto-deletada`);
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
                fromMe:      false,
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

function isValidParticipant(participant) {
    if (!participant) return false;
    if (!participant.endsWith('@s.whatsapp.net')) return false;
    const participantNumber = participant.split('@')[0];
    return (
        !participantNumber.includes(':') &&
        !participantNumber.startsWith('0') &&
        participantNumber.length >= 8
    );
}