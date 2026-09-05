// ARQUIVO: bot/codigos/handlers/command/resetLeilaoHandler.js
// (mesma pasta onde ficam leilaoHandler.js, fecharLeilaoHandler.js, etc.)
//
// 🧹 Comando pra resetar (APAGAR) todos os leilões do grupo atual,
// de qualquer status (aberto, arrematado, fechado...).
//
// Aceita: #rl | #resetarleilao | #resetarleilão
//
// Por ser destrutivo, funciona em 2 passos:
//   1) #rl            -> mostra quantos leilões seriam apagados e pede confirmação
//   2) #rl confirmar   -> apaga de verdade

import pool from '../../../../db.js';

function extractDigits(number) {
    if (!number) return null;
    return number.replace(/@.*$/, '').replace(/\D/g, '');
}

function getNumeroReal(message) {
    if (message.key.participantAlt) return message.key.participantAlt;
    if (message.key.participant) return message.key.participant;
    return message.key.remoteJid;
}

// Tira acento pra aceitar "#resetarleilão" e "#resetarleilao" igual
function normalizarComando(texto) {
    return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
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
        console.error('[resetLeilaoHandler] Erro ao checar admin:', err.message);
        return false;
    }
}

export async function handleResetLeilaoCommand(sock, message, content) {
    const from = message.key.remoteJid;
    if (!from.endsWith('@g.us')) return false;

    const normalizado = normalizarComando(content).trim().toLowerCase();

    // Aceita #rl, #resetarleilao (com ou sem "confirmar" no final)
    const match = normalizado.match(/^#(rl|resetarleilao)\b\s*(confirmar)?/i);
    if (!match) return false;

    const querConfirmar = !!match[2];

    const from_ = from; // clareza
    try {
        const remetenteCompleto = getNumeroReal(message);
        const adminId = extractDigits(remetenteCompleto);

        const ehAdmin = await isAdmin(sock, from_, adminId);
        if (!ehAdmin) {
            await sock.sendMessage(from_, {
                text: '🚫 Só administradores podem resetar leilões.'
            }, { quoted: message });
            return true;
        }

        // 1️⃣ Busca todos os leilões DESSE grupo (qualquer status)
        const preview = await pool.query(
            `SELECT id, status FROM damas_dc_leiloes WHERE grupo_id = $1`,
            [from_]
        );

        if (preview.rowCount === 0) {
            await sock.sendMessage(from_, {
                text: '✅ Não há nenhum leilão registrado nesse grupo pra resetar.'
            }, { quoted: message });
            return true;
        }

        const idsParaApagar = preview.rows.map(r => r.id);

        // 2️⃣ Sem "confirmar" -> só avisa e pede confirmação
        if (!querConfirmar) {
            const porStatus = {};
            for (const row of preview.rows) {
                porStatus[row.status] = (porStatus[row.status] || 0) + 1;
            }
            const resumoStatus = Object.entries(porStatus)
                .map(([status, qtd]) => `   • ${status}: ${qtd}`)
                .join('\n');

            await sock.sendMessage(from_, {
                text: `⚠️ *ATENÇÃO — AÇÃO IRREVERSÍVEL*\n\n` +
                      `Isso vai apagar *${preview.rowCount} leilão(ões)* desse grupo, incluindo lances e histórico:\n\n` +
                      `${resumoStatus}\n\n` +
                      `Se tiver certeza, mande:\n*#rl confirmar*`
            }, { quoted: message });
            return true;
        }

        // 3️⃣ Com "confirmar" -> apaga de fato em transação
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const delLances = await client.query(
                `DELETE FROM damas_dc_lances WHERE leilao_id = ANY($1::int[])`,
                [idsParaApagar]
            );

            const delMensagens = await client.query(
                `DELETE FROM damas_dc_leiloes_mensagens WHERE leilao_id = ANY($1::int[])`,
                [idsParaApagar]
            );

            const delLeiloes = await client.query(
                `DELETE FROM damas_dc_leiloes WHERE id = ANY($1::int[])`,
                [idsParaApagar]
            );

            await client.query('COMMIT');

            await sock.sendMessage(from_, {
                text: `✅ *Reset concluído!*\n\n` +
                      `🗑️ ${delLeiloes.rowCount} leilão(ões) apagado(s)\n` +
                      `🗑️ ${delLances.rowCount} lance(s) apagado(s)\n` +
                      `🗑️ ${delMensagens.rowCount} mensagem(ns) vinculada(s) apagada(s)\n\n` +
                      `O grupo está livre pra abrir um novo leilão.`
            }, { quoted: message });

            console.log(`🧹 [resetLeilaoHandler] Grupo ${from_} resetado por ${adminId} — ${delLeiloes.rowCount} leilões apagados`);

        } catch (err) {
            await client.query('ROLLBACK').catch(() => {});

            if (err.code === '23503') {
                await sock.sendMessage(from_, {
                    text: `❌ Erro: existe outra tabela vinculada não prevista (constraint: ${err.constraint}). Avisa o dev pra ajustar o comando.`
                }, { quoted: message });
            } else {
                await sock.sendMessage(from_, {
                    text: '❌ Erro ao resetar os leilões. Tente novamente.'
                }, { quoted: message });
            }
            console.error('[resetLeilaoHandler] Erro ao apagar:', err.message);
        } finally {
            client.release();
        }

        return true;

    } catch (err) {
        console.error('[handleResetLeilaoCommand] Erro:', err.message);
        await sock.sendMessage(from, {
            text: '❌ Erro ao processar o comando de reset.'
        }, { quoted: message });
        return true;
    }
}