// bot/codigos/handlers/command/brincadeiraNamoro/desafio.js
// Desafio do namoro:
//  - #ndesafio | #nd  (ADM)  -> posta o desafio (foto/vídeo + texto) marcando SÓ os casais formados
//  - #cumpri                 -> cada pessoa do casal envia foto/vídeo + texto + #cumpri
//                               o bot manda para o grupo de moderação e atualiza a lista de status
//  - #ndstatus | #nds (ADM)  -> reenvia a lista de status no grupo de moderação
//  - #vd (ADM)               -> mostra a tabela de acompanhamento em tempo real no grupo onde for digitado

import pool from '../../../../../db.js';
import { GRUPO_MODERACAO, GRUPO_PRINCIPAL } from './config.js';
import { extractDigits } from './utils.js';
import { buscarParticipante, emCasal, listarCasais } from './dados.js';

const APAGAR_ORIGINAL = true;            // true = apaga a mensagem original do ADM depois de repostar (bot precisa ser admin)
const EXIGIR_TEXTO_NO_CUMPRI = false;    // true = #cumpri só vale se tiver texto junto da foto/vídeo
const LIMITE_LEGENDA = 800;              // máximo de caracteres do texto do #cumpri repassado à moderação
const FIXAR_STATUS = true;               // true = a lista de acompanhamento fica fixada no grupo de moderação (desafixa/apaga a antiga e fixa a nova)
const DURACAO_FIXO = 7 * 24 * 60 * 60;   // segundos (86400 = 24h | 604800 = 7 dias | 2592000 = 30 dias)

// ===================== TABELAS =====================
let tabelasProntas = false;

