import pool from '../../../../db.js';
import axios from 'axios';
import { Jimp } from 'jimp';
import { generateProfilePicture } from '@whiskeysockets/baileys';

const query = (text, params) => pool.query(text, params);

const FOTO_SALA_VIP = 'https://i.ibb.co/xtCCppwQ/sala-vip.png';

// ============================================
// 🏷️ RODAPÉ FIXO
// ============================================
const RODAPE = `©𝘋𝘢𝘮𝘢𝘴 𝘥𝘢 𝘕𝘪𝘨𝘩𝘵`;

// ========================================
// 🔧 UTILITÁRIOS
// ========================================

function garantirJidCompleto(jid) {
    if (!jid) return jid;
    if (jid.includes('@s.whatsapp.net')) return jid;
    const digitos = jid.replace(/\D/g, '');
    return `${digitos}@s.whatsapp.net`;
}

// ============================================
// 🖼️ HELPERS DE IMAGEM
// ============================================

async function baixarImagem(url) {
    try {
        const res = await axios.get(url, { responseType: 'arraybuffer' });
        return Buffer.from(res.data, 'binary');
    } catch (err) {
        console.error('❌ Erro ao baixar imagem:', err.message);
        return null;
    }
}

async function gerarThumbnail(buffer, size = 256) {
    try {
        const image = await Jimp.read(buffer);
        image.scaleToFit({ w: size, h: size });
        return await image.getBuffer("image/jpeg");
    } catch (err) {
        console.error('⚠️ Erro ao gerar thumbnail:', err.message);
        return null;
    }
}

async function enviarComImagem(sock, grupoId, caption, mentions) {
    const fotoBuffer = await baixarImagem(FOTO_SALA_VIP);

    if (fotoBuffer) {
        const thumb = await gerarThumbnail(fotoBuffer);
        try {
            return await sock.sendMessage(grupoId, {
                image: fotoBuffer,
                caption,
                mentions,
                jpegThumbnail: thumb,
            });
        } catch (e) {
            console.warn('⚠️ Fallback para texto sem imagem:', e.message);
        }
    }

    return await sock.sendMessage(grupoId, {
        text: caption,
        mentions,
    });
}

