// alertaHandler.js - Sistema de Moderação com Áudio PTT
// VERSÃO CORRIGIDA: Filtra por "tipo" e não por "comando"

import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ffmpeg from "fluent-ffmpeg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('✅ alertaHandler.js CARREGADO!');

// ============================================
// CONFIGURAÇÕES
// ============================================
const CONFIG = {
    URL_AUDIOS: 'https://raw.githubusercontent.com/lucas-nascimento06/audio-regras/refs/heads/main/audios-regras.json',
    URL_POSTER: 'https://raw.githubusercontent.com/lucas-nascimento06/audio-regras/refs/heads/main/audios-regras.json',
    DOWNLOAD_TIMEOUT: 30000,
    MAX_RETRIES: 3,
    DELAY_ENTRE_AUDIOS: 2000, // 2 segundos entre cada áudio
    DEBUG: process.env.DEBUG === 'true'
};

let audiosCache = [];
let ultimaAtualizacao = null;

// ===========================================
// CONVERSÃO DE ÁUDIO (COPIADO DO CÓDIGO DE BOAS-VINDAS)
// ===========================================

/**
 * Converte áudio para Opus
 */
async function converterParaOpus(inputBuffer) {
  return new Promise((resolve) => {
    try {
      const tempDir = path.join(__dirname, "../../../temp");
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      const timestamp = Date.now();
      const inputPath = path.join(tempDir, `input_${timestamp}.mp3`);
      const outputPath = path.join(tempDir, `output_${timestamp}.ogg`);

      fs.writeFileSync(inputPath, inputBuffer);

      console.log("🔄 Convertendo para Opus...");

      ffmpeg(inputPath)
        .audioCodec('libopus')
        .audioBitrate('48k')
        .audioChannels(1)
        .audioFrequency(48000)
        .format('ogg')
        .on('error', (err) => {
          console.warn("⚠️ FFmpeg falhou:", err.message);
          try {
            if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
            if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
          } catch (e) {}
          resolve(null);
        })
        .on('end', () => {
          try {
            if (!fs.existsSync(outputPath)) {
              console.warn("⚠️ Arquivo de saída não foi criado");
              fs.unlinkSync(inputPath);
              resolve(null);
              return;
            }

            const audioConvertido = fs.readFileSync(outputPath);
            
            try {
              fs.unlinkSync(inputPath);
              fs.unlinkSync(outputPath);
            } catch (e) {}

            console.log(`✅ Convertido para Opus: ${(audioConvertido.length / 1024).toFixed(2)} KB`);
            resolve(audioConvertido);
          } catch (error) {
            console.error("❌ Erro ao ler arquivo convertido:", error.message);
            resolve(null);
          }
        })
        .save(outputPath);

    } catch (error) {
      console.error("❌ Erro na conversão:", error.message);
      resolve(null);
    }
  });
}

/**
 * Envia áudio PTT com quote
 */
async function enviarAudioPTT(socket, groupId, audioUrl, quotedMessage, mentions = null) {
  try {
    console.log("\n========== ENVIANDO ÁUDIO PTT ==========");
    console.log("📥 Baixando:", audioUrl);
    
    const response = await axios.get(audioUrl, {
      responseType: "arraybuffer",
      timeout: CONFIG.DOWNLOAD_TIMEOUT,
      maxContentLength: 10 * 1024 * 1024,
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'audio/*'
      }
    });
    
    const audioBuffer = Buffer.from(response.data);
    
    if (audioBuffer.length === 0) {
      throw new Error("Buffer vazio");
    }
    
    console.log(`✅ Baixado: ${(audioBuffer.length / 1024).toFixed(2)} KB`);

    const sendOptions = {};
    if (quotedMessage) {
      sendOptions.quoted = quotedMessage;
      console.log("✅ Usando quote na mensagem");
    }

    // Tenta converter para Opus primeiro
    const audioOpus = await converterParaOpus(audioBuffer);

    if (audioOpus) {
      try {
        const messageOptions = {
          audio: audioOpus,
          mimetype: 'audio/ogg; codecs=opus',
          ptt: true
        };

        // Adiciona menções se fornecidas
        if (mentions && mentions.length > 0) {
          messageOptions.contextInfo = {
            mentionedJid: mentions
          };
        }

        await socket.sendMessage(groupId, messageOptions, sendOptions);

        console.log("✅ Áudio PTT (Opus) enviado!");
        console.log("====================================\n");
        return true;
      } catch (err) {
        console.log(`⚠️ Opus falhou: ${err.message}`);
      }
    }

    // Fallback MP3
    try {
      const messageOptions = {
        audio: audioBuffer,
        mimetype: 'audio/mpeg',
        ptt: true
      };

      // Adiciona menções se fornecidas
      if (mentions && mentions.length > 0) {
        messageOptions.contextInfo = {
          mentionedJid: mentions
        };
      }

      await socket.sendMessage(groupId, messageOptions, sendOptions);

      console.log("✅ Áudio PTT (MP3) enviado!");
      console.log("====================================\n");
      return true;
    } catch (err) {
      console.error(`❌ MP3 falhou: ${err.message}`);
    }

    return false;
    
  } catch (error) {
    console.error("❌ Erro ao enviar áudio:", error.message);
    return false;
  }
}

