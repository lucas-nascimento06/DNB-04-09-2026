import pool from '../../../../db.js';

// ─────────────────────────────────────────────────────────────────────────────
// 📩 RECADOS ANÔNIMOS — Versão 2.3 com Base64 (RÁPIDO & SEM FALHAS NO TERMUX)
//
// Uso: #msn
// Precisa ser digitado dentro do grupo pra onde os recados devem ir.
// 🔒 Apenas administradores do grupo podem executar esse comando.
//
// 🔧 v2.1: só busca recados com status = 'pendente' e marca cada um
//          como 'enviado' logo após o envio individual dar certo.
//
// 🧪 v2.2: MODO TESTE por grupo. Nos grupos listados em GRUPOS_TESTE o #msn:
//          - envia TODOS os recados (pendentes e já enviados)
//          - NÃO altera o status no banco
//          Assim dá pra testar quantas vezes precisar sem "gastar" os recados
//          que serão enviados no grupo principal.
//
// 🔖 v2.3: CÓDIGO + MODERAÇÃO. Cada recado ganha um código de 2 dígitos (01–99)
//          na primeira vez que o #msn passa por ele. Nos grupos de teste o
//          código aparece na mensagem. Pra apagar um recado inapropriado:
//              #rmsn 42     ou     #rmsn42 ou #r msn 42
//          (só admin, só nos grupos liberados). O recado é removido do banco.
//          Fluxo sugerido: rodar #msn no grupo de TESTE, ver os códigos,
//          apagar o que for inapropriado e só depois rodar no grupo PRINCIPAL.
// ─────────────────────────────────────────────────────────────────────────────

// IDs dos grupos de TESTE (envia tudo, mas NÃO marca como 'enviado')
const GRUPOS_TESTE = [
    '120363410625671149@g.us', // grupo de teste
];

// ID do grupo PRINCIPAL (envia só os pendentes e marca como 'enviado')
const GRUPO_PRINCIPAL = '120363414417789335@g.us';

// 🔖 Mostrar o código também nas mensagens do grupo principal?
// false = mensagem limpa no principal (código só aparece no grupo de teste)
const MOSTRAR_CODIGO_NO_PRINCIPAL = false;

// 🔖 Quantidade de dígitos do código (2 = 00 a 99 → até 100 recados ao mesmo tempo)
const DIGITOS_CODIGO = 2;
const TOTAL_CODIGOS = 10 ** DIGITOS_CODIGO;

function resolverSenderId(message) {
    const key = message.key;
    if (key.participantAlt && key.participantAlt.endsWith('@s.whatsapp.net')) {
        return key.participantAlt;
    }
    if (key.participant && key.participant.endsWith('@s.whatsapp.net')) {
        return key.participant;
    }
    return key.participant || key.remoteJid;
}

// 🔒 Verifica se quem mandou o comando é admin do grupo
async function verificarSeEhAdmin(sock, from, message, senderId) {
    try {
        console.log(`🔐 [DEBUG] Verificando se ${senderId} é admin...`);
        const groupMetadata = await sock.groupMetadata(from);
        const candidatos = new Set([
            senderId,
            message.key.participant,
            message.key.participantAlt,
        ].filter(Boolean));

        const participante = groupMetadata.participants.find(p => candidatos.has(p.id));

        if (!participante) {
            console.log(`❌ [DEBUG] Participante não encontrado`);
            return false;
        }

        const isAdmin = participante.admin === 'admin' || participante.admin === 'superadmin';
        console.log(`${isAdmin ? '✅' : '❌'} [DEBUG] Admin: ${isAdmin}`);
        return isAdmin;
    } catch (err) {
        console.error('⚠️ [RECADOS] Erro ao verificar admin:', err.message);
        return false;
    }
}

// ============================================
// 🔖 CÓDIGOS DOS RECADOS
// ============================================

