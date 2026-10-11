// bot/codigos/handlers/command/saudacoesHandler.js
// ============================================
// 🎯 COMANDOS: #bomdia / #bd | #boatarde / #bt | #boanoite / #bn
// 📝 FUNÇÃO: Busca saudações e fotos do GitHub
// 🔗 FONTE: GitHub JSON
// ============================================

import fetch from 'node-fetch';
import axios from 'axios';
import { Jimp } from 'jimp';

const URL_SAUDACOES = 'https://raw.githubusercontent.com/lucas-nascimento06/saudacoes-gp/refs/heads/main/saudacoeshandler.json';

// ── Títulos e rodapés por período ──────────────────────────────────────────

const CONFIGS = {
    bom_dia: {
        titulo:    `☀️ 👏🍻 DﾑMﾑS 💃🔥 Dﾑ NIGӇԵ 💃🎶🍾🍸 ☀️\n┈──┈˖˚⊹ ⋆♡⋆ ⊹˚˖ ┈──┈`,
        rodape:    `☀️ © 𝔇𝔞𝔪𝔞𝔰 𝔡𝔞 𝔑𝔦𝔤𝔥𝔱 ☀️`,
        separador: `: ・ෆ・┈・┈・⊹*:ꔫ:*˖ ☀️ ⊹ ・┈・┈・ෆ・ :`,
        chave:     'bom_dia',
        chaveFoto: 'fotos_bom_dia'
    },
    boa_tarde: {
        titulo:    `🌇 👏🍻 DﾑMﾑS 💃🔥 Dﾑ NIGӇԵ 💃🎶🍾🍸 🌇\n┈──┈˖˚⊹ ⋆✴︎˚｡⋆ ⊹˚˖ ┈──┈`,
        rodape:    `🌇 © 𝔇𝔞𝔪𝔞𝔰 𝔡𝔞 𝔑𝔦𝔤𝔥𝔱 🌇`,
        separador: `: ・ෆ・┈・┈・⊹*:ꔫ:*˖ 🌇 ⊹ ・┈・┈・ෆ・ :`,
        chave:     'boa_tarde',
        chaveFoto: 'fotos_boa_tarde'
    },
    boa_noite: {
        titulo:    `🌃 👏🍻 DﾑMﾑS 💃🔥 Dﾑ NIGӇԵ 💃🎶🍾🍸 🌃\n: ・ෆ・┈・┈・⊹*:˗ˋˏ ✶ ˎˊ˗:*˖ 🌃 ⊹ ・┈・┈・ෆ・ :`,
        rodape:    `🌃 © 𝔇𝔞𝔪𝔞𝔰 𝔡𝔞 𝔑𝔦𝔤𝔥𝔱 🌃`,
        separador: `.₊̣.̩✧ *̣̩˚̣̣⁺̣‧.₊̣̇.‧⁺̣˚̣̣*̣̩⋆·̩̩.̩̥·̩̩⋆*̣̩˚̣̣⁺̣‧.₊̣̇.‧⁺̣˚̣̣*̣̩ ✧·.̩₊̣\n`,
        chave:     'boa_noite',
        chaveFoto: 'fotos_boa_noite'
    }
};

// ── Formatação em negrito ──────────────────────────────────────────────────

const negrito = (texto) =>
    texto.split('\n').map(linha =>
        linha.trim() === '' ? '' : `*${linha.replace(/\*/g, '')}*`
    ).join('\n');

// ── Estado dos dados ──────────────────────────────────────────────────────

let saudacoesData   = null;
let dadosCarregados = false;

// ── Filas sem repetição — textos e fotos por período ─────────────────────

const filas = {
    bom_dia:   [],
    boa_tarde: [],
    boa_noite: []
};

const filasFotos = {
    fotos_bom_dia:   [],
    fotos_boa_tarde: [],
    fotos_boa_noite: []
};

