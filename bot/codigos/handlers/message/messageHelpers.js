// messageHelpers.js - FUNÇÕES AUXILIARES DO MESSAGE HANDLER
import { handleMusicaCommands } from "../musica/musicaHandler.js";
import { handleMessage as handleAdvertencias } from '../../moderation/advertenciaGrupos.js';
import { statusGrupo } from '../../moderation/removerCaracteres.js';
import { scanAndRemoveBlacklisted, onUserJoined } from "../../moderation/blacklist/blacklistFunctions.js";

// 🆕 Distância de edição (Levenshtein) — usada só para detectar comandos
// digitados errado, próximos de "#dados" (ex: #dadus, #dadis, #dasos,
// #dadoss). Não é usada pra mais nada além disso.
function levenshteinDistance(a, b) {
    const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
    for (let i = 0; i <= a.length; i++) dp[i][0] = i;
    for (let j = 0; j <= b.length; j++) dp[0][j] = j;

    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            if (a[i - 1] === b[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1];
            } else {
                dp[i][j] = 1 + Math.min(
                    dp[i - 1][j],     // remoção
                    dp[i][j - 1],     // inserção
                    dp[i - 1][j - 1]  // substituição
                );
            }
        }
    }

    return dp[a.length][b.length];
}

/**
 * Processa comandos básicos que sempre são executados
 */
export async function handleBasicCommands(sock, message, from, userId, content, pool) {
    let handled = false;

    // Comando de música
    if (!handled) {
        handled = await handleMusicaCommands(sock, message, from);
    }
    
    // Sistema de advertências
    if (!handled) {
        await handleAdvertencias(sock, message, pool);
    }

    // Comando #status
    if (!handled && content.toLowerCase().startsWith('#status') && from.endsWith('@g.us')) {
        await statusGrupo(sock, from);
        handled = true;
    }

    // 🆕 FIX: o gatilho anterior comparava '#dad' de forma exata (ou, antes
    // disso, com startsWith('#dad')), então erros de digitação como
    // #dadus, #dadis ou #dasos não batiam com nenhuma das duas regras e
    // a mensagem de correção nunca era enviada.
    //
    // Agora a checagem usa distância de edição (Levenshtein) entre o texto
    // digitado e "#dados": se a diferença for pequena (até 2 letras
    // trocadas/adicionadas/removidas), consideramos "quase #dados" e
    // sugerimos o comando certo. O "#dados" correto NUNCA cai aqui porque
    // já é tratado e sempre dá return lá em messageHandler.js antes de
    // chegar nesse fallback — o "contentTrim !== '#dados'" abaixo é só
    // uma segurança extra.
    const contentTrim = content.toLowerCase().trim();
    if (
        !handled &&
        contentTrim.startsWith('#') &&
        contentTrim !== '#dados' &&
        contentTrim.length <= 9 &&
        levenshteinDistance(contentTrim, '#dados') <= 2
    ) {
        await sock.sendMessage(from, {
            text: '❌ Comando inválido.\n✅ O comando correto é #dados'
        });
        handled = true;
    }
}

/**
 * Processa atualizações de participantes do grupo
 */
export async function handleGroupUpdate(sock, update) {
    try {
        const { id: groupId, participants, action } = update;

        console.log(`\n👥 ========= EVENTO DE GRUPO =========`);
        console.log(`📱 Grupo: ${groupId}`);
        console.log(`🎬 Ação: ${action}`);
        console.log(`👤 Participantes: ${participants.join(', ')}`);
        console.log(`=====================================\n`);

        // Bot entra no grupo - varredura automática
        if (action === 'add' && participants.includes(sock.user?.id)) {
            console.log('🤖 Bot adicionado! Iniciando varredura...');
            await scanAndRemoveBlacklisted(groupId, sock);
            return;
        }

        // Usuário entra no grupo - verifica blacklist
        if (action === 'add') {
            for (const userId of participants) {
                if (userId === sock.user?.id) continue;
                
                console.log(`🔍 Verificando ${userId} na blacklist...`);
                await onUserJoined(userId, groupId, sock);
            }

            // Atualiza AutoTag
            const { updateGroupOnJoin } = await import('./messageHandler.js');
            await updateGroupOnJoin(sock, groupId);
        }

    } catch (err) {
        console.error('❌ Erro ao processar participantes:', err);
    }
}