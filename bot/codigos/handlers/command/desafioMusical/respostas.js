// bot/codigos/handlers/command/desafioMusical/respostas.js
// Resposta A/B/C/D/E durante a rodada (atrasado, errou, acertou) e decisão do ADM (#ok / #rep / #errou).

import { CONFIG } from './config.js';
import { jogos } from './state.js';
import { jidDe, tag } from './utils.js';
import { getTimeDoUsuario, pagarPremios, membrosDoTime } from './dados.js';
import { zoeiraAtraso } from './zoeira.js';
import { finalizar, soltarPergunta, atualizarPlacarFixado } from './jogo.js';

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

// 🎤 Chame esta função para TODA mensagem do grupo (no handler principal, junto do tratarResposta).
// Enquanto a equipe está cantando (prêmio pendente), quem for do time e mandar um ÁUDIO conta como "já cantou".
// O ADM vê quem falta com #falta.
export function registrarAudioCantor(from, userId, message) {
    const p = jogos.get(from)?.premioPendente;
    if (!p || !userId) return false;

    let m = message?.message;
    for (let i = 0; i < 4 && m; i++) {
        const inner = m.ephemeralMessage?.message || m.viewOnceMessage?.message ||
            m.viewOnceMessageV2?.message || m.documentWithCaptionMessage?.message || null;
        if (!inner) break;
        m = inner;
    }
    if (!m?.audioMessage) return false;

    if (!p.cantaram) p.cantaram = new Set();
    p.cantaram.add(userId);
    return true;
}

// 🏆 acertou primeiro: faz o ponto na hora, mas os DCs só saem quando o ADM digitar #ok
// (se ninguém completar a música, o ADM digita #errou: sem DCs e o ponto é apagado)
// (se alguém do time não cantar, o ADM digita #rep: o ponto vai para o time adversário)
// Depois do acerto o bot NÃO manda mais nada sozinho: tudo segue pelos comandos do ADM.
async function registrarAcerto(sock, message, from, jid, userId, time, jogo, r) {
    if (r.encerrada) return; // outro já ganhou enquanto consultávamos o banco
    if (jogos.get(from) !== jogo) return; // o desafio foi encerrado enquanto isso
    r.encerrada = true;
    r.vencedor = { jid, userId, time };
    clearTimeout(jogo.timer);
    jogo.timer = null;
    soltarPergunta(sock, from, r); // tira a pergunta da fixação
    jogo.placar[time] += 1;

    // conta o acerto para o MVP
    const reg = jogo.acertos.get(userId) || { jid, n: 0 };
    reg.n += 1;
    jogo.acertos.set(userId, reg);

    // prêmio fica guardado até o ADM decidir com #ok (liberar), #rep (repassar) ou #errou (cancelar)
    jogo.premioPendente = { jid, userId, time, cantaram: new Set() }; // cantaram = quem já mandou áudio (#falta)

    // sem timers: o ADM resolve com #ok / #rep / #errou e depois usa #next
    if (jogo.rodadaAtual >= jogo.total) {
        jogo.finalizando = true; // última rodada: #ok/#rep/#errou resolve e mostra o resultado; #next também encerra
    } else {
        jogo.aguardando = true;
    }

    // marca TODOS os integrantes do time de quem acertou, para a equipe inteira cantar
    let jidsTime = [];
    try {
        jidsTime = (await membrosDoTime(from, time)).map(jidDe);
    } catch (e) {
        console.error('[desafioMusical] erro ao listar o time para a chamada:', e.message);
    }
    if (!jidsTime.includes(jid)) jidsTime.push(jid);

    const nomeTime = time.toUpperCase();
    const emojiTime = time === 'homens' ? '👨🏻' : '👩🏻';

    await sock.sendMessage(
        from,
        {
            text:
                `🏆 ${tag(jid)} acertou primeiro e marcou *1 PONTO* para o time *${nomeTime}*! ${emojiTime}\n` +
                `✅ *${r.letraCorreta}) ${r.musica.titulo}* — ${r.musica.artista}\n\n` +
                '━━━━━━━━━━━━━━━━━━━━\n' +
                `🎤🔥 *AGORA É A VEZ DO TIME ${nomeTime}!* 🔥🎤\n` +
                '🚨 *TODA A EQUIPE TEM QUE CANTAR A MÚSICA!* 🚨\n' +
                '━━━━━━━━━━━━━━━━━━━━\n\n' +
                `${emojiTime} *CANTEM, ${nomeTime}!* 👇\n` +
                `${jidsTime.map(tag).join(' ')}`,
            mentions: [...new Set(jidsTime)],
        },
        { quoted: message }
    );

    // 📊 placar atualizado, sozinho numa mensagem fixada (a pergunta e o placar antigo saem da fixação)
    if (jogos.get(from) === jogo) await atualizarPlacarFixado(sock, from, jogo);
}

