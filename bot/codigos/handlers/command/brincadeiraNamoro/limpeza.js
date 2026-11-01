// bot/codigos/handlers/command/brincadeiraNamoro/limpeza.js
// #bnz (ADM) -> zera TODAS as tabelas da brincadeira do namoro (recomeçar do zero).
// As tabelas continuam existindo (só ficam vazias, e os IDs voltam a 1).
// NÃO mexe nos DCs (damas_dc_wallets) nem em nada fora da brincadeira.

import pool from '../../../../../db.js';
import { ehAdmin } from './desafio.js';

const TABELAS = [
    'damas_namoro_participantes',
    'damas_namoro_pedidos',
    'damas_namoro_casais',
    'damas_namoro_lista_fixada',
    'damas_namoro_desafios',
    'damas_namoro_cumpridos',
    'damas_namoro_status_msgs',
    'damas_namoro_status_desafio', // tabela antiga (se existir no banco, também é limpa)
];

// só considera as tabelas que existem de verdade no banco
async function tabelasExistentes() {
    const existentes = [];
    for (const t of TABELAS) {
        const r = await pool.query(`SELECT to_regclass($1) AS reg`, [`public.${t}`]);
        if (r.rows[0].reg) existentes.push(t);
    }
    return existentes;
}

// desafixa e apaga as mensagens fixadas (lista e status) antes de zerar o banco
async function apagarMensagensFixadas(sock, existentes) {
    const alvos = [];
    try {
        if (existentes.includes('damas_namoro_lista_fixada')) {
            const r = await pool.query(`SELECT grupo AS destino, msg_id FROM damas_namoro_lista_fixada`);
            alvos.push(...r.rows);
        }
        if (existentes.includes('damas_namoro_status_msgs')) {
            const r = await pool.query(`SELECT destino, msg_id FROM damas_namoro_status_msgs`);
            alvos.push(...r.rows);
        }
    } catch (e) {
        console.error('[brincadeiraNamoro] bnz: erro ao ler mensagens fixadas:', e.message);
    }

    let apagadas = 0;
    for (const { destino, msg_id } of alvos) {
        const key = { remoteJid: destino, fromMe: true, id: msg_id };
        try { await sock.sendMessage(destino, { pin: key, type: 2 }); } catch { /* ignora */ }
        try { await sock.sendMessage(destino, { delete: key }); apagadas++; } catch { /* ignora */ }
    }
    return apagadas;
}

export async function tratarLimpeza(sock, message, from, jid, userId, ownerNumbers) {
    const reply = (t) => sock.sendMessage(from, { text: t }, { quoted: message });

    if (!(await ehAdmin(sock, from, jid, userId, ownerNumbers))) {
        return reply('🚫 Só ADM pode usar este comando.');
    }

    try {
        const existentes = await tabelasExistentes();

        // conta o que existia antes de apagar (para mostrar no aviso)
        const linhas = [];
        let total = 0;
        for (const t of existentes) {
            const r = await pool.query(`SELECT COUNT(*)::int AS n FROM ${t}`);
            total += r.rows[0].n;
            linhas.push(`• ${t.replace('damas_namoro_', '')}: ${r.rows[0].n}`);
        }

        const apagadas = await apagarMensagensFixadas(sock, existentes);

        if (existentes.length) {
            await pool.query(`TRUNCATE TABLE ${existentes.join(', ')} RESTART IDENTITY`);
        }

        console.log(`[namoro] BNZ: ${existentes.length} tabelas zeradas por ${userId}`);
        return reply(
            `🧹 *BRINCADEIRA LIMPA E ZERADA!* 🧹\n\n` +
            `✅ ${existentes.length} tabelas limpas\n` +
            `📦 ${total} registros apagados\n` +
            `🗑️ ${apagadas} mensagens fixadas removidas\n\n` +
            `*O que tinha em cada tabela:*\n${linhas.join('\n')}\n\n` +
            `Tudo zerado! Pode começar uma nova brincadeira do zero. 💘`
        );
    } catch (e) {
        console.error('[brincadeiraNamoro] erro na limpeza:', e);
        return reply('❌ Erro ao limpar as tabelas. Veja o log do bot.');
    }
}