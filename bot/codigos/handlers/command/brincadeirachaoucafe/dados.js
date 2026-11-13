// Estado da brincadeira (tudo salvo no Neon; a memória funciona como cache):
// - convites pendentes (expiram em poucos minutos)
// - perguntas enviadas pelo bot (para marcar a resposta com ✅ e controlar o prazo)
// - perguntas já usadas (não repete no mesmo grupo)
// - pessoas silenciadas (punição por não responder)
// - brincadeira encerrada por grupo
import pool from '../../../../../db.js'; // ⚠️ ajuste se o caminho do seu db.js for outro
import { expiracaoMs, prazoRespostaMs } from './config.js';
import { jidParaNumero } from './utils.js';

const validadePerguntaMs = 60 * 60 * 1000; // 1 hora (para reagir com ✅)

// ---------- Tabelas (Neon) ----------
let tabelaPronta = null;

function garantirTabela() {
  if (!tabelaPronta) {
    tabelaPronta = (async () => {
      await pool.query(
        `CREATE TABLE IF NOT EXISTS chaoucafe_usadas (
           grupo_id TEXT NOT NULL,
           tipo     TEXT NOT NULL,
           pergunta TEXT NOT NULL,
           usado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
           PRIMARY KEY (grupo_id, tipo, pergunta)
         )`
      );
      await pool.query(
        `CREATE TABLE IF NOT EXISTS chaoucafe_estado (
           grupo_id    TEXT PRIMARY KEY,
           encerrada   BOOLEAN NOT NULL DEFAULT FALSE,
           atualizado  TIMESTAMPTZ NOT NULL DEFAULT NOW()
         )`
      );
      await pool.query(
        `CREATE TABLE IF NOT EXISTS chaoucafe_convites (
           grupo_id  TEXT NOT NULL,
           alvo_num  TEXT NOT NULL,
           autor_jid TEXT NOT NULL,
           alvo_jid  TEXT NOT NULL,
           msg_id    TEXT,
           criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
           PRIMARY KEY (grupo_id, alvo_num)
         )`
      );
      await pool.query(
        `CREATE TABLE IF NOT EXISTS chaoucafe_perguntas (
           grupo_id  TEXT NOT NULL,
           msg_id    TEXT NOT NULL,
           alvo_jid  TEXT NOT NULL,
           autor_jid TEXT NOT NULL,
           criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
           PRIMARY KEY (grupo_id, msg_id)
         )`
      );
      // Colunas novas (para quem já tinha a tabela criada antes)
      await pool.query(
        `ALTER TABLE chaoucafe_perguntas ADD COLUMN IF NOT EXISTS respondida BOOLEAN NOT NULL DEFAULT FALSE`
      );
      await pool.query(
        `ALTER TABLE chaoucafe_perguntas ADD COLUMN IF NOT EXISTS punida BOOLEAN NOT NULL DEFAULT FALSE`
      );
      await pool.query(
        `CREATE TABLE IF NOT EXISTS chaoucafe_silenciados (
           grupo_id TEXT NOT NULL,
           alvo_num TEXT NOT NULL,
           alvo_jid TEXT NOT NULL,
           ate      TIMESTAMPTZ NOT NULL,
           PRIMARY KEY (grupo_id, alvo_num)
         )`
      );
    })().catch((err) => {
      tabelaPronta = null; // tenta de novo na próxima vez
      throw err;
    });
  }
  return tabelaPronta;
}

// ---------- Convites ----------
// Cache em memória: grupoId -> Map(numeroDoAlvo -> { autorJid, alvoJid, msgId, criadoEm })
const convites = new Map();

function limparExpirados(grupoId) {
  const grupo = convites.get(grupoId);
  if (!grupo) return;
  const agora = Date.now();
  for (const [alvo, c] of grupo) {
    if (agora - c.criadoEm > expiracaoMs) grupo.delete(alvo);
  }
  if (grupo.size === 0) convites.delete(grupoId);
}

