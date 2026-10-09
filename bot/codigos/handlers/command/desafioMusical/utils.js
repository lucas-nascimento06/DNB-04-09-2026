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