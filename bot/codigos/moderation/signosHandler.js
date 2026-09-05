// signosHandler.js - Versão Otimizada com apenas 3 comandos + Fotos locais (com thumbnail, igual boasVindas)
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Jimp } from 'jimp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Pasta com as fotos dos signos (bot/codigos/fotos-signos)
const PASTA_FOTOS = path.join(__dirname, '..', 'fotos-signos');

const URL_SIGNOS = 'https://raw.githubusercontent.com/lucas-nascimento06/signos-taro/refs/heads/main/signos.json';
const ADMIN_NUMBERS = ['5521972337640'];

const SIGNOS_MAP = {
    'aries': 'aries', 'áries': 'aries',
    'touro': 'touro',
    'gemeos': 'gemeos', 'gêmeos': 'gemeos',
    'cancer': 'cancer', 'câncer': 'cancer',
    'leao': 'leao', 'leão': 'leao',
    'virgem': 'virgem', 'libra': 'libra',
    'escorpiao': 'escorpiao', 'escorpião': 'escorpiao',
    'sagitario': 'sagitario', 'sagitário': 'sagitario',
    'capricornio': 'capricornio', 'capricórnio': 'capricornio',
    'aquario': 'aquario', 'aquário': 'aquario',
    'peixes': 'peixes'
};

let signos = {};
let signosCarregados = false;
let envioEmAndamento = false;

function extractDigits(number) {
    if (typeof number !== 'string') {
        console.warn('⚠️ extractDigits recebeu tipo inválido:', typeof number, number);
        return '';
    }
    let digits = number.replace(/@.*$/, '').replace(/\D/g, '');
    if (digits.length === 11 && !digits.startsWith('55')) {
        digits = '55' + digits;
    }
    return digits;
}

// ============================================
// 🖼️ RESOLUÇÃO DE IMAGENS LOCAIS
// ============================================

function obterCaminhoImagem(key) {
    const extensoes = ['.jpg', '.jpeg', '.png'];
    for (const ext of extensoes) {
        const caminho = path.join(PASTA_FOTOS, `${key}${ext}`);
        if (fs.existsSync(caminho)) {
            return caminho;
        }
    }
    return null;
}

/**
 * Gera thumbnail (mesmo esquema usado no boasVindas.js)
 */
async function gerarThumbnail(buffer, size = 256) {
    try {
        const image = await Jimp.read(buffer);
        await image.resize({ w: size, h: size });
        return await image.getBuffer("image/png");
    } catch (err) {
        console.error("❌ Erro ao gerar thumbnail:", err.message);
        return null;
    }
}

/**
 * Envia imagem com thumbnail — igual ao sendImageWithThumbnail do boasVindas.js.
 * Necessário porque no Termux o envio de imagem sem jpegThumbnail
 * às vezes não renderiza corretamente.
 */
async function sendImageWithThumbnail(sock, jid, imageBuffer, caption, options = {}) {
    try {
        let thumb = null;
        try {
            thumb = await gerarThumbnail(imageBuffer, 256);
        } catch (thumbErr) {
            console.warn("⚠️ Não foi possível gerar thumbnail, continuando sem ele:", thumbErr.message);
        }

        const messageOptions = {
            image: imageBuffer,
            caption,
        };

        if (thumb) {
            messageOptions.jpegThumbnail = thumb;
        }

        const mensagem = await sock.sendMessage(jid, messageOptions, options);
        console.log("✅ Imagem enviada" + (thumb ? " com thumbnail" : " sem thumbnail"));
        return mensagem;
    } catch (err) {
        console.error("❌ Erro ao enviar imagem:", err.message);
        try {
            const mensagem = await sock.sendMessage(jid, { text: caption }, options);
            console.log("✅ Enviado como texto (fallback)");
            return mensagem;
        } catch (fallbackErr) {
            console.error("❌ Erro no fallback:", fallbackErr.message);
            return null;
        }
    }
}

