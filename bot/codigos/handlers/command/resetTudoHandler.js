// ARQUIVO: bot/codigos/handlers/command/resetTudoHandler.js
// (mesma pasta onde ficam leilaoHandler.js, resetLeilaoHandler.js, etc.)
//
// 🧹💥 Comando pra resetar (APAGAR) TODOS os leilões de TODOS os grupos.
// Diferente do #rl (que só apaga do grupo atual), esse aqui é global
// e por isso é travado só pro número autorizado (dono/dev do bot).
//
// Aceita: #resetartudo
//
// Por ser destrutivo (e global), funciona em 2 passos:
//   1) #resetartudo            -> mostra quantos leilões seriam apagados no total e pede confirmação
//   2) #resetartudo confirmar  -> apaga de verdade, de todos os grupos

import pool from '../../../../db.js';
import { checarAutorizacao } from '../../utils/authNumero.js';

// 🔒 Só esses IDs podem rodar o reset global (mesmos usados no #resetardc).
// Alguns grupos mandam o número de telefone real, outros (com privacidade LID
// ativada) só mandam o LID oculto — por isso os dois ficam na lista.
const NUMEROS_AUTORIZADOS = [
    '5521972337640',   // número de telefone real
    '110243874902093', // LID (identificador oculto usado em alguns grupos)
];

// Tira acento, por segurança (não deveria ter acento nesse comando, mas por consistência com o #rl)
function normalizarComando(texto) {
    return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export async function handleResetTudoCommand(sock, message, content) {
    const from = message.key.remoteJid;

    const normalizado = normalizarComando(content).trim().toLowerCase();

    // Aceita #resetartudo (com ou sem "confirmar" no final)
    const match = normalizado.match(/^#resetartudo\b\s*(confirmar)?/i);
    if (!match) return false;

    const querConfirmar = !!match[1];

    try {
        const { autorizado, solicitanteId } = checarAutorizacao(message, NUMEROS_AUTORIZADOS);

        console.log(`[resetTudoHandler] Tentativa de reset global por: ${solicitanteId} (autorizados: ${NUMEROS_AUTORIZADOS.join(', ')})`);

        // 🔒 Checagem de autorização (só o número autorizado pode usar)
        if (!autorizado) {
            await sock.sendMessage(from, {
                text: '🚫 Esse comando é restrito. Só o responsável pelo bot pode resetar tudo.'
            }, { quoted: message });
            return true;
        }

        // 1️⃣ Busca TODOS os leilões, de TODOS os grupos, qualquer status
        const preview = await pool.query(
            `SELECT id, status, grupo_id FROM damas_dc_leiloes`
        );

        if (preview.rowCount === 0) {
            await sock.sendMessage(from, {
                text: '✅ Não há nenhum leilão registrado em nenhum grupo pra resetar.'
            }, { quoted: message });
            return true;
        }

        const idsParaApagar = preview.rows.map(r => r.id);
        const gruposUnicos = new Set(preview.rows.map(r => r.grupo_id)).size;

        // 2️⃣ Sem "confirmar" -> só avisa e pede confirmação
        if (!querConfirmar) {
            const porStatus = {};
            for (const row of preview.rows) {
                porStatus[row.status] = (porStatus[row.status] || 0) + 1;
            }
            const resumoStatus = Object.entries(porStatus)
                .map(([status, qtd]) => `   • ${status}: ${qtd}`)
                .join('\n');

            await sock.sendMessage(from, {
                text: `⚠️💥 *ATENÇÃO — RESET GLOBAL, AÇÃO IRREVERSÍVEL*\n\n` +
                      `Isso vai apagar *${preview.rowCount} leilão(ões)* de *${gruposUnicos} grupo(s) diferentes*, incluindo lances e histórico:\n\n` +
                      `${resumoStatus}\n\n` +
                      `Se tiver certeza, mande:\n*#resetartudo confirmar*`
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

            await sock.sendMessage(from, {
                text: `✅ *Reset global concluído!*\n\n` +
                      `🌍 ${gruposUnicos} grupo(s) afetado(s)\n` +
                      `🗑️ ${delLeiloes.rowCount} leilão(ões) apagado(s)\n` +
                      `🗑️ ${delLances.rowCount} lance(s) apagado(s)\n` +
                      `🗑️ ${delMensagens.rowCount} mensagem(ns) vinculada(s) apagada(s)\n\n` +
                      `Todos os grupos estão livres pra abrir novos leilões.`
            }, { quoted: message });

            console.log(`🧹💥 [resetTudoHandler] Reset GLOBAL feito por ${solicitanteId} — ${delLeiloes.rowCount} leilões apagados em ${gruposUnicos} grupos`);

        } catch (err) {
            await client.query('ROLLBACK').catch(() => {});

            if (err.code === '23503') {
                await sock.sendMessage(from, {
                    text: `❌ Erro: existe outra tabela vinculada não prevista (constraint: ${err.constraint}). Avisa o dev pra ajustar o comando.`
                }, { quoted: message });
            } else {
                await sock.sendMessage(from, {
                    text: '❌ Erro ao resetar tudo. Tente novamente.'
                }, { quoted: message });
            }
            console.error('[resetTudoHandler] Erro ao apagar:', err.message);
        } finally {
            client.release();
        }

        return true;

    } catch (err) {
        console.error('[handleResetTudoCommand] Erro:', err.message);
        await sock.sendMessage(from, {
            text: '❌ Erro ao processar o comando de reset global.'
        }, { quoted: message });
        return true;
    }
}