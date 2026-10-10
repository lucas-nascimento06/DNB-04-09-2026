// bot/codigos/moderation/antiflood.js
// Anti-spam. Pune quem (não sendo admin/dono/whitelist):
//   1) manda muita mídia (fotos, vídeos, figurinhas, áudios) em sequência;
//   2) manda muitas mensagens de texto em sequência ou a MESMA mensagem várias vezes;
//   3) manda mensagem de TRAVA (texto gigante, caracteres invisíveis, contato/localização/enquete
//      malformados, tipos de mensagem que usuário comum não manda) - inclusive se for EDITADA depois;
//   4) manda link/convite de OUTRO grupo de WhatsApp;
//   5) manda comando de OUTRO bot (!menu, .s, /play...) que não existe no nosso bot.
// Manda o número para a blacklist (com motivo) e avisa os admins.

import { addToBlacklist } from './blacklist/blacklistFunctions.js';

export const CONFIG = {
    enabled: true,

    // MODO TESTE: true = só registra no console quem SERIA punido, sem remover ninguém.
    // Use por alguns dias antes de ligar para valer (troque para false).
    modoTeste: false,

    // Números que nunca são punidos (só dígitos, com DDI).
    // Admins do grupo e os OWNER_NUMBERS (passados pelo messageHandler) já são ignorados.
    whitelist: [
        // '5585999999999',
    ],

    // Cada regra: se a pessoa mandar MAIS que "max" mensagens desses tipos dentro de "janelaMs", é removida.
    // Tipos: image, video, sticker, audio, document, text
    rules: [
        { nome: 'fotos/vídeos',      tipos: ['image', 'video'], max: 3, janelaMs: 12000 },
        { nome: 'figurinhas',        tipos: ['sticker'],        max: 4, janelaMs: 12000 },
        { nome: 'áudios/músicas',    tipos: ['audio'],          max: 3, janelaMs: 20000 },
        { nome: 'mídia geral',       tipos: ['image', 'video', 'sticker', 'audio', 'document'], max: 4, janelaMs: 12000 },
        // Spam "lento": pouca coisa por vez, mas constante.
        // Atenção: max 4 em 1 min pode pegar conversa animada com figurinhas. Se der falso positivo, aumente.
        // (áudio fica de fora: ele tem a regra própria "audioLote" abaixo, que permite 3 músicas e depois um intervalo)
        { nome: 'mídia (1 min)',     tipos: ['image', 'video', 'sticker', 'document'], max: 4, janelaMs: 60000 },
        // Flood de texto. Comandos do bot (#...) não entram na conta.
        // Conversa normal rápida não passa de ~5 mensagens em 10s; ajuste se necessário.
        { nome: 'mensagens de texto', tipos: ['text'],          max: 8, janelaMs: 10000 },
    ],

    // Lote de músicas: pode mandar "tamanho" músicas seguidas (dentro de "janelaMs"). Ao completar o lote, o bot avisa
    // e a pessoa precisa esperar "intervaloMs" para mandar uma nova sequência desse tamanho.
    // Nesse intervalo ela pode mandar 1 ou 2 músicas normalmente; uma nova sequência de 3 seguidas é removida.
    // ("tamanho" deve ser igual ao max da regra 'áudios/músicas' acima)
    audioLote: { enabled: true, tamanho: 3, janelaMs: 20000, intervaloMs: 180000, avisar: true },

    // A MESMA mensagem repetida várias vezes (ex.: "oi" x30, propaganda colada de novo e de novo)
    repeticao: { enabled: true, max: 5, janelaMs: 30000 },

    // ---------- Mensagens de TRAVA ----------
    bloquearTrava: true,
    travaMaxCaracteres: 3000,   // qualquer campo de texto maior que isso (texto, legenda, vCard, nome...) é trava
    travaMaxInvisiveis: 30,     // quantidade de caracteres invisíveis / zero-width
    travaMaxContatos: 10,       // contatos em uma mesma mensagem
    // Tipos de mensagem que um usuário comum NÃO consegue mandar pelo WhatsApp normal
    // (botões, listas, templates, pedidos...). Costumam ser trava feita por bot/cliente modificado.
    bloquearTiposEstranhos: true,

    // ---------- Link/convite de OUTRO grupo ----------
    bloquearConviteGrupo: true,
    acaoConviteGrupo: 'remover',   // 'remover' (remove + blacklist) ou 'apagar' (só apaga a mensagem)

    // ---------- Comandos de OUTROS bots ----------
    bloquearComandos: true,
    // Prefixos que indicam "comando de bot". Seu bot usa '#', então ele entra aqui:
    // qualquer #comando que NÃO esteja em comandosPermitidos é tratado como intruso.
    // (Não coloque *, ~ ou + : são usados em negrito/riscado/telefone no WhatsApp.)
    prefixosBloqueados: ['#', '!', '.', '/', '$', '&', '%'],

    // Prefixo do SEU bot.
    prefixoBot: '#',

    // Erro de digitação (#pefil, #gaod, #empretar...): se o comando for parecido com um comando REAL
    // (1-2 letras de diferença), ninguém é punido e a mensagem passa normalmente.
    toleranciaDigitacao: true,

    // O que fazer com "#algo" que NÃO existe no bot e NÃO parece erro de digitação (ex.: #vibeboa):
    //   'apagar'  = só apaga a mensagem, sem remover ninguém (recomendado)
    //   'remover' = remove + blacklist
    //   'ignorar' = não faz nada
    // Comandos de OUTROS prefixos (!menu, .s, /play) e travas sempre removem.
    acaoHashtagDesconhecida: 'apagar',

    // Comandos REAIS do seu bot (com prefixo). Comando novo no bot = adicione aqui!
    comandosPermitidos: [
        ...('a addlista adv ajuda ajudadc alerta all arrematar ativar ativos atualizaraudios ' +
        'atualizarmusicas atualizarperfil atualizarpoemas atualizarregras atualizarsaudacoes ' +
        'atualizarsignos ban bd bebado bn boanoite boatarde bomdia bt c chm closegp comando ' +
        'comandos contato contatos dad dados damasdanight damastaro dc dcasal dchelp desafio ' +
        'dmabrir dmfechar dmlukownner dmparar dp emprestar f fecharleilao fl gado golpe h homens ' +
        'hor horoscopo inativos infolista l lance lcmd leilao letra limparmusicas limpartimes ' +
        'lista m msn mulheres n next noiteperfeita not ok opengp pausar perfil play play30dc poe ' +
        'poema poemas poster promover proxima r rainhadamas rankdamas rdc rebaixar rec regras ' +
        'remlista resetardc resetarleil resetarleilao resetartudo rl rlink rmsn s salva signos ' +
        'status stk sv time times totag varredura veriflista verilista vip ' +
        'add amizade avisarconfissoes aviso confissao confissoes dm dmusical paquera ' +
        'postarconfissoes pote pronto recusar romancenoar leil dadis dadoss dadus dasos')
            .split(' ').map(c => '#' + c),
        '!gado', '!bebado',
    ],

    apagarMensagens: true,          // apaga as mensagens do infrator
    avisarNoGrupo: true,            // manda aviso no grupo depois de remover
    adicionarBlacklist: true,       // grava o número na blacklist (tabela que o #addlista usa)
    grupoAvisoAdmins: '120363409228091157@g.us', // GRUPO_ADMINS; deixe '' para não avisar
    bloqueioPosRemocaoMs: 180000,   // por 3 min, qualquer mensagem que ainda chegue dele é apagada
    avisarBloqueioPosRemocao: true, // avisa 1x no grupo se a pessoa VOLTAR (ou continuar) e mandar algo durante o bloqueio
    avisoPosRemocaoAposMs: 15000,   // só avisa se a mensagem chegar mais de 15s depois da remoção (ignora o flood em andamento)
    punirNovamenteNoBloqueio: true, // se a pessoa voltar/continuar e fizer flood de novo DURANTE o bloqueio, remove de novo (usa o mesmo prazo acima)
    delayEntreDeletesMs: 300,       // evita flood de deletes (risco de ban do número)
};