// ============================================
// GERENCIAMENTO DE ÁUDIOS
// ============================================

function converterParaRawUrl(url) {
    if (!url) return url;
    
    console.log(`🔧 URL original: ${url}`);
    
    // Remove /refs/heads/ se existir
    url = url.replace('/refs/heads/', '/');
    
    // Se já está no formato raw correto, retorna
    if (url.includes('raw.githubusercontent.com')) {
        console.log(`✅ URL raw correta: ${url}`);
        return url;
    }
    
    // Converte URL do GitHub normal para raw
    if (url.includes('github.com')) {
        const novaUrl = url
            .replace('https://github.com/', 'https://raw.githubusercontent.com/')
            .replace('/blob/', '/');
        console.log(`🔄 Convertido para raw: ${novaUrl}`);
        return novaUrl;
    }
    
    console.log(`⚠️ URL mantida sem conversão: ${url}`);
    return url;
}

async function carregarAudios(forceRefresh = false) {
    try {
        console.log(`🔄 Carregando áudios das regras...${forceRefresh ? ' (FORÇANDO ATUALIZAÇÃO)' : ''}`);
        console.log(`📡 URL: ${CONFIG.URL_AUDIOS}`);
        
        const response = await axios.get(CONFIG.URL_AUDIOS, {
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0',
                'Accept': 'application/json',
                'Cache-Control': 'no-cache'
            }
        });

        if (!response.data || !response.data.audios) {
            throw new Error('JSON inválido ou sem campo "audios"');
        }

        // ⚠️ CORREÇÃO: Filtra por "tipo": "advertencia" ao invés de "comando"
        const audiosAtivos = response.data.audios.filter(a => 
            a.ativo === true && a.tipo === 'advertencia'
        );
        
        if (audiosAtivos.length === 0) {
            console.error('❌ Nenhum áudio ativo encontrado no JSON');
            console.log('📋 Áudios disponíveis no JSON:');
            response.data.audios.forEach(a => {
                console.log(`  - ${a.nome} (tipo: ${a.tipo}, ativo: ${a.ativo})`);
            });
            return [];
        }

        const audiosCorrigidos = audiosAtivos.map(audio => ({
            ...audio,
            url: converterParaRawUrl(audio.url)
        }));

        audiosCache = audiosCorrigidos;
        ultimaAtualizacao = new Date();
        
        console.log(`✅ ${audiosCache.length} áudios carregados com sucesso!`);
        console.log('📋 Lista de áudios:');
        audiosCache.forEach((a, i) => {
            console.log(`  ${i + 1}. ${a.nome}`);
        });
        
        return audiosCache;

    } catch (error) {
        console.error('❌ Erro ao carregar áudios:', error.message);
        if (CONFIG.DEBUG) console.error(error.stack);
        return [];
    }
}

/**
 * Envia todos os áudios fazendo quote do poster
 */
