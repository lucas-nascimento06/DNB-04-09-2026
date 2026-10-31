// ============================================================
//  rainhaModel.js  →  bot/codigos/data/rainhaModel.js
//  ✅ VERSÃO CORRIGIDA
//  - extrairNumeroLimpo() strip :N e @ (device suffix do Baileys)
//  - getFantasmas retorna resolvedId sempre limpo via extrairNumeroLimpo()
//  - getInativosComDias, fecharDia usam extrairNumeroLimpo()
//  - fecharDia idempotente via tabela dias_fechados
// ============================================================

import pool from '../../../db.js';

// ============================================
// 🤖 NÚMERO DO BOT (nunca aparece em inativos)
// ============================================
const BOT_NUMBER = '5511997869449';

// ===========================================
// 🔧 UTILITÁRIOS
// ===========================================

/**
 * Remove device suffix (:N) e domínio (@...) do JID, retorna só dígitos.
 * Ex: "5585999123456:5@s.whatsapp.net" → "5585999123456"
 *     "5585999123456@s.whatsapp.net"   → "5585999123456"
 *     "5585999123456"                   → "5585999123456"
 */
function extrairNumeroLimpo(rawId) {
  if (!rawId) return null;
  const semSufixo     = rawId.replace(/[:@].*$/, '');
  const apenasDigitos = semSufixo.replace(/\D/g, '');
  if (apenasDigitos.length < 10) return null;
  return apenasDigitos;
}

function dataHojeBrasilia() {
  const hoje = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const [d, m, a] = hoje.split('/');
  return `${a}-${m}-${d}`;
}

