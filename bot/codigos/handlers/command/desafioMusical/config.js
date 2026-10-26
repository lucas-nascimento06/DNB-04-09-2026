// bot/codigos/handlers/command/desafioMusical/config.js
// Configurações, grupos permitidos e caminhos dos arquivos do Desafio Musical.

import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const BANCO = path.join(__dirname, '../../../../data/musicasDesafio.json');
export const ARQUIVO_FALSAS = path.join(__dirname, '../../../../data/falsas.json');
export const PASTA_TRECHOS = path.join(__dirname, '../../../musicas-desafio');
export const PASTA_LETRAS = path.join(__dirname, '../../../../data/letras');

// Grupos onde o Desafio Musical está ativo.
const GRUPO_PRINCIPAL = '120363412511975026@g.us';
const GRUPO_ADMINS = '120363431558953171@g.us';
const GRUPO_DESAFIO_MUSICAL_DAMAS = '120363428983518322@g.us'; // "Desafio Musical Damas"

export const GRUPOS_PERMITIDOS = [GRUPO_PRINCIPAL, GRUPO_ADMINS, GRUPO_DESAFIO_MUSICAL_DAMAS];

export const CONFIG = {
    premioDC: 100,          // DC por rodada
    premioAcertadorDC: 60,  // parte de quem canta (o resto é dividido entre os outros do time)
    poteInicial: 1000000,   // pote do bot: criado na 1ª vez e REPOSTO a esse valor sempre que o bot ligar com o pote abaixo dele
    maxMencoes: 15,         // quantos membros do time campeão marcar na mensagem final
    tempoRodadaMs: 0,       // 0 = SEM LIMITE (vale até alguém acertar; ADM pula com #next). Ex.: 180000 = 3 min
    pausaMs: 6000,          // pausa quando ninguém acerta
    tentativasPorRodada: 5, // quantas respostas cada pessoa pode dar por rodada
    rodadasPadrao: 5,
    rodadasMax: Infinity,   // sem limite: o ADM escolhe qualquer quantidade com #dm
    proximaManual: true,    // true = depois que alguém acerta, o ADM digita #next
    esperaMaxMs: 5 * 60 * 1000, // se o ADM esquecer, segue sozinho depois de 5 min
    delayFinalMs: 15000,    // na última rodada, tempo para cantar antes do resultado sair sozinho
    minDCParaEntrar: 200,   // saldo mínimo de DCs para entrar em um time (0 = sem exigência)
    minPorTime: 1,          // mínimo de participantes em CADA time para o ADM iniciar
    limparTimesAoAbrir: true,   // #dmabrir zera os times antigos
    entrarDuranteJogo: false,   // true = ainda dá para entrar nos times depois que começou
};

// Opções da rodada: A, B, C, D e E (1 certa + 4 pegadinhas)
export const LETRAS = ['A', 'B', 'C', 'D', 'E'];
export const NUM_FALSAS = LETRAS.length - 1;