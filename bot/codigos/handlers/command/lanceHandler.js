// ARQUIVO: bot/codigos/handlers/command/lanceHandler.js
// (mesma pasta onde já ficam dcHandler.js, dcTransferHandler.js, etc.)

import pool from '../../../../db.js';
import { anunciosCache } from './leilaoCache.js';
import { flushDC } from '../../features/dcTracker.js';

function extractDigits(number) {
    if (!number) return null;
    return number.replace(/@.*$/, '').replace(/\D/g, '');
}

function getNumeroReal(message) {
    if (message.key.participantAlt) return message.key.participantAlt;
    if (message.key.participant) return message.key.participant;
    return message.key.remoteJid;
}

import { isBloqueado } from './casalBloqueioUtils.js';
// Se tivermos a foto do anúncio em cache, usamos ela como "quoted".
// Se o bot reiniciou e o cache está vazio, cai no fallback (quota a
// própria mensagem do usuário) — nunca deixa de responder por causa disso.
function quotedDoAnuncio(leilao, message) {
    const anuncioMsg = anunciosCache.get(leilao.id);
    return anuncioMsg || message;
}

// content = texto da mensagem, ex: "#lance 1300dc" ou "#lance 1300dc cod X7K9"
export async function handleLanceCommand(sock, message, content) {
    const from = message.key.remoteJid;
    if (!from.endsWith('@g.us')) return false;

    // "cod" com ou sem espaço antes do código: "codX7K9" ou "cod X7K9"
    const match = content.match(/^#lance\s+(\d+(?:[.,]\d+)?)\s*dc(?:\s+cod\s*(\w+))?/i);
    if (!match) return false;

    const valorLance = parseFloat(match[1].replace(',', '.'));
    const codigoInformado = match[2] ? match[2].toUpperCase() : null;

    // Precisa OU informar o código OU ser reply na mensagem de anúncio (ou última confirmação)
    const stanzaId = message.message?.extendedTextMessage?.contextInfo?.stanzaId;

    if (!stanzaId && !codigoInformado) {
        await sock.sendMessage(from, {
            text: '⚠️ Pra dar lance, use *#lance <valor>dc cod<código>* ou responda a mensagem do leilão com *#lance <valor>dc*.'
        }, { quoted: message });
        return true;
    }

    if (isNaN(valorLance) || valorLance <= 0) {
        await sock.sendMessage(from, {
            text: '⚠️ Valor inválido. Ex: *#lance 1300dc*'
        }, { quoted: message });
        return true;
    }

    // Garante que qualquer DC ganho recentemente (ainda no buffer do dcTracker,
    // aguardando o flush periódico) já esteja gravado antes de checar o saldo
    // pro lance — evita recusar por "saldo insuficiente" incorreto.
    await flushDC();

    const remetenteCompleto = getNumeroReal(message);
    const userId = extractDigits(remetenteCompleto);

    // 🔒 Verifica se o usuário está bloqueado em um casal ativo
    if (await isBloqueado(from, userId)) {
        await sock.sendMessage(from, {
            text: `⚠️ Você está em um casal ativo e não pode participar de leilões! Um admin precisa encerrar com *#fl* antes.`
        }, { quoted: message });
        return true;
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Trava a linha do leilão pra evitar corrida entre lances simultâneos.
        // Busca por código (se informado) ou por reply na mensagem de anúncio/última confirmação.
        let leilaoResult;
        if (codigoInformado) {
            leilaoResult = await client.query(
                `SELECT * FROM damas_dc_leiloes
                 WHERE codigo = $1 AND grupo_id = $2 AND status = 'aberto'
                 FOR UPDATE`,
                [codigoInformado, from]
            );
        } else {
            leilaoResult = await client.query(
                `SELECT l.* FROM damas_dc_leiloes l
                 JOIN damas_dc_leiloes_mensagens m ON m.leilao_id = l.id
                 WHERE m.message_id = $1 AND l.grupo_id = $2 AND l.status = 'aberto'
                 FOR UPDATE OF l`,
                [stanzaId, from]
            );
        }

        if (leilaoResult.rowCount === 0) {
            await client.query('ROLLBACK');
            const texto = codigoInformado
                ? `⚠️ Não encontrei nenhum leilão aberto com o código *${codigoInformado}*.`
                : '⚠️ Esse leilão não está mais aberto para lances.';
            await sock.sendMessage(from, { text: texto }, { quoted: message });
            return true;
        }

        const leilao = leilaoResult.rows[0];
        const valorAtual = Number(leilao.valor_atual);
        const quoted = { quoted: quotedDoAnuncio(leilao, message) };

        // 🔒 Impede que a pessoa leiloada dê lance em si mesma (auto-compra)
        if (userId === leilao.leiloado_id) {
            await client.query('ROLLBACK');
            await sock.sendMessage(from, {
                text: `⚠️ Você é a pessoa sendo leiloada [${leilao.codigo}] — não pode dar lance em si mesmo(a).`
            }, quoted);
            return true;
        }

        if (valorLance <= valorAtual) {
            await client.query('ROLLBACK');
            await pool.query(
                `INSERT INTO damas_dc_lances (leilao_id, user_id, valor, aceito, motivo_recusa)
                 VALUES ($1, $2, $3, false, 'valor_baixo')`,
                [leilao.id, userId, valorLance]
            );
            await sock.sendMessage(from, {
                text: `❌ Lance recusado [${leilao.codigo}]: precisa ser maior que ${valorAtual.toLocaleString('pt-BR')} DC.`
            }, quoted);
            return true;
        }

        const saldoResult = await client.query(
            `SELECT saldo FROM damas_dc_wallets WHERE user_id = $1`,
            [userId]
        );
        const saldoAtual = Number(saldoResult.rows[0]?.saldo || 0);

        if (saldoAtual < valorLance) {
            await client.query('ROLLBACK');
            await pool.query(
                `INSERT INTO damas_dc_lances (leilao_id, user_id, valor, aceito, motivo_recusa)
                 VALUES ($1, $2, $3, false, 'saldo_insuficiente')`,
                [leilao.id, userId, valorLance]
            );
            await sock.sendMessage(from, {
                text: `❌ Lance recusado [${leilao.codigo}]: saldo insuficiente. Você tem ${saldoAtual.toLocaleString('pt-BR')} DC, ` +
                      `precisa de pelo menos ${valorLance.toLocaleString('pt-BR')} DC.\n` +
                      `💬 Interaja mais no grupo para suas mensagens virarem DC e participar dos leilões!`
            }, quoted);
            return true;
        }

        await client.query(
            `UPDATE damas_dc_leiloes SET valor_atual = $1, lider_id = $2, lider_nome = $3 WHERE id = $4`,
            [valorLance, userId, message.pushName || userId, leilao.id]
        );

        await client.query(
            `INSERT INTO damas_dc_lances (leilao_id, user_id, valor, aceito)
             VALUES ($1, $2, $3, true)`,
            [leilao.id, userId, valorLance]
        );

        await client.query('COMMIT');

        const confirmacao = await sock.sendMessage(from, {
            text: `🔨 *NOVO LANCE NO LEILÃO* 🔨\n\n` +
                  `💵 @${userId} assumiu a liderança com *${valorLance.toLocaleString('pt-BR')} DC* 💎\n\n` +
                  `🏆 [${leilao.codigo}] — *Quem cobre esse lance?*`,
            mentions: [`${userId}@s.whatsapp.net`]
        }, quoted);

        // Guarda o ID dessa confirmação como um novo "alvo" válido pra responder com #lance
        // (continua funcionando pra quem prefere responder por reply em vez de código)
        await pool.query(
            `UPDATE damas_dc_leiloes SET ultimo_lance_message_id = $1 WHERE id = $2`,
            [confirmacao.key.id, leilao.id]
        );
        await pool.query(
            `INSERT INTO damas_dc_leiloes_mensagens (message_id, leilao_id) VALUES ($1, $2)
             ON CONFLICT (message_id) DO NOTHING`,
            [confirmacao.key.id, leilao.id]
        );

        return true;

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[handleLanceCommand] Erro:', err.message);
        await sock.sendMessage(from, {
            text: '❌ Erro ao processar o lance.'
        }, { quoted: message });
        return true;
    } finally {
        client.release();
    }
}