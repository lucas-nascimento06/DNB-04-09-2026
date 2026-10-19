//blacklistFunctions.js

import pool from "../../../../db.js";

export const BOT_TITLE = '👏🍻 *DﾑMﾑS* 💃🔥 *Dﾑ* *NIGӇԵ*💃🎶🍾🍸';

/**
 * Normaliza números para o formato do WhatsApp
 * 🔧 LÓGICA SIMPLES: Se começa com 55 = brasileiro, senão = estrangeiro
 */
export function normalizeNumber(number) {
    // Extrai o sufixo original (@lid, @s.whatsapp.net, etc)
    const suffixMatch = number.match(/@(.+)$/);
    const suffix = suffixMatch ? `@${suffixMatch[1]}` : '@s.whatsapp.net';

    // Remove tudo que não é dígito
    let digits = number.replace(/@.*$/, '').replace(/\D/g, '');

    // ✅ REGRA SIMPLES: Mantém exatamente como o usuário digitou
    // Se digitou com 55, é brasileiro. Se não, é estrangeiro.

    return `${digits}${suffix}`;
}

/**
 * 🔧 EXTRAI DÍGITOS - LÓGICA SIMPLES
 * ✅ Se usuário digitou com 55 = brasileiro
 * ✅ Se usuário NÃO digitou com 55 = estrangeiro (mantém como está)
 */
export function extractDigits(number) {
    // Remove tudo que não é dígito
    let digits = number.replace(/@.*$/, '').replace(/\D/g, '');

    // ✅ REGRA SIMPLES: Mantém exatamente como o usuário digitou
    // Se digitou com 55, salva com 55. Se não, salva sem.

    return digits;
}

export function adminOnlyMessage() {
    return `${BOT_TITLE} 🚫 Este comando só pode ser usado por administradores!`;
}

/**
 * Verifica em tempo real se o número está na blacklist
 */
export async function isBlacklistedRealtime(number) {
    try {
        const digits = extractDigits(number);
        const result = await pool.query(
            'SELECT whatsapp_id FROM blacklist WHERE whatsapp_id = $1',
            [digits]
        );
        return result.rowCount > 0;
    } catch (err) {
        console.error('❌ [isBlacklistedRealtime] Erro:', err.message);
        return false;
    }
}

/**
 * Adiciona número à blacklist
 * 🔧 SALVA APENAS OS DÍGITOS, SEM SUFIXO
 */
export async function addToBlacklist(whatsappId, motivo = null) {
    try {
        const digits = extractDigits(whatsappId);

        const alreadyBlocked = await isBlacklistedRealtime(digits);
        if (alreadyBlocked) return `${BOT_TITLE} ⚠️ *Número* ${digits} *já está na blacklist.*`;

        await pool.query('INSERT INTO blacklist (whatsapp_id, motivo) VALUES ($1, $2)', [digits, motivo]);

        console.log(`✅ [blacklist] Número adicionado: ${digits}`);

        return `${BOT_TITLE} ✅ *Número* ${digits} *adicionado à blacklist.*`;
    } catch (err) {
        console.error(`${BOT_TITLE} ❌ Erro ao adicionar ${whatsappId}:`, err.message);
        return `${BOT_TITLE} ❌ Erro ao adicionar ${whatsappId} à blacklist.`;
    }
}

/**
 * Remove número da blacklist
 * 🔧 REMOVE USANDO APENAS OS DÍGITOS
 */
export async function removeFromBlacklist(whatsappId) {
    try {
        const digits = extractDigits(whatsappId);

        const result = await pool.query(
            'DELETE FROM blacklist WHERE whatsapp_id = $1',
            [digits]
        );

        if (result.rowCount > 0) {
            console.log(`🟢 [blacklist] Número removido: ${digits}`);
            return `${BOT_TITLE} 🟢 *Número* ${digits} *removido da blacklist* 🔓`;
        }
        return `${BOT_TITLE} ⚠️ *Número* ${digits} *não está na blacklist.*`;
    } catch (err) {
        console.error(`${BOT_TITLE} ❌ Erro ao remover ${whatsappId}:`, err.message);
        return `${BOT_TITLE} ❌ Erro ao remover ${whatsappId} da blacklist.`;
    }
}

/**
 * Lista números da blacklist
 */
export async function listBlacklist() {
    try {
        const result = await pool.query('SELECT * FROM blacklist ORDER BY created_at DESC');

        if (!result.rows.length) return `${BOT_TITLE} 📋 A blacklist está vazia.`;
        return `${BOT_TITLE}\n\n` + result.rows.map(r => `• ${r.whatsapp_id} - ${r.motivo || 'Sem motivo'}`).join('\n');
    } catch (err) {
        console.error(`${BOT_TITLE} ❌ Erro ao listar blacklist:`, err.message);
        return `${BOT_TITLE} ❌ Erro ao listar blacklist.`;
    }
}

