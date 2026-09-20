import pool from '../../../../db.js';

// ─────────────────────────────────────────────────────────────────────────────
// 📊 DADOS DOS RECADOS — v2.8 (Com Soft Delete + Estatísticas Corretas)
//
// Uso: #dados (exclusivo para administradores do grupo)
//
// 🔧 v2.8: agora mostra estatísticas CORRETAS com soft delete
//   • Pessoas que já receberam recado  → destinatários únicos com status 'enviado' E removido=FALSE
//   • Pessoas que ainda faltam receber → destinatários únicos com status 'pendente' E removido=FALSE
//   • Total de recados enviados        → quantidade de recados com status 'enviado' E removido=FALSE
//   • Total de recados PENDENTES       → quantidade de recados com status 'pendente' E removido=FALSE
//   • Recados removidos por moderação  → quantidade com removido=TRUE
//   • Último recado                    → data/hora do último recado (ativo ou removido)
// ─────────────────────────────────────────────────────────────────────────────

async function garantirColunaRemovido() {
    // Garante que o soft delete está habilitado
    await pool.query(`
        ALTER TABLE recados_anonimos 
        ADD COLUMN IF NOT EXISTS removido BOOLEAN DEFAULT FALSE
    `);
    await pool.query(`
        ALTER TABLE recados_anonimos 
        ADD COLUMN IF NOT EXISTS removed_at TIMESTAMP
    `);
    console.log(`✅ [DADOS] Colunas 'removido' e 'removed_at' prontas`);
}

async function buscarEstatisticas() {
    await garantirColunaRemovido();
    
    const { rows } = await pool.query(
        `SELECT
            -- Pessoas que receberam (status='enviado' E não removido)
            COUNT(DISTINCT numero_destinatario) FILTER (WHERE status = 'enviado' AND removido = FALSE)  AS pessoas_receberam,
            
            -- Pessoas aguardando (status='pendente' E não removido)
            COUNT(DISTINCT numero_destinatario) FILTER (WHERE status = 'pendente' AND removido = FALSE) AS pessoas_aguardando,
            
            -- Total enviados (status='enviado' E não removido)
            COUNT(*) FILTER (WHERE status = 'enviado' AND removido = FALSE)                             AS total_enviados,
            
            -- Total PENDENTES (status='pendente' E não removido)
            COUNT(*) FILTER (WHERE status = 'pendente' AND removido = FALSE)                            AS total_pendentes,
            
            -- Total removidos por moderação (removido=TRUE)
            COUNT(*) FILTER (WHERE removido = TRUE)                                                      AS total_removidos,
            
            -- Último recado (pode ser ativo ou removido)
            TO_CHAR(
                MAX(created_at) AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo',
                'DD/MM/YYYY" às "HH24:MI'
            ) AS ultimo_recado
         FROM recados_anonimos`
    );
    return rows[0];
}

function montarPoster(stats) {
    const receberam = stats.pessoas_receberam ?? 0;
    const aguardando = stats.pessoas_aguardando ?? 0;
    const totalEnviados = stats.total_enviados ?? 0;
    const totalPendentes = stats.total_pendentes ?? 0;
    const totalRemovidos = stats.total_removidos ?? 0;
    const ultimoRecado = stats.ultimo_recado ?? 'N/A';

    // Linha de removidos só aparece se houver
    const linhaRemovidos = totalRemovidos > 0 
        ? `🗑️ Recados removidos por moderação: \`${totalRemovidos}\`\n`
        : '';

    return `💌❤️❥❥═══ *RECADINHO DO CORAÇÃO* ═══❥❥❤️💌

📊 *ESTATÍSTICAS DOS RECADOS*

✅ Recados já enviados no grupo Damas da Night: \`${receberam}\` pessoas
👥 Pessoas que receberão o recado: \`${aguardando}\`
📬 *Recados pendentes no App Web* - *DN:* \`${totalPendentes}\`
💬 Total de recados enviados no App Damas da Night: \`${totalEnviados}\`
${linhaRemovidos}📅 Último recado: \`${ultimoRecado}\`

───────────────

_© Damas da Night_`;
}

// 🛡️ Verifica se o remetente é admin do grupo
async function isAdminDoGrupo(sock, from, message) {
    try {
        console.log('🔐 [DADOS] Verificando permissões do usuário...');
        const metadata = await sock.groupMetadata(from);

        const key = message.key;

        const candidatos = new Set(
            [
                key.participant,
                key.participantAlt,
                key.participant?.split('@')[0],
                key.participantAlt?.split('@')[0],
            ].filter(Boolean)
        );

        if (process.env.DEBUG === 'true') {
            console.log('🔍 [DADOS] Candidatos do remetente:', [...candidatos]);
            console.log(
                '🔍 [DADOS] Participantes do grupo:',
                metadata.participants.map(p => ({
                    id: p.id,
                    lid: p.lid,
                    admin: p.admin,
                }))
            );
        }

        const ehAdmin = metadata.participants.some(p => {
            if (!p.admin) return false;

            const idsDoParticipante = new Set(
                [p.id, p.lid, p.id?.split('@')[0], p.lid?.split('@')[0]].filter(Boolean)
            );

            for (const c of candidatos) {
                if (idsDoParticipante.has(c)) return true;
            }
            return false;
        });

        console.log(`${ehAdmin ? '✅' : '❌'} [DADOS] Usuário é admin: ${ehAdmin}`);
        return ehAdmin;
    } catch (err) {
        console.error('❌ [DADOS] Erro ao verificar admin:', err.message);
        return false;
    }
}

