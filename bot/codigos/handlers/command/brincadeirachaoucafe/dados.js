// Estado da brincadeira:
// - convites pendentes: em memória (expiram em poucos minutos)
// - perguntas enviadas pelo bot: em memória (para marcar a resposta com ✅)
// - perguntas já usadas: no Neon (não repete no mesmo grupo, mesmo após reiniciar o bot)
// - brincadeira encerrada por grupo: no Neon (continua encerrada após reiniciar o bot)
import pool from '../../../../../db.js'; // ⚠️ ajuste se o caminho do seu db.js for outro
import { expiracaoMs } from './config.js';
import { jidParaNumero } from './utils.js';

// ---------- Convites (memória) ----------
// grupoId -> Map(numeroDoAlvo -> { autorJid, alvoJid, msgId, criadoEm })
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
function criarConvite(grupoId, autorJid, alvoJid, msgId = null) {
  limparExpirados(grupoId);
  if (!convites.has(grupoId)) convites.set(grupoId, new Map());
  convites.get(grupoId).set(jidParaNumero(alvoJid), {
    autorJid,
    alvoJid,
    msgId,
    criadoEm: Date.now(),
  });
}

// "numeros" = todos os números possíveis de quem respondeu (@lid e telefone)
function buscarConvite(grupoId, numeros) {
  limparExpirados(grupoId);
  const grupo = convites.get(grupoId);
  if (!grupo) return null;
  for (const n of numeros) {
    const c = grupo.get(n);
    if (c) return c;
  }
  return null;
}

function removerConvite(grupoId, convite) {
  convites.get(grupoId)?.delete(jidParaNumero(convite.alvoJid));
}

// ---------- Perguntas enviadas pelo bot (memória) ----------
// Guarda o ID da mensagem da pergunta para marcar com ✅ a resposta da pessoa convidada.
// grupoId -> Map(msgId -> { alvoJid, autorJid, criadoEm })
const perguntasPendentes = new Map();
const validadePerguntaMs = 60 * 60 * 1000; // 1 hora

function limparPerguntasExpiradas(grupoId) {
  const grupo = perguntasPendentes.get(grupoId);
  if (!grupo) return;
  const agora = Date.now();
  for (const [id, p] of grupo) {
    if (agora - p.criadoEm > validadePerguntaMs) grupo.delete(id);
  }
  if (grupo.size === 0) perguntasPendentes.delete(grupoId);
}

function registrarPergunta(grupoId, msgId, alvoJid, autorJid) {
  if (!msgId) return;
  limparPerguntasExpiradas(grupoId);
  if (!perguntasPendentes.has(grupoId)) perguntasPendentes.set(grupoId, new Map());
  perguntasPendentes.get(grupoId).set(msgId, { alvoJid, autorJid, criadoEm: Date.now() });
}

// Devolve a pergunta se msgId for uma pergunta do bot E quem respondeu for a pessoa convidada
function buscarPergunta(grupoId, msgId, numeros) {
  limparPerguntasExpiradas(grupoId);
  const p = perguntasPendentes.get(grupoId)?.get(msgId);
  if (!p) return null;
  return numeros.includes(jidParaNumero(p.alvoJid)) ? p : null;
}

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
    })().catch((err) => {
      tabelaPronta = null; // tenta de novo na próxima vez
      throw err;
    });
  }
  return tabelaPronta;
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

// Encerra a brincadeira no grupo: bloqueia os comandos, apaga convites e limpa o banco.
// Retorna true se o banco foi limpo com sucesso (a brincadeira é encerrada de qualquer jeito).
async function encerrarBrincadeira(grupoId) {
  // 1) Bloqueia na hora (memória)
  encerradas.set(grupoId, true);
  convites.delete(grupoId);
  perguntasPendentes.delete(grupoId);
  for (const chave of usadasMemoria.keys()) {
    if (chave.startsWith(`${grupoId}:`)) usadasMemoria.delete(chave);
  }

  // 2) Persiste no banco e limpa as perguntas usadas
  try {
    await gravarEstado(grupoId, true);
    await pool.query('DELETE FROM chaoucafe_usadas WHERE grupo_id = $1', [grupoId]);
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

// ---------- Perguntas usadas ----------
function sortearNaMemoria(grupoId, tipo, lista) {
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
  try {
    await garantirTabela();

    const { rows } = await pool.query(
      'SELECT pergunta FROM chaoucafe_usadas WHERE grupo_id = $1 AND tipo = $2',
      [grupoId, tipo]
    );
    const usadas = new Set(rows.map((r) => r.pergunta));
    let livres = lista.filter((p) => !usadas.has(p));

    if (livres.length === 0) {
      await pool.query(
        'DELETE FROM chaoucafe_usadas WHERE grupo_id = $1 AND tipo = $2',
        [grupoId, tipo]
      );
      livres = [...lista];
    }

    const escolhida = livres[Math.floor(Math.random() * livres.length)];
    await pool.query(
      `INSERT INTO chaoucafe_usadas (grupo_id, tipo, pergunta)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [grupoId, tipo, escolhida]
    );
    return escolhida;
  } catch (err) {
    console.error('⚠️ [chaoucafe] Erro no banco, usando sorteio em memória:', err.message);
    return sortearNaMemoria(grupoId, tipo, lista);
  }
}

export {
  criarConvite,
  buscarConvite,
  removerConvite,
  registrarPergunta,
  buscarPergunta,
  sortearPergunta,
  brincadeiraEncerrada,
  encerrarBrincadeira,
  reabrirBrincadeira,
};