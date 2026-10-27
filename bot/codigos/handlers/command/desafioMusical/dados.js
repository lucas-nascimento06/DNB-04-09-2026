// bot/codigos/handlers/command/desafioMusical/dados.js


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

    // repõe o pote: se já existia com saldo menor que o poteInicial, sobe para o valor do config
    await pool.query(
        `UPDATE damas_dm_pote SET saldo = $1, atualizado_em = NOW() WHERE id = 1 AND saldo < $1`,
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

// Prêmio da rodada: SÓ quem cantou melhor leva premioCantorDC.
// Tira do pote e credita na carteira (damas_dc_wallets).
export async function pagarPremio(userId) {
    const premio = CONFIG.premioCantorDC;

    const baixa = await pool.query(
        `UPDATE damas_dm_pote SET saldo = saldo - $1, atualizado_em = NOW()
         WHERE id = 1 AND saldo >= $1 RETURNING saldo`,
        [premio]
    );
    if (baixa.rowCount === 0) return { ok: false, motivo: 'pote-vazio' };

    try {
        await pool.query(
            `INSERT INTO damas_dc_wallets (user_id, saldo) VALUES ($1, $2)
             ON CONFLICT (user_id)
             DO UPDATE SET saldo = damas_dc_wallets.saldo + EXCLUDED.saldo, atualizado_em = NOW()`,
            [userId, premio]
        );
    } catch (e) {
        console.error('[desafioMusical] erro ao creditar carteira:', e.message);
        await pool.query(`UPDATE damas_dm_pote SET saldo = saldo + $1 WHERE id = 1`, [premio]).catch(() => {});
        return { ok: false, motivo: 'erro' };
    }

    return { ok: true, premio, poteRestante: Number(baixa.rows[0].saldo) };
}