const MAX_JANELA = Math.max(
    ...CONFIG.rules.map(r => r.janelaMs),
    CONFIG.repeticao?.enabled ? CONFIG.repeticao.janelaMs : 0,
    CONFIG.audioLote?.enabled ? CONFIG.audioLote.janelaMs : 0,
);

// Só guarda mensagens de texto no histórico se existir alguma regra que use o tipo 'text'
const RECORDA_TEXTO = CONFIG.rules.some(r => r.tipos.includes('text')) || !!CONFIG.repeticao?.enabled;

// Comandos permitidos em minúsculo (o bot usa startsWith, então "#playxyz" também funciona nele)
const PERMITIDOS = CONFIG.comandosPermitidos.map(c => c.toLowerCase());

// Regex: prefixo (1-2 chars) + palavra que começa com letra (pode ter só 1 letra, como ".s" ou "!p"),
// seguida de espaço ou fim do texto.
// Ex.: "!menu", ".sticker", ".s", "#xyz". Não pega "." sozinho, "$100", "+5585...", "kkk", nem "*negrito*".
const escClasse = CONFIG.prefixosBloqueados.map(p => p.replace(/[\\\]\^\-]/g, '\\$&')).join('');
const REGEX_COMANDO = new RegExp('^([' + escClasse + ']{1,2})([a-zA-Z][a-zA-Z0-9_]*)(?=\\s|$)');

