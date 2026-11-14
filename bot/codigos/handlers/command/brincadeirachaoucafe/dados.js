// Acesso ao banco da brincadeira Chá ou Café (Postgres/Neon).
// Convites e perguntas ficam salvos e sobrevivem a reinício do bot.
// As tabelas são criadas automaticamente na primeira chamada.

// ⚠️ Ajuste o caminho se o seu db.js estiver em outro lugar.
// De command/brincadeirachaoucafe/ até a raiz do projeto são 5 níveis.
import pool from '../../../../../db.js';

function numero(jid) {
  return String(jid || '').split('@')[0].split(':')[0];
}

// ---------- Criação das tabelas (roda uma vez) ----------
let pronto = null;

function garantirTabelas() {
  if (!pronto) {
    pronto = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS cc_estado (
          grupo_id   TEXT PRIMARY KEY,
          encerrada  BOOLEAN NOT NULL DEFAULT FALSE
        )
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS cc_convites (
          id        SERIAL PRIMARY KEY,
          grupo_id  TEXT NOT NULL,
          autor_jid TEXT NOT NULL,
          alvo_jid  TEXT NOT NULL,
          alvo_num  TEXT NOT NULL,
          msg_id    TEXT,
          criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await pool.query(
        `CREATE INDEX IF NOT EXISTS cc_convites_idx ON cc_convites (grupo_id, alvo_num)`
      );
      await pool.query(`
        CREATE TABLE IF NOT EXISTS cc_perguntas (
          id        SERIAL PRIMARY KEY,
          grupo_id  TEXT NOT NULL,
          msg_id    TEXT,
          alvo_jid  TEXT NOT NULL,
          autor_jid TEXT NOT NULL,
          criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await pool.query(
        `CREATE INDEX IF NOT EXISTS cc_perguntas_idx ON cc_perguntas (grupo_id, msg_id)`
      );
      await pool.query(`
        CREATE TABLE IF NOT EXISTS cc_historico (
          id        SERIAL PRIMARY KEY,
          grupo_id  TEXT NOT NULL,
          tipo      TEXT NOT NULL,
          texto     TEXT NOT NULL,
          criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await pool.query(
        `CREATE INDEX IF NOT EXISTS cc_historico_idx ON cc_historico (grupo_id, tipo)`
      );
    })().catch((err) => {
      pronto = null; // tenta de novo na próxima chamada
      throw err;
    });
  }
  return pronto;
}

// ---------- Estado da brincadeira (aberta / encerrada) ----------

export async function brincadeiraEncerrada(grupoId) {
  try {
    await garantirTabelas();
    const r = await pool.query(
      `SELECT encerrada FROM cc_estado WHERE grupo_id = $1`,
      [grupoId]
    );
    return r.rows[0]?.encerrada === true;
  } catch (err) {
    console.error('⚠️ [chaoucafe/dados] brincadeiraEncerrada:', err.message);
    return false; // em caso de erro, deixa a brincadeira funcionar
  }
}

// Marca como encerrada e limpa convites, perguntas e histórico.
// Devolve true se limpou tudo, false se houve erro na limpeza.
export async function encerrarBrincadeira(grupoId) {
  try {
    await garantirTabelas();
    await pool.query(
      `INSERT INTO cc_estado (grupo_id, encerrada) VALUES ($1, TRUE)
       ON CONFLICT (grupo_id) DO UPDATE SET encerrada = TRUE`,
      [grupoId]
    );
  } catch (err) {
    console.error('❌ [chaoucafe/dados] encerrarBrincadeira (estado):', err.message);
    return false;
  }

  try {
    await limpar(grupoId);
    return true;
  } catch (err) {
    console.error('❌ [chaoucafe/dados] encerrarBrincadeira (limpeza):', err.message);
    return false;
  }
}

export async function reabrirBrincadeira(grupoId) {
  await garantirTabelas();
  await pool.query(
    `INSERT INTO cc_estado (grupo_id, encerrada) VALUES ($1, FALSE)
     ON CONFLICT (grupo_id) DO UPDATE SET encerrada = FALSE`,
    [grupoId]
  );
}

async function limpar(grupoId) {
  await pool.query(`DELETE FROM cc_convites  WHERE grupo_id = $1`, [grupoId]);
  await pool.query(`DELETE FROM cc_perguntas WHERE grupo_id = $1`, [grupoId]);
  await pool.query(`DELETE FROM cc_historico WHERE grupo_id = $1`, [grupoId]);
}

// Zera convites/perguntas/histórico anteriores (usado pelo #icc)
export async function novaBrincadeira(grupoId) {
  await garantirTabelas();
  await limpar(grupoId);
}

// ---------- Convites ----------

export async function criarConvite(grupoId, autorJid, alvoJid, msgId) {
  await garantirTabelas();
  await pool.query(
    `INSERT INTO cc_convites (grupo_id, autor_jid, alvo_jid, alvo_num, msg_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [grupoId, autorJid, alvoJid, numero(alvoJid), msgId || null]
  );
}

function mapearConvite(row) {
  if (!row) return null;
  return {
    id: row.id,
    msgId: row.msg_id,
    autorJid: row.autor_jid,
    alvoJid: row.alvo_jid,
  };
}

// Convite pendente cujo alvo é um dos números do remetente.
// Se citadoId for informado, prefere o convite cuja mensagem foi respondida.
export async function buscarConvite(grupoId, numeros = [], citadoId = null) {
  await garantirTabelas();
  const lista = (numeros || []).map(numero).filter(Boolean);
  if (lista.length === 0) return null;

  const r = await pool.query(
    `SELECT * FROM cc_convites
      WHERE grupo_id = $1 AND alvo_num = ANY($2::text[])
      ORDER BY (msg_id IS NOT DISTINCT FROM $3::text) DESC, id DESC
      LIMIT 1`,
    [grupoId, lista, citadoId || null]
  );
  return mapearConvite(r.rows[0]);
}

export async function buscarConvitePorMsgId(grupoId, msgId) {
  if (!msgId) return null;
  await garantirTabelas();
  const r = await pool.query(
    `SELECT * FROM cc_convites WHERE grupo_id = $1 AND msg_id = $2 LIMIT 1`,
    [grupoId, msgId]
  );
  return mapearConvite(r.rows[0]);
}

export async function removerConvite(grupoId, convite) {
  await garantirTabelas();
  if (convite?.id) {
    await pool.query(`DELETE FROM cc_convites WHERE id = $1`, [convite.id]);
  } else if (convite?.msgId) {
    await pool.query(
      `DELETE FROM cc_convites WHERE grupo_id = $1 AND msg_id = $2`,
      [grupoId, convite.msgId]
    );
  }
}

// ---------- Perguntas ----------

// Sorteia uma pergunta que ainda não saiu neste grupo.
// Quando todas já saíram, reinicia o ciclo daquele tipo (cha/cafe).
export async function sortearPergunta(grupoId, tipo, lista = []) {
  const todas = [...new Set((lista || []).map((p) => String(p).trim()).filter(Boolean))];
  if (todas.length === 0) return 'Qual é a sua história mais engraçada?';

  const sorteio = (arr) => arr[Math.floor(Math.random() * arr.length)];

  try {
    await garantirTabelas();

    const r = await pool.query(
      `SELECT texto FROM cc_historico WHERE grupo_id = $1 AND tipo = $2`,
      [grupoId, tipo]
    );
    const usadas = new Set(r.rows.map((x) => x.texto));
    let disponiveis = todas.filter((p) => !usadas.has(p));

    if (disponiveis.length === 0) {
      await pool.query(
        `DELETE FROM cc_historico WHERE grupo_id = $1 AND tipo = $2`,
        [grupoId, tipo]
      );
      disponiveis = todas;
    }

    const escolhida = sorteio(disponiveis);
    await pool.query(
      `INSERT INTO cc_historico (grupo_id, tipo, texto) VALUES ($1, $2, $3)`,
      [grupoId, tipo, escolhida]
    );
    return escolhida;
  } catch (err) {
    console.error('⚠️ [chaoucafe/dados] sortearPergunta, sorteando sem histórico:', err.message);
    return sorteio(todas);
  }
}

export async function registrarPergunta(grupoId, msgId, alvoJid, autorJid) {
  if (!msgId) return;
  await garantirTabelas();
  await pool.query(
    `INSERT INTO cc_perguntas (grupo_id, msg_id, alvo_jid, autor_jid)
     VALUES ($1, $2, $3, $4)`,
    [grupoId, msgId, alvoJid, autorJid]
  );
}

export async function buscarPergunta(grupoId, msgId) {
  if (!msgId) return null;
  await garantirTabelas();
  const r = await pool.query(
    `SELECT alvo_jid, autor_jid FROM cc_perguntas
      WHERE grupo_id = $1 AND msg_id = $2 LIMIT 1`,
    [grupoId, msgId]
  );
  const row = r.rows[0];
  if (!row) return null;
  return { alvoJid: row.alvo_jid, autorJid: row.autor_jid };
}