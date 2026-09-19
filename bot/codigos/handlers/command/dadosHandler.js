import pool from '../../../../db.js';

// ─────────────────────────────────────────────────────────────────────────────
// 📊 DADOS DOS RECADOS — mostra estatísticas da tabela `recados_anonimos`
//
// Uso: #dados (exclusivo para administradores do grupo)
// ─────────────────────────────────────────────────────────────────────────────

async function buscarEstatisticas() {
    const { rows } = await pool.query(
        `SELECT
            COUNT(*) AS total_recados,
            COUNT(DISTINCT numero_destinatario) AS destinatarios_unicos,
            TO_CHAR(
                MAX(created_at) AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo',
                'DD/MM/YYYY" às "HH24:MI'
            ) AS ultimo_recado
         FROM recados_anonimos`
    );
    return rows[0];
}

function montarPoster(stats) {
    const total = stats.total_recados ?? 0;
    const destinatarios = stats.destinatarios_unicos ?? 0;
    const ultimoRecado = stats.ultimo_recado ?? 'N/A';

    return `💌❤️❥❥═══ *RECADINHO DO CORAÇAO* ═══❥❥❤️💌

📊 *ESTATÍSTICAS DOS RECADOS*
👥 Pessoas que já receberam recado: \`${destinatarios}\`
💬 Total de recados enviados: \`${total}\`
📅 Último recado: \`${ultimoRecado}\`
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

// 🔧 Assinatura (sock, message, content, from), igual aos outros handlers
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
        console.log(`   • Total de recados: ${stats.total_recados}`);
        console.log(`   • Destinatários únicos: ${stats.destinatarios_unicos}`);
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