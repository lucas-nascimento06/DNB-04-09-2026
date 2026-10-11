// bot/codigos/handlers/command/desafioMusical/jogo.js
// Fluxo do jogo: iniciar, tocar rodadas, tempo esgotado, finalizar, parar.

import fs from 'fs';
import path from 'path';
import { CONFIG, PASTA_TRECHOS } from './config.js';
import { jogos, inscricoes } from './state.js';
import { carregarBanco, montarRodada } from './musicas.js';
import { getPote, membrosDoTime, getUsadas, marcarUsada, limparUsadas } from './dados.js';
import { jidDe, tag, blocoTimes, fixarMensagem, desafixarMensagem } from './utils.js';

// desafixa a pergunta da rodada (só uma vez por rodada)
export function soltarPergunta(sock, groupId, rodada) {
    if (!rodada?.pergunta) return;
    const key = rodada.pergunta;
    rodada.pergunta = null;
    return desafixarMensagem(sock, groupId, key);
}

// 📊 Placar fixado: mensagem só com o placar. A cada acerto, tira o antigo e fixa o atualizado.
function textoPlacar(placar) {
    return (
        '📊 *PLACAR*\n' +
        `👨🏻 *HOMENS: ${placar.homens}*  ⚔️  *${placar.mulheres} :MULHERES* 👩🏻`
    );
}

export async function atualizarPlacarFixado(sock, groupId, jogo) {
    // só UMA mensagem fixada por vez: a pergunta sai antes de o placar entrar
    await soltarPergunta(sock, groupId, jogo.rodada);

    const antigo = jogo.placarKey;
    jogo.placarKey = null;
    if (antigo) await desafixarMensagem(sock, groupId, antigo);

    const msg = await sock.sendMessage(groupId, { text: textoPlacar(jogo.placar) }).catch(() => null);
    if (await fixarMensagem(sock, groupId, msg?.key)) jogo.placarKey = msg.key;
}

export function soltarPlacar(sock, groupId, jogo) {
    if (!jogo?.placarKey) return;
    const key = jogo.placarKey;
    jogo.placarKey = null;
    return desafixarMensagem(sock, groupId, key);
}

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

    // músicas que já saíram em desafios anteriores deste grupo
    let historico;
    try {
        historico = await getUsadas(groupId);
    } catch (e) {
        console.error('[desafioMusical] erro ao ler histórico de músicas:', e.message);
        historico = new Set();
    }

    let livres = banco.filter(m => !historico.has(m.id));
    let avisoReinicio = '';
    if (livres.length === 0) {
        await limparUsadas(groupId).catch(() => {});
        historico = new Set();
        livres = banco;
        avisoReinicio = '🔄 Todas as músicas já foram tocadas, o ciclo recomeçou!\n\n';
    }

    // não pede mais rodadas do que músicas inéditas disponíveis
    const total = Math.max(1, Math.min(rodadas, CONFIG.rodadasMax, livres.length));

    inscricoes.delete(groupId); // começou: inscrições fechadas
    const [timeH, timeM] = await Promise.all([membrosDoTime(groupId, 'homens'), membrosDoTime(groupId, 'mulheres')]);

    jogos.set(groupId, {
        total,
        rodadaAtual: 0,
        placar: { homens: 0, mulheres: 0 },
        acertos: new Map(), // userId -> { jid, n }
        usadas: new Set(historico), // começa com o histórico (ids das músicas)
        rodada: null,
        timer: null,
        banco,
        aguardando: false,
        finalizando: false,
        placarKey: null, // chave da mensagem do placar fixado
    });

    // lista dos times: 2 nomes + "..." e o resto atrás do "Ler mais" (vai por último na mensagem)
    const { texto: textoTimes, mentions } = blocoTimes(timeH, timeM);

    await sock.sendMessage(groupId, {
        text:
            '🎤🎶 *DESAFIO MUSICAL — HOMENS 🆚 MULHERES*\n\n' +
            'O bot toca um trecho de música e mostra as alternativas (A, B, C, D ou E).\n\n' +
            '⚡ Quem responder certo primeiro faz o ponto para o seu time!\n' +
            '🎤 Mas atenção: para ganhar os DCs, quem acertou precisa *completar a música cantando*. O ADM libera o prêmio com *#ok* quando ouvir a música completa.\n' +
            `🪙 Prêmio de *${CONFIG.premioDC} DCs*: *${CONFIG.premioAcertadorDC}* para quem acertou e *${CONFIG.premioDC - CONFIG.premioAcertadorDC}* divididos entre o resto do time.\n` +
            (CONFIG.tempoRodadaMs > 0 ? `⏱️ Cada rodada dura *${CONFIG.tempoRodadaMs / 1000}s*.\n` : '') +
            `☝️ Cada pessoa tem *${CONFIG.tentativasPorRodada}* tentativa${CONFIG.tentativasPorRodada > 1 ? 's' : ''} por rodada.\n\n` +
            (CONFIG.entrarDuranteJogo
                ? '👇 *AINDA NÃO TEM TIME?* Digite *#h* (homens) ou *#m* (mulheres)\n\n'
                : '🔒 Inscrições encerradas. Quem não entrou num time pode torcer! 📣\n\n') +
            avisoReinicio +
            `🚀 Começando agora! (${total} rodadas)\n\n` +
            '👥 *TIMES FORMADOS*\n' +
            textoTimes,
        mentions,
    });

    await proximaRodada(sock, groupId);
}

