// db.js
import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;

if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL não definida no .env');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 20000,
  keepAlive: true,
});

// ✅ Evita derrubar o bot quando o Neon fecha uma conexão ociosa
pool.on('error', (err) => {
  console.error('⚠️ Conexão ociosa com o banco caiu (o pool reconecta sozinho):', err.message);
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ✅ Só considera erro de CONEXÃO (não erro de SQL nem statement timeout)
function isConnectionError(err) {
  const msg = (err?.message || '').toLowerCase();
  const code = (err?.code || '').toUpperCase();

  const codes = ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE', '57P01', '57P03'];
  if (codes.includes(code)) return true;

  return (
    msg.includes('connection terminated') ||
    msg.includes('connection timeout') ||
    msg.includes('timeout exceeded when trying to connect') ||
    msg.includes('connection refused') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('terminating connection') ||
    msg.includes('server closed the connection') ||
    msg.includes('the database system is starting up')
  );
}

const originalQuery = pool.query.bind(pool);
const originalConnect = pool.connect.bind(pool);

// ✅ Acorda o Neon ANTES de o resto do bot usar o banco.
// Isso evita várias queries estourando timeout ao mesmo tempo no cold start.
async function warmup() {
  const MAX = 6;
  for (let i = 1; i <= MAX; i++) {
    try {
      await originalQuery('SELECT 1');
      console.log('💾 Conectado ao Neon DB!');
      return true;
    } catch (err) {
      if (i === MAX) {
        console.error(`❌ Não foi possível conectar ao Neon DB após ${MAX} tentativas:`, err.message);
        return false;
      }
      const delay = Math.min(i * 3000, 15000);
      console.warn(`⏳ Acordando o Neon DB (tentativa ${i}/${MAX}): ${err.message}. Nova tentativa em ${delay / 1000}s...`);
      await sleep(delay);
    }
  }
  return false;
}

// Top-level await: quem importa o db.js só segue depois do banco responder
await warmup();

// ✅ Wrapper genérico com retry
async function withRetry(fn, descricao, origem) {
  const MAX_RETRIES = 3;

  for (let i = 1; i <= MAX_RETRIES; i++) {
    try {
      return await fn();
    } catch (err) {
      if (isConnectionError(err) && i < MAX_RETRIES) {
        const delay = i * 3000;
        console.warn(`⚠️ Erro de conexão com DB (tentativa ${i}/${MAX_RETRIES}). Reconectando em ${delay / 1000}s...`);
        console.warn('   ↳ Erro:', err.message);
        if (descricao) console.warn('   ↳ Consulta:', descricao);
        if (origem) console.warn('   ↳ Origem:', origem);
        await sleep(delay);
        continue;
      }
      throw err;
    }
  }
}

function getOrigem() {
  return (new Error().stack || '').split('\n').slice(3, 6).map((s) => s.trim()).join(' | ');
}

// ✅ pool.query com retry (só no modo promise; modo callback passa direto)
pool.query = function (...args) {
  if (typeof args[args.length - 1] === 'function') return originalQuery(...args);

  const sql = typeof args[0] === 'string' ? args[0] : args[0]?.text;
  const descricao = (sql || '').replace(/\s+/g, ' ').slice(0, 120);
  const origem = getOrigem();

  return withRetry(() => originalQuery(...args), descricao, origem);
};

// ✅ pool.connect com retry (usado em transações: BEGIN/COMMIT)
pool.connect = function (...args) {
  if (typeof args[0] === 'function') return originalConnect(...args);
  const origem = getOrigem();
  return withRetry(() => originalConnect(...args), 'pool.connect()', origem);
};

// ✅ Keep-alive: impede o Neon de suspender por inatividade (suspende em ~5 min)
const KEEPALIVE_MS = 4 * 60 * 1000;
const keepAliveTimer = setInterval(async () => {
  try {
    await originalQuery('SELECT 1');
  } catch (err) {
    console.warn('⚠️ Ping de keep-alive falhou:', err.message);
  }
}, KEEPALIVE_MS);
keepAliveTimer.unref?.();

// ✅ Encerramento limpo
async function shutdown() {
  clearInterval(keepAliveTimer);
  try {
    await pool.end();
  } catch {
    /* ignora */
  }
  process.exit(0);
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

export default pool;