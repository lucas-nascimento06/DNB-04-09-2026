import pool from '../../../../db.js';
import { anunciosCache } from './leilaoCache.js';
import { flushDC } from '../../features/dcTracker.js';
import { bloquearCasal } from './casalBloqueioUtils.js';
import { obterParticipantesGrupo } from './leilaoHandler.js';

const GRUPO_ORGANIZACAO_ID = process.env.GRUPO_LEILOES_ID;

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
        console.error('[arrematarHandler] Erro ao checar admin:', err.message);
        return false;
    }
}

function quotedDoAnuncio(leilaoId, fallback) {
    const anuncioMsg = anunciosCache.get(leilaoId);
    return anuncioMsg || fallback;
}

export async function arremaverLeilao(sock, grupoId, quotedFallback = null) {
    await flushDC();

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const leilaoResult = await client.query(
            `SELECT * FROM damas_dc_leiloes WHERE grupo_id = $1 AND status = 'aberto' FOR UPDATE`,
            [grupoId]
        );

        if (leilaoResult.rowCount === 0) {
            await client.query('ROLLBACK');
            return { ok: false, motivo: 'sem_leilao_aberto' };
        }

        const leilao = leilaoResult.rows[0];
        const quoted = { quoted: quotedDoAnuncio(leilao.id, quotedFallback) };

        const liderJid = `${leilao.lider_id}@s.whatsapp.net`;
        const leiloadoJid = `${leilao.leiloado_id}@s.whatsapp.net`;

        if (!leilao.lider_id) {
            await client.query('ROLLBACK');
            if (quotedFallback) {
                await sock.sendMessage(grupoId, {
                    text: `⚠️ Ninguém deu lance ainda nesse leilão [${leilao.codigo}].`
                }, quoted);
            }
            return { ok: false, motivo: 'sem_lances' };
        }

        const saldoResult = await client.query(
            `SELECT saldo FROM damas_dc_wallets WHERE user_id = $1 FOR UPDATE`,
            [leilao.lider_id]
        );
        const saldoLider = Number(saldoResult.rows[0]?.saldo || 0);
        const valorFinal = Number(leilao.valor_atual);

        if (saldoLider < valorFinal) {
            await client.query(
                `UPDATE damas_dc_leiloes SET status = 'fechado', fechado_em = NOW() WHERE id = $1`,
                [leilao.id]
            );
            await client.query('COMMIT');
            await sock.sendMessage(grupoId, {
                text: `🔨 Leilão [${leilao.codigo}]: @${leilao.lider_id} venceu com ${valorFinal.toLocaleString('pt-BR')} DC ` +
                      `mas não tem mais saldo suficiente. Arremate cancelado.`,
                mentions: [liderJid]
            }, quoted);
            anunciosCache.delete(leilao.id);
            return { ok: false, motivo: 'saldo_insuficiente' };
        }

        await client.query(
            `UPDATE damas_dc_wallets SET saldo = saldo - $1, atualizado_em = NOW() WHERE user_id = $2`,
            [valorFinal, leilao.lider_id]
        );
        await client.query(
            `INSERT INTO damas_dc_wallets (user_id, saldo)
             VALUES ($1, $2)
             ON CONFLICT (user_id)
             DO UPDATE SET saldo = damas_dc_wallets.saldo + $2, atualizado_em = NOW()`,
            [leilao.admin_id, valorFinal]
        );

        await client.query(
            `UPDATE damas_dc_leiloes SET status = 'arrematado', arrematado_em = NOW() WHERE id = $1`,
            [leilao.id]
        );

        await bloquearCasal(client, grupoId, leilao.leiloado_id, leilao.lider_id, leilao.id, valorFinal);

        await client.query('COMMIT');

        // 🆕 Marca TODO MUNDO do grupo na mensagem de "vendido/casal formado"
        // (mesma técnica do #leilao e do #lance) — assim o grupo inteiro é
        // notificado de que o casal foi formado, não só quem tava de olho.
        // Marcação "silenciosa": só @lider_id e @leiloado_id aparecem
        // escritos no texto, o resto do grupo entra só no "mentions".
        const participantesGrupo = await obterParticipantesGrupo(sock, grupoId);
        const mentionsTodos = Array.from(new Set([liderJid, leiloadoJid, ...participantesGrupo]));

        await sock.sendMessage(grupoId, {
            text: `🔨 *Dou-lhe uma... Dou-lhe duas... Vendido por ${valorFinal.toLocaleString('pt-BR')} DC!* Parabéns ao arrematante!\n\n` +
                  `💑 Casal formado: @${leilao.lider_id} e @${leilao.leiloado_id}\n` +
                  `📅 Válido por *3 dias*!\n\n` +
                  `🎯 Os desafios serão enviados pelos admins. Aguardem e sejam felizes! 💕`,
            mentions: mentionsTodos
        }, quoted);

        if (GRUPO_ORGANIZACAO_ID) {
            await sock.sendMessage(GRUPO_ORGANIZACAO_ID, {
                text: `📋 *REGISTRO DE LEILÃO ENCERRADO*\n` +
                      `━━━━━━━━━━━━━━\n` +
                      `🔨 Vendido por: ${valorFinal.toLocaleString('pt-BR')} DC\n` +
                      `💑 Casal formado: @${leilao.lider_id} e @${leilao.leiloado_id}\n` +
                      `📅 Válido por: 3 dias\n` +
                      `━━━━━━━━━━━━━━`,
                mentions: [liderJid, leiloadoJid]
            });
        } else {
            console.warn('[arrematarHandler] GRUPO_LEILOES_ID não configurado no .env');
        }

        anunciosCache.delete(leilao.id);
        return { ok: true };

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[arremaverLeilao] Erro:', err.message);
        if (quotedFallback) {
            await sock.sendMessage(grupoId, { text: '❌ Erro ao arrematar o leilão.' }, { quoted: quotedFallback });
        }
        return { ok: false, motivo: 'erro' };
    } finally {
        client.release();
    }
}

export async function handleArrematarCommand(sock, message, content) {
    const from = message.key.remoteJid;
    if (!from.endsWith('@g.us')) return false;
    if (!/^#arrematar\b/i.test(content.trim())) return false;

    const remetenteCompleto = getNumeroReal(message);
    const adminId = extractDigits(remetenteCompleto);

    const ehAdmin = await isAdmin(sock, from, adminId);
    if (!ehAdmin) {
        await sock.sendMessage(from, {
            text: '🚫 Só administradores podem arrematar leilões.'
        }, { quoted: message });
        return true;
    }

    const resultado = await arremaverLeilao(sock, from, message);

    if (!resultado.ok && resultado.motivo === 'sem_leilao_aberto') {
        await sock.sendMessage(from, {
            text: '⚠️ Não tem nenhum leilão aberto nesse grupo pra arrematar.'
        }, { quoted: message });
    }

    return true;
}