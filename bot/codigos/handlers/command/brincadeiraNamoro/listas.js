// bot/codigos/handlers/command/brincadeiraNamoro/listas.js
// Lista de participantes (solteiras, solteiros e casais).
//  - mostrarLista: resposta aos comandos #inscritos, #ni, #nh, #nm, #casais, #nca
//  - mostrarListPart: resposta ao #listpart / #lp (modelo fixo e vazio da lista, só para guardar/copiar)
//  - mostrarListaAtualizada: resposta ao #dlista / #dl (ADM) - envia a lista atualizada do grupo principal
//    no grupo onde o comando foi digitado, FIXA a nova e REMOVE a antiga (pode ser pedida do grupo de moderação)
//  - atualizarListaFixada: a cada mudança, envia a lista nova no(s) grupo(s) de
//    GRUPOS_LISTA_FIXADA (moderação), apaga a antiga e fixa a nova

import { listarCasais, listarParticipantes, obterListaFixada, salvarListaFixada } from './dados.js';
import { GRUPOS_LISTA_FIXADA, GRUPO_PRINCIPAL } from './config.js';

const MARCAR_NA_FIXADA = true;         // true = marca todos com @ (notifica o grupo inteiro)
const DURACAO_FIXO = 7 * 24 * 60 * 60; // segundos (86400 = 24h | 604800 = 7 dias | 2592000 = 30 dias)
const ESPERA_LISTA_MS = 3000;          // várias mudanças seguidas geram UMA lista só, 3s depois da última

// corações que ficam antes do número de cada seção
const CORACAO_SOLTEIRAS = '❤️';
const CORACAO_SOLTEIROS = '💙';
const CORACAO_CASAIS = '💘';

// frase do rodapé (troque quando quiser)
const FRASE_RODAPE = 'Onde tem Damas da Night, tem amor no ar. 💘';

// rodapé em itálico (no WhatsApp, _texto_ = itálico)
const RODAPE =
`💘 ━━━━ ♡ ━━━━ 💘
_Brincadeira do Namoro • Damas da Night_
_${FRASE_RODAPE}_`;

const CABECALHO =
`╭══• ೋ•✧๑💑๑✧•ೋ •══╮
💘 *BRINCADEIRA DO NAMORO* 💘
╰══• ೋ•✧๑💕๑✧•ೋ •══╯

💘 ━━━━ ♡ ━━━━ 💘
📝 *LISTA DOS PARTICIPANTES*
💘 ━━━━ ♡ ━━━━ 💘`;

// cabeçalho do comando #listpart
const CABECALHO_LISTPART =
`╭══• ೋ•✧๑💑๑✧•ೋ •══╮
💘 *BRINCADEIRA DO NAMORO* 💘
╰══• ೋ•✧๑💕๑✧•ೋ •══╯

💘 ━━━━ ♡ ━━━━ 💘
📝 *LISTA DOS PARTICIPANTES*
💘 ━━━━ ♡ ━━━━ 💘`;

// numeração com coração e dois dígitos: "❤️ 01. Fulana ..."
const numero = (i) => String(i + 1).padStart(2, '0');

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

    // numeração com coração; se vazio, mostra "❤️ 01." como no modelo
    const numerar = (linhas, coracao) =>
        linhas.length
            ? linhas.map((l, i) => `${coracao} ${numero(i)}. ${l}`).join('\n')
            : `${coracao} 01.`;

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
${numerar(solteiras, CORACAO_SOLTEIRAS)}

╭───────────────╮
🕺 *SOLTEIROS* 🕺
╰───────────────╯
${numerar(solteiros, CORACAO_SOLTEIROS)}

╭───────────────╮
💑 *CASAIS FORMADOS*💑
╰───────────────╯
${numerar(formados, CORACAO_CASAIS)}

${RODAPE}`;

    return { texto, mentions };
}

// resposta aos comandos de lista (#inscritos, #ni, #casais, #nca, #nh, #nm...)
export async function mostrarLista(sock, message, from) {
    const { texto, mentions } = await montarLista(from, true);
    return sock.sendMessage(from, { text: texto, mentions }, { quoted: message });
}

// resposta ao #listpart / #lp: modelo FIXO e vazio da lista (não lê o banco, não marca ninguém).
// Serve só para guardar o modelo no bot e copiar quando precisar.
export function textoListPart() {
    return `${CABECALHO_LISTPART}

╭───────────────╮
💃 *SOLTEIRAS* 💃
╰───────────────╯
${CORACAO_SOLTEIRAS} 01.

╭───────────────╮
🕺 *SOLTEIROS* 🕺
╰───────────────╯
${CORACAO_SOLTEIROS} 01.

╭───────────────╮
💑 *CASAIS FORMADOS*💑
╰───────────────╯
${CORACAO_CASAIS} 01.

${RODAPE}`;
}

export async function mostrarListPart(sock, message, from) {
    return sock.sendMessage(from, { text: textoListPart() }, { quoted: message });
}

// ===================== LISTA FIXADA AUTOMÁTICA =====================
// fila por grupo de destino: duas atualizações seguidas não geram duas listas ao mesmo tempo
const filas = new Map();

// agendamento por grupo de dados: várias inscrições/pedidos em sequência viram UMA atualização
const agendados = new Map();

// coloca uma tarefa na fila do destino (uma de cada vez por grupo)
function enfileirar(destino, fn) {
    const anterior = filas.get(destino) || Promise.resolve();
    const atual = anterior
        .then(fn)
        .catch((e) => console.error(`[brincadeiraNamoro] erro ao atualizar lista fixada em ${destino}:`, e.message));
    filas.set(destino, atual);
    return atual;
}

// resposta ao #dlista / #dl: na hora (sem esperar os 3s), envia a lista atualizada do grupo principal
// no grupo onde o comando foi digitado, apaga a lista desatualizada e FIXA a nova.
export function mostrarListaAtualizada(sock, message, from) {
    return enfileirar(from, () => atualizar(sock, GRUPO_PRINCIPAL, from));
}

// grupoDados = grupo onde a pessoa se inscreveu (de onde vêm os dados)
// a lista é enviada e fixada em cada grupo de GRUPOS_LISTA_FIXADA.
// Retorna na hora (quem chamou não fica esperando a lista ser reenviada).
export function atualizarListaFixada(sock, grupoDados) {
    clearTimeout(agendados.get(grupoDados));
    agendados.set(grupoDados, setTimeout(() => {
        agendados.delete(grupoDados);
        for (const destino of GRUPOS_LISTA_FIXADA) {
            enfileirar(destino, () => atualizar(sock, grupoDados, destino));
        }
    }, ESPERA_LISTA_MS));
    return Promise.resolve();
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