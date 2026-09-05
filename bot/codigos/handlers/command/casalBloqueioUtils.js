// ARQUIVO: bot/codigos/handlers/command/casalBloqueioUtils.js
// Funções compartilhadas de bloqueio de casal (usadas por leilaoHandler,
// lanceHandler, arrematarHandler, fecharLeilaoHandler e dcasalHandler)

import pool from '../../../../db.js';

// true se o usuário faz parte de um casal ATIVO nesse grupo
// (não pode dar lance nem ser marcado em novo #leilao)
export async function isBloqueado(grupoId, userId) {
    const result = await pool.query(
        `SELECT 1 FROM damas_dc_casais_ativos
         WHERE grupo_id = $1 AND status = 'ativo'
         AND (membro1_id = $2 OR membro2_id = $2)
         LIMIT 1`,
        [grupoId, userId]
    );
    return result.rowCount > 0;
}

// Retorna o casal ativo de um usuário nesse grupo, se houver
export async function buscarCasalAtivo(grupoId, userId) {
    const result = await pool.query(
        `SELECT * FROM damas_dc_casais_ativos
         WHERE grupo_id = $1 AND status = 'ativo'
         AND (membro1_id = $2 OR membro2_id = $2)
         LIMIT 1`,
        [grupoId, userId]
    );
    return result.rows[0] || null;
}

// Forma e bloqueia um casal: nenhum dos dois pode dar lance nem ser
// marcado em novo #leilao até um admin liberar (status -> 'encerrado').
//
// Roda DENTRO da transação de quem chamou (arrematarHandler.js) — por isso
// recebe "client" em vez de usar "pool" direto, pra tudo ser feito (ou
// desfeito, no ROLLBACK) junto com o resto do arremate.
//
// leilaoId e valorDc são NOT NULL na tabela — guardam de qual leilão veio
// esse casal e por quanto DC foi arrematado (histórico).
export async function bloquearCasal(client, grupoId, membro1Id, membro2Id, leilaoId, valorDc) {
    await client.query(
        `INSERT INTO damas_dc_casais_ativos
            (grupo_id, membro1_id, membro2_id, leilao_id, valor_dc, status)
         VALUES ($1, $2, $3, $4, $5, 'ativo')`,
        [grupoId, membro1Id, membro2Id, leilaoId, valorDc]
    );
}

// Libera (encerra) o casal ativo daquele leilão — usado pelo #fl quando o
// leilão já está 'arrematado' (casal formado por bloquearCasal antes).
//
// 🔧 AJUSTE: agora aceita "client" opcional, pra poder rodar DENTRO da
// transação de quem chamou (ex: fecharLeilaoHandler.js), garantindo que o
// UPDATE do leilão e a liberação do casal sejam atômicos (ou os dois
// acontecem, ou nenhum — se algo falhar no meio, o ROLLBACK desfaz tudo).
// Se não passar "client", cai no comportamento antigo (usa "pool" direto).
export async function desbloquearCasal(grupoId, leilaoId, adminId, client = null) {
    const executor = client || pool;
    const result = await executor.query(
        `UPDATE damas_dc_casais_ativos
         SET status = 'encerrado', encerrado_em = NOW(), encerrado_por = $1
         WHERE grupo_id = $2 AND leilao_id = $3 AND status = 'ativo'`,
        [adminId, grupoId, leilaoId]
    );
    return result.rowCount > 0;
}

// 🆕 Libera (encerra) TODOS os casais ativos daquele grupo de uma vez —
// usada pelo #dcasal. Diferente de desbloquearCasal, NÃO depende de um
// leilao_id: como o #fl agora apaga o leilão sem tocar em casal nenhum, o
// registro em damas_dc_casais_ativos pode continuar existindo (e "ativo")
// mesmo depois do leilão que o originou já ter sido apagado. Por isso essa
// função busca só por grupo_id + status='ativo'.
//
// RETURNING traz os dados de cada casal liberado (pra poder mencionar os
// dois membros e mostrar o valor na mensagem de confirmação).
// Aceita "client" opcional pra rodar dentro de uma transação, se precisar.
export async function desbloquearTodosCasaisDoGrupo(grupoId, adminId, client = null) {
    const executor = client || pool;
    const result = await executor.query(
        `UPDATE damas_dc_casais_ativos
         SET status = 'encerrado', encerrado_em = NOW(), encerrado_por = $1
         WHERE grupo_id = $2 AND status = 'ativo'
         RETURNING membro1_id, membro2_id, valor_dc, leilao_id`,
        [adminId, grupoId]
    );
    return result.rows;
}