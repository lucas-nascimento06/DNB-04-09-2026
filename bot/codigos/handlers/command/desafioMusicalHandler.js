// bot/codigos/handlers/command/desafioMusicalHandler.js
// 🎤 DESAFIO MUSICAL — HOMENS 🆚 MULHERES  (ponto de entrada)
//
// Comandos:
//   #h  | #homens              -> entrar no time dos HOMENS
//   #m  | #mulheres            -> entrar no time das MULHERES
//   #placar                    -> mostra o placar atual (todos os membros)
//   #dmabrir / #dmfechar       -> abre / fecha as inscrições (ADM)
//   #dm | #dmusical [rodadas]  -> inicia o desafio (ADM)
//   #add @pessoa [h|m]         -> ADM coloca alguém num time
//   #dp | #dmparar             -> encerra o desafio (ADM)
//   #ok                        -> ADM libera os DCs de quem acertou e completou a música (ADM)
//   #errou                     -> ADM: a pessoa cantou errado -> sem DCs, ponto apagado e placar refeito (ADM)
//   #next | #n | #proxima      -> próxima música (ADM)
//   #time | #times             -> mostra os times (ADM)
//   #pote [valor]              -> mostra / define o pote de DCs (ADM)
//   #limpartimes               -> apaga os times deste grupo (ADM)
//   #limparmusicas             -> zera o histórico de músicas já tocadas (ADM)
// Respostas: apenas a letra A, B, C, D ou E.
//
// Módulos (pasta ./desafioMusical/):
//   config.js        -> CONFIG, grupos, caminhos
//   state.js         -> jogos, inscricoes, pendentes (memória)
//   utils.js         -> helpers (tag, embaralhar, ehAdmin, resolverAlvo, lista de times, fixar...)
//   dados.js         -> banco de dados (times, pote, carteira, prêmio, músicas usadas)
//   musicas.js       -> banco de músicas e alternativas (por estilo, usando falsas.json)
//   zoeira.js        -> mensagens de zoeira
//   jogo.js          -> fluxo do jogo (rodadas, fim, parar, fixar pergunta/placar, #placar)
//   comandosAdmin.js -> comandos de ADM
//   comandosTime.js  -> #h / #m
//   respostas.js     -> respostas A-E, ponto, liberação do prêmio (#ok) e cancelamento (#errou)

import { GRUPOS_PERMITIDOS } from './desafioMusical/config.js';
import { jogos } from './desafioMusical/state.js';
import { extractDigits, getNumeroReal } from './desafioMusical/utils.js';
import { garantirTabelas } from './desafioMusical/dados.js';
import { tratarComandoAdmin } from './desafioMusical/comandosAdmin.js';
import { tratarEntradaTime } from './desafioMusical/comandosTime.js';
import { tratarResposta } from './desafioMusical/respostas.js';
import { mostrarPlacarAtual } from './desafioMusical/jogo.js';

console.log('[desafioMusical] v10 carregado (modular)');

// Retorna true se a mensagem foi consumida pelo desafio.
export async function handleDesafioMusical(sock, message, content, from, ownerNumbers = []) {
    if (!from.endsWith('@g.us') || !GRUPOS_PERMITIDOS.includes(from)) return false;

    const texto = (content || '').trim();
    const lower = texto.toLowerCase();

    // filtro rápido: só continua se for comando do desafio ou resposta A/B/C/D/E
    const ehComando = /^#add(\s|$)/.test(lower) || /^#(dm|dmusical|dmabrir|dmfechar|dp|dmparar|ok|errou|next|n|proxima|time|times|pote|limpartimes|limparmusicas|h|homens|m|mulheres|placar)(\s+\d+)?$/.test(lower);
    const ehLetra = /^[a-e]$/i.test(texto) && jogos.has(from);
    if (!ehComando && !ehLetra) return false;

    try {
        await garantirTabelas();
    } catch (e) {
        console.error('[desafioMusical] erro ao preparar tabelas:', e.message);
        return false;
    }

    try {
        return await processar(sock, message, texto, lower, from, ownerNumbers);
    } catch (e) {
        console.error('[desafioMusical] erro:', e.message);
        await sock.sendMessage(from, { text: '❌ Erro no desafio musical. Avise um ADM.' }).catch(() => {});
        return true;
    }
}

async function processar(sock, message, texto, lower, from, ownerNumbers) {
    // 1) comandos de ADM
    const admin = await tratarComandoAdmin(sock, message, lower, from, ownerNumbers);
    if (admin !== null) return admin;

    // 1.5) #placar: liberado para todos os membros
    if (lower === '#placar') {
        await mostrarPlacarAtual(sock, from, message);
        return true;
    }

    // 2) ações de participantes
    if (message.key.fromMe) return false;

    const jid = message.key.participant;
    const userId = extractDigits(getNumeroReal(message));
    if (!jid || !userId) return false;

    if (lower === '#h' || lower === '#homens' || lower === '#m' || lower === '#mulheres') {
        return tratarEntradaTime(sock, message, lower, from, jid, userId);
    }

    // 3) resposta A/B/C/D/E
    return tratarResposta(sock, message, texto, from, jid, userId);
}