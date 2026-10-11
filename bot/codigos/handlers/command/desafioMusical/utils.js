// bot/codigos/handlers/command/desafioMusical/utils.js
// Funções utilitárias gerais.

export function extractDigits(number) {
    if (!number) return null;
    return number.replace(/@.*$/, '').replace(/\D/g, '');
}

export function getNumeroReal(message) {
    return message.key.participantAlt || message.key.participant || null;
}

export function jidDe(membro) {
    return membro.jid || `${membro.user_id}@s.whatsapp.net`;
}

export function tag(jid) {
    return `@${jid.split('@')[0]}`;
}

export function embaralhar(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

export async function ehAdmin(sock, groupId, message, owners) {
    if (message.key.fromMe) return true;
    const jid = message.key.participant;
    const alt = message.key.participantAlt;
    const digits = extractDigits(alt || jid);
    if (digits && owners.includes(digits)) return true;
    try {
        const meta = await sock.groupMetadata(groupId);
        return meta.participants.some(
            p => p.admin && (p.id === jid || p.id === alt || p.lid === jid || p.phoneNumber === alt)
        );
    } catch {
        return false;
    }
}

// Descobre quem o ADM marcou (@menção) ou respondeu (reply) no comando #add
export async function resolverAlvo(sock, groupId, message) {
    const ctx = message.message?.extendedTextMessage?.contextInfo;
    const alvoJid = ctx?.mentionedJid?.[0] || ctx?.participant || null;
    if (!alvoJid) return null;

    let userId = extractDigits(alvoJid);
    try {
        const meta = await sock.groupMetadata(groupId);
        const p = meta.participants.find(
            x => x.id === alvoJid || x.lid === alvoJid || x.phoneNumber === alvoJid
        );
        if (p) {
            const tel = p.phoneNumber || (String(p.id).endsWith('@s.whatsapp.net') ? p.id : null);
            if (tel) userId = extractDigits(tel);
        }
    } catch { /* segue com o que deu para extrair */ }

    return userId ? { jid: alvoJid, userId } : null;
}

// ---------- lista de times com "Ler mais" ----------

// Caracteres invisíveis: o WhatsApp recolhe tudo que vem depois com "Ler mais".
export const LER_MAIS = String.fromCharCode(8206).repeat(4001);
const PREVIA_TIME = 2; // quantos nomes aparecem antes de recolher

function previaTime(membros) {
    if (membros.length === 0) return '_ninguém ainda_';
    const visiveis = membros.slice(0, PREVIA_TIME).map(m => tag(jidDe(m))).join(' ');
    return membros.length > PREVIA_TIME ? `${visiveis} ...` : visiveis;
}

// Devolve { texto, mentions }. Com mais de 2 em algum time, a lista completa fica atrás do "Ler mais".
// Coloque este bloco por ÚLTIMO na mensagem (o que vem depois do "Ler mais" fica escondido).
export function blocoTimes(homens, mulheres) {
    const lista = arr => arr.map(m => tag(jidDe(m))).join('\n');
    let texto =
        `👨🏻 Homens: *${homens.length}* — ${previaTime(homens)}\n` +
        `👩🏻 Mulheres: *${mulheres.length}* — ${previaTime(mulheres)}`;

    if (homens.length > PREVIA_TIME || mulheres.length > PREVIA_TIME) {
        texto +=
            `\n${LER_MAIS}\n` +
            `👨🏻 *HOMENS (${homens.length})*\n${homens.length ? lista(homens) : '_ninguém ainda_'}\n\n` +
            `👩🏻 *MULHERES (${mulheres.length})*\n${mulheres.length ? lista(mulheres) : '_ninguém ainda_'}`;
    }

    return { texto, mentions: [...homens, ...mulheres].map(jidDe) };
}

// ---------- fixar / desafixar mensagem ----------

export async function fixarMensagem(sock, groupId, key, segundos = 86400) {
    if (!key) return false;
    try {
        await sock.sendMessage(groupId, { pin: key, type: 1, time: segundos });
        return true;
    } catch (e) {
        console.error('[desafioMusical] erro ao fixar mensagem:', e.message);
        return false;
    }
}

export async function desafixarMensagem(sock, groupId, key) {
    if (!key) return;
    try {
        await sock.sendMessage(groupId, { pin: key, type: 2 });
    } catch (e) {
        console.error('[desafioMusical] erro ao desafixar mensagem:', e.message);
    }
}