// Caracteres invisíveis / zero-width / espaços "vazios" usados em travas
const REGEX_INVISIVEL = /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\u2800\u3164\u115F\u1160]/g;
// Mais de 15 acentos/marcas combinantes empilhados (texto "zalgo")
const REGEX_EMPILHADO = /[\u0300-\u036F]{15,}/;
// Link/convite de grupo de WhatsApp
const REGEX_CONVITE = /(?:chat\.whatsapp\.com|whatsapp\.com\/invite)\/[A-Za-z0-9_-]{10,}/i;

// Tipos de mensagem que usuário comum não manda (só bots / clientes modificados).
// Obs.: respostas a botões (buttonsResponseMessage etc.) NÃO estão aqui de propósito.
const TIPOS_ESTRANHOS = [
    'buttonsMessage', 'listMessage', 'templateMessage', 'interactiveMessage',
    'orderMessage', 'productMessage', 'requestPaymentMessage',
];

const historico = new Map();     // "grupo:user" -> [{ t, tipo, key, texto }]
const punidos = new Map();       // "grupo:user" -> timestamp de expiração
const cacheMeta = new Map();     // grupo -> { t, promise }
const filaDelete = new Map();    // grupo -> Promise (fila sequencial)
const avisoSemAdmin = new Map(); // grupo -> último log "bot não é admin"
const avisadosPunido = new Set(); // "grupo:user" -> já avisou nesta punição (aviso do bloqueio pós-remoção)
const removidoEm = new Map();    // "grupo:user" -> timestamp em que a remoção terminou
const loteAudioAte = new Map();  // "grupo:user" -> timestamp até quando vale o intervalo após um lote de músicas

const soNumero = (jid = '') => String(jid).split('@')[0].split(':')[0];
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Desembrulha viewOnce / efêmera / documento com legenda / MENSAGEM EDITADA
// e devolve o conteúdo real. "edicao" = true se a mensagem é uma edição de outra.
function desembrulhar(msg) {
    let m = msg.message;
    let edicao = false;
    if (!m) return { m: null, edicao };
    for (let i = 0; i < 5; i++) {
        const pm = m.protocolMessage || m.editedMessage?.message?.protocolMessage;
        if (pm?.editedMessage) {
            m = pm.editedMessage;
            edicao = true;
            continue;
        }
        const inner =
            m.ephemeralMessage?.message ||
            m.viewOnceMessage?.message ||
            m.viewOnceMessageV2?.message ||
            m.viewOnceMessageV2Extension?.message ||
            m.documentWithCaptionMessage?.message;
        if (!inner) break;
        m = inner;
    }
    return { m, edicao };
}

// Quais mensagens apagar: a própria; ou, se for edição, a mensagem ORIGINAL que foi editada
function chavesParaApagar(msg, groupJid, user) {
    const pm = msg.message?.protocolMessage || msg.message?.editedMessage?.message?.protocolMessage;
    if (pm?.editedMessage && pm.key?.id) {
        return [{ remoteJid: groupJid, fromMe: false, id: pm.key.id, participant: user }];
    }
    return [msg.key];
}

// Descobre o tipo de mídia da mensagem
function getTipo(m) {
    if (!m) return null;
    if (m.imageMessage) return 'image';
    if (m.videoMessage || m.ptvMessage) return 'video';
    if (m.stickerMessage) return 'sticker';
    if (m.audioMessage) return 'audio';
    if (m.documentMessage) return 'document';
    return null; // texto etc. não conta como mídia
}

// Texto principal da mensagem (inclui legendas) - usado para comandos e flood de texto
function getTexto(m) {
    if (!m) return '';
    return m.conversation ||
        m.extendedTextMessage?.text ||
        m.imageMessage?.caption ||
        m.videoMessage?.caption ||
        m.documentMessage?.caption ||
        '';
}

