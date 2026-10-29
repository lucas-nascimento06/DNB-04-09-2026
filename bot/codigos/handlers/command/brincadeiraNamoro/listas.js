// bot/codigos/handlers/command/brincadeiraNamoro/listas.js
// Lista de participantes (solteiras, solteiros e casais).
//  - mostrarLista: resposta aos comandos #inscritos, #ni, #nh, #nm, #casais, #nca
//  - mostrarListPart: resposta ao #listpart (mesma lista, com o cabeçalho "Damas da Night")
//  - mostrarListaAtualizada: resposta ao #dlista (ADM) - lista atualizada do grupo principal,
//    pode ser pedida de dentro do grupo de moderação
//  - atualizarListaFixada: a cada mudança, envia a lista nova no(s) grupo(s) de
//    GRUPOS_LISTA_FIXADA (moderação), apaga a antiga e fixa a nova

import { listarCasais, listarParticipantes, obterListaFixada, salvarListaFixada } from './dados.js';
import { GRUPOS_LISTA_FIXADA, GRUPO_PRINCIPAL } from './config.js';

const MARCAR_NA_FIXADA = true;         // true = marca todos com @ (notifica o grupo inteiro)
const MARCAR_NO_DLISTA = true;         // true = #dlista mostra os @ ; false = usa wa.me (sem notificar ninguém)
const DURACAO_FIXO = 7 * 24 * 60 * 60; // segundos (86400 = 24h | 604800 = 7 dias | 2592000 = 30 dias)

const CABECALHO =
`╔═════ஜ۩۞۩ஜ════╗
👏🍻 *DﾑMﾑS 💃🔥 Dﾑ NIGӇԵ*💃🎶🍾🍸
╚═════ஜ۩۞۩ஜ════╝

💘✨ *BRINCADEIRA DO NAMORO!*✨💘

📋 *LISTA DOS PARTICIPANTES*`;

// cabeçalho do comando #listpart
const CABECALHO_LISTPART =
`╔═══ஓ๑♡•⋆⃘ٰٰٰٰٰٖٖٖٖٖٜ۬ ⃘ٰٰٰ︨ٖٖٖٜ︡۬⋆𝅦𝆉⃝꯭⃭݊̎🏹♡๑ஓ═══╗
  👏🍻 *DﾑMﾑS* 💃🔥 *Dﾑ* *NIGӇԵ*💃🎶🍾🍸
╚═══ஓ๑♡•⋆⃘ٰٰٰٰٰٖٖٖٖٖٜ۬ ⃘ٰٰٰ︨ٖٖٖٜ︡۬⋆𝅦𝆉⃝꯭⃭݊̎👼🏻๑ஓ═══╝


♚ࠟࠟࠟࠟࠟ͢. ⃢💑*BRINCADEIRA DO NAMORO*⃝!⃢💑⃝♚
💜⃟⃨⃜ ̶💃 ͆͢ 📝*LISTA DOS PARTICIPANTES*💃⃟̶⃨⃜💜`;

// monta a lista com os dados do grupo "grupoDados" (onde as pessoas se inscreveram).
// marcar=true usa @ (menção); marcar=false usa wa.me (sem notificar ninguém)
// cabecalho: opcional (padrão = CABECALHO)
async function montarLista(grupoDados, marcar, cabecalho = CABECALHO) {
    const [homens, mulheres, casais] = await Promise.all([
        listarParticipantes(grupoDados, 'homem'),
        listarParticipantes(grupoDados, 'mulher'),
        listarCasais(grupoDados),
    ]);

    const mentions = [];

    // marcar=true: "@lid" (o texto do @ precisa ser igual à parte antes do "@" do jid)
    const contato = (jid, userId) => {
        if (!marcar) return `wa.me/${userId}`;
        if (jid) {
            mentions.push(jid);
            return `@${jid.split('@')[0]}`;
        }
        return `@${userId}`;
    };

    // numeração; se vazio, mostra "1." como no modelo
    const numerar = (linhas) =>
        linhas.length ? linhas.map((l, i) => `${i + 1}. ${l}`).join('\n') : '1.';

    const solteiras = mulheres
        .filter((p) => !p.emCasal)
        .map((p) => `${p.nome} - zap : ${contato(p.jid, p.userId)}`);

    const solteiros = homens
        .filter((p) => !p.emCasal)
        .map((p) => `${p.nome} - zap : ${contato(p.jid, p.userId)}`);

    const formados = casais.map(
        (c) =>
            `${c.nome_a || c.user_a} (${contato(c.jid_a, c.user_a)}) 💞 ` +
            `${c.nome_b || c.user_b} (${contato(c.jid_b, c.user_b)})`
    );

    const texto =
`${cabecalho}

╭───────────────╮
💃 *SOLTEIRAS* 💃
╰───────────────╯
${numerar(solteiras)}

╭───────────────╮
🕺 *SOLTEIROS* 🕺
╰───────────────╯
${numerar(solteiros)}

╭───────────────╮
💑 *CASAIS FORMADOS*💑
╰───────────────╯
${numerar(formados)}`;

    return { texto, mentions };
}