const formatarCabecalho = () =>
    'ஓீᤢ✧͢⃟ᤢ̤̤̤̤̤̤̤̤̤̤̤̤̤̤̤̤̤̣̣̣̣̣̣̣̣̣̣̣̣̣̣̣̣̣̣̣̣̣̣̼̬🔮ஓீᤢ✧͢⃟ᤢ̤̤̤̤̤̤̤̤̤̤̤̤̤̤̤̣̣̣̣̣̣̣̣̣̣̣̣̣̣̣̣̣̼̬🔮ஓீᤢ✧͢⃟ᤢ̤̤̤̤̤̤̤̤̤̤̤̤̤̤̤̤̣̣̣̣̣̣̣̣̣̣̣̣̣̣̣̣̣̣̣̣̣̣̣̣̣̣̣̣̼̬🔮\n💃 ⃝⃕፝⃟Oráculo das Damas⸵░⃟☪️\n᭥ꩌ゚໋ ꯴᩠ꦽꦼ⛓️↦᭥ꩌ゚໋ ꯴᩠ꦽꦼ⛓️↦᭥ꩌ゚໋ ꯴᩠ꦽꦼ⛓️\n𝔇𝔞𝔪𝔞𝔰 𝔡𝔞 𝔑𝔦𝔤𝔥𝔱\n🔮 ⃢───𖡜ꦽ̸ོ˚￫───ཹ🔮💃🏻 ݇-݈\n°︠︠︠︠︠︠︠︠𖡬 ᭄\n\n';

