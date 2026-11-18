// corrigirMusicasDesafio.js
// Ajusta o musicasDesafio.json para as músicas que estão HOJE na pasta musicas-desafio:
//  - MP3 que já existe no JSON (ids 7, 30, 31, 37, 40, 50, 80): só renomeia para o nome esperado
//  - MP3 novo: renomeia para slug e cadastra no JSON com id novo
//  - As outras entradas do JSON ficam como estão (sem MP3 elas não tocam, mas guardam o id)
//
//   node corrigirMusicasDesafio.js            -> simulação (não altera nada)
//   node corrigirMusicasDesafio.js --aplicar  -> renomeia e grava (backup em musicasDesafio.json.bak)
import fs from 'fs';
import path from 'path';

const PASTA = './bot/codigos/musicas-desafio';
const JSON_PATH = './bot/data/musicasDesafio.json';
const APLICAR = process.argv.includes('--aplicar');

// nome do arquivo (sem .mp3) -> [titulo, artista, estilo, idExistente?]
const MAP = {
  'Ainda Ontem Chorei De Saudade - joão mineiro e marciano': ['Ainda Ontem Chorei de Saudade', 'João Mineiro & Marciano', 'sertanejo'],
  'Danilo e Davi - Apaga Apaga Apaga': [null, null, null, 37],
  'Danilo e Davi - Não Mexe Nas Minhas Gavetas (DVD Aliança)': ['Não Mexe nas Minhas Gavetas', 'Danilo e Davi', 'sertanejo'],
  'Dormi na praça - bruno e marrone': [null, null, null, 40],
  'Evidências- chitãozinho e chororo': [null, null, null, 7],
  'Fuscão Preto': ['Fuscão Preto', 'Almir Rogério', 'sertanejo'], // CONFERIR o intérprete do arquivo
  'Gusttavo Lima - Apelido Carinhoso': ['Apelido Carinhoso', 'Gusttavo Lima', 'sertanejo'],
  'Gusttavo Lima - Bloqueado': ['Bloqueado', 'Gusttavo Lima', 'sertanejo'],
  'Gusttavo Lima - Cem Mil': ['Cem Mil', 'Gusttavo Lima', 'sertanejo'],
  'Gusttavo Lima - Ficha Limpa': ['Ficha Limpa', 'Gusttavo Lima', 'sertanejo'],
  'Gusttavo Lima - Termina Comigo Antes': ['Termina Comigo Antes', 'Gusttavo Lima', 'sertanejo'],
  'Henrique e Juliano - A MAIOR SAUDADE': [null, null, null, 31],
  'Henrique e Juliano - ARRANHÃO': ['Arranhão', 'Henrique e Juliano', 'sertanejo'],
  'Henrique e Juliano - Cuida Bem Dela': ['Cuida Bem Dela', 'Henrique e Juliano', 'sertanejo'],
  'Henrique e Juliano - LIBERDADE PROVISÓRIA': ['Liberdade Provisória', 'Henrique e Juliano', 'sertanejo'],
  'Henrique e Juliano - NA HORA DA RAIVA': ['Na Hora da Raiva', 'Henrique e Juliano', 'sertanejo'],
  'Henrique e Juliano - Recaídas': ['Recaídas', 'Henrique e Juliano', 'sertanejo'],
  'Leandro e Leonardo - Pense Em Mim': [null, null, null, 80],
  'Luan Santana - CHUVA DE ARROZ': ['Chuva de Arroz', 'Luan Santana', 'sertanejo'],
  'Luan Santana - ESCREVE AÍ': ['Escreve Aí', 'Luan Santana', 'sertanejo'],
  'Luan Santana - Meteoro da Paixão': ['Meteoro da Paixão', 'Luan Santana', 'sertanejo'],
  'Luan Santana - TE ESPERANDO': ['Te Esperando', 'Luan Santana', 'sertanejo'],
  'Maiara & Maraisa - 10%': ['10%', 'Maiara & Maraisa', 'sertanejo'],
  'Maiara e Maraisa - Medo Bobo': [null, null, null, 50],
  'Maiara e Maraisa - A Culpa É Nossa': ['A Culpa É Nossa', 'Maiara & Maraisa', 'sertanejo'],
  'Maiara e Maraisa - Nem Tchum': ['Nem Tchum', 'Maiara & Maraisa', 'sertanejo'],
  'Maiara e Maraisa – Sorte Que Cê Beija Bem': ['Sorte Que Cê Beija Bem', 'Maiara & Maraisa', 'sertanejo'],
  'Marília Mendonça - Como Faz Com Ela': ['Como Faz Com Ela', 'Marília Mendonça', 'sertanejo'],
  'Marília Mendonça - De Quem É A Culpa': ['De Quem É a Culpa', 'Marília Mendonça', 'sertanejo'],
  'Marília Mendonça - Eu Sei De Cor': ['Eu Sei de Cor', 'Marília Mendonça', 'sertanejo'],
  'Marília Mendonça - Infiel': ['Infiel', 'Marília Mendonça', 'sertanejo'],
  'Marília Mendonça - Todo Mundo Vai Sofrer': ['Todo Mundo Vai Sofrer', 'Marília Mendonça', 'sertanejo'],
  'Vítor e Léo Borboletas': ['Borboletas', 'Victor & Leo', 'sertanejo'],
  'Zé Felipe, Ana Castela - Sua Boca Mente': ['Sua Boca Mente', 'Zé Felipe e Ana Castela', 'sertanejo'],
  'Zé Neto e Cristiano - BARZINHO ALEATÓRIO': ['Barzinho Aleatório', 'Zé Neto e Cristiano', 'sertanejo'],
  'Zé Neto e Cristiano - BEBIDA NA FERIDA': ['Bebida na Ferida', 'Zé Neto e Cristiano', 'sertanejo'],
  'Zé Neto e Cristiano - LARGADO ÀS TRAÇAS': ['Largado às Traças', 'Zé Neto e Cristiano', 'sertanejo'],
  'Zé Neto e Cristiano - NOTIFICAÇÃO PREFERIDA': ['Notificação Preferida', 'Zé Neto e Cristiano', 'sertanejo'],
  'Zé Neto e Cristiano - STATUS QUE EU NÃO QUERIA': ['Status Que Eu Não Queria', 'Zé Neto e Cristiano', 'sertanejo'],
  'Zezé Di Camargo & Luciano - É o Amor': [null, null, null, 30],
};

