import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;

const url = new URL(process.env.DATABASE_URL);
console.log('Host:', url.host);
console.log('Parâmetros:', url.search);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 30000,
});

const t = Date.now();
pool.query('SELECT NOW()')
  .then(r => { console.log('✅ Conectou em', Date.now() - t, 'ms'); process.exit(0); })
  .catch(e => { console.error('❌', e.message, 'após', Date.now() - t, 'ms'); process.exit(1); });
