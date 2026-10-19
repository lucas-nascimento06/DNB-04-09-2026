// ============================================================
//  votacaoHandler.js
//  Comandos: #v | #votacao | #votação   (só admin)
//  - Lê o paredão ativo no Neon (paredoes / paredao_participantes / paredao_votos)
//  - Posta o resultado atualizado no grupo e FIXA a mensagem
//  - Na vez seguinte: desafixa a anterior e fixa a nova (sempre 1 fixação)
//  Salvar em: bot/codigos/handlers/command/votacaoHandler.js
// ============================================================

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from '../../../../db.js';

// ============================================
// ⚙️ CONFIGURAÇÃO
// ============================================
const GRUPO_PRINCIPAL = '120363412511975026@g.us';
const GRUPO_ADMINS = '120363431558953171@g.us';

// Grupos onde o #v funciona (a fixação é guardada separada por grupo)
const GRUPOS_PERMITIDOS = [GRUPO_PRINCIPAL, GRUPO_ADMINS];

// Duração da fixação no WhatsApp: 86400 (24h) | 604800 (7 dias) | 2592000 (30 dias)
const DURACAO_FIXACAO = 86400;

// Apagar a mensagem "#v" do admin depois de responder?
const APAGAR_COMANDO = true;

// Apagar também a mensagem de resultado antiga (além de desafixar)?
const APAGAR_RESULTADO_ANTERIOR = false;

const LINK_SITE = 'https://paredao.damasdanight.top/';

// ============================================
// 💾 ESTADO (guarda a última mensagem fixada por grupo)
// ============================================
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// command -> handlers -> codigos -> bot  =>  bot/data
const ARQUIVO_ESTADO = path.resolve(__dirname, '../../../data/votacaoPin.json');

function lerEstado() {
  try {
    return JSON.parse(fs.readFileSync(ARQUIVO_ESTADO, 'utf8'));
  } catch {
    return {};
  }
}

function salvarEstado(estado) {
  try {
    fs.writeFileSync(ARQUIVO_ESTADO, JSON.stringify(estado, null, 2), 'utf8');
  } catch (err) {
    console.error('❌ [votacaoHandler] Erro ao salvar estado:', err.message);
  }
}

// ============================================
// 🔧 UTIL
// ============================================
function digitos(id = '') {
  return String(id).replace(/[:@].*$/, '').replace(/\D/g, '');
}

