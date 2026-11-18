// limparJson.js
// Remove do JSON as músicas que não têm MP3 na pasta.
//   node limparJson.js            -> simulação
//   node limparJson.js --aplicar  -> grava (backup em musicasDesafio.json.bak3)
import fs from 'fs';

const PASTA = './bot/codigos/musicas-desafio';
const JSON_PATH = './bot/data/musicasDesafio.json';
const APLICAR = process.argv.includes('--aplicar');

const banco = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
const arquivos = new Set(fs.readdirSync(PASTA).filter(f => f.toLowerCase().endsWith('.mp3')));

const ficam = banco.filter(m => arquivos.has(m.arquivo));
const saem = banco.filter(m => !arquivos.has(m.arquivo));
const semJson = [...arquivos].filter(f => !banco.some(m => m.arquivo === f));

console.log(`No JSON: ${banco.length} | ficam: ${ficam.length} | saem: ${saem.length}`);
console.log(`Saem: ${saem.map(m => `#${m.id} ${m.titulo}`).join(', ')}`);
if (semJson.length) console.log(`\n⚠️ MP3 sem entrada no JSON:\n  ${semJson.join('\n  ')}`);

if (APLICAR) {
  fs.copyFileSync(JSON_PATH, JSON_PATH + '.bak3');
  fs.writeFileSync(JSON_PATH, JSON.stringify(ficam, null, 2) + '\n', 'utf8');
  console.log('\nGravado.');
} else {
  console.log('\n(simulação: nada foi alterado. Use --aplicar para gravar.)');
}