// ============================================
// 🗄️ INIT DB
// ============================================
export async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mensagens_grupo (
      id           SERIAL PRIMARY KEY,
      grupo_id     TEXT NOT NULL,
      usuario_id   TEXT NOT NULL,
      nome         TEXT NOT NULL,
      foto_url     TEXT,
      quantidade   INTEGER DEFAULT 0,
      dias_inativo INTEGER DEFAULT 0,
      ultimo_ativo DATE,
      data         DATE NOT NULL DEFAULT CURRENT_DATE,
      criado_em    TIMESTAMP DEFAULT NOW(),
      UNIQUE (grupo_id, usuario_id)
    );
    CREATE INDEX IF NOT EXISTS idx_mg_grupo
      ON mensagens_grupo (grupo_id);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS dias_fechados (
      grupo_id TEXT NOT NULL,
      data     DATE NOT NULL,
      PRIMARY KEY (grupo_id, data)
    );
  `);

  console.log('🗄️ Tabelas verificadas/criadas.');
}

// ============================================
// 📝 REGISTRAR MENSAGEM
// ============================================
export async function registrarMensagem(grupoId, usuarioId, nome, fotoUrl = null) {
  const numeroLimpo = extrairNumeroLimpo(usuarioId);
  if (!numeroLimpo) {
    console.warn(`⚠️ [rainhaModel] Número inválido ignorado: ${usuarioId}`);
    return;
  }

  const hoje = dataHojeBrasilia();
  await pool.query(
    `INSERT INTO mensagens_grupo
       (grupo_id, usuario_id, nome, foto_url, quantidade, dias_inativo, ultimo_ativo, data)
     VALUES ($1, $2, $3, $4, 1, 0, $5, $5)
     ON CONFLICT (grupo_id, usuario_id)
     DO UPDATE SET
       quantidade   = mensagens_grupo.quantidade + 1,
       nome         = EXCLUDED.nome,
       foto_url     = COALESCE(EXCLUDED.foto_url, mensagens_grupo.foto_url),
       dias_inativo = 0,
       ultimo_ativo = $5,
       data         = $5`,
    [grupoId, numeroLimpo, nome, fotoUrl, hoje]
  );
}

// ============================================
// 👑 RAINHA DO DIA
// ============================================
export async function getRainhaDoDia(grupoId) {
  const hoje = dataHojeBrasilia();
  const res = await pool.query(
    `SELECT usuario_id, nome, foto_url, quantidade AS total
       FROM mensagens_grupo
      WHERE grupo_id = $1
        AND data = $2
        AND quantidade > 0
      ORDER BY total DESC
      LIMIT 1`,
    [grupoId, hoje]
  );
  return res.rows[0] || null;
}

// ============================================
// 📊 ATIVOS DO DIA
// ============================================
export async function getAtivos(grupoId) {
  const hoje = dataHojeBrasilia();
  const res = await pool.query(
    `SELECT usuario_id, nome, quantidade AS total
       FROM mensagens_grupo
      WHERE grupo_id = $1
        AND data = $2
        AND quantidade > 0
      ORDER BY total DESC`,
    [grupoId, hoje]
  );
  return res.rows;
}

// ============================================
// 👻 FANTASMAS (nunca falaram desde que o bot conhece o grupo)
// ============================================
export async function getFantasmas(grupoId, membrosResolvidos, adminNums = []) {
  const res = await pool.query(
    `SELECT usuario_id FROM mensagens_grupo WHERE grupo_id = $1`,
    [grupoId]
  );
  const conhecidos = new Set(res.rows.map(r => r.usuario_id));
  const ignorados  = new Set([BOT_NUMBER, ...adminNums]);

  // ✅ Filtra E já retorna resolvedId sempre limpo via extrairNumeroLimpo
  const fantasmas = membrosResolvidos
    .filter(m => {
      const num = extrairNumeroLimpo(m.resolvedId);
      if (!num) return false;
      return !conhecidos.has(num) && !ignorados.has(num);
    })
    .map(m => ({
      ...m,
      resolvedId: extrairNumeroLimpo(m.resolvedId), // ✅ garante número limpo no retorno
    }));

  return { fantasmas };
}

// ============================================
// 😴 INATIVOS COM DIAS ACUMULADOS
// ============================================
export async function getInativosComDias(grupoId, membrosResolvidos, adminNums = []) {
  const res = await pool.query(
    `SELECT usuario_id, nome, dias_inativo
       FROM mensagens_grupo
      WHERE grupo_id = $1`,
    [grupoId]
  );

  const bancoPorNumero = {};
  res.rows.forEach(r => {
    bancoPorNumero[r.usuario_id] = { dias: r.dias_inativo, nome: r.nome };
  });

  const ativosHoje = new Set(
    (await getAtivos(grupoId)).map(u => u.usuario_id)
  );

  const ignorados = new Set([BOT_NUMBER, ...adminNums]);

  return membrosResolvidos
    .filter(m => {
      const num = extrairNumeroLimpo(m.resolvedId);
      if (!num) return false;
      return !ativosHoje.has(num) && !ignorados.has(num) && num in bancoPorNumero;
    })
    .map(m => {
      const num         = extrairNumeroLimpo(m.resolvedId);
      const diasInativo = bancoPorNumero[num].dias + 1;
      const nome        = bancoPorNumero[num].nome || null;
      return { ...m, resolvedId: num, diasInativo, nome };
    })
    .sort((a, b) => b.diasInativo - a.diasInativo);
}

// ============================================
// 🔄 FECHAR DIA
// ✅ Idempotente: se já fechou hoje, não faz nada.
// ============================================
export async function fecharDia(grupoId, membrosResolvidos, adminNums = []) {
  const hoje = dataHojeBrasilia();

  const jaFechou = await pool.query(
    `SELECT 1 FROM dias_fechados WHERE grupo_id = $1 AND data = $2`,
    [grupoId, hoje]
  );
  if (jaFechou.rows.length > 0) {
    console.log(`⏭️ [rainhaModel] Dia ${hoje} já fechado para ${grupoId}, pulando.`);
    return;
  }

  // ─── Remove do banco quem saiu do grupo ───────────────
  const numerosNoGrupo = new Set(
    membrosResolvidos
      .map(m => extrairNumeroLimpo(m.resolvedId))
      .filter(Boolean)
  );

  const todosNoBanco = await pool.query(
    `SELECT usuario_id FROM mensagens_grupo WHERE grupo_id = $1`,
    [grupoId]
  );

  const sairamDoGrupo = todosNoBanco.rows
    .map(r => r.usuario_id)
    .filter(num => !numerosNoGrupo.has(num));

  if (sairamDoGrupo.length) {
    await pool.query(
      `DELETE FROM mensagens_grupo
        WHERE grupo_id = $1
          AND usuario_id = ANY($2)`,
      [grupoId, sairamDoGrupo]
    );
    console.log(`🚪 [rainhaModel] ${sairamDoGrupo.length} membro(s) removido(s) por ter saído do grupo.`);
  }

  // ─── Quem falou hoje ──────────────────────────────────
  const ativosHoje = new Set(
    (await getAtivos(grupoId)).map(u => u.usuario_id)
  );

  const ignorados = new Set([BOT_NUMBER, ...adminNums]);

  // ─── Incrementa dias_inativo de quem NÃO falou hoje ──
  const inativosNums = membrosResolvidos
    .map(m => extrairNumeroLimpo(m.resolvedId))
    .filter(num => num && !ativosHoje.has(num) && !ignorados.has(num));

  if (inativosNums.length) {
    await pool.query(
      `UPDATE mensagens_grupo
          SET dias_inativo = dias_inativo + 1
        WHERE grupo_id = $1
          AND usuario_id = ANY($2)`,
      [grupoId, inativosNums]
    );
    console.log(`😴 [rainhaModel] ${inativosNums.length} inativo(s) incrementado(s).`);
  }

  // ─── Zera dias_inativo de quem falou hoje ─────────────
  const ativosArray = [...ativosHoje];
  if (ativosArray.length) {
    await pool.query(
      `UPDATE mensagens_grupo
          SET dias_inativo = 0
        WHERE grupo_id = $1
          AND usuario_id = ANY($2)`,
      [grupoId, ativosArray]
    );
  }

  // ─── Zera contagem de mensagens do dia ────────────────
  await pool.query(
    `UPDATE mensagens_grupo
        SET quantidade = 0
      WHERE grupo_id = $1
        AND data = $2
        AND quantidade > 0`,
    [grupoId, hoje]
  );

  // ─── Remove quem está inativo há 5+ dias ──────────────
  await pool.query(
    `DELETE FROM mensagens_grupo
      WHERE grupo_id = $1
        AND dias_inativo >= 5`,
    [grupoId]
  );

  // ─── Marca o dia como fechado ─────────────────────────
  await pool.query(
    `INSERT INTO dias_fechados (grupo_id, data)
     VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [grupoId, hoje]
  );

  console.log(`✅ [rainhaModel] Dia ${hoje} fechado para grupo ${grupoId}.`);
}