// bot/handlers/removeHandler.js
import { configurarDespedida } from '../codigos/features/despedidaMembro.js';

/**
 * Processa remoção/saída de participantes do grupo
 * ESTRUTURA IGUAL AO AVISOADM.JS - Recebe update completo
 * 
 * @param {object} sock - instância do Baileys
 * @param {object} update - Objeto de atualização completo do grupo
 */
export async function handleUserRemove(sock, update) {
    console.log(`\n👋 ========= PROCESSANDO SAÍDA/REMOÇÃO (removeHandler) ========`);
    console.log(`🎬 Ação detectada: "${update.action}"`);
    console.log(`👮 Author (quem executou): ${update.author || 'N/A'}`);
    console.log(`👥 Total de participantes afetados: ${update.participants.length}`);
    console.log(`🔄 Chamando configurarDespedida com update completo`);
    
    try {
        // ✅ PASSA O UPDATE COMPLETO, IGUAL AO AVISOADM.JS
        await configurarDespedida(sock, update);
        console.log(`✅ Despedida processada com sucesso`);
    } catch (err) {
        console.error(`❌ Erro ao processar despedida:`, err.message);
        console.error(err.stack);
    }
    
    console.log(`==============================================\n`);
}