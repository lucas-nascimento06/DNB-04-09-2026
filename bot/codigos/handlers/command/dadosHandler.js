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
            MAX(created_at) AS ultimo_recado
         FROM recados_anonimos`
    );
    return rows[0];
}

function formatarData(data) {
    if (!data) return 'N/A';
    const d = new Date(data);
    const dia = String(d.getDate()).padStart(2, '0');
    const mes = String(d.getMonth() + 1).padStart(2, '0');
    const ano = d.getFullYear();
    const hora = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${dia}/${mes}/${ano} às ${hora}:${min}`;
}

function montarPoster(stats) {
    const total = stats.total_recados ?? 0;
    const destinatarios = stats.destinatarios_unicos ?? 0;
    const ultimoRecado = formatarData(stats.ultimo_recado);

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

        return ehAdmin;
    } catch (err) {
        console.error('❌ [DADOS] Erro ao verificar admin:', err.message);
        return false;
    }
}

// 🔧 Assinatura (sock, message, content, from), igual aos outros handlers
// de commandHandlers.js — o dispatcher chama todo handler passando
// (sock, message, content, from).
export async function handleDadosCommand(sock, message, content, from) {
    if (!/^#dados$/i.test(content.trim())) return false;

    // 🚫 Comando exclusivo para grupos
    if (!from.endsWith('@g.us')) {
        return true;
    }

    const ehAdmin = await isAdminDoGrupo(sock, from, message);

    if (!ehAdmin) {
        await sock.sendMessage(from, {
            text: '🚫 Esse comando é exclusivo para administradores do grupo.',
            quoted: message
        });
        return true;
    }

    try {
        const stats = await buscarEstatisticas();
        const poster = montarPoster(stats);

        await sock.sendMessage(from, {
            text: poster,
            quoted: message
        });

        console.log('✅ [DADOS] Estatísticas enviadas com sucesso.');
    } catch (err) {
        console.error('❌ [DADOS] Erro ao buscar estatísticas:', err.message);
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