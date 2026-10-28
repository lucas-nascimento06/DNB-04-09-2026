// bot/codigos/handlers/command/brincadeiraNamoroHandler.js
// 💘 BRINCADEIRA DO NAMORO  (ponto de entrada)
//
// Comandos (cada um tem uma versão curta):
//   #entrar  | #ne            -> (foto + legenda com a ficha) inscreve na brincadeira
//   #pedido  | #np            -> (declaração + @pessoa) faz um pedido de namoro
//   #aceito  | #na            -> aceita o pedido recebido e forma o casal
//   #inscritos | #ni          -> lista completa (solteiras, solteiros e casais)
//   #casais | #nca | #namorohomens | #nh | #namoromulheres | #nm -> mesma lista (antigos)
//   #namoro  | #nr            -> regras da brincadeira (#namoro completa, #nr resumida)
//   #ncomandos | #nc          -> lista de comandos (#ncomandos detalhada, #nc resumida)
//
// Desafio (novo):
//   #ndesafio | #nd (ADM)     -> (foto/vídeo + texto) posta o desafio marcando só os casais
//   #cumpri                   -> (foto/vídeo + texto) cumpre o desafio; vai para a moderação
//   #ndstatus | #nds (ADM)    -> reenvia a lista de status no grupo de moderação
//
// Módulos (pasta ./brincadeiraNamoro/):
//   config.js, utils.js, dados.js, inscricao.js, pedidos.js, listas.js, regras.js, desafio.js

import { CONFIG, GRUPOS_PERMITIDOS } from './brincadeiraNamoro/config.js';
import { extractDigits, getNumeroReal, lerMensagem, temComando } from './brincadeiraNamoro/utils.js';
import { garantirTabelas } from './brincadeiraNamoro/dados.js';
import { tratarEntrar } from './brincadeiraNamoro/inscricao.js';
import { tratarPedido, tratarAceito } from './brincadeiraNamoro/pedidos.js';
import { mostrarLista } from './brincadeiraNamoro/listas.js';
import { tratarDesafio, tratarCumpri, tratarStatusDesafio } from './brincadeiraNamoro/desafio.js';
import {
    mostrarRegras, mostrarComandos,
    mostrarComandosCurto, mostrarRegrasCurto,
} from './brincadeiraNamoro/regras.js';

console.log('[brincadeiraNamoro] v1 carregado (modular)');

// comandos que mostram a lista completa
const COMANDOS_LISTA = [
    '#inscritos', '#ni',
    '#casais', '#nca',
    '#namorohomens', '#nh',
    '#namoromulheres', '#nm',
];

// Retorna true se a mensagem foi consumida pela brincadeira.
export async function handleBrincadeiraNamoro(sock, message, content, from, ownerNumbers = []) {
    if (!from.endsWith('@g.us')) return false;
    if (CONFIG.SOMENTE_GRUPOS_PERMITIDOS && !GRUPOS_PERMITIDOS.includes(from)) return false;
    if (message.key.fromMe) return false;

    const { img, texto, ctx } = lerMensagem(message, content);
    if (!texto) return false;
    const lower = texto.toLowerCase();

    // filtro rápido: só continua se for comando da brincadeira
    const ehComando =
        /(^|\s)#(entrar|ne|pedido|np|aceito|na|ndesafio|nd|cumpri)(\s|$)/i.test(texto) ||
        /^#(inscritos|ni|casais|nca|namorohomens|nh|namoromulheres|nm|namoro|nr|ncomandos|nc|ndstatus|nds)$/.test(lower);
    if (!ehComando) return false;

    try {
        await garantirTabelas();

        // comandos liberados para todos os membros
        if (lower === '#namoro') { await mostrarRegras(sock, from, message); return true; }
        if (lower === '#nr') { await mostrarRegrasCurto(sock, from, message); return true; }
        if (lower === '#ncomandos') { await mostrarComandos(sock, from, message); return true; }
        if (lower === '#nc') { await mostrarComandosCurto(sock, from, message); return true; }
        if (COMANDOS_LISTA.includes(lower)) { await mostrarLista(sock, message, from); return true; }

        // ações de participantes
        const jid = message.key.participant;
        const userId = extractDigits(getNumeroReal(message));
        if (!jid || !userId) return false;

        // desafio
        if (lower === '#ndstatus' || lower === '#nds') { await tratarStatusDesafio(sock, message, from, jid, userId, ownerNumbers); return true; }
        if (temComando(texto, 'ndesafio') || temComando(texto, 'nd')) { await tratarDesafio(sock, message, from, jid, userId, img, texto, ownerNumbers); return true; }
        if (temComando(texto, 'cumpri')) { await tratarCumpri(sock, message, from, jid, userId, img, texto); return true; }

        if (temComando(texto, 'entrar') || temComando(texto, 'ne')) { await tratarEntrar(sock, message, from, jid, userId, img, texto); return true; }
        if (temComando(texto, 'pedido') || temComando(texto, 'np')) { await tratarPedido(sock, message, from, jid, userId, texto, ctx); return true; }
        if (temComando(texto, 'aceito') || temComando(texto, 'na')) { await tratarAceito(sock, message, from, jid, userId, ctx); return true; }
    } catch (e) {
        console.error('[brincadeiraNamoro] erro:', e.message);
        await sock.sendMessage(from, { text: '❌ Erro na brincadeira do namoro. Avise um ADM.' }).catch(() => {});
        return true;
    }
    return false;
}