// msgId = ID da mensagem de convite enviada pelo bot (a resposta precisa citar essa mensagem)
async function criarConvite(grupoId, autorJid, alvoJid, msgId = null) {
  limparExpirados(grupoId);
  const alvoNum = jidParaNumero(alvoJid);

  // memória (na hora)
  if (!convites.has(grupoId)) convites.set(grupoId, new Map());
  convites.get(grupoId).set(alvoNum, { autorJid, alvoJid, msgId, criadoEm: Date.now() });

  // banco
  try {
    await garantirTabela();
    await pool.query(
      `DELETE FROM chaoucafe_convites
       WHERE criado_em < NOW() - ($1 * INTERVAL '1 millisecond')`,
      [expiracaoMs]
    );
    await pool.query(
      `INSERT INTO chaoucafe_convites (grupo_id, alvo_num, autor_jid, alvo_jid, msg_id, criado_em)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (grupo_id, alvo_num)
       DO UPDATE SET autor_jid = EXCLUDED.autor_jid,
                     alvo_jid  = EXCLUDED.alvo_jid,
                     msg_id    = EXCLUDED.msg_id,
                     criado_em = NOW()`,
      [grupoId, alvoNum, autorJid, alvoJid, msgId]
    );
  } catch (err) {
    console.error('⚠️ [chaoucafe] erro ao salvar convite no banco (segue só na memória):', err.message);
  }
}

// "numeros" = todos os números possíveis de quem respondeu (@lid e telefone)
async function buscarConvite(grupoId, numeros) {
  // 1) memória
  limparExpirados(grupoId);
  const grupo = convites.get(grupoId);
  if (grupo) {
    for (const n of numeros) {
      const c = grupo.get(n);
      if (c) return c;
    }
  }

  // 2) banco (caso o bot tenha reiniciado)
  if (!numeros.length) return null;
  try {
    await garantirTabela();
    const { rows } = await pool.query(
      `SELECT alvo_num, autor_jid, alvo_jid, msg_id,
              (EXTRACT(EPOCH FROM criado_em) * 1000)::bigint AS criado_ms
       FROM chaoucafe_convites
       WHERE grupo_id = $1
         AND alvo_num = ANY($2)
         AND criado_em > NOW() - ($3 * INTERVAL '1 millisecond')
       LIMIT 1`,
      [grupoId, numeros, expiracaoMs]
    );
    if (!rows[0]) return null;

    const r = rows[0];
    const convite = {
      autorJid: r.autor_jid,
      alvoJid: r.alvo_jid,
      msgId: r.msg_id,
      criadoEm: Number(r.criado_ms),
    };
    // devolve para o cache
    if (!convites.has(grupoId)) convites.set(grupoId, new Map());
    convites.get(grupoId).set(r.alvo_num, convite);
    return convite;
  } catch (err) {
    console.error('⚠️ [chaoucafe] erro ao buscar convite no banco:', err.message);
    return null;
  }
}

// Procura um convite pendente pelo ID da mensagem do bot (para avisar intrusos)
async function buscarConvitePorMsgId(grupoId, msgId) {
  if (!msgId) return null;

  limparExpirados(grupoId);
  const grupo = convites.get(grupoId);
  if (grupo) {
    for (const c of grupo.values()) {
      if (c.msgId === msgId) return c;
    }
  }

  try {
    await garantirTabela();
    const { rows } = await pool.query(
      `SELECT autor_jid, alvo_jid, msg_id,
              (EXTRACT(EPOCH FROM criado_em) * 1000)::bigint AS criado_ms
       FROM chaoucafe_convites
       WHERE grupo_id = $1
         AND msg_id = $2
         AND criado_em > NOW() - ($3 * INTERVAL '1 millisecond')
       LIMIT 1`,
      [grupoId, msgId, expiracaoMs]
    );
    if (!rows[0]) return null;
    return {
      autorJid: rows[0].autor_jid,
      alvoJid: rows[0].alvo_jid,
      msgId: rows[0].msg_id,
      criadoEm: Number(rows[0].criado_ms),
    };
  } catch (err) {
    console.error('⚠️ [chaoucafe] erro ao buscar convite por msgId:', err.message);
    return null;
  }
}