function embaralhar(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function reconstruirFila(chave) {
    filas[chave] = embaralhar(saudacoesData[chave]);
    console.log(`🔀 Fila [${chave}] reconstruída: ${filas[chave].length} mensagens`);
}

function reconstruirFilaFotos(chaveFoto) {
    filasFotos[chaveFoto] = embaralhar(saudacoesData[chaveFoto]);
    console.log(`🖼️ Fila [${chaveFoto}] reconstruída: ${filasFotos[chaveFoto].length} fotos`);
}

// ── Carregar JSON do GitHub ────────────────────────────────────────────────

async function carregarSaudacoes() {
    try {
        console.log('🔄 Carregando saudações...');
        const response = await fetch(URL_SAUDACOES, {
            headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data = await response.json();

        saudacoesData = {
            bom_dia:         (data.bom_dia         || []).filter(i => i && i.texto),
            boa_tarde:       (data.boa_tarde       || []).filter(i => i && i.texto),
            boa_noite:       (data.boa_noite       || []).filter(i => i && i.texto),
            fotos_bom_dia:   (data.fotos_bom_dia   || []).filter(Boolean),
            fotos_boa_tarde: (data.fotos_boa_tarde || []).filter(Boolean),
            fotos_boa_noite: (data.fotos_boa_noite || []).filter(Boolean)
        };

        dadosCarregados = true;

        reconstruirFila('bom_dia');
        reconstruirFila('boa_tarde');
        reconstruirFila('boa_noite');
        reconstruirFilaFotos('fotos_bom_dia');
        reconstruirFilaFotos('fotos_boa_tarde');
        reconstruirFilaFotos('fotos_boa_noite');

        console.log(`✅ Saudações carregadas!`);
        console.log(`   ☀️  bom_dia:   ${saudacoesData.bom_dia.length} textos | ${saudacoesData.fotos_bom_dia.length} fotos`);
        console.log(`   🌇 boa_tarde: ${saudacoesData.boa_tarde.length} textos | ${saudacoesData.fotos_boa_tarde.length} fotos`);
        console.log(`   🌃 boa_noite: ${saudacoesData.boa_noite.length} textos | ${saudacoesData.fotos_boa_noite.length} fotos`);
        return true;
    } catch (error) {
        console.error('❌ Erro ao carregar saudações:', error.message);
        dadosCarregados = false;
        return false;
    }
}

// ── Próxima mensagem da fila ───────────────────────────────────────────────

function getProximaMensagem(chave) {
    if (!dadosCarregados || !saudacoesData || saudacoesData[chave].length === 0) {
        throw new Error('Saudações não carregadas');
    }
    if (filas[chave].length === 0) {
        console.log(`🔁 Fila [${chave}] reiniciada!`);
        reconstruirFila(chave);
    }
    const item = filas[chave].shift();
    console.log(`📋 [${chave}] Restantes na fila: ${filas[chave].length}`);
    return item.texto.replace(/\*/g, '');
}

// ── Próxima foto da fila ───────────────────────────────────────────────────

function getProximaFoto(chaveFoto) {
    if (!saudacoesData || saudacoesData[chaveFoto].length === 0) return null;
    if (filasFotos[chaveFoto].length === 0) {
        console.log(`🔁 Fila de fotos [${chaveFoto}] reiniciada!`);
        reconstruirFilaFotos(chaveFoto);
    }
    const url = filasFotos[chaveFoto].shift();
    console.log(`🖼️ [${chaveFoto}] Fotos restantes: ${filasFotos[chaveFoto].length}`);
    return url;
}

// ── Baixar imagem ──────────────────────────────────────────────────────────

async function baixarImagem(url) {
    try {
        console.log(`🖼️ Baixando imagem: ${url}`);
        const res    = await axios.get(url, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(res.data, 'binary');
        console.log(`✅ Imagem baixada: ${buffer.length} bytes`);
        return buffer;
    } catch (error) {
        console.error('❌ Erro ao baixar imagem:', error.message);
        return null;
    }
}

// ── Gerar thumbnail ────────────────────────────────────────────────────────

async function gerarThumbnail(buffer, size = 256) {
    try {
        const image = await Jimp.read(buffer);
        image.scaleToFit({ w: size, h: size });
        return await image.getBuffer('image/jpeg');
    } catch (err) {
        console.error('Erro ao gerar thumbnail:', err);
        return null;
    }
}

// ── Enviar imagem com thumbnail ────────────────────────────────────────────

async function sendMediaWithThumbnail(sock, jid, buffer, caption, mentions = []) {
    try {
        const thumb = await gerarThumbnail(buffer, 256);
        await sock.sendMessage(jid, { image: buffer, caption, mentions, jpegThumbnail: thumb });
        console.log('✅ Imagem enviada com thumbnail!');
        return true;
    } catch (err) {
        console.error('❌ Erro ao enviar com thumbnail:', err.message);
        try {
            await sock.sendMessage(jid, { image: buffer, caption, mentions });
            console.log('✅ Imagem enviada sem thumbnail (fallback)!');
            return true;
        } catch (err2) {
            console.error('❌ Erro no fallback de imagem:', err2.message);
            return false;
        }
    }
}

// ── Verificar admin ────────────────────────────────────────────────────────

async function verificarAdmin(sock, jid, userId) {
    try {
        if (!jid.endsWith('@g.us')) return false;
        const groupMetadata = await sock.groupMetadata(jid);
        const participant   = groupMetadata.participants.find(p => p.id === userId);
        const isAdmin       = participant?.admin === 'admin' || participant?.admin === 'superadmin';
        console.log(`👑 ${userId} é admin: ${isAdmin}`);
        return isAdmin;
    } catch (error) {
        console.error('❌ Erro ao verificar admin:', error);
        return false;
    }
}

// ── Obter participantes ────────────────────────────────────────────────────

async function obterParticipantes(sock, jid) {
    try {
        if (!jid.endsWith('@g.us')) return [];
        const groupMetadata = await sock.groupMetadata(jid);
        const participants  = groupMetadata.participants.map(p => p.id);
        console.log(`👥 ${participants.length} participantes encontrados`);
        return participants;
    } catch (error) {
        console.error('❌ Erro ao obter participantes:', error);
        return [];
    }
}

// ── Apagar mensagem do comando no grupo ───────────────────────────────────

async function apagarMensagemComando(sock, message, from) {
    try {
        await sock.sendMessage(from, { delete: message.key });
        console.log(`🗑️ Mensagem do comando apagada`);
    } catch (error) {
        console.error('⚠️ Não foi possível apagar a mensagem do comando:', error.message);
    }
}

// ── Handler genérico (usado pelos 3 comandos) ──────────────────────────────

async function handleSaudacao(sock, message, from, tipo) {
    try {
        await sock.sendPresenceUpdate('composing', from);

        const cfg      = CONFIGS[tipo];
        const senderId = message.key.participant || message.key.remoteJid;

        console.log(`\n${cfg.titulo.split('\n')[0]}`);
        console.log(`📱 Grupo: ${from}`);
        console.log(`👤 Enviado por: ${senderId}`);

       const isAdmin  = await verificarAdmin(sock, from, senderId);

        if (!isAdmin) {
        await apagarMensagemComando(sock, message, from);
          console.log(`🚫 [${tipo}] Bloqueado: ${senderId} não é admin`);
        return;
        }

        const mentions = await obterParticipantes(sock, from);

        console.log(`👑 Admin | 👥 Mencionando: ${mentions.length} pessoas`);

        if (!dadosCarregados) await carregarSaudacoes();

        const texto = getProximaMensagem(cfg.chave);

        const caption =
            `${negrito(cfg.titulo)}\n\n` +
            `${negrito(texto)}\n\n` +
            `${cfg.separador}\n\n` +
            `${negrito(cfg.rodape)}`;

        // 🗑️ Apaga o comando antes de enviar
        await apagarMensagemComando(sock, message, from);

        // 🖼️ Tenta enviar com foto do período
        const fotoUrl    = getProximaFoto(cfg.chaveFoto);
        const fotoBuffer = fotoUrl ? await baixarImagem(fotoUrl) : null;

        if (fotoBuffer) {
            const enviado = await sendMediaWithThumbnail(sock, from, fotoBuffer, caption, mentions);
            if (!enviado) await sock.sendMessage(from, { text: caption, mentions });
        } else {
            console.log('⚠️ Sem foto disponível, enviando só texto...');
            await sock.sendMessage(from, { text: caption, mentions });
        }

        console.log(`✅ [${tipo}] enviado! Admin: ${isAdmin} | Marcados: ${mentions.length}\n`);

    } catch (error) {
        console.error(`❌ Erro no handler [${tipo}]:`, error);

        await apagarMensagemComando(sock, message, from);

        const cfg = CONFIGS[tipo];
        await sock.sendMessage(from, {
            text:
                `${negrito(cfg.titulo)}\n\n` +
                `🔧 ${negrito('ESTAMOS MELHORANDO!')} 🔧\n\n` +
                `🌸 ${negrito('Em breve retornaremos!')} 🌸\n\n` +
                `${cfg.separador}\n\n` +
                `${negrito(cfg.rodape)}`
        });
    }
}

// ── Exports: #bomdia / #bd ─────────────────────────────────────────────────

export async function handleBomDia(sock, message, args, from) {
    await handleSaudacao(sock, message, from, 'bom_dia');
}

// ── Exports: #boatarde / #bt ───────────────────────────────────────────────

export async function handleBoaTarde(sock, message, args, from) {
    await handleSaudacao(sock, message, from, 'boa_tarde');
}

// ── Exports: #boanoite / #bn ───────────────────────────────────────────────

export async function handleBoaNoite(sock, message, args, from) {
    await handleSaudacao(sock, message, from, 'boa_noite');
}

// ── Exports: #atualizarsaudacoes ───────────────────────────────────────────

export async function handleAtualizarSaudacoes(sock, message, args, from) {
    try {
        await sock.sendPresenceUpdate('composing', from);

        const senderId = message.key.participant || message.key.remoteJid;
        const isAdmin  = await verificarAdmin(sock, from, senderId);

        console.log(`\n🔄 ========= #ATUALIZARSAUDACOES =========`);
        console.log(`📱 Grupo: ${from}`);
        console.log(`👤 Enviado por: ${senderId} | Admin: ${isAdmin}`);

        await apagarMensagemComando(sock, message, from);

        if (!isAdmin) {
            await sock.sendMessage(from, {
                text:
                    `${negrito(CONFIGS.boa_noite.titulo)}\n\n` +
                    `🚫 ${negrito('Apenas administradores podem atualizar as saudações!')}\n\n` +
                    `${negrito(CONFIGS.boa_noite.rodape)}`
            });
            return;
        }

        await sock.sendMessage(from, {
            text:
                `🔄 ${negrito('Atualizando saudações...')}\n` +
                `_Buscando mensagens e fotos no repositório..._`
        });

        dadosCarregados = false;
        const sucesso = await carregarSaudacoes();

        if (sucesso) {
            await sock.sendMessage(from, {
                text:
                    `✅ ${negrito('Saudações atualizadas com sucesso!')}\n\n` +
                    `☀️ ${negrito(`bom_dia: ${saudacoesData.bom_dia.length} textos | ${saudacoesData.fotos_bom_dia.length} fotos`)}\n` +
                    `🌇 ${negrito(`boa_tarde: ${saudacoesData.boa_tarde.length} textos | ${saudacoesData.fotos_boa_tarde.length} fotos`)}\n` +
                    `🌃 ${negrito(`boa_noite: ${saudacoesData.boa_noite.length} textos | ${saudacoesData.fotos_boa_noite.length} fotos`)}\n\n` +
                    `💡 Use ${negrito('#bomdia')} • ${negrito('#boatarde')} • ${negrito('#boanoite')}`
            });
        } else {
            await sock.sendMessage(from, {
                text:
                    `❌ ${negrito('Falha ao atualizar!')}\n\n` +
                    `🔧 ${negrito('Não foi possível conectar ao repositório.')}\n` +
                    `⏳ ${negrito('Tente novamente em alguns instantes.')}`
            });
        }

    } catch (error) {
        console.error('❌ Erro no #atualizarsaudacoes:', error);
        await sock.sendMessage(from, {
            text: `❌ ${negrito('Erro inesperado!')}\n🔧 ${negrito(error.message)}`
        });
    }
}

// ── Inicializar ao carregar o módulo ──────────────────────────────────────

carregarSaudacoes().catch(err => console.error('❌ Erro na inicialização:', err));