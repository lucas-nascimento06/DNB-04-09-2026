// ARQUIVO: bot/codigos/handlers/command/dcasalHandler.js
// (mesma pasta onde já ficam leilaoHandler.js, fecharLeilaoHandler.js, etc.)
//
// #dcasal — Admin, em qualquer lugar do grupo.
//
// Uso: só "#dcasal", sozinho. Sem reply, sem marcar ninguém, sem código.
//
// Libera (encerra) DE UMA VEZ todos os casais que estiverem bloqueados
// (status = 'ativo' em damas_dc_casais_ativos) nesse grupo — não precisa
// mais dar #fl pra isso, e não precisa saber de qual leilão veio o casal.
//
// Se não tiver nenhum casal bloqueado no grupo, só avisa que já está livre.

import pool from '../../../../db.js';
import { desbloquearTodosCasaisDoGrupo } from './casalBloqueioUtils.js';

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
        console.error('[dcasalHandler] Erro ao checar admin:', err.message);
        return false;
    }
}

// content = texto da mensagem, ex: "#dcasal"
export async function handleDCasalCommand(sock, message, content) {
    const from = message.key.remoteJid;
    if (!from.endsWith('@g.us')) return false;

    if (!/^#dcasal\b/i.test(content)) return false;

    const remetenteCompleto = getNumeroReal(message);
    const adminId = extractDigits(remetenteCompleto);

    const ehAdmin = await isAdmin(sock, from, adminId);
    if (!ehAdmin) {
        await sock.sendMessage(from, {
            text: '🚫 Só administradores podem liberar casal.'
        }, { quoted: message });
        return true;
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const casaisLiberados = await desbloquearTodosCasaisDoGrupo(from, adminId, client);

        await client.query('COMMIT');

        if (casaisLiberados.length === 0) {
            await sock.sendMessage(from, {
                text: '✅ Não há nenhum casal bloqueado nesse grupo no momento.'
            }, { quoted: message });
            return true;
        }

        const mentions = [];
        const linhas = casaisLiberados.map(c => {
            mentions.push(`${c.membro1_id}@s.whatsapp.net`, `${c.membro2_id}@s.whatsapp.net`);
            return `   • @${c.membro1_id} e @${c.membro2_id} (${Number(c.valor_dc).toLocaleString('pt-BR')} DC)`;
        }).join('\n');

        const textoPlural = casaisLiberados.length > 1 ? 'Casais liberados' : 'Casal liberado';

        await sock.sendMessage(from, {
            text: `🔓 *${textoPlural}!*\n\n${linhas}\n\n✅ Livre(s) novamente.`,
            mentions
        }, { quoted: message });

        return true;

    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('[handleDCasalCommand] Erro:', err.message);
        await sock.sendMessage(from, {
            text: '❌ Erro ao liberar o casal.'
        }, { quoted: message });
        return true;
    } finally {
        client.release();
    }
}