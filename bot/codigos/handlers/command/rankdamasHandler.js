// ============================================================
//  rankdamasHandler.js
//  ✅ VERSÃO CORRIGIDA
//  - resolverJidLimpo() usa mesma lógica do dedicatoriaHandler
//    (participantAlt → participant → phoneNumber → digitos)
//  - adminNums e membrosResolvidos usam resolverJidLimpo()
//  - jidMencao monta a partir de resolvedId (nunca originalId com :N)
//  - Alerta com imagem no grupo principal
// ============================================================

import axios from 'axios';
import { Jimp } from 'jimp';
import { getAtivos, getInativosComDias, getFantasmas, fecharDia } from '../../utils/rainhaModel.js';

const GRUPO_PRINCIPAL = '120363412511975026@g.us';
const GRUPO_ADMINS    = '120363431558953171@g.us';

const FOTO_ALERTA_URL = 'https://i.ibb.co/fYV2rq3G/tropa-antifantasmas.png';

// ============================================
// 🔧 UTIL
// ============================================

/**
 * Strip device suffix (:N) e domínio (@...) — fallback seguro.
 */
function digitos(id = '') {
  return id.replace(/[:@].*$/, '').replace(/\D/g, '');
}

/**
 * ✅ Resolve número limpo do participante do grupo.
 * Mesma lógica do dedicatoriaHandler:
 *   participantAlt (@s.whatsapp.net) → participant (@s.whatsapp.net) → phoneNumber → digitos(id)
 */
function resolverJidLimpo(m) {
  if (m.participantAlt && m.participantAlt.endsWith('@s.whatsapp.net')) {
    return m.participantAlt.replace('@s.whatsapp.net', '');
  }
  if (m.participant && m.participant.endsWith('@s.whatsapp.net')) {
    return m.participant.replace('@s.whatsapp.net', '');
  }
  return m.phoneNumber ?? digitos(m.id);
}

function labelDias(dias) {
  if (dias === 0) return 'inativo hoje';
  if (dias === 1) return '1 dia sem falar';
  return `${dias} dias sem falar`;
}

// ============================================
// 🖼️ HELPERS DE IMAGEM
// ============================================
async function baixarImagem(url) {
  try {
    const res = await axios.get(url, { responseType: 'arraybuffer' });
    return Buffer.from(res.data, 'binary');
  } catch (err) {
    console.error('❌ Erro ao baixar imagem do alerta:', err.message);
    return null;
  }
}

async function gerarThumbnail(buffer, size = 256) {
  try {
    const image = await Jimp.read(buffer);
    image.scaleToFit({ w: size, h: size });
    return await image.getBuffer('image/jpeg');
  } catch (err) {
    console.error('Erro ao gerar thumbnail:', err);
    return null;
  }
}

async function enviarComImagem(client, grupoId, buffer, legenda, mencoes) {
  try {
    const thumb = await gerarThumbnail(buffer);
    await client.sendMessage(grupoId, {
      image: buffer,
      caption: legenda,
      mentions: mencoes,
      jpegThumbnail: thumb,
    });
    return true;
  } catch {
    try {
      await client.sendMessage(grupoId, { image: buffer, caption: legenda, mentions: mencoes });
      return true;
    } catch (err2) {
      console.error('❌ Erro no fallback de imagem do alerta:', err2.message);
      return false;
    }
  }
}

// ============================================
// 🔐 ADMIN CHECK
// ============================================
async function checkIfUserIsAdmin(client, groupId, userId) {
  try {
    const groupMetadata = await client.groupMetadata(groupId);
    const participant = groupMetadata.participants.find(p => {
      return digitos(p.id) === digitos(userId);
    });
    if (!participant) return false;
    return participant.admin === 'admin' || participant.admin === 'superadmin';
  } catch (error) {
    console.error('❌ Erro ao verificar admin:', error);
    return false;
  }
}

// ============================================
// 🗑️ DELETAR MENSAGEM
// ============================================
async function deleteCommandMessage(client, groupId, messageKey) {
  const delays = [0, 100, 500, 1000, 2000, 5000];
  for (let i = 0; i < delays.length; i++) {
    try {
      if (delays[i] > 0) await new Promise(r => setTimeout(r, delays[i]));
      const key = {
        remoteJid:   messageKey.remoteJid || groupId,
        fromMe:      false,
        id:          messageKey.id,
        participant: messageKey.participant,
      };
      await client.sendMessage(groupId, { delete: key });
      console.log(`✅ Comando #rankdamas deletado (tentativa ${i + 1})`);
      return true;
    } catch {
      console.log(`❌ Tentativa ${i + 1} de deletar #rankdamas falhou`);
    }
  }
  return false;
}

