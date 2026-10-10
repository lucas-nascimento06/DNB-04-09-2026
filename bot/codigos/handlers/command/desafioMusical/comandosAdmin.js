// bot/codigos/handlers/command/desafioMusical/comandosAdmin.js
// Comandos de ADM: #dmabrir, #dmfechar, #dm, #dp, #next, #add, #time, #pote, #limpartimes, #limparmusicas
//
// Retorno: null  -> não era um comando de ADM (o handler segue adiante)
//          true/false -> valor que o handler principal deve retornar

import { CONFIG } from './config.js';
import { jogos, inscricoes, pendentes } from './state.js';
import { ehAdmin, resolverAlvo, tag } from './utils.js';
import {
    getPote, definirPote, getTimeDoUsuario, salvarTime, membrosDoTime, limparTimes, limparUsadas,
} from './dados.js';
import {
    iniciarDesafio, proximaRodada, acabouTempo, pararDesafio, mostrarTimes,
} from './jogo.js';

export async function tratarComandoAdmin(sock, message, lower, from, ownerNumbers) {
    const negar = () =>
        sock.sendMessage(from, { text: '🚫 Apenas administradores podem usar este comando.' }, { quoted: message });
    const admin = () => ehAdmin(sock, from, message, ownerNumbers);

    // 1) ADM abre as inscrições
    if (lower === '#dmabrir') {
        if (!(await admin())) { await negar(); return true; }
        if (jogos.has(from)) {
            await sock.sendMessage(from, { text: '⚠️ Já existe um desafio musical rolando neste grupo!' }, { quoted: message });
            return true;
        }
        if (CONFIG.limparTimesAoAbrir) await limparTimes(from);
        inscricoes.set(from, Date.now());
        await sock.sendMessage(from, {
            text:
                '🎤🎶 *INSCRIÇÕES ABERTAS — DESAFIO MUSICAL*\n\n' +
                'Escolha o seu time:\n' +
                '👨🏻 Digite *#h* para entrar nos HOMENS\n' +
                '👩🏻 Digite *#m* para entrar nas MULHERES\n\n' +
                (CONFIG.minDCParaEntrar > 0 ? `🪙 É preciso ter pelo menos *${CONFIG.minDCParaEntrar} DCs* para participar.\n\n` : '') +
                '⏳ Quando os times estiverem prontos, o ADM inicia o desafio.',
        });
        return true;
    }

    // 2) ADM fecha as inscrições (sem iniciar)
    if (lower === '#dmfechar') {
        if (!(await admin())) { await negar(); return true; }
        if (!inscricoes.has(from)) {
            await sock.sendMessage(from, { text: 'ℹ️ As inscrições não estão abertas.' }, { quoted: message });
            return true;
        }
        inscricoes.delete(from);
        const [h, m] = await Promise.all([membrosDoTime(from, 'homens'), membrosDoTime(from, 'mulheres')]);
        await sock.sendMessage(from, {
            text:
                '🔒 *Inscrições encerradas!*\n\n' +
                `👨🏻 Homens: *${h.length}*\n👩🏻 Mulheres: *${m.length}*\n\n` +
                'ADM, use *#dm* para começar o desafio.',
        });
        return true;
    }

    // 3) ADM inicia o desafio (só se os dois times tiverem gente)
    const mStart = lower.match(/^#(?:dm|dmusical)(?:\s+(\d+))?$/);
    if (mStart) {
        if (!(await admin())) { await negar(); return true; }
        if (!jogos.has(from)) {
            const [h, m] = await Promise.all([membrosDoTime(from, 'homens'), membrosDoTime(from, 'mulheres')]);
            if (h.length < CONFIG.minPorTime || m.length < CONFIG.minPorTime) {
                await sock.sendMessage(from, {
                    text:
                        '⚠️ Os times ainda não estão prontos!\n\n' +
                        `👨🏻 Homens: *${h.length}*\n👩🏻 Mulheres: *${m.length}*\n\n` +
                        `Cada time precisa de pelo menos *${CONFIG.minPorTime}* participante${CONFIG.minPorTime > 1 ? 's' : ''}. ` +
                        (inscricoes.has(from)
                            ? 'Aguarde mais gente entrar com *#h* / *#m*.'
                            : 'Use *#dmabrir* para abrir as inscrições.'),
                }, { quoted: message });
                return true;
            }
        }
        await iniciarDesafio(sock, from, parseInt(mStart[1]) || CONFIG.rodadasPadrao);
        return true;
    }

    // 4) parar
    if (lower === '#dp' || lower === '#dmparar') {
        if (!(await admin())) { await negar(); return true; }
        await pararDesafio(sock, from);
        return true;
    }

    // 5) próxima música / pular
    if (lower === '#next' || lower === '#n' || lower === '#proxima') {
        const j = jogos.get(from);
        if (!j) return false;
        if (!(await admin())) { await negar(); return true; }
        if (j.aguardando) {
            clearTimeout(j.timer);
            j.aguardando = false;
            await proximaRodada(sock, from);
        } else if (j.rodada && !j.rodada.encerrada) {
            clearTimeout(j.timer);
            await acabouTempo(sock, from, true);
        } else {
            await sock.sendMessage(from, { text: '⏳ Aguarde, o desafio ainda não começou a próxima rodada.' }, { quoted: message });
        }
        return true;
    }

    // 6) ADM adiciona alguém num time (ignora inscrições fechadas e o saldo mínimo)
    if (/^#add(\s|$)/.test(lower)) {
        if (!(await admin())) { await negar(); return true; }

        const alvo = await resolverAlvo(sock, from, message);
        if (!alvo) {
            await sock.sendMessage(from, {
                text: '❓ Marque a pessoa que quer adicionar.\n\nExemplos:\n*#add @fulano* (usa o time que a pessoa tentou entrar)\n*#add @fulano h* (homens)\n*#add @fulano m* (mulheres)',
            }, { quoted: message });
            return true;
        }

        const pend = [...pendentes.values()].find(
            x => x.grupo === from && (x.userId === alvo.userId || x.jid === alvo.jid)
        );
        const token = lower.match(/\s(h|homens|m|mulheres)$/);
        const time = token
            ? (token[1] === 'h' || token[1] === 'homens' ? 'homens' : 'mulheres')
            : pend?.time;

        if (!time) {
            await sock.sendMessage(from, {
                text: `❓ Qual time? Use *#add ${tag(alvo.jid)} h* (homens) ou *#add ${tag(alvo.jid)} m* (mulheres).`,
                mentions: [alvo.jid],
            }, { quoted: message });
            return true;
        }

        const antes = await getTimeDoUsuario(from, alvo.userId);
        if (antes === time) {
            await sock.sendMessage(from, {
                text: `ℹ️ ${tag(alvo.jid)} já está no time *${time.toUpperCase()}*.`,
                mentions: [alvo.jid],
            }, { quoted: message });
            return true;
        }

        await salvarTime(from, alvo.userId, pend?.jid || alvo.jid, time);
        if (pend) pendentes.delete(`${from}:${pend.userId}`);

        const emoji = time === 'homens' ? '👨🏻' : '👩🏻';
        const acao = antes ? 'foi movido para o time' : 'foi adicionado ao time';
        await sock.sendMessage(from, {
            text: `${emoji} ${tag(alvo.jid)} ${acao} *${time.toUpperCase()}* por um ADM!`,
            mentions: [alvo.jid],
        }, { quoted: message });
        return true;
    }

    // 7) listar times
    if (lower === '#time' || lower === '#times') {
        if (!(await admin())) { await negar(); return true; }
        await mostrarTimes(sock, from, message);
        return true;
    }

    // 8) pote
    const mPote = lower.match(/^#pote(?:\s+(\d+))?$/);
    if (mPote) {
        if (!(await admin())) { await negar(); return true; }
        if (mPote[1] !== undefined) {
            await definirPote(parseInt(mPote[1]));
            await sock.sendMessage(from, { text: `🏦 Pote do desafio definido para *${parseInt(mPote[1]).toLocaleString('pt-BR')} DCs*.` }, { quoted: message });
        } else {
            const pote = await getPote();
            await sock.sendMessage(from, { text: `🏦 Pote do desafio: *${pote.toLocaleString('pt-BR')} DCs* restantes.` }, { quoted: message });
        }
        return true;
    }

    // 9) limpar times
    if (lower === '#limpartimes') {
        if (!(await admin())) { await negar(); return true; }
        await limparTimes(from);
        await sock.sendMessage(from, { text: '🧹 Os times Homens e Mulheres foram zerados neste grupo.' }, { quoted: message });
        return true;
    }

    // 10) zerar o histórico de músicas já tocadas (todas podem sair de novo)
    if (lower === '#limparmusicas') {
        if (!(await admin())) { await negar(); return true; }
        await limparUsadas(from);
        await sock.sendMessage(from, { text: '🧹 Histórico de músicas zerado. Todas podem tocar de novo.' }, { quoted: message });
        return true;
    }

    return null; // não é comando de ADM
}