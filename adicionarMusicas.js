import fs from 'fs';
import path from 'path';

const PASTA = './bot/codigos/musicas-desafio';
const JSON_PATH = './bot/data/musicasDesafio.json';
const APLICAR = process.argv.includes('--aplicar');

const NOVAS = [
  { titulo: 'A Maior Saudade', artista: 'Henrique e Juliano', arquivo: 'a-maior-saudade.mp3', busca: 'amaiorsaudade', falsas: ['A Maior Saudade do Mundo', 'Saudade Maior', 'Recaída', 'Flor e o Beija-Flor', 'Cuida Bem Dela'] },
  { titulo: 'Solteiro Forçado', artista: 'Ana Castela', arquivo: 'solteiro-forcado.mp3', busca: 'solteiroforcado', falsas: ['Solteira Forçada', 'Pipoco', 'Boiadeira', 'Solteiro Convicto', 'Casado Forçado'] },
  { titulo: 'Sozinho', artista: 'Caetano Veloso', arquivo: 'sozinho.mp3', busca: 'caetanovelososozinho', falsas: ['Sozinha', 'Cajuína', 'Sampa', 'Sozinho no Mundo', 'Alegria, Alegria'] },
  { titulo: 'O Tempo Não Para', artista: 'Cazuza', arquivo: 'o-tempo-nao-para.mp3', busca: 'otemponaopara', falsas: ['Exagerado', 'Codinome Beija-Flor', 'Faz Parte do Meu Show', 'O Tempo Passa', 'Ideologia'] },
  { titulo: 'Cheiro de Shampoo', artista: 'Chitãozinho & Xororó', arquivo: 'cheiro-de-shampoo.mp3', busca: 'cheirodeshampoo', falsas: ['Cheiro de Perfume', 'Cheiro de Saudade', 'Cheiro de Amor', 'Cheiro de Sabonete', 'Cheiro de Mulher'] },
  { titulo: 'Sinônimos', artista: 'Chitãozinho & Xororó', arquivo: 'sinonimos.mp3', busca: 'sinonimos', falsas: ['Fio de Cabelo', 'Planeta Azul', 'Nuvem de Lágrimas', 'Sinônimo', 'Sinônimos do Amor'] },
  { titulo: 'Apaga Apaga Apaga', artista: 'Danilo e Davi', arquivo: 'apaga-apaga-apaga.mp3', busca: 'apagaapagaapaga', falsas: ['Apaga Apaga', 'Apaga o Meu Número', 'Acende Acende Acende', 'Apague Apague Apague', 'Esquece Esquece Esquece'] },
  { titulo: 'Eu Não Sou Terapia', artista: 'Danilo e Davi', arquivo: 'eu-nao-sou-terapia.mp3', busca: 'naosouterapia', falsas: ['Eu Sou Terapia', 'Não Sou Seu Terapeuta', 'Eu Não Sou Remédio', 'Você Não É Terapia', 'Eu Não Sou Seu Psicólogo'] },
  { titulo: 'Oceano', artista: 'Djavan', arquivo: 'oceano.mp3', busca: 'djavanoceano', falsas: ['Se', 'Flor de Lis', 'Sina', 'Açaí', 'Eu Te Devoro'] },
  { titulo: 'Dormi na Praça', artista: 'Bruno e Marrone', arquivo: 'dormi-na-praca.mp3', busca: 'dorminapraca', falsas: ['Vida Vazia', 'Sonhando', 'Choram as Rosas', 'Dormi no Parque', 'Acordei na Praça'] },
  { titulo: 'Duas Metades', artista: 'Jorge e Mateus', arquivo: 'duas-metades.mp3', busca: 'duasmetades', falsas: ['Sosseguei', 'Amo Noite e Dia', 'Propaganda', 'Duas Metades de Um Amor', 'Metade de Mim'] },
  { titulo: 'E Daí', artista: 'Jorge e Mateus', arquivo: 'e-dai.mp3', busca: 'edaijorge', falsas: ['Nem Aí', 'E Daí Meu Bem', 'Pode Chorar', 'Sosseguei', 'Propaganda'] },
  { titulo: 'Foi Deus', artista: 'Edson & Hudson', arquivo: 'foi-deus.mp3', busca: 'foideus', falsas: ['Foi Deus Quem Fez', 'Foi o Destino', 'Eu Sei Que Foi Deus', 'Foi Você', 'Foi Amor'] },
  { titulo: 'Café e Amor', artista: 'Gusttavo Lima', arquivo: 'cafe-e-amor.mp3', busca: 'cafeeamor', falsas: ['Balada', 'Inventor dos Amores', 'Apelido Carinhoso', 'Café com Amor', 'Amor e Café'] },
  { titulo: 'Fala Mal de Mim', artista: 'Gusttavo Lima', arquivo: 'fala-mal-de-mim.mp3', busca: 'falamaldemim', falsas: ['Fala Bem de Mim', 'Fale Mal de Mim', 'Zé da Recaída', 'Balada', 'Inventor dos Amores'] },
  { titulo: 'Compensa Me Amar', artista: 'Henrique e Juliano', arquivo: 'compensa-me-amar.mp3', busca: 'compensameamar', falsas: ['Compensa Amar', 'Vale a Pena Me Amar', 'Compensa Me Querer', 'Largado às Traças', 'Liberdade Provisória'] },
  { titulo: 'Beijos, Blues e Poesia', artista: 'K-Sis', arquivo: 'beijos-blues-e-poesia.mp3', busca: 'beijosbluesepoesia', falsas: ['Beijos e Poesia', 'Blues e Poesia', 'Beijos, Blues e Paixão', 'Poesia e Beijos', 'Beijos, Samba e Poesia'] },
  { titulo: 'Água com Açúcar', artista: 'Luan Santana', arquivo: 'agua-com-acucar.mp3', busca: 'aguacomacucar', falsas: ['Meteoro', 'Sinais', 'Chega de Saudade', 'Água com Sal', 'Adocica'] },
  { titulo: 'Ilha', artista: 'Luan Santana', arquivo: 'ilha.mp3', busca: 'luansantanailha', falsas: ['Meteoro', 'Sinais', 'A Ilha', 'Ilha do Amor', 'Você de Volta'] },
  { titulo: 'Medo Bobo', artista: 'Maiara & Maraisa', arquivo: 'medo-bobo.mp3', busca: 'medobobo', falsas: ['10%', 'Medo de Amar', 'Medo Bobo de Você', 'Medo de Te Perder', 'Sem Medo'] },
  { titulo: 'Diz Pra Mim', artista: 'Malta', arquivo: 'diz-pra-mim.mp3', busca: 'dizpramim', falsas: ['Diz Pra Mim Que Sim', 'Fala Pra Mim', 'Diz Pra Mim Agora', 'Conta Pra Mim', 'Diz Que Sim'] },
  { titulo: 'Daqui Pra Sempre', artista: 'Manu Bahtidão', arquivo: 'daqui-pra-sempre.mp3', busca: 'daquiprasempre', falsas: ['Daqui Pra Sempre Amor', 'Pra Sempre', 'Pra Sempre Aqui', 'De Agora Pra Sempre', 'Daqui Pra Lá'] },
  { titulo: 'Quarta Cadeira', artista: 'Matheus & Kauan', arquivo: 'quarta-cadeira.mp3', busca: 'quartacadeira', falsas: ['Quinta Cadeira', 'Terceira Cadeira', 'Cadeira Vazia', 'Última Cadeira', 'Quarta Mesa'] },
  { titulo: 'Azul Piscina', artista: 'MC Livinho', arquivo: 'azul-piscina.mp3', busca: 'azulpiscina', falsas: ['Fazer Falta', 'Verde Piscina', 'Azul Marinho', 'Azul do Mar', 'Piscina Azul'] },
  { titulo: 'Metamorfose Ambulante', artista: 'Raul Seixas', arquivo: 'metamorfose-ambulante.mp3', busca: 'metamorfoseambulante', falsas: ['Ouro de Tolo', 'Maluco Beleza', 'Gita', 'Sociedade Alternativa', 'Metamorfose Ambulante II'] },
  { titulo: 'Minha Estrela Perdida', artista: 'CONFERIR ARTISTA', arquivo: 'minha-estrela-perdida.mp3', busca: 'minhaestrelaperdida', falsas: ['Minha Estrela Guia', 'Minha Estrela Cadente', 'Estrela Perdida', 'Minha Luz Perdida', 'Minha Estrela Brilhante'] },
  { titulo: 'Não Aprendi a Dizer Adeus', artista: 'Leandro & Leonardo', arquivo: 'nao-aprendi-a-dizer-adeus.mp3', busca: 'naoaprendiadizeradeus', falsas: ['Pense em Mim', 'Entre Tapas e Beijos', 'Não Aprendi a Dizer Olá', 'Aprendi a Dizer Adeus', 'Não Sei Dizer Adeus'] },
  { titulo: 'Cedo ou Tarde', artista: 'NX Zero', arquivo: 'cedo-ou-tarde.mp3', busca: 'cedooutarde', falsas: ['Pela Última Vez', 'Onde Estiver', 'Mais Alguém', 'Cedo ou Tarde Eu Volto', 'Tarde Demais'] },
  { titulo: 'Razões e Emoções', artista: 'NX Zero', arquivo: 'razoes-e-emocoes.mp3', busca: 'razoeseemocoes', falsas: ['Pela Última Vez', 'Onde Estiver', 'Mais Alguém', 'Razões e Sentimentos', 'Emoções e Razões'] },
  { titulo: 'Nosso Quadro', artista: 'Ana Castela', arquivo: 'nosso-quadro.mp3', busca: 'nossoquadro', falsas: ['Pipoco', 'Boiadeira', 'Nosso Retrato', 'Meu Quadro', 'Nosso Quadro de Amor'] },
  { titulo: 'Palpite', artista: 'Vanessa Rangel', arquivo: 'palpite.mp3', busca: 'palpite', falsas: ['Palpite Certo', 'Um Palpite', 'Meu Palpite', 'Palpites do Amor', 'Pitaco'] },
  { titulo: 'Eu Te Seguro', artista: 'Panda', arquivo: 'eu-te-seguro.mp3', busca: 'euteseguro', falsas: ['Eu Te Sigo', 'Te Seguro', 'Eu Te Pego', 'Eu Te Segurei', 'Eu Te Prendo'] },
  { titulo: 'Mil e Uma Noites de Amor', artista: 'Pepeu Gomes', arquivo: 'mil-e-uma-noites-de-amor.mp3', busca: 'mileumanoites', falsas: ['Masculino e Feminino', 'Mil e Uma Noites', 'Mil Noites de Amor', 'Mil e Uma Paixões', 'Mil e Uma Madrugadas'] },
  { titulo: 'Pra Não Pensar em Você', artista: 'CONFERIR ARTISTA', arquivo: 'pra-nao-pensar-em-voce.mp3', busca: 'pranaopensaremvoce', falsas: ['Pra Não Pensar em Nós', 'Pra Não Lembrar de Você', 'Pra Não Pensar Mais em Você', 'Pra Esquecer de Você', 'Para Não Pensar em Você'] },
  { titulo: 'Quase Sem Querer', artista: 'Legião Urbana', arquivo: 'quase-sem-querer.mp3', busca: 'quasesemquerer', falsas: ['Tempo Perdido', 'Pais e Filhos', 'Será', 'Quase Sem Perceber', 'Sem Querer'] },
  { titulo: 'A Lenda', artista: 'Sandy e Junior', arquivo: 'a-lenda.mp3', busca: 'alenda', falsas: ['Enrosca', 'Quando Você Passa', 'Era Uma Vez', 'Imortal', 'A Lenda do Amor'] },
  { titulo: 'Erro Gostoso', artista: 'Simone Mendes', arquivo: 'erro-gostoso.mp3', busca: 'errogostoso', falsas: ['Dois Enganados', 'Já Era', 'Erro Bom', 'Engano Gostoso', 'Pecado Gostoso'] },
  { titulo: 'Nosso Plano', artista: 'Tribo da Periferia', arquivo: 'nosso-plano.mp3', busca: 'nossoplano', falsas: ['Nosso Sonho', 'Meu Plano', 'Plano B', 'Nosso Caminho', 'Nosso Plano de Amor'] },
  { titulo: 'Deixa a Vida Me Levar', artista: 'Zeca Pagodinho', arquivo: 'deixa-a-vida-me-levar.mp3', busca: 'deixaavidamelevar', falsas: ['Verdade', 'Vai Vadiar', 'Deixa o Samba Me Levar', 'Deixa Eu Levar a Vida', 'Deixa a Vida Passar'] },
  { titulo: 'Reserved Seat', artista: 'Zé Neto e Cristiano', arquivo: 'reserved-seat.mp3', busca: 'reservedseat', falsas: ['Cadeira Reservada', 'Assento Reservado', 'Lugar na Mesa', 'Mesa Reservada', 'Notificação Preferida'] },
  { titulo: 'Plano C', artista: 'Zé Neto e Cristiano', arquivo: 'plano-c.mp3', busca: 'zenetoecristianoplanoc', falsas: ['Notificação Preferida', 'Esquece o Nome', 'Plano A', 'Plano B', 'Plano D'] },
];

