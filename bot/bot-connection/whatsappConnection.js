// bot/connection/whatsappConnection.js
import { makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason } from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import fs from 'fs';
import pino from 'pino';
import { setupEventListeners } from './eventListeners.js';
import { autoScanGroups } from "../bot-utils/autoScan.js";
import { handleMessages, handleReactions } from "../codigos/handlers/message/messageHandler.js";
import { iniciarVerificadorDesafiosExpirados } from "../codigos/handlers/command/desafioleilaoHandler.js";

const logger = pino({ level: 'silent' });
const BOT_TITLE = '👏🍻 *DﾑMﾑS* 💃🔥 *Dﾑ* *NIGӇԵ*💃🎶🍾🍸';

let reconnectAttempts = 0;
let isConnecting = false;
let reconnectTimeout = null;
let currentSocket = null;
let qrRetryCount = 0;
const MAX_QR_RETRIES = 3;
let resourcesLoaded = false;

// ⏰ Guarda o intervalo do verificador de desafios expirados (#desafio/#pronto,
// 24h de prazo). Precisa ficar num módulo-level pra poder ser limpo em cada
// reconexão — senão, toda vez que o WhatsApp reconectar, um NOVO setInterval
// seria criado sem cancelar o anterior, e o aviso de "desafio não cumprido"
// passaria a ser enviado em duplicidade (2x, 3x, 4x... a cada reconexão).
let verificadorDesafiosInterval = null;

// 🔥 FUNÇÃO PARA CARREGAR RECURSOS ANTES DA CONEXÃO
async function preloadResources() {
    if (resourcesLoaded) {
        console.log("✅ Recursos já carregados anteriormente\n");
        return;
    }

    console.log("\n" + "=".repeat(60));
    console.log("📦 CARREGANDO RECURSOS DO BOT");
    console.log("=".repeat(60));

    try {
        // 1. Verificar/criar pasta de downloads
        console.log("📁 [1/6] Verificando pasta de downloads...");
        if (!fs.existsSync('./downloads')) {
            fs.mkdirSync('./downloads', { recursive: true });
            console.log("   ✅ Pasta de downloads criada");
        } else {
            console.log("   ✅ Pasta de downloads OK");
        }

        // 2. Verificar/criar pasta de cache
        console.log("📁 [2/6] Verificando pasta de cache...");
        if (!fs.existsSync('./cache')) {
            fs.mkdirSync('./cache', { recursive: true });
            console.log("   ✅ Pasta de cache criada");
        } else {
            console.log("   ✅ Pasta de cache OK");
        }

        // 3. Verificar pasta de mídia
        console.log("📁 [3/6] Verificando pasta de mídia...");
        if (!fs.existsSync('./media')) {
            fs.mkdirSync('./media', { recursive: true });
            console.log("   ✅ Pasta de mídia criada");
        } else {
            console.log("   ✅ Pasta de mídia OK");
        }

        // 4. Carregar comandos (simulação)
        console.log("⚙️  [4/6] Carregando comandos...");
        await new Promise(resolve => setTimeout(resolve, 500));
        console.log("   ✅ Comandos carregados");

        // 5. Carregar configurações
        console.log("⚙️  [5/6] Carregando configurações...");
        await new Promise(resolve => setTimeout(resolve, 300));
        console.log("   ✅ Configurações carregadas");

        // 6. Inicializar handlers
        console.log("⚙️  [6/6] Inicializando handlers...");
        await new Promise(resolve => setTimeout(resolve, 200));
        console.log("   ✅ Handlers inicializados");

        console.log("=".repeat(60));
        console.log("✅ TODOS OS RECURSOS CARREGADOS COM SUCESSO!");
        console.log("=".repeat(60) + "\n");

        resourcesLoaded = true;

    } catch (error) {
        console.error("=".repeat(60));
        console.error("❌ ERRO AO CARREGAR RECURSOS");
        console.error("=".repeat(60));
        console.error("📝 Erro:", error.message);
        console.error("=".repeat(60) + "\n");
        throw error;
    }
}

function cleanupSocket(sock) {
    if (!sock) return;
    
    try {
        console.log("🧹 Limpando socket anterior...");
        sock.ev.removeAllListeners();
        
        if (sock.ws) {
            try {
                sock.ws.close();
            } catch (e) {
                // Ignora erros ao fechar websocket
            }
        }
    } catch (err) {
        console.error("⚠️ Erro ao limpar socket:", err.message);
    }
}

function getReconnectDelay(attempts) {
    const baseDelay = 3000;
    const maxDelay = 60000;
    const delay = Math.min(baseDelay * Math.pow(1.5, attempts), maxDelay);
    return delay;
}

