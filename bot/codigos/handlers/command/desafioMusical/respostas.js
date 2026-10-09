// bot/codigos/handlers/command/desafioMusical/respostas.js
// Resposta A/B/C/D/E durante a rodada (atrasado, errou, acertou e prêmio).

import { CONFIG } from './config.js';
import { jogos } from './state.js';
import { jidDe, tag } from './utils.js';
import { getTimeDoUsuario, pagarPremio } from './dados.js';
import { zoeiraAtraso } from './zoeira.js';
import { proximaRodada, finalizar } from './jogo.js';

export async function tratarResposta(sock, message, texto, from, jid, userId) {
    const jogo = jogos.get(from);
    if (!jogo) return false;
    const r = jogo.rodada;
    if (!r || !/^[a-e]$/i.test(texto)) return false;

    // rodada já encerrada: se alguém já acertou, avisa quem respondeu atrasado (1 vez por pessoa)
    if (r.encerrada) return avisarAtrasado(sock, message, from, jid, userId, r);

    const time = await getTimeDoUsuario(from, userId);
    if (!time) {
        if (!r.avisados.has(userId)) {
            r.avisados.add(userId);
            const dica = CONFIG.minDCParaEntrar > 0 ? ` (é preciso ter ${CONFIG.minDCParaEntrar} DCs)` : '';
            await sock.sendMessage(
                from,
                { text: CONFIG.entrarDuranteJogo
                    ? `${tag(jid)} você ainda não tem time! Digite *#h* (homens) ou *#m* (mulheres)${dica} e participe na próxima rodada.`
                    : `${tag(jid)} você não está em nenhum time e as inscrições já fecharam. Na próxima você participa! 😉`, mentions: [jid] },
                { quoted: message }
            );
        }
        return true;
    }

    const letra = texto.toUpperCase();
    const jaTentou = r.tentaram.get(userId) || [];

    const avisar = async (textoAviso) => {
        if (r.encerrada) return;
        await sock.sendMessage(from, { text: textoAviso, mentions: [jid] }, { quoted: message });
    };

    if (jaTentou.length >= CONFIG.tentativasPorRodada) {
        if (!r.avisadosFim) r.avisadosFim = new Set();
        if (!r.avisadosFim.has(userId)) {
            r.avisadosFim.add(userId);
            await avisar(`🚫 ${tag(jid)} suas tentativas desta rodada já acabaram. Os outros ainda podem tentar!`);
        }
        return true;
    }
    if (jaTentou.includes(letra)) {
        await avisar(`🔁 ${tag(jid)} você já tentou a letra *${letra}* e ela está errada! Escolha outra. (não gastou tentativa)`);
        return true;
    }
    jaTentou.push(letra);
    r.tentaram.set(userId, jaTentou);

    if (letra !== r.letraCorreta) {
        if (r.encerrada) return true;
        const restam = CONFIG.tentativasPorRodada - jaTentou.length;
        const aviso = restam > 0
            ? `❌ ${tag(jid)} *errou!* Você ainda tem *${restam}* tentativa${restam > 1 ? 's' : ''}. 😬`
            : `❌ ${tag(jid)} *errou!* Suas tentativas desta rodada acabaram. 😬\nOs outros ainda podem tentar!`;
        await sock.sendMessage(from, { text: aviso, mentions: [jid] }, { quoted: message });
        return true;
    }

    await registrarAcerto(sock, message, from, jid, userId, time, jogo, r);
    return true;
}

async function avisarAtrasado(sock, message, from, jid, userId, r) {
    if (!r.vencedor || r.vencedor.userId === userId) return false;
    if (!r.atrasados) r.atrasados = new Set();
    if (r.atrasados.has(userId)) return false;
    r.atrasados.add(userId);

    const meuTime = await getTimeDoUsuario(from, userId);
    if (!meuTime) return false; // quem não tem time é ignorado
    const v = r.vencedor;
    const nomeVencedor = v.time.toUpperCase();
    const zoeira = zoeiraAtraso(meuTime === 'mulheres');
    const textoAtraso = meuTime === v.time
        ? `${zoeira}\n\n${tag(jid)}, seu colega de time *${nomeVencedor}* (${tag(v.jid)}) já acertou essa antes de você! 😏`
        : `${zoeira}\n\n${tag(jid)}, o time *${nomeVencedor}* (${tag(v.jid)}) já levou essa rodada! 😏`;
    await sock.sendMessage(from, { text: textoAtraso, mentions: [jid, v.jid] }, { quoted: message });
    return true;
}

// 🏆 acertou primeiro
async function registrarAcerto(sock, message, from, jid, userId, time, jogo, r) {
    if (r.encerrada) return; // outro já ganhou enquanto consultávamos o banco
    r.encerrada = true;
    r.vencedor = { jid, userId, time };
    clearTimeout(jogo.timer);
    jogo.placar[time] += 1;

    // conta o acerto para o MVP
    const reg = jogo.acertos.get(userId) || { jid, n: 0 };
    reg.n += 1;
    jogo.acertos.set(userId, reg);

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
            // sem listar nomes (time grande deixaria a mensagem enorme)
            textoDC += `\n💰 Você fica com *${p.parteAcertador} DCs* e os *${p.resto} DCs* restantes são divididos com a equipe *${nomeTime}*.`;
            if (p.sorteio) {
                textoDC += `\n🎲 Como o time é grande, *${p.beneficiados.length}* membros foram sorteados e ganharam *1 DC* cada.`;
            }
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

    const ultima = jogo.rodadaAtual >= jogo.total;

    if (ultima) {
        // última rodada: o resultado sai sozinho, sem precisar do ADM
        jogo.finalizando = true;
        const delay = CONFIG.delayFinalMs ?? 15000;
        await sock.sendMessage(from, {
            text: `🏁 *Foi a última rodada!* Cante à vontade, o resultado final sai em ${Math.round(delay / 1000)}s... 🥁`,
        });
        jogo.timer = setTimeout(() => finalizar(sock, from), delay);
    } else if (CONFIG.proximaManual) {
        jogo.aguardando = true;
        await sock.sendMessage(from, {
            text: '⏸️ *ADM:* quando o desafio de cantar terminar, digite *#next* (ou *#n*) para tocar a próxima música.',
        });
        jogo.timer = setTimeout(() => {
            jogo.aguardando = false;
            proximaRodada(sock, from);
        }, CONFIG.esperaMaxMs);
    } else {
        jogo.timer = setTimeout(() => proximaRodada(sock, from), CONFIG.pausaMs + 4000);
    }
}