// bot/codigos/handlers/command/brincadeiraNamoro/utils.js
// Helpers da Brincadeira do Namoro

import { SIGNOS, NOMES_SIGNOS } from './config.js';

// reaproveita os helpers do desafio musical
export { extractDigits, getNumeroReal } from '../desafioMusical/utils.js';

export const semAcento = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
export const capitalizar = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
export const nomeSigno = (s) => NOMES_SIGNOS[s] || capitalizar(s);

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

// ===================== SEXO (RÍGIDO) =====================
// Vale UMA das palavras completas: homem / mulher OU masculino / feminino.
// Abreviações (H, M, F, masc, fem...) NÃO são aceitas: o bot não inscreve
// e pede para a pessoa escrever por extenso.
export function normalizarSexo(valor) {
    const v = semAcento(String(valor || '').toLowerCase()).replace(/[^a-z]/g, '');
    if (v === 'homem' || v === 'masculino') return 'homem';
    if (v === 'mulher' || v === 'feminino') return 'mulher';
    return null;
}

export function normalizarSigno(valor) {
    const v = semAcento(String(valor || '').toLowerCase()).replace(/[^a-z]/g, '');
    return SIGNOS.find((s) => v.includes(s)) || null;
}

// Lê "NOME:", "SEXO (masculino ou feminino):", "CIDADE:", "SIGNO:" da legenda da foto/vídeo.
// Aceita negrito (*NOME:*), emojis e qualquer maiúscula/minúscula.
// Devolve também sexoTexto (o que a pessoa escreveu) para avisar quando for inválido.
export function parseInscricao(legenda) {
    const limpo = legenda
        .replace(/#(entrar|ne)(?=\s|$)/gi, '')
        .replace(/[*_~]/g, '')
        // aceita também o modelo "SEXO : (masculino ou feminino): feminino"
        // (só mexe na linha do SEXO; o formato antigo continua funcionando igual)
        .replace(/(sexo[^:\n]*):[ \t]*\([^)\n]*\)[ \t]*:?/gi, '$1:');
    const sem = semAcento(limpo);

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
        signo: normalizarSigno(pega('signo')),
    };
}