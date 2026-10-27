// bot/codigos/handlers/command/desafioMusical/regras.js
// 📜 Regras do Desafio Musical (#dmregras)

export const TEXTO_REGRAS =
`🎤 *REGRAS DO DESAFIO MUSICAL* 🎶

*📣 PARTICIPAÇÃO OBRIGATÓRIA*

Todos os membros do time precisam cantar e enviar o *ÁUDIO* aqui no grupo❗

*⚠️ ATENÇÃO*

Se algum integrante da equipe não cantar, o ponto vai automaticamente para o time adversário!

*🪙 PREMIAÇÃO*

🥇 *Destaque do time: 60 DCs*
  Quem chegar mais perto de completar a letra e tiver a melhor interpretação.

🎤 *Demais participantes: 10 DCs cada*
  Por cantar e ter tentado.

*⚖️ JULGAMENTO*

O ADM escolhe quem completou melhor a música e quem interpretou melhor. A decisão do ADM é final!

*⏳ LIBERAÇÃO DOS DCs*

Os DCs só serão liberados quando o ADM confirmar com *#ok*

*🔥 Soltem a voz e boa sorte a todos! 🎶*`;

export async function mostrarRegras(sock, from, message) {
    await sock.sendMessage(from, { text: TEXTO_REGRAS }, { quoted: message });
}