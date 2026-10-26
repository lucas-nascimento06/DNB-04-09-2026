// bot/codigos/handlers/command/desafioMusical/musicas.js
// Banco de músicas e montagem das opções de cada rodada.
//
// - musicasDesafio.json : as músicas que TOCAM (cada uma com "estilo").
// - falsas.json         : lista de músicas REAIS de outros cantores, separadas por estilo
//                         { "sertanejo": ["Título — Artista", ...], "mpb": [...], ... }
//                         As alternativas erradas saem daqui, do MESMO estilo da música certa.

import fs from 'fs';
import path from 'path';
import { BANCO, ARQUIVO_FALSAS, PASTA_TRECHOS, PASTA_LETRAS, LETRAS, NUM_FALSAS } from './config.js';
import { embaralhar } from './utils.js';

// true  = 2 das 4 alternativas erradas misturam banda e música para confundir o pessoal
//         (um par repetido com a resposta certa e outro par repetido só entre erradas).
// false = todas as alternativas erradas são músicas reais de outros cantores.
const MISTURAR = true;

// Se faltar opção no mesmo estilo, completa com estes estilos (nesta ordem).
const ESTILOS_PROXIMOS = {
    sertanejo: ['pagode', 'brega', 'pop'],
    pagode: ['mpb', 'brega', 'sertanejo', 'pop'],
    mpb: ['rock', 'pop', 'pagode'],
    rock: ['pop', 'mpb'],
    pop: ['rock', 'mpb', 'brega'],
    brega: ['pop', 'sertanejo', 'pagode'],
    urbano: ['pop', 'brega', 'rock'],
    pop_int: ['rock_int', 'pop'],
    rock_int: ['pop_int', 'rock'],
};

// Lê o JSON e garante um id em cada música (se não tiver "id", usa a posição: 1, 2, 3...)
function lerTodas() {
    return JSON.parse(fs.readFileSync(BANCO, 'utf8'))
        .map((m, i) => ({ ...m, id: m.id ?? i + 1 }));
}

export function carregarBanco() {
    return lerTodas().filter(m => fs.existsSync(path.join(PASTA_TRECHOS, m.arquivo)));
}

export function buscarMusicaPorId(id) {
    return lerTodas().find(m => m.id === id) || null;
}

export function lerLetra(id) {
    const arq = path.join(PASTA_LETRAS, `${id}.txt`);
    if (!fs.existsSync(arq)) return null;
    return fs.readFileSync(arq, 'utf8').trim();
}

// Lê a cada rodada: dá pra editar o falsas.json sem reiniciar o bot.
function carregarFalsas() {
    try {
        return JSON.parse(fs.readFileSync(ARQUIVO_FALSAS, 'utf8'));
    } catch (e) {
        console.error('[desafioMusical] erro ao ler falsas.json:', e.message);
        return {};
    }
}

