// bot/codigos/handlers/command/brincadeiraNamoro/desafio.js
// Desafio do namoro (1 a CONFIG.LIMITE_DESAFIOS desafios, numerados):
//  - #ndesafio | #nd  (ADM)  -> posta o desafio N (poster) e, em resposta a ele, os casais + as regras
//  - #cumpri | #cumprir | #c -> cada pessoa do casal envia foto/vídeo + texto + #cumpri (vale para o desafio ativo)
//  - #ndstatus | #nds (ADM)  -> reenvia a lista de status do desafio ativo no grupo de moderação
//  - #vd (ADM)               -> status do desafio ativo | #vd 2 -> status do desafio 2 | #vd todos -> resumo geral
//
// As listas de status dos desafios ANTIGOS não são apagadas: ficam no grupo de moderação como histórico
// (desafixadas e marcadas como encerradas). Só a do desafio ativo fica fixada e é atualizada.
//
// Imagens dos desafios: pasta ./imagens/ (desafio1.jpg, desafio2.jpg ... desafio6.jpg).
// Se o ADM mandar foto/vídeo próprio, a mídia dele tem prioridade.

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { Jimp } from 'jimp';
import pool from '../../../../../db.js';
import { GRUPO_MODERACAO, GRUPO_PRINCIPAL, CONFIG } from './config.js';
import { extractDigits } from './utils.js';
import { buscarParticipante, emCasal, listarCasais } from './dados.js';

const APAGAR_ORIGINAL = true;            // true = apaga a mensagem original do ADM depois de repostar (bot precisa ser admin)
const EXIGIR_TEXTO_NO_CUMPRI = false;    // true = #cumpri só vale se tiver texto junto da foto/vídeo
const LIMITE_LEGENDA = 800;              // máximo de caracteres do texto do #cumpri repassado à moderação
const FIXAR_STATUS = true;               // true = a lista do desafio ativo fica fixada no grupo de moderação
const DURACAO_FIXO = 7 * 24 * 60 * 60;   // segundos (86400 = 24h | 604800 = 7 dias | 2592000 = 30 dias)
const THUMB_FOTO = true;                 // true = foto leva jpegThumbnail (Jimp), como na música. Se ficar embaçada: false
const THUMB_VIDEO = true;                // true = vídeo leva miniatura nítida do 1º quadro (ffmpeg + Jimp). Sem ffmpeg: sai sem miniatura
const TAMANHO_THUMB = 256;               // tamanho máximo (px) da miniatura
const NUMERO_NO_RODAPE = false;          // true = acrescenta "_🎯 Desafio N_" pequeno em itálico no fim do poster

// pasta com as imagens dos desafios: desafio1.jpg, desafio2.jpg ...
const PASTA_IMAGENS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'imagens');

// devolve o buffer da imagem do desafio N ou null se não existir.
// Mesmo modelo da música: lista a pasta e compara com regex /i, então funciona igual no PC (Windows)
// e no Termux (Linux, que diferencia maiúscula de minúscula): aceita desafio1.jpg, Desafio1.JPG,
// desafio01.png, desafio1.jpeg, desafio1.webp...
function imagemDoDesafio(numero) {
    try {
        const arquivo = fs.readdirSync(PASTA_IMAGENS).find((f) => {
            const m = f.match(/^desafio\s*0*(\d+)\.(jpe?g|png|webp)$/i);
            return m && Number(m[1]) === numero;
        });
        if (arquivo) return fs.readFileSync(path.join(PASTA_IMAGENS, arquivo));
    } catch (e) {
        console.error('[brincadeiraNamoro] erro ao ler imagem do desafio:', e.message);
    }
    return null;
}

// miniatura (jpegThumbnail) gerada com o Jimp, igual ao musicaHandler.js
async function gerarThumbnail(buffer, size = 256) {
    try {
        const image = await Jimp.read(buffer);
        image.scaleToFit({ w: size, h: size });
        return await image.getBuffer('image/jpeg');
    } catch (e) {
        console.error('[brincadeiraNamoro] erro ao gerar thumbnail:', e.message);
        return null;
    }
}

