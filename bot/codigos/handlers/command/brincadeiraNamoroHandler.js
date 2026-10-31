// bot/codigos/handlers/command/brincadeiraNamoroHandler.js
// 💘 BRINCADEIRA DO NAMORO  (ponto de entrada)
//
// Comandos (cada um tem uma versão curta):
//   #entrar  | #ne            -> (foto + legenda com a ficha) inscreve na brincadeira
//   #pedido  | #np            -> (declaração + @pessoa) faz um pedido de namoro
//   #aceito  | #na            -> aceita o pedido recebido e forma o casal
//   #inscritos | #ni          -> lista completa (solteiras, solteiros e casais)
//   #casais | #nca | #namorohomens | #nh | #namoromulheres | #nm -> mesma lista (antigos)
//   #listpart | #lp           -> modelo fixo e vazio da lista, com o cabeçalho "Damas da Night"
//   #ficha                    -> envia a ficha de inscrição pronta para copiar
//   #namoro  | #nr            -> regras da brincadeira (#namoro completa, #nr resumida)
//   #ncomandos | #nc          -> lista de comandos (#ncomandos detalhada, #nc resumida)
//
// Desafio (numerado de 1 a CONFIG.LIMITE_DESAFIOS):
//   #ndesafio | #nd (ADM)     -> (foto/vídeo + texto) posta o desafio marcando só os casais
//   #cumpri | #cumprir | #c   -> (foto/vídeo + texto) cumpre o desafio ativo; vai para a moderação
//   #ndstatus | #nds (ADM)    -> reenvia a lista de status no grupo de moderação
//   #vd (ADM)                 -> tabela do desafio ativo | #vd 2 -> desafio 2 | #vd todos -> resumo geral
//   #dlista | #dl (ADM)       -> mostra a lista de participantes e casais atualizada (use no grupo de moderação)
//
// Módulos (pasta ./brincadeiraNamoro/):
//   config.js, utils.js, dados.js, inscricao.js, pedidos.js, listas.js, regras.js, desafio.js

import { CONFIG, GRUPOS_PERMITIDOS, GRUPO_MODERACAO } from './brincadeiraNamoro/config.js';
import { extractDigits, getNumeroReal, lerMensagem, temComando } from './brincadeiraNamoro/utils.js';
import { garantirTabelas } from './brincadeiraNamoro/dados.js';
import { tratarEntrar } from './brincadeiraNamoro/inscricao.js';
import { tratarPedido, tratarAceito } from './brincadeiraNamoro/pedidos.js';
import { mostrarLista, mostrarListaAtualizada, mostrarListPart } from './brincadeiraNamoro/listas.js';
import { tratarDesafio, tratarCumpri, tratarStatusDesafio, tratarVerDesafio, ehAdmin } from './brincadeiraNamoro/desafio.js';
import {
    mostrarRegras, mostrarComandos,
    mostrarComandosCurto, mostrarRegrasCurto,
    mostrarFicha,
} from './brincadeiraNamoro/regras.js';

console.log('[brincadeiraNamoro] v4 carregado (modular + LID + inscrição simultânea + anti-trava)');

// DEBUG: true = logs detalhados de cada passo. Os logs "[namoro]" abaixo aparecem sempre.
const DEBUG = false;
const dbg = (...a) => { if (DEBUG) console.log('[brincadeiraNamoro][DEBUG]', ...a); };

// comandos que mostram a lista completa
const COMANDOS_LISTA = [
    '#inscritos', '#ni',
    '#casais', '#nca',
    '#namorohomens', '#nh',
    '#namoromulheres', '#nm',
];

// apelidos dos comandos (cada um tem versão completa e curta)
const CMD_DLISTA = ['#dlista', '#dl'];
const CMD_LISTPART = ['#listpart', '#lp'];
const CUMPRI_CMDS = ['cumprir', 'cumpri', 'c']; // #cumpri | #cumprir | #c

// #cumpri / #cumprir / #c como palavra inteira (evita pegar #casais, #comando etc.)
const temCumpri = (texto) =>
    new RegExp(`(^|\\s)#(${CUMPRI_CMDS.join('|')})(?=\\s|$)`, 'i').test(String(texto || ''));

// ===================== PROTEÇÃO CONTRA DUPLICIDADE / SIMULTANEIDADE =====================
const emAndamento = new Set();     // evita a mesma pessoa ser processada 2x ao mesmo tempo
const mensagensVistas = new Set(); // evita a mesma mensagem ser processada 2x (reentrega após reconexão)
const TEMPO_MAX_INSCRICAO_MS = 60_000; // se a inscrição travar, a trava da pessoa é liberada sozinha

