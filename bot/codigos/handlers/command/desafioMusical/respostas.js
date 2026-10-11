// bot/codigos/handlers/command/desafioMusical/respostas.js
// Resposta A/B/C/D/E durante a rodada (atrasado, errou, acertou) e liberação do prêmio (#ok / #errou).

import { CONFIG } from './config.js';
import { jogos } from './state.js';
import { jidDe, tag } from './utils.js';
import { getTimeDoUsuario, pagarPremio } from './dados.js';
import { zoeiraAtraso } from './zoeira.js';
import { proximaRodada, finalizar, soltarPergunta, atualizarPlacarFixado } from './jogo.js';

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

// 🏆 acertou primeiro: faz o ponto na hora, mas os DCs só saem quando o ADM digitar #ok
// (se a pessoa cantar errado, o ADM digita #errou: sem DCs e o ponto é apagado)
async function registrarAcerto(sock, message, from, jid, userId, time, jogo, r) {
    if (r.encerrada) return; // outro já ganhou enquanto consultávamos o banco
    r.encerrada = true;
    r.vencedor = { jid, userId, time };
    clearTimeout(jogo.timer);
    soltarPergunta(sock, from, r); // tira a pergunta da fixação
    jogo.placar[time] += 1;

    // conta o acerto para o MVP
    const reg = jogo.acertos.get(userId) || { jid, n: 0 };
    reg.n += 1;
    jogo.acertos.set(userId, reg);

    // prêmio fica guardado até o ADM liberar com #ok (ou cancelar com #errou)
    jogo.premioPendente = { jid, userId, time };

    await sock.sendMessage(
        from,
        {
            text:
                `🏆 ${tag(jid)} acertou primeiro!\n\n` +
                `✅ *${r.letraCorreta}) ${r.musica.titulo}* — ${r.musica.artista}\n\n` +
                `━━━━━━━━━━━━━━━━━━━━\n` +
                `🎤 *${tag(jid)}, AGORA COMPLETE A MÚSICA CANTANDO!*\n\n` +
                `🪙 *SE COMPLETAR:* *${CONFIG.premioDC} DCs liberados* e o *ponto da equipe ${time.toUpperCase()} é mantido* ✅\n\n` +
                `⚠️ *SE NÃO COMPLETAR:* *sem DCs* e o *ponto é cancelado* ❌\n` +
                `━━━━━━━━━━━━━━━━━━━━\n\n` +
                `_🔢 Música nº ${r.musica.id}_`,
            mentions: [jid],
        },
        { quoted: message }
    );

    // 📊 placar atualizado, sozinho numa mensagem fixada (a pergunta e o placar antigo saem da fixação)
    await atualizarPlacarFixado(sock, from, jogo);

    const ultima = jogo.rodadaAtual >= jogo.total;

    if (ultima) {
        // última rodada: o #ok (ou #errou) do ADM resolve o prêmio e já encerra o desafio
        jogo.finalizando = true;
        jogo.timer = setTimeout(() => finalizar(sock, from), CONFIG.esperaMaxMs);
    } else {
        // o ADM resolve com #ok / #errou e depois usa #next (sem aviso no grupo: só o ADM precisa saber)
        jogo.aguardando = true;
        jogo.timer = setTimeout(() => {
            jogo.aguardando = false;
            proximaRodada(sock, from);
        }, CONFIG.esperaMaxMs);
    }
}

// ✅ #ok do ADM: paga o prêmio pendente (60 para quem acertou, resto dividido com o time)
export async function liberarPremio(sock, message, from, jogo) {
    const p = jogo.premioPendente;
    if (!p) return false;
    jogo.premioPendente = null; // evita pagar duas vezes

    const nomeTime = p.time.toUpperCase();

    let pagamento;
    try {
        pagamento = await pagarPremio(from, p.time, p.userId, p.jid);
    } catch (e) {
        console.error('[desafioMusical] erro ao pagar prêmio:', e.message);
        pagamento = { ok: false, motivo: 'erro' };
    }

    let textoDC;
    if (pagamento.ok) {
        const g = pagamento;
        textoDC = `🪙 ${tag(p.jid)} você ganhou *${g.premio} DCs*!`;
        if (g.beneficiados.length === 0) {
            textoDC += `\n💰 Como você é o único do time, ficou com *${g.parteAcertador} DCs*.`;
        } else {
            // sem listar nomes (time grande deixaria a mensagem enorme)
            textoDC += `\n💰 Você fica com *${g.parteAcertador} DCs* e os *${g.resto} DCs* restantes são divididos com a equipe *${nomeTime}*.`;
            if (g.sorteio) {
                textoDC += `\n🎲 Como o time é grande, *${g.beneficiados.length}* membros foram sorteados e ganharam *1 DC* cada.`;
            }
        }
        if (g.sobra > 0) textoDC += `\n_(sobraram ${g.sobra} DC que ficam no pote)_`;
    } else if (pagamento.motivo === 'pote-vazio') {
        textoDC = '⚠️ O *pote de DCs acabou*! Esta rodada vale só o ponto. ADM, use *#pote 6000* para recarregar.';
    } else {
        textoDC = '⚠️ Não consegui enviar os DCs desta rodada. Avise um ADM.';
    }

    await sock.sendMessage(
        from,
        { text: `✅ *Música completada! DCs liberados pelo ADM.*\n🏆 O ponto do time *${nomeTime}* foi mantido!\n\n${textoDC}`, mentions: [p.jid] },
        { quoted: message }
    );

    // última rodada: depois de liberar, mostra o resultado final
    if (jogo.finalizando) {
        clearTimeout(jogo.timer);
        jogo.timer = setTimeout(() => finalizar(sock, from), 4000);
    }
    return true;
}

// ❌ #errou do ADM: a pessoa não completou a música direito.
// Sem DCs, o ponto que ela tinha feito é apagado e o placar é refeito (novo placar fixado).
export async function rejeitarPremio(sock, message, from, jogo) {
    const p = jogo.premioPendente;
    if (!p) return false;
    jogo.premioPendente = null; // evita pagar depois

    // tira o ponto que o time tinha ganhado nesta rodada
    jogo.placar[p.time] = Math.max(0, (jogo.placar[p.time] || 0) - 1);

    // tira o acerto da contagem do MVP
    const reg = jogo.acertos.get(p.userId);
    if (reg) {
        reg.n -= 1;
        if (reg.n <= 0) jogo.acertos.delete(p.userId);
    }

    await sock.sendMessage(
        from,
        {
            text:
                `❌ ${tag(p.jid)} não completou a música direito.\n` +
                '🚫 Sem DCs e o ponto desta rodada foi cancelado.',
            mentions: [p.jid],
        },
        { quoted: message }
    );

    // placar novo (já sem o ponto), tira o antigo e fixa este
    await atualizarPlacarFixado(sock, from, jogo);

    // última rodada: depois de resolver, mostra o resultado final
    if (jogo.finalizando) {
        clearTimeout(jogo.timer);
        jogo.timer = setTimeout(() => finalizar(sock, from), 4000);
    }
    return true;
}