function semAcento(txt = '') {
  return txt.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function pct(votos, total) {
  if (!total) return '0,00';
  return ((votos / total) * 100).toFixed(2).replace('.', ',');
}

function barra(votos, total) {
  const cheios = total ? Math.round((votos / total) * 10) : 0;
  return '🟪'.repeat(cheios) + '⬜'.repeat(10 - cheios);
}

function tempoRestante(encerraEm) {
  const ms = new Date(encerraEm).getTime() - Date.now();
  if (ms <= 0) return null;
  const min = Math.floor(ms / 60000);
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  const partes = [];
  if (d) partes.push(`${d}d`);
  partes.push(`${h}h`);
  partes.push(`${m}min`);
  return partes.join(' ');
}

// ============================================
// 🔐 ADMIN CHECK (resiste a LID / número)
// ============================================
async function ehAdmin(sock, from, message, ownerNumbers = []) {
  if (message.key.fromMe) return true;

  const ids = new Set(
    [message.key.participant, message.key.participantAlt]
      .filter(Boolean)
      .map(digitos)
  );

  if (ownerNumbers.some(n => ids.has(digitos(n)))) return true;

  try {
    const meta = await sock.groupMetadata(from);
    const p = meta.participants.find(part =>
      [part.id, part.phoneNumber, part.lid, part.jid]
        .filter(Boolean)
        .some(x => ids.has(digitos(x)))
    );
    return !!p && (p.admin === 'admin' || p.admin === 'superadmin');
  } catch (err) {
    console.error('❌ [votacaoHandler] Erro ao verificar admin:', err.message);
    return false;
  }
}

// ============================================
// 🗳️ BUSCA RESULTADO NO BANCO
// ============================================
async function buscarResultado() {
  const { rows: paredoes } = await pool.query(
    `SELECT id, titulo, encerra_em
       FROM paredoes
      WHERE ativo = true
      ORDER BY criado_em DESC
      LIMIT 1`
  );
  if (!paredoes.length) return null;
  const paredao = paredoes[0];

  const { rows } = await pool.query(
    `SELECT pp.id, pp.nome, pp.ordem, COUNT(v.id)::int AS votos
       FROM paredao_participantes pp
       LEFT JOIN paredao_votos v
              ON v.participante_id = pp.id
             AND v.paredao_id = pp.paredao_id
      WHERE pp.paredao_id = $1
      GROUP BY pp.id, pp.nome, pp.ordem
      ORDER BY pp.ordem ASC`,
    [paredao.id]
  );

  const total = rows.reduce((s, r) => s + r.votos, 0);

  // Mais votado primeiro; empate mantém a ordem original do site
  const ranking = [...rows].sort((a, b) => b.votos - a.votos || a.ordem - b.ordem);

  return { paredao, ranking, total };
}

// ============================================
// 📝 MONTA O TEXTO
// ============================================
function montarTexto({ paredao, ranking, total }) {
  const restante = tempoRestante(paredao.encerra_em);
  const status = restante
    ? `⏳ *Encerra em:* ${restante}`
    : '🔒 *Votação encerrada*';

  const medalhas = ['👑', '🥈', '🥉', '4️⃣'];

  let linhas = '';
  ranking.forEach((p, i) => {
    const icone = total === 0 ? '▫️' : (medalhas[i] || '▫️');
    const plural = p.votos === 1 ? 'voto' : 'votos';
    linhas += `${icone} *${i + 1}º ${p.nome}* — *${pct(p.votos, total)}%* (${p.votos} ${plural})\n`;
    linhas += `${barra(p.votos, total)}\n\n`;
  });

  return (
    `🔥 *${String(paredao.titulo).toUpperCase()} — RESULTADO ATUALIZADO* 🔥\n` +
    `─────────────────────────\n\n` +
    linhas +
    `─────────────────────────\n` +
    `🗳️ *Total de votos:* ${total}\n` +
    `${status}\n\n` +
    `👉 Vote em: *${LINK_SITE}*\n` +
    `_Só membros do grupo podem votar._`
  );
}

// ============================================
// 📌 FIXAR / DESAFIXAR
// ============================================
async function desafixar(sock, key) {
  try {
    await sock.sendMessage(key.remoteJid, { pin: key, type: 2 }); // 2 = desafixar
    return true;
  } catch (err) {
    console.log(`⚠️ [votacaoHandler] Não consegui desafixar a anterior: ${err.message}`);
    return false;
  }
}

async function fixar(sock, groupId, key) {
  try {
    await sock.sendMessage(groupId, { pin: key, type: 1, time: DURACAO_FIXACAO }); // 1 = fixar
    return true;
  } catch (err) {
    console.error('❌ [votacaoHandler] Erro ao fixar:', err.message);
    return false;
  }
}

// ============================================
// 🚀 HANDLER PRINCIPAL
// ============================================
export function ehComandoVotacao(content = '') {
  const cmd = semAcento(content.toLowerCase().trim());
  return cmd === '#v' || cmd === '#votacao';
}

export async function votacaoHandler(sock, message, content, from, ownerNumbers = []) {
  if (!from.endsWith('@g.us')) return false;
  if (!ehComandoVotacao(content)) return false;
  if (!GRUPOS_PERMITIDOS.includes(from)) return false;

  console.log('🗳️ [votacaoHandler] Comando de votação detectado');

  // ─── ADMIN ─────────────────────────────────
  const admin = await ehAdmin(sock, from, message, ownerNumbers);
  if (!admin) {
    await sock.sendMessage(from, {
      text: '❌ Apenas *administradores* podem usar o comando *#v*!',
    }, { quoted: message });
    return true;
  }

  // ─── RESULTADO ─────────────────────────────
  let resultado;
  try {
    resultado = await buscarResultado();
  } catch (err) {
    console.error('❌ [votacaoHandler] Erro no banco:', err.message);
    await sock.sendMessage(from, {
      text: '❌ Não consegui consultar a votação agora. Tente de novo em instantes.',
    });
    return true;
  }

  if (!resultado) {
    await sock.sendMessage(from, { text: '📭 Não há nenhum paredão ativo no momento.' });
    return true;
  }

  // ─── DESAFIXA A ANTERIOR ───────────────────
  const estado = lerEstado();
  const anterior = estado[from];

  if (anterior?.key) {
    await desafixar(sock, anterior.key);
    if (APAGAR_RESULTADO_ANTERIOR) {
      await sock.sendMessage(from, { delete: anterior.key }).catch(() => {});
    }
  }

  // ─── ENVIA O NOVO RESULTADO ────────────────
  const texto = montarTexto(resultado);
  const enviada = await sock.sendMessage(from, { text: texto });

  if (!enviada?.key) {
    console.error('❌ [votacaoHandler] sendMessage não retornou a key');
    return true;
  }

  // ─── FIXA A NOVA ───────────────────────────
  const fixou = await fixar(sock, from, enviada.key);

  if (fixou) {
    estado[from] = {
      key: {
        remoteJid: from,
        id: enviada.key.id,
        fromMe: true,
      },
      fixadoEm: new Date().toISOString(),
    };
    salvarEstado(estado);
    console.log(`📌 [votacaoHandler] Resultado fixado (${enviada.key.id})`);
  } else {
    await sock.sendMessage(from, {
      text: '⚠️ Postei o resultado, mas não consegui fixar. Verifique se o bot é admin do grupo.',
    });
  }

  // ─── APAGA O "#v" DO ADMIN ─────────────────
  if (APAGAR_COMANDO && !message.key.fromMe) {
    await sock.sendMessage(from, { delete: message.key }).catch(() => {});
  }

  return true;
}