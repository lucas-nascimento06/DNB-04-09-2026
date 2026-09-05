// commandHandlers.js - HANDLERS INDIVIDUAIS DE COMANDOS
import { handleSignos } from '../../moderation/signosHandler.js';
import { handleBlacklistCommands } from '../../../codigos/moderation/blacklist/blacklistHandler.js';
import { listarSignos, handleHoroscopoCommand } from '../../features/horoscopoHandler.js';
import { scanAndRemoveBlacklisted } from '../../../codigos/moderation/blacklist/blacklistFunctions.js';
import { handleChamarCommand } from './chamarHandler.js';
import { handleAjudaDcCommand } from './ajudaDcHandler.js';

// 🔨 IMPORTS — sistema de leilão (tudo centralizado aqui)
import { handleLeilaoCommand } from './leilaoHandler.js';
import { handleLanceCommand } from './lanceHandler.js';
import { handleFecharLeilaoCommand } from './fecharLeilaoHandler.js';
import { handleResetLeilaoCommand } from './resetLeilaoHandler.js';
import { handleResetTudoCommand } from './resetTudoHandler.js';
import { handleResetDcCommand } from './resetDcHandler.js';
import { handleDesafioleilaoCommand } from './desafioleilaoHandler.js';
// 🆕 FIX: #arrematar existia em arrematarHandler.js mas nunca era importado
// nem chamado daqui — a mensagem passava direto pro alertaHandler e era
// ignorada (mesmo bug que já tinha acontecido com o #resetardc).
import { handleArrematarCommand } from './arrematarHandler.js';
// 🆕 #dcasal — libera casal(is) bloqueado(s) do grupo sem precisar de #fl
import { handleDCasalCommand } from './dcasalHandler.js';

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
            console.log(`✅ Comando deletado (tentativa ${i + 1})`);
            return true;
        } catch (error) {
            console.log(`❌ Tentativa ${i + 1} de deletar comando falhou`);
        }
    }
    return false;
};

// 🔮 SIGNOS
export async function handleSignosCommands(sock, message, content, from) {
    const lowerContent = content.toLowerCase().trim();
    
    const comandos = [
        '#damastaro', '#atualizarsignos', '!listasignos', '!listarsignos',
        '!mysignos', '!signos', '!signo ', '!signoaleatorio', '!signo aleatorio',
        '!horoscopo', '!horoscopocompleto', '!atualizarhoroscopo', '!ajudahoroscopo'
    ];

    if (comandos.some(cmd => lowerContent.startsWith(cmd))) {
        await handleSignos(sock, message);
        console.log(`🔮 Signos: ${lowerContent.split(' ')[0]}`);
        return true;
    }
    return false;
}

// 🚫 BLACKLIST - CORRIGIDO
export async function handleBlacklistGroup(sock, from, userId, content, message) {
    return await handleBlacklistCommands(sock, from, userId, content, message);
}

// 🔍 VARREDURA - COM DELEÇÃO DE COMANDO
export async function handleVarreduraCommand(sock, message, content, from, userId) {
    if (content.toLowerCase().trim() !== '#varredura' || !from.endsWith('@g.us')) {
        return false;
    }

    try {
        await deleteCommandMessage(sock, from, message.key);
        
        const groupMetadata = await sock.groupMetadata(from);
        const participant = groupMetadata.participants.find(p => p.id === userId);
        const isAdmin = participant?.admin === 'admin' || participant?.admin === 'superadmin';
        
        if (!isAdmin) {
            const sentMsg = await sock.sendMessage(from, {
                text: '👏🍻 *DﾑMﾑS* 💃🔥 *Dﾑ* *NIGӇԵ*💃🎶🍾🍸 🚫 Apenas administradores!'
            });
            setTimeout(() => sock.sendMessage(from, { delete: sentMsg.key }).catch(() => {}), 5000);
        } else {
            console.log(`🔍 Varredura: ${from}`);
            const result = await scanAndRemoveBlacklisted(from, sock);
            const sentMsg = await sock.sendMessage(from, { text: result });
            setTimeout(() => sock.sendMessage(from, { delete: sentMsg.key }).catch(() => {}), 10000);
        }
        return true;
    } catch (err) {
        console.error('❌ Erro #varredura:', err);
        const sentMsg = await sock.sendMessage(from, { text: '❌ Erro ao executar varredura.' });
        setTimeout(() => sock.sendMessage(from, { delete: sentMsg.key }).catch(() => {}), 5000);
        return true;
    }
}

