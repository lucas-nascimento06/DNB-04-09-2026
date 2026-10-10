import fs from 'fs';
import path from 'path';

const pasta = './bot/codigos/musicas-desafio';
const banco = JSON.parse(fs.readFileSync('./bot/data/musicasDesafio.json', 'utf8'));
const arquivos = fs.readdirSync(pasta).filter(f => f.toLowerCase().endsWith('.mp3'));
const APLICAR = process.argv.includes('--aplicar');

// ids cujo arquivo está escrito diferente do título
const BUSCA_ALTERNATIVA = { 8: 'borbujas', 10: 'garcon' };

const norm = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]/g, '');

const usados = new Set();
let ok = 0, falhas = 0;

for (const m of banco) {
    if (fs.existsSync(path.join(pasta, m.arquivo))) { usados.add(m.arquivo); continue; }

    const titulo = norm(BUSCA_ALTERNATIVA[m.id] ?? m.titulo);
    const artista = norm(m.artista).slice(0, 5);
    const candidatos = arquivos.filter(f => !usados.has(f) && norm(f).includes(titulo));
    const melhor = candidatos.find(f => norm(f).includes(artista)) || candidatos[0];

    if (!melhor) { console.log(`❌ #${m.id} ${m.titulo} — sem arquivo parecido`); falhas++; continue; }
    if (candidatos.length > 1) console.log(`⚠️  #${m.id} ${m.titulo} — ${candidatos.length} candidatos`);

    console.log(`#${m.id}: "${melhor}"  →  "${m.arquivo}"`);
    usados.add(melhor);
    ok++;
    if (APLICAR) fs.renameSync(path.join(pasta, melhor), path.join(pasta, m.arquivo));
}
console.log(`\n${APLICAR ? 'Renomeados' : 'Seriam renomeados'}: ${ok} | Sem arquivo: ${falhas}`);
