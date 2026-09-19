import pool from '../../../../db.js';
import fs from 'fs';
import path from 'path';

// ─────────────────────────────────────────────────────────────────────────────
// 💾 SALVAR RECADO COM IMAGEM E ÁUDIO EM BASE64
//
// Ao invés de guardar URLs, guarda a imagem/áudio codificados
// ─────────────────────────────────────────────────────────────────────────────

// Lê um arquivo e converte pra base64
function lerArquivoBase64(caminhoArquivo) {
    try {
        console.log(`📂 Lendo arquivo: ${caminhoArquivo}`);
        const buffer = fs.readFileSync(caminhoArquivo);
        const base64 = buffer.toString('base64');
        console.log(`✅ Convertido para base64: ${base64.length} caracteres (${buffer.length} bytes)`);
        return base64;
    } catch (err) {
        console.error(`❌ Erro ao ler arquivo: ${err.message}`);
        return null;
    }
}

// Salva um recado COM foto em base64
export async function salvarRecadoComFoto(
    numero_destinatario,
    content,
    caminhoFoto,
    ip = null
) {
    try {
        console.log('\n📝 [SALVAR] Criando recado com FOTO...');
        
        // Lê a foto e converte pra base64
        const photoBase64 = lerArquivoBase64(caminhoFoto);
        
        if (!photoBase64) {
            throw new Error('Não consegui ler a foto');
        }

        // Salva no banco
        const { rows } = await pool.query(
            `INSERT INTO recados_anonimos 
             (numero_destinatario, content, photo_base64, status, ip)
             VALUES ($1, $2, $3, 'pendente', $4)
             RETURNING id`,
            [numero_destinatario, content, photoBase64, ip || null]
        );

        const recadoId = rows[0].id;
        console.log(`✅ [SALVAR] Recado #${recadoId} salvo com foto!`);
        return recadoId;

    } catch (err) {
        console.error('❌ [SALVAR] Erro ao salvar recado com foto:', err.message);
        throw err;
    }
}

// Salva um recado COM áudio em base64
export async function salvarRecadoComAudio(
    numero_destinatario,
    content,
    caminhoAudio,
    ip = null
) {
    try {
        console.log('\n📝 [SALVAR] Criando recado com ÁUDIO...');
        
        // Lê o áudio e converte pra base64
        const musicBase64 = lerArquivoBase64(caminhoAudio);
        
        if (!musicBase64) {
            throw new Error('Não consegui ler o áudio');
        }

        // Salva no banco
        const { rows } = await pool.query(
            `INSERT INTO recados_anonimos 
             (numero_destinatario, content, music_base64, status, ip)
             VALUES ($1, $2, $3, 'pendente', $4)
             RETURNING id`,
            [numero_destinatario, content, musicBase64, ip || null]
        );

        const recadoId = rows[0].id;
        console.log(`✅ [SALVAR] Recado #${recadoId} salvo com áudio!`);
        return recadoId;

    } catch (err) {
        console.error('❌ [SALVAR] Erro ao salvar recado com áudio:', err.message);
        throw err;
    }
}

// Salva um recado COM foto E áudio em base64
export async function salvarRecadoCompletoBase64(
    numero_destinatario,
    content,
    caminhoFoto = null,
    caminhoAudio = null,
    ip = null
) {
    try {
        console.log('\n📝 [SALVAR] Criando recado COMPLETO...');
        
        let photoBase64 = null;
        let musicBase64 = null;

        // Lê foto se tiver
        if (caminhoFoto) {
            photoBase64 = lerArquivoBase64(caminhoFoto);
            if (!photoBase64) {
                console.warn('⚠️  Foto não conseguiu ser processada');
            }
        }

        // Lê áudio se tiver
        if (caminhoAudio) {
            musicBase64 = lerArquivoBase64(caminhoAudio);
            if (!musicBase64) {
                console.warn('⚠️  Áudio não conseguiu ser processado');
            }
        }

        // Salva no banco
        const { rows } = await pool.query(
            `INSERT INTO recados_anonimos 
             (numero_destinatario, content, photo_base64, music_base64, status, ip)
             VALUES ($1, $2, $3, $4, 'pendente', $5)
             RETURNING id`,
            [numero_destinatario, content, photoBase64, musicBase64, ip || null]
        );

        const recadoId = rows[0].id;
        console.log(`✅ [SALVAR] Recado #${recadoId} salvo ${caminhoFoto ? '📸' : ''}${caminhoAudio ? '🎵' : ''}!`);
        return recadoId;

    } catch (err) {
        console.error('❌ [SALVAR] Erro ao salvar recado completo:', err.message);
        throw err;
    }
}

// Salva um recado SÓ TEXTO (simples)
export async function salvarRecadoSimples(
    numero_destinatario,
    content,
    ip = null
) {
    try {
        console.log('\n📝 [SALVAR] Criando recado apenas TEXTO...');
        
        const { rows } = await pool.query(
            `INSERT INTO recados_anonimos 
             (numero_destinatario, content, status, ip)
             VALUES ($1, $2, 'pendente', $3)
             RETURNING id`,
            [numero_destinatario, content, ip || null]
        );

        const recadoId = rows[0].id;
        console.log(`✅ [SALVAR] Recado #${recadoId} salvo!`);
        return recadoId;

    } catch (err) {
        console.error('❌ [SALVAR] Erro ao salvar recado:', err.message);
        throw err;
    }
}

// ============================================
// 🧪 EXEMPLOS DE USO
// ============================================

export async function exemploUso() {
    console.log('\n' + '='.repeat(60));
    console.log('📚 EXEMPLOS DE USO');
    console.log('='.repeat(60));

    // Exemplo 1: Recado SÓ TEXTO
    console.log('\n1️⃣  RECADO SÓ TEXTO:');
    console.log(`
    const recadoId = await salvarRecadoSimples(
        '5585988776655',
        'Você é incrível! ❤️',
        '192.168.1.1'
    );
    `);

    // Exemplo 2: Recado COM FOTO
    console.log('\n2️⃣  RECADO COM FOTO:');
    console.log(`
    const recadoId = await salvarRecadoComFoto(
        '5585988776655',
        'Olha que linda essa foto! 📸',
        './uploads/foto123.jpg',
        '192.168.1.1'
    );
    `);

    // Exemplo 3: Recado COM ÁUDIO
    console.log('\n3️⃣  RECADO COM ÁUDIO:');
    console.log(`
    const recadoId = await salvarRecadoComAudio(
        '5585988776655',
        'Gravei um recado pra você! 🎤',
        './uploads/audio123.mp3',
        '192.168.1.1'
    );
    `);

    // Exemplo 4: Recado COMPLETO (FOTO + ÁUDIO)
    console.log('\n4️⃣  RECADO COMPLETO:');
    console.log(`
    const recadoId = await salvarRecadoCompletoBase64(
        '5585988776655',
        'Olha o que preparei pra você! 💝',
        './uploads/foto123.jpg',
        './uploads/audio123.mp3',
        '192.168.1.1'
    );
    `);

    console.log('\n' + '='.repeat(60));
}

// Execute os exemplos se rodar direto
// node salvarRecadoComBase64.js
if (import.meta.url === `file://${process.argv[1]}`) {
    exemploUso();
}