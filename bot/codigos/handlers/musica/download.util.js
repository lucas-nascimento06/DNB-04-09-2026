// 🛡️ YOUTUBE DOWNLOADER - COMPATÍVEL COM WINDOWS E TERMUX
import ytSearch from 'yt-search';
import { promises as fs, existsSync, copyFileSync } from 'fs';
import { tmpdir, homedir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const urlCache = new Map();
const CACHE_DURATION = 10 * 60 * 1000;

// 🍪 AUTENTICAÇÃO DO YOUTUBE (resolve "Sign in to confirm you're not a bot")
//
// Ordem de escolha:
//   1) cookies.txt (YTDLP_COOKIES_FILE, ao lado deste arquivo, raiz do projeto,
//      pasta atual ou ~/cookies.txt)
//   2) No Windows sem arquivo: cookies do Firefox
//   3) Sem nada: roda sem cookies
//
// Variáveis de ambiente opcionais:
//   YTDLP_COOKIES_FILE=/caminho/cookies.txt
//   YTDLP_COOKIES_BROWSER=firefox   (vazio = não usa navegador)
//   YTDLP_JS_RUNTIME=node           (runtime JS p/ desafios do YouTube; vazio = padrão do yt-dlp)
function detectarCookiesFile() {
    const candidatos = [
        join(__dirname, 'cookies.txt'),                   // bot/codigos/handlers/musica/cookies.txt
        join(__dirname, '..', '..', '..', '..', 'cookies.txt'), // raiz do projeto
        join(process.cwd(), 'cookies.txt'),
        join(homedir(), 'cookies.txt')
    ];
    return candidatos.find(p => existsSync(p)) || '';
}

const COOKIES_ORIGINAL = (process.env.YTDLP_COOKIES_FILE || '').trim() || detectarCookiesFile();

// O yt-dlp reescreve o arquivo de cookies ao terminar. Usamos uma cópia
// temporária para evitar erro de permissão e não corromper o original.
let COOKIES_FILE = '';
if (COOKIES_ORIGINAL) {
    try {
        COOKIES_FILE = join(tmpdir(), `ytdlp_cookies_${randomBytes(4).toString('hex')}.txt`);
        copyFileSync(COOKIES_ORIGINAL, COOKIES_FILE);
    } catch (e) {
        console.error(`⚠️ [AUTH] Não consegui copiar o cookies (${e.message}). Usando o original.`);
        COOKIES_FILE = COOKIES_ORIGINAL;
    }
}

const COOKIES_BROWSER = process.env.YTDLP_COOKIES_BROWSER !== undefined
    ? process.env.YTDLP_COOKIES_BROWSER.trim()
    : (process.platform === 'win32' ? 'firefox' : '');

const JS_RUNTIME = process.env.YTDLP_JS_RUNTIME !== undefined
    ? process.env.YTDLP_JS_RUNTIME.trim()
    : 'node';

// Mostra uma vez, na inicialização, qual modo de autenticação será usado
if (COOKIES_ORIGINAL) {
    console.log(`🍪 [AUTH] Usando cookies.txt: ${COOKIES_ORIGINAL}`);
} else if (COOKIES_BROWSER) {
    console.log(`🍪 [AUTH] Usando cookies do navegador: ${COOKIES_BROWSER}`);
} else {
    console.log('🍪 [AUTH] Sem cookies. Procurei em:');
    console.log(`   - ${join(__dirname, 'cookies.txt')}`);
    console.log(`   - ${join(__dirname, '..', '..', '..', '..', 'cookies.txt')}`);
    console.log(`   - ${join(process.cwd(), 'cookies.txt')}`);
    console.log(`   - ${join(homedir(), 'cookies.txt')}`);
}

// Argumentos de autenticação + solver de desafios JS do YouTube
function argsAutenticacao() {
    const args = [];

    if (COOKIES_FILE) {
        args.push('--cookies', COOKIES_FILE);
    } else if (COOKIES_BROWSER) {
        args.push('--cookies-from-browser', COOKIES_BROWSER);
    }

    // Runtime JS para resolver os desafios (o yt-dlp só usa Deno por padrão)
    if (JS_RUNTIME) {
        args.push('--js-runtimes', JS_RUNTIME);
    }

    // Baixa/usa o script solver dos desafios JS (fica em cache após a 1ª vez)
    args.push('--remote-components', 'ejs:github');

    return args;
}

// 🕐 DELAY HUMANO
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
let lastDownloadTime = 0;

// 📊 ESTATÍSTICAS
let stats = {
    success: 0,
    fail: 0,
    totalDownloads: 0
};

// 🔍 VERIFICAR SE YT-DLP ESTÁ INSTALADO
async function verificarYtDlp() {
    try {
        const { stdout } = await execFileAsync('yt-dlp', ['--version']);
        console.log(`✅ yt-dlp encontrado: ${stdout.trim()}`);
        return true;
    } catch (err) {
        throw new Error(
            '❌ yt-dlp não encontrado!\n' +
            'Instale no Termux com:\n' +
            '  pkg install python ffmpeg\n' +
            '  pip install -U yt-dlp'
        );
    }
}

function isYouTubeUrl(url) {
    return url.includes('youtube.com') || url.includes('youtu.be');
}

// 🚫 Erro de bot-check / login (não adianta repetir)
function isErroDeLogin(msg) {
    return msg.includes('Sign in to confirm');
}

// 🔍 BUSCAR MÚSICA POR NOME
export async function buscarUrlPorNome(termo) {
    const cacheKey = termo.toLowerCase().trim();
    const cached = urlCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        console.log(`⚡ [CACHE] "${termo}"`);
        return { url: cached.url, info: cached.info };
    }

    try {
        console.log(`🔍 [BUSCA] "${termo}"`);
        const inicio = Date.now();
        const resultados = await ytSearch(termo);

        if (!resultados?.videos?.length) {
            throw new Error('Nenhum vídeo encontrado.');
        }

        const video = resultados.videos[0];
        const url = video.url;

        const info = {
            titulo: video.title,
            autor: video.author?.name || video.author || 'Desconhecido',
            duracao: video.duration?.seconds || video.timestamp || 0,
            thumbnailUrl: video.thumbnail || video.image,
            url: url
        };

        urlCache.set(cacheKey, { url, info, timestamp: Date.now() });
        console.log(`✅ [BUSCA] ${Date.now() - inicio}ms`);
        return { url, info };
    } catch (err) {
        throw new Error(`Não foi possível encontrar: ${termo}`);
    }
}

