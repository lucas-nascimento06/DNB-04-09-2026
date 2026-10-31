// bot/codigos/handlers/command/brincadeiraNamoro/utils.js
// Helpers da Brincadeira do Namoro

import { NOMES_SIGNOS } from './config.js';

// reaproveita os helpers do desafio musical
export { extractDigits, getNumeroReal } from '../desafioMusical/utils.js';

// a normalização do signo (acento, feminino, gentílico, erro de digitação, "leão/leonina")
// fica num lugar só: config.js. Reexportado aqui para não quebrar quem importa daqui.
export { normalizarSigno } from './config.js';

export const semAcento = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
// igual ao semAcento, mas GARANTE o mesmo tamanho do texto original (letra por letra).
// Necessário porque a ficha decorada tem símbolos combinantes que o semAcento apagaria,
// deslocando as posições e fazendo o parseInscricao ler o campo errado.
export const semAcentoMesmoTamanho = (s) =>
    Array.from(s).map((ch) => {
        const b = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        return b.length === ch.length ? b : ch;
    }).join('');
export const capitalizar = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
export const nomeSigno = (s) => NOMES_SIGNOS[s] || capitalizar(s);

// Converte letras "decoradas" para letras normais.
// A ficha do bot (regras.js) usa o alfabeto matemático unicode (𝗡𝗢𝗠𝗘, 𝗦𝗘𝗫𝗢, 𝗖𝗜𝗗𝗔𝗗𝗘, 𝗦𝗜𝗚𝗡𝗢).
// Quando a pessoa copia a ficha, esses rótulos NÃO são "SEXO" de verdade e o parser não os achava.
// NFKC transforma 𝗦𝗘𝗫𝗢 -> SEXO, 𝗠 -> M, "：" (dois pontos largo) -> ":", espaço especial -> espaço.
// Também remove caracteres invisíveis (zero-width) que atrapalham a leitura.
export function normalizarTextoFicha(texto) {
    return String(texto || '')
        .normalize('NFKC')
        .replace(/[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, '');
}

// remove wrappers (efêmera, view once...) da mensagem do Baileys
export function desembrulhar(message) {
    let m = message?.message || {};
    for (let i = 0; i < 5; i++) {
        const inner =
            m.ephemeralMessage?.message ||
            m.viewOnceMessage?.message ||
            m.viewOnceMessageV2?.message ||
            m.documentWithCaptionMessage?.message;
        if (!inner) break;
        m = inner;
    }
    return m;
}

// devolve { img, texto, ctx } (texto = texto normal ou legenda da foto/vídeo)
// "img" é a mídia da mensagem: foto (imageMessage) OU vídeo (videoMessage)
export function lerMensagem(message, content) {
    const m = desembrulhar(message);
    const img = m.imageMessage || m.videoMessage || null;
    const texto = (
        content ||
        m.conversation ||
        m.extendedTextMessage?.text ||
        img?.caption ||
        ''
    ).trim();
    const ctx = m.extendedTextMessage?.contextInfo || img?.contextInfo || {};
    return { img, texto, ctx };
}

export const temComando = (texto, cmd) => new RegExp(`(^|\\s)#${cmd}(\\s|$)`, 'i').test(texto);

// ===================== SEXO =====================
// Vale: masculino / feminino, ou só a letra M / F. (homem / mulher continuam sendo
// entendidos, mas o bot só pede masculino (M) ou feminino (F).)
// Qualquer outra coisa: o bot não inscreve e pede para corrigir.
export function normalizarSexo(valor) {
    const v = semAcento(normalizarTextoFicha(valor).toLowerCase()).replace(/[^a-z]/g, '');
    if (v === 'm' || v === 'homem' || v === 'masculino' || v === 'masculinom') return 'homem';
    if (v === 'f' || v === 'mulher' || v === 'feminino' || v === 'femininof') return 'mulher';
    return null;
}

// Lê "NOME:", "SEXO (masculino ou feminino):", "CIDADE:", "SIGNO:" da legenda da foto/vídeo.
// Aceita negrito (*NOME:*), letras decoradas (𝗡𝗢𝗠𝗘), emojis e qualquer maiúscula/minúscula.
// Devolve também sexoTexto (o que a pessoa escreveu) para avisar quando for inválido.
// O signo sai como TEXTO CRU: quem converte para a chave padrão é o normalizarSigno do config.js.
export function parseInscricao(legenda) {
    const limpo = normalizarTextoFicha(legenda)   // <<< CORREÇÃO: letras decoradas -> letras normais
        .replace(/#(entrar|ne)(?=\s|$)/gi, '')
        .replace(/[*_~]/g, '')
        // tira o texto-guia da linha do SEXO, aceitando os modelos:
        //   "SEXO : masculino(M) ou feminino(F): M"   (ficha atual)
        //   "SEXO : (masculino ou feminino): M"       (ficha antiga)
        // (só mexe na linha do SEXO; "SEXO (masculino ou feminino): M" continua funcionando)
        .replace(/(sexo[^:\n]*):[ \t]*(?:\([^)\n]*\)|masculino[ \t]*\(m\)[^:\n]*?feminino[ \t]*\(f\))[ \t]*:?/gi, '$1:');
    const sem = semAcentoMesmoTamanho(limpo);

    // "extra" permite texto entre o rótulo e os dois pontos, ex.: SEXO (homem ou mulher):
    // [ \t]* (e não \s*) evita ler a linha de baixo quando o campo está em branco.
    const pega = (rotulo, extra = false) => {
        const ate = extra ? '[^:\\n]*' : '';
        const mt = sem.match(new RegExp(`${rotulo}${ate}[ \\t]*:[ \\t]*([^\\n]*)`, 'i'));
        if (!mt) return null;
        const inicio = mt.index + mt[0].length - mt[1].length;
        const bruto = limpo.substr(inicio, mt[1].length);
        // tira emojis/símbolos, mantém letras (com acento), números e pontuação simples
        return bruto.replace(/[^\p{L}\p{N}\s,.\-\/]/gu, '').trim() || null;
    };

    const nomeTxt = pega('nome');
    const sexoTexto = pega('sexo', true);

    return {
        nome: nomeTxt ? nomeTxt.slice(0, 40) : null,
        sexoTexto,
        sexo: normalizarSexo(sexoTexto),
        cidade: pega('cidade'),
        signo: pega('signo'), // texto cru (ex: "leão/leonina"); o config.js normaliza
    };
}