// ============================================
// 🗄️ CRIA TABELAS
// ============================================
export async function criarTabelaConvites() {
    await query(`
        CREATE TABLE IF NOT EXISTS convites_pendentes (
            id                  SERIAL PRIMARY KEY,
            convidado           TEXT        NOT NULL,
            remetente           TEXT        NOT NULL,
            nome_remetente      TEXT        NOT NULL,
            grupo               TEXT        NOT NULL,
            expires_at          TIMESTAMPTZ NOT NULL,
            etapa               TEXT        NOT NULL DEFAULT 'aguardando_remetente',
            criado_em           TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    console.log('🗄️ Tabela convites_pendentes verificada/criada.');
}

// ============================================
// 🔍 RESOLVE JID VIA METADADOS DO GRUPO
// ============================================
async function resolverJidViaGrupo(sock, jidMencionado, grupoJid) {
    try {
        const meta = await sock.groupMetadata(grupoJid);

        let encontrado = meta.participants.find(p => p.id === jidMencionado);

        if (!encontrado) {
            const digitos = jidMencionado.replace(/\D/g, '');
            encontrado = meta.participants.find(
                p => p.id.replace(/\D/g, '') === digitos
            );
        }

        if (encontrado) {
            const jid = encontrado.id;

            if (jid.includes('@lid')) {
                const phone = encontrado.phoneNumber || encontrado.phone;
                if (phone) {
                    const jidReal = phone.includes('@')
                        ? phone
                        : `${phone.replace(/\D/g, '')}@s.whatsapp.net`;
                    console.log(`🔄 [resolverJid] @lid convertido → ${jidReal}`);
                    return jidReal;
                }
                const jidForcado = garantirJidCompleto(jid);
                console.warn(`⚠️ [resolverJid] @lid sem phoneNumber, forçando: ${jidForcado}`);
                return jidForcado;
            }

            return jid;
        }

        console.warn('⚠️ [resolverJid] Participante não encontrado nos metadados:', jidMencionado);
        return garantirJidCompleto(jidMencionado);

    } catch (e) {
        console.error('❌ [resolverJid] Erro ao buscar metadados do grupo:', e.message);
        return garantirJidCompleto(jidMencionado);
    }
}

// ============================================
// 🖼️ DEFINE FOTO DO GRUPO
// ============================================
async function definirFotoGrupo(sock, grupoJid, imageUrl) {
    try {
        console.log(`🖼️ [Foto] Baixando imagem de: ${imageUrl}`);
        const buffer = await baixarImagem(imageUrl);

        if (!buffer) {
            console.warn('⚠️ [Foto] Não foi possível baixar a imagem');
            return false;
        }

        let img;
        try {
            const resultado = await generateProfilePicture(buffer);
            img = resultado.img;
        } catch (e) {
            console.warn('⚠️ [Foto] generateProfilePicture falhou, usando buffer direto:', e.message);
            img = buffer;
        }

        try {
            await sock.updateProfilePicture(grupoJid, img);
            console.log(`✅ [Foto] Foto do grupo ${grupoJid} atualizada!`);
        } catch (e) {
            console.warn('⚠️ [Foto] updateProfilePicture falhou (ignorando):', e.message);
        }

        return true;

    } catch (e) {
        console.error('❌ [Foto] Erro geral (ignorando para não travar):', e.message);
        return false;
    }
}

// ============================================
// 🏗️ CRIA GRUPO VIP E SAI APÓS 60 SEGUNDOS
// ============================================
async function criarGrupoVip(sock, aceitante, remetente) {
    try {
        const resultado = await sock.groupCreate('💎 Sala VIP - Privado 🔒', [aceitante, remetente]);
        const salaVipId = resultado.id;
        console.log(`🏗️ [Sala VIP] Grupo criado: ${salaVipId}`);

        await definirFotoGrupo(sock, salaVipId, FOTO_SALA_VIP);

        try {
            await sock.groupUpdateDescription(
                salaVipId,
                `🔒 Sala VIP criada pelo Damas da Night.\n` +
                `⚠️ Não compartilhe este grupo.\n` +
                `🗑️ Quando quiserem encerrar, é só deletar o grupo.`
            );
        } catch (e) {
            console.warn('⚠️ [Sala VIP] Não foi possível definir descrição:', e.message);
        }

        try {
            await sock.sendMessage(salaVipId, {
                text:
                    `🔐 *Bem-vindos à Sala VIP!* 🔒\n\n` +
                    `Aqui é um espaço privado para @${remetente.split('@')[0]} e @${aceitante.split('@')[0]}.\n\n` +
                    `🔥 Aproveitem!\n\n` +
                    `🗑️ Quando quiserem encerrar, é só deletar o grupo.\n\n` +
                    `${RODAPE}`,
                mentions: [aceitante, remetente],
            });
        } catch (e) {
            console.warn('⚠️ [Sala VIP] Erro ao enviar mensagem de boas-vindas:', e.message);
        }

        // Bot sai após 60 segundos
        setTimeout(async () => {
            try {
                await sock.groupLeave(salaVipId);
                console.log(`🚪 [Sala VIP] Bot saiu do grupo ${salaVipId}`);
            } catch (e) {
                console.warn('⚠️ [Sala VIP] Erro ao sair do grupo:', e.message);
            }
        }, 60 * 1000);

        return salaVipId;

    } catch (e) {
        console.error('❌ [Sala VIP] Erro ao criar grupo:', e.message);
        return null;
    }
}

// ============================================
// 📩 HANDLER: #chm
// Etapa 1: Remetente chama alguém → bot pede #sv do remetente
// ============================================
export async function chamarHandler(sock, message, grupo) {
    await sock.sendMessage(grupo, { delete: message.key });

    const remetenteRaw = message.key.participant;

    if (!remetenteRaw) {
        await sock.sendMessage(grupo, {
            text: `❌ Não foi possível identificar o remetente.\n\n${RODAPE}`,
        });
        return true;
    }

    const nomeRemetente = message.pushName || remetenteRaw.split('@')[0];
    const mencionados   = message.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];

    if (mencionados.length === 0) {
        await sock.sendMessage(grupo, {
            text: `⚠️ Marque alguém para convidar! Ex: *#chm @maria*\n\n${RODAPE}`,
        });
        return true;
    }

    const convidadoRaw = mencionados[0];

    if (convidadoRaw === remetenteRaw) {
        await sock.sendMessage(grupo, {
            text: `❌ Você não pode se convidar!\n\n${RODAPE}`,
        });
        return true;
    }

    const convidado = garantirJidCompleto(await resolverJidViaGrupo(sock, convidadoRaw, grupo));
    const remetente = garantirJidCompleto(await resolverJidViaGrupo(sock, remetenteRaw, grupo));

    console.log(`🔍 [DEBUG] JIDs → convidado: ${convidado} | remetente: ${remetente}`);

    // Remove convites anteriores envolvendo o mesmo remetente ou convidado
    const digitosConvidado = convidado.replace(/\D/g, '');
    const digitosRemetente = remetente.replace(/\D/g, '');

    await query(
        `DELETE FROM convites_pendentes
         WHERE REGEXP_REPLACE(convidado, '[^0-9]', '', 'g') = $1
            OR REGEXP_REPLACE(remetente, '[^0-9]', '', 'g') = $2`,
        [digitosConvidado, digitosRemetente]
    );

    const botNumero = sock.user.id.split(':')[0];

    // Salva convite no banco na etapa inicial: aguardando_remetente (#sv)
    await query(
        `INSERT INTO convites_pendentes
            (convidado, remetente, nome_remetente, grupo, expires_at, etapa)
         VALUES ($1, $2, $3, $4, NOW() + INTERVAL '3 minutes', 'aguardando_remetente')`,
        [convidado, remetente, nomeRemetente, grupo]
    );

    // Pede #sv do REMETENTE
    const caption =
        `💌 *CONVITE SALA VIP* 💌\n\n` +
        `@${remetente.split('@')[0]}, 𝐏𝐀𝐑𝐀 𝐂𝐎𝐍𝐓𝐈𝐍𝐔𝐀𝐑 𝐕𝐎𝐂𝐄̂ 𝐏𝐑𝐄𝐂𝐈𝐒𝐀 𝐓𝐄𝐑 𝐎 𝐌𝐄𝐔 𝐍𝐔́𝐌𝐄𝐑𝐎 𝐒𝐀𝐋𝐕𝐎 𝐍𝐎 𝐒𝐄𝐔 𝐖𝐇𝐀𝐓𝐒𝐀𝐏𝐏. 📱\n\n` +
        `📲 𝗢 𝗺𝗲𝘂 𝗻𝘂́𝗺𝗲𝗿𝗼 𝗲́ *${botNumero}*.\n` +
        `Salve-o agora e escreva *#sv* aqui no grupo.\n\n` +
        `⚠️ Se não confirmar em *3 minutos*, o convite será cancelado automaticamente.\n\n` +
        `${RODAPE}`;

    await enviarComImagem(sock, grupo, caption, [remetente]);

    console.log(`💌 [#chm] ${nomeRemetente} → ${convidado.split('@')[0]} | aguardando #sv do remetente`);

    // Timer de expiração (3 min)
    setTimeout(async () => {
        try {
            const check = await query(
                `SELECT id FROM convites_pendentes
                 WHERE REGEXP_REPLACE(remetente, '[^0-9]', '', 'g') = $1
                   AND REGEXP_REPLACE(convidado, '[^0-9]', '', 'g') = $2`,
                [digitosRemetente, digitosConvidado]
            );

            if (check.rowCount === 0) return; // já foi resolvido

            await query(
                `DELETE FROM convites_pendentes
                 WHERE REGEXP_REPLACE(remetente, '[^0-9]', '', 'g') = $1
                   AND REGEXP_REPLACE(convidado, '[^0-9]', '', 'g') = $2`,
                [digitosRemetente, digitosConvidado]
            );

            await sock.sendMessage(grupo, {
                text:
                    `⌛ *CONVITE EXPIRADO* ❌\n\n` +
                    `@${remetente.split('@')[0]}, seu convite para @${convidado.split('@')[0]} foi *cancelado automaticamente*.\n\n` +
                    `😔 O tempo acabou antes da confirmação.\n\n` +
                    `💡 Se ainda quiser tentar, use *#chm @pessoa* novamente!\n\n` +
                    `${RODAPE}`,
                mentions: [remetente, convidado],
            });

        } catch (e) {
            console.error('❌ Erro ao expirar convite:', e.message);
        }
    }, 3 * 60 * 1000);

    return true;
}

