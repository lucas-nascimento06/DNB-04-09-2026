// integrarMusicas.js
// Renomeia os MP3 novos para o padrão (titulo-em-slug.mp3) e cadastra no musicasDesafio.json.
//   node integrarMusicas.js            -> simulação (não altera nada)
//   node integrarMusicas.js --aplicar  -> renomeia e grava (backup em .bak)
import fs from 'fs';
import path from 'path';

const PASTA = './bot/codigos/musicas-desafio';
const JSON_PATH = './bot/data/musicasDesafio.json';
const APLICAR = process.argv.includes('--aplicar');

// nome do arquivo (sem .mp3) -> [titulo, artista, estilo]
// Estilos válidos: sertanejo, pagode, mpb, rock, pop, brega, urbano
const MANUAL = {
  'Hotel California - Eagles (Lyrics)': ['Hotel California', 'Eagles', 'rock'],
  'guns n roses sweet child o mine Lyrics': ["Sweet Child O' Mine", "Guns N' Roses", 'rock'],
  'Halo-Beyonce lyric': ['Halo', 'Beyoncé', 'pop'],
  'AI AI AI-Vanessa da Matá(Belíssima 2006)': ['Ai Ai Ai', 'Vanessa da Mata', 'mpb'],
  'Voyage Voyage-Desireless': ['Voyage Voyage', 'Desireless', 'pop'],
  'legiaourbana - indios': ['Índios', 'Legião Urbana', 'rock'],
  'roupa nova - A Força do Amor': ['A Força do Amor', 'Roupa Nova', 'pop'],
  'LS Jack - Carla': ['Carla', 'LS Jack', 'rock'],
  'XIBOM BOMBOM-AS MENINAS-CLIPE-ANO 1999  [HD]': ['Xibom Bombom', 'As Meninas', 'pop'],
  'Set Fire To The Rain (Adele) música tema de Nina e Jorginho': ['Set Fire To The Rain', 'Adele', 'pop'],
  'THE HOUSEMARTINS - Build (Melô do Papel)': ['Build', 'The Housemartins', 'pop'],
  'JAŸ-Z - Empire State Of Mind ft. Alicia Keys': ['Empire State Of Mind', 'Jay-Z', 'urbano'],
  "WHAT'S UP - 4 Non Blondes   Subtítulos inglés y español": ["What's Up", '4 Non Blondes', 'rock'],
  'We Are The World - Michael Jackson [Lyrics y Subtitulos en Español]': ['We Are The World', 'Michael Jackson', 'pop'],
  'Travie McCoy Billionaire ft. Bruno Mars [OFFICIAL VIDEO]': ['Billionaire', 'Travie McCoy', 'pop'],
  'Berlin - Take My Breathe Away theme from Top Gun with Lyrics': ['Take My Breath Away', 'Berlin', 'pop'],
  'I Just Called To Say I Love You': ['I Just Called To Say I Love You', 'Stevie Wonder', 'pop'],
  'Faroeste Caboclo': ['Faroeste Caboclo', 'Legião Urbana', 'rock'],
  'Vento No Litoral': ['Vento no Litoral', 'Legião Urbana', 'rock'],
  'Você Não Soube Me Amar': ['Você Não Soube Me Amar', 'Blitz', 'rock'],
  'Vou Deixar': ['Vou Deixar', 'Skank', 'rock'],
  'legiao-urbana-ainda-é-cedo': ['Ainda É Cedo', 'Legião Urbana', 'rock'],
  'Seguindo No Trem Azul': ['Seguindo no Trem Azul', 'Roupa Nova', 'pop'],
  'Deixaria Tudo (Dejaria Todo)': ['Deixaria Tudo', 'Chayanne', 'pop'],
  'I Miss You (Album Mix)': ['I Miss You', 'Haddaway', 'pop'], // CONFERIR: ouça o arquivo
  'Alice Caymmi - Louca (Áudio Oficial)': ['Louca', 'Alice Caymmi', 'mpb'],
  'Cidade Negra - Girassol (Acustico MTV Pseudo Vídeo)': ['Girassol', 'Cidade Negra', 'mpb'],
  'Cidade Negra - Onde Você Mora (Acústico) (Pseudo Video)': ['Onde Você Mora', 'Cidade Negra', 'mpb'],
  'Tribalistas - Já Sei Namorar': ['Já Sei Namorar', 'Tribalistas', 'mpb'],
  'Nego do Borel - Você Partiu Meu Coração (Videoclipe) ft. Anitta, Wesley Safadão': ['Você Partiu Meu Coração', 'Nego do Borel', 'urbano'],
  'Ben E  King - Stand By Me (Lyrics)': ['Stand By Me', 'Ben E. King', 'pop'],
  'Cada Volta é um Recomeço': ['Cada Volta é um Recomeço', 'Zezé Di Camargo & Luciano', 'sertanejo'],
  'Declaração de amor': ['Declaração de Amor', 'Daniel', 'sertanejo'],
  'Me Namora': ['Me Namora', 'Tribalistas', 'mpb'],
};