// miniatura de VÍDEO: pega o 1º quadro com o ffmpeg (fluent-ffmpeg) e reduz com o Jimp.
// Se o ffmpeg não existir ou falhar, devolve null e o vídeo segue sem miniatura (não quebra nada).
async function gerarThumbnailVideo(buffer, size = 256) {
    const base = path.join(os.tmpdir(), `namoro_${Date.now()}_${Math.random().toString(36).slice(2)}`);
    const entrada = `${base}.mp4`;
    const saida = `${base}.jpg`;
    try {
        const { default: ffmpeg } = await import('fluent-ffmpeg');
        fs.writeFileSync(entrada, buffer);
        await Promise.race([
            new Promise((resolve, reject) => {
                ffmpeg(entrada)
                    .outputOptions(['-frames:v', '1'])
                    .output(saida)
                    .on('end', resolve)
                    .on('error', reject)
                    .run();
            }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('ffmpeg demorou mais de 15s')), 15000)),
        ]);
        return await gerarThumbnail(fs.readFileSync(saida), size);
    } catch (e) {
        console.error('[brincadeiraNamoro] erro ao gerar thumbnail do vídeo:', e.message);
        return null;
    } finally {
        for (const f of [entrada, saida]) {
            try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch { /* ignora */ }
        }
    }
}