// 🔧 Handler do comando #dados
export async function handleDadosCommand(sock, message, content, from) {
    if (!/^#dados$/i.test(content.trim())) return false;

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`📊 COMANDO #DADOS DETECTADO`);
    console.log(`Grupo: ${from}`);
    console.log(`${'═'.repeat(60)}\n`);

    // 🚫 Comando exclusivo para grupos
    if (!from.endsWith('@g.us')) {
        console.log('⚠️  [DADOS] Comando executado em DM, ignorando...');
        return true;
    }

    const ehAdmin = await isAdminDoGrupo(sock, from, message);

    if (!ehAdmin) {
        console.log('❌ [DADOS] Usuário não é admin, rejeitando...');
        await sock.sendMessage(from, {
            text: '🚫 Esse comando é exclusivo para administradores do grupo.',
            quoted: message
        });
        return true;
    }

    try {
        console.log('📊 [DADOS] Buscando estatísticas do banco...');
        const stats = await buscarEstatisticas();

        console.log(`✅ [DADOS] Estatísticas encontradas:`);
        console.log(`   • Pessoas que receberam recados: ${stats.pessoas_receberam}`);
        console.log(`   • Pessoas aguardando recebimento: ${stats.pessoas_aguardando}`);
        console.log(`   • Total de recados enviados: ${stats.total_enviados}`);
        console.log(`   • Total de recados pendentes: ${stats.total_pendentes}`);
        console.log(`   • Recados removidos por moderação: ${stats.total_removidos}`);
        console.log(`   • Último recado: ${stats.ultimo_recado}`);

        const poster = montarPoster(stats);

        console.log('📤 [DADOS] Enviando mensagem...');
        await sock.sendMessage(from, {
            text: poster,
            quoted: message
        });

        console.log('✅ [DADOS] Estatísticas enviadas com sucesso!\n');
    } catch (err) {
        console.error('❌ [DADOS] Erro ao buscar estatísticas:', err.message);
        console.error('Stack:', err.stack);
        try {
            await sock.sendMessage(from, {
                text: '❌ Erro ao buscar as estatísticas. Tenta de novo.',
                quoted: message
            });
        } catch (sendErr) {
            console.error('❌ [DADOS] Erro ao enviar mensagem de erro:', sendErr.message);
        }
    }

    return true;
}

// ============================================
// 🔍 QUERIES ÚTEIS PARA AUDITORIA (ADMIN)
// ============================================

// Ver histórico de removidos (últimos 10)
export async function auditarRemovidos() {
    const { rows } = await pool.query(
        `SELECT 
            id, codigo, numero_destinatario, status, removed_at, created_at
         FROM recados_anonimos 
         WHERE removido = TRUE
         ORDER BY removed_at DESC
         LIMIT 10`
    );
    return rows;
}

// Reativar um recado removido (se foi por engano)
export async function reativarRecado(codigo) {
    const { rows } = await pool.query(
        `UPDATE recados_anonimos 
         SET removido = FALSE, removed_at = NULL
         WHERE UPPER(codigo) = UPPER($1) AND removido = TRUE
         RETURNING id, codigo, numero_destinatario, status`
    );
    return rows[0] || null;
}

// Ver estatísticas detalhadas (com removidos)
export async function estatisticasDetalhadas() {
    const { rows } = await pool.query(
        `SELECT
            'Enviados (ativos)' AS tipo,
            COUNT(*) AS quantidade,
            COUNT(DISTINCT numero_destinatario) AS pessoas_unicas
         FROM recados_anonimos 
         WHERE status = 'enviado' AND removido = FALSE
         
         UNION ALL
         
         SELECT
            'Pendentes (ativos)' AS tipo,
            COUNT(*),
            COUNT(DISTINCT numero_destinatario)
         FROM recados_anonimos 
         WHERE status = 'pendente' AND removido = FALSE
         
         UNION ALL
         
         SELECT
            'Removidos (total)' AS tipo,
            COUNT(*),
            COUNT(DISTINCT numero_destinatario)
         FROM recados_anonimos 
         WHERE removido = TRUE`
    );
    return rows;
}

// Deletar PERMANENTEMENTE recados removidos há > 30 dias (cuidado!)
export async function limparRemovidosAntigos(diasAtrás = 30) {
    const { rowCount } = await pool.query(
        `DELETE FROM recados_anonimos 
         WHERE removido = TRUE 
           AND removed_at < NOW() - INTERVAL '${diasAtrás} days'`
    );
    return rowCount;
}