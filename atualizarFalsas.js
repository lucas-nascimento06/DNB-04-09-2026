// atualizarFalsas.js
// Troca SÓ a lista "sertanejo" do falsas.json por alternativas no estilo do banco novo.
// As outras chaves (pagode, mpb, rock...) ficam como estão.
//
//   node atualizarFalsas.js            -> simulação
//   node atualizarFalsas.js --aplicar  -> grava (backup em falsas.json.bak)
import fs from 'fs';

const FALSAS_PATH = './bot/data/falsas.json';
const BANCO_PATH = './bot/data/musicasDesafio.json';
const APLICAR = process.argv.includes('--aplicar');

const SERTANEJO = [
  // Gusttavo Lima
  'Balada — Gusttavo Lima',
  'Inventor dos Amores — Gusttavo Lima',
  'Zé da Recaída — Gusttavo Lima',
  'Gatinha Assanhada — Gusttavo Lima',
  'Fui Fiel — Gusttavo Lima',
  // Marília Mendonça
  'Supera — Marília Mendonça',
  'Bebi Liguei — Marília Mendonça',
  'Amante Não Tem Lar — Marília Mendonça',
  'Graveto — Marília Mendonça',
  'Leão — Marília Mendonça',
  'Troca de Calçada — Marília Mendonça',
  'Ciumeira — Marília Mendonça',
  // Luan Santana
  'Sinais — Luan Santana',
  'Adrenalina — Luan Santana',
  'Tudo Que Você Quer — Luan Santana',
  'Amar Não É Pecado — Luan Santana',
  'Cantada Errada — Luan Santana',
  'Água com Açúcar — Luan Santana',
  // Zé Neto e Cristiano
  'Seu Polícia — Zé Neto e Cristiano',
  'Esquece Eu — Zé Neto e Cristiano',
  'Cadeira Cativa — Zé Neto e Cristiano',
  'Plano C — Zé Neto e Cristiano',
  // Jorge e Mateus
  'Propaganda — Jorge e Mateus',
  'Sosseguei — Jorge e Mateus',
  'Pode Chorar — Jorge e Mateus',
  'Seu Astral — Jorge e Mateus',
  'Duas Metades — Jorge e Mateus',
  'Os Anjos Cantam — Jorge e Mateus',
  // Henrique e Juliano
  'Até Você Voltar — Henrique e Juliano',
  'A Flor e o Beija-Flor — Henrique e Juliano',
  // Danilo e Davi
  'Eu Não Sou Terapia — Danilo e Davi',
  // Novos nomes do sertanejo atual
  'Boiadeira — Ana Castela',
  'Pipoco — Ana Castela',
  'Nosso Quadro — Ana Castela',
  'Solteiro Forçado — Ana Castela',
  'Erro Gostoso — Simone Mendes',
  'Cobaia de Cupido — Lauana Prado',
  'Bombonzinho — Israel & Rodolffo',
  'Atrasadinha — Felipe Araújo',
  'Quarta Cadeira — Matheus & Kauan',
  'Camaro Amarelo — Munhoz e Mariano',
  'Recairei — Os Barões da Pisadinha',
  // Sertanejo universitário
  'Ai Se Eu Te Pego — Michel Teló',
  'Fugidinha — Michel Teló',
  'Bara Bará Bere Berê — Michel Teló',
  'Amanhã Sei Lá — Michel Teló',
  'Efeito Gillette — Cristiano Araújo',
  'Me Apaixonei pela Pessoa Errada — Cristiano Araújo',
  'Você Mudou — Cristiano Araújo',
  'Paraíso — Fernando & Sorocaba',
  // Clássicos (para a turma das músicas mais antigas)
  'Indiferença — Zezé Di Camargo & Luciano',
  'No Dia em Que Eu Saí de Casa — Zezé Di Camargo & Luciano',
  'Entre Tapas e Beijos — Leandro & Leonardo',
  'Sonhador — Leandro & Leonardo',
  'Não Aprendi a Dizer Adeus — Leandro & Leonardo',
  'Fio de Cabelo — Chitãozinho & Xororó',
  '100% Você — Chitãozinho & Xororó',
  'Sinônimos — Chitãozinho & Xororó',
  'Choram as Rosas — Bruno e Marrone',
  'Vida Vazia — Bruno e Marrone',
  'Sonhando — Bruno e Marrone',
  'Boate Azul — Bruno e Marrone',
  'Chora, Me Liga — João Bosco & Vinícius',
  'Esta Noite Como Lembrança — João Mineiro & Marciano',
  'Na Sola da Bota — Rionegro & Solimões',
  'Peão Apaixonado — Rionegro & Solimões',
  'Frio da Madrugada — Rionegro & Solimões',
  'Majestade, o Sabiá — Roberta Miranda',
  'Vá Pro Inferno com Seu Amor — Roberta Miranda',
  'O Grande Amor da Minha Vida — Gian & Giovani',
  'Cheiro de Shampoo — Chrystian & Ralf',
  'Estrada da Vida — Milionário e José Rico',
  'Telefone Mudo — Trio Parada Dura',
  'Menino da Porteira — Sérgio Reis',
  'Chico Mineiro — Tonico e Tinoco',
  'Tocando em Frente — Almir Sater',
];

const norm = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

const banco = JSON.parse(fs.readFileSync(BANCO_PATH, 'utf8'));
const titulosBanco = new Set(banco.map(m => norm(m.titulo)));

// segurança: nenhuma falsa pode ter o mesmo título de uma música do banco
const conflitos = SERTANEJO.filter(t => titulosBanco.has(norm(t.split(' — ')[0])));
const lista = SERTANEJO.filter(t => !conflitos.includes(t));

const falsas = JSON.parse(fs.readFileSync(FALSAS_PATH, 'utf8'));
console.log(`Sertanejo antes: ${falsas.sertanejo?.length ?? 0} | depois: ${lista.length}`);
if (conflitos.length) console.log(`Removidas por já estarem no banco: ${conflitos.join(', ')}`);

const artistas = new Set(lista.map(t => norm(t.split(' — ')[1])));
console.log(`Cantores diferentes na lista: ${artistas.size}`);

if (APLICAR) {
  fs.copyFileSync(FALSAS_PATH, FALSAS_PATH + '.bak');
  falsas.sertanejo = lista;
  fs.writeFileSync(FALSAS_PATH, JSON.stringify(falsas, null, 2) + '\n', 'utf8');
  console.log('Gravado.');
} else {
  console.log('(simulação: nada foi alterado. Use --aplicar para gravar.)');
}