const norm = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

const banco = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
const arquivos = fs.readdirSync(PASTA).filter(f => f.toLowerCase().endsWith('.mp3'));
const jaNoBanco = new Set(banco.map(m => m.arquivo));
const usados = new Set(jaNoBanco);
let proximoId = Math.max(0, ...banco.map(m => m.id ?? 0)) + 1;
let ok = 0, falhas = 0;
const novasEntradas = [];

for (const n of NOVAS) {
  if (jaNoBanco.has(n.arquivo)) { console.log(`⏭️  ${n.titulo} — já está no JSON`); continue; }
  const candidatos = arquivos.filter(f => !usados.has(f) && norm(f).includes(n.busca));
  if (candidatos.length === 0) { console.log(`❌ ${n.titulo} — nenhum MP3 casa com "${n.busca}"`); falhas++; continue; }
  if (candidatos.length > 1) { console.log(`⚠️  ${n.titulo} — ${candidatos.length} candidatos: ${candidatos.join(' | ')} (pulei)`); falhas++; continue; }
  const origem = candidatos[0];
  const id = proximoId++;
  console.log(`#${id} ${n.titulo} — ${n.artista}: "${origem}" → "${n.arquivo}"`);
  usados.add(origem);
  ok++;
  if (APLICAR) fs.renameSync(path.join(PASTA, origem), path.join(PASTA, n.arquivo));
  novasEntradas.push({ id, titulo: n.titulo, artista: n.artista, arquivo: n.arquivo, falsas: n.falsas });
}

if (APLICAR && novasEntradas.length) {
  fs.copyFileSync(JSON_PATH, JSON_PATH + '.bak');
  fs.writeFileSync(JSON_PATH, JSON.stringify([...banco, ...novasEntradas], null, 2) + '\n', 'utf8');
}

console.log(`\n${APLICAR ? 'Adicionadas' : 'Seriam adicionadas'}: ${ok} | Problemas: ${falhas}`);
if (APLICAR) console.log('Backup do JSON: bot/data/musicasDesafio.json.bak');
const conferir = NOVAS.filter(n => n.artista.includes('CONFERIR') || n.titulo === 'Reserved Seat').map(n => n.titulo);
if (conferir.length) console.log(`\n🔎 Corrija no JSON depois: ${conferir.join(', ')}`);