// Cria a coluna `codigo` sozinha na primeira vez (não precisa mexer no banco na mão).
// O índice único garante que dois recados nunca fiquem com o mesmo código.
let colunaCodigoOk = false;
async function garantirColunaCodigo() {
    if (colunaCodigoOk) return;
    await pool.query(`ALTER TABLE recados_anonimos ADD COLUMN IF NOT EXISTS codigo VARCHAR(${DIGITOS_CODIGO})`);
    await pool.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS recados_anonimos_codigo_uidx
         ON recados_anonimos (codigo) WHERE codigo IS NOT NULL`
    );
    colunaCodigoOk = true;
    console.log(`🔖 [DEBUG] Coluna 'codigo' pronta na tabela recados_anonimos`);
}

// Dá um código pra cada recado que ainda não tem (menor código livre: 01, 02, 03...).
// Quando um recado é apagado com #rmsn, o código dele volta a ficar livre.
async function garantirCodigos(recados) {
    const semCodigo = recados.filter(r => !r.codigo);
    if (semCodigo.length === 0) return;

    // Códigos em uso em TODA a tabela (não só nos recados desta rodada)
    const { rows } = await pool.query(`SELECT codigo FROM recados_anonimos WHERE codigo IS NOT NULL`);
    const usados = new Set(rows.map(r => r.codigo));

    const livres = [];
    // começa do 1 pra evitar "00"; o 0 só entra se sobrar espaço
    for (let n = 1; n <= TOTAL_CODIGOS; n++) {
        const cod = String(n % TOTAL_CODIGOS).padStart(DIGITOS_CODIGO, '0');
        if (!usados.has(cod)) livres.push(cod);
    }

    if (livres.length < semCodigo.length) {
        throw new Error(
            `Só restam ${livres.length} código(s) livre(s) e há ${semCodigo.length} recado(s) sem código. ` +
            `Apague recados antigos com #rmsn ou aumente DIGITOS_CODIGO.`
        );
    }

    for (const recado of semCodigo) {
        const codigo = livres.shift();
        await pool.query(`UPDATE recados_anonimos SET codigo = $1 WHERE id = $2`, [codigo, recado.id]);
        recado.codigo = codigo;
        console.log(`🔖 [DEBUG] Recado #${recado.id} recebeu o código ${codigo}`);
    }
}

// Apaga do banco o recado com esse código. Retorna o recado apagado (ou null se não existir).
async function removerRecadoPorCodigo(codigo) {
    const { rows } = await pool.query(
        `DELETE FROM recados_anonimos WHERE codigo = $1
         RETURNING id, codigo, numero_destinatario, status`,
        [codigo]
    );
    return rows[0] || null;
}

// Busca os recados do banco (COM BASE64!)
//  - modo normal: apenas status = 'pendente'
//  - modo teste:  TODOS os recados, independente do status
async function buscarRecados(modoTeste = false) {
    try {
        console.log(`🗄️  [DEBUG] Buscando recados (${modoTeste ? 'TODOS - modo teste' : 'só pendentes'})...`);

        const sql = modoTeste
            ? `SELECT * FROM recados_anonimos ORDER BY id ASC`
            : `SELECT * FROM recados_anonimos WHERE status = 'pendente' ORDER BY id ASC`;

        const { rows } = await pool.query(sql);
        console.log(`✅ [DEBUG] ${rows.length} recado(s) encontrado(s)`);

        if (rows.length > 0) {
            // Não loga o base64 inteiro (fica gigante no terminal), só o tamanho
            const { photo_base64, music_base64, ...resto } = rows[0];
            console.log('📋 [DEBUG] Primeiro recado:', JSON.stringify({
                ...resto,
                photo_base64: photo_base64 ? `[${photo_base64.length} chars]` : null,
                music_base64: music_base64 ? `[${music_base64.length} chars]` : null,
            }, null, 2));
        }
        return rows;
    } catch (err) {
        console.error('❌ [DEBUG] Erro ao buscar recados:', err.message);
        throw err;
    }
}

// Marca um recado como enviado, pra não ser buscado de novo na próxima rodada
async function marcarComoEnviado(recadoId) {
    try {
        await pool.query(
            `UPDATE recados_anonimos SET status = 'enviado' WHERE id = $1`,
            [recadoId]
        );
        console.log(`🗃️  [DEBUG] Recado #${recadoId} marcado como 'enviado' no banco`);
    } catch (err) {
        console.error(`⚠️  [DEBUG] Erro ao marcar recado #${recadoId} como enviado: ${err.message}`);
        // Não relança o erro: o recado já foi entregue no WhatsApp,
        // então não queremos que ele conte como "falhado" no resumo.
        // Mas fica registrado no log pra investigar depois — se isso
        // falhar, o recado pode ser reenviado na próxima rodada.
    }
}

