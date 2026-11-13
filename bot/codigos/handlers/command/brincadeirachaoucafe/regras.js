// Textos fixos da brincadeira
import { expiracaoMs } from './config.js';

const minutos = Math.round(expiracaoMs / 60000);

export default {
  ajuda:
    `☕🍵 *CHÁ OU CAFÉ*\n\n` +
    `1️⃣ Use *#chaoucafe @pessoa* (ou *#cc @pessoa*) para convidar alguém.\n` +
    `2️⃣ A pessoa marcada *responde a mensagem do convite* com *#cha* ou *#cafe*.\n` +
    `3️⃣ O bot sorteia uma pergunta da lista escolhida.\n\n` +
    `⏳ O convite vale por ${minutos} minutos.`,

  // Legenda que acompanha o poster (#brincadeirachaoucafe / #bcc)
  poster:
`🌶️☕ *BRINCADEIRA : CHÁ OU CAFÉ?*🍵🔥

Hoje a nossa noite vai ter um toque de ousadia, uma pitadinha de malícia e muita descontração! 😏😂

Mas calma, gente! Aqui a proposta é HOT, mas com suavidade! ❤️‍🔥

☕ *CAFÉ* – *UM POUQUINHO MAIS APIMENTADO!* 🌶️
Perguntas mais ousadinhas, com uma pitadinha de provocação, mas sempre com respeito e bom senso.

🍵 *CHÁ* – *MAIS LEVINHO E TRANQUILO!* 🌸
Perguntas descontraídas, curiosidades, situações engraçadas e aquelas respostas que rendem boas risadas!

📌 *COMO VAI FUNCIONAR?*

1️⃣ Marque alguém usando *#cc @pessoa* (ou *#chaoucafe @pessoa*) para convidar.

2️⃣ A pessoa marcada *responde a mensagem do convite* escolhendo o que deseja tomar: 🍵 *#cha* ou ☕ *#cafe*.

3️⃣ *O bot sorteia a pergunta de acordo com a escolha:*

🍵 *Escolheu CHÁ?* A pergunta será mais leve!
☕ *Escolheu CAFÉ?* Pode vir com um pouquinho mais de pimenta! 🌶️😏

⏳ O convite vale por ${minutos} minutos.
ℹ️ Dúvidas? Digite *#ajudachaoucafe*

⚠️ *ATENÇÃO, DAMAS E CAVALEIROS!*

O nosso objetivo não é constranger ninguém, ultrapassar limites ou deixar alguém desconfortável. Somos um grupo de amizade, e o que prevalece aqui é o respeito, a educação, a leveza e a diversão!

❤️‍🔥 A ideia é brincar, interagir, soltar a imaginação e arrancar boas gargalhadas!

Então preparem as xícaras, escolham suas doses e venham participar!

🍵 *QUEM VAI DE CHÁ?*
☕ *QUEM VAI DE CAFÉ?*

🔥 *BORA AGITAR ESSA NOITE, PORQUE NO DAMAS DA NIGHT A RESENHA É GARANTIDA!* 😂🍻

*ADM LEONINA* 🦁❤️

_@damas da night_`,

  // ---------- Encerrar / reabrir ----------
  soAdminEncerrar: '⛔ Só *ADM* pode encerrar a brincadeira.',

  encerradaOk: (bancoLimpo) =>
    `🔒☕🍵 *BRINCADEIRA CHÁ OU CAFÉ ENCERRADA!*\n\n` +
    `Os comandos da brincadeira foram desativados neste grupo.\n` +
    (bancoLimpo
      ? `🧹 O histórico de perguntas foi limpo.\n\n`
      : `⚠️ Não consegui limpar o histórico no banco (veja o log). A brincadeira foi encerrada mesmo assim.\n\n`) +
    `Para reabrir, um ADM deve usar *#bcc*.`,

  jaEncerrada:
    `🔒 A brincadeira *Chá ou Café* está encerrada.\n` +
    `Só um *ADM* pode reabrir usando *#bcc*.`,

  semMarcacao: '⚠️ Marque alguém! Exemplo: *#cc @maria*',
  marcouSiMesmo: '😅 Você não pode convidar a si mesmo!',
  marcouBot: '🤖 Eu não tomo chá nem café, convide uma pessoa!',

  // Aviso quando #cha/#cafe é mandado solto no grupo (sem responder o convite do bot)
  responderAbaixo: (alvo) =>
    `↩️ ${alvo}, responda *diretamente a mensagem do convite* com *#cha* ou *#cafe*.\n` +
    `Mensagem solta no grupo não vale! 😉`,

  convite: (autor, alvo) =>
    `☕🍵 ${alvo} ${autor} quer te fazer uma pergunta!\n\n` +
    `↩️ *Responda esta mensagem* com *#cha* ou *#cafe* 👇\n` +
    `⏳ Você tem ${minutos} minutos.`,

  pergunta: (tipo, autor, alvo, texto) => {
    const emoji = tipo === 'cha' ? '🍵' : '☕';
    const nome = tipo === 'cha' ? 'CHÁ' : 'CAFÉ';
    return (
      `${emoji} *${alvo} escolheu ${nome}!*\n\n` +
      `${autor} pergunta para ${alvo}:\n\n` +
      `❓ ${texto}\n\n` +
      `↩️ ${alvo}, responda *esta mensagem* com a sua resposta!`
    );
  },
};