const norm = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const slug = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const MAP_N = Object.fromEntries(Object.entries(MAP).map(([k, v]) => [norm(k), v]));

const banco = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8')).map((m, i) => ({ ...m, id: m.id ?? i + 1 }));
const porId = new Map(banco.map(m => [m.id, m]));
const arquivos = fs.readdirSync(PASTA).filter(f => f.toLowerCase().endsWith('.mp3'));
const ocupados = new Set(arquivos);
let proximoId = Math.max(0, ...banco.map(m => m.id)) + 1;

const novas = [];
const tratados = new Set();
const desconhecidos = [];
const duplicados = [];

for (const arq of arquivos) {
  const base = arq.replace(/\.mp3$/i, '');
  const reg = MAP_N[norm(base)];
  if (!reg) {
    // já está com o nome certo de alguma entrada do JSON?
    if (banco.some(m => m.arquivo === arq)) continue;
    desconhecidos.push(arq);
    continue;
  }

  const [titulo, artista, estilo, idExistente] = reg;
  const chave = idExistente ?? norm(`${titulo}${artista}`);
  if (tratados.has(chave)) { duplicados.push(arq); continue; }
  tratados.add(chave);

  if (idExistente) {
    const m = porId.get(idExistente);
    if (!m) { console.log(`⚠️ id ${idExistente} não existe no JSON (${arq})`); continue; }
    if (m.arquivo === arq) continue;
    if (ocupados.has(m.arquivo)) { console.log(`⚠️ "${m.arquivo}" já existe, não renomeei "${arq}"`); continue; }
    console.log(`#${m.id} ${m.titulo} — ${m.artista}\n     "${arq}" → "${m.arquivo}"`);
    if (APLICAR) fs.renameSync(path.join(PASTA, arq), path.join(PASTA, m.arquivo));
    ocupados.add(m.arquivo);
    continue;
  }

  let novoNome = `${slug(titulo)}.mp3`;
  if (ocupados.has(novoNome) || banco.some(m => m.arquivo === novoNome)) novoNome = `${slug(titulo)}-${slug(artista)}.mp3`;
  ocupados.add(novoNome);

  const id = proximoId++;
  console.log(`#${id} ${titulo} — ${artista} [${estilo}]\n     "${arq}" → "${novoNome}"`);
  if (APLICAR) fs.renameSync(path.join(PASTA, arq), path.join(PASTA, novoNome));
  novas.push({ id, titulo, artista, estilo, arquivo: novoNome });
}

if (APLICAR && novas.length) {
  fs.copyFileSync(JSON_PATH, JSON_PATH + '.bak');
  fs.writeFileSync(JSON_PATH, JSON.stringify([...banco, ...novas], null, 2) + '\n', 'utf8');
}

console.log(`\n${APLICAR ? 'Cadastradas' : 'Seriam cadastradas'}: ${novas.length}`);
if (duplicados.length) console.log(`\n♻️ Arquivos repetidos (mesma música), apague um:\n  ${duplicados.join('\n  ')}`);
if (desconhecidos.length) console.log(`\n❓ MP3 que o script não conhece (cadastre à mão ou use integrarMusicas.js):\n  ${desconhecidos.join('\n  ')}`);
if (!APLICAR) console.log('\n(simulação: nada foi alterado. Use --aplicar para executar.)');