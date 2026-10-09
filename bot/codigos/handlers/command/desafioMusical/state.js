// bot/codigos/handlers/command/desafioMusical/state.js
// Estado em memória compartilhado entre os módulos.

// Um jogo por grupo
export const jogos = new Map();

// Grupos com as inscrições abertas (#dmabrir). groupId -> timestamp
export const inscricoes = new Map();

// Pedidos de quem tentou entrar com as inscrições fechadas:
// "grupo:userId" -> { grupo, jid, userId, time }
export const pendentes = new Map();