// TODOS os campos de texto que podem esconder trava (texto, legenda, vCard, nome, localização, enquete...)
function coletarTextos(m) {
    const out = [];
    const add = v => { if (typeof v === 'string' && v) out.push(v); };

    add(m.conversation);
    const ext = m.extendedTextMessage;
    if (ext) { add(ext.text); add(ext.title); add(ext.description); add(ext.matchedText); }
    add(m.imageMessage?.caption);
    add(m.videoMessage?.caption);
    add(m.documentMessage?.caption);
    add(m.documentMessage?.fileName);

    const c = m.contactMessage;
    if (c) { add(c.displayName); add(c.vcard); }
    for (const x of m.contactsArrayMessage?.contacts || []) { add(x.displayName); add(x.vcard); }

    const loc = m.locationMessage || m.liveLocationMessage;
    if (loc) { add(loc.name); add(loc.address); add(loc.comment); add(loc.caption); }

    const poll = m.pollCreationMessage || m.pollCreationMessageV2 || m.pollCreationMessageV3;
    if (poll) {
        add(poll.name);
        for (const o of poll.options || []) add(o.optionName);
    }
    return out;
}

// Distância de edição (Damerau-Levenshtein): conta troca, falta, sobra e letras trocadas de lugar
// ("gaod" -> "gado" = 1, "pefil" -> "perfil" = 1)
function distancia(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            const custo = a[i - 1] === b[j - 1] ? 0 : 1;
            d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + custo);
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
                d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
            }
        }
    }
    return d[a.length][b.length];
}

// true se "nome" (sem prefixo) é parecido com algum comando real que usa o mesmo prefixo
function pareceErroDeDigitacao(prefixo, nome) {
    const p = prefixo[0];
    const maxDist = nome.length <= 4 ? 1 : 2; // nomes curtos: tolerância menor
    return PERMITIDOS.some(c => {
        if (c[0] !== p) return false;
        const real = c.slice(1);
        return Math.abs(real.length - nome.length) <= maxDist && distancia(real, nome) <= maxDist;
    });
}

// Procura sinais de trava nos campos de texto. Retorna descrição ou null.
function analisarTextosTrava(textos) {
    for (const t of textos) {
        if (t.length > CONFIG.travaMaxCaracteres) return 'texto gigante';
        if ((t.match(REGEX_INVISIVEL) || []).length > CONFIG.travaMaxInvisiveis) return 'caracteres invisíveis';
        if (REGEX_EMPILHADO.test(t)) return 'caracteres empilhados';
    }
    return null;
}

// Retorna { motivo, acao, titulo } se a mensagem é trava, convite de grupo ou comando de outro bot; senão null.
// acao: 'remover' (remove + blacklist) ou 'apagar' (só apaga a mensagem)
function detectarGatilho(m) {
    if (!m) return null;
    const textos = coletarTextos(m);

    if (CONFIG.bloquearTrava) {
        const trava = motivo => ({ motivo: `mensagem de trava (${motivo})`, acao: 'remover', titulo: 'TRAVA' });

        const t = analisarTextosTrava(textos);
        if (t) return trava(t);

        if ((m.contactsArrayMessage?.contacts?.length || 0) > CONFIG.travaMaxContatos) return trava('contatos demais');

        const poll = m.pollCreationMessage || m.pollCreationMessageV2 || m.pollCreationMessageV3;
        if (poll && (poll.options?.length || 0) > 12) return trava('enquete com opções demais');

        if (CONFIG.bloquearTiposEstranhos) {
            const estranho = TIPOS_ESTRANHOS.find(k => m[k]);
            if (estranho) return trava(`tipo suspeito: ${estranho}`);
        }
    }

    if (CONFIG.bloquearConviteGrupo) {
        if (m.groupInviteMessage || textos.some(t => REGEX_CONVITE.test(t))) {
            return {
                motivo: 'link de convite de outro grupo',
                acao: CONFIG.acaoConviteGrupo === 'apagar' ? 'apagar' : 'remover',
                titulo: 'LINK DE CONVITE',
            };
        }
    }

    if (CONFIG.bloquearComandos) {
        const mt = getTexto(m).trimStart().match(REGEX_COMANDO);
        if (mt) {
            const cmd = (mt[1] + mt[2]).toLowerCase();
            // Igual ao bot (que usa startsWith): exato, ou começa com comando de 4+ letras (5+ contando o prefixo)
            const ok = PERMITIDOS.some(c => cmd === c || (c.length >= 5 && cmd.startsWith(c)));
            if (!ok) {
                // Erro de digitação de comando real (#pefil, #gaod...): nunca pune, deixa passar
                if (CONFIG.toleranciaDigitacao && pareceErroDeDigitacao(mt[1], mt[2].toLowerCase())) return null;

                const cmdCurto = cmd.slice(0, 30);
                // "#algo" desconhecido (prefixo do nosso bot): ação configurável, por padrão só apaga
                if (mt[1].startsWith(CONFIG.prefixoBot)) {
                    if (CONFIG.acaoHashtagDesconhecida === 'ignorar') return null;
                    return {
                        motivo: `comando desconhecido (${cmdCurto})`,
                        acao: CONFIG.acaoHashtagDesconhecida === 'remover' ? 'remover' : 'apagar',
                        titulo: 'COMANDO DESCONHECIDO',
                    };
                }
                // Comando de OUTRO bot (!menu, .s, /play...): remove
                return { motivo: `comando de bot (${cmdCurto})`, acao: 'remover', titulo: 'COMANDO DE BOT' };
            }
        }
    }
    return null;
}

