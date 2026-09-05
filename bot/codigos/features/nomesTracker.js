import pool from '../../../db.js';

function extrairNumeroLimpo(rawId) {
  if (!rawId) return null;
  const semSufixo = rawId.replace(/[:@].*$/, '');
  const apenasDigitos = semSufixo.replace(/\D/g, '');
  if (apenasDigitos.length < 10) return null;
  return apenasDigitos;
}

/**
 * Obtém o nome real do usuário para usar nas mensagens
 */
export async function obterNomeUsuario(userId) {
  try {
    const numeroLimpo = extrairNumeroLimpo(userId);
    if (!numeroLimpo) {
      return null;
    }

    const result = await pool.query(
      `SELECT nome
         FROM mensagens_grupo
        WHERE usuario_id = $1
          AND nome IS NOT NULL
          AND nome != 'Desconhecido'
        ORDER BY criado_em DESC
        LIMIT 1`,
      [numeroLimpo]
    );

    return result.rows.length > 0 ? result.rows[0].nome : null;
  } catch (err) {
    console.error('[obterNomeUsuario] Erro:', err.message);
    return null;
  }
}
