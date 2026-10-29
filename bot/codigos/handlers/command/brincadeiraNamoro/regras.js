// bot/codigos/handlers/command/brincadeiraNamoro/regras.js
// #namoro -> regras | #ncomandos -> comandos | #nc -> comandos curto | #nr -> regras curto
// #ficha -> ficha de inscrição pronta para copiar

import { CONFIG } from './config.js';

const CABECALHO =
`╔═════ஜ۩۞۩ஜ════╗
👏🍻 *DﾑMﾑS 💃🔥 Dﾑ NIGӇԵ*💃🎶🍾🍸
╚═════ஜ۩۞۩ஜ════╝`;

// Atenção: o bot lê as linhas NOME, SEXO, CIDADE e SIGNO. Não troque esses nomes.
const FICHA =
`${CABECALHO}

💘✨ *FICHA DE INSCRIÇÃO* ✨💘
💞 *BRINCADEIRA DO NAMORO* 💞

╭───────────────────╮
📸 *FOTO:* envie junto com a ficha
👤 *NOME:*
🚻 *SEXO (masculino ou feminino):*
📍 *CIDADE:*
♌ *SIGNO:*
╰───────────────────╯

✍️ _Escreva tudo por extenso, sem abreviar._

*#entrar*`;

export function textoRegras() {
    return `${FICHA}

━━━━━━━━━━━━━━━━

📸 *1. COMO SE INSCREVER*

Envie uma foto sua e, na descrição da foto, preencha a ficha acima (Nome, Sexo, Cidade e Signo).
No sexo, escreva uma destas opções: *masculino* (M) ou *feminino* (F).

*No final da descrição, digite o comando #entrar.*

💰 Atenção: para participar você precisa ter pelo menos ${CONFIG.DC_MINIMO} DCs.

🤖 O bot identifica o sexo e adiciona você na lista das *solteiras* ou dos *solteiros*.

💌 *2. COMO FAZER UM PEDIDO DE NAMORO*

✍️ *Escreva sua declaração, marque a pessoa usando o @ e no final do texto coloque o comando #pedido.*

##################
Exemplo:

❤️ Meu pedido de namoro

*@Jacutinga* você chamou minha atenção e gostaria de ter a oportunidade de conhecer você melhor. Aceita ser meu par nessa brincadeira? 💘

*#pedido*

##################

🤖 O bot identifica o pedido e marca a pessoa para que ela possa responder.

💞 *3. COMO ACEITAR UM PEDIDO*

Se você aceitar, basta responder no grupo com o comando *#aceito.*

🤖 O bot adiciona os dois automaticamente na lista de *casais formados*.

💑 *4. E PRONTO!*

Os dois estarão oficialmente registrados como um casal da brincadeira. ❤️

📌 *RESUMINDO*

📸 Para se inscrever: foto + ficha + #entrar.
💌 Para pedir alguém em namoro: declaração + @pessoa + #pedido.
💖 Para aceitar: #aceito.
📋 Para ver a lista: #inscritos

Quem sabe o próximo casal não será você? 😍💘`;
}

export async function mostrarRegras(sock, from, message) {
    await sock.sendMessage(from, { text: textoRegras() }, { quoted: message });
}

export function textoComandos() {
    return `${CABECALHO}

💘 *COMANDOS DA BRINCADEIRA DO NAMORO* 💘

📸 *#entrar* (ou *#ne*) — se inscrever
Envie uma foto e na descrição escreva:
👤 NOME: Maria
🚻 SEXO (masculino ou feminino): feminino
📍 CIDADE: Fortaleza
♌ SIGNO: leão
#entrar
✍️ Sexo: masculino (M) ou feminino (F).
💰 Precisa ter pelo menos ${CONFIG.DC_MINIMO} DCs.

💌 *#pedido* (ou *#np*) — pedir em namoro
Escreva sua declaração, marque a pessoa com @ e termine com #pedido.
⏳ O pedido vale por 24 horas.

💞 *#aceito* (ou *#na*) — aceitar um pedido
Quem recebeu o pedido responde #aceito no grupo.

📋 *CONSULTAS*
*#inscritos* (ou *#ni*) — lista dos participantes e casais
*#namoro* (ou *#nr* resumida) — regras da brincadeira
*#ncomandos* (ou *#nc* resumida) — mostra esta lista

📌 Marque apenas 1 pessoa por pedido. Quem já está em casal não pode pedir nem receber pedido.`;
}

