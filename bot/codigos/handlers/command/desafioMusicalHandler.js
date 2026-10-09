// bot/codigos/handlers/command/desafioMusicalHandler.js
// 🎤 DESAFIO MUSICAL — HOMENS 🆚 MULHERES
//
// Comandos:
//   #h  | #homens              -> entrar no time dos HOMENS (salvo no banco)
//   #m  | #mulheres            -> entrar no time das MULHERES (salvo no banco)
//   #dm | #dmusical [rodadas]  -> inicia o desafio (ADM)
//   #dp | #dmparar             -> encerra o desafio (ADM)
//   #next | #n | #proxima      -> próxima música (ADM)
//   #time | #times             -> mostra as listas dos dois times (ADM)
//   #pote [valor]              -> mostra / define o pote de DCs (ADM)
//   #limpartimes               -> apaga os times deste grupo (ADM)
// Respostas: apenas a letra A, B, C, D ou E.
//
// Quem acerta primeiro faz ponto para o time dele e o prêmio (100 DC) é repartido:
//   60 DC para quem acertou + 40 DC divididos igualmente entre o resto do time.
// O dinheiro sai de um "pote" (6000 DC). Se ninguém acertar, ninguém recebe nada.
// As mensagens da rodada (áudio e opções) NÃO são apagadas.
//
// Banco de músicas:        bot/data/musicasDesafio.json
// Pegadinhas mesmo cantor: bot/data/falsasMesmoArtista.json
// Pegadinhas outros cantor: bot/data/falsas.json
// Trechos (MP3):           bot/codigos/musicas-desafio/

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from '../../../../db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BANCO = path.join(__dirname, '../../../data/musicasDesafio.json');
const BANCO_FALSAS = path.join(__dirname, '../../../data/falsasMesmoArtista.json');
const ARQUIVO_FALSAS = path.join(__dirname, '../../../data/falsas.json');
const PASTA_TRECHOS = path.join(__dirname, '../../musicas-desafio');

// ⚠️ MODO TESTE: só o grupo de teste está ativo.
// Quando terminar os testes, descomente os grupos originais e comente/remova o GRUPO_TESTE.
// const GRUPO_PRINCIPAL = '120363412511975026@g.us';
// const GRUPO_ADMINS = '120363409228091157@g.us';
const GRUPO_TESTE = '120363431745836323@g.us';

// Grupos onde o desafio pode rodar
// const GRUPOS_PERMITIDOS = [GRUPO_PRINCIPAL, GRUPO_ADMINS];
const GRUPOS_PERMITIDOS = [GRUPO_TESTE];

const CONFIG = {
    premioDC: 100,          // DC por rodada
    premioAcertadorDC: 60,  // parte de quem acertou (o resto é dividido entre os outros do time)
    poteInicial: 6000,      // DC que o bot tem para distribuir (criado na 1ª vez)
    maxMencoes: 15,         // quantos membros listar na mensagem de vitória
    tempoRodadaMs: 60000,   // 1 minuto para responder. 0 = SEM LIMITE (vale até alguém acertar ou o ADM pular com #next)
    pausaMs: 6000,          // pausa quando ninguém acerta
    tentativasPorRodada: 5, // quantas respostas cada pessoa pode dar por rodada (1 = mais difícil)
    rodadasPadrao: 5,
    rodadasMax: 20,
    proximaManual: true,    // true = depois que alguém acerta, o ADM digita #next
    esperaMaxMs: 5 * 60 * 1000, // se o ADM esquecer, segue sozinho depois de 5 min
};

// Um jogo por grupo
const jogos = new Map();

console.log('[desafioMusical] v5 carregado (60 DC p/ quem acertou + 40 DC p/ o time, sem apagar mensagens, 1 min por rodada)');

// ---------- banco de dados ----------

let tabelasOk = false;