/**
 * Faz varredura no grupo e remove todos da blacklist
 */
export async function scanAndRemoveBlacklisted(groupId, bot) {
    try {
        // 1. Busca metadados do grupo
        const groupMetadata = await bot.groupMetadata(groupId);
        const participants = groupMetadata.participants;

        // 2. Busca todos os números da blacklist (1 query só, comparação é toda em memória)
        const result = await pool.query('SELECT whatsapp_id FROM blacklist');
        const blacklistedNumbers = result.rows.map(r => r.whatsapp_id);

        // 3. Processa cada participante em memória (sem query por participante)
        const toRemove = [];

        for (const participant of participants) {
            const participantId = participant.id;
            const numberToCheck = participant.phoneNumber || participantId;
            const digits = extractDigits(numberToCheck);

            if (blacklistedNumbers.includes(digits)) {
                toRemove.push(participantId);
            }
        }

        // 4. Remove os usuários encontrados
        if (toRemove.length > 0) {
            console.log(`🚨 [varredura] ${groupId}: ${toRemove.length} usuário(s) na blacklist encontrado(s), removendo...`);

            let removidosComSucesso = 0;
            let erros = 0;

            for (const userId of toRemove) {
                try {
                    await bot.groupParticipantsUpdate(groupId, [userId], 'remove');
                    removidosComSucesso++;

                    // Delay de 1 segundo entre remoções
                    await new Promise(resolve => setTimeout(resolve, 1000));
                } catch (err) {
                    console.error(`❌ [varredura] Erro ao remover ${userId}:`, err.message);
                    erros++;
                }
            }

            console.log(`✅ [varredura] ${groupId}: ${removidosComSucesso} removido(s), ${erros} erro(s)`);

            return `${BOT_TITLE} ✅ Varredura concluída!\n🚨 ${removidosComSucesso} usuário(s) da blacklist foram removidos.${erros > 0 ? `\n⚠️ ${erros} erro(s) ao remover.` : ''}`;
        }

        return `${BOT_TITLE} ✅ Varredura concluída!\n✨ Nenhum usuário da blacklist encontrado no grupo.`;

    } catch (err) {
        console.error(`❌ [varredura] Erro geral no grupo ${groupId}:`, err.message);
        return `${BOT_TITLE} ❌ Erro ao fazer varredura no grupo.`;
    }
}

/**
 * Remove automaticamente usuário blacklist ao entrar no grupo
 */
export async function onUserJoined(userId, groupId, bot, originalId = null) {
    try {
        const digits = extractDigits(userId);
        const blocked = await isBlacklistedRealtime(digits);

        if (blocked) {
            const idToRemove = originalId || userId;
            try {
                await bot.groupParticipantsUpdate(groupId, [idToRemove], 'remove');
                console.log(`🚨 [onUserJoined] ${idToRemove} removido do grupo ${groupId} (blacklist)`);
            } catch (removeError) {
                console.error(`❌ [onUserJoined] Erro ao remover ${idToRemove}:`, removeError.message);
            }
        }
    } catch (err) {
        console.error(`❌ [onUserJoined] Erro geral (userId: ${userId}, groupId: ${groupId}):`, err.message);
    }
}

/**
 * Mensagem de ajuda da blacklist
 */
export function getBlacklistHelp() {
    return `
${BOT_TITLE} \n\n
📋 *COMANDOS DE BLACKLIST* 📋

- #ad [número] [motivo] - Adiciona número à blacklist
- #rem [número] - Remove número da blacklist
- #verilista [número] - Verifica se número está na blacklist
- #lista - Lista todos os números da blacklist
- #varredura - Faz varredura no grupo e remove quem está na blacklist
- #infolista - Mostra este guia

💡 *Como salvar números corretamente:*
- Apenas dígitos, sem símbolos ou espaços
- *Números brasileiros:* Adicione 55 na frente
  Exemplos: 5521979452941, 5511987654321
- *Números estrangeiros:* Digite o número completo com código do país
  Exemplos: 14078486684 (EUA), 447700900000 (Reino Unido)

⚠️ *IMPORTANTE:*
Se você digitar com 55, será tratado como brasileiro.
Se você digitar SEM 55, será tratado como estrangeiro.

🔍 *Varredura Automática:*
- O bot faz varredura automática ao conectar
- Use #varredura para fazer verificação manual a qualquer momento
`;
}