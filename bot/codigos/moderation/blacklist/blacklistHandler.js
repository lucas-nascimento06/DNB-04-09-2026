// blacklistHandler.js
import { 
    addToBlacklist, removeFromBlacklist, 
    isBlacklistedRealtime, listBlacklist, 
    getBlacklistHelp, adminOnlyMessage, normalizeNumber 
} from './blacklistFunctions.js';
import { getGroupAdmins, isUserAdmin } from './grupoUtils.js';

/**
 * Função para deletar mensagem com múltiplas tentativas (IGUAL AO #BAN)
 */
const deleteCommandMessage = async (sock, groupId, messageKey) => {
    const delays = [0, 100, 500, 1000, 2000, 5000];

    for (let i = 0; i < delays.length; i++) {
        try {
            if (delays[i] > 0) await new Promise(r => setTimeout(r, delays[i]));

            const key = {
                remoteJid: messageKey.remoteJid || groupId,
                fromMe: false,
                id: messageKey.id,
                participant: messageKey.participant
            };

            await sock.sendMessage(groupId, { delete: key });
            return true;
        } catch (error) {
            // tenta de novo no próximo delay
        }
    }
    console.log('⚠️ [blacklist] Não foi possível deletar o comando após todas as tentativas');
    return false;
};

/**
 * 🆕 Detecta os comandos de adicionar/remover (nomes novos + antigos como atalho)
 *   Adicionar: #ad  [número] [motivo]  | (antigo) #addlista [número] [motivo]
 *   Remover:   #rem [número]           | (antigo) #remlista [número]
 */
const isAddCommand = (lower) => /^#(addlista|ad)\s+/.test(lower);

const isRemCommand = (lower) => /^#(remlista|rem)\s+/.test(lower);

/**
 * Remove o comando do começo da mensagem e devolve só os argumentos
 * Ex: "#ad 5521999999999 golpista" -> "5521999999999 golpista"
 */