async function garantirTabelas() {
    if (tabelasOk) return;

    await pool.query(`
        CREATE TABLE IF NOT EXISTS damas_dm_times (
            grupo_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            jid TEXT,
            time TEXT NOT NULL,
            atualizado_em TIMESTAMPTZ DEFAULT NOW(),
            PRIMARY KEY (grupo_id, user_id)
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS damas_dm_pote (
            id INT PRIMARY KEY,
            saldo BIGINT NOT NULL DEFAULT 0,
            atualizado_em TIMESTAMPTZ DEFAULT NOW()
        )
    `);

    await pool.query(
        `INSERT INTO damas_dm_pote (id, saldo) VALUES (1, $1) ON CONFLICT (id) DO NOTHING`,
        [CONFIG.poteInicial]
    );

    tabelasOk = true;
}

async function getPote() {
    const { rows } = await pool.query(`SELECT saldo FROM damas_dm_pote WHERE id = 1`);
    return Number(rows[0]?.saldo || 0);
}

async function definirPote(valor) {
    await pool.query(
        `INSERT INTO damas_dm_pote (id, saldo) VALUES (1, $1)
         ON CONFLICT (id) DO UPDATE SET saldo = EXCLUDED.saldo, atualizado_em = NOW()`,
        [valor]
    );
}

async function getTimeDoUsuario(grupoId, userId) {
    const { rows } = await pool.query(
        `SELECT time FROM damas_dm_times WHERE grupo_id = $1 AND user_id = $2`,
        [grupoId, userId]
    );
    return rows[0]?.time || null;
}

async function salvarTime(grupoId, userId, jid, time) {
    await pool.query(
        `INSERT INTO damas_dm_times (grupo_id, user_id, jid, time)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (grupo_id, user_id)
         DO UPDATE SET jid = EXCLUDED.jid, time = EXCLUDED.time, atualizado_em = NOW()`,
        [grupoId, userId, jid, time]
    );
}

async function membrosDoTime(grupoId, time) {
    const { rows } = await pool.query(
        `SELECT user_id, jid FROM damas_dm_times
         WHERE grupo_id = $1 AND time = $2
         ORDER BY atualizado_em`,
        [grupoId, time]
    );
    return rows;
}

// Prêmio da rodada: parte maior para quem acertou, o resto dividido entre os OUTROS do time.
// Tira do pote e credita nas carteiras (damas_dc_wallets).
async function pagarPremio(grupoId, time, userIdVencedor, jidVencedor) {
    const membros = await membrosDoTime(grupoId, time);
    const outros = membros.filter(m => m.user_id !== userIdVencedor);

    const pote = await getPote();
    const premio = Math.min(CONFIG.premioDC, pote);
    if (premio <= 0) return { ok: false, motivo: 'pote-vazio' };

    // sem outros no time: quem acertou leva tudo
    let parteAcertador = outros.length === 0
        ? premio
        : Math.min(CONFIG.premioAcertadorDC, premio);
    const resto = premio - parteAcertador;

    let beneficiados = [];
    let porMembro = 0;
    let sorteio = false;

    if (resto > 0 && outros.length > 0) {
        beneficiados = outros;
        porMembro = Math.floor(resto / outros.length);
        // time grande: não dá 1 DC para cada um, então sorteia quem leva 1 DC
        if (porMembro < 1) {
            beneficiados = embaralhar(outros).slice(0, resto);
            porMembro = 1;
            sorteio = true;
        }
    }

    const totalTime = porMembro * beneficiados.length;
    const total = parteAcertador + totalTime; // o que sobrar fica no pote

    const baixa = await pool.query(
        `UPDATE damas_dm_pote SET saldo = saldo - $1, atualizado_em = NOW()
         WHERE id = 1 AND saldo >= $1 RETURNING saldo`,
        [total]
    );
    if (baixa.rowCount === 0) return { ok: false, motivo: 'pote-vazio' };

    const ids = [userIdVencedor, ...beneficiados.map(m => m.user_id)];
    const valores = [parteAcertador, ...beneficiados.map(() => porMembro)];

    try {
        await pool.query(
            `INSERT INTO damas_dc_wallets (user_id, saldo)
             SELECT t.u, t.a FROM unnest($1::text[], $2::bigint[]) AS t(u, a)
             ON CONFLICT (user_id)
             DO UPDATE SET saldo = damas_dc_wallets.saldo + EXCLUDED.saldo, atualizado_em = NOW()`,
            [ids, valores]
        );
    } catch (e) {
        console.error('[desafioMusical] erro ao creditar carteiras:', e.message);
        await pool.query(`UPDATE damas_dm_pote SET saldo = saldo + $1 WHERE id = 1`, [total]).catch(() => {});
        return { ok: false, motivo: 'erro' };
    }

    return {
        ok: true,
        premio,
        parteAcertador,
        beneficiados,
        porMembro,
        sorteio,
        totalOutros: outros.length,
        resto,
        sobra: premio - total,
        poteRestante: Number(baixa.rows[0].saldo),
    };
}

