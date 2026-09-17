// Sistema AntiLink Otimizado - Redução de Falsos Positivos
// Sistema de controle de infrações para evitar duplicatas

// ✅ WHITELIST DE DOMÍNIOS PERMITIDOS
const WHITELISTED_DOMAINS = [
    'damasdanight.top',
    'www.damasdanight.top'
];

const pendingRemovals = new Map(); // { userId: { timer, violations: [], groupId } }

const getGroupInviteLink = async (sock, groupId) => {
    try {
        const inviteCode = await sock.groupInviteCode(groupId);
        return `https://chat.whatsapp.com/${inviteCode}`;
    } catch (error) {
        console.error('Erro ao obter link do grupo:', error);
        return null;
    }
};

const deleteMessage = async (sock, groupId, messageKey) => {
    const delays = [0, 100, 500, 1000, 2000, 5000];
    
    for (let i = 0; i < delays.length; i++) {
        try {
            if (delays[i] > 0) await new Promise(r => setTimeout(r, delays[i]));
            
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
            console.log(`❌ Tentativa ${i + 1} falhou`);
        }
    }
    return false;
};

const extractText = (msg) => {
    if (!msg.message) return { text: '', type: 'unknown' };
    
    const types = {
        conversation: { text: msg.message.conversation, type: 'texto' },
        extendedTextMessage: { text: msg.message.extendedTextMessage?.text, type: 'texto' },
        imageMessage: { text: msg.message.imageMessage?.caption, type: 'imagem' },
        videoMessage: { text: msg.message.videoMessage?.caption, type: 'video' },
        documentMessage: { text: msg.message.documentMessage?.caption, type: 'documento' }
    };
    
    for (const [key, value] of Object.entries(types)) {
        if (msg.message[key]) return { text: value.text || '', type: value.type };
    }
    
    return { text: '', type: 'unknown' };
};

