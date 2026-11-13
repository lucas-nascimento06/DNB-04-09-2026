// Textos fixos da brincadeira
import { expiracaoMs, prazoRespostaMs, silencioMs } from './config.js';

// Formata ms em texto: "20 segundos", "1 minuto", "10 minutos"
const tempo = (ms) => {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} segundos`;
  const m = Math.round(s / 60);
  return m === 1 ? '1 minuto' : `${m} minutos`;
};

// Formata o tempo restante da punição: "7 min e 32 s", "5 min", "40 s" (nunca mostra 60 s)
const restante = (restanteMs) => {
  const totalSeg = Math.max(1, Math.ceil(restanteMs / 1000));
  const min = Math.floor(totalSeg / 60);
  const seg = totalSeg % 60;
  if (min === 0) return `${seg} s`;
  if (seg === 0) return `${min} min`;
  return `${min} min e ${seg} s`;
};

// Título e rodapé usados no convite e na pergunta
const TITULO = `☕ *BRINCADEIRA : CHÁ OU CAFÉ?*🍵🔥`;
const RODAPE = `_© damas da night_`;

export default {
  ajuda:
    `☕🍵 *CHÁ OU CAFÉ*\n\n` +
    `1️⃣ Use *#chaoucafe @pessoa* (ou *#cc @pessoa*) para convidar alguém.\n` +
    `2️⃣ A pessoa marcada *responde diretamente a mensagem do convite* com *#cha* ou *#cafe*.\n` +
    `3️⃣ O bot sorteia uma pergunta da lista escolhida.\n` +
    `4️⃣ A pessoa precisa *responder diretamente a mensagem da pergunta* em até ${tempo(prazoRespostaMs)}, ` +
    `senão fica ${tempo(silencioMs)} sem falar no grupo.\n\n` +
    `❌ Resposta solta no grupo não vale!\n` +
    `🚫 Quem está punido(a) não pode ser convidado(a) até acabar a punição.\n\n` +
    `⏳ O convite vale por ${tempo(expiracaoMs)}.`,

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

2️⃣ A pessoa marcada *responde diretamente a mensagem do convite* escolhendo o que deseja tomar: 🍵 *#cha* ou ☕ *#cafe*.

3️⃣ *O bot sorteia a pergunta de acordo com a escolha:*

🍵 *Escolheu CHÁ?* A pergunta será mais leve!
☕ *Escolheu CAFÉ?* Pode vir com um pouquinho mais de pimenta! 🌶️😏

4️⃣ A pessoa *responde diretamente a mensagem da pergunta*. Resposta solta no grupo não vale! ❌

⏳ O convite vale por ${tempo(expiracaoMs)}.
⏰ Depois da pergunta, você tem ${tempo(prazoRespostaMs)} para responder, senão fica ${tempo(silencioMs)} sem falar no grupo.
🚫 Quem está punido(a) não pode ser convidado(a) até acabar a punição.
ℹ️ Dúvidas? Digite *#ajudachaoucafe*

⚠️ *ATENÇÃO, DAMAS E CAVALEIROS!*

O nosso objetivo não é constranger ninguém, ultrapassar limites ou deixar alguém desconfortável. Somos um grupo de amizade, e o que prevalece aqui é o respeito, a educação, a leveza e a diversão!

❤️‍🔥 A ideia é brincar, interagir, soltar a imaginação e arrancar boas gargalhadas!

Então preparem as xícaras, escolham suas doses e venham participar!

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
      ? `🧹 O histórico de perguntas foi limpo e as punições foram canceladas.\n\n`
      : `⚠️ Não consegui limpar o histórico no banco (veja o log). A brincadeira foi encerrada mesmo assim.\n\n`) +
    `Para reabrir, um ADM deve usar *#bcc*.`,

  jaEncerrada:
    `🔒 A brincadeira *Chá ou Café* está encerrada.\n` +
    `Só um *ADM* pode reabrir usando *#bcc*.`,

  semMarcacao: '⚠️ Marque alguém! Exemplo: *#cc @maria*',
  marcouSiMesmo: '😅 Você não pode convidar a si mesmo!',
  marcouBot: '🤖 Eu não tomo chá nem café, convide uma pessoa!',

  // Tentou convidar alguém que está punido (silenciado)
  alvoPunido: (autor, alvo, restanteMs) =>
    `🚫 ${autor}, ${alvo} foi punido(a) por não responder uma pergunta anterior ` +
    `e não pode receber convites por mais *${restante(restanteMs)}*.\n\n` +
    `👉 Escolha outra pessoa para convidar! 😉`,

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

  // Aviso na hora em que a pessoa é punida por não responder a pergunta
  punicao: (alvo) =>
    `⏰🚫 ${alvo} não respondeu a pergunta da brincadeira *Chá ou Café* em ${tempo(prazoRespostaMs)}!\n\n` +
    `🔇 Você foi punido(a) e ficará *${tempo(silencioMs)}* sem falar no grupo. ` +
    `Suas mensagens serão apagadas.`,

  // Aviso quando a pessoa silenciada tenta falar
  silenciado: (alvo, restanteMs) =>
    `🚫 ${alvo}, você foi punido(a) por não responder a pergunta da brincadeira *Chá ou Café*.\n` +
    `🔇 Suas mensagens serão apagadas por mais *${restante(restanteMs)}*.`,

  // Convite enviado pelo bot (com título e rodapé)
  convite: (autor, alvo) =>
    `${TITULO}\n\n` +
    `☕🍵 ${alvo} ${autor} quer te fazer uma pergunta!\n\n` +
    `↩️ ${alvo}, *responda diretamente esta mensagem* com *#cha* ou *#cafe* 👇\n` +
    `❌ Resposta solta no grupo não vale!\n` +
    `⏳ Você tem ${tempo(expiracaoMs)}.\n\n` +
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
      `↩️ Responda *diretamente esta mensagem* em ${tempo(prazoRespostaMs)}.\n` +
      `🔇 Senão: ${tempo(silencioMs)} sem falar no grupo.\n\n` +
      `${RODAPE}`
    );
  },
};