async function removerConvite(grupoId, convite) {
  const alvoNum = jidParaNumero(convite.alvoJid);
  convites.get(grupoId)?.delete(alvoNum);
  try {
    await garantirTabela();
    await pool.query(
      'DELETE FROM chaoucafe_convites WHERE grupo_id = $1 AND alvo_num = $2',
      [grupoId, alvoNum]
    );
  } catch (err) {
    console.error('⚠️ [chaoucafe] erro ao remover convite do banco:', err.message);
  }
}

// ---------- Perguntas enviadas pelo bot ----------
// Cache em memória: grupoId -> Map(msgId -> { alvoJid, autorJid, criadoEm })
const perguntasPendentes = new Map();

function limparPerguntasExpiradas(grupoId) {
  const grupo = perguntasPendentes.get(grupoId);
  if (!grupo) return;
  const agora = Date.now();
  for (const [id, p] of grupo) {
    if (agora - p.criadoEm > validadePerguntaMs) grupo.delete(id);
  }
  if (grupo.size === 0) perguntasPendentes.delete(grupoId);
}

async function registrarPergunta(grupoId, msgId, alvoJid, autorJid) {
  if (!msgId) return;
  limparPerguntasExpiradas(grupoId);

  // memória (na hora)
  if (!perguntasPendentes.has(grupoId)) perguntasPendentes.set(grupoId, new Map());
  perguntasPendentes.get(grupoId).set(msgId, { alvoJid, autorJid, criadoEm: Date.now() });

  // banco
  try {
    await garantirTabela();
    await pool.query(
      `DELETE FROM chaoucafe_perguntas
       WHERE criado_em < NOW() - ($1 * INTERVAL '1 millisecond')`,
      [validadePerguntaMs]
    );
    await pool.query(
      `INSERT INTO chaoucafe_perguntas (grupo_id, msg_id, alvo_jid, autor_jid, criado_em)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (grupo_id, msg_id) DO NOTHING`,
      [grupoId, msgId, alvoJid, autorJid]
    );
  } catch (err) {
    console.error('⚠️ [chaoucafe] erro ao salvar pergunta no banco (sem banco não há punição por prazo):', err.message);
  }
}

// Devolve { alvoJid, autorJid, criadoEm } se msgId for uma pergunta do bot (ainda válida), senão null.
// Quem chama decide se quem respondeu é a pessoa convidada.
async function buscarPergunta(grupoId, msgId) {
  if (!msgId) return null;

  // 1) memória
  limparPerguntasExpiradas(grupoId);
  let p = perguntasPendentes.get(grupoId)?.get(msgId) || null;

  // 2) banco (caso o bot tenha reiniciado)
  if (!p) {
    try {
      await garantirTabela();
      const { rows } = await pool.query(
        `SELECT alvo_jid, autor_jid,
                (EXTRACT(EPOCH FROM criado_em) * 1000)::bigint AS criado_ms
         FROM chaoucafe_perguntas
         WHERE grupo_id = $1
           AND msg_id = $2
           AND criado_em > NOW() - ($3 * INTERVAL '1 millisecond')`,
        [grupoId, msgId, validadePerguntaMs]
      );
      if (rows[0]) {
        p = {
          alvoJid: rows[0].alvo_jid,
          autorJid: rows[0].autor_jid,
          criadoEm: Number(rows[0].criado_ms),
        };
        if (!perguntasPendentes.has(grupoId)) perguntasPendentes.set(grupoId, new Map());
        perguntasPendentes.get(grupoId).set(msgId, p);
      }
    } catch (err) {
      console.error('⚠️ [chaoucafe] erro ao buscar pergunta no banco:', err.message);
    }
  }

  return p;
}