// ============================================
// 💾 HANDLER: #sv
// Etapa 2 (remetente): confirma → bot pede #ok do remetente
// Etapa 3 (convidado): confirma → bot pede #ok do convidado
// ============================================
export async function salveiHandler(sock, message, grupo) {
    await sock.sendMessage(grupo, { delete: message.key });

    const autorRaw = message.key.participant;
    if (!autorRaw) return true;

    const autor        = garantirJidCompleto(await resolverJidViaGrupo(sock, autorRaw, grupo));
    const digitosAutor = autor.replace(/\D/g, '');
    const botNumero    = sock.user.id.split(':')[0];

    // ── Verifica se é o REMETENTE confirmando (etapa: aguardando_remetente) ──
    const resRemetente = await query(
        `SELECT * FROM convites_pendentes
         WHERE REGEXP_REPLACE(remetente, '[^0-9]', '', 'g') = $1
           AND expires_at > NOW()
           AND etapa = 'aguardando_remetente'`,
        [digitosAutor]
    );

    if (resRemetente.rowCount > 0) {
        const convite = resRemetente.rows[0];

        // Avança para etapa de confirmação do REMETENTE
        await query(
            `UPDATE convites_pendentes SET etapa = 'aguardando_confirmacao_remetente' WHERE id = $1`,
            [convite.id]
        );

        // Pede #ok ao REMETENTE antes de notificar o convidado
        const caption =
            `✋ *ATENÇÃO* , @${autor.split('@')[0]}\n\n` +
            `*Você tem certeza que salvou o meu número no seu WhatsApp* ❓\n\n` +
            `📱 Meu número é *${botNumero}*.\n\n` +
            `*Preciso que você me salve para conseguir te adicionar na SALA*\n\n` +
            `✅ Se já salvou, escreva *#ok* para continuar!\n\n` +
            `${RODAPE}`;

        await enviarComImagem(sock, grupo, caption, [autor]);

        console.log(`💾 [#sv] Remetente ${autor.split('@')[0]} enviou #sv → aguardando #ok do remetente`);
        return true;
    }

    // ── Verifica se é o CONVIDADO confirmando (etapa: aguardando_convidado) ──
    const resConvidado = await query(
        `SELECT * FROM convites_pendentes
         WHERE REGEXP_REPLACE(convidado, '[^0-9]', '', 'g') = $1
           AND expires_at > NOW()
           AND etapa = 'aguardando_convidado'`,
        [digitosAutor]
    );

    if (resConvidado.rowCount > 0) {
        const convite = resConvidado.rows[0];

        // Avança para etapa de confirmação do CONVIDADO
        await query(
            `UPDATE convites_pendentes SET etapa = 'aguardando_confirmacao' WHERE id = $1`,
            [convite.id]
        );

        // Pede #ok ao CONVIDADO
        const caption =
            `✋ *ATENÇÃO, @${autor.split('@')[0]}*\n\n` +
            `*Você tem certeza que salvou o meu número no seu WhatsApp* ❓\n\n` +
            `📱 Meu número é *${botNumero}*.\n\n` +
            `*Preciso que você me salve para conseguir te adicionar na *SALA VIP* 💎👑\n\n` +
            `✅ Se já salvou, escreva *#ok* para eu criar a sala agora!\n\n` +
            `${RODAPE}`;

        await enviarComImagem(sock, grupo, caption, [autor]);

        console.log(`🔔 [#sv] Convidado ${autor.split('@')[0]} enviou #sv → aguardando #ok do convidado`);
        return true;
    }

    // Nenhum convite ativo encontrado
    await sock.sendMessage(grupo, {
        text: `❌ @${autor.split('@')[0]}, você não tem nenhum convite ativo no momento.\n\n${RODAPE}`,
        mentions: [autor],
    });

    return true;
}

