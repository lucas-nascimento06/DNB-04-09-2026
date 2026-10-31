// bot/codigos/handlers/command/brincadeiraNamoro/config.js
// Configurações da Brincadeira do Namoro

// grupo onde a brincadeira acontece (inscrições, pedidos, #aceito, #ni...)
export const GRUPO_PRINCIPAL = '120363428983518322@g.us';

// grupo de moderação: recebe a lista atualizada e fixada a cada mudança
export const GRUPO_MODERACAO = '120363433958507684@g.us';

// grupos onde os comandos da brincadeira funcionam
export const GRUPOS_PERMITIDOS = [GRUPO_PRINCIPAL];

// para onde vai a lista fixada automática.
// Hoje: principal + moderação. Só moderação: [GRUPO_MODERACAO]
export const GRUPOS_LISTA_FIXADA = [GRUPO_PRINCIPAL, GRUPO_MODERACAO];

export const CONFIG = {
    DC_MINIMO: 250,                               // DCs mínimos para se inscrever (sem máximo)
    PEDIDO_VALIDADE_MS: 24 * 60 * 60 * 1000,      // pedido expira em 24h
    SOMENTE_GRUPOS_PERMITIDOS: true,              // false = funciona em qualquer grupo
    LIMITE_DESAFIOS: 6,                           // máximo de desafios (1 a 6). Quer mais? Troque aqui.
};

export const SIGNOS = [
    'aries', 'touro', 'gemeos', 'cancer', 'leao', 'virgem',
    'libra', 'escorpiao', 'sagitario', 'capricornio', 'aquario', 'peixes',
];

// nome de exibição (com acento)
export const NOMES_SIGNOS = {
    aries: 'Áries', touro: 'Touro', gemeos: 'Gêmeos', cancer: 'Câncer', leao: 'Leão', virgem: 'Virgem',
    libra: 'Libra', escorpiao: 'Escorpião', sagitario: 'Sagitário', capricornio: 'Capricórnio',
    aquario: 'Aquário', peixes: 'Peixes',
};

// variações aceitas (sem acento, minúsculas): feminino, masculino, gentílicos
export const ALIASES_SIGNOS = {
    aries:       ['aries', 'ariano', 'ariana'],
    touro:       ['touro', 'taurino', 'taurina'],
    gemeos:      ['gemeos', 'gemeo', 'geminiano', 'geminiana', 'gemini'],
    cancer:      ['cancer', 'canceriano', 'canceriana'],
    leao:        ['leao', 'leonino', 'leonina'],
    virgem:      ['virgem', 'virginiano', 'virginiana'],
    libra:       ['libra', 'libriano', 'libriana', 'librano', 'librana'],
    escorpiao:   ['escorpiao', 'escorpiano', 'escorpiana', 'escorpionino', 'escorpionina'],
    sagitario:   ['sagitario', 'sagitariano', 'sagitariana'],
    capricornio: ['capricornio', 'capricorniano', 'capricorniana'],
    aquario:     ['aquario', 'aquariano', 'aquariana'],
    peixes:      ['peixes', 'peixe', 'pisciano', 'pisciana'],
};

function semAcento(s) {
    return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// distância de Levenshtein (quantas letras trocar/inserir/apagar)
function distancia(a, b) {
    const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) dp[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            dp[i][j] = Math.min(
                dp[i - 1][j] + 1,
                dp[i][j - 1] + 1,
                dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
            );
        }
    }
    return dp[a.length][b.length];
}

// procura o signo para UM trecho de texto já limpo (exato, depois com tolerância a erro)
function acharSigno(t) {
    if (!t) return null;

    // 1) acerto exato
    for (const [chave, lista] of Object.entries(ALIASES_SIGNOS)) {
        if (lista.includes(t)) return chave;
    }

    // 2) tolerância a erro de digitação (limite proporcional ao tamanho)
    if (t.length < 4) return null;
    const limite = t.length >= 8 ? 2 : 1;
    let melhor = null;
    let melhorDist = Infinity;
    for (const [chave, lista] of Object.entries(ALIASES_SIGNOS)) {
        for (const alias of lista) {
            const d = distancia(t, alias);
            if (d < melhorDist) { melhorDist = d; melhor = chave; }
        }
    }
    return melhorDist <= limite ? melhor : null;
}

/**
 * Converte o que a pessoa escreveu para a chave do signo (ex: 'capricornio'),
 * ou null se não reconhecer. Aceita acento, maiúscula, feminino, gentílico,
 * erros leves de digitação ("germiniano", "capricorneana"...) e mais de uma
 * palavra ("leão/leonina", "leão ou leonina", "signo de leão").
 */
export function normalizarSigno(texto) {
    if (!texto) return null;
    const t = semAcento(String(texto).toLowerCase())
        .replace(/[^a-z\s]/g, ' ')                           // tira emoji, pontuação, números
        .replace(/\b(signo|sou|de|do|da|e|ou|um|uma)\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (!t) return null;

    // texto inteiro primeiro
    const inteiro = acharSigno(t);
    if (inteiro) return inteiro;

    // depois palavra por palavra ("leao leonina" -> 'leao')
    for (const palavra of t.split(' ')) {
        const s = acharSigno(palavra);
        if (s) return s;
    }
    return null;
}