// Cacheia a PROMISE (e não o resultado), assim mensagens simultâneas não disparam várias consultas
function getMeta(sock, groupJid) {
    const c = cacheMeta.get(groupJid);
    if (c && Date.now() - c.t < 60000) return c.promise;
    const promise = sock.groupMetadata(groupJid).catch(err => {
        cacheMeta.delete(groupJid);
        throw err;
    });
    cacheMeta.set(groupJid, { t: Date.now(), promise });
    return promise;
}

// Compara por número e também por LID / phoneNumber (WhatsApp novo usa @lid em alguns grupos)
function mesmoUsuario(p, jid) {
    const alvo = soNumero(jid);
    if (!alvo) return false;
    return [p.id, p.lid, p.jid, p.phoneNumber].some(x => x && soNumero(x) === alvo);
}

function ehAdmin(meta, jid) {
    return meta.participants.some(p => mesmoUsuario(p, jid) && (p.admin === 'admin' || p.admin === 'superadmin'));
}

function botEhAdmin(sock, meta) {
    const ids = [sock.user?.id, sock.user?.lid].filter(Boolean);
    return ids.some(id => ehAdmin(meta, id));
}

// A blacklist guarda só os dígitos do TELEFONE. Se o usuário aparece como @lid,
// procuramos o telefone real nos metadados (precisa ser ANTES de remover o cara do grupo).
function resolverTelefone(meta, user, msg) {
    const p = meta.participants.find(x => mesmoUsuario(x, user));
    const candidatos = [p?.phoneNumber, p?.jid, p?.id, msg.key?.participantAlt, user];
    const real = candidatos.find(c => c && String(c).endsWith('@s.whatsapp.net'));
    if (real) return { digits: soNumero(real), ehLid: false };
    return { digits: soNumero(user), ehLid: true }; // sem telefone disponível: usa o que tem (igual ao scan/onUserJoined)
}

async function apagarComRetry(sock, groupJid, key) {
    for (let i = 0; i < 2; i++) {
        try {
            await sock.sendMessage(groupJid, { delete: key });
            return true;
        } catch (_) {
            await sleep(1000);
        }
    }
    return false;
}

function enfileirarDelete(sock, groupJid, keys) {
    const anterior = filaDelete.get(groupJid) || Promise.resolve();
    const proxima = anterior.then(async () => {
        for (const key of keys) {
            await apagarComRetry(sock, groupJid, key);
            await sleep(CONFIG.delayEntreDeletesMs);
        }
    });
    filaDelete.set(groupJid, proxima.catch(() => {}));
}

const dataHora = () =>
    new Date().toLocaleString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });

// Avisa (1x por lote) que a pessoa completou a sequência de músicas permitida. Não bloqueia o fluxo.
async function avisarLoteAudio(sock, msg, groupJid, user, idUser, ownerNumbers) {
    try {
        const al = CONFIG.audioLote;
        const livres = new Set([...CONFIG.whitelist, ...ownerNumbers].map(soNumero));
        if (livres.has(soNumero(user)) || (msg.key.participantAlt && livres.has(soNumero(msg.key.participantAlt)))) return;
        const meta = await getMeta(sock, groupJid);
        if (ehAdmin(meta, user) || (msg.key.participantAlt && ehAdmin(meta, msg.key.participantAlt))) return;
        if (punidos.has(idUser)) return; // foi punido enquanto esperávamos
        if (CONFIG.modoTeste) {
            console.log(`[antiflood][TESTE] avisaria lote de ${al.tamanho} músicas: ${user} em ${groupJid}`);
            return;
        }
        if (!al.avisar) return;
        const minutos = Math.max(1, Math.round(al.intervaloMs / 60000));
        await sock.sendMessage(groupJid, {
            text:
                `🎵 @${soNumero(user)}, você mandou *${al.tamanho} músicas* seguidas. ` +
                `Esse é o máximo permitido de uma vez pelo anti-flood/spam.\n` +
                `Espere uns *${minutos} min* para enviar uma nova sequência de ${al.tamanho} músicas. ` +
                `Até lá você pode enviar 1 ou 2 normalmente.`,
            mentions: [user],
        });
    } catch (err) {
        console.error('[antiflood] erro ao avisar lote de músicas:', err.message);
    }
}