async function resolverUrl(input) {
    if (isYouTubeUrl(input)) {
        return { url: input, info: null };
    }
    return await buscarUrlPorNome(input);
}

// 📋 OBTER INFORMAÇÕES DA MÚSICA
export async function obterDadosMusica(url) {
    try {
        await verificarYtDlp();

        const inicio = Date.now();
        let urlResolvida, infoCache;

        if (typeof url === 'string') {
            const resultado = await resolverUrl(url);
            urlResolvida = resultado.url;
            infoCache = resultado.info;
        } else {
            urlResolvida = url.url;
            infoCache = url.info;
        }

        if (infoCache) {
            console.log(`✅ [INFO-CACHE] ${Date.now() - inicio}ms`);
            return infoCache;
        }

        const args = [
            urlResolvida,
            '--dump-json',
            '--no-warnings',
            '--no-playlist',
            '--skip-download',
            '--referer', 'https://www.youtube.com/',

            // 🍪 AUTENTICAÇÃO (cookies + runtime JS + solver)
            ...argsAutenticacao()
        ];

        const { stdout } = await execFileAsync('yt-dlp', args, {
            maxBuffer: 50 * 1024 * 1024
        });
        const data = JSON.parse(stdout);

        console.log(`✅ [INFO-YTDLP] ${Date.now() - inicio}ms`);
        return {
            titulo: data.title,
            autor: data.uploader || data.channel || 'Desconhecido',
            duracao: data.duration || 0,
            url: data.webpage_url,
            thumbnailUrl: data.thumbnail
        };
    } catch (err) {
        throw new Error(`Erro ao obter informações: ${err.message}`);
    }
}