// ============================================
// ✅ HANDLER: #ok
// Etapa 3 (remetente): confirma salvou → bot notifica convidado
// Etapa 4 (convidado): confirma salvou → sala VIP criada
// ============================================
export async function confirmarHandler(sock, message, grupo) {
    await sock.sendMessage(grupo, { delete: message.key });

    const autorRaw = message.key.participant;
    if (!autorRaw) return true;

    const autor        = garantirJidCompleto(await resolverJidViaGrupo(sock, autorRaw, grupo));
    const digitosAutor = autor.replace(/\D/g, '');
    const botNumero    = sock.user.id.split(':')[0];

    // ── Verifica se é o REMETENTE confirmando (etapa: aguardando_confirmacao_remetente) ──
    const resRemetente = await query(
        `SELECT * FROM convites_pendentes
         WHERE REGEXP_REPLACE(remetente, '[^0-9]', '', 'g') = $1
           AND expires_at > NOW()
           AND etapa = 'aguardando_confirmacao_remetente'`,
        [digitosAutor]
    );

    if (resRemetente.rowCount > 0) {
        const convite      = resRemetente.rows[0];
        const convidadoJid = garantirJidCompleto(convite.convidado);

        // Avança etapa para aguardando_convidado
        await query(
            `UPDATE convites_pendentes SET etapa = 'aguardando_convidado' WHERE id = $1`,
            [convite.id]
        );

        // Avisa o CONVIDADO para salvar o número e enviar #sv
        const caption =
            `💌 *CONVITE SALA VIP* 💌\n\n` +
            `@${convidadoJid.split('@')[0]}, @${autor.split('@')[0]} 𝗤𝗨𝗘𝗥 𝗖𝗢𝗡𝗩𝗘𝗥𝗦𝗔𝗥 𝗖𝗢𝗠 𝗩𝗢𝗖𝗘̂ 𝗡𝗔 𝗦𝗔𝗟𝗔 𝗩𝗜𝗣! 💎\n\n` +
            `*A sala só será criada se você SALVAR meu número no seu WhatsApp.* 📱✅\n\n` +
            `📱 Salve o número *${botNumero}* e escreva *#sv* aqui no grupo.\n\n` +
            `❌ Se não quiser ir, escreva *#rec* \nNinguém no grupo ficará sabendo.\n\n` +
            `⚠️ 𝗦𝗲 𝗻𝗮̃𝗼 𝗿𝗲𝘀𝗽𝗼𝗻𝗱𝗲𝗿, 𝗼 𝗰𝗼𝗻𝘃𝗶𝘁𝗲 𝗲𝘅𝗽𝗶𝗿𝗮 𝗲𝗺 𝗯𝗿𝗲𝘃𝗲.\n\n` +
            `${RODAPE}`;

        await enviarComImagem(sock, grupo, caption, [convidadoJid, autor]);

        console.log(`✅ [#ok] Remetente ${autor.split('@')[0]} confirmou → notificando convidado ${convidadoJid.split('@')[0]}`);
        return true;
    }

    // ── Verifica se é o CONVIDADO confirmando (etapa: aguardando_confirmacao) ──
    const resConvidado = await query(
        `SELECT * FROM convites_pendentes
         WHERE REGEXP_REPLACE(convidado, '[^0-9]', '', 'g') = $1
           AND expires_at > NOW()
           AND etapa = 'aguardando_confirmacao'`,
        [digitosAutor]
    );

    if (resConvidado.rowCount > 0) {
        const convite      = resConvidado.rows[0];
        const remetenteJid = garantirJidCompleto(convite.remetente);

        // Remove convite do banco
        await query(`DELETE FROM convites_pendentes WHERE id = $1`, [convite.id]);
        console.log(`🗑️ [#ok] Convite removido do banco: ${convite.id}`);

        // Cria sala VIP
        const salaVipId = await criarGrupoVip(sock, autor, remetenteJid);

        if (!salaVipId) {
            await sock.sendMessage(grupo, {
                text: `❌ Não foi possível criar a Sala VIP. Tente novamente em instantes.\n\n${RODAPE}`,
            });
            return true;
        }

        await sock.sendMessage(grupo, {
            text:
                `✅ @${autor.split('@')[0]} confirmou! 🔒\n\n` +
                `💎 A *𝐒𝐀𝐋𝐀 𝐕𝐈𝐏* foi criada para @${autor.split('@')[0]} e @${remetenteJid.split('@')[0]}. Aproveitem! 🔥\n\n` +
                `${RODAPE}`,
            mentions: [autor, remetenteJid],
        });

        console.log(`✅ [#ok] Sala criada: ${autor.split('@')[0]} + ${remetenteJid.split('@')[0]} | ${salaVipId}`);
        return true;
    }

    // Nenhuma confirmação pendente encontrada
    await sock.sendMessage(grupo, {
        text: `❌ @${autor.split('@')[0]}, você não tem nenhuma confirmação pendente no momento.\n\n${RODAPE}`,
        mentions: [autor],
    });

    return true;
}

