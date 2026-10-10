// bot/codigos/handlers/command/desafioMusical/comandoLetra.js
// #letra <número> -> manda a letra da música

import { jogos } from './state.js';
import { buscarMusicaPorId, lerLetra } from './musicas.js';

export async function tratarComandoLetra(sock, message, lower, from) {
    if (!/^#letra(\s|$)/.test(lower)) return null; // não é esse comando

    // durante uma rodada aberta nenhuma letra sai
    // (senão dava para descobrir a música testando números)
    const r = jogos.get(from)?.rodada;
    if (r && !r.encerrada) {
        await sock.sendMessage(from, { text: '🤫 As letras só ficam disponíveis entre as rodadas!' }, { quoted: message });
        return true;
    }

    const m = lower.match(/^#letra\s+(\d+)$/);
    if (!m) {
        await sock.sendMessage(from, { text: '📝 Use *#letra número*, por exemplo: *#letra 12*' }, { quoted: message });
        return true;
    }

    const id = parseInt(m[1]);

    const musica = buscarMusicaPorId(id);
    if (!musica) {
        await sock.sendMessage(from, { text: `❌ Não existe música com o número *${id}*.` }, { quoted: message });
        return true;
    }

    const letra = lerLetra(id);
    if (!letra) {
        await sock.sendMessage(from, { text: `😕 Ainda não tenho a letra de *${musica.titulo}*.` }, { quoted: message });
        return true;
    }

    await sock.sendMessage(from, {
        text: `🎤 *${musica.titulo}* — ${musica.artista}\n\n${letra}`,
    }, { quoted: message });
    return true;
}