export async function proximaRodada(sock, groupId) {
    const jogo = jogos.get(groupId);
    if (!jogo) return;

    // se o ADM seguiu sem usar #ok, o prêmio da rodada anterior não é pago
    if (jogo.premioPendente) {
        const p = jogo.premioPendente;
        jogo.premioPendente = null;
        await sock.sendMessage(groupId, {
            text: `⚠️ Os DCs de ${tag(p.jid)} não foram liberados (o ADM não usou *#ok*).`,
            mentions: [p.jid],
        }).catch(() => {});
    }

    // garante que a pergunta da rodada anterior saiu da fixação antes de fixar a nova
    // (evita acumular fixados; o WhatsApp só aceita 3 ao mesmo tempo)
    await soltarPergunta(sock, groupId, jogo.rodada);

    if (jogo.rodadaAtual >= jogo.total) return finalizar(sock, groupId);

    const dados = montarRodada(jogo.banco, jogo.usadas);
    if (!dados) return finalizar(sock, groupId);

    jogo.rodadaAtual++;
    jogo.usadas.add(dados.musica.id);
    marcarUsada(groupId, dados.musica.id).catch(e =>
        console.error('[desafioMusical] erro ao salvar música usada:', e.message));
    jogo.rodada = { ...dados, tentaram: new Map(), avisados: new Set(), encerrada: false, pergunta: null };
    const rodada = jogo.rodada;

    try {
        const buffer = fs.readFileSync(path.join(PASTA_TRECHOS, dados.musica.arquivo));
        await sock.sendMessage(groupId, { text: `🎵 *Rodada ${jogo.rodadaAtual}/${jogo.total}* — escute o trecho:` });
        await sock.sendMessage(groupId, { audio: buffer, mimetype: 'audio/mpeg', ptt: false });
        const msgPergunta = await sock.sendMessage(groupId, {
            text:
                '❓ *Qual é a música?*\n\n' +
                dados.opcoes.map(o => `*${o.letra})* ${o.texto}`).join('\n') +
                (CONFIG.tempoRodadaMs > 0
                    ? `\n\n⏱️ ${CONFIG.tempoRodadaMs / 1000}s — responda só com a letra!`
                    : '\n\n✍️ Responda só com a letra! Vale até alguém acertar.'),
        });

        // só UMA mensagem fixada por vez: tira o placar antes de fixar a pergunta
        await soltarPlacar(sock, groupId, jogo);

        // fixa a pergunta; se alguém acertou enquanto fixava, desafixa na hora
        if (await fixarMensagem(sock, groupId, msgPergunta?.key)) {
            rodada.pergunta = msgPergunta.key;
            if (rodada.encerrada) soltarPergunta(sock, groupId, rodada);
        }
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
    soltarPergunta(sock, groupId, jogo.rodada);

    const { letraCorreta, musica } = jogo.rodada;
    await sock.sendMessage(groupId, {
        text:
            `${manual ? '⏭️ Rodada pulada pelo ADM.' : '⌛ Tempo esgotado!'} Ninguém acertou.\n` +
            `✅ Era: *${letraCorreta}) ${musica.titulo}* — ${musica.artista}`,
    }).catch(() => {});

    jogo.timer = setTimeout(() => proximaRodada(sock, groupId), CONFIG.pausaMs);
}

export async function finalizar(sock, groupId) {
    const jogo = jogos.get(groupId);
    if (!jogo) return;
    clearTimeout(jogo.timer);
    jogos.delete(groupId); // evita finalizar duas vezes
    soltarPlacar(sock, groupId, jogo); // tira o placar da fixação

    if (jogo.premioPendente) {
        const p = jogo.premioPendente;
        jogo.premioPendente = null;
        await sock.sendMessage(groupId, {
            text: `⚠️ Os DCs de ${tag(p.jid)} não foram liberados (o ADM não usou *#ok*).`,
            mentions: [p.jid],
        }).catch(() => {});
    }

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
    soltarPergunta(sock, groupId, jogo.rodada);
    soltarPlacar(sock, groupId, jogo);
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