/**
 * Chame no começo do handler de mensagens (o mais cedo possível, com await).
 * Retorna true se a mensagem foi tratada como infração (aí o handler dá "return").
 * Em qualquer erro retorna false, então nunca atrapalha o fluxo normal do bot.
 *
 * @param {object} sock
 * @param {object} msg
 * @param {string[]} ownerNumbers números (só dígitos) que nunca são punidos
 */
export async function antiFlood(sock, msg, ownerNumbers = []) {
    try {
        if (!CONFIG.enabled) return false;
        const groupJid = msg.key?.remoteJid;
        if (!groupJid || !groupJid.endsWith('@g.us')) return false;
        if (msg.key.fromMe) return false;

        const user = msg.key.participant || msg.participant;
        if (!user) return false;

        const idUser = `${groupJid}:${soNumero(user)}`;

        // Já foi removido recentemente: só apaga o que ainda chegar
        const checarPunido = () => {
            const exp = punidos.get(idUser);
            if (!exp) return false;
            if (Date.now() < exp) return true;
            punidos.delete(idUser);
            avisadosPunido.delete(idUser);
            removidoEm.delete(idUser);
            return false;
        };
        const apagarSobra = () => {
            if (CONFIG.apagarMensagens) enfileirarDelete(sock, groupJid, chavesParaApagar(msg, groupJid, user));

            // Avisa só na primeira mensagem apagada DEPOIS que a remoção terminou (pessoa voltou ao grupo / continua nele).
            // Mensagens do próprio flood que chegam durante a remoção não disparam o aviso.
            const rem = removidoEm.get(idUser);
            if (CONFIG.avisarBloqueioPosRemocao && rem && Date.now() - rem > CONFIG.avisoPosRemocaoAposMs && !avisadosPunido.has(idUser)) {
                avisadosPunido.add(idUser);
                const exp = punidos.get(idUser) || Date.now();
                const minutos = Math.max(1, Math.ceil((exp - Date.now()) / 60000));
                try {
                    sock.sendMessage(groupJid, {
                        text:
                            `⚠️ @${soNumero(user)}, você foi bloqueado(a) por flood/spam.\n` +
                            `Suas mensagens serão apagadas por mais *${minutos} min*. ` +
                            `Depois disso você volta a poder enviar normalmente.`,
                        mentions: [user],
                    }).catch(() => {});
                } catch (_) { /* ignora */ }
            }
            return true;
        };
        // Durante o bloqueio: mensagens que chegam logo após a remoção (flood em andamento) só são apagadas.
        // Passado o prazo, a mensagem é analisada normalmente: se violar as regras de novo, remove outra vez.
        const punidoAgora = checarPunido();
        const remInicial = removidoEm.get(idUser);
        const reanalisar = punidoAgora && CONFIG.punirNovamenteNoBloqueio && !!remInicial &&
            Date.now() - remInicial > CONFIG.avisoPosRemocaoAposMs;
        if (punidoAgora && !reanalisar) return apagarSobra();
        // Quando reanalisando e NÃO houve nova infração, a mensagem continua sendo apagada (como antes)
        const saiSemPunir = () => (reanalisar ? apagarSobra() : false);

        // ---- Análise barata (só memória, sem consultar o WhatsApp) ----
        const { m, edicao } = desembrulhar(msg);
        if (!m) return saiSemPunir();

        const tipo = getTipo(m);
        const texto = getTexto(m);
        const gat = detectarGatilho(m);
        const gatilho = gat?.motivo || null;

        // Mensagem editada só importa se virou trava/convite/comando; não conta para flood
        if (edicao && !gatilho) return saiSemPunir();

        let tipoHist = tipo;
        if (!tipoHist && RECORDA_TEXTO && texto && !edicao && !texto.trimStart().startsWith(CONFIG.prefixoBot)) {
            tipoHist = 'text';
        }
        if (!tipoHist && !gatilho) return saiSemPunir();

        const agora = Date.now();
        let lista = [];
        let violada = null;
        let qtdViolada = 0;
        let loteCompleto = false;

        if (gatilho) {
            // Trava / convite / comando de outro bot: punição imediata na primeira mensagem
            lista = chavesParaApagar(msg, groupJid, user).map(key => ({ t: agora, tipo: 'texto', key }));
        } else {
            const norm = tipoHist === 'text' ? texto.trim().toLowerCase().slice(0, 200) : null;

            // Registra no histórico e limpa o que já saiu da janela
            lista = (historico.get(idUser) || []).filter(e => agora - e.t <= MAX_JANELA);
            lista.push({ t: agora, tipo: tipoHist, key: msg.key, texto: norm });
            historico.set(idUser, lista);

            // Regras por tipo
            for (const r of CONFIG.rules) {
                const qtd = lista.filter(e => r.tipos.includes(e.tipo) && agora - e.t <= r.janelaMs).length;
                if (qtd > r.max) { violada = r; qtdViolada = qtd; break; }
            }
            // Mesma mensagem repetida
            if (!violada && CONFIG.repeticao?.enabled && norm) {
                const rp = CONFIG.repeticao;
                const qtd = lista.filter(e => e.texto === norm && agora - e.t <= rp.janelaMs).length;
                if (qtd > rp.max) { violada = { nome: 'mensagens repetidas', janelaMs: rp.janelaMs }; qtdViolada = qtd; }
            }
            // Lote de músicas: completou a sequência permitida?
            if (!violada && tipoHist === 'audio' && CONFIG.audioLote?.enabled) {
                const al = CONFIG.audioLote;
                const qtdAudio = lista.filter(e => e.tipo === 'audio' && agora - e.t <= al.janelaMs).length;
                if (qtdAudio === al.tamanho) {
                    if (agora < (loteAudioAte.get(idUser) || 0)) {
                        // nova sequência de 3 sem esperar o intervalo: infração
                        violada = { nome: 'músicas (nova sequência antes do intervalo)', janelaMs: al.janelaMs };
                        qtdViolada = qtdAudio;
                    } else {
                        // lote permitido: começa o intervalo (síncrono, antes de qualquer await) e avisa
                        loteAudioAte.set(idUser, agora + al.intervaloMs);
                        loteCompleto = true;
                    }
                }
            }
            if (!violada) {
                if (loteCompleto && !punidoAgora) avisarLoteAudio(sock, msg, groupJid, user, idUser, ownerNumbers);
                return saiSemPunir();
            }
        }

        // ---- Daqui para baixo só chega quem cometeu infração ----

        // Whitelist / donos (confere número normal e o alternativo, caso o ID venha como @lid)
        const livres = new Set([...CONFIG.whitelist, ...ownerNumbers].map(soNumero));
        if (livres.has(soNumero(user)) || (msg.key.participantAlt && livres.has(soNumero(msg.key.participantAlt)))) {
            return false;
        }

        // Admins nunca são punidos (metadados ficam em cache por 60s)
        const meta = await getMeta(sock, groupJid);
        if (ehAdmin(meta, user) || (msg.key.participantAlt && ehAdmin(meta, msg.key.participantAlt))) {
            return false;
        }

        // Rechecagem: outra mensagem em paralelo pode ter punido a pessoa enquanto esperávamos
        if (reanalisar) {
            // outra mensagem em paralelo já puniu de novo (removidoEm foi reiniciado)
            if (removidoEm.get(idUser) !== remInicial) return apagarSobra();
        } else if (checarPunido()) {
            return apagarSobra();
        }

        if (!botEhAdmin(sock, meta)) {
            if (Date.now() - (avisoSemAdmin.get(groupJid) || 0) > 60000) {
                avisoSemAdmin.set(groupJid, Date.now());
                console.log(`[antiflood] infração em ${groupJid} mas o bot não é admin, não consigo remover.`);
            }
            return false;
        }

        const segundos = violada ? Math.round(violada.janelaMs / 1000) : 0;
        const resumo = (gatilho ? gatilho : `${qtdViolada} ${violada.nome} em ${segundos}s`) +
            (reanalisar ? ' (reincidiu durante o bloqueio)' : '');
        const titulo = gat?.titulo || 'SPAM/FLOOD';

        // Modo teste: só registra no console, não pune ninguém
        if (CONFIG.modoTeste) {
            console.log(`[antiflood][TESTE] seria punido: ${user} em ${groupJid} -> ${titulo}: ${resumo}`);
            if (!gatilho) historico.delete(idUser);
            return false;
        }

        // Infração leve ("#algo" desconhecido, convite configurado como 'apagar'): só apaga a mensagem
        if (gat?.acao === 'apagar') {
            console.log(`[antiflood] mensagem apagada de ${user} em ${groupJid}: ${resumo}`);
            if (CONFIG.apagarMensagens) enfileirarDelete(sock, groupJid, lista.map(e => e.key));
            return true;
        }

        // A partir daqui tudo é síncrono até marcar como punido (evita remoção duplicada)
        punidos.set(idUser, agora + CONFIG.bloqueioPosRemocaoMs);
        avisadosPunido.delete(idUser); // nova punição = pode avisar de novo
        removidoEm.delete(idUser);
        const keys = lista.map(e => e.key);
        historico.delete(idUser);

        // Descobre o telefone real ANTES de remover (depois da remoção o metadata não tem mais o cara)
        const { digits: telefone, ehLid } = resolverTelefone(meta, user, msg);
        const quando = dataHora();

        // Trava/convite/comando: apaga a mensagem logo de cara (antes de remover) para sumir o mais rápido possível
        if (gatilho && CONFIG.apagarMensagens) enfileirarDelete(sock, groupJid, keys);

        // 1) Remove primeiro (mais rápido). Se falhar (ex.: a pessoa já saiu), segue mesmo assim:
        //    o bot já confirmou que é admin, então o mais provável é que ela tenha saído sozinha.
        try {
            await sock.groupParticipantsUpdate(groupJid, [user], 'remove');
            console.log(`[antiflood] ${user} removido de ${groupJid} (${resumo})`);
        } catch (err) {
            console.error('[antiflood] falha ao remover (seguindo com blacklist e limpeza):', err.message);
        }
        removidoEm.set(idUser, Date.now());

        // 2) Apaga as mensagens do flood (fila lenta em segundo plano)
        if (!gatilho && CONFIG.apagarMensagens) enfileirarDelete(sock, groupJid, keys);

        // 3) Blacklist com motivo (mesma tabela do #addlista)
        let blacklistOk = false;
        if (CONFIG.adicionarBlacklist) {
            try {
                if (ehLid) {
                    console.warn(`[antiflood] telefone de ${user} não encontrado; salvando o ID @lid na blacklist.`);
                }
                const motivo = `🚫 ${titulo} (auto): ${resumo} - ${quando}`;
                const retorno = await addToBlacklist(telefone, motivo);
                // addToBlacklist não lança erro: devolve texto. "Erro" no texto = falhou.
                blacklistOk = !String(retorno).includes('❌');
                if (!blacklistOk) console.error('[antiflood] blacklist retornou erro:', retorno);
            } catch (err) {
                console.error('[antiflood] erro ao gravar na blacklist:', err.message);
            }
        }

        // 4) Aviso no grupo
        if (CONFIG.avisarNoGrupo) {
            try {
                await sock.sendMessage(groupJid, {
                    text:
                        `🚫 @${soNumero(user)} foi removido(a)` +
                        `${blacklistOk ? ' e adicionado(a) à *blacklist*' : ''} ` +
                        `por *${titulo}*: ${resumo}.`,
                    mentions: [user],
                });
            } catch (_) { /* ignora */ }
        }

        // 5) Aviso para os admins (grupo de admins)
        if (CONFIG.grupoAvisoAdmins && CONFIG.grupoAvisoAdmins !== groupJid) {
            try {
                await sock.sendMessage(CONFIG.grupoAvisoAdmins, {
                    text:
                        `🚨 *ANTI-FLOOD*\n\n` +
                        `👤 Número: ${telefone}${ehLid ? ' (ID @lid, telefone não disponível)' : ''}\n` +
                        `👥 Grupo: ${meta.subject || groupJid}\n` +
                        `📌 Motivo: ${titulo} - ${resumo}\n` +
                        `🕒 ${quando}\n` +
                        `📋 Blacklist: ${blacklistOk ? '✅ adicionado' : CONFIG.adicionarBlacklist ? '⚠️ falhou (veja o log)' : 'desativada'}\n\n` +
                        `Para desfazer: #remlista ${telefone}`,
                });
            } catch (_) { /* ignora */ }
        }

        return true;
    } catch (err) {
        console.error('[antiflood] erro:', err.message);
        return false;
    }
}

// Limpeza periódica pra não vazar memória
setInterval(() => {
    const agora = Date.now();
    for (const [k, lista] of historico) {
        if (!lista.length || agora - lista[lista.length - 1].t > MAX_JANELA) historico.delete(k);
    }
    for (const [k, exp] of punidos) {
        if (agora > exp) { punidos.delete(k); avisadosPunido.delete(k); removidoEm.delete(k); }
    }
    for (const [k, v] of cacheMeta) if (agora - v.t > 120000) cacheMeta.delete(k);
    for (const [k, ate] of loteAudioAte) if (agora > ate) loteAudioAte.delete(k);
}, 60000).unref();