// 🎵 DOWNLOAD COM ANTI-DETECÇÃO
async function baixarComYtDlp(urlResolvida, tentativa = 1) {
    let tempFile = null;

    try {
        await verificarYtDlp();

        // 🕐 RATE LIMITING
        const now = Date.now();
        const timeSinceLastDownload = now - lastDownloadTime;
        if (timeSinceLastDownload < 3000) {
            const delayNeeded = 3000 - timeSinceLastDownload;
            console.log(`⏳ Aguardando ${(delayNeeded / 1000).toFixed(1)}s (anti-detecção)...`);
            await sleep(delayNeeded);
        }
        lastDownloadTime = Date.now();

        const inicioYtDlp = Date.now();
        console.log(`🔄 [YT-DLP] Tentativa ${tentativa}/3 - Iniciando download...`);

        // Arquivo final será <base>.opus (o yt-dlp troca %(ext)s após a conversão)
        const randomId = randomBytes(8).toString('hex');
        const baseFile = join(tmpdir(), `music_${randomId}`);
        tempFile = `${baseFile}.opus`;

        // 🎵 ESTRATÉGIA DE FORMATO (COM FALLBACK)
        const formatStrategies = [
            'bestaudio/best',
            'bestaudio[ext=m4a]/bestaudio[ext=mp4]/bestaudio',
            'bestaudio[ext=webm][acodec=opus]/bestaudio[acodec=opus]/best'
        ];

        const formatStrategy = formatStrategies[Math.min(tentativa - 1, formatStrategies.length - 1)];
        console.log(`🎵 [FORMATO] Estratégia ${tentativa}: ${formatStrategy}`);

        const args = [
            urlResolvida,
            '--format', formatStrategy,
            '--no-playlist',
            '--no-warnings',
            '--extractor-retries', '10',
            '--retries', '10',
            '--fragment-retries', '10',

            // 🛡️ REFERER
            '--referer', 'https://www.youtube.com/',

            // 🍪 AUTENTICAÇÃO (cookies + runtime JS + solver)
            ...argsAutenticacao(),

            // 🎧 EXTRAIR ÁUDIO E CONVERTER PARA OPUS (-x é obrigatório p/ --audio-format)
            '-x',
            '--audio-format', 'opus',
            '--audio-quality', '96K',
            '--postprocessor-args', 'ffmpeg:-ac 2 -ar 48000',

            // ⚡ PERFORMANCE
            '--concurrent-fragments', '5',
            '--buffer-size', '512K',
            '--http-chunk-size', '512K',
            '--socket-timeout', '30',

            '--output', `${baseFile}.%(ext)s`
        ];

        // Executar yt-dlp diretamente
        await execFileAsync('yt-dlp', args, {
            maxBuffer: 50 * 1024 * 1024 // 50MB buffer
        });

        const buffer = await fs.readFile(tempFile);
        const tempoYtDlp = Date.now() - inicioYtDlp;
        const tamanhoMB = (buffer.length / 1024 / 1024).toFixed(2);

        console.log(`✅ [YT-DLP] ${(tempoYtDlp / 1000).toFixed(1)}s (${tamanhoMB}MB)`);
        stats.success++;
        stats.totalDownloads++;

        return { buffer, metodo: 'yt-dlp', formato: 'opus' };
    } catch (err) {
        console.error(`❌ [YT-DLP] Tentativa ${tentativa} falhou:`, err.message);

        // 🍪 BOT-CHECK: repetir só piora o bloqueio, aborta na hora
        if (isErroDeLogin(err.message)) {
            if (COOKIES_ORIGINAL) {
                console.error(`🍪 [DICA] O YouTube pediu login mesmo com cookies. O arquivo ${COOKIES_ORIGINAL} provavelmente expirou: exporte um cookies.txt novo (de preferência de uma aba anônima, em youtube.com/robots.txt).`);
            } else if (process.platform === 'win32') {
                console.error('🍪 [DICA] O YouTube pediu login. Verifique se o Firefox está logado no YouTube (mesmo usuário do Windows em que o bot roda).');
            } else {
                console.error('🍪 [DICA] O YouTube pediu login. Coloque um cookies.txt em bot/codigos/handlers/musica/ (ou na raiz do projeto) e reinicie o bot.');
            }
            stats.fail++;
            const e = new Error(err.message);
            e.botCheck = true;
            throw e;
        }

        if (err.message.includes('could not find') && err.message.includes('cookies database')) {
            console.error('🍪 [DICA] O navegador de cookies não existe neste sistema. Use YTDLP_COOKIES_BROWSER= (vazio) ou um cookies.txt.');
        }

        // 🎵 PROBLEMA DE FORMATO
        if (err.message.includes('Requested format is not available') && tentativa < 3) {
            console.log('🔄 Tentando formato alternativo...');
            await sleep(1000);
            return await baixarComYtDlp(urlResolvida, tentativa + 1);
        }

        if (tentativa >= 3) {
            stats.fail++;
            throw err;
        }

        // Retry genérico
        console.log(`⏳ Aguardando ${tentativa * 2}s antes de tentar novamente...`);
        await sleep(tentativa * 2000);
        return await baixarComYtDlp(urlResolvida, tentativa + 1);
    } finally {
        if (tempFile) {
            try { await fs.unlink(tempFile); } catch {}
        }
    }
}

