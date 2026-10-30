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
import { pixHandler, enviarPixHandler } from './pixHandler.js'; // 🏦 Banco Damas
import { saldoHandler, extratoHandler, milionariosHandler } from './bancoHandler.js'; // 🏦 NOVO: saldo / extrato / ranking

// 🏦 #e / #enviar em QUALQUER posição da mensagem (início, meio ou fim).
// O lookahead (?=\s|$) evita pegar #extrato, #enviado, etc.
const REGEX_ENVIAR = /(^|\s)#(?:enviar|e)(?=\s|$)/i;

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

    // 🏦 PRIORIDADE 9.6: BANCO DAMAS
    //    #pix | #enviar (#e) | #saldo (#s) | #extrato (#x) | #ricos (#ranking)
    //
    //    Formatos aceitos para enviar:
    //      #e CHAVE 100
    //      CHAVE <enter> #e 100
    //      @pessoa #e 100
    //      (responder msg) #e 100
    if (!handled) {
        // Primeira palavra, sem acento
        const comando = lowerContent
            .split(/\s+/)[0]
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '');

        if (comando === '#pix') {
            await pixHandler(sock, message);
            handled = true;
        } else if (comando === '#saldo' || comando === '#s') {
            await saldoHandler(sock, message);
            handled = true;
        } else if (comando === '#extrato' || comando === '#x') {
            await extratoHandler(sock, message);
            handled = true;
        } else if (comando === '#ricos' || comando === '#ranking') {
            await milionariosHandler(sock, message);
            handled = true;
        } else if (REGEX_ENVIAR.test(lowerContent)) {
            // #e / #enviar em qualquer posição (inclusive depois da chave)
            await enviarPixHandler(sock, message, content);
            handled = true;
        }
    }

    // 👑 PRIORIDADE 10: PROMOVER / REBAIXAR
    if (!handled) handled = await handlePromoverRebaixar(sock, message, from, userId);

    return handled;
}