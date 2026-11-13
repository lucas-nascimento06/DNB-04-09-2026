// Handler principal da brincadeira Chá ou Café.
//   import chaOuCafe from '../command/brincadeirachaoucafe/index.js';
//   if (await chaOuCafe.handle(sock, msg, OWNER_NUMBERS)) return;   // true = mensagem tratada
//
// Reações:
//   #cha  -> 🍵   |   #cafe -> ☕   |   resposta à pergunta do bot -> ✅
// Punição: quem não responde a pergunta em prazoRespostaMs fica silenciado por silencioMs
//   (o bot apaga as mensagens da pessoa; o bot precisa ser ADM do grupo).
//   Enquanto estiver punida, a pessoa NÃO pode ser convidada (o bot avisa para escolher outra).
// #bcc (ADM/dono): envia o poster marcando todos de forma invisível e fixa no grupo.
// Convites, perguntas, prazos e silenciados ficam salvos no banco (sobrevivem a reinício do bot).
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

// ---------- Verificador de prazos (punição) ----------
let sockAtual = null;          // sempre o socket mais recente (muda se o bot reconectar)
let verificador = null;
let verificando = false;
const avisosSilencio = new Map(); // "grupo:numero" -> timestamp do último aviso
const INTERVALO_AVISO_MS = 60 * 1000;

async function verificarPrazos() {
  if (verificando || !sockAtual) return;
  verificando = true;
  try {
    const vencidas = await dados.punirVencidos();
    for (const v of vencidas) {
      try {
        if (!cfg.gruposPermitidos.includes(v.grupoId)) continue;
        if (await dados.brincadeiraEncerrada(v.grupoId)) continue;

        await dados.silenciar(v.grupoId, v.alvoJid, cfg.silencioMs);
        await sockAtual.sendMessage(v.grupoId, {
          text: regras.punicao(mencao(v.alvoJid)),
          mentions: [v.alvoJid],
        });
        console.log(
          `🔇 [chaoucafe] ${jidParaNumero(v.alvoJid)} silenciado(a) em ${v.grupoId} por ${Math.round(cfg.silencioMs / 60000 * 100) / 100} min`
        );
      } catch (err) {
        console.error('⚠️ [chaoucafe] erro ao punir:', err.message);
      }
    }
  } finally {
    verificando = false;
  }
}

function iniciarVerificador(sock) {
  sockAtual = sock;
  if (verificador) return;
  verificador = setInterval(() => {
    verificarPrazos().catch((err) =>
      console.error('⚠️ [chaoucafe] erro no verificador:', err.message)
    );
  }, cfg.intervaloVerificacaoMs);
  verificador.unref?.();
}

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

  // ADM abrindo uma brincadeira nova: descarta tudo que sobrou da anterior
  // (perguntas pendentes, convites e punições), para não disparar mensagens antigas.
  if (admin) {
    await dados.novaBrincadeira(grupoId);
    console.log(`🧹 [chaoucafe] brincadeira anterior zerada em ${grupoId}`);
  }

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

  // Pessoa punida (silenciada) não pode receber convite até a punição acabar
  const punido = await dados.buscarSilenciado(grupoId, [alvoNum]);
  if (punido) {
    console.log(`[chaoucafe] convite recusado: ${alvoNum} está punido(a) (faltam ${Math.ceil(punido.restanteMs / 1000)} s)`);
    await responder(
      sock,
      msg,
      regras.alvoPunido(mencao(autor), mencao(alvo), punido.restanteMs),
      [autor, alvo]
    );
    return true;
  }

  // Envia o convite primeiro para guardar o ID da mensagem do bot:
  // a resposta (#cha/#cafe) precisa citar exatamente essa mensagem.
  const enviada = await responder(sock, msg, regras.convite(mencao(autor), mencao(alvo)), [alvo, autor]);
  await dados.criarConvite(grupoId, autor, alvo, enviada?.key?.id || null);
  return true;
}

