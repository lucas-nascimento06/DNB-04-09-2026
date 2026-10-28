// bot/codigos/handlers/command/brincadeiraNamoro/inscricao.js
// #entrar | #ne -> inscrição com foto + ficha (Nome / Sexo / Cidade / Signo)

import { CONFIG } from './config.js';
import { parseInscricao, nomeSigno } from './utils.js';
import { obterDCs, baixarFotoBase64, salvarParticipante } from './dados.js';
import { atualizarListaFixada } from './listas.js';

const EXEMPLO =
    '👤 NOME: Maria\n' +
    '🚻 SEXO (masculino ou feminino): feminino\n' +
    '📍 CIDADE: Fortaleza\n' +
    '♌ SIGNO: leão\n' +
    '#entrar';

export async function tratarEntrar(sock, message, from, jid, userId, img, texto) {
    const reply = (t, mentions = []) => sock.sendMessage(from, { text: t, mentions }, { quoted: message });

    if (!img) {
        return reply('📸 Para se inscrever, envie uma *foto* ou *vídeo* e coloque a ficha e o *#entrar* na *descrição*.');
    }

    const { nome: nomeFicha, sexo, sexoTexto, cidade, signo } = parseInscricao(texto);

    // SEXO: só aceita palavra completa (homem/mulher ou masculino/feminino). Sem isso, não inscreve.
    if (!sexo) {
        const escreveu = sexoTexto
            ? `Você escreveu: *${sexoTexto}*\n\n`
            : 'Não encontrei a linha *SEXO* na sua ficha.\n\n';
        const abreviado = sexoTexto && sexoTexto.replace(/[^a-zA-Z]/g, '').length <= 4;
        return reply(
            '🚫 *Inscrição não realizada!*\n\n' +
            (abreviado
                ? 'Abreviações (H, M, F...) não valem. Escreva a palavra *completa*.\n\n'
                : 'Não consegui identificar o seu *sexo*, e sem isso o bot não sabe em qual lista te colocar.\n\n') +
            escreveu +
            'No campo SEXO escreva *por extenso*, uma destas opções:\n' +
            '👨 *masculino* ou *homem*\n' +
            '👩 *feminino* ou *mulher*\n\n' +
            `Exemplo:\n${EXEMPLO}\n\n` +
            'Corrija e envie a foto novamente. 📸'
        );
    }

    const faltando = [];
    if (!cidade) faltando.push('Cidade');
    if (!signo) faltando.push('Signo');
    if (faltando.length) {
        return reply(
            `⚠️ Não consegui ler: *${faltando.join(', ')}*.\n\n` +
            `Use este formato na descrição da foto:\n${EXEMPLO}`
        );
    }

    // DCs: só exige o mínimo (sem limite máximo)
    const dcs = await obterDCs(userId);
    if (dcs === null) return reply('⚠️ Não consegui verificar seus DCs agora. Avise um ADM.');
    if (dcs < CONFIG.DC_MINIMO) {
        return reply(`💰 Você precisa de pelo menos *${CONFIG.DC_MINIMO} DCs* para participar. Você tem *${dcs}*.`);
    }

    // nome escrito na ficha; se vier em branco, usa o nome do perfil do WhatsApp
    const nome = nomeFicha || (message.pushName || '').trim() || userId;

    // foto: baixa e guarda; vídeo: não baixa (pesado demais para o banco), segue sem foto_base64
    const ehFoto = String(img.mimetype || '').startsWith('image');
    const fotoBase64 = ehFoto ? await baixarFotoBase64(message) : null;
    await salvarParticipante(from, { userId, jid, nome, sexo, signo, cidade, fotoBase64 });

    const lista = sexo === 'homem' ? 'dos *solteiros* 🕺' : 'das *solteiras* 💃';
    await reply(
        `✅ Inscrição confirmada!\n\n` +
        `👤 Nome: *${nome}*\n⚧ Sexo: *${sexo === 'homem' ? 'masculino' : 'feminino'}*\n📍 Cidade: *${cidade}*\n♈ Signo: *${nomeSigno(signo)}*\n\n` +
        `Você foi adicionado(a) na lista ${lista}. Boa sorte! 💘`
    );

    // logo após a confirmação, publica e fixa a lista atualizada
    await atualizarListaFixada(sock, from);
}