// ============================================
// ❌ HANDLER: #rec
// Convidado recusa → mensagens discretas no PV para ambos
// ============================================
export async function recusarHandler(sock, message, grupo) {
    await sock.sendMessage(grupo, { delete: message.key });

    const recusanteRaw = message.key.participant;
    if (!recusanteRaw) return true;

    const recusante = garantirJidCompleto(
        await resolverJidViaGrupo(sock, recusanteRaw, grupo)
    );
    const digitos = recusante.replace(/\D/g, '');

    console.log(`🔍 [DEBUG] recusante → ${recusante}`);

    // Convidado pode recusar nas etapas: aguardando_convidado OU aguardando_confirmacao
    const res = await query(
        `SELECT * FROM convites_pendentes
         WHERE REGEXP_REPLACE(convidado, '[^0-9]', '', 'g') = $1
           AND expires_at > NOW()
           AND etapa IN ('aguardando_convidado', 'aguardando_confirmacao')`,
        [digitos]
    );

    if (res.rowCount === 0) {
        try {
            await sock.sendMessage(recusante, {
                text: `❌ Você não tem nenhum convite pendente ou ele já expirou.\n\n${RODAPE}`,
            });
        } catch (e) {
            console.warn('⚠️ [#rec] Não foi possível avisar recusante no privado:', e.message);
        }
        return true;
    }

    const convite      = res.rows[0];
    const remetenteJid = garantirJidCompleto(convite.remetente);

    await query(`DELETE FROM convites_pendentes WHERE id = $1`, [convite.id]);
    console.log(`🗑️ [#recusar] Convite removido do banco: ${convite.id}`);

    // Notifica remetente no PV — discreto
    try {
        await sock.sendMessage(remetenteJid, {
            text:
                `💔 Seu convite para @${recusante.split('@')[0]} foi *recusado*.\n\n` +
                `Sem problemas, quem sabe numa próxima! 😊\n\n` +
                `${RODAPE}`,
            mentions: [recusante],
        });
    } catch (e) {
        console.warn('⚠️ [#rec] Não foi possível notificar remetente no privado:', e.message);
    }

    // Confirma para o recusante no PV
    try {
        await sock.sendMessage(recusante, {
            text:
                `✅ Convite de @${remetenteJid.split('@')[0]} *recusado* com sucesso.\n\n` +
                `Ninguém no grupo ficou sabendo. 🤫\n\n` +
                `${RODAPE}`,
            mentions: [remetenteJid],
        });
    } catch (e) {
        console.warn('⚠️ [#rec] Não foi possível confirmar recusa no privado:', e.message);
    }

    console.log(`❌ [#rec] ${recusante.split('@')[0]} recusou convite de ${remetenteJid.split('@')[0]}`);
    return true;
}

