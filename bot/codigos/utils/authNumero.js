// ARQUIVO: bot/codigos/utils/authNumero.js
//
// 🔐 Utilitário centralizado pra descobrir o número REAL de telefone de quem
// mandou a mensagem, e comparar com o número autorizado a rodar comandos
// globais/destrutivos (#resetardc, #resetartudo, etc).
//
// Por que isso existe:
// Em grupos que usam o sistema de LID do WhatsApp (identificador de
// privacidade), o campo `message.key.participant` pode vir como
// `123456789@lid` em vez do número de telefone real
// (`5521999999999@s.whatsapp.net`). Se o handler pegar esse campo sem
// validar o formato, a comparação com NUMERO_AUTORIZADO nunca bate — mesmo
// quando é realmente o dono do bot mandando o comando.
//
// A solução: procurar, entre todos os candidatos disponíveis no `key`,
// o que tiver o formato de número de telefone real (@s.whatsapp.net),
// em vez de simplesmente pegar o primeiro campo que existir.

/**
 * Extrai só os dígitos de um JID (remove tudo depois de "@" e qualquer
 * caractere não-numérico antes disso).
 * @param {string|null|undefined} number
 * @returns {string|null}
 */
export function extractDigits(number) {
    if (!number) return null;
    return number.replace(/@.*$/, '').replace(/\D/g, '');
}

/**
 * Retorna o JID que mais provavelmente representa o número de telefone
 * REAL de quem enviou a mensagem, priorizando qualquer campo que já
 * venha no formato @s.whatsapp.net (e não @lid).
 *
 * Ordem de busca (prioriza formato @s.whatsapp.net entre eles):
 *   - message.key.participantAlt
 *   - message.key.participantPn   (nome usado em algumas versões do Baileys)
 *   - message.key.participant
 *   - message.key.remoteJid
 *
 * Se nenhum vier no formato @s.whatsapp.net, cai no primeiro candidato
 * que existir (mesmo que seja @lid), pra não quebrar o fluxo.
 *
 * @param {object} message - objeto da mensagem do Baileys
 * @returns {string|null}
 */
export function getNumeroReal(message) {
    if (!message || !message.key) return null;

    const candidatos = [
        message.key.participantAlt,
        message.key.participantPn,
        message.key.participant,
        message.key.remoteJid,
    ];

    // 1️⃣ Prioriza o que estiver no formato de número real
    const real = candidatos.find(c => typeof c === 'string' && c.endsWith('@s.whatsapp.net'));
    if (real) return real;

    // 2️⃣ Fallback: primeiro candidato que existir, mesmo que seja @lid
    return candidatos.find(Boolean) || null;
}

/**
 * Checa se quem mandou a mensagem é um dos números/LIDs autorizados.
 *
 * IMPORTANTE: em alguns grupos o WhatsApp nunca envia o número de telefone
 * real (nem em participantAlt/participantPn) — só o LID oculto
 * (ex: "110243874902093@lid"). Nesses casos getNumeroReal cai no fallback
 * e retorna o próprio LID. Por isso essa função aceita uma LISTA de
 * identificadores autorizados (número de telefone E LID), não só um —
 * assim a mesma pessoa é reconhecida tanto em grupos que mandam o número
 * real quanto em grupos que só mandam o LID.
 *
 * @param {object} message - objeto da mensagem do Baileys
 * @param {string|string[]} numerosAutorizados - um ID autorizado (string) ou
 *   lista de IDs autorizados, sempre só dígitos (ex: '5521972337640' ou
 *   ['5521972337640', '110243874902093'])
 * @returns {{ autorizado: boolean, solicitanteId: string|null }}
 */
export function checarAutorizacao(message, numerosAutorizados) {
    const remetenteCompleto = getNumeroReal(message);
    const solicitanteId = extractDigits(remetenteCompleto);

    const lista = Array.isArray(numerosAutorizados) ? numerosAutorizados : [numerosAutorizados];

    return {
        autorizado: solicitanteId !== null && lista.includes(solicitanteId),
        solicitanteId,
    };
}

/**
 * Normaliza um JID vindo de eventos de grupo (ex: update.participants,
 * update.author em `group-participants.update`), priorizando o número real
 * de telefone em vez do LID, quando o dado vier como objeto.
 *
 * Aceita tanto:
 *   - string já pronta: "5521999999999@s.whatsapp.net" ou "123@lid"
 *   - objeto do Baileys: { id, phoneNumber, lid, jid, ... } (o formato varia
 *     conforme a versão da lib e se o grupo usa LID)
 *
 * Sempre retorna o MESMO JID tanto pra exibir quanto pra comparar — isso é
 * importante porque comparar um JID normalizado (ex: phoneNumber) com um
 * JID cru (ex: id/@lid) de outro campo nunca vai bater, mesmo sendo a
 * mesma pessoa.
 *
 * @param {string|object|null|undefined} data
 * @returns {string|null}
 */
export function normalizarJidGrupo(data) {
    if (!data) return null;

    if (typeof data === 'string') return data;

    if (typeof data === 'object') {
        // Prioriza sempre o número real de telefone, na mesma ordem de
        // prioridade em qualquer lugar que essa função for usada.
        return data.phoneNumber || data.jid || data.id || data.lid || null;
    }

    return null;
}