// compara nomes sem acento, maiúscula, "&" / " e "
function norm(s) {
    return String(s || '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/&/g, ' e ')
        .replace(/[^a-z0-9 ]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function partir(texto) {
    const [titulo, ...resto] = texto.split(' — ');
    return { titulo, artista: resto.join(' — '), texto };
}

// "usadas" é um Set de IDs de músicas
export function montarRodada(banco, usadas) {
    const disponiveis = banco.filter(m => !usadas.has(m.id));
    if (disponiveis.length === 0) return null;

    const correta = disponiveis[Math.floor(Math.random() * disponiveis.length)];
    const textoCorreto = `${correta.titulo} — ${correta.artista}`;

    const artistaCorreto = norm(correta.artista);
    const titulosBanco = new Set(banco.map(m => norm(m.titulo)));
    const falsasPorEstilo = carregarFalsas();

    // candidatas de um estilo: nunca do cantor certo, nunca música que está no banco
    const doEstilo = (estilo) => embaralhar(falsasPorEstilo[estilo] || [])
        .map(partir)
        .filter(f => f.artista
            && norm(f.artista) !== artistaCorreto
            && norm(f.titulo) !== norm(correta.titulo)
            && !titulosBanco.has(norm(f.titulo)));

    // fases: 1º mesmo estilo, depois estilos próximos
    if (!correta.estilo) {
        console.warn(`[desafioMusical] a música ${correta.id} ("${correta.titulo}") está sem "estilo" no musicasDesafio.json. Use o JSON novo!`);
    }
    if (Object.keys(falsasPorEstilo).length === 0) {
        console.warn('[desafioMusical] falsas.json vazio ou não encontrado em bot/data/. Alternativas vão sair só do banco!');
    }
    const estilos = correta.estilo
        ? [correta.estilo, ...(ESTILOS_PROXIMOS[correta.estilo] || [])]
        : Object.keys(falsasPorEstilo); // sem estilo: mistura todos
    const fases = estilos.map(doEstilo);

    const escolhidas = [];
    const artistasUsados = new Set();
    const titulosUsados = new Set();

    // 1) um cantor por alternativa, respeitando a ordem das fases
    for (const fase of fases) {
        for (const f of fase) {
            if (escolhidas.length >= NUM_FALSAS) break;
            const a = norm(f.artista);
            const t = norm(f.titulo);
            if (artistasUsados.has(a) || titulosUsados.has(t)) continue;
            escolhidas.push(f.texto);
            artistasUsados.add(a);
            titulosUsados.add(t);
        }
        if (escolhidas.length >= NUM_FALSAS) break;
    }

    // 2) segurança: se ainda faltar, libera repetir cantor
    if (escolhidas.length < NUM_FALSAS) {
        for (const fase of fases) {
            for (const f of fase) {
                if (escolhidas.length >= NUM_FALSAS) break;
                if (!escolhidas.includes(f.texto)) escolhidas.push(f.texto);
            }
            if (escolhidas.length >= NUM_FALSAS) break;
        }
    }

    // 3) último recurso: músicas do próprio banco (de outros cantores)
    if (escolhidas.length < NUM_FALSAS) {
        console.warn('[desafioMusical] faltaram alternativas no falsas.json, completando com músicas do banco.');
        const extras = embaralhar(banco.filter(m => norm(m.artista) !== artistaCorreto))
            .map(m => `${m.titulo} — ${m.artista}`)
            .filter(t => !escolhidas.includes(t));
        escolhidas.push(...extras.slice(0, NUM_FALSAS - escolhidas.length));
    }

    // 4) pegadinhas misturadas, SEM entregar a resposta.
    //    Sorteia um tipo por rodada:
    //    - "titulo": uma opção usa o título CERTO com outra banda e, para equilibrar,
    //                outra opção repete o título de uma música ERRADA com outra banda.
    //    - "banda":  uma opção usa a banda CERTA com outro título e, para equilibrar,
    //                outra opção repete a banda de uma música ERRADA com outro título.
    //    Resultado: sempre aparecem 2 pares repetidos, e quem não ouviu a música não
    //    tem como saber em qual par está a certa. Só título E banda certos valem.
    if (MISTURAR && escolhidas.length >= 4) {
        const w0 = partir(escolhidas[0]);
        const w1 = partir(escolhidas[1]);
        const w2 = partir(escolhidas[2]);
        const tipo = Math.random() < 0.5 ? 'titulo' : 'banda';

        if (tipo === 'titulo') {
            escolhidas[0] = `${correta.titulo} — ${w0.artista}`; // título certo, banda errada
            escolhidas[1] = `${w2.titulo} — ${w1.artista}`;      // repete o título de uma errada
        } else {
            escolhidas[0] = `${w0.titulo} — ${correta.artista}`; // banda certa, título errado
            escolhidas[1] = `${w1.titulo} — ${w2.artista}`;      // repete a banda de uma errada
        }
    }

    const textos = embaralhar([textoCorreto, ...escolhidas]);

    return {
        musica: correta,
        opcoes: textos.map((t, i) => ({ letra: LETRAS[i], texto: t })),
        letraCorreta: LETRAS[textos.indexOf(textoCorreto)],
    };
}