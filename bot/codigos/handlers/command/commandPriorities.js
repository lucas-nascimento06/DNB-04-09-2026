// commandPriorities.js - MÓDULO PRINCIPAL COMPACTO
import { handleOwnerMenu } from '../../features/menuOwner.js';
import { handleGroupCommands } from "../../utils/redefinirFecharGrupo.js";
import alertaHandler from '../../moderation/alertaHandler.js';
import { golpeHandler } from '../command/golpeHandler.js';
import { 
    handleSignosCommands,
    handleBlacklistGroup,
    handleVarreduraCommand,
    handleHoroscopoLegacy,
    handleAjudaDcCommand
} from './commandHandlers.js';
import { handlePromoverRebaixar } from './promoverHandler.js'; // 👈 NOVO
import { pixHandler, enviarPixHandler } from './pixHandler.js'; // 🏦 NOVO: Banco Damas

export async function processCommandPriorities(
    sock, message, from, userId, content,
    OWNER_NUMBERS, autoTag, pool
) {
    let handled = false;

    const lowerContent = content.toLowerCase().trim();

    // ============================================
    // 💘 PRIORIDADE 0: GOLPE — antes de tudo
    //    includes() garante qualquer ordem:
    //    #golpe @pessoa  OU  @pessoa #golpe  OU  reply com #golpe
    // ============================================
    if (lowerContent.includes('#golpe')) {
        console.log('✅ [commandPriorities] ENTROU NO GOLPE HANDLER');
        await golpeHandler(sock, message, from);
        return true;
    }

    // 🚨 PRIORIDADE 1: #ALERTA
    if (!handled) {
        handled = await alertaHandler(sock, message);
        if (handled) return true;
    }

    // 👑 PRIORIDADE 2: MENU OWNER
    if (!handled) handled = await handleOwnerMenu(sock, from, userId, content, OWNER_NUMBERS);

    // ✅ #BAN removido daqui — já tratado com early return em messageHandler.js
    // Manter aqui causava chamada dupla e processamento redundante.

    // 🔹 PRIORIDADE 3: ADMIN GRUPO (#rlink, #closegp, #opengp)
    if (!handled) handled = await handleGroupCommands(sock, message);

    // 🔹 PRIORIDADE 4-5: AUTOTAG
    if (!handled && from.endsWith('@g.us')) {
        handled = await autoTag.handleAdminCommands(sock, from, userId, content);
        if (!handled) {
            const tagResult = await autoTag.processMessage(sock, from, userId, content, message.key, message);
            if (tagResult?.processed) return true;
        }
    }

    // 🌟 PRIORIDADES 6-9: OUTROS COMANDOS
    if (!handled) handled = await handleSignosCommands(sock, message, content, from);
    if (!handled) handled = await handleBlacklistGroup(sock, from, userId, content, message);
    if (!handled) handled = await handleVarreduraCommand(sock, message, content, from, userId);
    if (!handled) handled = await handleHoroscopoLegacy(sock, message, content, from);

    // 📜 PRIORIDADE 9.5: #LCMD — lista de comandos do DC
    if (!handled) handled = await handleAjudaDcCommand(sock, message, content);

    // 🏦 PRIORIDADE 9.6: #PIX / #ENVIAR — Banco Damas
    if (!handled) {
        const comando = lowerContent.split(/\s+/)[0];
        if (comando === '#pix') {
            await pixHandler(sock, message);
            handled = true;
        } else if (comando === '#enviar') {
            await enviarPixHandler(sock, message, content);
            handled = true;
        }
    }

    // 👑 PRIORIDADE 10: PROMOVER / REBAIXAR
    if (!handled) handled = await handlePromoverRebaixar(sock, message, from, userId);

    return handled;
}