// 🌟 HORÓSCOPO LEGADO
export async function handleHoroscopoLegacy(sock, message, content, from) {
    const lowerContent = content.toLowerCase();
    
    if (lowerContent.startsWith('#signos')) {
        await sock.sendMessage(from, { text: listarSignos() });
        return true;
    }
    
    if (lowerContent.startsWith('#horoscopo') || lowerContent.startsWith('#horóscopo')) {
        const args = content.trim().split(/\s+/);
        args.shift();
        await handleHoroscopoCommand(sock, message, args);
        return true;
    }
    
    return false;
}

// 💌 CHAMAR - delega tudo para chamarHandler.js
export { handleChamarCommand };

// 📜 LISTA DE COMANDOS DO DC - delega tudo para ajudaDcHandler.js
export { handleAjudaDcCommand };

// ============================================
// 🔨 SISTEMA DE LEILÃO — TODOS OS COMANDOS AGRUPADOS
// #leilao (abrir) | #lance (dar lance) | #arrematar (fechar manual)
// #fecharleilao/#fl (encerrar) | #dcasal (liberar casal bloqueado)
// #rl/#resetarleilao (resetar leilões do grupo atual)
// #resetartudo (resetar TODOS os grupos, restrito)
// #resetardc (resetar DC de TODOS os grupos, restrito)
// #desafio/#pronto (desafios do casal)
// ============================================
export async function handleLeilaoCommands(sock, message, content, from) {
    const lowerContent = content.toLowerCase().trim();
    const lowerContentSemAcento = lowerContent.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    // #leilao / #leilão — abrir leilão
    if (lowerContentSemAcento.startsWith('#leilao')) {
        console.log('🔨 Comando #leilao detectado!');
        const handled = await handleLeilaoCommand(sock, message, content);
        if (handled) return true;
    }

    // #lance — dar lance
    if (lowerContent.startsWith('#lance')) {
        console.log('🔨 Comando #lance detectado!');
        const handled = await handleLanceCommand(sock, message, content);
        if (handled) return true;
    }

    // #arrematar — fecha o leilão manualmente (admin)
    // ⚠️ Checa ANTES do #fecharleilao/#fl pra não ter conflito de prefixo.
    if (lowerContent.startsWith('#arrematar')) {
        console.log('🔨 Comando #arrematar detectado!');
        const handled = await handleArrematarCommand(sock, message, content);
        if (handled) return true;
    }

    // #fecharleilao / #fl — encerrar leilão
    if (lowerContent.startsWith('#fecharleilao') || lowerContent.startsWith('#fl')) {
        console.log('🔨 Comando #fecharleilao/#fl detectado!');
        const handled = await handleFecharLeilaoCommand(sock, message, content);
        if (handled) return true;
    }

    // #dcasal — libera casal(is) bloqueado(s) do grupo, sem precisar de #fl
    if (lowerContent.startsWith('#dcasal')) {
        console.log('🔓 Comando #dcasal detectado!');
        const handled = await handleDCasalCommand(sock, message, content);
        if (handled) return true;
    }

    // #resetartudo — resetar TODOS os leilões de TODOS os grupos (restrito ao dono/dev)
    // ⚠️ Checa ANTES do #rl pra evitar que "#resetartudo" seja capturado
    // acidentalmente pelo startsWith('#rl') ou similar.
    if (lowerContentSemAcento.startsWith('#resetartudo')) {
        console.log('🧹💥 Comando #resetartudo detectado!');
        const handled = await handleResetTudoCommand(sock, message, content);
        if (handled) return true;
    }

    // #resetardc — resetar TODO o histórico de DC de TODOS os grupos (restrito ao dono/dev)
    if (lowerContentSemAcento.startsWith('#resetardc')) {
        console.log('🧹💰 Comando #resetardc detectado!');
        const handled = await handleResetDcCommand(sock, message, content);
        if (handled) return true;
    }

    // #rl / #resetarleilao / #resetarleilão — resetar leilões do grupo atual
    if (lowerContentSemAcento.startsWith('#rl') || lowerContentSemAcento.startsWith('#resetarleilao')) {
        console.log('🧹 Comando #rl/#resetarleilao detectado!');
        const handled = await handleResetLeilaoCommand(sock, message, content);
        if (handled) return true;
    }

    // #desafio / #pronto — desafios do casal formado no leilão
    // Detecta o comando em QUALQUER posição da mensagem (não só no início),
    // pois é comum a pessoa escrever um texto antes ou depois do comando.
    if (from.endsWith('@g.us') && (/#desafio\b/i.test(lowerContent) || /#pronto\b/i.test(lowerContent))) {
        console.log('🎯 Comando #desafio/#pronto detectado!');
        const handled = await handleDesafioleilaoCommand(sock, message, content);
        if (handled) return true;
    }

    return false;
}