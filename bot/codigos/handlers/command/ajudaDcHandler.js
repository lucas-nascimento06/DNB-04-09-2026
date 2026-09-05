// ARQUIVO: bot/codigos/handlers/command/ajudaDcHandler.js
// (mesma pasta onde já ficam dcHandler.js, dcTransferHandler.js, leilaoHandler.js, etc.)
// content = texto da mensagem, ex: "#lcmd"
export async function handleAjudaDcCommand(sock, message, content) {
    const from = message.key.remoteJid;
    const lowerContent = content.toLowerCase().trim();
    const gatilhos = ['#lcmd', '#comandos', '#ajuda', '#ajudadc', '#dchelp'];
    if (!gatilhos.includes(lowerContent)) return false;
    const texto =
        `📜 *COMANDOS DO DC E DO LEILÃO — DAMAS COINS* 💰\n` +
        `_Envie_ *#lcmd* _a qualquer momento pra ver essa lista de novo._\n` +
        `━━━━━━━━━━━━━━━━━━\n\n` +
        `🪙 *#dc*\n` +
        `Mostra quanto DC você tem guardado.\n` +
        `_Quem pode usar: qualquer um_\n\n` +
        `💸 *#emprestar @pessoa <valor>*\n` +
        `Manda uma parte do seu DC pra outra pessoa (marcando ela com @).\n` +
        `_Quem pode usar: qualquer um_\n\n` +
        `🔨 *#leilao @pessoa <valor_min>dc <valor_max>dc*\n` +
        `Cria um leilão: manda a foto do item com essa legenda, marcando a pessoa (@) e informando o valor mínimo e o valor máximo do lance. O bot abre o leilão com um código.\n` +
        `_Ex: #leilao @maria 4dc 40dc_\n` +
        `_Quem pode usar: somente admin_\n\n` +
        `✋ *#lance <valor>dc*\n` +
        `Dá um lance no leilão. Pode responder a foto do leilão com esse comando, ou mandar direto com o código: *#lance <valor>dc cod<código>*\n` +
        `_Quem pode usar: qualquer um_\n\n` +
        `🏆 *#arrematar*\n` +
        `Fecha o leilão manualmente e declara o arrematante (responda a foto ou a última confirmação, ou use o código: *#arrematar cod<código>*).\n` +
        `_Quem pode usar: somente admin_\n\n` +
        `🏁 *#fl*\n` +
        `Encerra o leilão.\n` +
        `_Quem pode usar: somente admin_\n\n` +
        `🔓 *#dcasal*\n` +
        `Libera casal(is) bloqueado(s) do grupo, sem precisar encerrar o leilão com #fl.\n` +
        `_Quem pode usar: somente admin_\n\n` +
        `🧹 *#rl*\n` +
        `Reseta os leilões em andamento do grupo atual.\n` +
        `_Quem pode usar: somente admin_\n\n` +
        `🎯 *#desafio* / *#pronto*\n` +
        `Usado pelo casal formado no leilão pra lidar com os desafios propostos.\n` +
        `_Quem pode usar: qualquer um (geralmente o casal envolvido)_\n\n` +
        `🔄 *#resetardc*\n` +
        `Zera o DC de todo mundo e apaga todo o histórico, em TODOS os grupos.\n` +
        `_Quem pode usar: restrito ao dono/dev_\n\n` +
        `💥 *#resetartudo*\n` +
        `Reseta TODOS os leilões de TODOS os grupos.\n` +
        `_Quem pode usar: restrito ao dono/dev_\n\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `💬 Cada mensagem sua no grupo rende *1 DC*, mas pode levar alguns segundos pra aparecer no saldo (é gravado a cada 30s).`;
    try {
        await sock.sendMessage(from, { text: texto }, { quoted: message });
    } catch (err) {
        console.error('[handleAjudaDcCommand] Erro:', err.message);
    }
    return true;
}