// Função para validar se é realmente um link válido
const isValidLink = (text) => {
    // Regex mais rigoroso que exige contexto de link real
    const strictLinkRegex = /(?:https?:\/\/|www\.)[^\s<>"{}|\\^`\[\]]+\.[a-zA-Z]{2,}(?:\/[^\s<>"{}|\\^`\[\]]*)?/gi;
    
    // Regex para WhatsApp links
    const whatsappRegex = /(?:https?:\/\/)?(?:chat\.)?whatsapp\.com\/(?:invite\/)?[a-zA-Z0-9_-]+/gi;
    
    // Regex para domínios suspeitos (sem protocolo, mas com contexto)
    const suspiciousDomainRegex = /(?:^|\s|[^\w.-])([a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*\.[a-zA-Z]{2,})(?:\/[^\s]*)?(?=\s|$|[^\w.-])/gi;
    
    const links = [];
    
    // Procura por links completos (http/https/www)
    let match;
    while ((match = strictLinkRegex.exec(text)) !== null) {
        links.push(match[0]);
    }
    
    // Procura por links do WhatsApp
    while ((match = whatsappRegex.exec(text)) !== null) {
        links.push(match[0]);
    }
    
    // Procura por domínios suspeitos (mais cauteloso)
    suspiciousDomainRegex.lastIndex = 0;
    while ((match = suspiciousDomainRegex.exec(text)) !== null) {
        const domain = match[1];
        
        // Filtros para reduzir falsos positivos
        const isLikelyLink = (
            // Tem pelo menos um subdomínio
            domain.split('.').length >= 2 &&
            // Não é apenas números (como versões: 1.0, 2.5, etc.)
            !/^\d+(\.\d+)*$/.test(domain) &&
            // Não são extensões de arquivo comuns seguidas de espaço
            !/\.(jpg|jpeg|png|gif|pdf|doc|txt|mp3|mp4|zip|rar)$/i.test(domain) &&
            // Não é horário (ex: 15.30, 08.45)
            !/^\d{1,2}\.\d{1,2}$/.test(domain) &&
            // Não é data (ex: 25.12, 31.01)
            !/^\d{1,2}\.\d{1,2}(\.\d{2,4})?$/.test(domain) &&
            // Não é valor monetário (ex: 50.00)
            !/^\d+\.\d{1,2}$/.test(domain) &&
            // Não são palavras comuns com ponto no final de frase
            !/(obrigado|tchau|ola|oi|sim|nao|ok|certo|valeu)\.com$/i.test(domain) &&
            // TLD deve ser válido
            /\.(com|org|net|edu|gov|mil|int|co|br|uk|de|fr|it|es|ru|jp|cn|in|au|ca|mx|ar|cl|pe|uy|py|bo|ec|ve|cr|gt|hn|sv|ni|pa|do|cu|jm|ht|tt|bb|gd|lc|vc|ag|kn|dm|pr|vi|aw|cw|sx|bq|tc|ky|bs|bm|gl|fo|is|ie|pt|ad|mc|sm|va|mt|cy|bg|ro|hu|pl|cz|sk|si|hr|ba|rs|me|mk|al|gr|tr|by|ua|md|lt|lv|ee|fi|se|no|dk|nl|be|lu|ch|at|li|fl|io|me|tv|cc|ws|tk|ml|ga|cf|ac|sh|st|tm|gg|je|im|ai|ms|vg|as|gu|mp|pw|fm|mh|ki|nr|nu|ck|to|sb|vu|nc|pf|wf)$/i.test(domain)
        );
        
        if (isLikelyLink) {
            // Verifica se não está em contexto de conversa normal
            const beforeText = text.substring(Math.max(0, match.index - 20), match.index);
            const afterText = text.substring(match.index + match[0].length, Math.min(text.length, match.index + match[0].length + 20));
            
            // Contextos que sugerem que NÃO é um link malicioso
            const safeContexts = [
                /(?:email|e-mail|contato|site|página|página|endereço)/i.test(beforeText),
                /(?:versão|atualização|update)/i.test(beforeText),
                /(?:custou|custa|preço|valor|R\$|\$)/i.test(beforeText),
                /(?:horário|hora|às|das)/i.test(beforeText)
            ];
            
            if (!safeContexts.some(safe => safe)) {
                links.push(match[1]);
            }
        }
    }
    
    return [...new Set(links)]; // Remove duplicatas
};

const notifyAdminsAndRemoveUser = async (sock, groupId, userId, messageType, success, detectedLinks) => {
    try {
        const violationKey = `${groupId}_${userId}`;
        
        // Se já existe um registro para este usuário neste grupo
        if (pendingRemovals.has(violationKey)) {
            const existing = pendingRemovals.get(violationKey);
            
            // Adiciona a nova violação à lista
            existing.violations.push({ messageType, detectedLinks, success });
            
            console.log(`⚠️ Infração adicional detectada para ${userId.split('@')[0]} (total: ${existing.violations.length}) - Aviso já enviado`);
            return; // NÃO envia novo aviso nem cria novo timer
        }
        
        // Primeira infração - marca como "em processamento" ANTES de fazer qualquer coisa
        const violations = [{ messageType, detectedLinks, success }];
        
        // Registra imediatamente para bloquear outras chamadas
        pendingRemovals.set(violationKey, {
            timer: null,
            violations,
            groupId,
            processing: true
        });
        
        const groupData = await sock.groupMetadata(groupId);
        const admins = groupData.participants.filter(p => p.admin);
        const mentions = [userId, ...admins.map(a => a.id)];
        
        const status = success ? '✅ Mensagem removida automaticamente' : '⚠️ Remoção manual necessária';
        const emoji = { imagem: '🖼️', video: '🎥', documento: '📄' }[messageType] || '💬';
        
        let contentType = '';
        if (messageType === 'texto') {
            contentType = '🔗 Link suspeito';
        } else {
            contentType = `${emoji} ${messageType.charAt(0).toUpperCase() + messageType.slice(1)} com link`;
        }
        
        // Função para categorizar o tipo de link sem mostrar o link real
        const categorizeLinkType = (links) => {
            const types = [];
            for (const link of links) {
                const domain = link.replace(/^https?:\/\//, '').toLowerCase();
                if (domain.includes('youtube.com') || domain.includes('youtu.be')) {
                    types.push('🎥 Vídeo (YouTube)');
                } else if (domain.includes('instagram.com') || domain.includes('instagr.am')) {
                    types.push('📸 Rede Social (Instagram)');
                } else if (domain.includes('facebook.com') || domain.includes('fb.com')) {
                    types.push('👥 Rede Social (Facebook)');
                } else if (domain.includes('twitter.com') || domain.includes('t.co')) {
                    types.push('🐦 Rede Social (Twitter)');
                } else if (domain.includes('tiktok.com')) {
                    types.push('🎵 Vídeo (TikTok)');
                } else if (domain.includes('whatsapp.com')) {
                    types.push('💬 Grupo WhatsApp');
                } else if (domain.includes('telegram.')) {
                    types.push('📱 Telegram');
                } else if (domain.match(/\.(com|org|net|br|co\.uk|io|me|app)$/)) {
                    types.push('🌐 Site/Link externo');
                } else {
                    types.push('🔗 Link suspeito');
                }
            }
            return [...new Set(types)]; // Remove duplicatas
        };

        const linkTypes = categorizeLinkType(detectedLinks);

        const warningMessage = `👏🍻 *DﾑMﾑS* 💃🔥 *Dﾑ* *NIGӇԵ* 💃🎶🍾🍸

🚨 *ALERTA DE SEGURANÇA* 🚨

${status} por conter link(s) não autorizado(s).

⚠️ *POLÍTICA DO GRUPO: NENHUM LINK EXTERNO É PERMITIDO*

${contentType}
👤 *Usuário infrator:* @${userId.split('@')[0]}
🚫 *Tipo(s) detectado(s):* ${linkTypes.join(', ')}

⚠️ *ATENÇÃO ADMINISTRADORES:*
${admins.map(a => `@${a.id.split('@')[0]}`).join(', ')}

*Por medida de segurança, o usuário infrator será removido imediatamente do grupo.*

🔒 *Proteção automática ativada!*`;

        // Envia o aviso primeiro
        await sock.sendMessage(groupId, {
            text: warningMessage,
            mentions
        });

        // Aguarda 2 segundos para o aviso ser exibido, depois remove
        setTimeout(async () => {
            try {
                const violationData = pendingRemovals.get(violationKey);
                const totalViolations = violationData ? violationData.violations.length : 1;
                
                await sock.groupParticipantsUpdate(groupId, [userId], 'remove');
                
                console.log(`🚫 Usuário ${userId} removido automaticamente (${totalViolations} infração(ões))`);
            } catch (error) {
                console.error('❌ Erro ao remover usuário:', error);
                
                await sock.sendMessage(groupId, {
                    text: `⚠️ *ERRO AO REMOVER USUÁRIO*\n\nNão foi possível remover automaticamente @${userId.split('@')[0]}.\n\n*Administradores, removam manualmente por favor.*`,
                    mentions: [userId, ...admins.map(a => a.id)]
                });
            } finally {
                // Remove o registro após a remoção
                pendingRemovals.delete(violationKey);
            }
        }, 2000); // 2 segundos apenas para dar tempo de ler o aviso

        console.log(`⏱️ Remoção automática agendada para ${userId} em 2 segundos`);
    } catch (error) {
        console.error('❌ Erro ao notificar:', error);
    }
};

export const handleAntiLink = async (sock, msg, groupId) => {
    try {
        if (msg.key.fromMe) return;
        
        // Verifica se é admin
        const senderId = msg.key.participant || msg.key.remoteJid;
        const groupData = await sock.groupMetadata(groupId);
        const isAdmin = groupData.participants.find(p => p.id === senderId)?.admin;
        
        if (isAdmin) return;
        
        const { text, type } = extractText(msg);
        if (!text.trim()) return;
        
        // Usar a nova função de validação
        const detectedLinks = isValidLink(text);
        if (detectedLinks.length === 0) return;
        
        console.log(`🔍 Links detectados: ${detectedLinks.join(', ')}`);
        
        // Verifica se algum link não é do próprio grupo
        const groupLink = await getGroupInviteLink(sock, groupId);
        const groupInviteCode = groupLink?.split('/').pop();
        
        const unauthorizedLinks = detectedLinks.filter(link => {
            // Normaliza o link para comparação
            const normalizedLink = link.replace(/^https?:\/\//, '').toLowerCase();
            
            // ✅ Verifica whitelist de domínios permitidos
            if (WHITELISTED_DOMAINS.some(domain => normalizedLink.includes(domain))) {
                return false; // Link permitido
            }
            
            // Permite apenas links do próprio grupo WhatsApp
            if (normalizedLink.includes('chat.whatsapp.com') || normalizedLink.includes('whatsapp.com')) {
                // Verifica se é o link do próprio grupo
                return !normalizedLink.includes(groupInviteCode);
            }
            
            // Todos os outros links são não autorizados
            return true;
        });
        
        if (unauthorizedLinks.length > 0) {
            console.log(`🗑️ Deletando mensagem de ${senderId.split('@')[0]} - Links não autorizados: ${unauthorizedLinks.join(', ')}`);
            const success = await deleteMessage(sock, groupId, msg.key);
            setImmediate(() => notifyAdminsAndRemoveUser(sock, groupId, senderId, type, success, unauthorizedLinks));
        }
        
    } catch (error) {
        console.error('Erro no antilink:', error);
    }
};

// POLÍTICA RESTRITIVA: Nenhum link externo é permitido
// Exceções: Links do próprio grupo WhatsApp + domínios na whitelist

export const testAntiLink = async (sock, groupId) => {
    const testCases = [
        'Teste: https://exemplo.com',        // ❌ Deve detectar (link externo)
        'Visitem www.site.com.br',          // ❌ Deve detectar (link externo)
        'Olá pessoal! Custou R$ 15.50',     // ✅ NÃO deve detectar (valor)
        'Versão 2.0 chegou',                // ✅ NÃO deve detectar (versão)
        'Email: joao@empresa.com.br',       // ✅ NÃO deve detectar (contexto email)
        'Site malicioso.com aqui',          // ❌ Deve detectar (domínio suspeito)
        'youtube.com/video123',             // ❌ Deve detectar (NENHUM link externo é permitido)
        'chat.whatsapp.com/abc123',         // ❌ Deve detectar (apenas link do próprio grupo é permitido)
        'Visitem www.damasdanight.top',     // ✅ NÃO deve detectar (domínio na whitelist)
        'damasdanight.top/info'             // ✅ NÃO deve detectar (domínio na whitelist)
    ];
    
    console.log('🧪 Testando antilink - POLÍTICA RESTRITIVA com WHITELIST...');
    
    for (const [index, testText] of testCases.entries()) {
        const testMsg = {
            key: {
                remoteJid: groupId,
                fromMe: false,
                id: `test_${Date.now()}_${index}`,
                participant: '5511999999999@s.whatsapp.net'
            },
            message: { conversation: testText }
        };
        
        console.log(`\n📝 Teste ${index + 1}: "${testText}"`);
        const links = isValidLink(testText);
        console.log(`🔍 Links detectados: ${links.length > 0 ? links.join(', ') : 'Nenhum'}`);
        
        // Simula o processamento sem realmente deletar/remover
        // await handleAntiLink(sock, testMsg, groupId);
    }
};