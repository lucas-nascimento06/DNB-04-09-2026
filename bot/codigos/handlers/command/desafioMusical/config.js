// bot/codigos/handlers/command/desafioMusical/config.js
// Configurações, grupos permitidos e caminhos dos arquivos do Desafio Musical.

import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const BANCO = path.join(__dirname, '../../../../data/musicasDesafio.json');
export const BANCO_FALSAS = path.join(__dirname, '../../../../data/falsasMesmoArtista.json');
export const ARQUIVO_FALSAS = path.join(__dirname, '../../../../data/falsas.json');
export const PASTA_TRECHOS = path.join(__dirname, '../../../musicas-desafio');

// ⚠️ MODO TESTE: só o grupo de teste está ativo.
// Quando terminar os testes, descomente os grupos originais e comente/remova o GRUPO_TESTE.
// const GRUPO_PRINCIPAL = '120363412511975026@g.us';
// const GRUPO_ADMINS = '120363409228091157@g.us';
const GRUPO_TESTE = '120363431745836323@g.us';

// export const GRUPOS_PERMITIDOS = [GRUPO_PRINCIPAL, GRUPO_ADMINS];
export const GRUPOS_PERMITIDOS = [GRUPO_TESTE];

export const CONFIG = {
    premioDC: 100,          // DC por rodada
    premioAcertadorDC: 60,  // parte de quem acertou (o resto é dividido entre os outros do time)
    poteInicial: 6000,      // DC que o bot tem para distribuir (criado na 1ª vez)
    maxMencoes: 15,         // quantos membros listar na mensagem de vitória
    tempoRodadaMs: 60000,   // 1 minuto para responder. 0 = SEM LIMITE
    pausaMs: 6000,          // pausa quando ninguém acerta
    tentativasPorRodada: 5, // quantas respostas cada pessoa pode dar por rodada
    rodadasPadrao: 5,
    rodadasMax: 20,
    proximaManual: true,    // true = depois que alguém acerta, o ADM digita #next
    esperaMaxMs: 5 * 60 * 1000, // se o ADM esquecer, segue sozinho depois de 5 min
    minDCParaEntrar: 200,   // saldo mínimo de DCs para entrar em um time (0 = sem exigência)
    minPorTime: 1,          // mínimo de participantes em CADA time para o ADM iniciar
    limparTimesAoAbrir: true,   // #dmabrir zera os times antigos
    entrarDuranteJogo: false,   // true = ainda dá para entrar nos times depois que começou
};

// Opções da rodada: A, B, C, D e E (1 certa + 4 pegadinhas)
export const LETRAS = ['A', 'B', 'C', 'D', 'E'];
export const NUM_FALSAS = LETRAS.length - 1;

// Quantas pegadinhas do MESMO cantor tentar colocar (NUM_FALSAS = todas).
export const FALSAS_MESMO_CANTOR = NUM_FALSAS;