// ============================================
// 📢 HANDLER: #vip (Admin do grupo - Menciona todos)
// ============================================
export async function vipHandler(sock, message, grupo) {
    await sock.sendMessage(grupo, { delete: message.key });

    const remetenteRaw = message.key.participant || message.key.remoteJid;

    let mentions = [];
    let admins   = [];

    try {
        const meta = await sock.groupMetadata(grupo);
        mentions   = meta.participants.map(p => p.id);
        admins     = meta.participants
            .filter(p => p.admin === 'admin' || p.admin === 'superadmin')
            .map(p => p.id);

        console.log(`👥 [#vip] ${mentions.length} participantes | ${admins.length} admins`);

    } catch (e) {
        console.error('❌ [#vip] Erro ao buscar participantes:', e.message);
        await sock.sendMessage(grupo, {
            text: `❌ Não foi possível obter os membros do grupo.\n\n${RODAPE}`,
        });
        return true;
    }

    const digitosRemetente = remetenteRaw.replace(/@.*$/, '').replace(/\D/g, '');
    const isAdmin = admins.some(
        a => a.replace(/@.*$/, '').replace(/\D/g, '') === digitosRemetente
    );

    if (!isAdmin) {
        await sock.sendMessage(grupo, {
            text: `⛔ Apenas administradores podem usar o *#vip*.\n\n${RODAPE}`,
        });
        return true;
    }

    const poster =
        `🚨 *SALA VIP LIBERADA* 🔐\n\n` +
        `💎 Agora temos *SALA VIP* no grupo!\n\n` +
        `🚫 Não chame no PV sem permissão: alguns chamam sem avisar e outros ficam com vergonha no grupo.\n\n` +
        `✨ *Pensando nisso criamos a SALA VIP!* ✨\n\n` +
        `📌 *Como usar:*\n` +
        `👉 Quem quer chamar escreve: *#chm @pessoa*\n` +
        `👉 O bot pede que você salve o número dele e escreva *#sv*\n` +
        `👉 O bot pede uma confirmação com *#ok*\n` +
        `👉 O bot avisará a pessoa convidada, que também salva o número e escreve *#sv*\n` +
        `👉 O bot pedirá uma confirmação final com *#ok*\n` +
        `👉 Sala criada automaticamente! 🎉\n\n` +
        `❌ Se a pessoa convidada não quiser, ela escreve *#rec*\n\n` +
        `⚠️ *Importante:*\n` +
        `📲 Ambos precisam salvar o número do bot\n` +
        `👥 Só entram os dois\n` +
        `🤖 O bot sai da sala após 60 segundos\n` +
        `🤫 Recusas são discretas — ninguém no grupo fica sabendo\n\n` +
        `✔️ Mais respeito e menos constrangimento\n\n` +
        `${RODAPE}`;

    await enviarComImagem(sock, grupo, poster, mentions);

    console.log(`📢 [#vip] Poster enviado por ${digitosRemetente} com ${mentions.length} menções.`);
    return true;
}

// ============================================
// 🎯 ENTRADA PRINCIPAL
// ============================================
export async function handleChamarCommand(sock, message, content, from) {
    const lower = content.toLowerCase().trim();

    if (lower.startsWith('#chm'))  return await chamarHandler(sock, message, from);
    if (lower === '#sv')           return await salveiHandler(sock, message, from);
    if (lower === '#ok')           return await confirmarHandler(sock, message, from);
    if (lower === '#rec')          return await recusarHandler(sock, message, from);
    if (lower === '#vip')          return await vipHandler(sock, message, from);

    return false;
}