async function sendAudiosComQuoteDoPoster(sock, groupId, audios, posterMessage, targetParticipant = null) {
    if (!audios || audios.length === 0) {
        console.log('⚠️ Nenhum áudio para enviar');
        return;
    }

    console.log(`🎵 Iniciando envio de ${audios.length} áudios...`);

    const mentions = targetParticipant ? [targetParticipant] : null;

    for (let i = 0; i < audios.length; i++) {
        const audio = audios[i];
        
        try {
            console.log(`\n📤 Enviando áudio ${i + 1}/${audios.length}: ${audio.nome}`);
            
            const sucesso = await enviarAudioPTT(
                sock,
                groupId,
                audio.url,
                posterMessage,
                mentions
            );

            if (sucesso) {
                console.log(`✅ Áudio ${i + 1} enviado com sucesso`);
            } else {
                console.log(`⚠️ Falha ao enviar áudio ${i + 1}`);
            }

            // Aguarda entre áudios (exceto no último)
            if (i < audios.length - 1) {
                console.log(`⏳ Aguardando ${CONFIG.DELAY_ENTRE_AUDIOS}ms...`);
                await new Promise(resolve => setTimeout(resolve, CONFIG.DELAY_ENTRE_AUDIOS));
            }
            
        } catch (error) {
            console.error(`❌ Erro ao processar áudio ${i + 1}:`, error.message);
        }
    }

    console.log('\n✅ Envio de áudios concluído!');
}

// ============================================
// DOWNLOAD DO POSTER
// ============================================

async function downloadPoster() {
    let tentativa = 0;
    
    while (tentativa < CONFIG.MAX_RETRIES) {
        try {
            tentativa++;
            console.log(`🖼️ Baixando poster (tentativa ${tentativa}/${CONFIG.MAX_RETRIES})...`);
            
            const urlCorrigida = converterParaRawUrl(CONFIG.URL_POSTER);
            console.log(`📎 URL: ${urlCorrigida}`);
            
            const response = await axios.get(urlCorrigida, {
                responseType: 'arraybuffer',
                timeout: CONFIG.DOWNLOAD_TIMEOUT,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'image/jpeg, image/jpg, image/png, image/*',
                    'Cache-Control': 'no-cache'
                },
                maxRedirects: 5,
                validateStatus: (status) => status === 200
            });

            if (!response.data || response.data.byteLength === 0) {
                throw new Error('Buffer vazio recebido');
            }

            console.log(`✅ Poster baixado: ${(response.data.byteLength / 1024).toFixed(2)} KB`);
            return Buffer.from(response.data);

        } catch (error) {
            console.error(`❌ Erro na tentativa ${tentativa}:`, error.message);
            
            if (error.response?.status === 404) {
                console.error('⚠️ ARQUIVO poster-regras.jpg NÃO ENCONTRADO (404)');
                console.error('⚠️ Verifique se o arquivo existe no repositório GitHub');
                break;
            }
            
            if (tentativa < CONFIG.MAX_RETRIES) {
                console.log(`⏳ Aguardando 2s antes da próxima tentativa...`);
                await new Promise(r => setTimeout(r, 2000));
            }
        }
    }
    
    console.error('❌ Falha ao baixar poster após todas as tentativas');
    return null;
}

// ============================================
// UTILITÁRIOS
// ============================================

async function deleteMessage(sock, groupId, messageKey) {
    const delays = [0, 100, 500, 1000, 2000, 5000];

    for (let i = 0; i < delays.length; i++) {
        try {
            if (delays[i] > 0) {
                await new Promise(r => setTimeout(r, delays[i]));
            }

            const key = {
                remoteJid: messageKey.remoteJid || groupId,
                fromMe: false,
                id: messageKey.id,
                participant: messageKey.participant
            };

            await sock.sendMessage(groupId, { delete: key });
            console.log(`✅ Mensagem deletada (tentativa ${i + 1})`);
            return true;
        } catch (error) {
            if (i === delays.length - 1) {
                console.log(`⚠️ Não foi possível deletar: ${error.message}`);
            }
        }
    }
    return false;
}

function isValidParticipant(participant) {
    if (!participant) return false;
    
    const participantNumber = participant.split('@')[0];
    return !participantNumber.includes(':') && 
           !participantNumber.startsWith('0') &&
           participantNumber.length >= 10;
}

// ============================================
// COMANDO: #atualizarregras
// ============================================

