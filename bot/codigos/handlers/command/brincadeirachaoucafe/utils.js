// Funções auxiliares (formato de mensagem do Baileys)

export function extrairTexto(msg) {
  const m = msg?.message;
  if (!m) return '';
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    ''
  );
}

export function extrairMencionados(msg) {
  const m = msg?.message;
  const ctx =
    m?.extendedTextMessage?.contextInfo ||
    m?.imageMessage?.contextInfo ||
    m?.videoMessage?.contextInfo;
  return ctx?.mentionedJid || [];
}

// ID da mensagem que foi respondida (quote). null se a mensagem não é uma resposta.
export function extrairIdCitado(msg) {
  const m = msg?.message;
  const ctx =
    m?.extendedTextMessage?.contextInfo ||
    m?.imageMessage?.contextInfo ||
    m?.videoMessage?.contextInfo;
  return ctx?.stanzaId || null;
}

// Todos os "#comando" da mensagem, em qualquer posição, sem acento e minúsculos.
// "@maria #Chá" -> ['cha'] | "#cc @maria" -> ['cc'] | "# cafe" -> ['cafe']
export function extrairComandos(texto) {
  const t = String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  return [...t.matchAll(/(?:^|\s)#\s*([a-z0-9_]+)/g)].map((m) => m[1]);
}

export function jidParaNumero(jid) {
  return String(jid || '').split('@')[0].split(':')[0];
}

export function mencao(jid) {
  return `@${jidParaNumero(jid)}`;
}

export function remetente(msg) {
  return msg.key.participant || msg.participant || msg.key.remoteJid;
}

// TODOS os números pelos quais o remetente pode aparecer (@lid e telefone)
export function numerosDoRemetente(msg) {
  return [msg.key?.participant, msg.key?.participantAlt, msg.participant]
    .filter(Boolean)
    .map(jidParaNumero);
}