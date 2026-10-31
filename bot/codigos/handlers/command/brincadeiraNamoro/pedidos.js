// bot/codigos/handlers/command/brincadeiraNamoro/pedidos.js
// #pedido | #np -> pedido de namoro | #aceito | #na -> aceita e forma o casal

import { extractDigits, lerMensagem } from './utils.js';
import { GRUPO_MODERACAO } from './config.js';
import { baixarMidia, montarMidia } from './desafio.js';
import {
    buscarParticipante, buscarParticipantePorJidOuId, emCasal,
    limparPedidosExpirados, criarPedido, pedidosRecebidos, removerPedido, formarCasal,
} from './dados.js';
import { atualizarListaFixada } from './listas.js';

// texto do @ tem que ser igual à parte antes do "@" do jid, senão não vira menção
const tag = (jid, userId) => `@${jid ? jid.split('@')[0] : userId}`;

// ===================== DECORAÇÃO DO PEDIDO =====================
const CABECALHO =
`╭━━━ঌ🌹໒━━━╮
💑 *DAMAS DA NIGHT* 💑
♡ _o coração pediu, o amor chegou_ ♡
╰━━━ঌ🍃໒━━━╯`;

const LINHA = '────۶ৎ────≽^• ˕ • ྀི≼⋆ ˚｡⋆୨♡୧⋆ ˚｡⋆';

const RODAPE = '🌹 𝓞 𝓪𝓶𝓸𝓻 𝓮𝓼𝓽𝓪́ 𝓷𝓸 𝓪𝓻 🌹';

