// bot/codigos/handlers/command/desafioMusical/musicas.js
// Banco de músicas, pegadinhas e montagem das opções de cada rodada.

import fs from 'fs';
import path from 'path';
import {
    BANCO, BANCO_FALSAS, ARQUIVO_FALSAS, PASTA_TRECHOS,
    LETRAS, NUM_FALSAS, FALSAS_MESMO_CANTOR,
} from './config.js';
import { embaralhar } from './utils.js';

export function carregarBanco() {
    const lista = JSON.parse(fs.readFileSync(BANCO, 'utf8'));
    return lista.filter(m => fs.existsSync(path.join(PASTA_TRECHOS, m.arquivo)));
}

// Pegadinhas do MESMO cantor (lê a cada rodada: dá pra editar o JSON sem reiniciar)
function carregarFalsasMesmoArtista() {
    try {
        return JSON.parse(fs.readFileSync(BANCO_FALSAS, 'utf8'));
    } catch (e) {
        console.error('[desafioMusical] erro ao ler falsasMesmoArtista.json:', e.message);
        return {};
    }
}

// Pegadinhas de OUTROS cantores. Formato de cada item: "Título — Artista".
function carregarFalsas() {
    try {
        return JSON.parse(fs.readFileSync(ARQUIVO_FALSAS, 'utf8'));
    } catch (e) {
        console.error('[desafioMusical] erro ao ler falsas.json:', e.message);
        return [];
    }
}

function artistaDe(texto) {
    return texto.split(' — ').slice(1).join(' — ');
}

export function montarRodada(banco, usadas) {
    const disponiveis = banco.filter(m => !usadas.has(m.titulo));
    if (disponiveis.length === 0) return null;

    const correta = disponiveis[Math.floor(Math.random() * disponiveis.length)];
    const textoCorreto = `${correta.titulo} — ${correta.artista}`;
    const titulosBanco = new Set(banco.map(m => m.titulo));
    const textosUsados = new Set([textoCorreto]);
    const falsas = [];

    // 1) pegadinhas do MESMO cantor (nunca músicas que estão no banco)
    const falsasMesmoArtista = carregarFalsasMesmoArtista();
    const daMusica = embaralhar(correta.falsas || []);
    const doArtista = embaralhar(falsasMesmoArtista[correta.artista] || []);
    const doMesmo = [...daMusica, ...doArtista]
        .filter(t => !titulosBanco.has(t) && t !== correta.titulo);

    for (const t of doMesmo) {
        if (falsas.length >= FALSAS_MESMO_CANTOR) break;
        const texto = `${t} — ${correta.artista}`;
        if (textosUsados.has(texto)) continue;
        falsas.push(texto);
        textosUsados.add(texto);
    }

    if (falsas.length < FALSAS_MESMO_CANTOR) {
        console.warn(`[desafioMusical] "${correta.artista}" tem só ${falsas.length} pegadinha(s) em falsasMesmoArtista.json (precisa de ${FALSAS_MESMO_CANTOR}). Complete a lista!`);
    }

    // 2) completa com pegadinhas de OUTROS cantores (um cantor por pegadinha)
    const artistasUsados = new Set();
    const candidatas = embaralhar(carregarFalsas()).filter(
        f => artistaDe(f) !== correta.artista && !titulosBanco.has(f.split(' — ')[0])
    );
    for (const f of candidatas) {
        if (falsas.length >= NUM_FALSAS) break;
        const a = artistaDe(f);
        if (artistasUsados.has(a) || textosUsados.has(f)) continue;
        falsas.push(f);
        artistasUsados.add(a);
        textosUsados.add(f);
    }

    // segurança: se ainda faltar, completa com músicas do banco
    if (falsas.length < NUM_FALSAS) {
        const extras = embaralhar(banco.filter(m => m.titulo !== correta.titulo))
            .slice(0, NUM_FALSAS - falsas.length)
            .map(m => `${m.titulo} — ${m.artista}`);
        falsas.push(...extras);
    }

    const textos = embaralhar([textoCorreto, ...falsas]);

    return {
        musica: correta,
        opcoes: textos.map((t, i) => ({ letra: LETRAS[i], texto: t })),
        letraCorreta: LETRAS[textos.indexOf(textoCorreto)],
    };
}