export async function garantirTabelasDesafio() {
    if (tabelasProntas) return;

    await pool.query(`
        CREATE TABLE IF NOT EXISTS damas_namoro_desafios (
            id         BIGSERIAL   PRIMARY KEY,
            grupo      TEXT        NOT NULL,
            texto      TEXT,
            tipo_midia TEXT,
            ativo      BOOLEAN     NOT NULL DEFAULT TRUE,
            criado_em  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_damas_namoro_desafios_grupo
        ON damas_namoro_desafios (grupo, ativo)
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS damas_namoro_cumpridos (
            id         BIGSERIAL   PRIMARY KEY,
            desafio_id BIGINT      NOT NULL,
            grupo      TEXT        NOT NULL,
            user_id    TEXT        NOT NULL,
            texto      TEXT,
            criado_em  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (desafio_id, user_id)
        )
    `);

    // mensagem da lista de status no grupo de moderação (1 por destino)
    await pool.query(`
        CREATE TABLE IF NOT EXISTS damas_namoro_status_desafio (
            destino       TEXT        PRIMARY KEY,
            msg_id        TEXT        NOT NULL,
            atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    tabelasProntas = true;
}

// ===================== BANCO =====================
async function criarDesafio(grupo, texto, tipoMidia) {
    // só um desafio ativo por grupo: o novo encerra o anterior
    await pool.query(`UPDATE damas_namoro_desafios SET ativo = FALSE WHERE grupo = $1 AND ativo`, [grupo]);
    const r = await pool.query(
        `INSERT INTO damas_namoro_desafios (grupo, texto, tipo_midia) VALUES ($1, $2, $3) RETURNING id`,
        [grupo, texto || null, tipoMidia || null]
    );
    return r.rows[0].id;
}

async function desafioAtivo(grupo) {
    const r = await pool.query(
        `SELECT id, texto FROM damas_namoro_desafios WHERE grupo = $1 AND ativo ORDER BY id DESC LIMIT 1`,
        [grupo]
    );
    return r.rows[0] || null;
}

async function jaCumpriu(desafioId, userId) {
    const r = await pool.query(
        `SELECT 1 FROM damas_namoro_cumpridos WHERE desafio_id = $1 AND user_id = $2 LIMIT 1`,
        [desafioId, userId]
    );
    return r.rowCount > 0;
}

// true se registrou agora, false se a pessoa já tinha cumprido
async function registrarCumprimento(desafioId, grupo, userId, texto) {
    const r = await pool.query(
        `INSERT INTO damas_namoro_cumpridos (desafio_id, grupo, user_id, texto)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (desafio_id, user_id) DO NOTHING
         RETURNING id`,
        [desafioId, grupo, userId, texto || null]
    );
    return r.rowCount > 0;
}

async function idsCumpridos(desafioId) {
    const r = await pool.query(`SELECT user_id FROM damas_namoro_cumpridos WHERE desafio_id = $1`, [desafioId]);
    return new Set(r.rows.map((x) => x.user_id));
}

async function obterStatusMsgId(destino) {
    const r = await pool.query(`SELECT msg_id FROM damas_namoro_status_desafio WHERE destino = $1`, [destino]);
    return r.rows[0]?.msg_id || null;
}

async function salvarStatusMsgId(destino, msgId) {
    await pool.query(
        `INSERT INTO damas_namoro_status_desafio (destino, msg_id)
         VALUES ($1, $2)
         ON CONFLICT (destino) DO UPDATE SET msg_id = EXCLUDED.msg_id, atualizado_em = NOW()`,
        [destino, msgId]
    );
}

// ===================== HELPERS =====================
// texto do @ tem que ser igual à parte antes do "@" do jid, senão não vira menção
const tag = (jid, userId) => `@${jid ? jid.split('@')[0] : userId}`;

// tira o(s) comando(s) do texto
const limparComando = (texto, cmds) =>
    String(texto || '')
        .replace(new RegExp(`(^|\\s)#(${cmds.join('|')})(?=\\s|$)`, 'gi'), ' ')
        .replace(/[ \t]+\n/g, '\n')
        .trim();

async function baixarMidia(message) {
    try {
        let baileys;
        try { baileys = await import('@whiskeysockets/baileys'); }
        catch { baileys = await import('baileys'); }
        const buffer = await baileys.downloadMediaMessage(message, 'buffer', {});
        return Buffer.from(buffer);
    } catch (e) {
        console.error('[brincadeiraNamoro] erro ao baixar mídia do desafio:', e.message);
        return null;
    }
}

function montarMidia(img, buffer, caption, mentions = []) {
    const ehVideo = String(img.mimetype || '').startsWith('video');
    return ehVideo
        ? { video: buffer, caption, mentions, mimetype: img.mimetype, gifPlayback: !!img.gifPlayback }
        : { image: buffer, caption, mentions };
}

// ADM = dono do bot (ownerNumbers) OU admin do grupo
export async function ehAdmin(sock, from, jid, userId, ownerNumbers = []) {
    if ((ownerNumbers || []).some((n) => extractDigits(String(n)) === userId)) return true;
    try {
        const meta = await sock.groupMetadata(from);
        const p = (meta.participants || []).find((x) =>
            [x.id, x.lid, x.jid, x.phoneNumber].filter(Boolean).some((v) => v === jid || extractDigits(v) === userId)
        );
        return !!p?.admin;
    } catch (e) {
        console.error('[brincadeiraNamoro] erro ao checar admin:', e.message);
        return false;
    }
}

// ===================== #ndesafio | #nd (ADM) =====================
export async function tratarDesafio(sock, message, from, jid, userId, img, texto, ownerNumbers) {
    const reply = (t, mentions = []) => sock.sendMessage(from, { text: t, mentions }, { quoted: message });

    await garantirTabelasDesafio();

    if (!(await ehAdmin(sock, from, jid, userId, ownerNumbers))) {
        return reply('🚫 Só ADM pode postar o desafio da brincadeira.');
    }

    const conteudo = limparComando(texto, ['ndesafio', 'nd']);
    if (!conteudo && !img) {
        return reply('✍️ Envie a *foto/vídeo* (opcional) com o *texto do desafio* e termine com *#ndesafio*.');
    }

    const casais = await listarCasais(from);
    if (!casais.length) return reply('💔 Ainda não há casais formados para receber o desafio.');

    let buffer = null;
    if (img) {
        buffer = await baixarMidia(message);
        if (!buffer) return reply('⚠️ Não consegui baixar a mídia. Envie de novo.');
    }

    // marca APENAS as pessoas dos casais (nunca o grupo todo)
    const mentions = [];
    const contato = (j, id) => {
        if (j) { mentions.push(j); return `@${j.split('@')[0]}`; }
        return `@${id}`;
    };
    const linhas = casais.map((c, i) =>
        `${i + 1}. ${contato(c.jid_a, c.user_a)} 💞 ${contato(c.jid_b, c.user_b)}`
    );
    const blocoCasais =
        `💑 *CASAIS DO DESAFIO*\n${linhas.join('\n')}\n\n` +
        `📸 Cada pessoa do casal deve enviar uma *foto ou vídeo acompanhado do texto*, conforme explicado no desafio postado pelo ADM.\n
        ✅ No final da postagem, coloque *#cumpri* para confirmar que realizou o desafio!`;

    // reposta
    if (img) {
        const principal = await sock.sendMessage(from, montarMidia(img, buffer, conteudo, []));
        await sock.sendMessage(from, { text: blocoCasais, mentions }, principal ? { quoted: principal } : {});
    } else {
        await sock.sendMessage(from, { text: `${conteudo}\n\n${blocoCasais}`, mentions });
    }

    // guarda o desafio ativo
    await criarDesafio(from, conteudo, img ? (String(img.mimetype || '').startsWith('video') ? 'video' : 'image') : null);

    // apaga a mensagem original do ADM
    if (APAGAR_ORIGINAL) {
        try { await sock.sendMessage(from, { delete: message.key }); }
        catch (e) { console.error('[brincadeiraNamoro] não consegui apagar a mensagem original (o bot é admin?):', e.message); }
    }

    // lista de status inicial (todo mundo pendente) no grupo de moderação
    await atualizarStatusDesafio(sock, from);
}

// ===================== #cumpri =====================
export async function tratarCumpri(sock, message, from, jid, userId, img, texto) {
    const reply = (t, mentions = []) => sock.sendMessage(from, { text: t, mentions }, { quoted: message });

    await garantirTabelasDesafio();

    const eu = await buscarParticipante(from, userId);
    const casal = await emCasal(from, userId);
    if (!eu || !casal) return reply('💔 Só quem faz parte de um casal da brincadeira pode cumprir o desafio.');

    const desafio = await desafioAtivo(from);
    if (!desafio) return reply('🤔 Não há nenhum desafio ativo agora. Aguarde o ADM postar.');

    if (await jaCumpriu(desafio.id, userId)) return reply('✅ Você já cumpriu este desafio!');

    if (!img) {
        return reply('📸 Envie uma *foto* ou *vídeo* com um texto e termine a descrição com *#cumpri*.');
    }

    const conteudo = limparComando(texto, ['cumpri']);
    if (EXIGIR_TEXTO_NO_CUMPRI && !conteudo) {
        return reply('✍️ Escreva um texto junto da foto/vídeo e termine com *#cumpri*.');
    }

    const buffer = await baixarMidia(message);
    if (!buffer) return reply('⚠️ Não consegui baixar sua mídia. Envie de novo.');

    const novo = await registrarCumprimento(desafio.id, from, userId, conteudo);
    if (!novo) return reply('✅ Você já cumpriu este desafio!');

    const parceiroId = casal.user_a === userId ? casal.user_b : casal.user_a;
    const parceiro = await buscarParticipante(from, parceiroId);
    const parceiroCumpriu = await jaCumpriu(desafio.id, parceiroId);

    const jidEu = eu.jid || jid;
    const jidParceiro = parceiro?.jid || null;
    const tagEu = tag(jidEu, userId);
    const tagParceiro = tag(jidParceiro, parceiroId);
    const rotuloParceiro = parceiro?.sexo === 'mulher' ? 'sua parceira' : 'seu parceiro';

    // confirmação no grupo da brincadeira
    if (parceiroCumpriu) {
        await reply(
            `🎉 ${tagEu} cumpriu o desafio e o casal está *completo*! 💚`,
            [jidEu].filter(Boolean)
        );
    } else {
        await reply(
            `✅ ${tagEu}, seu desafio foi registrado!\nFalta ${rotuloParceiro} ${tagParceiro}. 💌`,
            [jidEu, jidParceiro].filter(Boolean)
        );
    }

    // envia para o grupo de moderação: mídia + frase
    const linhaParceiro = parceiroCumpriu
        ? `🎉 O casal completou o desafio! (${tagParceiro} já tinha cumprido)`
        : `Falta ${rotuloParceiro} ${tagParceiro}`;
    let legenda = `${tagEu} mandou seu desafio ✅\n${linhaParceiro}`;
    if (conteudo) {
        legenda += `\n\n📝 ${conteudo.length > LIMITE_LEGENDA ? conteudo.slice(0, LIMITE_LEGENDA) + '…' : conteudo}`;
    }
    try {
        await sock.sendMessage(
            GRUPO_MODERACAO,
            montarMidia(img, buffer, legenda, [jidEu, jidParceiro].filter(Boolean))
        );
    } catch (e) {
        console.error('[brincadeiraNamoro] erro ao enviar desafio para a moderação:', e.message);
    }

    // lista de status atualizada (apaga a antiga e envia a nova)
    await atualizarStatusDesafio(sock, from);
}

// ===================== #ndstatus | #nds (ADM) =====================
export async function tratarStatusDesafio(sock, message, from, jid, userId, ownerNumbers) {
    const reply = (t) => sock.sendMessage(from, { text: t }, { quoted: message });

    await garantirTabelasDesafio();

    if (!(await ehAdmin(sock, from, jid, userId, ownerNumbers))) {
        return reply('🚫 Só ADM pode usar este comando.');
    }
    if (!(await desafioAtivo(from))) return reply('🤔 Não há nenhum desafio ativo.');

    await atualizarStatusDesafio(sock, from);
    return reply('📋 Lista de status atualizada no grupo de moderação.');
}

// ===================== #vd (ADM) =====================
// Mostra a tabela de acompanhamento em tempo real no grupo onde o comando foi digitado
// (normalmente o de moderação). Sempre lê os dados do grupo principal.
export async function tratarVerDesafio(sock, message, from, jid, userId, ownerNumbers) {
    const reply = (t) => sock.sendMessage(from, { text: t }, { quoted: message });

    await garantirTabelasDesafio();

    if (!(await ehAdmin(sock, from, jid, userId, ownerNumbers))) {
        return reply('🚫 Só ADM pode usar este comando.');
    }

    const status = await montarStatus(GRUPO_PRINCIPAL);
    if (!status) return reply('🤔 Não há nenhum desafio ativo.');

    const hora = new Date().toLocaleTimeString('pt-BR', {
        hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'America/Fortaleza',
    });

    return sock.sendMessage(
        from,
        { text: `${status.texto}\n\n🕒 _Consultado às ${hora}_`, mentions: status.mentions },
        { quoted: message }
    );
}

// ===================== LISTA DE STATUS (GRUPO DE MODERAÇÃO) =====================
async function montarStatus(grupoDados) {
    const desafio = await desafioAtivo(grupoDados);
    if (!desafio) return null;

    const [casais, cumpridos] = await Promise.all([
        listarCasais(grupoDados),
        idsCumpridos(desafio.id),
    ]);

    const mentions = [];
    const contato = (j, id) => {
        if (j) { mentions.push(j); return `@${j.split('@')[0]}`; }
        return `@${id}`;
    };
    const linha = (j, id) =>
        cumpridos.has(id)
            ? `🟢 ${contato(j, id)} — desafio cumprido 💚`
            : `🔴 ${contato(j, id)} — desafio pendente ❤️`;

    const completos = casais.filter((c) => cumpridos.has(c.user_a) && cumpridos.has(c.user_b)).length;

    const blocos = casais.map((c, i) =>
        `💑 *Casal ${i + 1}*\n${linha(c.jid_a, c.user_a)}\n${linha(c.jid_b, c.user_b)}`
    );

    const texto =
        `📋 *ACOMPANHAMENTO DO DESAFIO*\n` +
        `✅ Casais completos: *${completos}* de *${casais.length}*\n\n` +
        (blocos.length ? blocos.join('\n\n') : 'Nenhum casal formado ainda.');

    return { texto, mentions };
}

// fila por destino: duas atualizações seguidas não geram duas listas ao mesmo tempo
const filas = new Map();

export function atualizarStatusDesafio(sock, grupoDados) {
    const destino = GRUPO_MODERACAO;
    const anterior = filas.get(destino) || Promise.resolve();
    const atual = anterior
        .then(() => enviarStatus(sock, grupoDados, destino))
        .catch((e) => console.error(`[brincadeiraNamoro] erro ao atualizar status do desafio em ${destino}:`, e.message));
    filas.set(destino, atual);
    return atual;
}

async function enviarStatus(sock, grupoDados, destino) {
    const status = await montarStatus(grupoDados);
    if (!status) return;

    // 1) remove a lista antiga (desafixa e apaga)
    const antigoId = await obterStatusMsgId(destino);
    if (antigoId) {
        const keyAntiga = { remoteJid: destino, fromMe: true, id: antigoId };
        if (FIXAR_STATUS) {
            try { await sock.sendMessage(destino, { pin: keyAntiga, type: 2 }); }
            catch (e) { console.error('[brincadeiraNamoro] erro ao desafixar status antigo:', e.message); }
        }
        try { await sock.sendMessage(destino, { delete: keyAntiga }); }
        catch (e) { console.error('[brincadeiraNamoro] erro ao apagar status antigo:', e.message); }
    }

    // 2) envia a nova
    const enviada = await sock.sendMessage(destino, { text: status.texto, mentions: status.mentions });
    if (!enviada?.key?.id) return;
    await salvarStatusMsgId(destino, enviada.key.id);

    // 3) fixa a nova (o bot precisa ser admin do destino ou o grupo permitir)
    if (FIXAR_STATUS) {
        try { await sock.sendMessage(destino, { pin: enviada.key, type: 1, time: DURACAO_FIXO }); }
        catch (e) { console.error(`[brincadeiraNamoro] não consegui fixar o status em ${destino} (o bot é admin?):`, e.message); }
    }
}