async function handleComandoAtualizarAudios(sock, message) {
    try {
        const from = message.key.remoteJid;
        console.log('🔄 Comando #atualizarregras recebido');

        await sock.sendMessage(from, {
            text: '🔄 *Atualizando áudios...*\n_Isso pode levar alguns segundos_'
        }, { quoted: message });

        const audios = await carregarAudios(true);

        if (audios && audios.length > 0) {
            const listaAudios = audios.map((a, i) => `   ${i + 1}. ${a.nome}`).join('\n');
            
            await sock.sendMessage(from, {
                text: `✅ *Áudios atualizados com sucesso!*\n\n` +
                      `🎵 *Total:* ${audios.length} áudios\n\n` +
                      `📋 *Lista atualizada:*\n${listaAudios}\n\n` +
                      `_Última atualização: ${new Date().toLocaleString('pt-BR')}_`
            }, { quoted: message });
            
            console.log('✅ Comando #atualizarregras concluído');
            return true;
        } else {
            await sock.sendMessage(from, {
                text: '❌ *Erro ao atualizar áudios!*\n\n' +
                      'Nenhum áudio do tipo "advertencia" foi encontrado no repositório.\n' +
                      'Verifique se o arquivo JSON está correto.'
            }, { quoted: message });
            
            console.error('❌ Nenhum áudio encontrado');
            return false;
        }

    } catch (error) {
        console.error('❌ Erro no comando #atualizarregras:', error);
        
        try {
            await sock.sendMessage(message.key.remoteJid, {
                text: `❌ *Erro ao atualizar!*\n\n${error.message}`
            }, { quoted: message });
        } catch (e) {}
        
        return false;
    }
}

// ============================================
// HANDLER PRINCIPAL
// ============================================