// ---------- utilitários ----------

function extractDigits(number) {
    if (!number) return null;
    return number.replace(/@.*$/, '').replace(/\D/g, '');
}

function getNumeroReal(message) {
    return message.key.participantAlt || message.key.participant || null;
}

function jidDe(membro) {
    return membro.jid || `${membro.user_id}@s.whatsapp.net`;
}

function tag(jid) {
    return `@${jid.split('@')[0]}`;
}

function embaralhar(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function carregarBanco() {
    const lista = JSON.parse(fs.readFileSync(BANCO, 'utf8'));
    return lista.filter(m => fs.existsSync(path.join(PASTA_TRECHOS, m.arquivo)));
}

// Pegadinhas do MESMO cantor, lidas de bot/data/falsasMesmoArtista.json
// (lê a cada rodada: dá pra editar o JSON sem reiniciar o bot)
function carregarFalsasMesmoArtista() {
    try {
        return JSON.parse(fs.readFileSync(BANCO_FALSAS, 'utf8'));
    } catch (e) {
        console.error('[desafioMusical] erro ao ler falsasMesmoArtista.json:', e.message);
        return {}; // sem o arquivo, o jogo segue só com pegadinhas de outros cantores
    }
}

async function ehAdmin(sock, groupId, message, owners) {
    if (message.key.fromMe) return true;
    const jid = message.key.participant;
    const alt = message.key.participantAlt;
    const digits = extractDigits(alt || jid);
    if (digits && owners.includes(digits)) return true;
    try {
        const meta = await sock.groupMetadata(groupId);
        return meta.participants.some(
            p => p.admin && (p.id === jid || p.id === alt || p.lid === jid || p.phoneNumber === alt)
        );
    } catch {
        return false;
    }
}

// Opções da rodada: A, B, C, D e E (1 certa + 4 pegadinhas)
const LETRAS = ['A', 'B', 'C', 'D', 'E'];
const NUM_FALSAS = LETRAS.length - 1;

// Quantas pegadinhas do MESMO cantor tentar colocar.
// NUM_FALSAS = TODAS as opções erradas são do mesmo cantor (só muda o título).
// Se o artista tiver menos pegadinhas no JSON do que isso, o resto vem de outros cantores.
// (use um número menor, ex.: 2, para misturar)
const FALSAS_MESMO_CANTOR = NUM_FALSAS;

// Pegadinhas de OUTROS cantores (músicas que NÃO estão na pasta), lidas de
// bot/data/falsas.json. Formato de cada item: "Título — Artista".
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

function montarRodada(banco, usadas) {
    const disponiveis = banco.filter(m => !usadas.has(m.titulo));
    if (disponiveis.length === 0) return null;

    const correta = disponiveis[Math.floor(Math.random() * disponiveis.length)];
    const textoCorreto = `${correta.titulo} — ${correta.artista}`;
    const titulosBanco = new Set(banco.map(m => m.titulo));
    const textosUsados = new Set([textoCorreto]);
    const falsas = [];

    // 1) pegadinhas do MESMO cantor (nunca músicas que estão no banco)
    // primeiro as pegadinhas DESSA música (nomes parecidos com o título certo),
    // depois as pegadinhas gerais do artista
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

    // aviso no terminal se o artista não tem pegadinhas suficientes no JSON
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

// ---------- zoeira para quem responde atrasado ----------

function zoeiraAtraso(fem) {
    const o = fem ? 'a' : 'o';
    const linhas = [
        `🦐 Camarão que dorme a onda leva! Acorda, ${fem ? 'dorminhoca' : 'dorminhoco'}! 😴🌊`,
        `🐢 Foi ${fem ? 'devagarzinha' : 'devagarzinho'}, né? A tartaruga passou voando por você!`,
        `😴 ${fem ? 'Dormiu' : 'Dormiu'} no ponto! Seja mais ${fem ? 'rápida' : 'rápido'} na próxima!`,
        `🐌 Chegou ${fem ? 'atrasada' : 'atrasado'}, hein? Até o caracol já tinha respondido!`,
        `⏰ O despertador tocou, mas ${o} ${fem ? 'dorminhoca' : 'dorminhoco'} não ouviu! Acelera aí!`,
        `🛌 Tava de soneca? A resposta já foi embora, ${fem ? 'preguiçosa' : 'preguiçoso'}!`,
        `🚶 Demorou demais! Na próxima corre mais, ${fem ? 'lerdinha' : 'lerdinho'}! 😆`,
        `🥱 Acordou agora? A rodada já acabou, ${fem ? 'Bela Adormecida' : 'Adormecido da Silva'}! 😂`,
    ];
    return linhas[Math.floor(Math.random() * linhas.length)];
}

// ---------- fluxo do jogo ----------

async function iniciarDesafio(sock, groupId, rodadas) {
    if (jogos.has(groupId)) {
        return sock.sendMessage(groupId, { text: '⚠️ Já existe um desafio musical rolando neste grupo!' });
    }

    let banco;
    try {
        banco = carregarBanco();
    } catch (e) {
        console.error('[desafioMusical] erro ao ler banco:', e.message);
        return sock.sendMessage(groupId, { text: '❌ Não consegui ler o banco de músicas (musicasDesafio.json).' });
    }

    if (banco.length < 2) {
        return sock.sendMessage(groupId, {
            text: '❌ O banco precisa de pelo menos 2 músicas com arquivo MP3 na pasta musicas-desafio.',
        });
    }

    const pote = await getPote();
    if (pote <= 0) {
        return sock.sendMessage(groupId, {
            text: '❌ O pote de DCs está vazio! ADM, use *#pote 6000* para recarregar.',
        });
    }

    const total = Math.max(1, Math.min(rodadas, CONFIG.rodadasMax, banco.length));

    jogos.set(groupId, {
        total,
        rodadaAtual: 0,
        placar: { homens: 0, mulheres: 0 },
        usadas: new Set(),
        rodada: null,
        timer: null,
        banco,
        aguardando: false,
    });

    await sock.sendMessage(groupId, {
        text:
            '🎤🎶 *DESAFIO MUSICAL — HOMENS 🆚 MULHERES*\n\n' +
            'O bot toca um trecho de música e mostra as alternativas (A, B, C, D ou E).\n\n' +
            '⚡ Quem acertar primeiro faz o ponto para o seu time!\n' +
            `🪙 Prêmio de *${CONFIG.premioDC} DCs*: *${CONFIG.premioAcertadorDC}* para quem acertou e *${CONFIG.premioDC - CONFIG.premioAcertadorDC}* divididos entre o resto do time.\n` +
            (CONFIG.tempoRodadaMs > 0 ? `⏱️ Cada rodada dura *${CONFIG.tempoRodadaMs / 1000}s*.\n` : '') +
            `☝️ Cada pessoa tem *${CONFIG.tentativasPorRodada}* tentativa${CONFIG.tentativasPorRodada > 1 ? 's' : ''} por rodada.\n\n` +
            '👇 *AINDA NÃO TEM TIME?*\n' +
            '👨🏻 Digite *#h* para entrar nos HOMENS\n' +
            '👩🏻 Digite *#m* para entrar nas MULHERES\n\n' +
            `🚀 Começando agora! (${total} rodadas)`,
    });

    // começa a 1ª rodada na hora, sem espera
    await proximaRodada(sock, groupId);
}

async function proximaRodada(sock, groupId) {
    const jogo = jogos.get(groupId);
    if (!jogo) return;

    if (jogo.rodadaAtual >= jogo.total) return finalizar(sock, groupId);

    const dados = montarRodada(jogo.banco, jogo.usadas);
    if (!dados) return finalizar(sock, groupId);

    jogo.rodadaAtual++;
    jogo.usadas.add(dados.musica.titulo);
    jogo.rodada = { ...dados, tentaram: new Map(), avisados: new Set(), encerrada: false };

    try {
        const buffer = fs.readFileSync(path.join(PASTA_TRECHOS, dados.musica.arquivo));
        await sock.sendMessage(groupId, { text: `🎵 *Rodada ${jogo.rodadaAtual}/${jogo.total}* — escute o trecho:` });
        await sock.sendMessage(groupId, { audio: buffer, mimetype: 'audio/mpeg', ptt: false });
        await sock.sendMessage(groupId, {
            text:
                '❓ *Qual é a música?*\n\n' +
                dados.opcoes.map(o => `*${o.letra})* ${o.texto}`).join('\n') +
                (CONFIG.tempoRodadaMs > 0
                    ? `\n\n⏱️ ${CONFIG.tempoRodadaMs / 1000}s — responda só com a letra!`
                    : '\n\n✍️ Responda só com a letra! Vale até alguém acertar.'),
        });
    } catch (e) {
        console.error('[desafioMusical] erro ao enviar rodada:', e.message);
        jogos.delete(groupId);
        return sock.sendMessage(groupId, { text: '❌ Erro ao enviar o áudio. Desafio cancelado.' }).catch(() => {});
    }

    // limite de tempo: se ninguém acertar, revela a resposta e segue (sem pagar nada)
    if (CONFIG.tempoRodadaMs > 0) {
        jogo.timer = setTimeout(() => acabouTempo(sock, groupId), CONFIG.tempoRodadaMs);
    }
}

// manual = true quando o ADM pulou a rodada com #next
async function acabouTempo(sock, groupId, manual = false) {
    const jogo = jogos.get(groupId);
    if (!jogo?.rodada || jogo.rodada.encerrada) return;
    jogo.rodada.encerrada = true;

    const { letraCorreta, musica } = jogo.rodada;
    await sock.sendMessage(groupId, {
        text: `${manual ? '⏭️ Rodada pulada pelo ADM.' : '⌛ Tempo esgotado!'} Ninguém acertou.\n✅ Era: *${letraCorreta}) ${musica.titulo}* — ${musica.artista}`,
    }).catch(() => {});

    jogo.timer = setTimeout(() => proximaRodada(sock, groupId), CONFIG.pausaMs);
}

async function finalizar(sock, groupId) {
    const jogo = jogos.get(groupId);
    if (!jogo) return;
    const { homens, mulheres } = jogo.placar;

    let resultado;
    if (homens > mulheres) resultado = '👨🏻 *HOMENS venceram!* 🏆';
    else if (mulheres > homens) resultado = '👩🏻 *MULHERES venceram!* 🏆';
    else resultado = '🤝 *EMPATE!*';

    await sock.sendMessage(groupId, {
        text:
            '🎶 *FIM DO DESAFIO MUSICAL* 🎶\n\n' +
            `👨🏻 Homens: *${homens}* pontos\n` +
            `👩🏻 Mulheres: *${mulheres}* pontos\n\n${resultado}`,
    }).catch(() => {});

    jogos.delete(groupId);
}

async function pararDesafio(sock, groupId) {
    const jogo = jogos.get(groupId);
    if (!jogo) {
        return sock.sendMessage(groupId, { text: 'ℹ️ Não há desafio musical em andamento.' });
    }
    clearTimeout(jogo.timer);
    if (jogo.rodada) jogo.rodada.encerrada = true;
    jogos.delete(groupId);
    await sock.sendMessage(groupId, { text: '🛑 Desafio musical encerrado por um ADM.' });
}

async function mostrarTimes(sock, groupId, message) {
    const [homens, mulheres] = await Promise.all([
        membrosDoTime(groupId, 'homens'),
        membrosDoTime(groupId, 'mulheres'),
    ]);

    const lista = arr => (arr.length ? arr.map(m => tag(jidDe(m))).join('\n') : '_ninguém ainda_');

    await sock.sendMessage(
        groupId,
        {
            text:
                '🎤 *TIMES DO DESAFIO MUSICAL*\n\n' +
                `👨🏻 *HOMENS* (${homens.length})\n${lista(homens)}\n\n` +
                `👩🏻 *MULHERES* (${mulheres.length})\n${lista(mulheres)}`,
            mentions: [...homens, ...mulheres].map(jidDe),
        },
        { quoted: message }
    );
}

// ---------- entrada única (chamada pelo messageHandler.js) ----------
// Retorna true se a mensagem foi consumida pelo desafio.

export async function handleDesafioMusical(sock, message, content, from, ownerNumbers = []) {
    if (!from.endsWith('@g.us') || !GRUPOS_PERMITIDOS.includes(from)) return false;

    const texto = (content || '').trim();
    const lower = texto.toLowerCase();

    // filtro rápido: só continua se for comando do desafio ou resposta A/B/C/D/E
    const ehComando = /^#(dm|dmusical|dp|dmparar|next|n|proxima|time|times|pote|limpartimes|h|homens|m|mulheres)(\s+\d+)?$/.test(lower);
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
    const negar = () =>
        sock.sendMessage(from, { text: '🚫 Apenas administradores podem usar este comando.' }, { quoted: message });

    // ---- comandos de ADM ----
    const mStart = lower.match(/^#(?:dm|dmusical)(?:\s+(\d+))?$/);
    if (mStart) {
        if (!(await ehAdmin(sock, from, message, ownerNumbers))) { await negar(); return true; }
        await iniciarDesafio(sock, from, parseInt(mStart[1]) || CONFIG.rodadasPadrao);
        return true;
    }

    if (lower === '#dp' || lower === '#dmparar') {
        if (!(await ehAdmin(sock, from, message, ownerNumbers))) { await negar(); return true; }
        await pararDesafio(sock, from);
        return true;
    }

    if (lower === '#next' || lower === '#n' || lower === '#proxima') {
        const j = jogos.get(from);
        if (!j) return false;
        if (!(await ehAdmin(sock, from, message, ownerNumbers))) { await negar(); return true; }
        if (j.aguardando) {
            clearTimeout(j.timer);
            j.aguardando = false;
            await proximaRodada(sock, from);
        } else if (j.rodada && !j.rodada.encerrada) {
            // pular a música que está tocando (revela a resposta)
            clearTimeout(j.timer);
            await acabouTempo(sock, from, true);
        } else {
            await sock.sendMessage(from, { text: '⏳ Aguarde, o desafio ainda não começou a próxima rodada.' }, { quoted: message });
        }
        return true;
    }

    if (lower === '#time' || lower === '#times') {
        if (!(await ehAdmin(sock, from, message, ownerNumbers))) { await negar(); return true; }
        await mostrarTimes(sock, from, message);
        return true;
    }

    const mPote = lower.match(/^#pote(?:\s+(\d+))?$/);
    if (mPote) {
        if (!(await ehAdmin(sock, from, message, ownerNumbers))) { await negar(); return true; }
        if (mPote[1] !== undefined) {
            await definirPote(parseInt(mPote[1]));
            await sock.sendMessage(from, { text: `🏦 Pote do desafio definido para *${parseInt(mPote[1]).toLocaleString('pt-BR')} DCs*.` }, { quoted: message });
        } else {
            const pote = await getPote();
            await sock.sendMessage(from, { text: `🏦 Pote do desafio: *${pote.toLocaleString('pt-BR')} DCs* restantes.` }, { quoted: message });
        }
        return true;
    }

    if (lower === '#limpartimes') {
        if (!(await ehAdmin(sock, from, message, ownerNumbers))) { await negar(); return true; }
        await pool.query(`DELETE FROM damas_dm_times WHERE grupo_id = $1`, [from]);
        await sock.sendMessage(from, { text: '🧹 Os times Homens e Mulheres foram zerados neste grupo.' }, { quoted: message });
        return true;
    }

    // ---- daqui pra baixo: ações de participantes ----
    if (message.key.fromMe) return false;

    const jid = message.key.participant;
    const userId = extractDigits(getNumeroReal(message));
    if (!jid || !userId) return false;

    // ---- escolher time (funciona a qualquer momento, fica salvo no banco) ----
    if (lower === '#h' || lower === '#homens' || lower === '#m' || lower === '#mulheres') {
        const time = lower === '#h' || lower === '#homens' ? 'homens' : 'mulheres';
        const antes = await getTimeDoUsuario(from, userId);
        await salvarTime(from, userId, jid, time);

        const emoji = time === 'homens' ? '👨🏻' : '👩🏻';
        const acao = antes && antes !== time ? 'mudou para o time' : 'entrou no time';
        await sock.sendMessage(
            from,
            { text: `${emoji} ${tag(jid)} ${acao} *${time.toUpperCase()}*!`, mentions: [jid] },
            { quoted: message }
        );
        return true;
    }

    // ---- resposta A/B/C/D/E ----
    const jogo = jogos.get(from);
    if (!jogo) return false;
    const r = jogo.rodada;
    if (!r || !/^[a-e]$/i.test(texto)) return false;

    // rodada já encerrada: se alguém já acertou, avisa quem respondeu atrasado (1 vez por pessoa)
    if (r.encerrada) {
        if (!r.vencedor || r.vencedor.userId === userId) return false;
        if (!r.atrasados) r.atrasados = new Set();
        if (r.atrasados.has(userId)) return false;
        r.atrasados.add(userId);

        const meuTime = await getTimeDoUsuario(from, userId);
        if (!meuTime) return false; // quem não tem time é ignorado
        const v = r.vencedor;
        const nomeVencedor = v.time.toUpperCase();
        const fem = meuTime === 'mulheres';
        const zoeira = zoeiraAtraso(fem);
        const textoAtraso = meuTime === v.time
            ? `${zoeira}\n\n${tag(jid)}, seu colega de time *${nomeVencedor}* (${tag(v.jid)}) já acertou essa antes de você! 😏`
            : `${zoeira}\n\n${tag(jid)}, o time *${nomeVencedor}* (${tag(v.jid)}) já levou essa rodada! 😏`;
        await sock.sendMessage(
            from,
            { text: textoAtraso, mentions: [jid, v.jid] },
            { quoted: message }
        );
        return true;
    }

    const time = await getTimeDoUsuario(from, userId);
    if (!time) {
        if (!r.avisados.has(userId)) {
            r.avisados.add(userId);
            await sock.sendMessage(
                from,
                { text: `${tag(jid)} você ainda não tem time! Digite *#h* (homens) ou *#m* (mulheres) e participe na próxima rodada.`, mentions: [jid] },
                { quoted: message }
            );
        }
        return true;
    }

    const letra = texto.toUpperCase();
    const jaTentou = r.tentaram.get(userId) || [];

    const avisar = async (textoAviso) => {
        if (r.encerrada) return;
        await sock.sendMessage(
            from,
            { text: textoAviso, mentions: [jid] },
            { quoted: message }
        );
    };

    if (jaTentou.length >= CONFIG.tentativasPorRodada) {
        // acabaram as tentativas: avisa (uma vez só, pra não encher o chat)
        if (!r.avisadosFim) r.avisadosFim = new Set();
        if (!r.avisadosFim.has(userId)) {
            r.avisadosFim.add(userId);
            await avisar(`🚫 ${tag(jid)} suas tentativas desta rodada já acabaram. Os outros ainda podem tentar!`);
        }
        return true;
    }
    if (jaTentou.includes(letra)) {
        // mesma letra errada de novo: avisa, mas não gasta tentativa
        await avisar(`🔁 ${tag(jid)} você já tentou a letra *${letra}* e ela está errada! Escolha outra. (não gastou tentativa)`);
        return true;
    }
    jaTentou.push(letra);
    r.tentaram.set(userId, jaTentou);

    if (letra !== r.letraCorreta) {
        // errou: avisa (sem revelar a resposta certa)
        if (r.encerrada) return true;
        const restam = CONFIG.tentativasPorRodada - jaTentou.length;
        const aviso = restam > 0
            ? `❌ ${tag(jid)} *errou!* Você ainda tem *${restam}* tentativa${restam > 1 ? 's' : ''}. 😬`
            : `❌ ${tag(jid)} *errou!* Suas tentativas desta rodada acabaram. 😬\nOs outros ainda podem tentar!`;
        await sock.sendMessage(
            from,
            { text: aviso, mentions: [jid] },
            { quoted: message }
        );
        return true;
    }

    // 🏆 acertou primeiro
    if (r.encerrada) return true; // outro já ganhou enquanto consultávamos o banco
    r.encerrada = true;
    r.vencedor = { jid, userId, time };
    clearTimeout(jogo.timer);
    jogo.placar[time] += 1;

    const emoji = time === 'homens' ? '👨🏻' : '👩🏻';
    const nomeTime = time.toUpperCase();

    let pagamento;
    try {
        pagamento = await pagarPremio(from, time, userId, jid);
    } catch (e) {
        console.error('[desafioMusical] erro ao pagar prêmio:', e.message);
        pagamento = { ok: false, motivo: 'erro' };
    }

    const mentions = [jid];
    let textoDC;
    if (pagamento.ok) {
        const p = pagamento;
        textoDC = `🪙 ${tag(jid)} você ganhou *${p.premio} DCs* pelo acerto!`;
        if (p.beneficiados.length === 0) {
            textoDC += `\n💰 Como você é o único do time, ficou com *${p.parteAcertador} DCs*.`;
        } else {
            const mostrados = p.beneficiados.slice(0, CONFIG.maxMencoes);
            mostrados.forEach(m => mentions.push(jidDe(m)));
            const resto = p.beneficiados.length - mostrados.length;
            const nomes = mostrados.map(m => tag(jidDe(m))).join(' ') + (resto > 0 ? ` e mais ${resto}` : '');
            textoDC += `\n💰 Você fica com *${p.parteAcertador} DCs* e os *${p.resto} DCs* restantes são divididos com a equipe *${nomeTime}*:`;
            textoDC += p.sorteio
                ? `\n🎲 Como o time é grande, foram sorteados *${p.beneficiados.length}* membros que ganharam *1 DC* cada:\n${nomes}`
                : `\n➡️ *${p.porMembro} DC* para cada um:\n${nomes}`;
        }
        if (p.sobra > 0) textoDC += `\n_(sobraram ${p.sobra} DC que ficam no pote)_`;
    } else if (pagamento.motivo === 'pote-vazio') {
        textoDC = '⚠️ O *pote de DCs acabou*! Esta rodada vale só o ponto. ADM, use *#pote 6000* para recarregar.';
    } else {
        textoDC = '⚠️ Não consegui enviar os DCs desta rodada. Avise um ADM.';
    }

    await sock.sendMessage(
        from,
        {
            text:
                `🏆 ${tag(jid)} acertou primeiro!\n` +
                `✅ *${r.letraCorreta}) ${r.musica.titulo}* — ${r.musica.artista}\n\n` +
                `${emoji} +1 ponto para o time *${nomeTime}*\n\n` +
                `${textoDC}\n\n` +
                `🎤 *Desafio de ${tag(jid)}:* agora cante um trecho da música!\n` +
                '_(Só de brincadeira — a galera e os ADMs decidem se cumpriu 😄)_\n\n' +
                '━━━━━━━━━━━━━━━━━━\n' +
                '📊 *PLACAR*\n' +
                `👨🏻 *HOMENS: ${jogo.placar.homens}*  ⚔️  *${jogo.placar.mulheres} :MULHERES* 👩🏻\n` +
                '━━━━━━━━━━━━━━━━━━',
            mentions,
        },
        { quoted: message }
    );

    if (CONFIG.proximaManual) {
        jogo.aguardando = true;
        const ultima = jogo.rodadaAtual >= jogo.total;
        await sock.sendMessage(from, {
            text: ultima
                ? '⏸️ *ADM:* quando o desafio de cantar terminar, digite *#next* (ou *#n*) para ver o resultado final.'
                : '⏸️ *ADM:* quando o desafio de cantar terminar, digite *#next* (ou *#n*) para tocar a próxima música.',
        });
        jogo.timer = setTimeout(() => {
            jogo.aguardando = false;
            proximaRodada(sock, from);
        }, CONFIG.esperaMaxMs);
    } else {
        jogo.timer = setTimeout(() => proximaRodada(sock, from), CONFIG.pausaMs + 4000);
    }
    return true;
}