const getCommandArgs = (content) => content.trim().replace(/^#\S+\s*/, '');

/**
 * Handler principal dos comandos da blacklist
 */
export async function handleBlacklistCommands(sock, from, userId, content, msg) {
    const lowerContent = content?.toLowerCase().trim();
    const userMsgKey = msg?.key;

    if (!lowerContent) return false;

    // Só segue se for de fato um comando de blacklist — evita ruído de log em toda mensagem
    const isBlacklistCommand = isAddCommand(lowerContent)
        || isRemCommand(lowerContent)
        || lowerContent.startsWith('#verilista ')
        || lowerContent === '#lista'
        || lowerContent === '#infolista';

    if (!isBlacklistCommand) return false;

    // Função para verificar admin em grupos
    async function requireAdmin() {
        if (from.endsWith('@g.us')) {
            const groupAdmins = await getGroupAdmins(sock, from);
            if (!isUserAdmin(userId, groupAdmins)) {
                // Deleta o comando mesmo se não for admin - COM AWAIT
                await deleteCommandMessage(sock, from, userMsgKey);

                const sentMsg = await sock.sendMessage(from, { text: adminOnlyMessage() });
                setTimeout(() => sock.sendMessage(from, { delete: sentMsg.key }).catch(() => {}), 5000);
                return false;
            }
        }
        return true;
    }

    // #ad (ou #addlista) - Apenas adiciona à blacklist
    if (isAddCommand(lowerContent)) {
        // DELETA O COMANDO IMEDIATAMENTE - COM AWAIT
        await deleteCommandMessage(sock, from, userMsgKey);

        if (!await requireAdmin()) return true;

        // 🆕 Aceita número com espaços, +, hífen e parênteses: +55 51 95456-8767
        // Junta os pedaços que "parecem número" (até 15 dígitos) e o resto vira motivo
        const tokens = getCommandArgs(content).split(/\s+/).filter(Boolean);
        const numberParts = [];
        let digitCount = 0;

        for (const t of tokens) {
            if (!/^[+\d()\-.]+$/.test(t)) break;
            const d = t.replace(/\D/g, '').length;
            if (digitCount + d > 15) break;
            numberParts.push(t);
            digitCount += d;
        }

        const number = numberParts.join('');
        if (!number) {
            const sentMsg = await sock.sendMessage(from, { text: '❌ Uso correto: #ad [número] [motivo opcional]' });
            setTimeout(() => sock.sendMessage(from, { delete: sentMsg.key }).catch(() => {}), 5000);
            return true;
        }

        const now = new Date();
        const formattedDate = now.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
        const motivo = tokens.slice(numberParts.length).join(' ') || `Adicionado em ${formattedDate}`;

        const result = await addToBlacklist(number, motivo);

        const sentMsg = await sock.sendMessage(from, { text: `${result} 🛑` });
        setTimeout(() => sock.sendMessage(from, { delete: sentMsg.key }).catch(() => {}), 5000);

        return true;
    }

    // #rem (ou #remlista)
    if (isRemCommand(lowerContent)) {
        // DELETA O COMANDO IMEDIATAMENTE - COM AWAIT
        await deleteCommandMessage(sock, from, userMsgKey);

        if (!await requireAdmin()) return true;

        const number = getCommandArgs(content).trim();
        if (!number) {
            const sentMsg = await sock.sendMessage(from, { text: '❌ Uso correto: #rem [número]' });
            setTimeout(() => sock.sendMessage(from, { delete: sentMsg.key }).catch(() => {}), 5000);
            return true;
        }

        const result = await removeFromBlacklist(number);
        const sentMsg = await sock.sendMessage(from, { text: `${result} 🎉` });
        setTimeout(() => sock.sendMessage(from, { delete: sentMsg.key }).catch(() => {}), 5000);
        return true;
    }

    // #verilista
    if (lowerContent.startsWith('#verilista ')) {
        // DELETA O COMANDO IMEDIATAMENTE - COM AWAIT
        await deleteCommandMessage(sock, from, userMsgKey);

        if (!await requireAdmin()) return true;

        const number = content.replace('#verilista ', '').trim();
        if (!number) {
            const sentMsg = await sock.sendMessage(from, { text: '❌ Uso correto: #verilista [número]' });
            setTimeout(() => sock.sendMessage(from, { delete: sentMsg.key }).catch(() => {}), 5000);
            return true;
        }

        const blocked = await isBlacklistedRealtime(number);
        const sentMsg = await sock.sendMessage(from, { text: blocked 
            ? `❌ Número ${number} está na blacklist.` 
            : `✅ Número ${number} não está na blacklist.` });
        setTimeout(() => sock.sendMessage(from, { delete: sentMsg.key }).catch(() => {}), 5000);
        return true;
    }

    // #lista
    if (lowerContent === '#lista') {
        // DELETA O COMANDO IMEDIATAMENTE - COM AWAIT
        await deleteCommandMessage(sock, from, userMsgKey);

        if (!await requireAdmin()) return true;

        const result = await listBlacklist();
        const sentMsg = await sock.sendMessage(from, { text: `📋 Lista da Blacklist:\n\n${result}` });
        setTimeout(() => sock.sendMessage(from, { delete: sentMsg.key }).catch(() => {}), 10000);
        return true;
    }

    // #infolista (informativo, liberado para todos)
    if (lowerContent === '#infolista') {
        // DELETA O COMANDO IMEDIATAMENTE - COM AWAIT
        await deleteCommandMessage(sock, from, userMsgKey);

        const result = getBlacklistHelp();
        const sentMsg = await sock.sendMessage(from, { text: `ℹ️ Informações da Blacklist:\n\n${result}` });
        setTimeout(() => sock.sendMessage(from, { delete: sentMsg.key }).catch(() => {}), 20000);
        return true;
    }

    return false;
}

/* =========== Como fica =============*/

//#ad +55 51 95456-8767  --->	5551954568767	Adicionado em (data)
//#ad 5551954568767 golpista ----->	5551954568767	golpista
//#ad +55 51 95456-8767 golpista ----> 	5551954568767	golpista
//#ad (51) 95456-8767 ---->	51954568767	Adicionado em (data)