// 🎯 DOWNLOAD DE MÚSICA
export async function baixarMusicaBuffer(url) {
    try {
        const inicioTotal = Date.now();

        let urlResolvida;
        if (typeof url === 'string') {
            if (isYouTubeUrl(url)) {
                urlResolvida = url;
            } else {
                const resultado = await resolverUrl(url);
                urlResolvida = resultado.url;
            }
        } else if (typeof url === 'object' && url.url) {
            urlResolvida = url.url;
        } else {
            urlResolvida = String(url);
        }

        if (typeof urlResolvida !== 'string' || !isYouTubeUrl(urlResolvida)) {
            throw new Error(`URL inválida: ${urlResolvida}`);
        }

        console.log(`🔗 [DEBUG] URL final: ${urlResolvida}`);

        const result = await baixarComYtDlp(urlResolvida);
        console.log(`✅ [TOTAL] ${(Date.now() - inicioTotal) / 1000}s`);
        return result;
    } catch (err) {
        console.error(`❌ [DOWNLOAD] Erro: ${err.message}`);
        const e = new Error(`Falha no download: ${err.message}`);
        e.botCheck = err.botCheck || isErroDeLogin(err.message);
        throw e;
    }
}

// 🎵 DOWNLOAD COM INFORMAÇÕES
export async function baixarMusicaComInfo(url) {
    const inicio = Date.now();

    try {
        let urlFinal, infoCache;

        if (typeof url === 'string') {
            const resultado = await resolverUrl(url);
            urlFinal = resultado.url;
            infoCache = resultado.info;
        } else if (typeof url === 'object' && url.url) {
            urlFinal = url.url;
            infoCache = url.info;
        } else {
            urlFinal = String(url);
            infoCache = null;
        }

        const downloadResult = await baixarMusicaBuffer(urlFinal);

        const tempoTotal = (Date.now() - inicio) / 1000;
        console.log(`✅ [COMPLETO] ${tempoTotal.toFixed(1)}s | Formato: Opus 96K`);

        if (stats.totalDownloads % 10 === 0 && stats.totalDownloads > 0) {
            console.log(`📊 [STATS] ${JSON.stringify(obterEstatisticas(), null, 2)}`);
        }

        return {
            buffer: downloadResult.buffer,
            formato: downloadResult.formato,
            metodo: downloadResult.metodo,
            info: infoCache || { titulo: 'Desconhecido', autor: 'Desconhecido' }
        };
    } catch (err) {
        const e = new Error(`Falha: ${err.message}`);
        e.botCheck = err.botCheck || isErroDeLogin(err.message);
        throw e;
    }
}

// 📊 OBTER ESTATÍSTICAS
export function obterEstatisticas() {
    return {
        ...stats,
        taxaSucesso: stats.totalDownloads > 0
            ? ((stats.success / stats.totalDownloads) * 100).toFixed(1) + '%'
            : '0%'
    };
}

// 🧹 CLEANUP
export async function cleanup() {
    urlCache.clear();
    if (COOKIES_FILE && COOKIES_FILE !== COOKIES_ORIGINAL) {
        try { await fs.unlink(COOKIES_FILE); } catch {}
    }
    console.log('🧹 Recursos limpos');
    console.log('📊 Estatísticas finais:', obterEstatisticas());
}

// 🧹 LIMPEZA DE CACHE
setInterval(() => {
    const now = Date.now();
    for (const [key, value] of urlCache.entries()) {
        if (now - value.timestamp > CACHE_DURATION) {
            urlCache.delete(key);
        }
    }
}, CACHE_DURATION);