import pool from './db.js';

const t = Date.now();
const consultas = Array.from({ length: 10 }, (_, i) =>
  pool.query('SELECT $1::int AS n, NOW()', [i])
    .then(() => console.log(`✅ consulta ${i} ok (${Date.now() - t} ms)`))
    .catch(e => console.log(`❌ consulta ${i}: ${e.message} (${Date.now() - t} ms)`))
);

await Promise.all(consultas);
process.exit(0);