const alertaHandler = async (sock, message) => {
    try {
        const { key, message: msg } = message;
        const from = key.remoteJid;
        const sender = key.participant || key.remoteJid;

        const content = msg?.conversation 
            || msg?.extendedTextMessage?.text 
            || msg?.imageMessage?.caption 
            || msg?.videoMessage?.caption 
            || msg?.documentMessage?.caption 
            || '';

        const contentTrimmed = content.toLowerCase().trim();

        console.log(`\n🔍 alertaHandler | Conteúdo: "${contentTrimmed}"`);

        // Comando de atualização
        if (contentTrimmed === '#atualizarregras') {
            console.log('✅ Processando #atualizarregras');
            return await handleComandoAtualizarAudios(sock, message);
        }

        // Verifica se é comando #alerta
        if (!content.includes('#alerta')) {
            console.log('⏭️ Não é comando #alerta, ignorando');
            return false;
        }

        console.log('✅ Processando #alerta');

        // Verifica se é grupo
        if (!from.includes('@g.us')) {
            await sock.sendMessage(from, {
                text: '⚠️ *Este comando só funciona em grupos!*'
            }, { quoted: message });
            return true;
        }

        // Carrega áudios
        const audios = audiosCache.length > 0 ? audiosCache : await carregarAudios();
        
        if (!audios || audios.length === 0) {
            await sock.sendMessage(from, {
                text: '❌ *Áudios não disponíveis.*\n\n' +
                      'Tente usar *#atualizarregras* primeiro.'
            }, { quoted: message });
            return true;
        }

        // Verifica se é admin
        const groupMetadata = await sock.groupMetadata(from);
        const isAdmin = groupMetadata.participants.some(
            p => p.id === sender && (p.admin === 'admin' || p.admin === 'superadmin')
        );

        if (!isAdmin) {
            await sock.sendMessage(from, {
                text: '🚫 *Somente administradores podem usar este comando!*'
            }, { quoted: message });
            return true;
        }

        // Identifica alvo
        let targetMessageId = null;
        let targetParticipant = null;

        const contextInfo = msg?.extendedTextMessage?.contextInfo 
            || msg?.imageMessage?.contextInfo 
            || msg?.videoMessage?.contextInfo 
            || msg?.documentMessage?.contextInfo;

        if (contextInfo?.stanzaId && contextInfo?.participant) {
            if (isValidParticipant(contextInfo.participant)) {
                targetMessageId = contextInfo.stanzaId;
                targetParticipant = contextInfo.participant;
            }
        }

        // ============================================
        // CASO 1: ALERTA GERAL (SEM RESPOSTA)
        // ============================================
        if (!targetMessageId || !targetParticipant) {
            console.log('📢 ALERTA GERAL para o grupo');

            // Deleta comando
            await deleteMessage(sock, from, {
                remoteJid: from,
                id: key.id,
                participant: sender
            });

            // Baixa e envia poster (ou mensagem de texto se falhar)
            const posterBuffer = await downloadPoster();
            let posterMessage;
            
            if (posterBuffer) {
                posterMessage = await sock.sendMessage(from, {
                    image: posterBuffer,
                    caption: '📢 *ATENÇÃO MEMBROS DO GRUPO*\n\n🎵 _Ouçam os áudios das regras abaixo_'
                });
                console.log('✅ Poster enviado');
            } else {
                // Fallback: mensagem de texto
                posterMessage = await sock.sendMessage(from, {
                    text: '📢 *ATENÇÃO MEMBROS DO GRUPO*\n\n🎵 _Ouçam os áudios das regras abaixo_'
                });
                console.log('✅ Mensagem de texto enviada (fallback)');
            }

            // Envia áudios
            await sendAudiosComQuoteDoPoster(sock, from, audios, posterMessage);

            return true;
        }

        // ============================================
        // CASO 2: ADVERTÊNCIA INDIVIDUAL (COM RESPOSTA)
        // ============================================
        console.log('🎯 ADVERTÊNCIA INDIVIDUAL');

        let targetName = targetParticipant.split('@')[0];
        const participant = groupMetadata.participants.find(p => p.id === targetParticipant);
        
        if (participant) {
            targetName = participant.notify || participant.verifiedName || participant.name || targetName;
        }

        // Deleta mensagem do infrator
        const deleted = await deleteMessage(sock, from, {
            remoteJid: from,
            id: targetMessageId,
            participant: targetParticipant
        });

        if (deleted) {
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        // Deleta comando do admin
        await deleteMessage(sock, from, {
            remoteJid: from,
            id: key.id,
            participant: sender
        });

        // Baixa e envia poster (ou mensagem de texto se falhar)
        const posterBuffer = await downloadPoster();
        let posterMessage;
        
        if (posterBuffer) {
            posterMessage = await sock.sendMessage(from, {
                image: posterBuffer,
                caption: `🚨 *@${targetName}*\n\n` +
                         `⚠️ _Sua mensagem foi removida por conter conteúdo proibido._\n\n` +
                         `🎵 _Ouça atentamente os áudios das regras abaixo_`,
                mentions: [targetParticipant]
            });
            console.log(`✅ Poster enviado para @${targetName}`);
        } else {
            // Fallback: mensagem de texto
            posterMessage = await sock.sendMessage(from, {
                text: `🚨 *@${targetName}*\n\n` +
                      `⚠️ _Sua mensagem foi removida por conter conteúdo proibido._\n\n` +
                      `🎵 _Ouça atentamente os áudios das regras abaixo_`,
                mentions: [targetParticipant]
            });
            console.log(`✅ Mensagem de texto enviada para @${targetName} (fallback)`);
        }

        // Envia áudios
        await sendAudiosComQuoteDoPoster(sock, from, audios, posterMessage, targetParticipant);

        return true;

    } catch (error) {
        console.error('❌ Erro no alertaHandler:', error);
        if (CONFIG.DEBUG) console.error(error.stack);
        return false;
    }
};

// ============================================
// INICIALIZAÇÃO
// ============================================
console.log('🚀 Inicializando alertaHandler...');
carregarAudios().then(audios => {
    if (audios && audios.length > 0) {
        console.log('✅ alertaHandler pronto!');
        console.log(`📊 ${audios.length} áudios carregados`);
    } else {
        console.warn('⚠️ Nenhum áudio carregado na inicialização');
        console.warn('⚠️ Verifique o JSON e certifique-se que existem áudios com tipo: "advertencia"');
    }
}).catch(error => {
    console.error('❌ Erro ao inicializar:', error.message);
});

// ============================================
// EXPORTAÇÕES
// ============================================
export default alertaHandler;
export { 
    alertaHandler,
    carregarAudios,
    sendAudiosComQuoteDoPoster
};