// A pessoa convidada respondeu a pergunta: cancela a punição
async function marcarRespondida(grupoId, msgId) {
  if (!msgId) return;
  try {
    await garantirTabela();
    await pool.query(
      'UPDATE chaoucafe_perguntas SET respondida = TRUE WHERE grupo_id = $1 AND msg_id = $2',
      [grupoId, msgId]
    );
  } catch (err) {
    console.error('⚠️ [chaoucafe] erro ao marcar pergunta como respondida:', err.message);
  }
}

// Pega (de forma atômica) as perguntas cujo prazo venceu sem resposta e marca como punidas.
// Cada pergunta só é devolvida uma vez.
async function punirVencidos() {
  try {
    await garantirTabela();
    const { rows } = await pool.query(
      `UPDATE chaoucafe_perguntas
       SET punida = TRUE
       WHERE respondida = FALSE
         AND punida = FALSE
         AND criado_em < NOW() - ($1 * INTERVAL '1 millisecond')
       RETURNING grupo_id, msg_id, alvo_jid, autor_jid`,
      [prazoRespostaMs]
    );
    return rows.map((r) => ({
      grupoId: r.grupo_id,
      msgId: r.msg_id,
      alvoJid: r.alvo_jid,
      autorJid: r.autor_jid,
    }));
  } catch (err) {
    console.error('⚠️ [chaoucafe] erro ao verificar prazos vencidos:', err.message);
    return [];
  }
}

// ---------- Silenciados (punição) ----------
// Cache em memória: grupoId -> Map(numero -> { alvoJid, ate })
const silenciados = new Map();
let silenciadosCarregados = false;

async function carregarSilenciados() {
  if (silenciadosCarregados) return;
  try {
    await garantirTabela();
    const { rows } = await pool.query(
      `SELECT grupo_id, alvo_num, alvo_jid,
              (EXTRACT(EPOCH FROM ate) * 1000)::bigint AS ate_ms
       FROM chaoucafe_silenciados
       WHERE ate > NOW()`
    );
    for (const r of rows) {
      if (!silenciados.has(r.grupo_id)) silenciados.set(r.grupo_id, new Map());
      silenciados.get(r.grupo_id).set(r.alvo_num, {
        alvoJid: r.alvo_jid,
        ate: Number(r.ate_ms),
      });
    }
    silenciadosCarregados = true;
  } catch (err) {
    console.error('⚠️ [chaoucafe] erro ao carregar silenciados (tenta de novo depois):', err.message);
  }
}

async function silenciar(grupoId, alvoJid, ms) {
  const alvoNum = jidParaNumero(alvoJid);
  const ate = Date.now() + ms;

  if (!silenciados.has(grupoId)) silenciados.set(grupoId, new Map());
  silenciados.get(grupoId).set(alvoNum, { alvoJid, ate });

  try {
    await garantirTabela();
    await pool.query(
      `INSERT INTO chaoucafe_silenciados (grupo_id, alvo_num, alvo_jid, ate)
       VALUES ($1, $2, $3, NOW() + ($4 * INTERVAL '1 millisecond'))
       ON CONFLICT (grupo_id, alvo_num)
       DO UPDATE SET alvo_jid = EXCLUDED.alvo_jid, ate = EXCLUDED.ate`,
      [grupoId, alvoNum, alvoJid, ms]
    );
  } catch (err) {
    console.error('⚠️ [chaoucafe] erro ao salvar silenciado no banco (segue só na memória):', err.message);
  }
}

// Devolve { alvoJid, ate, restanteMs } se algum dos números está silenciado agora; senão null
async function buscarSilenciado(grupoId, numeros) {
  await carregarSilenciados();

  const grupo = silenciados.get(grupoId);
  if (!grupo) return null;

  const agora = Date.now();
  for (const [num, s] of grupo) {
    if (s.ate <= agora) grupo.delete(num);
  }
  if (grupo.size === 0) {
    silenciados.delete(grupoId);
    return null;
  }

  for (const n of numeros) {
    const s = grupo.get(n);
    if (s) return { ...s, restanteMs: s.ate - agora };
  }
  return null;
}

