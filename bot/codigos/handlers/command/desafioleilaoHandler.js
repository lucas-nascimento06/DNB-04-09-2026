import pool from '../../../../db.js';
import { downloadMediaMessage } from '@whiskeysockets/baileys';
import { Jimp } from "jimp";

const PRAZO_DESAFIO_HORAS = 24;
const INTERVALO_EXPIRACAO_SQL = '24 hours';

function extractDigits(number) {
    if (!number) return null;
    return number.replace(/@.*$/, '').replace(/\D/g, '');
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
        console.error('[desafioleilaoHandler] Erro ao checar admin:', err.message);
        return false;
    }
}

function extrairTextoExtra(content) {
    return content
        .replace(/#pronto\b\s*/i, '')
        .replace(/^(?:id)?\d+\s*/i, '')
        .replace(/@[\w.]+/g, '')
        .trim();
}

async function gerarThumbnail(buffer, size = 256) {
    try {
        const image = await Jimp.read(buffer);
        await image.resize({ w: size, h: size });
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

function temComprovacao(message, content) {
    const msg = message.message;
    if (!msg) return false;

    const temMidiaDireta = !!(
        msg.imageMessage ||
        msg.videoMessage ||
        msg.documentMessage ||
        msg.audioMessage ||
        msg.stickerMessage
    );
    if (temMidiaDireta) return true;

    const quoted = msg.extendedTextMessage?.contextInfo?.quotedMessage;
    if (quoted) {
        const temMidiaNoQuote = !!(
            quoted.imageMessage ||
            quoted.videoMessage ||
            quoted.documentMessage ||
            quoted.audioMessage ||
            quoted.stickerMessage
        );
        if (temMidiaNoQuote) return true;
    }

    const textoRestante = extrairTextoExtra(content);
    if (textoRestante.length >= 3) return true;

    return false;
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

async function handleDesafioCommand(sock, message, content) {
    const from = message.key.remoteJid;
    if (!from.endsWith('@g.us')) return false;

    const match = content.match(/#desafio\b\s*/i);
    if (!match) return false;

    try {
        const remetenteCompleto = getNumeroReal(message);
        const adminId = extractDigits(remetenteCompleto);

        const ehAdmin = await isAdmin(sock, from, adminId);
        if (!ehAdmin) {
            await sock.sendMessage(from, {
                text: '🚫 Só administradores podem enviar desafios.'
            }, { quoted: message });
            return true;
        }

        const mentions = message.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
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
             (grupo_id, casal_id1, casal_id2, descricao, admin_id, status)
             VALUES ($1, $2, $3, $4, $5, 'pendente')
             RETURNING id`,
            [from, pessoa1, pessoa2, descricao, adminId]
        );

        const desafioId = insertResult.rows[0].id;
        const agora = new Date().toLocaleString('pt-BR', { 
            dateStyle: 'short', 
            timeStyle: 'short' 
        });

        await sock.sendMessage(from, {
            text: `🎯 *DESAFIO RECEBIDO!* 🎯\n\n` +
                  `👥 Casal: @${pessoa1} & @${pessoa2}\n\n` +
                  `💪 *Tarefa:* ${descricao}\n\n` +
                  `⏰ *Horário:* ${agora}\n` +
                  `👮 *Enviado por:* @${adminId}\n\n` +
                  `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                  `📸 Vocês têm *${PRAZO_DESAFIO_HORAS} horas* pra completar!\n\n` +
                  `✅ Quando acabar, um de vocês manda:\n` +
                  `*#pronto* (marcando um admin, se quiser notificar direto)\n\n` +
                  `🔥 Vamos lá! 💪`,
            mentions: [`${pessoa1}@s.whatsapp.net`, `${pessoa2}@s.whatsapp.net`, `${adminId}@s.whatsapp.net`]
        });

        console.log(`✅ [desafioleilaoHandler] Desafio #${desafioId} criado`);
        console.log(`   Casal: ${pessoa1} & ${pessoa2}`);
        console.log(`   Descrição: ${descricao}`);
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
        const userId = extractDigits(numeroCompleto);

        let desafioId = match[1] ? parseInt(match[1], 10) : null;

        const mentionedRaw = message.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
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

        if (!temComprovacao(message, content)) {
            await sock.sendMessage(from, {
                text: `🚨 *OPA, CALMA AÍ!* 🚨\n\n` +
                      `📎 Seu *#pronto* chegou *sem nenhuma comprovação* — e isso a gente não aceita! 🙅\n\n` +
                      `Pra marcar o desafio como concluído, *precisa vir junto com uma prova* de que vocês realmente fizeram:\n\n` +
                      `📸 *Uma foto* (pode vir com texto explicando também)\n` +
                      `🎥 *Um vídeo* (pode vir com texto explicando também)\n` +
                      `✍️ *Ou só um texto* contando em detalhes como foi\n\n` +
                      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                      `✅ *Formas certas de mandar:*\n\n` +
                      `1️⃣ Manda a foto/vídeo com a legenda \`#pronto\`\n` +
                      `2️⃣ Responde (reply) numa foto/vídeo já mandada no grupo, escrevendo \`#pronto\`\n` +
                      `3️⃣ Escreve o \`#pronto\` junto com um texto explicando:\n` +
                      `   _"#pronto tiramos a selfie no shopping e já mandamos aqui no grupo!"_\n\n` +
                      `⚠️ *E não esquece:* marca *qualquer admin* junto, assim: \`#pronto @admin\`\n\n` +
                      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                      `Manda de novo com a comprovação e tá tudo certo! 🔥`
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
                 SET status = $1, confirmado_por_casal_1 = $2
                 WHERE id = $3
                 RETURNING *`;
                updateParams = [novoStatus, userId, desafioId];
            } else {
                updateQuery = `UPDATE damas_desafios 
                 SET status = $1, confirmado_por_casal_2 = $2
                 WHERE id = $3
                 RETURNING *`;
                updateParams = [novoStatus, userId, desafioId];
            }
        } else {
            updateQuery = `UPDATE damas_desafios 
             SET status = 'concluido', concluido_em = NOW(), concluido_por = $1
             WHERE id = $2
             RETURNING *`;
            updateParams = [userId, desafioId];
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
            const mentionsRegistro = [
                `${desafio.casal_id1}@s.whatsapp.net`,
                `${desafio.casal_id2}@s.whatsapp.net`,
                `${desafio.admin_id}@s.whatsapp.net`
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
                `👮 *Admin que criou:* @${desafio.admin_id}` +
                linhaAdminMencionadoRegistro + `\n` +
                `📅 *Enviado:* ${dataEnvio}\n` +
                `✅ *Concluído:* ${dataConclusao}\n` +
                `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

            try {
                const temMidiaDireta = !!(
                    message.message?.imageMessage ||
                    message.message?.videoMessage ||
                    message.message?.documentMessage ||
                    message.message?.audioMessage
                );

                const contextInfo = message.message?.extendedTextMessage?.contextInfo;
                const quotedMsg = contextInfo?.quotedMessage;
                const temMidiaNoQuote = !!(
                    quotedMsg?.imageMessage ||
                    quotedMsg?.videoMessage ||
                    quotedMsg?.documentMessage ||
                    quotedMsg?.audioMessage
                );

                const textoDoCasal = extrairTextoExtra(content);
                const legendaAtribuicao = `📸 *Comprovação de:* @${desafio.casal_id1} e @${desafio.casal_id2}` +
                      (textoDoCasal.length >= 3 ? `\n💬 _"${textoDoCasal}"_` : '');
                const mentionsAtribuicao = [`${desafio.casal_id1}@s.whatsapp.net`, `${desafio.casal_id2}@s.whatsapp.net`];

                let midiaEnviada = false;
                if (temMidiaDireta) {
                    midiaEnviada = await reenviarMidiaLimpa(sock, GRUPO_LEILOES, message, {
                        caption: legendaAtribuicao,
                        mentions: mentionsAtribuicao
                    });
                } else if (temMidiaNoQuote) {
                    const quotedFakeMessage = {
                        key: {
                            remoteJid: from,
                            id: contextInfo.stanzaId,
                            participant: contextInfo.participant,
                            fromMe: false
                        },
                        message: quotedMsg
                    };
                    midiaEnviada = await reenviarMidiaLimpa(sock, GRUPO_LEILOES, quotedFakeMessage, {
                        caption: legendaAtribuicao,
                        mentions: mentionsAtribuicao
                    });
                }

                if (!midiaEnviada) {
                    await sock.sendMessage(GRUPO_LEILOES, {
                        text: legendaAtribuicao,
                        mentions: mentionsAtribuicao
                    });
                }

                await sock.sendMessage(GRUPO_LEILOES, {
                    text: registroTexto,
                    mentions: mentionsRegistro
                });
                console.log(`📋 [desafioleilaoHandler] Registro do desafio #${desafioId} enviado pro grupo de admins`);
                if (temMidiaDireta) console.log(`   Mídia encaminhada: direta`);
                if (temMidiaNoQuote) console.log(`   Mídia encaminhada: via reply`);
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
                await sock.sendMessage(GRUPO_LEILOES, {
                    text: `⏰ *DESAFIO NÃO CUMPRIDO!* ⚠️\n\n` +
                          `🆔 *ID:* #${desafio.id}\n` +
                          `👥 *Casal:* @${desafio.casal_id1} & @${desafio.casal_id2}\n` +
                          `🎯 *Tarefa:* ${desafio.descricao}\n` +
                          `👮 *Admin que criou:* @${desafio.admin_id}\n\n` +
                          `🚫 O prazo de *${PRAZO_DESAFIO_HORAS} horas* acabou e eles não concluíram o desafio.`,
                    mentions: [
                        `${desafio.casal_id1}@s.whatsapp.net`,
                        `${desafio.casal_id2}@s.whatsapp.net`,
                        `${desafio.admin_id}@s.whatsapp.net`
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
    if (await handleDesafioCommand(sock, message, content)) return true;
    if (await handleProntoCommand(sock, message, content)) return true;
    return false;
}