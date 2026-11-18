// enxugarFalsas.js
// Deixa no falsas.json só a lista "sertanejo" (sem os estilos que o banco não usa)
// e tira 4 músicas que destoam do estilo.
//
//   node enxugarFalsas.js            -> simulação
//   node enxugarFalsas.js --aplicar  -> grava (backup em falsas.json.bak2)
import fs from 'fs';

const FALSAS_PATH = './bot/data/falsas.json';
const APLICAR = process.argv.includes('--aplicar');

const TIRAR = new Set([
  'Menino da Porteira — Sérgio Reis',
  'Chico Mineiro — Tonico e Tinoco',
  'Tocando em Frente — Almir Sater',
  'Recairei — Os Barões da Pisadinha',
]);

const falsas = JSON.parse(fs.readFileSync(FALSAS_PATH, 'utf8'));
const sertanejo = (falsas.sertanejo || []).filter(t => !TIRAR.has(t));

console.log(`Chaves antes: ${Object.keys(falsas).join(', ')}`);
console.log(`Sertanejo: ${falsas.sertanejo.length} -> ${sertanejo.length}`);

if (APLICAR) {
  fs.copyFileSync(FALSAS_PATH, FALSAS_PATH + '.bak2');
  fs.writeFileSync(FALSAS_PATH, JSON.stringify({ sertanejo }, null, 2) + '\n', 'utf8');
  console.log('Gravado. Agora só existe a chave "sertanejo".');
} else {
  console.log('(simulação: nada foi alterado. Use --aplicar para gravar.)');
}