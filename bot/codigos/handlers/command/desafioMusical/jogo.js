// bot/codigos/handlers/command/desafioMusical/jogo.js
// Fluxo do jogo: iniciar, tocar rodadas, tempo esgotado, finalizar, parar.

import fs from 'fs';
import path from 'path';
import { CONFIG, PASTA_TRECHOS } from './config.js';
import { jogos, inscricoes } from './state.js';
import { carregarBanco, montarRodada } from './musicas.js';
import { getPote, membrosDoTime } from './dados.js';
import { jidDe, tag } from './utils.js';

export async function iniciarDesafio(sock, groupId, rodadas) {
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

    inscricoes.delete(groupId); // começou: inscrições fechadas
    const [timeH, timeM] = await Promise.all([membrosDoTime(groupId, 'homens'), membrosDoTime(groupId, 'mulheres')]);

    jogos.set(groupId, {
        total,
        rodadaAtual: 0,
        placar: { homens: 0, mulheres: 0 },
        acertos: new Map(), // userId -> { jid, n }
        usadas: new Set(),
        rodada: null,
        timer: null,
        banco,
        aguardando: false,
        finalizando: false,
    });

    await sock.sendMessage(groupId, {
        text:
            '🎤🎶 *DESAFIO MUSICAL — HOMENS 🆚 MULHERES*\n\n' +
            'O bot toca um trecho de música e mostra as alternativas (A, B, C, D ou E).\n\n' +
            '⚡ Quem acertar primeiro faz o ponto para o seu time!\n' +
            `🪙 Prêmio de *${CONFIG.premioDC} DCs*: *${CONFIG.premioAcertadorDC}* para quem acertou e *${CONFIG.premioDC - CONFIG.premioAcertadorDC}* divididos entre o resto do time.\n` +
            (CONFIG.tempoRodadaMs > 0 ? `⏱️ Cada rodada dura *${CONFIG.tempoRodadaMs / 1000}s*.\n` : '') +
            `☝️ Cada pessoa tem *${CONFIG.tentativasPorRodada}* tentativa${CONFIG.tentativasPorRodada > 1 ? 's' : ''} por rodada.\n\n` +
            '👥 *TIMES FORMADOS*\n' +
            `👨🏻 Homens: *${timeH.length}*\n` +
            `👩🏻 Mulheres: *${timeM.length}*\n\n` +
            (CONFIG.entrarDuranteJogo
                ? '👇 *AINDA NÃO TEM TIME?* Digite *#h* (homens) ou *#m* (mulheres)\n\n'
                : '🔒 Inscrições encerradas. Quem não entrou num time pode torcer! 📣\n\n') +
            `🚀 Começando agora! (${total} rodadas)`,
    });

    await proximaRodada(sock, groupId);
}

export async function proximaRodada(sock, groupId) {
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
export async function acabouTempo(sock, groupId, manual = false) {
    const jogo = jogos.get(groupId);
    if (!jogo?.rodada || jogo.rodada.encerrada) return;
    jogo.rodada.encerrada = true;

    const { letraCorreta, musica } = jogo.rodada;
    await sock.sendMessage(groupId, {
        text: `${manual ? '⏭️ Rodada pulada pelo ADM.' : '⌛ Tempo esgotado!'} Ninguém acertou.\n✅ Era: *${letraCorreta}) ${musica.titulo}* — ${musica.artista}`,
    }).catch(() => {});

    jogo.timer = setTimeout(() => proximaRodada(sock, groupId), CONFIG.pausaMs);
}

export async function finalizar(sock, groupId) {
    const jogo = jogos.get(groupId);
    if (!jogo) return;
    clearTimeout(jogo.timer);
    jogos.delete(groupId); // evita finalizar duas vezes

    const { homens, mulheres } = jogo.placar;
    const mentions = [];

    // 🌟 MVP: quem mais acertou (até 3 em caso de empate)
    const ranking = [...jogo.acertos.values()].sort((a, b) => b.n - a.n);
    let textoMvp = '';
    if (ranking.length > 0) {
        const melhor = ranking[0].n;
        const mvps = ranking.filter(x => x.n === melhor).slice(0, 3);
        mvps.forEach(x => mentions.push(x.jid));
        textoMvp =
            `🌟 *MVP DA NOITE${mvps.length > 1 ? 'S' : ''}:* ${mvps.map(x => tag(x.jid)).join(', ')}\n` +
            `🎯 ${melhor} acerto${melhor > 1 ? 's' : ''} — ${mvps.length > 1 ? 'mandaram' : 'mandou'} muito bem! 👏\n\n`;
    }

    let titulo;
    let rodape = '';
    if (homens === mulheres) {
        titulo = '🤝 *EMPATE!* Ninguém ganhou, ninguém perdeu... só a música saiu vencedora! 🎶';
    } else {
        const vencedor = homens > mulheres ? 'homens' : 'mulheres';
        const emoji = vencedor === 'homens' ? '👨🏻' : '👩🏻';
        titulo = `${emoji} *O TIME ${vencedor.toUpperCase()} É O GRANDE CAMPEÃO!* 🏆👑`;

        try {
            const membros = (await membrosDoTime(groupId, vencedor)).slice(0, CONFIG.maxMencoes);
            if (membros.length > 0) {
                const jids = membros.map(jidDe);
                mentions.push(...jids);
                rodape = `🎉 *Parabéns, campeões!*\n${jids.map(tag).join(' ')}\n\n`;
            }
        } catch (e) {
            console.error('[desafioMusical] erro ao listar vencedores:', e.message);
        }
    }

    await sock.sendMessage(groupId, {
        text:
            '🎊🎉🎊🎉🎊🎉🎊🎉🎊🎉\n' +
            '🎤 *FIM DO DESAFIO MUSICAL* 🎤\n' +
            '🎊🎉🎊🎉🎊🎉🎊🎉🎊🎉\n\n' +
            '📊 *PLACAR FINAL*\n' +
            `👨🏻 Homens: *${homens}* ponto${homens !== 1 ? 's' : ''}\n` +
            `👩🏻 Mulheres: *${mulheres}* ponto${mulheres !== 1 ? 's' : ''}\n\n` +
            `${titulo}\n\n` +
            textoMvp +
            rodape +
            '🥳 Obrigado a todo mundo que participou! Que venha a próxima! 🔥🎶',
        mentions,
    }).catch(() => {});
}

export async function pararDesafio(sock, groupId) {
    const jogo = jogos.get(groupId);
    if (!jogo) {
        return sock.sendMessage(groupId, { text: 'ℹ️ Não há desafio musical em andamento.' });
    }
    clearTimeout(jogo.timer);
    if (jogo.rodada) jogo.rodada.encerrada = true;
    jogos.delete(groupId);
    await sock.sendMessage(groupId, { text: '🛑 Desafio musical encerrado por um ADM.' });
}

export async function mostrarTimes(sock, groupId, message) {
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