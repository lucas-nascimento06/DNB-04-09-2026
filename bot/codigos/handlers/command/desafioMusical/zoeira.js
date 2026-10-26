// bot/codigos/handlers/command/desafioMusical/zoeira.js
// Mensagens de zoeira para quem responde atrasado.

export function zoeiraAtraso(fem) {
    const o = fem ? 'a' : 'o';
    const linhas = [
        // --- originais ---
        `🦐 Camarão que dorme a onda leva! Acorda, ${fem ? 'dorminhoca' : 'dorminhoco'}! 😴🌊`,
        `🐢 Foi ${fem ? 'devagarzinha' : 'devagarzinho'}, né? A tartaruga passou voando por você!`,
        `😴 Dormiu no ponto! Seja mais ${fem ? 'rápida' : 'rápido'} na próxima!`,
        `🐌 Chegou ${fem ? 'atrasada' : 'atrasado'}, hein? Até o caracol já tinha respondido!`,
        `⏰ O despertador tocou, mas ${o} ${fem ? 'dorminhoca' : 'dorminhoco'} não ouviu! Acelera aí!`,
        `🛌 Tava de soneca? A resposta já foi embora, ${fem ? 'preguiçosa' : 'preguiçoso'}!`,
        `🚶 Demorou demais! Na próxima corre mais, ${fem ? 'lerdinha' : 'lerdinho'}! 😆`,
        `🥱 Acordou agora? A rodada já acabou, ${fem ? 'Bela Adormecida' : 'Adormecido da Silva'}! 😂`,

        // --- novas ---
        `🚌 O ônibus da resposta já passou e você ficou ${fem ? 'sozinha' : 'sozinho'} no ponto! 😅`,
        `📶 Seu sinal tá igual internet de 2005, né? Chegou ${fem ? 'atrasada' : 'atrasado'}! 🐌`,
        `🏁 A corrida acabou e você ainda tava amarrando o tênis, ${fem ? 'campeã' : 'campeão'} da lerdeza! 👟`,
        `🍿 Chegou ${fem ? 'atrasada' : 'atrasado'}, só deu tempo de pegar a pipoca e assistir! 😎`,
        `🧓 Até minha avó responde mais rápido que você, e ela nem usa celular! 👵📵`,
        `🦥 Preguiça é seu sobrenome? A resposta fugiu de você, bicho-preguiça! 🌿`,
        `🐙 Tem oito braços e ainda assim não digitou a tempo? Acelera, ${fem ? 'polvinha' : 'polvinho'}! 🌊`,
        `📉 Seu tempo de reação caiu mais que ação em crise! Na próxima, vem ${fem ? 'esperta' : 'esperto'}! 💸`,
        `🎤 O microfone já tem dono e não é você! Chegou tarde, hein! 😏`,
        `🔔 Atenção, atenção: ${fem ? 'a pessoa mais lenta' : 'o ser mais lento'} do grupo acabou de aparecer! 🐢`,
        `🥶 Congelou na hora H? Descongela aí que a próxima vem aí, ${fem ? 'gelada' : 'gelado'}! 🧊`,
        `🧠 O cérebro carregou, mas o dedo ficou ${fem ? 'travada' : 'travado'} no meio do caminho! 📱`,
        `🐌 Se fosse corrida de lesma, você ia chegar em segundo, ${fem ? 'coitada' : 'coitado'}! 😂`,
        `🌅 Já amanheceu e você ainda tá respondendo a pergunta de ontem, ${fem ? 'querida' : 'querido'}! ☀️`,
        `🐕 O cachorro pegou o osso primeiro e você ficou só olhando, ${fem ? 'molenga' : 'molengo'}! 🦴`,
        `📞 Alô? Alô? A resposta tá ligando e você não atende, ${fem ? 'distraída' : 'distraído'}! 📵`,
        `🎯 Mirou bem, mas atirou ${fem ? 'atrasada' : 'atrasado'}! Valeu a tentativa! 😆`,
        `🍫 Demorou tanto que o chocolate derreteu! Mais rápid${o} na próxima! 🥵`,
        `🕰️ Seu relógio tá atrasado ou foi você mesm${o}? A rodada já era! ⌛`,
        `🚀 Enquanto você decidia, o foguete já foi pra Lua com a resposta! Tchau, ${fem ? 'lerdinha' : 'lerdinho'}! 🌕`,
        `🧃 Foi tomar um suquinho e perdeu a rodada, ${fem ? 'sossegada' : 'sossegado'}? Foca na próxima! 😜`,
        `🦕 Seu tempo de resposta é de era jurássica, ${fem ? 'dinossaura' : 'dinossauro'}! Evolui aí! 🦖`,
    ];
    return linhas[Math.floor(Math.random() * linhas.length)];
}