// resposta aos comandos de lista (#inscritos, #ni, #casais, #nca, #nh, #nm...)
export async function mostrarLista(sock, message, from) {
    const { texto, mentions } = await montarLista(from, true);
    return sock.sendMessage(from, { text: texto, mentions }, { quoted: message });
}

// resposta ao #listpart: mesma lista, com o cabeçalho "Damas da Night"
export async function mostrarListPart(sock, message, from) {
    const { texto, mentions } = await montarLista(from, true, CABECALHO_LISTPART);
    return sock.sendMessage(from, { text: texto, mentions }, { quoted: message });
}

// resposta ao #dlista: lista atualizada na hora (dados do grupo principal),
// enviada no grupo onde o comando foi digitado (ex.: moderação)
export async function mostrarListaAtualizada(sock, message, from) {
    const { texto, mentions } = await montarLista(GRUPO_PRINCIPAL, MARCAR_NO_DLISTA);

    const hora = new Date().toLocaleTimeString('pt-BR', {
        hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'America/Fortaleza',
    });
    const corpo = `${texto}\n\n🕒 _Consultado às ${hora}_`;

    return sock.sendMessage(
        from,
        MARCAR_NO_DLISTA ? { text: corpo, mentions } : { text: corpo },
        { quoted: message }
    );
}

// ===================== LISTA FIXADA AUTOMÁTICA =====================
// fila por grupo de destino: duas atualizações seguidas não geram duas listas ao mesmo tempo
const filas = new Map();

// grupoDados = grupo onde a pessoa se inscreveu (de onde vêm os dados)
// a lista é enviada e fixada em cada grupo de GRUPOS_LISTA_FIXADA
export function atualizarListaFixada(sock, grupoDados) {
    return Promise.all(
        GRUPOS_LISTA_FIXADA.map((destino) => {
            const anterior = filas.get(destino) || Promise.resolve();
            const atual = anterior
                .then(() => atualizar(sock, grupoDados, destino))
                .catch((e) => console.error(`[brincadeiraNamoro] erro ao atualizar lista fixada em ${destino}:`, e.message));
            filas.set(destino, atual);
            return atual;
        })
    );
}

async function atualizar(sock, grupoDados, destino) {
    // 1) remove a lista antiga do destino (desafixa e apaga)
    const antigoId = await obterListaFixada(destino);
    if (antigoId) {
        const keyAntiga = { remoteJid: destino, fromMe: true, id: antigoId };
        try { await sock.sendMessage(destino, { pin: keyAntiga, type: 2 }); }
        catch (e) { console.error('[brincadeiraNamoro] erro ao desafixar:', e.message); }
        try { await sock.sendMessage(destino, { delete: keyAntiga }); }
        catch (e) { console.error('[brincadeiraNamoro] erro ao apagar lista antiga:', e.message); }
    }

    // 2) envia a lista nova no destino (com os dados do grupo principal)
    const { texto, mentions } = await montarLista(grupoDados, MARCAR_NA_FIXADA);
    const enviada = await sock.sendMessage(
        destino,
        MARCAR_NA_FIXADA ? { text: texto, mentions } : { text: texto }
    );
    if (!enviada?.key?.id) return;
    await salvarListaFixada(destino, enviada.key.id);

    // 3) fixa a nova (o bot precisa ser admin do destino ou o grupo permitir)
    try {
        await sock.sendMessage(destino, { pin: enviada.key, type: 1, time: DURACAO_FIXO });
    } catch (e) {
        console.error(`[brincadeiraNamoro] não consegui fixar em ${destino} (o bot é admin?):`, e.message);
    }
}