// ============================================
// 🖼️ BASE64 PURO — sem download externo!
// Base64 já está no banco, é só usar!
// ============================================
async function gerarThumbnailDoBase64(base64String, size = 256) {
    try {
        console.log(`🎨 [DEBUG] Gerando thumbnail do base64...`);

        // Converte base64 → Buffer
        const buffer = Buffer.from(base64String, 'base64');

        // Se tiver Jimp, faz thumbnail. Se não, usa o buffer mesmo
        try {
            const { Jimp } = await import('jimp');
            const image = await Jimp.read(buffer);
            image.scaleToFit({ w: size, h: size });
            const thumb = await image.getBuffer("image/jpeg");
            console.log(`✅ [DEBUG] Thumbnail gerado: ${thumb.length} bytes`);
            return thumb;
        } catch (jimpErr) {
            // Se Jimp falhar, retorna null (envia sem thumbnail)
            console.warn(`⚠️  [DEBUG] Jimp não disponível, enviando sem thumbnail`);
            return null;
        }
    } catch (err) {
        console.error(`❌ [DEBUG] Erro ao gerar thumbnail: ${err.message}`);
        return null;
    }
}

async function enviarRecado(sock, from, recado, mostrarCodigo = false) {
    // 🔖 Linha do código (só quando mostrarCodigo = true e o recado tem código)
    const linhaCodigo = mostrarCodigo && recado.codigo
        ? `\n🔖 *Cód: ${recado.codigo}* _(apagar: #rmsn ${recado.codigo})_\n`
        : '';

    const texto = `💌❤️❥❥═══ *RECADINHO DO CORAÇAO* ═══❥❥❤️💌

💌🥰 *Um recado anônimo* *para* @${recado.numero_destinatario}

${recado.content}
${linhaCodigo}
_© damas da night_`;
    const mentions = [`${recado.numero_destinatario}@s.whatsapp.net`];

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`📤 [RECADO #${recado.id}] Iniciando envio para @${recado.numero_destinatario}`);
    console.log(`${'═'.repeat(60)}`);

    try {
        // ============================================
        // 📸 FOTO — Usa Base64 do banco!
        // ============================================
        if (recado.photo_base64) {
            console.log(`\n📸 [RECADO #${recado.id}] Processando foto...`);

            try {
                // Base64 → Buffer
                const fotoBuffer = Buffer.from(recado.photo_base64, 'base64');
                console.log(`✅ [RECADO #${recado.id}] Foto do banco: ${fotoBuffer.length} bytes`);

                // Tenta gerar thumbnail
                const thumb = await gerarThumbnailDoBase64(recado.photo_base64, 256);

                console.log(`📨 [RECADO #${recado.id}] Enviando foto...`);
                await sock.sendMessage(from, {
                    image: fotoBuffer,
                    caption: texto,
                    mentions,
                    jpegThumbnail: thumb // pode ser null, é ok
                });
                console.log(`✅ [RECADO #${recado.id}] Foto enviada com sucesso`);
            } catch (err) {
                console.error(`❌ [RECADO #${recado.id}] Erro ao enviar foto: ${err.message}`);
                console.log(`⚠️  [RECADO #${recado.id}] Enviando só texto...`);
                await sock.sendMessage(from, { text: texto, mentions });
            }
        } else {
            // Sem foto - envia texto puro
            console.log(`\n📝 [RECADO #${recado.id}] Sem foto, enviando texto puro...`);
            await sock.sendMessage(from, {
                text: texto,
                mentions
            });
            console.log(`✅ [RECADO #${recado.id}] Texto enviado com sucesso`);
        }

        // ============================================
        // 🎵 ÁUDIO — Usa Base64 do banco!
        // ============================================
        if (recado.music_base64) {
            console.log(`\n🎵 [RECADO #${recado.id}] Processando áudio...`);
            await new Promise(r => setTimeout(r, 1000)); // Delay

            try {
                // Base64 → Buffer
                const audioBuffer = Buffer.from(recado.music_base64, 'base64');
                console.log(`✅ [RECADO #${recado.id}] Áudio do banco: ${audioBuffer.length} bytes`);

                console.log(`📨 [RECADO #${recado.id}] Enviando áudio...`);
                await sock.sendMessage(from, {
                    audio: audioBuffer,
                    mimetype: 'audio/mpeg',
                    ptt: false
                });
                console.log(`✅ [RECADO #${recado.id}] Áudio enviado com sucesso`);
            } catch (err) {
                console.error(`❌ [RECADO #${recado.id}] Erro ao enviar áudio: ${err.message}`);
                console.log(`⚠️  [RECADO #${recado.id}] Áudio com problemas`);
            }
        }

        console.log(`\n✅ [RECADO #${recado.id}] FINALIZADO COM SUCESSO\n`);

    } catch (err) {
        console.error(`\n❌ [RECADO #${recado.id}] ERRO CRÍTICO: ${err.message}`);
        console.error(`Stack: ${err.stack}\n`);
        throw err; // repassa pro loop, pra NÃO marcar como enviado se algo crítico falhou
    }
}

