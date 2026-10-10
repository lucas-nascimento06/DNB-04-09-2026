// bot/codigos/handlers/command/desafioMusical/dados.js
// Tudo que fala com o banco de dados (times, pote, carteiras, prêmio, músicas usadas).

import pool from '../../../../../db.js';
import { CONFIG } from './config.js';
import { embaralhar } from './utils.js';

let tabelasOk = false;

export async function garantirTabelas() {
    if (tabelasOk) return;

    await pool.query(`
        CREATE TABLE IF NOT EXISTS damas_dm_times (
            grupo_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            jid TEXT,
            time TEXT NOT NULL,
            atualizado_em TIMESTAMPTZ DEFAULT NOW(),
            PRIMARY KEY (grupo_id, user_id)
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS damas_dm_pote (
            id INT PRIMARY KEY,
            saldo BIGINT NOT NULL DEFAULT 0,
            atualizado_em TIMESTAMPTZ DEFAULT NOW()
        )
    `);

    await pool.query(
        `INSERT INTO damas_dm_pote (id, saldo) VALUES (1, $1) ON CONFLICT (id) DO NOTHING`,
        [CONFIG.poteInicial]
    );

    // histórico de músicas já tocadas (para nunca repetir entre desafios)
    await pool.query(`
        CREATE TABLE IF NOT EXISTS damas_dm_usadas (
            grupo_id TEXT NOT NULL,
            musica_id INT NOT NULL,
            usado_em TIMESTAMPTZ DEFAULT NOW(),
            PRIMARY KEY (grupo_id, musica_id)
        )
    `);

    tabelasOk = true;
}

export async function getPote() {
    const { rows } = await pool.query(`SELECT saldo FROM damas_dm_pote WHERE id = 1`);
    return Number(rows[0]?.saldo || 0);
}

export async function definirPote(valor) {
    await pool.query(
        `INSERT INTO damas_dm_pote (id, saldo) VALUES (1, $1)
         ON CONFLICT (id) DO UPDATE SET saldo = EXCLUDED.saldo, atualizado_em = NOW()`,
        [valor]
    );
}

// Saldo de DCs do usuário (sem carteira = 0)
export async function getSaldoDC(userId) {
    const { rows } = await pool.query(
        `SELECT saldo FROM damas_dc_wallets WHERE user_id = $1`,
        [userId]
    );
    return Number(rows[0]?.saldo || 0);
}

export async function getTimeDoUsuario(grupoId, userId) {
    const { rows } = await pool.query(
        `SELECT time FROM damas_dm_times WHERE grupo_id = $1 AND user_id = $2`,
        [grupoId, userId]
    );
    return rows[0]?.time || null;
}

export async function salvarTime(grupoId, userId, jid, time) {
    await pool.query(
        `INSERT INTO damas_dm_times (grupo_id, user_id, jid, time)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (grupo_id, user_id)
         DO UPDATE SET jid = EXCLUDED.jid, time = EXCLUDED.time, atualizado_em = NOW()`,
        [grupoId, userId, jid, time]
    );
}

export async function membrosDoTime(grupoId, time) {
    const { rows } = await pool.query(
        `SELECT user_id, jid FROM damas_dm_times
         WHERE grupo_id = $1 AND time = $2
         ORDER BY atualizado_em`,
        [grupoId, time]
    );
    return rows;
}

export async function limparTimes(grupoId) {
    await pool.query(`DELETE FROM damas_dm_times WHERE grupo_id = $1`, [grupoId]);
}

// ---------- músicas já usadas (histórico entre desafios) ----------

export async function getUsadas(grupoId) {
    const { rows } = await pool.query(
        `SELECT musica_id FROM damas_dm_usadas WHERE grupo_id = $1`,
        [grupoId]
    );
    return new Set(rows.map(r => r.musica_id));
}

export async function marcarUsada(grupoId, musicaId) {
    await pool.query(
        `INSERT INTO damas_dm_usadas (grupo_id, musica_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [grupoId, musicaId]
    );
}

export async function limparUsadas(grupoId) {
    await pool.query(`DELETE FROM damas_dm_usadas WHERE grupo_id = $1`, [grupoId]);
}

// Prêmio da rodada: parte maior para quem acertou, o resto dividido entre os OUTROS do time.
// Tira do pote e credita nas carteiras (damas_dc_wallets).
export async function pagarPremio(grupoId, time, userIdVencedor, jidVencedor) {
    const membros = await membrosDoTime(grupoId, time);
    const outros = membros.filter(m => m.user_id !== userIdVencedor);

    const pote = await getPote();
    const premio = Math.min(CONFIG.premioDC, pote);
    if (premio <= 0) return { ok: false, motivo: 'pote-vazio' };

    // sem outros no time: quem acertou leva tudo
    let parteAcertador = outros.length === 0
        ? premio
        : Math.min(CONFIG.premioAcertadorDC, premio);
    const resto = premio - parteAcertador;

    let beneficiados = [];
    let porMembro = 0;
    let sorteio = false;

    if (resto > 0 && outros.length > 0) {
        beneficiados = outros;
        porMembro = Math.floor(resto / outros.length);
        // time grande: não dá 1 DC para cada um, então sorteia quem leva 1 DC
        if (porMembro < 1) {
            beneficiados = embaralhar(outros).slice(0, resto);
            porMembro = 1;
            sorteio = true;
        }
    }

    const totalTime = porMembro * beneficiados.length;
    const total = parteAcertador + totalTime; // o que sobrar fica no pote

    const baixa = await pool.query(
        `UPDATE damas_dm_pote SET saldo = saldo - $1, atualizado_em = NOW()
         WHERE id = 1 AND saldo >= $1 RETURNING saldo`,
        [total]
    );
    if (baixa.rowCount === 0) return { ok: false, motivo: 'pote-vazio' };

    const ids = [userIdVencedor, ...beneficiados.map(m => m.user_id)];
    const valores = [parteAcertador, ...beneficiados.map(() => porMembro)];

    try {
        await pool.query(
            `INSERT INTO damas_dc_wallets (user_id, saldo)
             SELECT t.u, t.a FROM unnest($1::text[], $2::bigint[]) AS t(u, a)
             ON CONFLICT (user_id)
             DO UPDATE SET saldo = damas_dc_wallets.saldo + EXCLUDED.saldo, atualizado_em = NOW()`,
            [ids, valores]
        );
    } catch (e) {
        console.error('[desafioMusical] erro ao creditar carteiras:', e.message);
        await pool.query(`UPDATE damas_dm_pote SET saldo = saldo + $1 WHERE id = 1`, [total]).catch(() => {});
        return { ok: false, motivo: 'erro' };
    }

    return {
        ok: true,
        premio,
        parteAcertador,
        beneficiados,
        porMembro,
        sorteio,
        totalOutros: outros.length,
        resto,
        sobra: premio - total,
        poteRestante: Number(baixa.rows[0].saldo),
    };
}