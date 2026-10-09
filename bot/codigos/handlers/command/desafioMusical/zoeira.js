// bot/codigos/handlers/command/desafioMusical/zoeira.js
// Mensagens de zoeira para quem responde atrasado.

export function zoeiraAtraso(fem) {
    const o = fem ? 'a' : 'o';
    const linhas = [
        `🦐 Camarão que dorme a onda leva! Acorda, ${fem ? 'dorminhoca' : 'dorminhoco'}! 😴🌊`,
        `🐢 Foi ${fem ? 'devagarzinha' : 'devagarzinho'}, né? A tartaruga passou voando por você!`,
        `😴 ${fem ? 'Dormiu' : 'Dormiu'} no ponto! Seja mais ${fem ? 'rápida' : 'rápido'} na próxima!`,
        `🐌 Chegou ${fem ? 'atrasada' : 'atrasado'}, hein? Até o caracol já tinha respondido!`,
        `⏰ O despertador tocou, mas ${o} ${fem ? 'dorminhoca' : 'dorminhoco'} não ouviu! Acelera aí!`,
        `🛌 Tava de soneca? A resposta já foi embora, ${fem ? 'preguiçosa' : 'preguiçoso'}!`,
        `🚶 Demorou demais! Na próxima corre mais, ${fem ? 'lerdinha' : 'lerdinho'}! 😆`,
        `🥱 Acordou agora? A rodada já acabou, ${fem ? 'Bela Adormecida' : 'Adormecido da Silva'}! 😂`,
    ];
    return linhas[Math.floor(Math.random() * linhas.length)];
}