// envia a mídia já montada pelo montarMidia.
//  - Foto: jpegThumbnail gerado com o Jimp (igual à música), se THUMB_FOTO = true.
//  - Vídeo: miniatura do 1º quadro (ffmpeg + Jimp) se THUMB_VIDEO = true. Sem ela, o Baileys manda uma
//    miniatura minúscula e o vídeo aparece embaçado.
// Se o envio falhar com miniatura, tenta de novo sem ela.
// (exportado para o pedidos.js reaproveitar)
export async function enviarMidiaComThumb(sock, jid, msg, opcoes = {}) {
    let thumb = null;
    if (msg.image && THUMB_FOTO) thumb = await gerarThumbnail(msg.image, TAMANHO_THUMB);
    else if (msg.video && THUMB_VIDEO) thumb = await gerarThumbnailVideo(msg.video, TAMANHO_THUMB);

    if (!thumb) return sock.sendMessage(jid, msg, opcoes);
    try {
        return await sock.sendMessage(jid, { ...msg, jpegThumbnail: thumb }, opcoes);
    } catch (e) {
        console.error('[brincadeiraNamoro] erro ao enviar com thumbnail, tentando sem:', e.message);
        return await sock.sendMessage(jid, msg, opcoes);
    }
}

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
    // número do desafio (1, 2, 3...). Os desafios antigos recebem número pela ordem de criação.
    await pool.query(`ALTER TABLE damas_namoro_desafios ADD COLUMN IF NOT EXISTS numero INTEGER`);
    await pool.query(`
        UPDATE damas_namoro_desafios d SET numero = x.rn
        FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY grupo ORDER BY id) AS rn FROM damas_namoro_desafios) x
        WHERE d.id = x.id AND d.numero IS NULL
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

    // 1 mensagem de status POR DESAFIO no grupo de moderação (as antigas ficam como histórico)
    await pool.query(`
        CREATE TABLE IF NOT EXISTS damas_namoro_status_msgs (
            destino       TEXT        NOT NULL,
            desafio_id    BIGINT      NOT NULL,
            msg_id        TEXT        NOT NULL,
            atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (destino, desafio_id)
        )
    `);

    tabelasProntas = true;
}

// ===================== BANCO =====================
async function proximoNumero(grupo) {
    const r = await pool.query(
        `SELECT COALESCE(MAX(numero), 0) AS n FROM damas_namoro_desafios WHERE grupo = $1`,
        [grupo]
    );
    return Number(r.rows[0].n) + 1;
}

async function criarDesafio(grupo, numero, texto, tipoMidia) {
    // só um desafio ativo por grupo: o novo encerra o anterior (o anterior continua guardado)
    await pool.query(`UPDATE damas_namoro_desafios SET ativo = FALSE WHERE grupo = $1 AND ativo`, [grupo]);
    const r = await pool.query(
        `INSERT INTO damas_namoro_desafios (grupo, numero, texto, tipo_midia) VALUES ($1, $2, $3, $4) RETURNING id`,
        [grupo, numero, texto || null, tipoMidia || null]
    );
    return r.rows[0].id;
}

async function desafioAtivo(grupo) {
    const r = await pool.query(
        `SELECT id, numero, texto, ativo FROM damas_namoro_desafios
         WHERE grupo = $1 AND ativo ORDER BY id DESC LIMIT 1`,
        [grupo]
    );
    return r.rows[0] || null;
}

async function desafioPorNumero(grupo, numero) {
    const r = await pool.query(
        `SELECT id, numero, texto, ativo FROM damas_namoro_desafios WHERE grupo = $1 AND numero = $2 LIMIT 1`,
        [grupo, numero]
    );
    return r.rows[0] || null;
}

async function listarDesafios(grupo) {
    const r = await pool.query(
        `SELECT id, numero, texto, ativo FROM damas_namoro_desafios WHERE grupo = $1 ORDER BY numero`,
        [grupo]
    );
    return r.rows;
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

async function obterStatusMsgId(destino, desafioId) {
    const r = await pool.query(
        `SELECT msg_id FROM damas_namoro_status_msgs WHERE destino = $1 AND desafio_id = $2`,
        [destino, desafioId]
    );
    return r.rows[0]?.msg_id || null;
}

async function salvarStatusMsgId(destino, desafioId, msgId) {
    await pool.query(
        `INSERT INTO damas_namoro_status_msgs (destino, desafio_id, msg_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (destino, desafio_id) DO UPDATE SET msg_id = EXCLUDED.msg_id, atualizado_em = NOW()`,
        [destino, desafioId, msgId]
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

// (exportado para o pedidos.js reaproveitar)
export async function baixarMidia(message) {
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

// (exportado para o pedidos.js reaproveitar)
export function montarMidia(img, buffer, caption, mentions = []) {
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

    // número do próximo desafio (e limite)
    const numero = await proximoNumero(from);
    if (numero > CONFIG.LIMITE_DESAFIOS) {
        return reply(`🚫 O limite de *${CONFIG.LIMITE_DESAFIOS} desafios* já foi atingido. Não dá para postar o desafio ${numero}.`);
    }

    const casais = await listarCasais(from);
    if (!casais.length) return reply('💔 Ainda não há casais formados para receber o desafio.');

    let buffer = null;
    if (img) {
        buffer = await baixarMidia(message);
        if (!buffer) return reply('⚠️ Não consegui baixar a mídia. Envie de novo.');
    }

    // marca APENAS as pessoas dos casais e o ADM que postou (nunca o grupo todo)
    const mentions = [];
    const contato = (j, id) => {
        if (j) { mentions.push(j); return `@${j.split('@')[0]}`; }
        return `@${id}`;
    };
    const linhas = casais.map((c, i) =>
        `${i + 1}. ${contato(c.jid_a, c.user_a)} 💞 ${contato(c.jid_b, c.user_b)}`
    );

    // ADM que postou o desafio (marcado de verdade)
    const tagAdm = contato(jid, userId);

    // MENSAGEM 2: casais + aviso (em resposta ao poster; é a única que marca pessoas)
    const blocoCasais =
        `💑 *CASAIS DO DESAFIO ${numero}*\n${linhas.join('\n')}\n\n` +
        `*Atenção, integrantes!* Observem e leiam com atenção o *Desafio ${numero}* postado pelo ADM ${tagAdm}. 👆`;

    // MENSAGEM 3: regras (em resposta ao poster; não marca ninguém)
    const blocoRegras =
        `📋 *COMO CUMPRIR O DESAFIO ${numero}*\n\n` +
        `📸 Cada pessoa do casal deve enviar uma *foto ou vídeo acompanhado do texto*. *É OBRIGATÓRIO!* Não aceitaremos participações apenas com texto.\n\n` +
        `🤖 *Fiquem atentos ao comando do bot!* Sigam exatamente as instruções para que a participação seja validada. Qualquer dúvida, chamem um ADM!\n\n` +
        `✨ *Capriche nos desafios!* Queremos ver montagens e colagens lindas, feitas com carinho e criatividade!\n\n` +
        `✅ No final da postagem, coloquem *#c* para confirmar que realizaram o desafio ${numero}!`;

    // legenda do poster: texto do ADM (+ número pequeno em itálico, se ativado)
    const rodape = NUMERO_NO_RODAPE ? `_🎯 Desafio ${numero}_` : '';
    const legenda = [conteudo, rodape].filter(Boolean).join('\n\n');

    // guarda o desafio ativo (antes de repostar, para o número já estar valendo)
    const anterior = await desafioAtivo(from);
    const desafioId = await criarDesafio(
        from, numero, conteudo,
        img ? (String(img.mimetype || '').startsWith('video') ? 'video' : 'image') : null
    );

    // 1) POSTER DO DESAFIO (sem as orientações)
    let principal;
    if (img) {
        // o ADM mandou mídia própria: ela tem prioridade (foto leva thumbnail; vídeo segue como antes)
        const msgMidia = montarMidia(img, buffer, legenda, []);
        principal = await enviarMidiaComThumb(sock, from, msgMidia);
    } else {
        // sem mídia: usa a imagem da pasta; se não existir, manda só texto
        const padrao = imagemDoDesafio(numero);
        if (!padrao) {
            console.log(`[namoro] imagem do desafio ${numero} não encontrada em ${PASTA_IMAGENS} (enviando só texto)`);
        }
        principal = padrao
            ? await enviarMidiaComThumb(sock, from, { image: padrao, caption: legenda })
            : await sock.sendMessage(from, { text: legenda });
    }

    // 2) CASAIS + aviso (em resposta ao poster)
    const citar = principal ? { quoted: principal } : {};
    await sock.sendMessage(from, { text: blocoCasais, mentions }, citar);

    // 3) REGRAS (também em resposta ao poster, sem marcar ninguém)
    await sock.sendMessage(from, { text: blocoRegras }, citar);

    // apaga a mensagem original do ADM
    if (APAGAR_ORIGINAL) {
        try { await sock.sendMessage(from, { delete: message.key }); }
        catch (e) { console.error('[brincadeiraNamoro] não consegui apagar a mensagem original (o bot é admin?):', e.message); }
    }

    // o desafio anterior vira histórico: desafixa e marca como encerrado (NÃO apaga)
    if (anterior) await encerrarStatusAnterior(sock, from, anterior);

    // lista de status do novo desafio (todo mundo pendente) no grupo de moderação
    await atualizarStatusDesafio(sock, from);
    console.log(`[namoro] desafio ${numero} postado (id ${desafioId})`);
}

// ===================== #cumpri | #cumprir | #c =====================
export async function tratarCumpri(sock, message, from, jid, userId, img, texto) {
    const reply = (t, mentions = []) => sock.sendMessage(from, { text: t, mentions }, { quoted: message });

    await garantirTabelasDesafio();

    const eu = await buscarParticipante(from, userId);
    const casal = await emCasal(from, userId);
    if (!eu || !casal) return reply('💔 Só quem faz parte de um casal da brincadeira pode cumprir o desafio.');

    const desafio = await desafioAtivo(from);
    if (!desafio) return reply('🤔 Não há nenhum desafio ativo agora. Aguarde o ADM postar.');

    if (await jaCumpriu(desafio.id, userId)) return reply(`✅ Você já cumpriu o desafio ${desafio.numero}!`);

    if (!img) {
        return reply(`📸 Envie uma *foto* ou *vídeo* com um texto e termine a descrição com *#cumpri* (desafio ${desafio.numero}).`);
    }

    // tira #cumprir, #cumpri ou #c do texto
    const conteudo = limparComando(texto, ['cumprir', 'cumpri', 'c']);
    if (EXIGIR_TEXTO_NO_CUMPRI && !conteudo) {
        return reply('✍️ Escreva um texto junto da foto/vídeo e termine com *#cumpri*.');
    }

    const buffer = await baixarMidia(message);
    if (!buffer) return reply('⚠️ Não consegui baixar sua mídia. Envie de novo.');

    const novo = await registrarCumprimento(desafio.id, from, userId, conteudo);
    if (!novo) return reply(`✅ Você já cumpriu o desafio ${desafio.numero}!`);

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
            `🎉 ${tagEu} cumpriu o *desafio ${desafio.numero}* e o casal está *completo*! 💚`,
            [jidEu].filter(Boolean)
        );
    } else {
        await reply(
            `✅ ${tagEu}, seu *desafio ${desafio.numero}* foi registrado!\nFalta ${rotuloParceiro} ${tagParceiro}. 💌`,
            [jidEu, jidParceiro].filter(Boolean)
        );
    }

    // envia para o grupo de moderação: mídia + frase (com o número do desafio)
    const linhaParceiro = parceiroCumpriu
        ? `🎉 O casal completou o desafio! (${tagParceiro} já tinha cumprido)`
        : `Falta ${rotuloParceiro} ${tagParceiro}`;
    let legenda = `🎯 *DESAFIO ${desafio.numero}*\n${tagEu} mandou seu desafio ✅\n${linhaParceiro}`;
    if (conteudo) {
        legenda += `\n\n📝 ${conteudo.length > LIMITE_LEGENDA ? conteudo.slice(0, LIMITE_LEGENDA) + '…' : conteudo}`;
    }
    try {
        await enviarMidiaComThumb(
            sock,
            GRUPO_MODERACAO,
            montarMidia(img, buffer, legenda, [jidEu, jidParceiro].filter(Boolean))
        );
    } catch (e) {
        console.error('[brincadeiraNamoro] erro ao enviar desafio para a moderação:', e.message);
    }

    // lista de status atualizada (só a do desafio ativo)
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