// ✅ #ok do ADM: paga o prêmio pendente.
// cantor (opcional): quem cantou melhor leva os DCs; sem cantor, leva quem acertou.
// TODOS os outros integrantes da equipe levam o bônus de participação (liberado só aqui, no #ok).
export async function liberarPremio(sock, message, from, jogo, cantor = null) {
    const p = jogo.premioPendente;
    if (!p) return false;
    jogo.premioPendente = null; // evita pagar duas vezes

    const nomeTime = p.time.toUpperCase();
    const quem = cantor ? { jid: cantor.jid, userId: cantor.userId } : { jid: p.jid, userId: p.userId };

    // todos do time, exceto o melhor cantor
    let participantes = [];
    try {
        const membros = await membrosDoTime(from, p.time);
        participantes = membros.filter(m => String(m.user_id) !== String(quem.userId));
    } catch (e) {
        console.error('[desafioMusical] erro ao listar a equipe:', e.message);
    }

    let pagamento;
    try {
        pagamento = await pagarPremios(quem.userId, participantes.map(m => m.user_id));
    } catch (e) {
        console.error('[desafioMusical] erro ao pagar prêmio:', e.message);
        pagamento = { ok: false, motivo: 'erro' };
    }

    const mentions = [quem.jid, p.jid];
    let textoDC;
    if (pagamento.ok) {
        textoDC =
            `🥇 ${tag(quem.jid)} cantou, chegou mais perto de completar a música e teve a melhor interpretação: levou *${pagamento.premio} DCs*! 🪙`;

        if (pagamento.participantes.length > 0) {
            textoDC += `\n\nO restante da equipe, por ter tentado, levou *${pagamento.participantes[0].valor} DCs* cada um.`;
        } else if (pagamento.semParticipacao) {
            textoDC += '\n\n⚠️ O pote não tinha saldo para o bônus de participação do restante da equipe.';
        }
    } else if (pagamento.motivo === 'pote-vazio') {
        textoDC = '⚠️ O *pote de DCs não tem saldo suficiente*! Esta rodada vale só o ponto. ADM, use *#pote 6000* para recarregar.';
    } else {
        textoDC = '⚠️ Não consegui enviar os DCs desta rodada. Avise um ADM.';
    }

    await sock.sendMessage(
        from,
        {
            text:
                `✅ *Música cantada por toda a equipe ${nomeTime}!*\n` +
                `🏆 O ponto do time *${nomeTime}* foi mantido!\n\n` +
                textoDC,
            mentions: [...new Set(mentions)],
        },
        { quoted: message }
    );

    // última rodada: depois de liberar, mostra o resultado final
    if (jogo.finalizando && jogos.get(from) === jogo) {
        clearTimeout(jogo.timer);
        jogo.timer = setTimeout(() => finalizar(sock, from, jogo), 4000);
    }
    return true;
}

// 🔁 #rep do ADM: alguém do time não cantou -> o ponto vai para o time adversário (sem DCs).
export async function repassarPonto(sock, message, from, jogo) {
    const p = jogo.premioPendente;
    if (!p) return false;
    jogo.premioPendente = null; // evita pagar depois

    const outro = p.time === 'homens' ? 'mulheres' : 'homens';
    jogo.placar[p.time] = Math.max(0, (jogo.placar[p.time] || 0) - 1);
    jogo.placar[outro] += 1;

    // tira o acerto da contagem do MVP
    const reg = jogo.acertos.get(p.userId);
    if (reg) {
        reg.n -= 1;
        if (reg.n <= 0) jogo.acertos.delete(p.userId);
    }

    const emojiOutro = outro === 'homens' ? '👨🏻' : '👩🏻';
    await sock.sendMessage(
        from,
        {
            text:
                '🔁 *PONTO REPASSADO!*\n\n' +
                `❌ Uma ou mais pessoas da equipe *${p.time.toUpperCase()}* não cantou.\n` +
                `${emojiOutro} O ponto vai para a equipe *${outro.toUpperCase()}*!\n` +
                '🚫 Sem DCs nesta rodada.',
        },
        { quoted: message }
    );

    // placar novo, tira o antigo e fixa este
    if (jogos.get(from) === jogo) await atualizarPlacarFixado(sock, from, jogo);

    // última rodada: depois de resolver, mostra o resultado final
    if (jogo.finalizando && jogos.get(from) === jogo) {
        clearTimeout(jogo.timer);
        jogo.timer = setTimeout(() => finalizar(sock, from, jogo), 4000);
    }
    return true;
}

// ❌ #errou do ADM: ninguém completou a música direito.
// Sem DCs, o ponto que o time tinha feito é apagado e o placar é refeito (novo placar fixado).
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
    if (jogos.get(from) === jogo) await atualizarPlacarFixado(sock, from, jogo);

    // última rodada: depois de resolver, mostra o resultado final
    if (jogo.finalizando && jogos.get(from) === jogo) {
        clearTimeout(jogo.timer);
        jogo.timer = setTimeout(() => finalizar(sock, from, jogo), 4000);
    }
    return true;
}