const formatarRodape = () => {
    const data = new Date().toLocaleDateString('pt-BR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const dataFormatada = data.charAt(0).toUpperCase() + data.slice(1);
    return `\n°︠︠︠︠︠︠︠︠𖡬 ᭄───𖡜ꦽ̸ོ˚￫───ཹ🔮💃\n_${dataFormatada}_\n_© Oráculo das Damas_`;
};

// ============================================
// 📥 CARREGAMENTO DOS SIGNOS
// ============================================

export async function carregarSignos() {
    try {
        console.log('🔄 Carregando signos...');

        const urlSemCache = `${URL_SIGNOS}?t=${Date.now()}`;

        const response = await fetch(urlSemCache, {
            headers: {
                'User-Agent': 'Mozilla/5.0',
                'Accept': 'application/json',
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache'
            },
            timeout: 15000
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        signos = await response.json();

        console.log('🔍 Validando estrutura dos signos...');
        let validos = 0;
        for (const [key, signo] of Object.entries(signos)) {
            if (!signo.nome || !signo.simbolo || !signo.carta || !signo.previsao || !signo.conselho) {
                console.warn(`⚠️ Signo ${key} incompleto:`, signo);
            } else {
                validos++;
            }

            if (!obterCaminhoImagem(key)) {
                console.warn(`🖼️ Sem foto local para o signo: ${key} (esperado em ${PASTA_FOTOS})`);
            }
        }

        signosCarregados = true;
        console.log(`✅ ${validos}/${Object.keys(signos).length} signos carregados com sucesso!`);
        return true;
    } catch (error) {
        console.error('❌ Erro ao carregar signos:', error.message);
        signosCarregados = false;
        throw error;
    }
}

const verificarCarregamento = () => {
    if (!signosCarregados) {
        return '⚠️ Aguarde, os signos estão sendo carregados...\nTente novamente em alguns segundos.';
    }
    return null;
};

// ============================================
// 🔐 VERIFICAÇÃO DE ADMIN
// ============================================

async function resolverNumeroReal(sock, senderJid, chatJid) {
    try {
        if (!senderJid.includes('@lid')) {
            console.log('✅ Não é LID, usando JID original:', senderJid);
            return senderJid;
        }

        console.log('🔍 Detectado LID, tentando resolver:', senderJid);

        if (chatJid.includes('@g.us')) {
            try {
                const groupMetadata = await sock.groupMetadata(chatJid);
                const participant = groupMetadata.participants.find(p => p.id === senderJid);

                if (participant) {
                    console.log('📋 Participante encontrado:', JSON.stringify(participant, null, 2));

                    if (participant.phoneNumber) {
                        console.log('✅ Número real via phoneNumber:', participant.phoneNumber);
                        return participant.phoneNumber;
                    }

                    if (participant.jid) {
                        console.log('✅ Número real via jid:', participant.jid);
                        return participant.jid;
                    }

                    if (participant.notify) {
                        console.log('✅ Número real via notify:', participant.notify);
                        return participant.notify;
                    }

                    if (participant.phone) {
                        const phoneJid = participant.phone + '@s.whatsapp.net';
                        console.log('✅ Número real via phone:', phoneJid);
                        return phoneJid;
                    }
                }
            } catch (err) {
                console.error('❌ Erro ao buscar metadados:', err.message);
            }
        }

        if (sock.store?.contacts?.[senderJid]) {
            const contact = sock.store.contacts[senderJid];
            if (contact.notify || contact.name) {
                console.log('✅ Número via store:', contact);
                return contact.id || senderJid;
            }
        }

        const lidMatch = senderJid.match(/^(\d+)@lid$/);
        if (lidMatch) {
            const possibleJid = lidMatch[1] + '@s.whatsapp.net';
            console.log('🔄 Tentando JID construído:', possibleJid);
            return possibleJid;
        }

        console.log('⚠️ Não foi possível resolver LID, usando original');
        return senderJid;

    } catch (error) {
        console.error('❌ Erro em resolverNumeroReal:', error);
        return senderJid;
    }
}

const verificarAdmin = async (sock, message) => {
    try {
        const senderJid = message.key.participant || message.key.remoteJid;
        const chatJid = message.key.remoteJid;

        const numeroReal = await resolverNumeroReal(sock, senderJid, chatJid);

        console.log('🔍 ========= Verificando Admin (Signos) =========');
        console.log('📥 Remetente JID original:', senderJid);
        console.log('📥 Número real resolvido:', numeroReal);
        console.log('📥 Chat JID:', chatJid);

        const numero = extractDigits(numeroReal);

        if (!numero) {
            console.warn('⚠️ Não foi possível extrair número válido');
            console.log('=================================================\n');
            return false;
        }

        const isAdmin = ADMIN_NUMBERS.some(adminNum => {
            const adminNumero = extractDigits(adminNum);
            console.log(`   🔍 Comparando: ${numero} === ${adminNumero}`);
            return numero === adminNumero;
        });

        console.log('🔢 Número extraído:', numero);
        console.log('🔢 Admins configurados:', ADMIN_NUMBERS);
        console.log('🎯 É admin?', isAdmin);
        console.log('=================================================\n');

        return isAdmin;
    } catch (err) {
        console.error('❌ Erro em verificarAdmin:', err);
        return false;
    }
};

// ============================================
// 📨 FUNÇÕES DE ENVIO
// ============================================

async function obterParticipantesGrupo(sock, jid) {
    try {
        if (!jid.endsWith('@g.us')) {
            console.log('⚠️ Não é um grupo, sem menções');
            return [];
        }

        const groupMetadata = await sock.groupMetadata(jid);
        const participants = groupMetadata.participants.map(p => p.id);

        console.log(`👥 ${participants.length} participantes encontrados no grupo`);
        return participants;
    } catch (error) {
        console.error('❌ Erro ao obter participantes:', error);
        return [];
    }
}

async function enviarSignosCompletos(sock, jid) {
    if (envioEmAndamento) {
        return '⚠️ Já existe um envio em andamento. Aguarde a conclusão.';
    }

    const erro = verificarCarregamento();
    if (erro) return erro;

    envioEmAndamento = true;

    try {
        const listaSignos = Object.entries(signos); // [[key, signo], ...]

        if (listaSignos.length === 0) {
            throw new Error('Nenhum signo foi carregado!');
        }

        console.log(`📊 Total de signos a enviar: ${listaSignos.length}`);
        console.log(`🔍 Primeiro signo:`, listaSignos[0][1]);

        const mentions = await obterParticipantesGrupo(sock, jid);

        console.log(`\n🏷️ ========= POSTER COM MENÇÕES =========`);
        console.log(`📱 Grupo: ${jid}`);
        console.log(`👥 Mencionando: ${mentions.length} pessoas`);
        console.log(`🕒 ${new Date().toLocaleString('pt-BR')}`);
        console.log(`========================================\n`);

        // Poster inicial com menções
        await sock.sendMessage(jid, {
            text: formatarCabecalho() +
                  `🔮 *ENVIANDO SIGNOS DO DIA* 🔮\n\n` +
                  `✨ *Aguarde envio...*` +
                  formatarRodape(),
            mentions: mentions
        });

        await new Promise(resolve => setTimeout(resolve, 2000));

        // Envia cada signo
        for (let i = 0; i < listaSignos.length; i++) {
            const [key, s] = listaSignos[i];

            if (!s.nome || !s.simbolo || !s.carta || !s.previsao || !s.conselho) {
                console.warn(`⚠️ Signo ${i} (${key}) incompleto, pulando:`, s);
                continue;
            }

            const legenda = formatarCabecalho() +
                `${s.simbolo} *${s.nome.toUpperCase()}* ${s.simbolo}\n\n` +
                `🃏 *Carta do Dia:* ${s.carta}\n\n` +
                `🌟 *Previsão:*\n${s.previsao}\n\n` +
                `💡 *Conselho:*\n${s.conselho}\n\n` +
                formatarRodape();

            const caminhoImagem = obterCaminhoImagem(key);

            if (caminhoImagem) {
                try {
                    const buffer = fs.readFileSync(caminhoImagem);
                    await sendImageWithThumbnail(sock, jid, buffer, legenda);
                } catch (err) {
                    console.error(`❌ Erro ao ler/enviar imagem de "${key}", enviando só texto:`, err.message);
                    await sock.sendMessage(jid, { text: legenda });
                }
            } else {
                console.warn(`🖼️ Imagem não encontrada para "${key}", enviando só texto.`);
                await sock.sendMessage(jid, { text: legenda });
            }

            console.log(`✅ Signo ${i + 1}/${listaSignos.length} enviado: ${s.nome}`);

            if (i < listaSignos.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }

        await new Promise(resolve => setTimeout(resolve, 2000));

        // Mensagem final
        await sock.sendMessage(jid, {
            text: formatarCabecalho() +
                  `✨ *AS DAMAS COMPLETARAM SUAS REVELAÇÕES* ✨\n\n` +
                  `🔮 _"Os astros falaram, os arcanos se manifestaram..._\n` +
                  `_As energias do universo foram reveladas."_\n\n` +
                  `🌙 *O ciclo de hoje se encerra,*\n` +
                  `*mas o véu do amanhã já se prepara para abrir...*\n\n` +
                  `💫 _Retornaremos com novas previsões quando_\n` +
                  `_o sol renascer e as estrelas dançarem novamente._\n\n` +
                  `🌟 *Que as bênçãos do Oráculo guiem seus passos!*\n\n` +
                  `🔮💃 _Até o próximo encontro, queridas Damas..._\n` +
                  formatarRodape()
        });

        envioEmAndamento = false;
        console.log('🎉 Envio de signos concluído com sucesso!');
        return null;

    } catch (error) {
        envioEmAndamento = false;
        console.error('❌ Erro no envio de signos:', error);
        throw error;
    }
}

// ============================================
// 🔍 OBTER SIGNO ESPECÍFICO
// ============================================

export function obterSigno(nome) {
    const erro = verificarCarregamento();
    if (erro) return { sucesso: false, mensagem: erro };

    const key = SIGNOS_MAP[nome.toLowerCase().trim()];
    if (!key || !signos[key]) {
        return {
            sucesso: false,
            mensagem: formatarCabecalho() +
                     '❌ *SIGNO NÃO ENCONTRADO* ❌\n\n' +
                     '🔮 _As Damas não reconhecem este signo..._\n\n' +
                     '💫 *Signos disponíveis:*\n' +
                     'Áries, Touro, Gêmeos, Câncer, Leão,\n' +
                     'Virgem, Libra, Escorpião, Sagitário,\n' +
                     'Capricórnio, Aquário, Peixes\n\n' +
                     '📝 *Use:* !signo [nome]\n' +
                     '✨ *Exemplo:* !signo aries\n' +
                     formatarRodape()
        };
    }

    const s = signos[key];

    if (!s.nome || !s.simbolo || !s.carta || !s.previsao || !s.conselho) {
        return { sucesso: false, mensagem: '❌ Signo incompleto!\n\nTente novamente ou use outro comando.' };
    }

    const msg = formatarCabecalho() +
        `${s.simbolo} *${s.nome}* ${s.simbolo}\n\n` +
        `🃏 *Carta do Dia:* ${s.carta}\n\n` +
        `🌟 *Previsão:*\n${s.previsao}\n\n` +
        `💡 *Conselho:*\n${s.conselho}\n` +
        formatarRodape();

    const caminhoImagem = obterCaminhoImagem(key);

    return { sucesso: true, imagem: caminhoImagem, mensagem: msg, signo: s };
}

// ============================================
// 🎯 HANDLER PRINCIPAL - APENAS 3 COMANDOS
// ============================================

export async function handleSignos(sock, message) {
    try {
        const texto = message.message?.conversation ||
                     message.message?.extendedTextMessage?.text ||
                     message.message?.imageMessage?.caption || '';

        if (!texto) return false;

        const cmd = texto.toLowerCase().trim();
        const jid = message.key.remoteJid;

        // ============================================
        // 1️⃣ COMANDO: #damastaro (Admin - Envio Completo)
        // ============================================
        if (cmd === '#damastaro') {
            const isAdmin = await verificarAdmin(sock, message);

            if (!isAdmin) {
                await sock.sendMessage(jid, {
                    text: formatarCabecalho() +
                          '⛔ *ACESSO NEGADO* ⛔\n\n' +
                          '🔮 *As Damas da Night protegem seus segredos...*\n\n' +
                          '❌ Você não possui permissão para acessar\n' +
                          'os mistérios sagrados do Oráculo.\n\n' +
                          '🔒 Este comando é **exclusivo** para a\n' +
                          '*Mestra do Oráculo*.\n\n' +
                          '💫 Apenas aqueles escolhidos pelas Damas\n' +
                          'podem invocar o poder completo do Tarô.\n\n' +
                          '🌙 _"Nem todos têm olhos para ver além do véu..."_\n' +
                          formatarRodape()
                }, { quoted: message });
                return true;
            }

            // Deleta o comando
            console.log('🗑️ Tentando deletar comando #damastaro...');
            try {
                await sock.sendMessage(jid, { delete: message.key });
                console.log('✅ Comando #damastaro deletado com sucesso!');
            } catch (error) {
                console.error('❌ Erro ao deletar mensagem:', error);
            }

            await new Promise(resolve => setTimeout(resolve, 1000));

            const resultado = await enviarSignosCompletos(sock, jid);
            if (resultado) {
                await sock.sendMessage(jid, { text: resultado });
            }
            return true;
        }

        // ============================================
        // 2️⃣ COMANDO: #atualizarsignos (Admin)
        // ============================================
        if (cmd === '#atualizarsignos') {
            const isAdmin = await verificarAdmin(sock, message);

            if (!isAdmin) {
                await sock.sendMessage(jid, {
                    text: formatarCabecalho() +
                          '⛔ *ACESSO NEGADO* ⛔\n\n' +
                          '🔮 *As Damas da Night protegem seus segredos...*\n\n' +
                          '❌ Você não possui permissão para acessar\n' +
                          '    os mistérios sagrados do Oráculo.\n\n' +
                          '🔒 Este comando é **exclusivo** para a\n' +
                          '    *Mestra do Oráculo*.\n\n' +
                          '💫 Apenas aqueles escolhidos pelas Damas\n' +
                          '    podem invocar o poder completo do Tarô.\n\n' +
                          '🌙 _"Nem todos têm olhos para ver além do véu..."_\n' +
                          formatarRodape()
                }, { quoted: message });
                return true;
            }

            await sock.sendMessage(jid, { text: '🔄 Atualizando signos...' }, { quoted: message });
            try {
                await carregarSignos();
                await sock.sendMessage(jid, {
                    text: formatarCabecalho() +
                          `✅ *SIGNOS ATUALIZADOS!* ✅\n\n` +
                          `📊 Total: ${Object.keys(signos).length} signos\n` +
                          `⏰ ${new Date().toLocaleString('pt-BR')}\n` +
                          formatarRodape()
                }, { quoted: message });
            } catch (error) {
                await sock.sendMessage(jid, { text: `❌ Erro ao atualizar: ${error.message}` }, { quoted: message });
            }
            return true;
        }

        // ============================================
        // 3️⃣ COMANDO: !signo [nome] (Público)
        // ============================================
        if (cmd.startsWith('!signo ')) {
            const nome = texto.substring(7).trim();
            const res = obterSigno(nome);

            if (res.sucesso && res.imagem) {
                try {
                    const buffer = fs.readFileSync(res.imagem);
                    await sendImageWithThumbnail(sock, jid, buffer, res.mensagem, { quoted: message });
                } catch (err) {
                    console.error(`❌ Erro ao ler/enviar imagem, enviando só texto:`, err.message);
                    await sock.sendMessage(jid, { text: res.mensagem }, { quoted: message });
                }
            } else {
                await sock.sendMessage(jid, { text: res.mensagem }, { quoted: message });
            }
            return true;
        }

        return false;
    } catch (error) {
        console.error('❌ Erro:', error);
        await sock.sendMessage(message.key.remoteJid, { text: `❌ Erro: ${error.message}` }, { quoted: message });
        return false;
    }
}

// Inicialização
carregarSignos().catch(err => console.error('❌ Erro na inicialização:', err));

export { verificarCarregamento as verificarSignosCarregados };