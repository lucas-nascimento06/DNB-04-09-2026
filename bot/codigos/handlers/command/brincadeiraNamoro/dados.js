// bot/codigos/handlers/command/brincadeiraNamoro/dados.js
// Banco de dados (PostgreSQL / Neon) da Brincadeira do Namoro:
// participantes, pedidos, casais e lista fixada.

import pool from '../../../../../db.js';
import { flushDC } from '../../../features/dcTracker.js';
import { CONFIG } from './config.js';

// ===================== TABELAS =====================
// Usa uma Promise compartilhada: se várias mensagens chegarem juntas na primeira vez,
// todas esperam a MESMA criação das tabelas (antes cada uma rodava os CREATE ao mesmo tempo).
let promessaTabelas = null;

export function garantirTabelas() {
    if (!promessaTabelas) {
        promessaTabelas = criarTabelas().catch((e) => {
            promessaTabelas = null; // se falhar, permite tentar de novo na próxima mensagem
            throw e;
        });
    }
    return promessaTabelas;
}

async function criarTabelas() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS damas_namoro_participantes (
            grupo         TEXT        NOT NULL,
            user_id       TEXT        NOT NULL,
            jid           TEXT,
            nome          TEXT        NOT NULL,
            sexo          TEXT        NOT NULL,
            signo         TEXT        NOT NULL,
            foto_base64   TEXT,
            inscrito_em   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (grupo, user_id)
        )
    `);
    // colunas novas da ficha (criadas sozinhas, sem apagar nada)
    await pool.query(`ALTER TABLE damas_namoro_participantes ADD COLUMN IF NOT EXISTS idade  INTEGER`);
    await pool.query(`ALTER TABLE damas_namoro_participantes ADD COLUMN IF NOT EXISTS cidade TEXT`);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS damas_namoro_pedidos (
            id        BIGSERIAL   PRIMARY KEY,
            grupo     TEXT        NOT NULL,
            user_de   TEXT        NOT NULL,
            user_para TEXT        NOT NULL,
            texto     TEXT,
            criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_damas_namoro_pedidos_para
        ON damas_namoro_pedidos (grupo, user_para)
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS damas_namoro_casais (
            id       BIGSERIAL   PRIMARY KEY,
            grupo    TEXT        NOT NULL,
            user_a   TEXT        NOT NULL,
            user_b   TEXT        NOT NULL,
            desde    TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_damas_namoro_casais_grupo
        ON damas_namoro_casais (grupo)
    `);

    // guarda o ID da mensagem da lista fixada (1 por grupo)
    await pool.query(`
        CREATE TABLE IF NOT EXISTS damas_namoro_lista_fixada (
            grupo         TEXT        PRIMARY KEY,
            msg_id        TEXT        NOT NULL,
            atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
}

// ===================== TIMEOUT =====================
// Se algo travar (flush, banco, download), a operação falha depois de "ms" em vez de
// ficar pendurada para sempre e deixar o bot mudo.
const comTimeout = (p, ms, nome) =>
    Promise.race([
        p,
        new Promise((_, rej) => setTimeout(() => rej(new Error(`${nome} demorou mais de ${ms}ms`)), ms)),
    ]);

// ===================== DCs =====================
// Várias inscrições ao mesmo tempo compartilham UM único flush (em vez de um por pessoa).
// O flush tem limite de 5s: se travar, a trava é liberada e o bot segue em frente.
let flushEmAndamento = null;
function flushUnico() {
    if (!flushEmAndamento) {
        flushEmAndamento = comTimeout(Promise.resolve(flushDC()), 5000, 'flushDC')
            .finally(() => { flushEmAndamento = null; });
    }
    return flushEmAndamento;
}

// Lê o saldo da tabela damas_dc_wallets (a mesma usada pelo #dc).
// Retorna o saldo (número) ou null se não conseguir ler.
export async function obterDCs(userId) {
    try {
        // grava no banco os DCs que ainda estão no buffer (flush de 30s), igual ao #dc
        // se o flush falhar ou demorar, segue em frente e lê o que já está no banco
        await flushUnico().catch((e) =>
            console.error('[brincadeiraNamoro] flush falhou, seguindo:', e.message)
        );

        const result = await comTimeout(
            pool.query(`SELECT saldo FROM damas_dc_wallets WHERE user_id = $1`, [userId]),
            8000,
            'consulta de saldo'
        );
        return Number(result.rows[0]?.saldo || 0);
    } catch (e) {
        console.error('[brincadeiraNamoro] erro ao ler saldo de DC:', e.message);
        return null;
    }
}

// ===================== FOTO =====================
// Baixa a foto da inscrição e devolve em base64 (ou null se falhar ou demorar mais de 15s).
export async function baixarFotoBase64(message) {
    try {
        let baileys;
        try { baileys = await import('@whiskeysockets/baileys'); }
        catch { baileys = await import('baileys'); }
        const buffer = await comTimeout(
            baileys.downloadMediaMessage(message, 'buffer', {}),
            15000,
            'download da foto'
        );
        return Buffer.from(buffer).toString('base64');
    } catch (e) {
        console.error('[brincadeiraNamoro] erro ao baixar foto:', e.message);
        return null;
    }
}

// ===================== PARTICIPANTES =====================
const COLUNAS = `user_id, jid, nome, sexo, signo, idade, cidade, inscrito_em, atualizado_em`;

const mapParticipante = (r) => r && ({
    userId: r.user_id,
    jid: r.jid,
    nome: r.nome,
    sexo: r.sexo,
    signo: r.signo,
    idade: r.idade,
    cidade: r.cidade,
    emCasal: r.em_casal,
});

// Insere ou atualiza. Retorna { novo: true/false }
export async function salvarParticipante(grupo, { userId, jid, nome, sexo, signo, idade, cidade, fotoBase64 }) {
    const r = await pool.query(
        `INSERT INTO damas_namoro_participantes
            (grupo, user_id, jid, nome, sexo, signo, idade, cidade, foto_base64)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (grupo, user_id) DO UPDATE SET
            jid           = EXCLUDED.jid,
            nome          = EXCLUDED.nome,
            sexo          = EXCLUDED.sexo,
            signo         = EXCLUDED.signo,
            idade         = EXCLUDED.idade,
            cidade        = EXCLUDED.cidade,
            foto_base64   = COALESCE(EXCLUDED.foto_base64, damas_namoro_participantes.foto_base64),
            atualizado_em = NOW()
         RETURNING (xmax = 0) AS novo`,
        [grupo, userId, jid, nome, sexo, signo, idade ?? null, cidade || null, fotoBase64 || null]
    );
    return { novo: r.rows[0].novo };
}

export async function buscarParticipante(grupo, userId) {
    const r = await pool.query(
        `SELECT ${COLUNAS} FROM damas_namoro_participantes WHERE grupo = $1 AND user_id = $2`,
        [grupo, userId]
    );
    return mapParticipante(r.rows[0]) || null;
}

// procura por jid completo OU pelos dígitos do número
export async function buscarParticipantePorJidOuId(grupo, jidOuId, digitos) {
    const r = await pool.query(
        `SELECT ${COLUNAS} FROM damas_namoro_participantes
         WHERE grupo = $1 AND (jid = $2 OR user_id = $3)
         LIMIT 1`,
        [grupo, jidOuId, digitos]
    );
    return mapParticipante(r.rows[0]) || null;
}

export async function listarParticipantes(grupo, sexo) {
    const r = await pool.query(
        `SELECT p.user_id, p.jid, p.nome, p.sexo, p.signo, p.idade, p.cidade,
                EXISTS (
                    SELECT 1 FROM damas_namoro_casais c
                    WHERE c.grupo = p.grupo AND (c.user_a = p.user_id OR c.user_b = p.user_id)
                ) AS em_casal
         FROM damas_namoro_participantes p
         WHERE p.grupo = $1 AND p.sexo = $2
         ORDER BY p.inscrito_em`,
        [grupo, sexo]
    );
    return r.rows.map(mapParticipante);
}

// ===================== PEDIDOS =====================
export async function limparPedidosExpirados(grupo) {
    await pool.query(
        `DELETE FROM damas_namoro_pedidos
         WHERE grupo = $1 AND criado_em < NOW() - ($2::bigint * INTERVAL '1 millisecond')`,
        [grupo, CONFIG.PEDIDO_VALIDADE_MS]
    );
}

export async function criarPedido(grupo, de, para, texto) {
    // um pedido por par (de -> para): o novo substitui o antigo
    await pool.query(
        `DELETE FROM damas_namoro_pedidos WHERE grupo = $1 AND user_de = $2 AND user_para = $3`,
        [grupo, de, para]
    );
    await pool.query(
        `INSERT INTO damas_namoro_pedidos (grupo, user_de, user_para, texto) VALUES ($1, $2, $3, $4)`,
        [grupo, de, para, texto]
    );
}

// pedidos recebidos por userId, do mais recente para o mais antigo
export async function pedidosRecebidos(grupo, userId) {
    const r = await pool.query(
        `SELECT id, user_de AS de, user_para AS para, criado_em
         FROM damas_namoro_pedidos
         WHERE grupo = $1 AND user_para = $2
         ORDER BY criado_em DESC`,
        [grupo, userId]
    );
    return r.rows;
}

export async function removerPedido(id) {
    await pool.query(`DELETE FROM damas_namoro_pedidos WHERE id = $1`, [id]);
}

// ===================== CASAIS =====================
export async function emCasal(grupo, userId) {
    const r = await pool.query(
        `SELECT user_a, user_b FROM damas_namoro_casais
         WHERE grupo = $1 AND (user_a = $2 OR user_b = $2) LIMIT 1`,
        [grupo, userId]
    );
    return r.rows[0] || null;
}

// Forma o casal numa transação (com trava por grupo, para evitar corrida).
// Retorna { ok: true } ou { ok: false } se alguém já tiver casal.
export async function formarCasal(grupo, a, b) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [grupo]);

        const ja = await client.query(
            `SELECT 1 FROM damas_namoro_casais
             WHERE grupo = $1 AND (user_a = ANY($2::text[]) OR user_b = ANY($2::text[])) LIMIT 1`,
            [grupo, [a, b]]
        );
        if (ja.rowCount > 0) {
            await client.query('ROLLBACK');
            return { ok: false };
        }

        await client.query(
            `INSERT INTO damas_namoro_casais (grupo, user_a, user_b) VALUES ($1, $2, $3)`,
            [grupo, a, b]
        );
        // remove todos os pedidos que envolvem os dois
        await client.query(
            `DELETE FROM damas_namoro_pedidos
             WHERE grupo = $1 AND (user_de = ANY($2::text[]) OR user_para = ANY($2::text[]))`,
            [grupo, [a, b]]
        );

        await client.query('COMMIT');
        return { ok: true };
    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
    } finally {
        client.release();
    }
}

export async function listarCasais(grupo) {
    const r = await pool.query(
        `SELECT c.user_a, c.user_b,
                pa.nome AS nome_a, pa.jid AS jid_a,
                pb.nome AS nome_b, pb.jid AS jid_b
         FROM damas_namoro_casais c
         LEFT JOIN damas_namoro_participantes pa ON pa.grupo = c.grupo AND pa.user_id = c.user_a
         LEFT JOIN damas_namoro_participantes pb ON pb.grupo = c.grupo AND pb.user_id = c.user_b
         WHERE c.grupo = $1
         ORDER BY c.desde`,
        [grupo]
    );
    return r.rows;
}

// ===================== LISTA FIXADA =====================
export async function obterListaFixada(grupo) {
    const r = await pool.query(
        `SELECT msg_id FROM damas_namoro_lista_fixada WHERE grupo = $1`,
        [grupo]
    );
    return r.rows[0]?.msg_id || null;
}

export async function salvarListaFixada(grupo, msgId) {
    await pool.query(
        `INSERT INTO damas_namoro_lista_fixada (grupo, msg_id)
         VALUES ($1, $2)
         ON CONFLICT (grupo) DO UPDATE SET msg_id = EXCLUDED.msg_id, atualizado_em = NOW()`,
        [grupo, msgId]
    );
}