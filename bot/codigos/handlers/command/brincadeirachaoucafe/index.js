// Handler principal da brincadeira Chá ou Café.
//   import chaOuCafe from '../command/brincadeirachaoucafe/index.js';
//   if (await chaOuCafe.handle(sock, msg, OWNER_NUMBERS)) return;   // true = mensagem tratada
//
// Reações:
//   #cha  -> 🍵   |   #cafe -> ☕   |   resposta à pergunta do bot -> ✅
// #bcc (ADM/dono): envia o poster marcando todos de forma invisível e fixa no grupo.
// Imagem do poster: mesmo esquema das boas-vindas (Jimp + jpegThumbnail), funciona no Termux.
import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { Jimp } from 'jimp';

import cfg from './config.js';
import perguntas from './perguntas.js';
import regras from './regras.js';
import * as dados from './dados.js';
import {
  extrairTexto,
  extrairMencionados,
  extrairComandos,
  extrairIdCitado,
  mencao,
  remetente,
  jidParaNumero,
  numerosDoRemetente,
} from './utils.js';

const POSTER_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'imagens',
  'cha-ou-cafe.jpeg'
);

const TODOS = [
  ...cfg.comandosConvite,
  ...cfg.comandosResposta,
  ...cfg.comandosPoster,
  ...cfg.comandosEncerrar,
  'ajudachaoucafe',
];

// Responde citando a mensagem original e devolve a mensagem enviada (precisamos do ID dela)
async function responder(sock, msg, texto, mentions = []) {
  return await sock.sendMessage(
    msg.key.remoteJid,
    { text: texto, mentions },
    { quoted: msg }
  );
}

// Reage na mensagem com o emoji escolhido (não derruba o fluxo se falhar)
async function reagir(sock, msg, emoji) {
  try {
    await sock.sendMessage(msg.key.remoteJid, {
      react: { text: emoji, key: msg.key },
    });
  } catch (err) {
    console.error(`⚠️ [chaoucafe] erro ao reagir com ${emoji}:`, err.message);
  }
}

// true se o remetente é ADM do grupo ou dono do bot (OWNER_NUMBERS)
async function ehAdmin(sock, msg, donos = []) {
  const numeros = numerosDoRemetente(msg);
  if (donos.map(jidParaNumero).some((n) => numeros.includes(n))) return true;

  try {
    const meta = await sock.groupMetadata(msg.key.remoteJid);
    return meta.participants.some((p) => {
      if (p.admin !== 'admin' && p.admin !== 'superadmin') return false;
      return [p.id, p.lid, p.jid, p.phoneNumber]
        .filter(Boolean)
        .map(jidParaNumero)
        .some((n) => numeros.includes(n));
    });
  } catch (err) {
    console.error('⚠️ [chaoucafe] erro ao checar admin:', err.message);
    return false;
  }
}

// ---------- Imagem (mesmo esquema das boas-vindas) ----------

// Gera thumbnail com Jimp
async function gerarThumbnail(buffer, size = 256) {
  try {
    const image = await Jimp.read(buffer);
    await image.resize({ w: size, h: size });
    return await image.getBuffer('image/png');
  } catch (err) {
    console.error('⚠️ [chaoucafe] erro ao gerar thumbnail:', err.message);
    return null;
  }
}

// Envia imagem com thumbnail; se falhar, tenta sem; se falhar de novo, manda só o texto
async function enviarImagemComThumbnail(sock, jid, imageBuffer, caption, quoted, mentions = []) {
  const opcoes = quoted ? { quoted } : {};

  let thumb = null;
  try {
    thumb = await gerarThumbnail(imageBuffer, 256);
  } catch (thumbErr) {
    console.warn('⚠️ [chaoucafe] não foi possível gerar thumbnail, seguindo sem ele:', thumbErr.message);
  }

  const conteudo = { image: imageBuffer, caption, mentions };
  if (thumb) conteudo.jpegThumbnail = thumb;

  try {
    const enviada = await sock.sendMessage(jid, conteudo, opcoes);
    console.log('✅ [chaoucafe] poster enviado' + (thumb ? ' com thumbnail' : ' sem thumbnail'));
    return enviada;
  } catch (err) {
    console.error('⚠️ [chaoucafe] erro ao enviar imagem, tentando sem thumbnail:', err.message);
  }

  try {
    const enviada = await sock.sendMessage(jid, { image: imageBuffer, caption, mentions }, opcoes);
    console.log('✅ [chaoucafe] poster enviado sem thumbnail (2ª tentativa)');
    return enviada;
  } catch (err) {
    console.error('⚠️ [chaoucafe] erro de novo, mandando só o texto:', err.message);
  }

  try {
    const enviada = await sock.sendMessage(jid, { text: caption, mentions }, opcoes);
    console.log('✅ [chaoucafe] poster enviado como texto (fallback)');
    return enviada;
  } catch (err) {
    console.error('❌ [chaoucafe] erro no fallback de texto:', err.message);
    return null;
  }
}

