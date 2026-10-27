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