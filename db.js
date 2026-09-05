// db.js
import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// ✅ Definir search_path automaticamente em cada nova conexão
pool.on('connect', (client) => {
  client.query('SET search_path TO public').catch(err => {
    console.error('⚠️ Erro ao definir search_path:', err.message);
  });
});

// ✅ Reconexão automática ao detectar erro de conexão perdida
pool.on('error', (err) => {
  console.error('⚠️ Conexão com o banco caiu, reconectando automaticamente...', err.message);
});

// ✅ Wrapper com retry automático (até 3 tentativas)
const originalQuery = pool.query.bind(pool);
pool.query = async function (...args) {
  const MAX_RETRIES = 3;
  for (let i = 1; i <= MAX_RETRIES; i++) {
    try {
      return await originalQuery(...args);
    } catch (err) {
      const isConnectionError =
        err.message.includes('Connection terminated') ||
        err.message.includes('connection refused') ||
        err.message.includes('ECONNRESET') ||
        err.message.includes('ETIMEDOUT') ||
        err.message.includes('terminating connection');

      if (isConnectionError && i < MAX_RETRIES) {
        const delay = i * 2000;
        console.warn(`⚠️ Erro de conexão com DB (tentativa ${i}/${MAX_RETRIES}). Reconectando em ${delay / 1000}s...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
};

// ✅ Teste de conexão ao iniciar
pool.connect()
  .then(async client => {
    await client.query('SET search_path TO public');
    console.log('💾 Conectado ao Neon DB!');
    client.release();
  })
  .catch(err => console.error('❌ Erro ao conectar ao Neon DB:', err.message));

export default pool;