function jaVista(id) {
    if (!id) return false;
    if (mensagensVistas.has(id)) return true;
    mensagensVistas.add(id);
    if (mensagensVistas.size > 500) mensagensVistas.delete(mensagensVistas.values().next().value);
    return false;
}

// ===================== IDENTIFICAÇÃO DA PESSOA =====================
const ehLid = (j) => String(j || '').endsWith('@lid');
const ehNumeroValido = (id) => /^\d{8,15}$/.test(String(id || ''));

// Garante que o "userId" é um número de telefone e não o próprio LID.
function idPareceValido(userId, jid) {
    if (!ehNumeroValido(userId)) return false;
    if (ehLid(jid) && userId === extractDigits(jid)) return false; // devolveu o LID como se fosse número
    return true;
}

// Resolve { jid, userId } mesmo quando a pessoa chega como @lid e o cache ainda está vazio.
// Ordem: getNumeroReal -> participantAlt/participantPn -> groupMetadata (com 1 nova tentativa).
async function resolverUsuario(sock, message, from) {
    const jid = message.key.participant;
    if (!jid) return { jid: null, userId: null, origem: 'sem participant' };

    // 1) o jeito que o resto do bot já usa (mantém o mesmo user_id do #dc)
    try {
        const id = extractDigits(getNumeroReal(message));
        if (idPareceValido(id, jid)) return { jid, userId: id, origem: 'getNumeroReal' };
    } catch (e) {
        dbg('getNumeroReal falhou:', e.message);
    }

    // 2) se o próprio jid já é número
    if (!ehLid(jid)) {
        const id = extractDigits(jid);
        if (ehNumeroValido(id)) return { jid, userId: id, origem: 'jid' };
    }

    // 3) campos alternativos do Baileys (v7+)
    const alternativos = [message.key.participantAlt, message.key.participantPn, message.participantPn]
        .filter(Boolean);
    for (const alt of alternativos) {
        if (!ehLid(alt)) {
            const id = extractDigits(alt);
            if (ehNumeroValido(id)) return { jid, userId: id, origem: 'participantAlt' };
        }
    }

    // 4) groupMetadata (2 tentativas: a 1ª pode vir sem o mapeamento)
    for (let tentativa = 1; tentativa <= 2; tentativa++) {
        try {
            const meta = await sock.groupMetadata(from);
            const p = (meta.participants || []).find((x) =>
                [x.id, x.lid, x.jid].filter(Boolean).includes(jid)
            );
            const cand = [p?.phoneNumber, p?.jid, p?.id].filter((v) => v && !ehLid(v));
            for (const c of cand) {
                const id = extractDigits(c);
                if (ehNumeroValido(id)) return { jid, userId: id, origem: `groupMetadata#${tentativa}` };
            }
        } catch (e) {
            dbg('groupMetadata falhou:', e.message);
        }
        if (tentativa === 1) await new Promise((r) => setTimeout(r, 600));
    }

    return { jid, userId: null, origem: 'não resolvido' };
}