// ============================================
// 🚀 HANDLER PRINCIPAL
// ============================================
export async function rankdamasHandler(client, message) {
  const grupoId = message.key.remoteJid;
  const userId  = message.key.participant || message.key.remoteJid;

  console.log(`\n🎯 [rankdamasHandler] INICIADO`);
  console.log(`📱 Grupo: ${grupoId}`);
  console.log(`👤 User: ${userId}`);

  // ─── FILTRO DE GRUPO ───────────────────────
  if (grupoId !== GRUPO_PRINCIPAL) {
    console.log(`⏭️ [rankdamasHandler] Grupo não é o principal, ignorando`);
    return false;
  }

  // ─── VERIFICA ADMIN ────────────────────────
  const isAdmin = await checkIfUserIsAdmin(client, grupoId, userId);
  if (!isAdmin) {
    console.log(`❌ [rankdamasHandler] Usuário não é admin, deletando...`);
    await deleteCommandMessage(client, grupoId, message.key);
    await client.sendMessage(grupoId, {
      text: '❌ Apenas *administradores* podem usar o comando *#rankdamas*!',
    });
    return true;
  }

  // ─── BUSCAR METADATA ───────────────────────
  let membros           = [];
  let adminNums         = [];
  let membrosResolvidos = [];

  try {
    const meta = await client.groupMetadata(grupoId);
    membros = meta.participants || [];

    // ✅ Usa resolverJidLimpo() — mesma lógica do dedicatoriaHandler
    adminNums = membros
      .filter(m => m.admin === 'admin' || m.admin === 'superadmin')
      .map(m => resolverJidLimpo(m));

    membrosResolvidos = membros.map(m => ({
      originalId: m.id,                  // JID completo (ex: 5585...:5@s.whatsapp.net)
      resolvedId: resolverJidLimpo(m),   // ✅ número limpo via resolverJidLimpo
    }));

    console.log(`📊 [rankdamasHandler] ${membros.length} participantes, ${adminNums.length} admins`);
    console.log(`📋 [rankdamasHandler] Admins: ${adminNums.join(', ')}`);
  } catch (err) {
    console.error('[rankdamasHandler] Erro ao buscar metadados:', err.message);
    await client.sendMessage(grupoId, {
      text: '❌ Erro ao buscar dados do grupo. Tente novamente!',
    });
    return true;
  }

  // ─── RANKING ───────────────────────────────
  try {
    const ativos = await getAtivos(grupoId);
    console.log(`📊 [rankdamasHandler] Ativos hoje: ${ativos.length}`);

    if (!ativos.length) {
      await client.sendMessage(grupoId, {
        text: '📭 Nenhuma mensagem registrada hoje para gerar o ranking!',
      });
      return true;
    }

    // ─── 🟢 RANKING DE ATIVOS → grupo de admins ──────────
    let listaAtivos     = '';
    const mencoesAtivos = [];

    ativos.forEach((u, i) => {
      const pos = `${i + 1}.`.padEnd(3);
      listaAtivos += `${pos} @${u.usuario_id} — *${u.total} msgs*\n`;
      mencoesAtivos.push(`${u.usuario_id}@s.whatsapp.net`);
    });

    await client.sendMessage(GRUPO_ADMINS, {
      text:
        `🟢 *RANKING DE ATIVOS DO DIA* 🟢\n` +
        `📅 ${new Date().toLocaleDateString('pt-BR')} | 👥 *${ativos.length} pessoas*\n\n` +
        `─────────────────────────\n` +
        listaAtivos.trim(),
      mentions: mencoesAtivos,
    });
    console.log(`✅ [rankdamasHandler] Ranking de ativos enviado`);

    // ─── 🔴 INATIVOS → grupo de admins ───────────────────
    const inativos = await getInativosComDias(grupoId, membrosResolvidos, adminNums);
    console.log(`📊 [rankdamasHandler] Inativos: ${inativos.length}`);

    if (inativos.length) {
      let listaInativos     = '';
      const mencoesInativos = [];

      inativos.forEach((m, i) => {
        const pos   = `${i + 1}.`.padEnd(3);
        const dias  = labelDias(m.diasInativo);
        const emoji = m.diasInativo >= 5 ? '🚫' : m.diasInativo >= 3 ? '😴' : '';
        const nome  = m.nome ? ` (${m.nome})` : '';
        const num   = m.resolvedId;

        listaInativos += `${pos} @${num}${nome} — ${dias} ${emoji}\n`;
        listaInativos += `     ➤ para remover: *#ban @${num}*\n\n`;
        mencoesInativos.push(`${num}@s.whatsapp.net`);
      });

      await client.sendMessage(GRUPO_ADMINS, {
        text:
          `🔴 *INATIVOS DO DIA* 🔴\n` +
          `📅 ${new Date().toLocaleDateString('pt-BR')} | 👥 *${inativos.length} pessoas*\n\n` +
          `─────────────────────────\n` +
          listaInativos.trim(),
        mentions: mencoesInativos,
      });
    } else {
      await client.sendMessage(GRUPO_ADMINS, {
        text: `🏆 Todos os membros interagiram hoje!`,
      });
    }

    // ─── 👻 FANTASMAS → grupo de admins ──────────────────
    const { fantasmas } = await getFantasmas(grupoId, membrosResolvidos, adminNums);
    console.log(`📊 [rankdamasHandler] Fantasmas: ${fantasmas.length}`);

    if (fantasmas.length) {
      let listaFantasmas     = '';
      const mencoesFantasmas = [];

      fantasmas.forEach((m, i) => {
        const num = m.resolvedId; // ✅ já limpo vindo do getFantasmas corrigido

        listaFantasmas += `${i + 1}. @${num}\n`;
        listaFantasmas += `     ➤ para remover: *#ban @${num}*\n\n`;
        mencoesFantasmas.push(`${num}@s.whatsapp.net`);
      });

      await client.sendMessage(GRUPO_ADMINS, {
        text:
          `👻 *FANTASMAS DO GRUPO* 👻\n` +
          `_Nunca falaram_\n` +
          `👥 *${fantasmas.length} pessoas*\n\n` +
          `─────────────────────────\n` +
          listaFantasmas.trim(),
        mentions: mencoesFantasmas,
      });
    }

    // ─── 🚨 COBRANÇA → grupo principal ───────────────────
    const cobrarSet   = new Set(inativos.map(m => m.resolvedId));
    const listaCobrar = [...inativos];

    fantasmas.forEach(f => {
      if (!cobrarSet.has(f.resolvedId)) listaCobrar.push(f);
    });

    if (listaCobrar.length) {
      const FRASES_COBRANCA = [
        `📣 *Grupo é pra interagir.* Não é só entrar e ficar de fora.\n` +
        `Participe das conversas, nem que seja rápido, mas apareça.\n` +
        `Evite focar só no privado, a ideia é trocar ideia com todos.\n` +
        `Quem não pretende participar, deve se retirar para evitar futuras remoções.`,
      ];

      const frase = FRASES_COBRANCA[Math.floor(Math.random() * FRASES_COBRANCA.length)];

      let listaGrupo     = '';
      const mencoesGrupo = [];

      listaCobrar.forEach((m, i) => {
        const num = m.resolvedId; // ✅ número limpo
        // ✅ Monta JID a partir do resolvedId limpo — nunca do originalId com :N
        const jidMencao = `${num}@s.whatsapp.net`;

        listaGrupo += `${i + 1}. @${num}\n`;
        mencoesGrupo.push(jidMencao);
      });

      const legendaAlerta =
        `🚨⚠️ *🚨 Tropa Anti-Fantasmas*\n` +
        `🚨⚠️ *ALERTA DE PARTICIPAÇÃO!*\n` +
        `💡 _Interaja no grupo para não ser removido!_ 👑\n` +
        `𝝑𝝔 ⏔⏔⏔⏔⏔⏔⏔🕵️‍♂️⏔⏔⏔⏔⏔⏔⏔ 𝝑𝝔\n` +
        `${frase}\n\n` +
        `👇 *Membros que ainda não interagiram hoje:*\n\n` +
        listaGrupo.trim() +
        `\n𝝑𝝔 ⏔⏔⏔⏔⏔⏔⏔🕵️‍♀️⏔⏔⏔⏔⏔⏔⏔ 𝝑𝝔\n` +
        `💡 _Interaja no grupo para não ser removido!_ 👑`;

      const fotoBuffer = await baixarImagem(FOTO_ALERTA_URL);

      if (fotoBuffer) {
        const enviado = await enviarComImagem(client, grupoId, fotoBuffer, legendaAlerta, mencoesGrupo);
        if (enviado) {
          console.log(`✅ [rankdamasHandler] Alerta com imagem enviado para ${listaCobrar.length} pessoas`);
        } else {
          await client.sendMessage(grupoId, { text: legendaAlerta, mentions: mencoesGrupo });
          console.log(`✅ [rankdamasHandler] Alerta (fallback texto) enviado`);
        }
      } else {
        await client.sendMessage(grupoId, { text: legendaAlerta, mentions: mencoesGrupo });
        console.log(`✅ [rankdamasHandler] Alerta (sem imagem) enviado`);
      }
    } else {
      console.log(`✅ [rankdamasHandler] Nenhum membro para cobrar hoje.`);
    }

    // ─── FECHAR DIA ───────────────────────────────────────
    await fecharDia(grupoId, membrosResolvidos, adminNums);
    console.log(`✅ [rankdamasHandler] Dia fechado com sucesso!`);

  } catch (err) {
    console.error('[rankdamasHandler] Erro ao gerar ranking:', err);
    await client.sendMessage(grupoId, {
      text: '❌ Erro ao gerar o ranking.',
    });
  }

  return true;
}