// ===================== #vd | #vd 2 | #vd todos (ADM) =====================
// Mostra no grupo onde o comando foi digitado (normalmente o de moderação).
// Sempre lê os dados do grupo principal.
export async function tratarVerDesafio(sock, message, from, jid, userId, ownerNumbers, lower = '#vd') {
    const reply = (t) => sock.sendMessage(from, { text: t }, { quoted: message });

    await garantirTabelasDesafio();

    if (!(await ehAdmin(sock, from, jid, userId, ownerNumbers))) {
        return reply('🚫 Só ADM pode usar este comando.');
    }

    const arg = (lower.match(/^#vd\s+(\d{1,2}|todos)$/) || [])[1];

    const hora = new Date().toLocaleTimeString('pt-BR', {
        hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'America/Fortaleza',
    });

    // resumo de todos os desafios
    if (arg === 'todos') {
        const desafios = await listarDesafios(GRUPO_PRINCIPAL);
        if (!desafios.length) return reply('🤔 Nenhum desafio foi postado ainda.');
        const casais = await listarCasais(GRUPO_PRINCIPAL);
        const linhas = [];
        for (const d of desafios) {
            const cumpridos = await idsCumpridos(d.id);
            const completos = casais.filter((c) => cumpridos.has(c.user_a) && cumpridos.has(c.user_b)).length;
            const selo = d.ativo ? '🟢 ativo' : '🔒 encerrado';
            linhas.push(`🎯 *Desafio ${d.numero}* — ${completos}/${casais.length} casais completos (${selo})`);
        }
        return reply(
            `📚 *RESUMO DOS DESAFIOS* (${desafios.length}/${CONFIG.LIMITE_DESAFIOS})\n\n${linhas.join('\n')}\n\n` +
            `Use *#vd 1*, *#vd 2*... para ver o detalhe de cada um.\n🕒 _Consultado às ${hora}_`
        );
    }

    // desafio específico ou o ativo
    const desafio = arg ? await desafioPorNumero(GRUPO_PRINCIPAL, Number(arg)) : await desafioAtivo(GRUPO_PRINCIPAL);
    if (!desafio) {
        return reply(arg ? `🤔 O desafio ${arg} não existe.` : '🤔 Não há nenhum desafio ativo. Use *#vd todos* para ver o histórico.');
    }

    const status = await montarStatus(GRUPO_PRINCIPAL, desafio);
    return sock.sendMessage(
        from,
        { text: `${status.texto}\n\n🕒 _Consultado às ${hora}_`, mentions: status.mentions },
        { quoted: message }
    );
}

// ===================== LISTA DE STATUS (GRUPO DE MODERAÇÃO) =====================
async function montarStatus(grupoDados, desafio) {
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

    const selo = desafio.ativo ? '' : ' 🔒 _(encerrado)_';
    const texto =
        `📋 *ACOMPANHAMENTO — DESAFIO ${desafio.numero}*${selo}\n` +
        `✅ Casais completos: *${completos}* de *${casais.length}*\n\n` +
        (blocos.length ? blocos.join('\n\n') : 'Nenhum casal formado ainda.');

    return { texto, mentions };
}

// fila por destino: duas atualizações seguidas não geram duas listas ao mesmo tempo
const filas = new Map();

function naFila(destino, fn) {
    const anterior = filas.get(destino) || Promise.resolve();
    const atual = anterior
        .then(fn)
        .catch((e) => console.error(`[brincadeiraNamoro] erro no status do desafio em ${destino}:`, e.message));
    filas.set(destino, atual);
    return atual;
}

// atualiza a lista do desafio ATIVO
export function atualizarStatusDesafio(sock, grupoDados) {
    return naFila(GRUPO_MODERACAO, () => enviarStatus(sock, grupoDados, GRUPO_MODERACAO));
}

// desafio antigo: desafixa, marca como encerrado (edita o texto) e MANTÉM a mensagem no grupo
function encerrarStatusAnterior(sock, grupoDados, desafioAnterior) {
    return naFila(GRUPO_MODERACAO, async () => {
        const destino = GRUPO_MODERACAO;
        const msgId = await obterStatusMsgId(destino, desafioAnterior.id);
        if (!msgId) return;
        const key = { remoteJid: destino, fromMe: true, id: msgId };

        if (FIXAR_STATUS) {
            try { await sock.sendMessage(destino, { pin: key, type: 2 }); }
            catch (e) { console.error('[brincadeiraNamoro] erro ao desafixar status antigo:', e.message); }
        }
        try {
            const status = await montarStatus(grupoDados, { ...desafioAnterior, ativo: false });
            await sock.sendMessage(destino, { text: status.texto, mentions: status.mentions, edit: key });
        } catch (e) {
            console.error('[brincadeiraNamoro] não consegui marcar o status antigo como encerrado:', e.message);
        }
    });
}

async function enviarStatus(sock, grupoDados, destino) {
    const desafio = await desafioAtivo(grupoDados);
    if (!desafio) return;
    const status = await montarStatus(grupoDados, desafio);

    // 1) remove só a lista ANTERIOR DESTE MESMO desafio (as de outros desafios ficam)
    const antigoId = await obterStatusMsgId(destino, desafio.id);
    if (antigoId) {
        const keyAntiga = { remoteJid: destino, fromMe: true, id: antigoId };
        if (FIXAR_STATUS) {
            try { await sock.sendMessage(destino, { pin: keyAntiga, type: 2 }); }
            catch (e) { console.error('[brincadeiraNamoro] erro ao desafixar status:', e.message); }
        }
        try { await sock.sendMessage(destino, { delete: keyAntiga }); }
        catch (e) { console.error('[brincadeiraNamoro] erro ao apagar status:', e.message); }
    }

    // 2) envia a nova
    const enviada = await sock.sendMessage(destino, { text: status.texto, mentions: status.mentions });
    if (!enviada?.key?.id) return;
    await salvarStatusMsgId(destino, desafio.id, enviada.key.id);

    // 3) fixa a nova (o bot precisa ser admin do destino ou o grupo permitir)
    if (FIXAR_STATUS) {
        try { await sock.sendMessage(destino, { pin: enviada.key, type: 1, time: DURACAO_FIXO }); }
        catch (e) { console.error(`[brincadeiraNamoro] não consegui fixar o status em ${destino} (o bot é admin?):`, e.message); }
    }
}