// Fixa a mensagem no grupo por 7 dias
async function fixarMensagem(sock, grupoId, key) {
  try {
    await sock.sendMessage(grupoId, {
      pin: key,
      type: 1,          // 1 = fixar, 2 = desafixar
      time: 604800,     // 7 dias (86400 = 24h | 2592000 = 30 dias)
    });
    console.log('📌 [chaoucafe] poster fixado no grupo');
  } catch (err) {
    console.error('⚠️ [chaoucafe] erro ao fixar o poster:', err.message);
  }
}

// #brincadeirachaoucafe / #bcc -> poster + regras (ADM: marca todos de forma invisível e fixa)
async function enviarPoster(sock, msg, donos = []) {
  const grupoId = msg.key.remoteJid;
  const admin = await ehAdmin(sock, msg, donos);

  // Menção invisível: todos os participantes vão no "mentions", sem aparecer no texto
  let mentions = [];
  if (admin) {
    try {
      const meta = await sock.groupMetadata(grupoId);
      mentions = meta.participants.map((p) => p.id);
    } catch (err) {
      console.error('⚠️ [chaoucafe] erro ao obter participantes:', err.message);
    }
  }

  let imagem = null;
  try {
    imagem = await readFile(POSTER_PATH);
  } catch (err) {
    console.error(`⚠️ [chaoucafe] erro ao ler o poster (${POSTER_PATH}):`, err.message);
  }

  let enviada = null;
  if (imagem && imagem.length > 0) {
    enviada = await enviarImagemComThumbnail(sock, grupoId, imagem, regras.poster, msg, mentions);
  } else {
    enviada = await responder(sock, msg, regras.poster, mentions);
  }

  if (admin && enviada?.key) {
    await fixarMensagem(sock, grupoId, enviada.key);
  }
  return true;
}

// ---------- Comandos ----------

// #ebcc / #encerrabrincadeiracc (só ADM)
async function encerrar(sock, msg, donos) {
  const grupoId = msg.key.remoteJid;

  if (!(await ehAdmin(sock, msg, donos))) {
    await responder(sock, msg, regras.soAdminEncerrar);
    return true;
  }

  const bancoLimpo = await dados.encerrarBrincadeira(grupoId);
  console.log(`[chaoucafe] brincadeira ENCERRADA em ${grupoId} (banco limpo: ${bancoLimpo})`);
  await responder(sock, msg, regras.encerradaOk(bancoLimpo));
  return true;
}

// #chaoucafe @pessoa  /  #cc @pessoa
async function criarConvite(sock, msg) {
  const grupoId = msg.key.remoteJid;
  const autor = remetente(msg);
  const meusNumeros = numerosDoRemetente(msg);
  const marcados = extrairMencionados(msg);

  if (marcados.length === 0) {
    await responder(sock, msg, regras.semMarcacao);
    return true;
  }

  const alvo = marcados[0];
  const alvoNum = jidParaNumero(alvo);

  if (meusNumeros.includes(alvoNum)) {
    await responder(sock, msg, regras.marcouSiMesmo);
    return true;
  }

  const botNumeros = [sock.user?.id, sock.user?.lid].filter(Boolean).map(jidParaNumero);
  if (botNumeros.includes(alvoNum)) {
    await responder(sock, msg, regras.marcouBot);
    return true;
  }

  // Envia o convite primeiro para guardar o ID da mensagem do bot:
  // a resposta (#cha/#cafe) precisa citar exatamente essa mensagem.
  const enviada = await responder(sock, msg, regras.convite(mencao(autor), mencao(alvo)), [alvo, autor]);
  dados.criarConvite(grupoId, autor, alvo, enviada?.key?.id || null);
  return true;
}

