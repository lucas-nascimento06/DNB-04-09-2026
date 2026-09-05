// ARQUIVO: bot/codigos/handlers/command/resetDcHandler.js
// (mesma pasta onde ficam leilaoHandler.js, resetLeilaoHandler.js, resetTudoHandler.js, etc.)
//
// 🧹💰 Comando pra resetar (APAGAR) TODO o histórico de DC de TODOS os
// grupos: zera as carteiras (damas_dc_wallets) e o histórico de mensagens
// que geraram DC (damas_dc_messages). Serve pra começar uma "temporada"
// nova de contagem depois que um leilão é encerrado.
//
// Aceita: #resetardc
//
// Igual ao #resetartudo, é global e por isso travado só pro número
// autorizado (dono/dev do bot). Funciona em 2 passos:
//   1) #resetardc            -> mostra quantas carteiras/mensagens seriam apagadas e pede confirmação
//   2) #resetardc confirmar  -> apaga de verdade

import pool from '../../../../db.js';
import { flushDC } from '../../features/dcTracker.js';
import { checarAutorizacao } from '../../utils/authNumero.js';

// 🔒 Só esses IDs podem rodar o reset global de DC (mesmos usados no #resetartudo).
// Alguns grupos mandam o número de telefone real, outros (com privacidade LID
// ativada) só mandam o LID oculto — por isso os dois ficam na lista.
const NUMEROS_AUTORIZADOS = [
    '5521972337640',   // número de telefone real
    '110243874902093', // LID (identificador oculto usado em alguns grupos)
];

function normalizarComando(texto) {
    return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export async function handleResetDcCommand(sock, message, content) {
    const from = message.key.remoteJid;

    const normalizado = normalizarComando(content).trim().toLowerCase();

    // Aceita #resetardc (com ou sem "confirmar" no final)
    const match = normalizado.match(/^#resetardc\b\s*(confirmar)?/i);
    if (!match) return false;

    const querConfirmar = !!match[1];

    try {
        // ✅ CORREÇÃO: antes, getNumeroReal local pegava sempre o primeiro
        // campo que existisse (participantAlt -> participant -> remoteJid),
        // sem checar o formato. Em grupos que usam LID, "participant" pode
        // vir como "123456789@lid" em vez do número real "@s.whatsapp.net",
        // e isso fazia extractDigits gerar um ID diferente do seu número
        // real — por isso o bot não te reconhecia. Agora checarAutorizacao
        // usa getNumeroReal do authNumero.js, que procura entre TODOS os
        // campos disponíveis (participantAlt, participantPn, participant,
        // remoteJid) e prioriza o que já vier no formato @s.whatsapp.net.
        const { autorizado, solicitanteId } = checarAutorizacao(message, NUMEROS_AUTORIZADOS);

        console.log(`[resetDcHandler] Tentativa de reset DC por: ${solicitanteId} (autorizados: ${NUMEROS_AUTORIZADOS.join(', ')})`);
        console.log('[resetDcHandler] DEBUG message.key:', JSON.stringify(message.key));

        // 🔒 Checagem de autorização (só o número autorizado pode usar)
        if (!autorizado) {
            await sock.sendMessage(from, {
                text: '🚫 Esse comando é restrito. Só o responsável pelo bot pode resetar o DC.'
            }, { quoted: message });
            return true;
        }

        // Garante que nada fique perdido no buffer em memória do dcTracker
        // antes de contar/apagar — senão essas mensagens pendentes seriam
        // gravadas DEPOIS do reset e o saldo "voltaria" sozinho.
        await flushDC();

        // 1️⃣ Prévia: quantas carteiras e mensagens existem no total
        const previewWallets = await pool.query(`SELECT COUNT(*)::int AS total FROM damas_dc_wallets`);
        const previewMessages = await pool.query(`SELECT COUNT(*)::int AS total FROM damas_dc_messages`);

        const totalWallets = previewWallets.rows[0].total;
        const totalMessages = previewMessages.rows[0].total;

        if (totalWallets === 0 && totalMessages === 0) {
            await sock.sendMessage(from, {
                text: '✅ Não há nenhum DC registrado (carteiras ou mensagens) pra resetar.'
            }, { quoted: message });
            return true;
        }

        // 2️⃣ Sem "confirmar" -> só avisa e pede confirmação
        if (!querConfirmar) {
            await sock.sendMessage(from, {
                text: `⚠️💰 *ATENÇÃO — RESET GLOBAL DE DC, AÇÃO IRREVERSÍVEL*\n\n` +
                      `Isso vai apagar, de *TODOS os grupos*:\n\n` +
                      `   • ${totalWallets} carteira(s) (saldo de DC de todo mundo)\n` +
                      `   • ${totalMessages} mensagem(ns) contabilizada(s)\n\n` +
                      `Todo mundo volta a ter *0 DC* e a contagem de mensagens recomeça do zero.\n\n` +
                      `Se tiver certeza, mande:\n*#resetardc confirmar*`
            }, { quoted: message });
            return true;
        }

        // 3️⃣ Com "confirmar" -> apaga de fato em transação
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const delMessages = await client.query(`DELETE FROM damas_dc_messages`);
            const delWallets = await client.query(`DELETE FROM damas_dc_wallets`);

            await client.query('COMMIT');

            await sock.sendMessage(from, {
                text: `✅ *Reset de DC concluído!*\n\n` +
                      `🗑️ ${delWallets.rowCount} carteira(s) zerada(s)\n` +
                      `🗑️ ${delMessages.rowCount} mensagem(ns) apagada(s)\n\n` +
                      `💰 A contagem de DC recomeça do zero pra todo mundo, em todos os grupos.`
            }, { quoted: message });

            console.log(`🧹💰 [resetDcHandler] Reset GLOBAL de DC feito por ${solicitanteId} — ${delWallets.rowCount} carteiras e ${delMessages.rowCount} mensagens apagadas`);

        } catch (err) {
            await client.query('ROLLBACK').catch(() => {});

            if (err.code === '23503') {
                await sock.sendMessage(from, {
                    text: `❌ Erro: existe outra tabela vinculada não prevista (constraint: ${err.constraint}). Avisa o dev pra ajustar o comando.`
                }, { quoted: message });
            } else {
                await sock.sendMessage(from, {
                    text: '❌ Erro ao resetar o DC. Tente novamente.'
                }, { quoted: message });
            }
            console.error('[resetDcHandler] Erro ao apagar:', err.message);
        } finally {
            client.release();
        }

        return true;

    } catch (err) {
        console.error('[handleResetDcCommand] Erro:', err.message);
        await sock.sendMessage(from, {
            text: '❌ Erro ao processar o comando de reset de DC.'
        }, { quoted: message });
        return true;
    }
}