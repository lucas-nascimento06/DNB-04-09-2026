// ============================================================
//  ativosHandler.js  →  bot/codigos/handlers/command/
// ============================================================

import { getAtivos, getInativosComDias, fecharDia } from '../../utils/rainhaModel.js';

function isAdm(message, admList) {
  const sender    = message.key.participant    || message.key.remoteJid;
  const senderAlt = message.key.participantAlt || '';
  return admList.includes(sender) || admList.includes(senderAlt);
}

function labelDias(dias) {
  if (dias === 1) return '1 dia sem falar';
  return `${dias} dias sem falar`;
}

// ─── #ativos ──────────────────────────────────────────
export async function ativosHandler(client, message, admList = []) {
  const grupoId = message.key.remoteJid;

  if (!isAdm(message, admList)) {
    return client.sendMessage(grupoId, {
      text: '❌ Apenas administradores podem usar *#ativos*.',
    });
  }

  try {
    const ativos = await getAtivos(grupoId);

    if (!ativos.length) {
      return client.sendMessage(grupoId, {
        text: '📭 Nenhum usuário ativo registrado hoje.',
      });
    }

    let lista = '';
    const mencoes = [];
    ativos.forEach((u, i) => {
      lista   += `${`${i + 1}.`.padEnd(3)} @${u.usuario_id} — *${u.total} msgs*\n`;
      mencoes.push(`${u.usuario_id}@s.whatsapp.net`);
    });

    await client.sendMessage(grupoId, {
      text:
        `🟢 *USUÁRIOS ATIVOS HOJE* 🟢\n` +
        `👥 Total: *${ativos.length} pessoas*\n\n` +
        lista.trim(),
      mentions: mencoes,
    });

  } catch (err) {
    console.error('[ativosHandler] Erro:', err.message);
    await client.sendMessage(grupoId, { text: '❌ Erro ao buscar ativos.' });
  }
}

// ─── #inativos ───────────────────────────────────────────────
export async function inativosHandler(client, message, admList = [], grupoPrincipalId = null) {
  const grupoAdmId  = message.key.remoteJid;
  const grupoAlvoId = grupoPrincipalId || grupoAdmId;

  if (!isAdm(message, admList)) {
    return client.sendMessage(grupoAdmId, {
      text: '❌ Apenas administradores podem usar *#inativos*.',
    });
  }

  try {
    const meta    = await client.groupMetadata(grupoAlvoId);
    const membros = meta.participants || [];

    const adminNums = membros
      .filter(p => p.admin)
      .map(p => p.id.replace(/@.*$/, ''));

    const membrosResolvidos = membros
      .map(m => ({
        originalId: m.id,
        resolvedId: m.phoneNumber ?? m.id,
      }))
      .filter(m => m.resolvedId.endsWith('@s.whatsapp.net'));

    const inativos = await getInativosComDias(grupoAlvoId, membrosResolvidos, adminNums);

    if (!inativos.length) {
      return client.sendMessage(grupoAdmId, {
        text: '🏆 Incrível! Todos os membros interagiram hoje!',
      });
    }

    // ─── Lista detalhada apenas para o grupo de ADMs ─────────
    let listaAdm = '';
    const mencoesAdm = [];

    inativos.forEach((m, i) => {
      const num   = `${i + 1}.`.padEnd(3);
      const dias  = labelDias(m.diasInativo);
      const emoji = m.diasInativo >= 5 ? '🚫' : m.diasInativo >= 3 ? '😴' : '';

      listaAdm += `${num} @${m.resolvedId.split('@')[0]} — ${dias} ${emoji}\n`;

      if (m.diasInativo >= 5) {
        listaAdm += `     ⚠️ *BAN SUGERIDO →* #ban @${m.resolvedId.split('@')[0]}\n`;
      }

      mencoesAdm.push(m.originalId);
    });

    await client.sendMessage(grupoAdmId, {
      text:
        `🔴 *INATIVOS DO DIA* 🔴\n` +
        `📅 ${new Date().toLocaleDateString('pt-BR')} | 👥 *${inativos.length} pessoas*\n\n` +
        `─────────────────────────\n` +
        listaAdm.trim(),
      mentions: mencoesAdm,
    });

    // ─── Fecha o dia no grupo principal ──────────────────────
    await fecharDia(grupoAlvoId, membrosResolvidos, adminNums);

  } catch (err) {
    console.error('[inativosHandler] Erro:', err.message);
    await client.sendMessage(grupoAdmId, { text: '❌ Erro ao buscar inativos.' });
  }
}