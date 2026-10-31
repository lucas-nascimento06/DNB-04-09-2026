// bot/codigos/handlers/command/brincadeiraNamoro/inscricao.js
// #entrar | #ne -> inscrição com foto + ficha (Nome / Sexo / Cidade / Signo)
// (mesma lógica de antes + logs [inscricao] em cada etapa para diagnóstico)

import { CONFIG, NOMES_SIGNOS, normalizarSigno } from './config.js';
import { parseInscricao } from './utils.js';
import { obterDCs, baixarFotoBase64, salvarParticipante } from './dados.js';
import { atualizarListaFixada } from './listas.js';

const EXEMPLO =
    '👤 NOME: Emily\n' +
    '🚻 SEXO (masculino/feminino ou M/F): F\n' +
    '📍 CIDADE: Fortaleza\n' +
    '♌ SIGNO: leão/leonina\n' +
    '#entrar';

export async function tratarEntrar(sock, message, from, jid, userId, img, texto) {
    const t0 = Date.now();
    const log = (passo) => console.log(`[inscricao] ${userId} | ${passo} | +${Date.now() - t0}ms`);
    const reply = async (t, mentions = []) => {
        try {
            const r = await sock.sendMessage(from, { text: t, mentions }, { quoted: message });
            log(`resposta ENVIADA ("${t.slice(0, 30).replace(/\n/g, ' ')}...")`);
            return r;
        } catch (e) {
            log(`resposta FALHOU: ${e.message}`);
            throw e;
        }
    };

    log('início');

    if (!img) {
        log('sem mídia');
        return reply('📸 Para se inscrever, envie uma *foto* ou *vídeo* e coloque a ficha e o *#entrar* na *descrição*.');
    }

    const { nome: nomeFicha, sexo, sexoTexto, cidade, signo: signoTexto } = parseInscricao(texto);

    // SIGNO: aceita acento, feminino, gentílico, erro leve de digitação e mais de uma palavra
    // (capricorniana, germiniano, leão/leonina...) e converte para a chave padrão (ex: 'capricornio')
    const signo = normalizarSigno(signoTexto);
    log(`ficha lida: nome=${nomeFicha} sexo=${sexo} (texto="${sexoTexto}") cidade=${cidade} signo=${signo} (texto="${signoTexto}")`);

    // SEXO: aceita masculino/feminino, homem/mulher ou M/F. Sem isso, não inscreve.
    if (!sexo) {
        const escreveu = sexoTexto
            ? `Você escreveu: *${sexoTexto}*\n\n`
            : 'Não encontrei a linha *SEXO* na sua ficha.\n\n';
        return reply(
            '🚫 *Inscrição não realizada!*\n\n' +
            'Não consegui identificar o seu *sexo*, e sem isso o bot não sabe em qual lista te colocar.\n\n' +
            escreveu +
            'No campo SEXO escreva uma destas opções:\n' +
            '👨 masculino ou *M*\n' +
            '👩 feminino ou *F*\n\n' +
            `Exemplo:\n${EXEMPLO}\n\n` +
            'Corrija e envie a foto novamente. 📸'
        );
    }

    const faltando = [];
    if (!cidade) faltando.push('Cidade');
    if (!signo) faltando.push('Signo');
    if (faltando.length) {
        const escreveuSigno = (!signo && signoTexto)
            ? `Você escreveu no signo: *${signoTexto}*\n\n`
            : '';
        return reply(
            `⚠️ Não consegui ler: *${faltando.join(', ')}*.\n\n` +
            escreveuSigno +
            `Use este formato na descrição da foto:\n${EXEMPLO}`
        );
    }

    // DCs: só exige o mínimo (sem limite máximo)
    log('consultando DCs...');
    const dcs = await obterDCs(userId);
    log(`DCs = ${dcs}`);
    if (dcs === null) return reply('⚠️ Não consegui verificar seus DCs agora. Avise um ADM.');
    if (dcs < CONFIG.DC_MINIMO) {
        const faltam = CONFIG.DC_MINIMO - dcs;
        return reply(
            `🚨 *INSCRIÇÃO NÃO REALIZADA!* 🚨\n\n` +
            `❌❌🔐❌❌🙅‍♂️❌❌🔐❌❌\n` +
            `━━━━━━━━━━━━━━━━━━\n` +
            `⚠️ *DCs INSUFICIENTES* ⚠️\n` +
            `━━━━━━━━━━━━━━━━━━\n\n` +
            `Para participar da brincadeira você precisa ter pelo menos *${CONFIG.DC_MINIMO} DCs*.\n\n` +
            `💰 Você tem: *${dcs} DCs*\n` +
            `📉 Faltam: *${faltam} DCs*\n\n` +
            `Junte mais DCs e envie a ficha novamente. 📸`
        );
    }

    // nome escrito na ficha; se vier em branco, usa o nome do perfil do WhatsApp
    const nome = nomeFicha || (message.pushName || '').trim() || userId;

    // foto: baixa e guarda; vídeo: não baixa (pesado demais para o banco), segue sem foto_base64
    const ehFoto = String(img.mimetype || '').startsWith('image');
    log(ehFoto ? 'baixando foto...' : 'vídeo: sem download');
    const fotoBase64 = ehFoto ? await baixarFotoBase64(message) : null;
    log(`foto: ${fotoBase64 ? Math.round(fotoBase64.length / 1024) + 'KB' : 'não baixada'}`);

    await salvarParticipante(from, { userId, jid, nome, sexo, signo, cidade, fotoBase64 });
    log('SALVO no banco');

    const lista = sexo === 'homem' ? 'dos *solteiros* 🕺' : 'das *solteiras* 💃';
    await reply(
        `✅ Inscrição confirmada!\n\n` +
        `👤 Nome: *${nome}*\n⚧ Sexo: *${sexo === 'homem' ? 'masculino' : 'feminino'}*\n📍 Cidade: *${cidade}*\n♈ Signo: *${NOMES_SIGNOS[signo]}*\n\n` +
        `Você foi adicionado(a) na lista ${lista}. Boa sorte! 💘`
    );

    // logo após a confirmação, publica e fixa a lista atualizada
    await atualizarListaFixada(sock, from);
    log('fim');
}