// #cha  /  #cafe  (resposta da pessoa marcada, SEMPRE respondendo o convite do bot)
async function responderEscolha(sock, msg, tipo) {
  const grupoId = msg.key.remoteJid;
  const citadoId = extrairIdCitado(msg);

  const convite = await dados.buscarConvite(grupoId, numerosDoRemetente(msg));
  if (!convite) {
    // Alguém que NÃO é a pessoa marcada tentou responder o convite de outra pessoa
    if (citadoId) {
      const conviteDeOutro = await dados.buscarConvitePorMsgId(grupoId, citadoId);
      if (conviteDeOutro) {
        const intruso = remetente(msg);
        console.log(`[chaoucafe] #${tipo} recusado: convite era de ${jidParaNumero(conviteDeOutro.alvoJid)}`);
        await responder(
          sock,
          msg,
          regras.conviteDeOutro(mencao(intruso), mencao(conviteDeOutro.alvoJid)),
          [intruso, conviteDeOutro.alvoJid]
        );
        return true;
      }
    }
    console.log(`[chaoucafe] #${tipo} ignorado: sem convite pendente para ${numerosDoRemetente(msg).join('/')}`);
    return false;
  }

  if (convite.msgId && citadoId !== convite.msgId) {
    console.log(`[chaoucafe] #${tipo} recusado: não respondeu o convite (citou ${citadoId || 'nada'})`);
    await responder(sock, msg, regras.responderAbaixo(mencao(convite.alvoJid)), [convite.alvoJid]);
    return true;
  }

  await dados.removerConvite(grupoId, convite);

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
  // e o prazo (punição) é cancelado.
  await dados.registrarPergunta(grupoId, enviada?.key?.id || null, convite.alvoJid, convite.autorJid);
  return true;
}

// Mensagem de quem está silenciado: apaga e avisa (no máximo 1 aviso por minuto por pessoa)
async function tratarSilenciado(sock, msg, silenciado) {
  const grupoId = msg.key.remoteJid;

  try {
    await sock.sendMessage(grupoId, { delete: msg.key });
  } catch (err) {
    console.error('⚠️ [chaoucafe] erro ao apagar mensagem (o bot é ADM do grupo?):', err.message);
  }

  const chave = `${grupoId}:${jidParaNumero(silenciado.alvoJid)}`;
  const agora = Date.now();
  if (agora - (avisosSilencio.get(chave) || 0) >= INTERVALO_AVISO_MS) {
    avisosSilencio.set(chave, agora);
    try {
      await sock.sendMessage(grupoId, {
        text: regras.silenciado(mencao(silenciado.alvoJid), silenciado.restanteMs),
        mentions: [silenciado.alvoJid],
      });
    } catch (err) {
      console.error('⚠️ [chaoucafe] erro ao avisar silenciado:', err.message);
    }
  }
}

// donos = OWNER_NUMBERS: também podem encerrar/reabrir mesmo sem ser ADM do grupo
export async function handle(sock, msg, donos = []) {
  try {
    if (!msg?.message || msg.key.fromMe) return false;

    const grupoId = msg.key.remoteJid;
    if (cfg.somenteGrupos && !grupoId.endsWith('@g.us')) return false;

    const comando = extrairComandos(extrairTexto(msg)).find((c) => TODOS.includes(c));

    if (!cfg.gruposPermitidos.includes(grupoId)) {
      if (comando) {
        console.log(`[chaoucafe] #${comando} IGNORADO: grupo ${grupoId} não está em config.js > gruposPermitidos`);
      }
      return false;
    }

    // Garante o verificador de prazos rodando (usa sempre o socket mais recente)
    iniciarVerificador(sock);

    const encerrada = await dados.brincadeiraEncerrada(grupoId);

    // Pessoa punida: apaga a mensagem (vale para qualquer mensagem, comando ou não)
    if (!encerrada) {
      const silenciado = await dados.buscarSilenciado(grupoId, numerosDoRemetente(msg));
      if (silenciado) {
        await tratarSilenciado(sock, msg, silenciado);
        return true;
      }
    }

    if (!comando) {
      // Não é comando: pode ser resposta à pergunta do bot
      if (!encerrada) {
        const citadoId = extrairIdCitado(msg);
        if (citadoId) {
          const pergunta = await dados.buscarPergunta(grupoId, citadoId);
          if (pergunta) {
            const numeros = numerosDoRemetente(msg);
            if (numeros.includes(jidParaNumero(pergunta.alvoJid))) {
              // A pessoa convidada respondeu: ✅ e cancela a punição
              await dados.marcarRespondida(grupoId, citadoId);
              await reagir(sock, msg, '✅');
            } else {
              // Outra pessoa tentou responder a pergunta
              const intruso = remetente(msg);
              await responder(
                sock,
                msg,
                regras.perguntaDeOutro(mencao(intruso), mencao(pergunta.alvoJid)),
                [intruso, pergunta.alvoJid]
              );
            }
          }
        }
      }
      return false;
    }

    console.log(`[chaoucafe] comando #${comando} recebido em ${grupoId}`);

    if (cfg.comandosEncerrar.includes(comando)) return await encerrar(sock, msg, donos);

    if (encerrada) {
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