// ---------- Brincadeira encerrada / aberta ----------
// Cache em memória para não consultar o banco a cada mensagem
const encerradas = new Map(); // grupoId -> boolean

async function brincadeiraEncerrada(grupoId) {
  if (encerradas.has(grupoId)) return encerradas.get(grupoId);
  try {
    await garantirTabela();
    const { rows } = await pool.query(
      'SELECT encerrada FROM chaoucafe_estado WHERE grupo_id = $1',
      [grupoId]
    );
    const valor = rows[0]?.encerrada === true;
    encerradas.set(grupoId, valor);
    return valor;
  } catch (err) {
    console.error('⚠️ [chaoucafe] erro ao ler estado da brincadeira:', err.message);
    return false; // não guarda no cache: tenta o banco de novo na próxima
  }
}

async function gravarEstado(grupoId, encerrada) {
  await garantirTabela();
  await pool.query(
    `INSERT INTO chaoucafe_estado (grupo_id, encerrada, atualizado)
     VALUES ($1, $2, NOW())
     ON CONFLICT (grupo_id)
     DO UPDATE SET encerrada = EXCLUDED.encerrada, atualizado = NOW()`,
    [grupoId, encerrada]
  );
}

// Plano B se o banco falhar (não persiste, mas o bot continua funcionando)
const usadasMemoria = new Map();

// Encerra a brincadeira no grupo: bloqueia os comandos, apaga convites/perguntas/silenciados e limpa o banco.
// Retorna true se o banco foi limpo com sucesso (a brincadeira é encerrada de qualquer jeito).
async function encerrarBrincadeira(grupoId) {
  // 1) Bloqueia na hora (memória)
  encerradas.set(grupoId, true);
  convites.delete(grupoId);
  perguntasPendentes.delete(grupoId);
  silenciados.delete(grupoId);
  for (const chave of usadasMemoria.keys()) {
    if (chave.startsWith(`${grupoId}:`)) usadasMemoria.delete(chave);
  }

  // 2) Persiste no banco e limpa tudo do grupo
  try {
    await gravarEstado(grupoId, true);
    await pool.query('DELETE FROM chaoucafe_usadas WHERE grupo_id = $1', [grupoId]);
    await pool.query('DELETE FROM chaoucafe_convites WHERE grupo_id = $1', [grupoId]);
    await pool.query('DELETE FROM chaoucafe_perguntas WHERE grupo_id = $1', [grupoId]);
    await pool.query('DELETE FROM chaoucafe_silenciados WHERE grupo_id = $1', [grupoId]);
    return true;
  } catch (err) {
    console.error('⚠️ [chaoucafe] erro ao limpar o banco ao encerrar:', err.message);
    return false;
  }
}

// Reabre a brincadeira no grupo (usado quando um ADM manda #bcc de novo)
async function reabrirBrincadeira(grupoId) {
  encerradas.set(grupoId, false);
  try {
    await gravarEstado(grupoId, false);
    return true;
  } catch (err) {
    console.error('⚠️ [chaoucafe] erro ao reabrir no banco:', err.message);
    return false;
  }
}

// ---------- Perguntas usadas (não repete) ----------
function sortearNaMemoria(grupoId, tipo, lista) {
  if (!lista || lista.length === 0) return '(sem perguntas cadastradas)';
  const chave = `${grupoId}:${tipo}`;
  let set = usadasMemoria.get(chave);
  if (!set || set.size >= lista.length) {
    set = new Set();
    usadasMemoria.set(chave, set);
  }
  const livres = lista.filter((p) => !set.has(p));
  const escolhida = livres[Math.floor(Math.random() * livres.length)];
  set.add(escolhida);
  return escolhida;
}

// Sorteia uma pergunta ainda não usada no grupo. Quando acaba a lista, recomeça.
async function sortearPergunta(grupoId, tipo, lista) {
  if (!lista || lista.length === 0)