// ============================================
// 🗑️ #rmsn FG / #rmsnFG — apaga um recado pelo código
// ============================================
async function handleDelRecado(sock, message, from, codigo) {
    // Só age nos grupos liberados. Em qualquer outro grupo ignora em silêncio
    // (assim não atrapalha algum outro comando #rmsn que exista no bot).
    const grupoPermitido = GRUPOS_TESTE.includes(from) || from === GRUPO_PRINCIPAL;
    if (!grupoPermitido) return false;

    const senderId = resolverSenderId(message);

    const ehAdmin = await verificarSeEhAdmin(sock, from, message, senderId);
    if (!ehAdmin) {
        console.log(`❌ ${senderId} não é admin, rejeitando #rmsn`);
        await sock.sendMessage(from, {
            text: '🚫 Esse comando é exclusivo para administradores do grupo.',
            mentions: [senderId],
            quoted: message
        });
        return true;
    }

    try {
        await garantirColunaCodigo();
        const removido = await removerRecadoPorCodigo(codigo);

        if (!removido) {
            console.log(`🔎 [DEL] Nenhum recado com o código ${codigo}`);
            await sock.sendMessage(from, {
                text: `❓ Não achei nenhum recado com o código *${codigo}*.`,
                mentions: [senderId],
                quoted: message
            });
            return true;
        }

        console.log(`🗑️  [DEL] Recado #${removido.id} (código ${codigo}, status ${removido.status}) removido por ${senderId}`);
        await sock.sendMessage(from, {
            text: `╭━━〔 🗑️ 𝐑𝐄𝐂𝐀𝐃𝐎 𝐑𝐄𝐌𝐎𝐕𝐈𝐃𝐎 〕━━╮

🚫 O recado *${codigo}* foi removido
por conter conteúdo inadequado.

🛡️ 𝐌𝐨𝐝𝐞𝐫𝐚𝐜̧𝐚̃𝐨 𝐃𝐚𝐦𝐚𝐬 𝐝𝐚 𝐍𝐢𝐠𝐡𝐭

╰━━━━━━━━━━━━━━━━━━━━╯`,
            mentions: [senderId],
            quoted: message
        });
    } catch (err) {
        console.error('❌ [DEL] Erro ao remover recado:', err.message);
        await sock.sendMessage(from, {
            text: `❌ Erro ao remover o recado: ${err.message}`,
            mentions: [senderId],
            quoted: message
        });
    }

    return true;
}

