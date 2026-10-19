import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';

dotenv.config();

if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL não definida no .env');
  process.exit(1);
}

// Mostra o host usado (sem expor a senha)
console.log('🔌 Host do banco:', new URL(process.env.DATABASE_URL).host);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000, // espera até 15s (cold start do Neon)
  idleTimeoutMillis: 30000,
  max: 5,
  keepAlive: true,
});

// Evita derrubar o bot quando o Neon fecha uma conexão ociosa
pool.on('error', (err) => {
  console.error('⚠️ Erro em conexão ociosa do pool:', err.message);
});

// Teste de conexão
pool.connect((err, client, release) => {
  if (err) {
    console.error('Erro ao conectar com o banco:', err.message);
  } else {
    console.log('✅ Conectado ao banco Neon com sucesso!');
    release();
  }
});

export const query = (text, params) => pool.query(text, params);
export { pool };