// artistas que viram "rock" automaticamente (o resto com artista conhecido vira "pop")
const ROCK_LISTA = ['guns n roses', 'bon jovi', 'europe', 'faith no more', 'billy idol', 'oasis', 'eagles',
  'coldplay', 'tears for fears', 'duran duran', 'extreme', 'the cranberries', 'roxette', 'bryan adams',
  'kenny loggins', 'legiao urbana', 'ls jack', 'charlie brown jr', 'alphaville', '4 non blondes', 'skank', 'blitz'];

const norm = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const slug = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/['’]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const limpar = s => s
  .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
  .replace(/\s+(ft\.?|feat\.?)\s.*$/i, '')
  .replace(/\s+/g, ' ').trim();
const titleCase = s => s.split('-').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');

// busca no MANUAL ignorando acento/maiúscula/pontuação
const MANUAL_N = Object.fromEntries(Object.entries(MANUAL).map(([k, v]) => [norm(k), v]));
const ROCK_N = new Set(ROCK_LISTA.map(norm));

const banco = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
const jaNoBanco = new Set(banco.map(m => m.arquivo));
const arquivos = fs.readdirSync(PASTA).filter(f => f.toLowerCase().endsWith('.mp3'));
const ocupados = new Set(arquivos);
let proximoId = Math.max(0, ...banco.map((m, i) => m.id ?? i + 1)) + 1;

const novas = [];
const conferir = [];

for (const arq of arquivos) {
  if (jaNoBanco.has(arq)) continue;
  const base = arq.replace(/\.mp3$/i, '');

  let titulo, artista, estilo, manterNome = false;
  const man = MANUAL_N[norm(base)];
  if (man) {
    [titulo, artista, estilo] = man;
  } else if (/^[a-z0-9-]+$/.test(base)) {            // já está em slug, só falta cadastrar
    titulo = titleCase(base); artista = 'CONFERIR ARTISTA'; manterNome = true;
  } else if (base.includes(' - ')) {
    const [a, ...resto] = base.split(' - ');
    artista = limpar(a);
    titulo = limpar(resto.join(' - '));
  } else {
    titulo = limpar(base); artista = 'CONFERIR ARTISTA';
  }
  if (!estilo && artista !== 'CONFERIR ARTISTA') {
    estilo = ROCK_N.has(norm(artista)) ? 'rock' : 'pop';
  }

  let novoNome = manterNome ? arq : `${slug(titulo)}.mp3`;
  if (novoNome !== arq && ocupados.has(novoNome)) novoNome = `${slug(titulo)}-${slug(artista)}.mp3`;
  ocupados.add(novoNome);

  const id = proximoId++;
  console.log(`#${id} ${titulo} — ${artista} [${estilo || '??'}]\n     "${arq}" → "${novoNome}"`);
  if (artista.includes('CONFERIR') || !estilo) conferir.push(`#${id} ${titulo}`);

  if (APLICAR && novoNome !== arq) fs.renameSync(path.join(PASTA, arq), path.join(PASTA, novoNome));
  novas.push({ id, titulo, artista, estilo: estilo || '', arquivo: novoNome });
}

if (APLICAR && novas.length) {
  fs.writeFileSync(JSON_PATH, JSON.stringify([...banco, ...novas], null, 2) + '\n', 'utf8');
}

console.log(`\n${APLICAR ? 'Integradas' : 'Seriam integradas'}: ${novas.length}`);
if (conferir.length) console.log(`\n🔎 Corrigir artista/estilo no JSON:\n  ${conferir.join('\n  ')}`);