// #cha  /  #cafe  (resposta da pessoa marcada, SEMPRE respondendo o convite do bot)
async function responderEscolha(sock, msg, tipo) {
  const grupoId = msg.key.remoteJid;

  const convite = dados.buscarConvite(grupoId, numerosDoRemetente(msg));
  if (!convite) {
    console.log(`[chaoucafe] #${tipo} ignorado: sem convite pendente para ${numerosDoRemetente(msg).join('/')}`);
    return false;
  }

  const citadoId = extrairIdCitado(msg);
  if (convite.msgId && citadoId !== convite.msgId) {
    console.log(`[chaoucafe] #${tipo} recusado: não respondeu o convite (citou ${citadoId || 'nada'})`);
    await responder(sock, msg, regras.responderAbaixo(mencao(convite.alvoJid)), [convite.alvoJid]);
    return true;
  }

  dados.removerConvite(grupoId, convite);

  // 🍵 se mandou #cha, ☕ se mandou #cafe
  await reagir(sock, msg, tipo === 'cha' ? '🍵' : '☕');

  const texto = await dados.sortearPergunta(grupoId, tipo, perguntas[tipo]);

  const enviada = await responder(
    sock,
    msg,
    regras.pergunta(tipo, mencao(convite.autorJid), mencao(convite.alvoJid), texto),
    [convite.autorJid, convite.alvoJid]
  );

  // Guarda o ID da pergunta: quando a pessoa responder ela, a resposta recebe ✅
  dados.registrarPergunta(grupoId, enviada?.key?.id || null, convite.alvoJid, convite.autorJid);
  return true;
}

// donos = OWNER_NUMBERS: também podem encerrar/reabrir mesmo sem ser ADM do grupo
export async function handle(sock, msg, donos = []) {
  try {
    if (!msg?.message || msg.key.fromMe) return false;

    const grupoId = msg.key.remoteJid;
    if (cfg.somenteGrupos && !grupoId.endsWith('@g.us')) return false;

    const comando = extrairComandos(extrairTexto(msg)).find((c) => TODOS.includes(c));

    if (!comando) {
      // Não é comando: pode ser a resposta da pessoa à pergunta do bot -> ✅
      if (cfg.gruposPermitidos.includes(grupoId)) {
        const citadoId = extrairIdCitado(msg);
        if (citadoId && dados.buscarPergunta(grupoId, citadoId, numerosDoRemetente(msg))) {
          await reagir(sock, msg, '✅');
        }
      }
      return false;
    }

    if (!cfg.gruposPermitidos.includes(grupoId)) {
      console.log(`[chaoucafe] #${comando} IGNORADO: grupo ${grupoId} não está em config.js > gruposPermitidos`);
      return false;
    }

    console.log(`[chaoucafe] comando #${comando} recebido em ${grupoId}`);

    if (cfg.comandosEncerrar.includes(comando)) return await encerrar(sock, msg, donos);

    if (await dados.brincadeiraEncerrada(grupoId)) {
      if (cfg.comandosPoster.includes(comando) && (await ehAdmin(sock, msg, donos))) {
        await dados.reabrirBrincadeira(grupoId);
        console.log(`[chaoucafe] brincadeira REABERTA em ${grupoId}`);
        return await enviarPoster(sock, msg, donos);
      }
      await responder(sock, msg, regras.jaEncerrada);
      return true;
    }

    if (cfg.comandosPoster.includes(comando)) return await enviarPoster(sock, msg, donos);
    if (cfg.comandosConvite.includes(comando)) return await criarConvite(sock, msg);
    if (cfg.comandosResposta.includes(comando)) return await responderEscolha(sock, msg, comando);
    if (comando === 'ajudachaoucafe') {
      await responder(sock, msg, regras.ajuda);
      return true;
    }
    return false;
  } catch (err) {
    console.error('❌ [chaoucafe] erro:', err.message);
    return false;
  }
}

export default { handle };