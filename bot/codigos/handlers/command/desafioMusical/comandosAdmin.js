// bot/codigos/handlers/command/desafioMusical/comandosAdmin.js
// Comandos de ADM: #dmabrir, #dmfechar, #dm, #dp, #ok, #errou, #falta, #next, #add, #time, #pote, #limpartimes, #limparmusicas
//
// Retorno: null  -> não era um comando de ADM (o handler segue adiante)
//          true/false -> valor que o handler principal deve retornar

import { CONFIG } from './config.js';
import { jogos, inscricoes, pendentes } from './state.js';
import { ehAdmin, resolverAlvo, tag, blocoTimes, jidDe } from './utils.js';
import {
    getPote, definirPote, getTimeDoUsuario, salvarTime, membrosDoTime, limparTimes, limparUsadas,
} from './dados.js';
import {
    iniciarDesafio, proximaRodada, acabouTempo, pararDesafio, mostrarTimes, finalizar,
} from './jogo.js';
import { liberarPremio, rejeitarPremio } from './respostas.js';

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
        const { texto, mentions } = blocoTimes(h, m);
        await sock.sendMessage(from, {
            text:
                '🔒 *Inscrições encerradas!*\n\n' +
                'ADM, use *#dm* para começar o desafio.\n\n' +
                '👥 *TIMES FORMADOS*\n' +
                texto,
            mentions,
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

    // 4.5) ADM ouviu a música completa: libera os DCs
    // "#ok" = paga quem acertou | "#ok @fulano" = paga quem cantou melhor (do mesmo time)
    if (/^#ok(\s|$)/.test(lower)) {
        const j = jogos.get(from);
        if (!j) return false; // sem desafio rolando: deixa outros handlers tratarem o #ok
        if (!(await admin())) { await negar(); return true; }
        if (!j.premioPendente) {
            await sock.sendMessage(from, { text: 'ℹ️ Não há nenhum prêmio esperando liberação agora.' }, { quoted: message });
            return true;
        }

        // Quem cantou melhor pode ser indicado de 2 jeitos:
        //   - "#ok @fulano"                      (menção no texto)
        //   - "#ok" RESPONDENDO o áudio/mensagem de quem cantou
        // Só "#ok" (sem menção e sem responder ninguém) paga quem acertou.
        let cantor = null;
        const ctx = message.message?.extendedTextMessage?.contextInfo;
        const marcouNoTexto = /^#ok\s+\S/.test(lower);
        const respondeuAlguem = !!ctx?.participant || (ctx?.mentionedJid?.length || 0) > 0;

        if (marcouNoTexto || respondeuAlguem) {
            const limpar = v => String(v || '').split('@')[0].replace(/:\d+$/, '');
            const ehBot = jid => [sock.user?.id, sock.user?.lid].filter(Boolean).some(b => limpar(b) === limpar(jid));
            const timeVencedor = j.premioPendente.time;

            const alvo = await resolverAlvo(sock, from, message);
            console.log('[#ok] marcouNoTexto:', marcouNoTexto, '| respondeu:', ctx?.participant,
                '| mencionados:', ctx?.mentionedJid, '| alvo resolvido:', alvo);

            if (!alvo) {
                if (marcouNoTexto) {
                    await sock.sendMessage(from, {
                        text: '❓ Marque quem cantou. Exemplo: *#ok @fulano* (ou responda o áudio de quem cantou com *#ok*, ou só *#ok* para pagar quem acertou).',
                    }, { quoted: message });
                    return true;
                }
            } else if (!ehBot(alvo.jid)) {
                // a pessoa é do time vencedor? confere pelo número salvo OU pelo jid salvo
                const ids = new Set([limpar(alvo.userId), limpar(alvo.jid), limpar(ctx?.participant)].filter(Boolean));
                let noTime = (await getTimeDoUsuario(from, alvo.userId)) === timeVencedor;
                if (!noTime) {
                    const membros = await membrosDoTime(from, timeVencedor);
                    noTime = membros.some(m => ids.has(limpar(m.user_id)) || ids.has(limpar(m.jid)));
                }
                console.log('[#ok] alvo no time', timeVencedor, '?', noTime);

                if (noTime) {
                    cantor = alvo;
                } else {
                    // marcou/respondeu alguém que não é do time que pontuou
                    await sock.sendMessage(from, {
                        text: `🚫 ${tag(alvo.jid)} não está no time *${timeVencedor.toUpperCase()}*.`,
                        mentions: [alvo.jid],
                    }, { quoted: message });
                    return true;
                }
            }
            // respondeu uma mensagem do próprio bot: ignora e paga quem acertou
        }

        await liberarPremio(sock, message, from, j, cantor);
        return true;
    }

    // 4.6) ADM: a pessoa cantou errado -> sem DCs, ponto apagado e placar refeito
    if (lower === '#errou') {
        const j = jogos.get(from);
        if (!j) return false; // sem desafio rolando: deixa outros handlers tratarem
        if (!(await admin())) { await negar(); return true; }
        if (!j.premioPendente) {
            await sock.sendMessage(from, { text: 'ℹ️ Não há nenhum acerto esperando liberação agora.' }, { quoted: message });
            return true;
        }
        await rejeitarPremio(sock, message, from, j);
        return true;
    }

    // 4.7) ADM: quem da equipe ainda NÃO mandou áudio cantando (usar antes do #ok)
    if (lower === '#falta' || lower === '#faltam') {
        if (!(await admin())) { await negar(); return true; }
        const j = jogos.get(from);
        const p = j?.premioPendente;
        if (!p) {
            await sock.sendMessage(from, { text: 'ℹ️ Não há nenhuma equipe cantando agora.' }, { quoted: message });
            return true;
        }

        const membros = await membrosDoTime(from, p.time);
        const cantaram = p.cantaram || new Set();
        const faltam = membros.filter(m => !cantaram.has(m.user_id));
        const jaForam = membros.filter(m => cantaram.has(m.user_id));
        const nomeTime = p.time.toUpperCase();
        const emoji = p.time === 'homens' ? '👨🏻' : '👩🏻';
        const lista = arr => arr.map(m => tag(jidDe(m))).join(' ');

        let texto;
        if (faltam.length === 0) {
            texto =
                `🎤 *EQUIPE ${nomeTime}* ${emoji}\n\n` +
                `✅ Todos já cantaram (${jaForam.length}/${membros.length})! ADM, pode usar *#ok*.`;
        } else {
            texto =
                `🎤 *QUEM FALTA CANTAR — EQUIPE ${nomeTime}* ${emoji}\n\n` +
                `🔴 *Faltam (${faltam.length}):*\n${lista(faltam)}\n\n` +
                `✅ Já cantaram (${jaForam.length}/${membros.length}): ${jaForam.length ? lista(jaForam) : '_ninguém ainda_'}\n\n` +
                '📣 Mandem o áudio cantando!';
        }

        await sock.sendMessage(from, {
            text: texto,
            mentions: [...faltam, ...jaForam].map(jidDe),
        }, { quoted: message });
        return true;
    }

    // 5) próxima música / pular
    if (lower === '#next' || lower === '#n' || lower === '#proxima') {
        const j = jogos.get(from);
        if (!j) return false;
        if (!(await admin())) { await negar(); return true; }

        // com prêmio pendente, o ADM precisa decidir antes (nada de aviso automático depois)
        if (j.premioPendente) {
            await sock.sendMessage(from, {
                text: '⏳ Resolva o prêmio pendente com *#ok* (liberar) ou *#errou* (cancelar) antes de usar *#next*.',
            }, { quoted: message });
            return true;
        }

        if (j.finalizando) {
            // última rodada já resolvida: #next encerra o desafio
            clearTimeout(j.timer);
            await finalizar(sock, from, j);
        } else if (j.aguardando) {
            clearTimeout(j.timer);
            j.aguardando = false;
            await proximaRodada(sock, from, j);
        } else if (j.rodada && !j.rodada.encerrada) {
            clearTimeout(j.timer);
            await acabouTempo(sock, from, true, j);
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