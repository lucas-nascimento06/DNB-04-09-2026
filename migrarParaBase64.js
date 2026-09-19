import axios from 'axios';
import pool from './db.js';

// ─────────────────────────────────────────────────────────────────────────────
// 🔄 MIGRAÇÃO: URL de foto → Base64 armazenado no banco
//
// Isso faz com que não precise mais baixar da Vercel toda hora!
// ─────────────────────────────────────────────────────────────────────────────

async function adicionarColunasBase64() {
    console.log('🔧 [MIGRAÇÃO] Adicionando colunas base64 ao banco...');
    try {
        // Adiciona coluna para guardar foto em base64
        await pool.query(`
            ALTER TABLE recados_anonimos 
            ADD COLUMN IF NOT EXISTS photo_base64 TEXT
        `);
        console.log('✅ [MIGRAÇÃO] Coluna photo_base64 criada/verificada');

        // Adiciona coluna para guardar áudio em base64
        await pool.query(`
            ALTER TABLE recados_anonimos 
            ADD COLUMN IF NOT EXISTS music_base64 TEXT
        `);
        console.log('✅ [MIGRAÇÃO] Coluna music_base64 criada/verificada');
    } catch (err) {
        console.error('❌ [MIGRAÇÃO] Erro ao adicionar colunas:', err.message);
    }
}

async function baixarBuffer(url, tipo = 'image') {
    try {
        console.log(`🔽 Baixando ${tipo}: ${url}`);
        const response = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 60000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': tipo === 'image' ? 'image/*' : 'audio/*'
            },
            maxRedirects: 5
        });
        
        const buffer = Buffer.from(response.data);
        const base64 = buffer.toString('base64');
        console.log(`✅ ${tipo.toUpperCase()} convertido para base64: ${base64.length} caracteres`);
        return base64;
    } catch (err) {
        console.error(`❌ Erro ao baixar ${tipo}:`, err.message);
        return null;
    }
}

async function migrarFotos() {
    console.log('\n📸 [MIGRAÇÃO] Iniciando migração de FOTOS...\n');
    
    try {
        // Busca recados com photo_url que ainda não tem photo_base64
        const { rows } = await pool.query(`
            SELECT id, photo_url 
            FROM recados_anonimos 
            WHERE photo_url IS NOT NULL 
            AND photo_base64 IS NULL
        `);

        if (rows.length === 0) {
            console.log('✨ Nenhuma foto pra migrar!');
            return;
        }

        console.log(`📋 [MIGRAÇÃO] ${rows.length} fotos para converter...\n`);

        for (let i = 0; i < rows.length; i++) {
            const recado = rows[i];
            console.log(`[${i + 1}/${rows.length}] Recado #${recado.id}...`);

            const base64 = await baixarBuffer(recado.photo_url, 'image');

            if (base64) {
                await pool.query(
                    'UPDATE recados_anonimos SET photo_base64 = $1 WHERE id = $2',
                    [base64, recado.id]
                );
                console.log(`✅ Foto #${recado.id} migrada!\n`);
            } else {
                console.log(`⚠️  Foto #${recado.id} falhou, pulando...\n`);
            }

            // Delay pra não sobrecarregar
            await new Promise(r => setTimeout(r, 500));
        }

        console.log('✅ Migração de FOTOS concluída!');
    } catch (err) {
        console.error('❌ Erro na migração de fotos:', err.message);
    }
}

async function migrarAudios() {
    console.log('\n🎵 [MIGRAÇÃO] Iniciando migração de ÁUDIOS...\n');
    
    try {
        // Busca recados com music_url que ainda não tem music_base64
        const { rows } = await pool.query(`
            SELECT id, music_url 
            FROM recados_anonimos 
            WHERE music_url IS NOT NULL 
            AND music_base64 IS NULL
        `);

        if (rows.length === 0) {
            console.log('✨ Nenhum áudio pra migrar!');
            return;
        }

        console.log(`📋 [MIGRAÇÃO] ${rows.length} áudios para converter...\n`);

        for (let i = 0; i < rows.length; i++) {
            const recado = rows[i];
            console.log(`[${i + 1}/${rows.length}] Recado #${recado.id}...`);

            const base64 = await baixarBuffer(recado.music_url, 'audio');

            if (base64) {
                await pool.query(
                    'UPDATE recados_anonimos SET music_base64 = $1 WHERE id = $2',
                    [base64, recado.id]
                );
                console.log(`✅ Áudio #${recado.id} migrado!\n`);
            } else {
                console.log(`⚠️  Áudio #${recado.id} falhou, pulando...\n`);
            }

            // Delay pra não sobrecarregar
            await new Promise(r => setTimeout(r, 500));
        }

        console.log('✅ Migração de ÁUDIOS concluída!');
    } catch (err) {
        console.error('❌ Erro na migração de áudios:', err.message);
    }
}

async function mostrarEstatisticas() {
    console.log('\n📊 [MIGRAÇÃO] Verificando progresso...\n');
    
    try {
        const { rows } = await pool.query(`
            SELECT 
                COUNT(*) as total,
                COUNT(CASE WHEN photo_base64 IS NOT NULL THEN 1 END) as fotos_migradas,
                COUNT(CASE WHEN music_base64 IS NOT NULL THEN 1 END) as audios_migrados
            FROM recados_anonimos
        `);

        const stats = rows[0];
        console.log(`📈 Total de recados: ${stats.total}`);
        console.log(`✅ Fotos em base64: ${stats.fotos_migradas}`);
        console.log(`✅ Áudios em base64: ${stats.audios_migrados}`);
        console.log();
    } catch (err) {
        console.error('❌ Erro ao buscar estatísticas:', err.message);
    }
}

async function executarMigracao() {
    console.log('\n' + '='.repeat(60));
    console.log('🚀 INICIANDO MIGRAÇÃO URL → BASE64');
    console.log('='.repeat(60) + '\n');

    await adicionarColunasBase64();
    await new Promise(r => setTimeout(r, 1000));

    await mostrarEstatisticas();
    await migrarFotos();
    await migrarAudios();
    await mostrarEstatisticas();

    console.log('\n' + '='.repeat(60));
    console.log('✅ MIGRAÇÃO COMPLETA!');
    console.log('='.repeat(60) + '\n');
    
    process.exit(0);
}

executarMigracao().catch(err => {
    console.error('❌ ERRO CRÍTICO:', err);
    process.exit(1);
});