// bot/codigos/handlers/command/brincadeiraNamoro/pedidos.js
// #pedido | #np -> pedido de namoro | #aceito | #na -> aceita e forma o casal

import { extractDigits } from './utils.js';
import {
    buscarParticipante, buscarParticipantePorJidOuId, emCasal,
    limparPedidosExpirados, criarPedido, pedidosRecebidos, removerPedido, formarCasal,
} from './dados.js';
import { atualizarListaFixada } from './listas.js';

// texto do @ tem que ser igual à parte antes do "@" do jid, senão não vira menção
const tag = (jid, userId) => `@${jid ? jid.split('@')[0] : userId}`;

// ===================== DECORAÇÃO DO PEDIDO =====================
const ENFEITE_TOPO =
`⏜ᷤ•´¯•𐅁⃘⃪︨︡ᷤᷤ🌹⃘⃪︧︠ᷤᷤ𐅀🍃𐅁⃘⃪︨︡ᷤᷤ🌹⃘⃪︧︠ᷤᷤ𐅀•´¯•ᷤ⏜
ۣۣۣۣۣۣۣۣۣ̅─ۣۣۣۣۣۣۣۣ͞─‌ۣۣۣۣۣۣۣ͞─‌ۣۣۣۣۣۣ͞─‌ۣۣۣۣۣ͞─‌ۣۣۣۣ͞─‌ۣۣۣ͞─‌ۣۣ͞─‌ۣ͞─‌ᷤ͜͡🌹🍃•̖´᷽ᷤ🌹᷽ᷤ\`̗•
█✧⃝💑🅓𝕒𝕞𝕒𝕤 𝕕𝕒 🅝𝕚𝕘𝕙𝕥✧⃝💑 █
❶⓿ 🅐🅝🅞🅢`;

const ENFEITE_BASE =
`̖´᷽ᷤ🌹᷽ᷤ\`̗•🍃́🌹ᷤ͜͡─‌ۜ͟─‌ۜۜ͟─‌ۜۜۜ͟─‌ۜۜۜۜ͟─‌ۜۜۜۜۜ͟─‌ۜۜۜۜۜۜ͟─‌ۜۜۜۜۜۜۜ͟─‌ۜۜۜۜۜۜۜۜ͟─‌̲ۜۜۜۜۜۜۜۜۜ
█🅓𝕒𝕞𝕒𝕤 𝕕𝕒 🅝𝕚𝕘𝕙𝕥✧⃝💑
❶⓿ 🅐🅝🅞🅢
⏝•̖ᷤ⌣̗ᷤ•𐅁⃘⃪︨︡ᷤᷤ🌹⃘⃪︧︠ᷤᷤ𐅀🍃𐅁⃘⃪︨︡ᷤᷤ🌹⃘⃪︧︠ᷤᷤ𐅀•̖ᷤ⌣̗ᷤ•⏝`;

export async function tratarPedido(sock, message, from, jid, userId, texto, ctx) {
    const reply = (t, mentions = []) => sock.sendMessage(from, { text: t, mentions }, { quoted: message });

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
    const pronome = eu.sexo === 'mulher' ? 'ela' : 'ele';
    return reply(
        `${ENFEITE_TOPO}\n\n` +
        `💌✨ *PEDIDO DE NAMORO* 💍\n\n` +
        `${tag(alvoMarca, alvo.userId)}, ${eu.nome} quer conquistar seu coração! 🥹❤️\n\n` +
        `🌹💕 *Você aceita namorar com ${pronome}?* 💕🌹\n\n` +
        `💖 Responda *#aceito* para dizer SIM! 💍👩‍❤️‍👨\n\n` +
        `${ENFEITE_BASE}`,
        [alvoMarca]
    );
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

    // casal formado: atualiza a lista fixada (sai das solteiras/solteiros, entra em casais)
    await atualizarListaFixada(sock, from);
}