// Retorna true se a mensagem foi consumida pela brincadeira.
export async function handleBrincadeiraNamoro(sock, message, content, from, ownerNumbers = []) {
    if (!from.endsWith('@g.us')) return false;
    if (message.key.fromMe) return false;

    const { img, texto, ctx } = lerMensagem(message, content);
    if (!texto) {
        if (img) console.log(`[namoro] mídia SEM legenda ignorada (de ${message.key.participant})`);
        return false;
    }
    const lower = texto.toLowerCase();

    // #vd (também "#vd 2" e "#vd todos") e #dlista/#dl funcionam no grupo de moderação;
    // todos os outros comandos continuam restritos aos grupos permitidos, como antes
    const ehVd = /^#(vd(\s+(\d{1,2}|todos))?|dlista|dl)$/.test(lower) &&
        (from === GRUPO_MODERACAO || GRUPOS_PERMITIDOS.includes(from));
    if (!ehVd && CONFIG.SOMENTE_GRUPOS_PERMITIDOS && !GRUPOS_PERMITIDOS.includes(from)) {
        if (/#(entrar|ne)(\s|$)/i.test(texto)) {
            console.log(`[namoro] IGNORADO: grupo não permitido (${from})`);
        }
        return false;
    }

    // filtro rápido: só continua se for comando da brincadeira
    const ehComando =
        /(^|\s)#(entrar|ne|pedido|np|aceito|na|ndesafio|nd|cumprir|cumpri|c)(\s|$)/i.test(texto) ||
        /^#(inscritos|ni|casais|nca|namorohomens|nh|namoromulheres|nm|namoro|nr|ncomandos|nc|ndstatus|nds|vd(\s+(\d{1,2}|todos))?|dlista|dl|listpart|lp|ficha)$/.test(lower);
    if (!ehComando) {
        // parece comando mas não casou com o filtro? avisa no log para diagnóstico
        if (/#\s*(entrar|ne|pedido|np|aceito|na)/i.test(texto)) {
            console.log(`[namoro] AVISO: parece comando mas não casou | de=${message.key.participant} | fim=${JSON.stringify(texto.slice(-50))}`);
        }
        return false;
    }

    console.log(`[namoro] comando | de=${message.key.participant} | mídia=${img ? 'sim' : 'não'} | "${texto.slice(0, 40).replace(/\n/g, ' ')}"`);

    try {
        await garantirTabelas();

        // comandos liberados para todos os membros
        if (lower === '#namoro') { await mostrarRegras(sock, from, message); return true; }
        if (lower === '#nr') { await mostrarRegrasCurto(sock, from, message); return true; }
        if (lower === '#ncomandos') { await mostrarComandos(sock, from, message); return true; }
        if (lower === '#nc') { await mostrarComandosCurto(sock, from, message); return true; }
        if (lower === '#ficha') { await mostrarFicha(sock, from, message); return true; }
        if (CMD_LISTPART.includes(lower)) { await mostrarListPart(sock, message, from); return true; }
        if (COMANDOS_LISTA.includes(lower)) { await mostrarLista(sock, message, from); return true; }

        // ações de participantes
        const { jid, userId, origem } = await resolverUsuario(sock, message, from);
        console.log(`[namoro] identificação: jid=${jid} userId=${userId} (${origem})`);

        if (!jid || !userId) {
            // nunca mais em silêncio
            await sock.sendMessage(
                from,
                { text: '⚠️ Não consegui identificar você agora. Envie a mensagem novamente, por favor. 🙏' },
                { quoted: message }
            ).catch(() => {});
            return true;
        }

        // desafio
        if (/^#vd(\s|$)/.test(lower)) { await tratarVerDesafio(sock, message, from, jid, userId, ownerNumbers, lower); return true; }
        if (CMD_DLISTA.includes(lower)) {
            if (!(await ehAdmin(sock, from, jid, userId, ownerNumbers))) {
                await sock.sendMessage(from, { text: '🚫 Só ADM pode usar este comando.' }, { quoted: message });
                return true;
            }
            await mostrarListaAtualizada(sock, message, from);
            return true;
        }
        if (lower === '#ndstatus' || lower === '#nds') { await tratarStatusDesafio(sock, message, from, jid, userId, ownerNumbers); return true; }
        if (temComando(texto, 'ndesafio') || temComando(texto, 'nd')) { await tratarDesafio(sock, message, from, jid, userId, img, texto, ownerNumbers); return true; }
        if (temCumpri(texto)) { await tratarCumpri(sock, message, from, jid, userId, img, texto); return true; }

        // inscrição: roda em segundo plano para não segurar as mensagens das outras pessoas
        if (temComando(texto, 'entrar') || temComando(texto, 'ne')) {
            if (jaVista(message.key.id)) {
                console.log(`[namoro] IGNORADO: mensagem repetida (${message.key.id})`);
                return true;
            }

            const chave = `${from}:${userId}`;
            if (emAndamento.has(chave)) {
                console.log(`[namoro] IGNORADO: inscrição de ${userId} ainda em andamento (presa?)`);
                return true;
            }
            emAndamento.add(chave);

            // destrava sozinho: mesmo que algo trave, a pessoa pode tentar de novo depois de 60s
            const timer = setTimeout(() => {
                if (emAndamento.delete(chave)) {
                    console.log(`[namoro] trava de ${userId} liberada após ${TEMPO_MAX_INSCRICAO_MS / 1000}s`);
                }
            }, TEMPO_MAX_INSCRICAO_MS);

            dbg(`inscrição de ${userId} (mídia=${img ? 'sim' : 'não'})`);
            tratarEntrar(sock, message, from, jid, userId, img, texto)
                .catch(async (e) => {
                    console.error('[brincadeiraNamoro] erro na inscrição:', e);
                    await sock.sendMessage(
                        from,
                        { text: '❌ Erro na inscrição. Tente enviar de novo.' },
                        { quoted: message }
                    ).catch(() => {});
                })
                .finally(() => {
                    clearTimeout(timer);
                    emAndamento.delete(chave);
                });
            return true;
        }

        if (temComando(texto, 'pedido') || temComando(texto, 'np')) { await tratarPedido(sock, message, from, jid, userId, texto, ctx); return true; }
        if (temComando(texto, 'aceito') || temComando(texto, 'na')) { await tratarAceito(sock, message, from, jid, userId, ctx); return true; }
    } catch (e) {
        console.error('[brincadeiraNamoro] erro:', e);
        await sock.sendMessage(from, { text: '❌ Erro na brincadeira do namoro. Avise um ADM.' }).catch(() => {});
        return true;
    }
    return false;
}