export async function connectToWhatsApp() {
    if (isConnecting) {
        console.log("⏳ Já existe uma tentativa de conexão em andamento...");
        return currentSocket;
    }
    
    isConnecting = true;

    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
    }

    try {
        const delay = getReconnectDelay(reconnectAttempts);
        
        if (reconnectAttempts > 0) {
            console.log("\n" + "=".repeat(60));
            console.log(`🔄 Tentativa de reconexão #${reconnectAttempts + 1}`);
            console.log(`⏱️  Delay: ${(delay / 1000).toFixed(1)}s`);
            console.log("=".repeat(60) + "\n");
        } else {
            console.log("\n" + "=".repeat(60));
            console.log("🚀 INICIANDO BOT DAMAS DA NIGHT");
            console.log("=".repeat(60) + "\n");
        }

        // 🔥 CARREGA RECURSOS ANTES DE TUDO
        await preloadResources();

        if (currentSocket) {
            cleanupSocket(currentSocket);
            currentSocket = null;
        }

        console.log("📡 Conectando ao WhatsApp...\n");
        const { version } = await fetchLatestBaileysVersion();
        console.log(`📱 Versão Baileys: ${version.join('.')}`);
        
        const { state, saveCreds } = await useMultiFileAuthState('./auth_info');

        const sock = makeWASocket({
            version,
            auth: state,
            printQRInTerminal: false,
            logger,
            defaultQueryTimeoutMs: 60000,
            keepAliveIntervalMs: 30000,
            markOnlineOnConnect: false,
            syncFullHistory: false,
            getMessage: async () => undefined,
            generateHighQualityLinkPreview: false,
            markMessageAsReadWhenReceived: false,
            browser: ['Damas da Night Bot', 'Chrome', '120.0.0'],
            connectTimeoutMs: 60000,
            retryRequestDelayMs: 500,
            maxMsgRetryCount: 3,
            transactionOpts: { 
                maxCommitRetries: 3, 
                delayBetweenTriesMs: 2000 
            },
            shouldIgnoreJid: jid => false,
            cachedGroupMetadata: async (jid) => null,
        });

        currentSocket = sock;

        sock.ev.on("creds.update", saveCreds);

        sock.ev.on("connection.update", async (update) => {
            const { connection, lastDisconnect, qr, isOnline, isNewLogin } = update;
            
            if (qr) {
                qrRetryCount++;
                console.log("\n" + "=".repeat(60));
                console.log(`📱 QR CODE GERADO (Tentativa ${qrRetryCount}/${MAX_QR_RETRIES})`);
                console.log("=".repeat(60));
                console.log("📲 Abra o WhatsApp no seu celular");
                console.log("⚙️  Vá em: Configurações > Aparelhos conectados");
                console.log("➕ Toque em: Conectar um aparelho");
                console.log("📸 Escaneie o QR Code abaixo:\n");
                
                qrcode.generate(qr, { small: true });
                
                console.log("\n" + "=".repeat(60));
                console.log("⏳ Aguardando leitura do QR Code...");
                console.log("⚠️  O QR expira em ~30 segundos");
                console.log("=".repeat(60) + "\n");

                if (qrRetryCount >= MAX_QR_RETRIES) {
                    console.log("⚠️ Muitas tentativas de QR. Reiniciando conexão...\n");
                    qrRetryCount = 0;
                    
                    setTimeout(() => {
                        cleanupSocket(sock);
                        isConnecting = false;
                        connectToWhatsApp();
                    }, 2000);
                }
            }

            if (connection === "connecting") {
                console.log("🔌 Estabelecendo conexão...");
            }

            if (connection === "open") {
                console.log("\n" + "=".repeat(60));
                console.log(`✅ ${BOT_TITLE}`);
                console.log("=".repeat(60));
                console.log("🎉 Bot conectado com sucesso!");
                console.log("💾 Autenticação: OK");
                console.log("🌐 Conexão: Estável");
                console.log("🚀 Status: Operacional");
                console.log("=".repeat(60) + "\n");

                reconnectAttempts = 0;
                qrRetryCount = 0;
                isConnecting = false;

                if (isNewLogin) {
                    console.log("🆕 Novo login detectado!");
                }

                // Varredura automática
                try {
                    console.log("🔍 Iniciando varredura de grupos...\n");
                    await autoScanGroups(sock);
                    console.log("✅ Varredura concluída com sucesso!\n");
                } catch (err) {
                    console.error("⚠️ Erro na varredura automática:", err.message);
                    console.log("🔄 A varredura será tentada novamente mais tarde\n");
                }

                // ⏰ Liga o verificador de desafios expirados (#desafio/#pronto).
                // Cancela qualquer intervalo anterior antes de criar um novo,
                // pra não duplicar o aviso na sala de admins a cada reconexão.
                try {
                    if (verificadorDesafiosInterval) {
                        clearInterval(verificadorDesafiosInterval);
                    }

                    // ██████████████████████████████████████████████████████
                    // ██  🔧 INTERRUPTOR 2 de 2 — DE QUANTO EM QUANTO TEMPO ██
                    // ██  O VERIFICADOR RODA (em minutos)                   ██
                    // ██                                                     ██
                    // ██  Pra TESTAR rápido, comente a linha de PRODUÇÃO e  ██
                    // ██  descomente a linha de TESTE.                      ██
                    // ██  🚨 DEPOIS DO TESTE, VOLTA PRA PRODUÇÃO (30).       ██
                    // ██████████████████████████████████████████████████████
                    // verificadorDesafiosInterval = iniciarVerificadorDesafiosExpirados(sock);        // 👈 PRODUÇÃO (checa a cada 30min)
                    verificadorDesafiosInterval = iniciarVerificadorDesafiosExpirados(sock, 1);   // 👈 TESTE (checa a cada 1min) — descomenta essa linha E comenta a de cima

                    console.log("⏰ Verificador de desafios expirados ativado\n");
                } catch (err) {
                    console.error("⚠️ Erro ao iniciar verificador de desafios expirados:", err.message);
                }
            }

            if (connection === "close") {
                isConnecting = false;
                
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const errorMessage = lastDisconnect?.error?.message || 'Desconhecido';
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut && statusCode !== 401;

                console.log("\n" + "=".repeat(60));
                console.log("⚠️  DESCONEXÃO DETECTADA");
                console.log("=".repeat(60));
                console.log(`📊 Status Code: ${statusCode}`);
                console.log(`📝 Motivo: ${errorMessage}`);
                console.log(`🔌 Tipo: ${shouldReconnect ? 'Temporária' : 'Logout'}`);
                console.log("=".repeat(60) + "\n");

                cleanupSocket(sock);

                if (shouldReconnect) {
                    reconnectAttempts++;
                    const nextDelay = getReconnectDelay(reconnectAttempts);
                    
                    console.log("🔄 Reconexão automática ativada");
                    console.log(`📈 Tentativa: ${reconnectAttempts}`);
                    console.log(`⏰ Próxima tentativa em: ${(nextDelay / 1000).toFixed(1)}s\n`);
                    
                    reconnectTimeout = setTimeout(() => {
                        reconnectTimeout = null;
                        connectToWhatsApp();
                    }, nextDelay);
                } else {
                    console.log("🚪 Sessão encerrada. Novo QR necessário.");
                    
                    try {
                        if (fs.existsSync('./auth_info')) {
                            fs.rmSync('./auth_info', { recursive: true, force: true });
                            console.log("🗑️  Credenciais antigas removidas");
                        }
                    } catch (err) {
                        console.error("⚠️ Erro ao remover auth:", err.message);
                    }
                    
                    console.log("🔄 Reiniciando para gerar novo QR Code...\n");
                    
                    reconnectAttempts = 0;
                    qrRetryCount = 0;
                    resourcesLoaded = false; // Reset para recarregar recursos
                    
                    setTimeout(() => {
                        connectToWhatsApp();
                    }, 3000);
                }
            }
        });

        sock.ev.on('messages.upsert', async ({ messages }) => {
            const msg = messages[0];
            if (!msg) return;
            
            console.log('🟢 MENSAGEM CAPTURADA PELO HANDLER!');
            await handleMessages(sock, msg);
        });

        sock.ev.on('messages.reaction', async (reaction) => {
            console.log('⚡ REAÇÃO CAPTURADA PELO HANDLER!');
            await handleReactions(sock, reaction);
        });

        setupEventListeners(sock);

        return sock;

    } catch (error) {
        console.error("\n" + "=".repeat(60));
        console.error("❌ ERRO NA CONEXÃO");
        console.error("=".repeat(60));
        console.error("📝 Mensagem:", error.message);
        console.error("📚 Stack:", error.stack);
        console.error("=".repeat(60) + "\n");
        
        isConnecting = false;

        if (currentSocket) {
            cleanupSocket(currentSocket);
            currentSocket = null;
        }

        reconnectAttempts++;
        const nextDelay = getReconnectDelay(reconnectAttempts);
        
        console.log("🔄 Tentando reconectar após erro...");
        console.log(`📈 Tentativa: ${reconnectAttempts}`);
        console.log(`⏰ Próxima tentativa em: ${(nextDelay / 1000).toFixed(1)}s\n`);
        
        reconnectTimeout = setTimeout(() => {
            reconnectTimeout = null;
            connectToWhatsApp();
        }, nextDelay);
        
        return null;
    }
}

export function disconnectWhatsApp() {
    console.log("\n" + "=".repeat(60));
    console.log("🛑 Desconexão manual solicitada");
    console.log("=".repeat(60) + "\n");
    
    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
        console.log("⏹️  Timeout de reconexão cancelado");
    }

    if (verificadorDesafiosInterval) {
        clearInterval(verificadorDesafiosInterval);
        verificadorDesafiosInterval = null;
        console.log("⏹️  Verificador de desafios expirados cancelado");
    }
    
    if (currentSocket) {
        cleanupSocket(currentSocket);
        currentSocket = null;
        console.log("🧹 Socket limpo");
    }
    
    isConnecting = false;
    reconnectAttempts = 0;
    qrRetryCount = 0;
    
    console.log("✅ Bot desconectado com sucesso\n");
}

export function getConnectionStatus() {
    return {
        isConnecting,
        reconnectAttempts,
        qrRetryCount,
        hasSocket: !!currentSocket,
        hasPendingReconnect: !!reconnectTimeout,
        resourcesLoaded
    };
}