// Textos fixos da brincadeira

// Título e rodapé usados no convite e na pergunta
const TITULO = `☕ *BRINCADEIRA : CHÁ OU CAFÉ?*🍵🔥`;
const RODAPE = `_© damas da night_`;

export default {
  ajuda:
    `☕🍵 *CHÁ OU CAFÉ — COMO JOGAR*\n\n` +
    `1️⃣ *Convide:* use *#cc @pessoa* (ou *#chaoucafe @pessoa*).\n` +
    `2️⃣ *Escolha:* a pessoa marcada responde *diretamente a mensagem do convite* com 🍵 *#cha* ou ☕ *#cafe*.\n` +
    `3️⃣ *Mistério:* 🔮 quem decide a pergunta é o *bot*! Você escolhe chá ou café, mas só descobre qual será a sua pergunta quando ela aparecer.\n` +
    `4️⃣ *Responda:* a pessoa responde *diretamente a mensagem da pergunta* e ganha um ✅.\n\n` +
    `❌ Resposta solta no grupo não vale!\n` +
    `🚫 Só a pessoa marcada pode escolher e responder.`,

  // Legenda que acompanha o poster (#brincadeirachaoucafe / #bcc)
  poster:
`🌶️☕ *BRINCADEIRA : CHÁ OU CAFÉ?*🍵🔥

Aqui vai ter um toque de ousadia, uma pitadinha de malícia e muita descontração! 😏😂

Mas calma, gente! Aqui a proposta é HOT, mas com suavidade! ❤️‍🔥

🍵 *CHÁ* – *MAIS LEVINHO E TRANQUILO!* 🌸
Perguntas descontraídas, curiosidades e situações engraçadas.

☕ *CAFÉ* – *UM POUQUINHO MAIS APIMENTADO!* 🌶️
Perguntas mais ousadinhas, com uma pitadinha de provocação, mas sempre com respeito e bom senso.

📌 *COMO VAI FUNCIONAR?*

1️⃣ *CONVIDE:* marque alguém com *#cc @pessoa* (ou *#chaoucafe @pessoa*).

2️⃣ *ESCOLHA:* a pessoa marcada *responde diretamente a mensagem do convite* com 🍵 *#cha* ou ☕ *#cafe*.

3️⃣ *MISTÉRIO:* 🔮 quem decide a pergunta é o *BOT*! Você escolhe chá ou café, mas só descobre qual será a sua pergunta quando ela aparecer... será que vem leve ou pegando fogo? 😏

4️⃣ *RESPONDA:* a pessoa *responde diretamente a mensagem da pergunta* e ganha um ✅.

❌ Resposta solta no grupo não vale!
🚫 Só a pessoa marcada pode escolher e responder.
ℹ️ Dúvidas? Digite *#ajudachaoucafe*

🍵 *QUEM VAI DE CHÁ?*
☕ *QUEM VAI DE CAFÉ?*

🔥 *BORA AGITAR ESSA NOITE, PORQUE NO DAMAS DA NIGHT A RESENHA É GARANTIDA!* 😂🍻

*ADM LEONINA* 🦁❤️

_© damas da night_`,

  // ---------- Encerrar / reabrir ----------
  soAdminEncerrar: '⛔ Só *ADM* pode encerrar a brincadeira.',

  encerradaOk: (bancoLimpo) =>
    `🔒☕🍵 *BRINCADEIRA CHÁ OU CAFÉ ENCERRADA!*\n\n` +
    `Os comandos da brincadeira foram desativados neste grupo.\n` +
    (bancoLimpo
      ? `🧹 O histórico de perguntas foi limpo.\n\n`
      : `⚠️ Não consegui limpar o histórico no banco (veja o log). A brincadeira foi encerrada mesmo assim.\n\n`) +
    `Para iniciar de novo, um ADM deve usar *#icc*.`,

  jaEncerrada:
    `🔒 A brincadeira *Chá ou Café* está encerrada.\n` +
    `Só um *ADM* pode iniciar de novo usando *#icc*.`,

  // ---------- Iniciar ----------
  soAdminIniciar: '⛔ Só *ADM* pode iniciar a brincadeira.',

  iniciadaOk: '🎉☕🍵 *BRINCADEIRA CHÁ OU CAFÉ INICIADA!*',

  semMarcacao: '⚠️ Marque alguém! Exemplo: *#cc @maria*',
  marcouSiMesmo: '😅 Você não pode convidar a si mesmo!',
  marcouBot: '🤖 Eu não tomo chá nem café, convide uma pessoa!',

  // Aviso quando #cha/#cafe é mandado solto no grupo (sem responder o convite do bot)
  responderAbaixo: (alvo) =>
    `↩️ ${alvo}, responda *diretamente a mensagem do convite* com *#cha* ou *#cafe*.\n` +
    `Mensagem solta no grupo não vale! 😉`,

  // Alguém (que não é a pessoa marcada) tentou responder o convite com #cha/#cafe
  conviteDeOutro: (intruso, alvo) =>
    `🚫 ${intruso}, esse convite é para ${alvo}!\n` +
    `Só ${alvo} pode escolher *#cha* ou *#cafe*. 😉`,

  // Alguém (que não é a pessoa convidada) tentou responder a pergunta do bot
  perguntaDeOutro: (intruso, alvo) =>
    `🚫 ${intruso}, essa pergunta é para ${alvo}!\n` +
    `Só ${alvo} pode responder esta mensagem. 😉`,

  // Convite enviado pelo bot (com título e rodapé)
  convite: (autor, alvo) =>
    `${TITULO}\n\n` +
    `☕🍵 ${alvo} ${autor} quer te fazer uma pergunta!\n\n` +
    `━━━━━━ *SUA VEZ* ━━━━━━\n` +
    `↩️ ${alvo}, *responda diretamente esta mensagem* com *#cha* ou *#cafe* 👇\n` +
    `━━━━━━━━━━━━━━━━━━━\n\n` +
    `🔮 A pergunta é um mistério: quem decide é o bot!\n` +
    `❌ Resposta solta no grupo não vale!\n\n` +
    `${RODAPE}`,

  // Pergunta enviada pelo bot (com título e rodapé)
  pergunta: (tipo, autor, alvo, texto) => {
    const emoji = tipo === 'cha' ? '🍵' : '☕';
    const nome = tipo === 'cha' ? 'CHÁ' : 'CAFÉ';
    return (
      `${TITULO}\n\n` +
      `${emoji} ${alvo} escolheu *${nome}*! ${autor} pergunta:\n` +
      `━━━━━━ *PERGUNTA* ━━━━━━\n` +
      `❓ *${texto}*\n` +
      `━━━━━━━━━━━━━━━━━━━\n` +
      `↩️ Responda *diretamente esta mensagem*.\n\n` +
      `${RODAPE}`
    );
  },
};