// texto da declaração sem o comando e sem as marcações (@), para saber se tem texto de verdade
const declaracaoSemComando = (texto) =>
    String(texto || '')
        .replace(/(^|\s)#(pedido|np)(?=\s|$)/gi, ' ')
        .replace(/@\d+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

export async function tratarPedido(sock, message, from, jid, userId, texto, ctx) {
    const reply = (t, mentions = []) => sock.sendMessage(from, { text: t, mentions }, { quoted: message });

    // ---------- FOTO/VÍDEO + TEXTO OBRIGATÓRIOS ----------
    const { img } = lerMensagem(message);

    if (!img) {
        return reply(
            `🚫 *PEDIDO NÃO REALIZADO!* 🚫\n\n` +
            `⚠️ É *OBRIGATÓRIO* enviar uma *foto ou vídeo* junto com a sua declaração. Pedidos apenas com texto *não são aceitos*.\n\n` +
            `📸 Envie a *foto ou vídeo*, escreva sua declaração na descrição, marque a pessoa com *@* e termine com *#pedido*.`
        );
    }

    if (!declaracaoSemComando(texto)) {
        return reply(
            `🚫 *PEDIDO NÃO REALIZADO!* 🚫\n\n` +
            `⚠️ Você enviou a mídia, mas faltou o *texto da declaração*.\n\n` +
            `✍️ Escreva sua declaração na descrição da foto/vídeo, marque a pessoa com *@* e termine com *#pedido*.`
        );
    }

    await limparPedidosExpirados(from);

    const eu = await buscarParticipante(from, userId);
    if (!eu) return reply('📸 Você ainda não está inscrito(a). Envie sua foto com os dados e *#entrar* primeiro.');
    if (await emCasal(from, userId)) return reply('💑 Você já faz parte de um casal da brincadeira!');

    const marcados = (ctx.mentionedJid || []).filter((j) => j !== jid && extractDigits(j) !== userId);
    if (!marcados.length) return reply('✍️ Marque a pessoa com *@* na sua declaração e termine com *#pedido*.');
    if (marcados.length > 1) return reply('⚠️ Marque apenas *uma* pessoa por pedido.');

    const alvoJid = marcados[0];
    const alvo = await buscarParticipantePorJidOuId(from, alvoJid, extractDigits(alvoJid));
    if (!alvo) return reply('⚠️ Essa pessoa não está participando da brincadeira.', [alvoJid]);
    if (await emCasal(from, alvo.userId)) return reply(`💔 *${alvo.nome}* já está em um casal da brincadeira.`);

    await criarPedido(from, userId, alvo.userId, texto);

    const alvoMarca = alvo.jid || alvoJid;
    const pronome = eu.sexo === 'mulher' ? 'ELA' : 'ELE';

    const resposta = await reply(
        `${CABECALHO}\n` +
        `${LINHA}\n\n` +
        `💌 *UM CORAÇÃO ESTÁ SE DECLARANDO!* 💌\n\n` +
        `🌹 ${tag(alvoMarca, alvo.userId)} 🌹\n\n` +
        `*${eu.nome}* quer conquistar seu coração e está fazendo uma declaração especial! ❤️\n` +
        `💍💕 *VOCÊ ACEITA NAMORAR COM ${pronome}?* 💕💍\n\n` +
        `╰┈➤ *Digite* \`\`\`#aceito\`\`\` *para dizer SIM!* 💖\n\n` +
        `${LINHA}\n` +
        `${RODAPE}`,
        [alvoMarca]
    );

    // cópia do pedido para a salinha de moderação: registro (quem pediu -> quem recebeu)
    // + mesma foto/vídeo e mesmo texto do membro, tudo na mesma mensagem
    try {
        const buffer = await baixarMidia(message);
        if (buffer) {
            const jidDe = eu.jid || jid;

            const registro =
                `╭━━━ঌ💌໒━━━╮\n` +
                `📝 *REGISTRO DE PEDIDO* 📝\n` +
                `╰━━━ঌ💌໒━━━╯\n\n` +
                `💘 *De:* ${tag(jidDe, userId)}\n` +
                `🌹 *Para:* ${tag(alvoMarca, alvo.userId)}\n\n` +
                `${LINHA}\n\n` +
                `💬 *Declaração:*\n`;

            // texto do membro sem o comando #pedido/#np
            const textoPedido = texto
                .replace(/(^|\s)#(pedido|np)(?=\s|$)/gi, ' ')
                .replace(/[ \t]+\n/g, '\n')
                .trim();

            // quem pediu + quem recebeu + qualquer @ digitado na declaração (sem repetir)
            const mencionados = [...new Set([jidDe, alvoMarca, ...(ctx.mentionedJid || [])].filter(Boolean))];

            await sock.sendMessage(
                GRUPO_MODERACAO,
                montarMidia(img, buffer, registro + textoPedido, mencionados)
            );
        } else {
            console.error('[brincadeiraNamoro] pedido: não consegui baixar a mídia para a moderação');
        }
    } catch (e) {
        console.error('[brincadeiraNamoro] erro ao enviar pedido para a moderação:', e.message);
    }

    return resposta;
}

export async function tratarAceito(sock, message, from, jid, userId, ctx) {
    const reply = (t, mentions = []) => sock.sendMessage(from, { text: t, mentions }, { quoted: message });

    await limparPedidosExpirados(from);

    const eu = await buscarParticipante(from, userId);
    if (!eu) return reply('📸 Você não está inscrito(a) na brincadeira.');
    if (await emCasal(from, userId)) return reply('💑 Você já faz parte de um casal da brincadeira!');

    const recebidos = await pedidosRecebidos(from, userId); // mais recente primeiro
    if (!recebidos.length) return reply('🤔 Você não tem nenhum pedido de namoro pendente.');

    // se respondeu a mensagem de quem pediu, prioriza esse pedido; senão o mais recente
    const citado = ctx.participant ? extractDigits(ctx.participant) : null;
    const pedido = (citado && recebidos.find((p) => p.de === citado)) || recebidos[0];

    if (await emCasal(from, pedido.de)) {
        await removerPedido(pedido.id);
        return reply('💔 Essa pessoa já formou um casal com outra pessoa.');
    }

    const { ok } = await formarCasal(from, pedido.de, userId);
    if (!ok) return reply('💔 Não foi possível formar o casal: um dos dois já está em outro casal.');

    const pA = await buscarParticipante(from, pedido.de);
    const jidEu = eu.jid || jid;
    const mentions = [pA?.jid, jidEu].filter(Boolean);
    await reply(
        `💑 *NOVO CASAL DA BRINCADEIRA!* 💑\n\n` +
        `❤️ ${tag(pA?.jid, pedido.de)} (*${pA?.nome || pedido.de}*) + ${tag(jidEu, userId)} (*${eu.nome}*) ❤️\n\n` +
        `Estão oficialmente registrados como casal! 🎉`,
        mentions
    );

    // registro do pedido ACEITO na salinha de moderação (quem aceitou + quem pediu)
    try {
        const hora = new Date().toLocaleString('pt-BR', {
            day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
            timeZone: 'America/Fortaleza',
        });
        await sock.sendMessage(GRUPO_MODERACAO, {
            text:
                `╭━━━ঌ💍໒━━━╮\n` +
                `🎉 *REGISTRO DE PEDIDO ACEITO* 🎉\n` +
                `╰━━━ঌ💍໒━━━╯\n\n` +
                `💖 *Aceitou:* ${tag(jidEu, userId)}\n` +
                `💌 *Pedido de:* ${tag(pA?.jid, pedido.de)}\n\n` +
                `${LINHA}\n\n` +
                `💑 *NOVO CASAL FORMADO!* 💑\n` +
                `❤️ *${pA?.nome || pedido.de}* 💞 *${eu.nome}* ❤️\n\n` +
                `🕒 _${hora}_`,
            mentions,
        });
    } catch (e) {
        console.error('[brincadeiraNamoro] erro ao enviar registro de aceite para a moderação:', e.message);
    }

    // casal formado: atualiza a lista fixada (sai das solteiras/solteiros, entra em casais)
    await atualizarListaFixada(sock, from);
}