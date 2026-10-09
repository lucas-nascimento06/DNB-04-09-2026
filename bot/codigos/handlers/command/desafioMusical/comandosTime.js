// bot/codigos/handlers/command/desafioMusical/comandosTime.js
// Participante escolhe o time: #h / #homens / #m / #mulheres

import { CONFIG } from './config.js';
import { jogos, inscricoes, pendentes } from './state.js';
import { tag } from './utils.js';
import { getSaldoDC, getTimeDoUsuario, salvarTime } from './dados.js';

export async function tratarEntradaTime(sock, message, lower, from, jid, userId) {
    const time = lower === '#h' || lower === '#homens' ? 'homens' : 'mulheres';
    const antes = await getTimeDoUsuario(from, userId);

    // só dá para entrar com as inscrições abertas (ou durante o jogo, se a config permitir)
    const podeEntrar = inscricoes.has(from) || (CONFIG.entrarDuranteJogo && jogos.has(from));
    if (!podeEntrar) {
        pendentes.set(`${from}:${userId}`, { grupo: from, jid, userId, time });
        await sock.sendMessage(
            from,
            {
                text:
                    `🔒 ${tag(jid)} não há inscrições abertas no momento para o *Desafio Musical*.\n\n` +
                    '🙋 Quer entrar mesmo assim? Peça para um ADM te adicionar com *#add* (seu pedido já ficou anotado).',
                mentions: [jid],
            },
            { quoted: message }
        );
        return true;
    }

    // saldo mínimo: só vale para quem ainda não está em nenhum time
    // (para exigir também na troca de time, remova o "!antes &&")
    if (!antes && CONFIG.minDCParaEntrar > 0) {
        const saldo = await getSaldoDC(userId);
        if (saldo < CONFIG.minDCParaEntrar) {
            await sock.sendMessage(
                from,
                {
                    text:
                        `🚫 ${tag(jid)} você não tem DCs suficientes para entrar na brincadeira!\n\n` +
                        `🪙 Mínimo necessário: *${CONFIG.minDCParaEntrar} DCs*\n` +
                        `💰 Seu saldo: *${saldo} DCs*\n\n` +
                        '💬 Continue conversando no grupo e acumulando DCs que logo você poderá participar! 😉',
                    mentions: [jid],
                },
                { quoted: message }
            );
            return true;
        }
    }

    await salvarTime(from, userId, jid, time);
    pendentes.delete(`${from}:${userId}`);

    const emoji = time === 'homens' ? '👨🏻' : '👩🏻';
    const acao = antes && antes !== time ? 'mudou para o time' : 'entrou no time';
    await sock.sendMessage(
        from,
        { text: `${emoji} ${tag(jid)} ${acao} *${time.toUpperCase()}*!`, mentions: [jid] },
        { quoted: message }
    );
    return true;
}