export async function handleRecadosAnonimosCommand(sock, message, from) {
    const content =
        message.message?.conversation ||
        message.message?.extendedTextMessage?.text || '';

    // 🗑️ #rmsn 42 ou #rmsn42 ou #r msn 42 (exatamente 2 dígitos)
    const matchDel = content.trim().match(new RegExp(`^#r\\s*msn\\s*(\\d{${DIGITOS_CODIGO}})$`, 'i'));
    if (matchDel) {
        return await handleDelRecado(sock, message, from, matchDel[1]);
    }

    if (!/^#msn$/i.test(content.trim())) return false;

    // 🧪 Grupo de teste? (envia tudo e NÃO altera o status no banco)
    const modoTeste = GRUPOS_TESTE.includes(from);

    // 🔖 Mostra o código na mensagem? (sempre no teste; no principal só se a flag estiver ligada)
    const mostrarCodigo = modoTeste || MOSTRAR_CODIGO_NO_PRINCIPAL;

    console.log(`\n${'█'.repeat(60)}`);
    console.log(`█ COMANDO #MSN DETECTADO`);
    console.log(`█ Grupo: ${from}`);
    console.log(`█ Versão: 2.3 (BASE64 + STATUS + MODO TESTE + CÓDIGO/#RMSN)`);
    console.log(`█ Modo: ${modoTeste ? '🧪 TESTE (todos os recados, sem alterar status)' : '🚀 NORMAL (só pendentes, marca como enviado)'}`);
    console.log(`${'█'.repeat(60)}\n`);

    // 🚫 Só funciona no grupo de teste e no grupo principal
    const grupoPermitido = modoTeste || from === GRUPO_PRINCIPAL;

    if (!grupoPermitido) {
        console.log(`🚫 Grupo ${from} não está autorizado para o #msn, ignorando`);
        await sock.sendMessage(from, {
            text: '🚫 Esse comando não está liberado para este grupo.',
            quoted: message
        });
        return true;
    }

    const senderId = resolverSenderId(message);

    // 🔒 Apenas administradores podem disparar
    const ehAdmin = await verificarSeEhAdmin(sock, from, message, senderId);

    if (!ehAdmin) {
        console.log(`❌ ${senderId} não é admin, rejeitando comando`);
        await sock.sendMessage(from, {
            text: '🚫 Esse comando é exclusivo para administradores do grupo.',
            mentions: [senderId],
            quoted: message
        });
        return true;
    }

    try {
        console.log(`✅ ${senderId} é admin, prosseguindo...\n`);

        await garantirColunaCodigo();

        const recados = await buscarRecados(modoTeste);

        if (recados.length === 0) {
            console.log(`📭 Nenhum recado ${modoTeste ? '' : 'pendente '}encontrado`);
            await sock.sendMessage(from, {
                text: modoTeste
                    ? '📭 Nenhum recado anônimo cadastrado no banco.'
                    : '📭 Nenhum recado anônimo pendente.',
                mentions: [senderId],
                quoted: message
            });
            return true;
        }

        // 🔖 Garante que todo recado desta rodada tenha um código
        await garantirCodigos(recados);

        console.log(`\n${'█'.repeat(60)}`);
        console.log(`█ INICIANDO ENVIO DE ${recados.length} RECADO(S) ${modoTeste ? '(MODO TESTE)' : 'PENDENTE(S)'}`);
        console.log(`█ ⚡ MODO RÁPIDO: Base64 do banco (SEM DOWNLOADS!)`);
        console.log(`${'█'.repeat(60)}\n`);

        await sock.sendMessage(from, {
            text: `${modoTeste ? '🗝️ *ACESSO RESTRITO*\n_somente administradores_\n\n' : ''}📬 Enviando ${recados.length} recado(s)...\n⏳ Aguarde...`,
            mentions: [senderId],
            quoted: message
        });

        let enviados = 0;
        let falhados = 0;
        const erros = [];

        const tempoInicio = Date.now();

        for (let i = 0; i < recados.length; i++) {
            const recado = recados[i];
            try {
                console.log(`\n[${i + 1}/${recados.length}] Processando recado #${recado.id} (código ${recado.codigo})...`);
                await enviarRecado(sock, from, recado, mostrarCodigo);
                enviados++;

                if (!modoTeste) {
                    // 🔧 Marca como enviado SÓ depois do envio ter dado certo,
                    // assim ele some da busca na próxima vez que #msn rodar.
                    await marcarComoEnviado(recado.id);
                } else {
                    console.log(`🧪 [TESTE] Recado #${recado.id} NÃO marcado como enviado (grupo de teste)`);
                }
            } catch (err) {
                console.error(`❌ [HANDLER] Erro ao enviar recado #${recado.id}: ${err.message}`);
                falhados++;
                erros.push(`#${recado.id}: ${err.message}`);
                // Não marca como enviado — continua com o status atual pra ser
                // tentado de novo na próxima rodada do #msn.
            }
            // Delay entre recados
            if (i < recados.length - 1) {
                console.log(`⏱️  Aguardando 1.2s antes do próximo recado...`);
                await new Promise(r => setTimeout(r, 1200));
            }
        }

        const tempoTotal = ((Date.now() - tempoInicio) / 1000).toFixed(2);

        console.log(`\n${'█'.repeat(60)}`);
        console.log(`█ RESUMO DO ENVIO`);
        console.log(`█ ✅ Enviados: ${enviados}`);
        console.log(`█ ❌ Falhados: ${falhados}`);
        console.log(`█ Total: ${recados.length}`);
        console.log(`█ ⏱️  Tempo: ${tempoTotal}s`);
        console.log(`${'█'.repeat(60)}\n`);

        // 📵 Sem mensagem de "CONCLUÍDO/estatísticas" no grupo quando tudo dá certo.
        // Só avisa se algum recado falhou, pra você saber que precisa rodar de novo.
        if (falhados > 0) {
            await sock.sendMessage(from, {
                text: `⚠️ ${falhados} recado(s) não foram enviados e continuam pendentes. Rode #msn de novo pra tentar outra vez.\n${erros.map(e => `• ${e}`).join('\n')}`,
                mentions: [senderId]
            });
        }

    } catch (err) {
        console.error('❌ [RECADOS] Erro geral:', err.message);
        console.error('Stack:', err.stack);
        await sock.sendMessage(from, {
            text: `❌ Erro ao enviar recados: ${err.message}\n\nTenta de novo.`,
            mentions: [senderId],
            quoted: message
        });
    }

    return true;
}