export async function mostrarComandos(sock, from, message) {
    await sock.sendMessage(from, { text: textoComandos() }, { quoted: message });
}

// ===================== VERSÕES RESUMIDAS =====================
export function textoComandosCurto() {
    return `💘 *COMANDOS DO NAMORO* 💘

📸 *#ne* — entrar (foto + Nome, Sexo, Cidade e Signo | mín. ${CONFIG.DC_MINIMO} DCs)
💌 *#np* — pedido (declaração + @pessoa)
💞 *#na* — aceitar o pedido

📋 *#ni* lista dos inscritos
ℹ️ *#nr* regras | *#nc* comandos`;
}

export function textoRegrasCurto() {
    return `💘 *BRINCADEIRA DO NAMORO* 💘

1️⃣ Envie uma foto com Nome, Sexo (masculino ou feminino), Cidade e Signo na legenda + *#ne* (mín. ${CONFIG.DC_MINIMO} DCs)
2️⃣ Faça sua declaração, marque a pessoa com @ e termine com *#np*
3️⃣ Quem recebeu responde *#na* e o casal é formado 💑

Comandos: *#nc* | Regras completas: *#namoro*`;
}

export async function mostrarComandosCurto(sock, from, message) {
    await sock.sendMessage(from, { text: textoComandosCurto() }, { quoted: message });
}

export async function mostrarRegrasCurto(sock, from, message) {
    await sock.sendMessage(from, { text: textoRegrasCurto() }, { quoted: message });
}

// ===================== FICHA (comando #ficha) =====================
// Ficha de inscrição no modelo "Damas da Night", pronta para copiar e preencher.
export function textoFicha() {
    return `╔═══ஓ๑♡•⋆⃘ٰٰٰٰٰٖٖٖٖٖٜ۬ ⃘ٰٰٰ︨ٖٖٖٜ︡۬⋆𝅦𝆉⃝꯭⃭݊̎🏹♡๑ஓ═══╗
  👏🍻 *DﾑMﾑS* 💃🔥 *Dﾑ* *NIGӇԵ*💃🎶🍾🍸
╚═══ஓ๑♡•⋆⃘ٰٰٰٰٰٖٖٖٖٖٜ۬ ⃘ٰٰٰ︨ٖٖٖٜ︡۬⋆𝅦𝆉⃝꯭⃭݊̎👼🏻๑ஓ═══╝


💘✨ *FICHA DE INSCRIÇÃO* ✨💘


♚ࠟࠟࠟࠟࠟ͢. ⃢💑*BRINCADEIRA DO NAMORO*⃝!⃢💑⃝♚
💜⃟⃨⃜ ̶💃͆͢🅓α֟፝֟֠֩֯͝м︭αѕ 🅓͢α 🅝︧︨ιgнт͢͡💃⃟̶⃨⃜💜

╭───────────────────╮
📸 *FOTO OU VÍDEO*: envie junto com a ficha
👤 *NOME*:  
🚻 *SEXO* : (masculino ou feminino): 
📍 *CIDADE*:  
♌ *SIGNO*:  
╰───────────────────╯

✍️ Escreva tudo por extenso, sem abreviar.

#entrar`;
}

export async function mostrarFicha(sock, from, message) {
    await sock.sendMessage(from, { text: textoFicha() }, { quoted: message });
}