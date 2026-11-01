// bot/codigos/handlers/command/brincadeiraNamoro/mover.js
// #manda @pessoa solteiras | solteiros (ADM) -> move a pessoa para a outra lista

import { GRUPO_PRINCIPAL } from './config.js';
import { extractDigits } from './utils.js';
import { ehAdmin } from './desafio.js';
import { buscarParticipantePorJidOuId, emCasal, alterarSexo } from './dados.js';
import { atualizarListaFixada } from './listas.js';

export async function tratarMandar(sock, message, from, jid, userId, texto, ctx, ownerNumbers) {
    const reply = (t, mentions = []) => sock.sendMessage(from, { text: t, mentions }, { quoted: message });

    if (!(await ehAdmin(sock, from, jid, userId, ownerNumbers))) {
        return reply('🚫 Só ADM pode usar este comando.');
    }

    // tira as menções e lê o destino: "#manda solteiras" / "#manda solteiros"
    const semMencao = texto.toLowerCase().replace(/@\S+/g, ' ').replace(/\s+/g, ' ').trim();
    const m = semMencao.match(/^#manda (solteiras?|solteiros?)$/);
    const marcados = [...new Set(ctx.mentionedJid || [])];

    if (!m || marcados.length !== 1) {
        return reply('✍️ Use: *#manda @pessoa solteiras* ou *#manda @pessoa solteiros* (marque apenas 1 pessoa).');
    }
    const sexo = m[1].startsWith('solteira') ? 'mulher' : 'homem';

    // sempre mexe nos dados do grupo principal (funciona também se digitado na moderação)
    const alvoJid = marcados[0];
    const alvo = await buscarParticipantePorJidOuId(GRUPO_PRINCIPAL, alvoJid, extractDigits(alvoJid));
    if (!alvo) return reply('⚠️ Essa pessoa não está inscrita na brincadeira.', [alvoJid]);

    if (alvo.sexo === sexo) {
        return reply(`ℹ️ *${alvo.nome}* já está na lista das *${sexo === 'mulher' ? 'solteiras' : 'solteiros'}*.`);
    }
    if (await emCasal(GRUPO_PRINCIPAL, alvo.userId)) {
        return reply(`💔 *${alvo.nome}* já está em um casal. Desfaça o casal antes de mudar a lista.`);
    }

    await alterarSexo(GRUPO_PRINCIPAL, alvo.userId, sexo);
    await atualizarListaFixada(sock, GRUPO_PRINCIPAL);

    return reply(`✅ *${alvo.nome}* foi movido(a) para a lista das *${sexo === 'mulher' ? 'solteiras 💃' : 'solteiros 🕺'}*.`);
}