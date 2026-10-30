// ARQUIVO: bot/codigos/handlers/command/pixHandler.js

import pool from '../../../../db.js';
import { flushDC } from '../../features/dcTracker.js';

// ---------------------------------------------------------------
// Palavras para gerar as chaves (emoji, palavra)
// ---------------------------------------------------------------
const PALAVRAS = [
// 🏦 BANCO & FINANÇAS
['🏦', 'BANQUEIRO-DO-PIX-DC'], ['💳', 'CARTAO-INTERNACIONAL-DC'],
['💰', 'MILIONARIO-DE-FACHADA-DC'], ['📉', 'SALDO-DESAPARECIDO-DC'],
['💸', 'DINHEIRO-VOADOR-DC'], ['🏦', 'GERENTE-ESTRESSADO-DC'],
['💳', 'CARTAO-SEM-LIMITE-DC'], ['💰', 'COFRE-DE-OURO-DC'],
['📈', 'INVESTIDOR-DO-ZAP-DC'], ['💸', 'PIX-SEM-DESTINO-DC'],
['🏦', 'BANCO-DOS-SONHOS-DC'], ['💳', 'CARTAO-DA-MADAME-DC'],
['📉', 'POUPANCA-EM-COLAPSO-DC'], ['💰', 'FORTUNA-IMAGINARIA-DC'],
['💸', 'SALARIO-RELAMPAGO-DC'], ['🏦', 'DIRETOR-FINANCEIRO-DC'],
['💳', 'CARTAO-MISTERIOSO-DC'], ['📈', 'LUCRO-NA-FANTASIA-DC'],
['💰', 'COFRE-DA-RIQUEZA-DC'], ['💸', 'PIX-DA-MADRUGADA-DC'],
['🏦', 'BANCO-DA-FORTUNA-DC'], ['💳', 'FATURA-ASSOMBRADA-DC'],
['📉', 'DINHEIRO-EM-QUEDA-DC'], ['💰', 'HERDEIRO-DO-PIX-DC'],
['💸', 'PIX-PRO-CAFE-DC'], ['🏦', 'AGENCIA-DA-RIQUEZA-DC'],
['💳', 'CARTAO-DA-SORTE-DC'], ['📈', 'BOLSA-DA-FELICIDADE-DC'],
['💰', 'MILHOES-NA-CABECA-DC'], ['💸', 'PIX-QUE-SOME-DC'],
['🏦', 'BANCO-DO-POBRE-DC'], ['💳', 'CARTAO-EM-12X-DC'],
['📉', 'CRISE-FINANCEIRA-DC'], ['💰', 'TESOURO-ESCONDIDO-DC'],
['💸', 'PAGA-MINHA-FATURA-DC'], ['🏦', 'GERENTE-DO-BOLETO-DC'],
['💳', 'CARTAO-RECUSADO-DC'], ['📈', 'RENDA-EXTRA-DC'],
['💰', 'PATRIMONIO-DE-MENTIRA-DC'], ['💸', 'PIX-DA-SALVACAO-DC'],
['🏦', 'BANCO-DA-AMIZADE-DC'], ['💳', 'FATURA-DO-MES-DC'],
['📉', 'INVESTIMENTO-FURADO-DC'], ['💰', 'DINHEIRO-EM-COFRE-DC'],
['💸', 'SALARIO-NA-UTI-DC'], ['🏦', 'BANCO-POPULAR-DC'],
['💳', 'CARTAO-PREMIUM-DC'], ['📈', 'LUCRO-MISTERIOSO-DC'],
['💰', 'RIQUEZA-DO-ZAP-DC'], ['💸', 'PIX-DA-ESPERANCA-DC'],
['🏦', 'BANCO-DA-PATRICINHA-DC'], ['💳', 'FATURA-INFINITA-DC'],
['📉', 'SALDO-EM-EXTINCAO-DC'], ['💰', 'COFRINHO-MILIONARIO-DC'],
['💸', 'PIX-PRO-ALMOCO-DC'], ['🏦', 'CHEFE-DO-CAIXA-DC'],
['💳', 'CARTAO-DOURADO-DC'], ['📈', 'INVESTIDOR-SONHADOR-DC'],
['💰', 'DINHEIRO-ESCONDIDO-DC'], ['💸', 'PIX-NA-VEIA-DC'],
['🏦', 'BANCO-DO-ROLÊ-DC'], ['💳', 'CARTAO-DA-ZOEIRA-DC'],
['📉', 'POBREZA-INVESTIDA-DC'], ['💰', 'FORTUNA-DO-DESTINO-DC'],
['💸', 'PIX-PRA-ONTEM-DC'], ['🏦', 'GERENTE-DA-FORTUNA-DC'],
['💳', 'CARTAO-DE-MILHOES-DC'], ['📈', 'BOLSA-DA-RIQUEZA-DC'],
['💰', 'DONO-DO-COFRE-DC'], ['💸', 'PIX-SEM-VERGONHA-DC'],
['🏦', 'BANCO-DA-MADAME-DC'], ['💳', 'FATURA-EM-ANALISE-DC'],
['📉', 'SALDO-MISTERIOSO-DC'], ['💰', 'MILIONARIO-DO-DOMINGO-DC'],
['💸', 'PIX-DA-RESENHA-DC'], ['🏦', 'BANCO-DO-DC-DC'],
['💳', 'CARTAO-SEM-SENHA-DC'], ['📈', 'RENDA-DOS-SONHOS-DC'],
['💰', 'COFRE-DA-PATRICINHA-DC'], ['💸', 'PIX-PRO-ROLÊ-DC'],
['🏦', 'BANCO-DO-CHURRASCO-DC'], ['💳', 'FATURA-DO-DESTINO-DC'],
['📉', 'INVESTIMENTO-EM-SONHOS-DC'], ['💰', 'RIQUEZA-SEM-BOLETO-DC'],
['💸', 'PIX-DA-AMIZADE-DC'], ['🏦', 'BANCO-DA-ZOEIRA-DC'],
['💳', 'CARTAO-DE-OURO-DC'], ['📈', 'LUCRO-DO-MES-DC'],
['💰', 'HERANCA-IMAGINARIA-DC'], ['💸', 'PIX-QUE-NAO-VEM-DC'],
['🏦', 'BANCO-DO-CAFÉ-DC'], ['💳', 'FATURA-DO-CAOS-DC'],
['📉', 'SALDO-ZERADO-DC'], ['💰', 'REI-DO-COFRINHO-DC'],
['💸', 'PIX-MILIONARIO-DC'], ['🏦', 'BANCO-VIP-DC'],
['💳', 'CARTAO-DA-RIQUEZA-DC'], ['📈', 'INVESTIDOR-DO-PIX-DC'],
['💰', 'DONO-DA-FORTUNA-DC'], ['💸', 'PIX-SEM-LIMITE-DC'],
    
  // 🍕 COMIDA
['🍕', 'PIZZA-NO-PIX-DC'], ['🍔', 'X-BURGUER-VIP-DC'],
['🍕', 'RODIZIO-DO-DC-DC'], ['🍟', 'BATATA-FRITA-RICA-DC'],
['🌭', 'CACHORRO-QUENTE-DC'], ['🍕', 'ULTIMA-FATIA-DC'],
['🍫', 'CHOCOLATE-NO-PIX-DC'], ['🍦', 'SORVETE-DERRETIDO-DC'],
['🍔', 'LANCHE-FIADO-DC'], ['🥟', 'PASTEL-DA-FEIRA-DC'],
['🍕', 'MARGUERITA-DO-PIX-DC'], ['🥘', 'FEIJOADA-DO-DC-DC'],
['🍩', 'ROSQUINHA-RICA-DC'], ['🌮', 'TACO-DO-PIX-DC'],
['🍗', 'COXINHA-DE-OURO-DC'], ['🍕', 'PIZZA-CALABRESA-DC'],
['🍕', 'PIZZA-QUATRO-QUEIJOS-DC'], ['🍕', 'PIZZA-DOCE-DC'],
['🍕', 'PIZZA-FRIA-DC'], ['🍕', 'PIZZA-DA-MADRUGADA-DC'],
['🍔', 'BURGUER-ARTESANAL-DC'], ['🍔', 'BURGUER-SIMPLES-DC'],
['🍔', 'BURGUER-DUPLO-DC'], ['🍔', 'BURGUER-SEM-QUEIJO-DC'],
['🍟', 'BATATA-MEDIA-DC'], ['🍟', 'BATATA-GRANDE-DC'],
['🍟', 'BATATA-COMPARTILHADA-DC'], ['🌭', 'CACHORRO-QUENTE-SIMPLES-DC'],
['🌭', 'CACHORRO-COMPLETO-DC'], ['🥟', 'PASTEL-DE-CARNE-DC'],
['🥟', 'PASTEL-DE-QUEIJO-DC'], ['🥟', 'PASTEL-DE-PIZZA-DC'],
['🥟', 'PASTEL-FRITO-DC'], ['🥘', 'FEIJOADA-COMPLETA-DC'],
['🥘', 'FEIJOADA-DE-SEGUNDA-DC'], ['🍩', 'ROSQUINHA-DE-ACUCAR-DC'],
['🍩', 'ROSQUINHA-RECHEADA-DC'], ['🌮', 'TACO-MEXICANO-DC'],
['🌮', 'TACO-APIMENTADO-DC'], ['🍗', 'COXINHA-DE-FRANGO-DC'],
['🍗', 'COXINHA-SEM-CATUPIRY-DC'], ['🍫', 'CHOCOLATE-BRANCO-DC'],
['🍫', 'CHOCOLATE-AMARGO-DC'], ['🍦', 'SORVETE-DE-CHOCOLATE-DC'],
['🍦', 'SORVETE-DE-MORANGO-DC'], ['🍰', 'BOLO-DE-CHOCOLATE-DC'],
['🍰', 'BOLO-DE-ANIVERSARIO-DC'], ['🧁', 'CUPCAKE-DO-PIX-DC'],
['🍪', 'BISCOITO-RECHEADO-DC'], ['🍪', 'COOKIE-GIGANTE-DC'],
['🍮', 'PUDIM-DE-LEITE-DC'], ['🍓', 'MORANGO-COM-CHOCOLATE-DC'],
['🍉', 'MELANCIA-GELADA-DC'], ['🍍', 'ABACAXI-DOCE-DC'],
['🍌', 'BANANA-FRITA-DC'], ['🥞', 'PANQUECA-DO-PIX-DC'],
['🧇', 'WAFFLE-DOURADO-DC'], ['🥐', 'CROISSANT-VIP-DC'],
['🥖', 'PAO-FRANCES-DC'], ['🍞', 'PAO-NA-CHAPA-DC'],
['🧀', 'QUEIJO-DERRETIDO-DC'], ['🥓', 'BACON-EXTRA-DC'],
['🥚', 'OVO-FRITO-DC'], ['🍳', 'CAFE-DA-MANHA-DC'],
['🥗', 'SALADA-DA-RIQUEZA-DC'], ['🍝', 'MACARRONADA-DC'],
['🍜', 'MIOJO-DE-LUXO-DC'], ['🍲', 'CALDINHO-QUENTE-DC'],
['🍛', 'PRATO-FEITO-DC'], ['🍚', 'ARROZ-COM-FEIJÃO-DC'],
['🥩', 'CHURRASCO-VIP-DC'], ['🍖', 'COSTELA-ASSADA-DC'],
['🍤', 'CAMARAO-DO-PIX-DC'], ['🐟', 'PEIXE-FRITO-DC'],
['🍣', 'SUSHI-DA-MADAME-DC'], ['🍱', 'COMBO-JAPONES-DC'],
['🥪', 'SANDUICHE-NATURAL-DC'], ['🌯', 'WRAP-DO-PIX-DC'],
['🫔', 'TAMAL-MISTERIOSO-DC'], ['🥨', 'PRETZEL-DOCE-DC'],
['🧆', 'BOLINHO-DE-GRAO-DC'], ['🥔', 'PURE-DE-BATATA-DC'],
['🌽', 'MILHO-NA-MANTEIGA-DC'], ['🫓', 'PÃOZINHO-DA-VOVO-DC'],
['🍿', 'PIPOCA-DE-CINEMA-DC'], ['🥜', 'AMENDOIM-TORRADO-DC'],
['🍯', 'MELZINHO-DOCE-DC'], ['🍬', 'BALA-DE-MORANGO-DC'],
['🍭', 'PIRULITO-GIGANTE-DC'], ['🍡', 'DOCINHO-JAPONES-DC'],
['🥧', 'TORTA-DE-LIMAO-DC'], ['🍨', 'TAÇA-DE-SORVETE-DC'],
['🍧', 'RASPADINHA-GELADA-DC'], ['🥤', 'MILKSHAKE-VIP-DC'],
['🧋', 'CHA-DE-BOLINHAS-DC'], ['🧃', 'SUQUINHO-DO-PIX-DC'],
['🍰', 'FATIA-PREMIADA-DC'], ['🍕', 'FOME-DE-MILHOES-DC'],
    
  // 😎 ESTILO & ATITUDE
['😎', 'MARRENTA-DO-PIX-DC'], ['😎', 'CHIQUE-NO-UTIL-DC'],
['😎', 'NASCI-PRA-BRILHAR-DC'], ['💅', 'LUXO-SO-DC'],
['😎', 'PATRICINHA-DO-PIX-DC'], ['🕶️', 'MAIS-RICA-QUE-EX-DC'],
['😎', 'PODEROSA-DO-DC'], ['💅', 'MADAME-DO-PIX-DC'],
['😎', 'FAMOSA-NO-GRUPO-DC'], ['🕶️', 'CHEFONA-DO-PIX-DC'],
['💅', 'SUPREMA-DO-DC'], ['😎', 'NAO-ME-ENQUADRO-DC'],
['💅', 'LINDA-E-RICA-DC'], ['🕶️', 'IMPONENTE-VIP-DC'],
['😎', 'MARRENTA-DE-SEGUNDA-DC'], ['😎', 'MARRENTA-DE-SEXTA-DC'],
['😎', 'MARRENTA-CHIQUE-DC'], ['😎', 'MARRENTA-SEM-GRANA-DC'],
['😎', 'MARRENTA-VIP-DC'], ['😎', 'MARRENTA-FAMOSA-DC'],
['😎', 'MARRENTA-ANONIMA-DC'], ['😎', 'MARRENTA-DO-BAIRRO-DC'],
['😎', 'MARRENTA-INTERNACIONAL-DC'], ['🕶️', 'CHIQUE-DE-SEGUNDA-DC'],
['🕶️', 'CHIQUE-DE-SEXTA-DC'], ['🕶️', 'CHIQUE-SEM-GRANA-DC'],
['🕶️', 'CHIQUE-DO-PIX-DC'], ['🕶️', 'CHIQUE-DO-DC-DC'],
['🕶️', 'CHIQUE-VIP-DC'], ['💅', 'LUXO-DE-SEGUNDA-DC'],
['💅', 'LUXO-DE-SEXTA-DC'], ['💅', 'LUXO-DO-PIX-DC'],
['💅', 'LUXO-DO-DC-DC'], ['💅', 'LUXO-VIP-DC'],
['💅', 'LUXO-SEM-GRANA-DC'], ['💅', 'LUXO-RINDO-DC'],
['👑', 'RAINHA-DA-MARRA-DC'], ['👑', 'DONO-DO-ESTILO-DC'],
['💎', 'DIAMANTE-RARO-DC'], ['✨', 'BRILHO-PROPRIO-DC'],
['🕶️', 'ESTILO-SEM-LIMITES-DC'], ['💅', 'DIVA-DO-GRUPO-DC'],
['👠', 'SALTO-DE-OURO-DC'], ['💄', 'MAKE-DE-MILHOES-DC'],
['👜', 'BOLSA-DE-MADAME-DC'], ['💎', 'RIQUEZA-NATURAL-DC'],
['😎', 'POSTURA-DE-MILHOES-DC'], ['💅', 'FINA-E-ABSOLUTA-DC'],
['👑', 'COROA-NA-CABECA-DC'], ['🕶️', 'VISAO-DE-MADAME-DC'],
['🔥', 'PRESENCA-MARCANTE-DC'], ['💃', 'ELA-E-O-EVENTO-DC'],
['😎', 'ESTILO-PRÓPRIO-DC'], ['💅', 'DEBOCHE-DE-LUXO-DC'],
['👑', 'CHEGUEI-MANDANDO-DC'], ['💎', 'RARIDADE-DO-DC'],
['🕶️', 'POSTURA-VIP-DC'], ['💄', 'GLAMOUR-DO-PIX-DC'],
['👠', 'PODER-DE-SALTO-DC'], ['✨', 'BRILHA-MAIS-QUE-OURO-DC'],
['😎', 'SEM-PEDIR-LICENCA-DC'], ['💅', 'EU-SOU-O-LUXO-DC'],
['👑', 'DONO-DA-MARRA-DC'], ['💎', 'FINA-IGUAL-DIAMANTE-DC'],
['👜', 'MADAME-DA-BOLSA-DC'], ['🔥', 'ATITUDE-DE-SOBRA-DC'],
['😎', 'MARRA-NATURAL-DC'], ['💅', 'CHIQUE-ATE-DORMINDO-DC'],
['👑', 'PRINCESA-DO-ESTILO-DC'], ['🕶️', 'ÓCULOS-DE-MADAME-DC'],
['💎', 'LUXO-RARO-DC'], ['✨', 'NASCI-ILUMINADA-DC'],
['💃', 'DIVA-INTERNACIONAL-DC'], ['😎', 'NIVEL-ACIMA-DC'],
['💅', 'ELEGANCIA-NA-VEIA-DC'], ['👑', 'REI-DA-POSTURA-DC'],
['🔥', 'PODER-E-ATITUDE-DC'], ['👜', 'MADAME-DO-ROLÊ-DC'],
['💎', 'BRILHO-DE-MILHOES-DC'], ['😎', 'MARRA-EM-PESSOA-DC'],
['💄', 'GLAMOUR-SEM-FIM-DC'], ['👠', 'PISA-COM-ELEGANCIA-DC'],
['💅', 'FINA-SEM-ESFORCO-DC'], ['👑', 'AUTORIDADE-DO-GLAMOUR-DC'],
['🕶️', 'ESTILO-DE-RESPEITO-DC'], ['✨', 'LUXO-QUE-BRILHA-DC'],
['😎', 'NAO-SOU-QUALQUER-UMA-DC'], ['💃', 'DONA-DO-CHARME-DC'],
['💎', 'PEDRA-PRECIOSA-DC'], ['🔥', 'CHEGUEI-PRA-CAUSAR-DC'],
['💅', 'MADAME-SEM-LIMITES-DC'], ['👑', 'COROA-DO-DC-DC'],
['🕶️', 'VIP-DE-NASCENCA-DC'], ['✨', 'BRILHO-EXCLUSIVO-DC'],
['😎', 'MARRA-DE-MILHOES-DC'], ['💃', 'ESTRELA-DO-ROLÊ-DC'],
['💎', 'SO-AND0-DE-LUXO-DC'], ['👑', 'A-DONA-DO-ESTILO-DC'],
['🔥', 'PODEROSA-SEM-ESFORCO-DC'], ['💅', 'CHIQUE-E-DEBOCHADA-DC'],
    
  // 🔮 MISTICISMO & FANTASIA
['🧙', 'BRUXA-DO-PIX-DC'], ['🧙', 'MAGO-DO-DC'], ['🔮', 'BOLA-DE-CRISTAL-DC'],
['🧙', 'FEITICEIRA-RICA-DC'], ['🔮', 'PIX-ENCANTADO-DC'], ['🧞', 'GENIO-DO-DC'],
['🧙', 'POCAO-DO-DINHEIRO-DC'], ['🔮', 'VIDENTE-DO-DC'], ['🧞', 'TRES-DESEJOS-PIX-DC'],
['🦸', 'HEROINA-DO-DC'], ['🦸', 'SUPER-PIX-GIRL-DC'], ['😴', 'DORMI-NO-PIX-DC'],
['😴', 'ACORDEI-RICA-DC'], ['🛌', 'CAMA-E-PIX-DC'], ['😴', 'SEGUNDA-FEIRA-DC'],
['☕', 'CAFE-COM-PIX-DC'], ['😴', 'SONECA-DO-DC'], ['🛌', 'DOMINGO-SEM-GRANA-DC'],
['☕', 'CAFEZINHO-FIADO-DC'], ['😴', 'PREGUICA-RICA-DC'], ['🛌', 'SO-QUERO-DORMIR-DC'],
['☕', 'MADRUGADA-DO-PIX-DC'], ['😴', 'SEXTOU-NO-PIX-DC'], ['🚀', 'FOGUETE-DO-PIX-DC'],
['👽', 'ET-DO-DAMAS-DC'], ['🚀', 'VOU-PRA-LUA-DC'], ['👽', 'ALIENIGENA-RICO-DC'],
['🛸', 'DISCO-VOADOR-PIX-DC'], ['🚀', 'PIX-INTERGALACTICO-DC'], ['🤖', 'ROBO-DO-PIX-DC'],
['🛸', 'ABDUZIDA-PELO-PIX-DC'], ['🤖', 'BEEP-BOOP-PIX-DC'], ['👻', 'FANTASMA-DO-DC'],
['👻', 'ALMA-PENADA-PIX-DC'], ['🧟', 'ZUMBI-DO-PIX-DC'],
['🧙', 'BRUXINHA-DO-AMOR-DC'], ['🔮', 'MAGIA-DO-PIX-DC'],
['✨', 'POEIRA-ESTELAR-DC'], ['🪄', 'VARINHA-MAGICA-DC'],
['🧚', 'FADA-MADRINHA-DC'], ['🧚', 'FADINHA-DO-PIX-DC'],
['🧛', 'VAMPIRA-DO-DC'], ['🧛', 'CONDE-DO-PIX-DC'],
['🐉', 'DRAGAO-DOURADO-DC'], ['🐲', 'DRAGAO-DO-PIX-DC'],
['🦄', 'UNICORNIO-RICO-DC'], ['🦄', 'CHIFRE-MAGICO-DC'],
['🌙', 'FILHA-DA-LUA-DC'], ['🌟', 'ESTRELA-GUIA-DC'],
['🌌', 'VIA-LACTEA-DC'], ['🌠', 'DESEJO-ESTRELAR-DC'],
['🪐', 'DONO-DE-SATURNO-DC'], ['🌍', 'ALIEN-TERRESTRE-DC'],
['👽', 'ETZINHA-FOFOQUEIRA-DC'], ['🛸', 'VISITA-EXTRATERRESTRE-DC'],
['🤖', 'INTELIGENCIA-DO-PIX-DC'], ['👾', 'MONSTRO-DO-DC-DC'],
['👻', 'ASSOMBRA-O-PIX-DC'], ['💀', 'ESQUELETO-MAGICO-DC'],
['🧟', 'ZUMBI-APAIXONADO-DC'], ['🧞', 'GENIO-MILIONARIO-DC'],
['🔮', 'PREVISAO-DE-RIQUEZA-DC'], ['🧙', 'MESTRE-DAS-POCOES-DC'],
['🪄', 'ABRACADABRA-PIX-DC'], ['✨', 'BRILHO-MISTICO-DC'],
['🌙', 'LUA-CHEIA-DC'], ['🌑', 'NOITE-MISTERIOSA-DC'],
['☀️', 'SOL-DOS-MAGOS-DC'], ['⚡', 'RAIO-MAGICO-DC'],
['🔥', 'FOGO-DA-FEITICA-DC'], ['❄️', 'GELO-ENCANTADO-DC'],
['🌊', 'ONDA-MAGICA-DC'], ['🌪️', 'FURACAO-MISTICO-DC'],
['🧿', 'OLHO-MAGICO-DC'], ['🪬', 'PROTEGIDA-PELO-PIX-DC'],
['🕯️', 'VELA-ENCANTADA-DC'], ['📜', 'LIVRO-DOS-FEITICOS-DC'],
['🗝️', 'CHAVE-DO-MISTERIO-DC'], ['🏰', 'CASTELO-ENCANTADO-DC'],
['👸', 'PRINCESA-MAGICA-DC'], ['🤴', 'REI-DO-ENCANTO-DC'],
['🧝', 'ELFA-MISTERIOSA-DC'], ['🧝', 'GUARDIA-DA-FLORESTA-DC'],
['🌳', 'ARVORE-ENCANTADA-DC'], ['🍄', 'COGUMELO-MAGICO-DC'],
['🦉', 'CORUJA-VIDENTE-DC'], ['🐈‍⬛', 'GATO-DA-BRUXA-DC'],
['🐺', 'LOBO-DA-LUA-DC'], ['🦇', 'MORCEGO-MISTERIOSO-DC'],
['🧪', 'ALQUIMISTA-DO-PIX-DC'], ['⚗️', 'ELIXIR-DA-RIQUEZA-DC'],
['💎', 'CRISTAL-MILIONARIO-DC'], ['🔔', 'SINO-DA-MAGIA-DC'],
['🌈', 'ARCO-IRIS-ENCANTADO-DC'], ['🪽', 'ANJO-MISTICO-DC'],
['😴', 'SONHANDO-COM-MILHOES-DC'], ['🛌', 'DORMINDO-NO-CASTELO-DC'],
['🚀', 'DESTINO-MARTE-DC'], ['👽', 'ET-MILIONARIO-DC'],
['🔮', 'FUTURO-DO-PIX-DC'], ['🧙', 'RAINHA-DAS-BRUXAS-DC'],
    
  // 😂 HUMOR LEVE (sem ofensas)
['😂', 'POBRE-CHIQUE'], ['🤣', 'ME-PAGA-LOGO'], ['🤣', 'CHORA-NO-PIX'],
['🤣', 'CADÊ-MEU-DINHEIRO'], ['😭', 'PIX-DO-DESESPERO'], ['💃', 'DONA-DO-ROLÊ'],
['👑', 'REI-DO-PIX'], ['💃', 'FURA-OLHO'], ['🤑', 'TÔ-RICA-AGORA'],
['🤣', 'SOU-POBRE-MAS-TENHO-PIX'], ['💸', 'PIX-CAIU-SORRIU'],
['😂', 'CALOTE-CHIQUE'], ['🤑', 'MILIONÁRIA-DE-MENTIRA'],
['🤣', 'RICA-SÓ-NO-STATUS'], ['💃', 'PATRICINHA-DO-PIX'],
['👑', 'CEO-DA-BAGUNÇA'], ['😂', 'SURTADA-COM-CLASSE'],
['🤣', 'NÃO-SOU-BANCO'], ['💰', 'CADÊ-O-DEPÓSITO'],
['😭', 'POBREZA-EMOCIONAL'], ['💅', 'CHIQUE-SEM-PIX'],
['🤣', 'VIVENDO-DE-PROMESSA'], ['🤑', 'PIX-OU-NADA'],
['😂', 'FALIDA-MAS-FELIZ'], ['💃', 'RAINHA-DO-CAOS'],
['👑', 'DONO-DA-RAZÃO'], ['🤣', 'SÓ-OBSERVANDO'],
['🤡', 'PALHAÇA-PROFISSIONAL'], ['😂', 'RINDO-PRA-NÃO-CHORAR'],
['💸', 'DINHEIRO-QUE-É-BOM-NADA'], ['🤑', 'PATROCINA-MINHA-VIDA'],
['😭', 'CADÊ-MINHA-HERANÇA'], ['🤣', 'VOU-FINGIR-QUE-NÃO-VI'],
['💅', 'DEBOCHE-FINO'], ['👠', 'MADAME-DO-ZAP'],
['😂', 'FALO-MESMO'], ['🤣', 'FOFOCA-EM-DIA'],
['👀', 'OLHO-VIVO'], ['🍿', 'PLANTÃO-DA-FOFOCA'],
['🤫', 'SEGREDO-DE-ESTADO'], ['😂', 'BOCA-DE-SIRI'],
['💃', 'PURA-OSTENTAÇÃO'], ['👑', 'A-DONA-DO-GRUPO'],
['🤣', 'NÃO-ME-TESTA'], ['😭', 'DRAMA-EM-PESSOA'],
['💅', 'DELICADA-SÓ-QUE-NÃO'], ['😂', 'PACIÊNCIA-ZERO'],
['🫣', 'FINGINDO-DE-SONSA'], ['🤣', 'EU-NÃO-TENHO-CULPA'],
['💃', 'NASCI-PRA-BRILHAR'], ['🤑', 'PIX-ME-AMAR'],
['😂', 'SEM-FILTRO-E-SEM-VERGONHA'], ['👑', 'LENDÁRIA-DO-ZAP'],
['🤣', 'SÓ-QUERO-PAZ'], ['😭', 'PAZ-QUE-NÃO-TENHO'],
['💸', 'SALÁRIO-FOI-EMBORA'], ['🤑', 'BOLSA-PIX'],
['😂', 'MÃE-DO-DEBOCHE'], ['💅', 'INIMIGA-DO-PIX-BAIXO'],
['🤣', 'MEU-ADVOGADO-AVISA'], ['👀', 'TÔ-DE-OLHO'],
['🍷', 'BEBENDO-E-OBSERVANDO'], ['💃', 'SOLTEIRA-E-SEM-JUÍZO'],
['❤️', 'APAIXONADA-PELO-PIX'], ['😂', 'CASADA-COM-A-ZOEIRA'],
['🤣', 'NÃO-PROMETO-NADA'], ['👑', 'CHEFE-DA-BAGUNÇA'],
['😭', 'CHORANDO-EM-4K'], ['💸', 'POBRE-MAS-EXIGENTE'],
['🤑', 'PIX-ME-ADOTA'], ['💅', 'BELEZA-E-BOLETO'],
['😂', 'A-LOUCA-DO-GRUPO'], ['🤣', 'FUI-ALI-SURTAR'],
['👠', 'SALTO-ALTO-E-CAOS'], ['💃', 'DANÇA-MAS-NÃO-PAGA'],
['🤡', 'ILUDIDA-COM-SUCESSO'], ['😭', 'MEU-LIMITE-É-ZERO'],
['😂', 'RISADA-DE-HIENA'], ['👑', 'PRINCESA-DO-PIX'],
['🤑', 'DINHEIRO-NA-MÃO'], ['🤣', 'SÓ-NA-PROMOÇÃO'],
['💅', 'FINA-E-FOFOQUEIRA'], ['👀', 'NÃO-PERCO-UM-DETALHE'],
['😂', 'DEBOCHADA-RAIZ'], ['💃', 'ELA-É-O-EVENTO'],
['🤣', 'TÔ-NEM-AÍ'], ['😭', 'SOCORRO-MEU-PIX'],
['🤑', 'ME-CHAMA-DE-RICA'], ['👑', 'PATRÃO-DO-ZAP'],
['😂', 'A-ÚLTIMA-BOLACHA'], ['💸', 'VICIADA-EM-COMPRAR'],
['🤣', 'NÃO-FOI-POR-MAL'], ['💅', 'DEBOCHE-ATIVADO'],
['💃', 'PERIGO-EM-SALTO'], ['😂', 'SEM-VERGONHA-MAS-FELIZ'],
['👑', 'DONO-DO-ROLÊ'], ['🤣', 'SÓ-VIM-PELA-ZOEIRA'],
['😭', 'PIX-EM-EXTINÇÃO'], ['🤑', 'RICA-DE-ESPÍRITO'],
['😂', 'A-FAVOR-DA-BAGUNÇA'], ['💃', 'CHEGUEI-CAUSANDO'],
['🤣', 'NÃO-ME-RESPONSABILIZO'], ['👑', 'LUXO-SEM-LIMITES'],
['💅', 'BEIJO-NO-OMBRO'], ['😂', 'EU-SOU-O-PROBLEMA'],
    
   // 🔍 INVESTIGAÇÃO (tom leve, sem glamourizar crime)
['🕵️', 'DETETIVE-DO-DC'], ['🕵️', 'INVESTIGA-O-PIX-DC'],
['🚨', 'CHAMA-A-POLICIA-DC'], ['👮', 'DELEGADA-DO-DC'],
['🕵️', 'AGENTE-SECRETO-DC'], ['👮', 'FISCAL-DO-PIX-DC'],
['🕵️', 'MISTERIO-NA-CONTA-DC'], ['👮', 'XERIFE-DO-PIX-DC'],
['🕵️', 'CASO-DO-DINHEIRO-DC'], ['👮', 'LEI-DO-PIX-DC'],
['🔎', 'OLHO-DE-DETETIVE-DC'], ['🚨', 'ALERTA-VERMELHO-DC'],
['🕵️', 'INVESTIGADOR-RAIZ-DC'], ['👮', 'GUARDIAO-DO-GRUPO-DC'],
['🔍', 'CADÊ-O-SUSPEITO-DC'], ['🕵️', 'PERITO-DO-ZAP-DC'],
['🚔', 'VIATURA-DO-PIX-DC'], ['👮', 'POLICIAL-DA-FOFOCA-DC'],
['🔎', 'PISTA-PERDIDA-DC'], ['🕵️', 'ARQUIVO-SECRETO-DC'],
['🚨', 'PLANTAO-POLICIAL-DC'], ['👮', 'COMISSARIO-DO-DC'],
['🕵️', 'DETETIVE-ONLINE-DC'], ['🔍', 'RASTREADOR-DE-PIX-DC'],
['👮', 'PATRULHA-DO-ZAP-DC'], ['🚨', 'SIRENE-LIGADA-DC'],
['🕵️', 'MESTRE-DAS-PISTAS-DC'], ['🔎', 'LUPA-DO-MISTERIO-DC'],
['👮', 'INSPETOR-DO-GRUPO-DC'], ['🕵️', 'AGENTE-007-DC'],
['🚔', 'RONDA-DO-PIX-DC'], ['🔍', 'INVESTIGA-TUDO-DC'],
['👮', 'CHEFE-DA-INVESTIGACAO-DC'], ['🕵️', 'SEGREDO-DESVENDADO-DC'],
['🚨', 'CODIGO-VERMELHO-DC'], ['🔎', 'CAÇADOR-DE-PISTAS-DC'],
['🕵️', 'OLHO-CLINICO-DC'], ['👮', 'FISCAL-DA-CONTA-DC'],
['🔍', 'MISTERIO-RESOLVIDO-DC'], ['🚔', 'PATRULHEIRO-DO-DC'],
['🕵️', 'DETETIVE-DA-MADRUGADA-DC'], ['👮', 'AUTORIDADE-DO-PIX-DC'],
['🔎', 'CADÊ-A-PROVA-DC'], ['🚨', 'INVESTIGACAO-ABERTA-DC'],
['🕵️', 'AGENTE-DA-FOFOCA-DC'], ['👮', 'INSPETORA-DO-PIX-DC'],
['🔍', 'LUPA-NA-MAO-DC'], ['🕵️', 'CASO-MISTERIOSO-DC'],
['🚔', 'RONDA-NOTURNA-DC'], ['👮', 'DELEGADO-DO-ZAP-DC'],
['🔎', 'PISTA-QUENTE-DC'], ['🕵️', 'DETETIVE-DA-VERDADE-DC'],
['🚨', 'ALERTA-DE-SUSPEITA-DC'], ['👮', 'FISCAL-DO-ROLÊ-DC'],
['🔍', 'INVESTIGA-ESSA-DC'], ['🕵️', 'OLHO-NO-MOVIMENTO-DC'],
['🚔', 'POLICIA-DO-GRUPO-DC'], ['👮', 'XERIFE-DA-FOFOCA-DC'],
['🔎', 'PROVA-OU-BOATO-DC'], ['🕵️', 'MISTERIO-DO-ZAP-DC'],
['🚨', 'OPERAÇÃO-PIX-DC'], ['👮', 'CHEFE-DA-RONDA-DC'],
['🔍', 'DETALHE-SUSPEITO-DC'], ['🕵️', 'AGENTE-DA-LUPA-DC'],
['🚔', 'PATRULHA-ONLINE-DC'], ['👮', 'DELEGACIA-DO-PIX-DC'],
['🔎', 'DESCOBRIDOR-DE-SEGREDOS-DC'], ['🕵️', 'INVESTIGADOR-DO-ZAP-DC'],
['🚨', 'SUSPEITA-NO-AR-DC'], ['👮', 'GUARDA-DO-PIX-DC'],
['🔍', 'SEM-PISTA-SEM-PAZ-DC'], ['🕵️', 'DETETIVE-DO-MISTERIO-DC'],
['🚔', 'RONDA-DO-GRUPO-DC'], ['👮', 'INSPETOR-GADGET-DC'],
['🔎', 'LUPA-INVESTIGATIVA-DC'], ['🕵️', 'AGENTE-DISFARCADO-DC'],
['🚨', 'CASO-EM-ANDAMENTO-DC'], ['👮', 'POLICIA-DO-PIX-DC'],
['🔍', 'RASTREADOR-DE-SEGREDOS-DC'], ['🕵️', 'DETETIVE-DO-ROLÊ-DC'],
['🚔', 'VIATURA-ONLINE-DC'], ['👮', 'FISCAL-DA-VERDADE-DC'],
['🔎', 'QUEM-FOI-DC'], ['🕵️', 'INVESTIGA-QUE-EU-VEJO-DC'],
['🚨', 'PLANTAO-DO-MISTERIO-DC'], ['👮', 'XERIFE-DA-CONTA-DC'],
['🔍', 'PROCURANDO-PISTAS-DC'], ['🕵️', 'AGENTE-DO-PIX-DC'],
['🚔', 'RONDA-DA-MADRUGADA-DC'], ['👮', 'DELEGADA-DA-ZOEIRA-DC'],
['🔎', 'NADA-ESCAPA-DC'], ['🕵️', 'DETETIVE-SEM-FERIAS-DC'],
['🚨', 'SIRENE-DO-MISTERIO-DC'], ['👮', 'FISCAL-DO-DC-DC'],
['🔍', 'CASO-ENCERRADO-DC'], ['🕵️', 'ULTIMA-PISTA-DC'],
['🚔', 'PATRULHA-DA-VERDADE-DC'], ['👮', 'LEI-E-ORDEM-DC'],
['🔎', 'OLHO-VIVO-DC'], ['🕵️', 'INVESTIGADOR-DO-PIX-DC'],
    
// ☕ EXTRAS SEGUROS
['🍻', 'FIADO-NUNCA-DC'], ['🍻', 'PINGA-NA-CONTA-DC'],
['💋', 'DEVEDORA-DC'], ['🔥', 'RAINHA-DO-PIX-DC'],
['🍺', 'AGIOTA-DO-AMOR-DC'], ['🍷', 'TAÇA-DA-FOFOCA-DC'],
['💸', 'PIX-NA-MÃO-DC'], ['🍻', 'BUTECO-DA-ALEGRIA-DC'],
['💋', 'BEIJO-COM-JUROS-DC'], ['🔥', 'PERIGO-DE-SAIA-DC'],
['🍺', 'CERVEJA-E-RESENHA-DC'], ['🤣', 'CALOTEIRA-CHIQUE-DC'],
['💰', 'COFRE-VAZIO-DC'], ['🍷', 'VINHO-E-DEBOCHE-DC'],
['💃', 'DONA-DA-NOITE-DC'], ['🍻', 'AMIGA-DO-BAR-DC'],
['💋', 'BEIJO-DE-MILHÕES-DC'], ['🤑', 'PIX-DA-FELICIDADE-DC'],
['🍺', 'CERVEJINHA-DO-CAOS-DC'], ['🔥', 'SEM-JUÍZO-DC'],
['💸', 'PAGA-MINHA-CERVEJA-DC'], ['🍷', 'MADAME-DO-VINHO-DC'],
['💃', 'SOLTEIRA-E-FELIZ-DC'], ['🍻', 'BRINDE-A-VIDA-DC'],
['💋', 'BOCA-DE-MEL-DC'], ['🤣', 'SÓ-VIVO-DE-RESENHA-DC'],
['🍺', 'BARZINHO-RAIZ-DC'], ['💰', 'HERDEIRA-DO-NADA-DC'],
['🔥', 'TEMPERATURA-MÁXIMA-DC'], ['🍷', 'UMA-TAÇA-A-MAIS-DC'],
['💸', 'CADÊ-MEU-PIX-DC'], ['💃', 'DANÇA-DO-PIX-DC'],
['🍻', 'TOMA-UMA-DC'], ['💋', 'BEIJOQUEIRA-DC'],
['🤣', 'RISADA-SOLTA-DC'], ['🍺', 'GELADA-E-BOA-DC'],
['🔥', 'FOGO-NO-ROLÊ-DC'], ['💰', 'POBRE-MAS-EXIGENTE-DC'],
['🍷', 'VINHO-SEM-DRAMA-DC'], ['💃', 'FESTEIRA-OFICIAL-DC'],
['💋', 'ROMANCE-COM-PIX-DC'], ['🍻', 'BEBE-E-NÃO-PAGA-DC'],
['🤑', 'PIX-OU-BEIJO-DC'], ['🤣', 'CALOTE-COM-CHARME-DC'],
['🍺', 'DONA-DO-BUTECO-DC'], ['🔥', 'CHAMA-NO-PRIVADO-DC'],
['💃', 'PODEROSA-DO-ROLÊ-DC'], ['🍷', 'TAÇA-CHEIA-DC'],
['💸', 'SALÁRIO-EM-FUGA-DC'], ['💋', 'NAMORO-COM-BOLETO-DC'],
['🍻', 'BRINDE-SEM-FIM-DC'], ['🤣', 'LOUCA-DA-RESENHA-DC'],
['🍺', 'MESTRA-DO-BOTECO-DC'], ['💰', 'PIX-MILIONÁRIO-DC'],
['🔥', 'DEBOCHE-QUENTE-DC'], ['💃', 'RAINHA-DA-BAGUNÇA-DC'],
['🍷', 'GOTA-DE-GLAMOUR-DC'], ['💋', 'BEIJO-CARIMBADO-DC'],
['🍻', 'SAÚDE-E-PIX-DC'], ['🤣', 'FIADO-SÓ-AMANHÃ-DC'],
['💸', 'PAGA-QUE-EU-BEBO-DC'], ['🍺', 'CERVEJA-É-TERAPIA-DC'],
['💃', 'NOITE-DE-PRINCESA-DC'], ['🔥', 'ARRASTA-PRA-CIMA-DC'],
['💰', 'TESOUREIRA-DO-AMOR-DC'], ['💋', 'PAQUERA-ONLINE-DC'],
['🍷', 'VINHO-DA-VITÓRIA-DC'], ['🤣', 'SEM-VERGONHA-DC'],
['🍻', 'BOTECO-DA-MADAME-DC'], ['💸', 'PIX-NA-MADRUGADA-DC'],
['🔥', 'BRASA-DO-ROLÊ-DC'], ['💃', 'ELA-É-A-FESTA-DC'],
['🍺', 'GELADA-POR-FAVOR-DC'], ['💋', 'CORAÇÃO-DEVEDOR-DC'],
['🤑', 'RICA-DE-FACHADA-DC'], ['🤣', 'BEBI-E-ESQUECI-DC'],
['🍷', 'TAÇA-DA-MADAME-DC'], ['🍻', 'SÓ-MAIS-UMA-DC'],
['💸', 'PIX-DO-BOTECO-DC'], ['💃', 'MUSA-DA-RESENHA-DC'],
['🔥', 'PIMENTA-DO-ROLÊ-DC'], ['💋', 'BEIJO-E-BOLETO-DC'],
['🍺', 'AMANTE-DA-GELADA-DC'], ['🤣', 'DEBOCHE-NA-VEIA-DC'],
['💰', 'BANCO-DO-AMOR-DC'], ['🍻', 'FESTA-NÃO-TEM-FIM-DC'],
['💃', 'DIVA-DO-BUTECO-DC'], ['🔥', 'SEM-FREIO-DC'],
['🍷', 'VINHO-E-SEGREDOS-DC'], ['💋', 'PAQUERA-SEM-LIMITES-DC'],
['🤑', 'PIX-DA-RIQUEZA-DC'], ['🍺', 'CERVEJA-DA-PAZ-DC'],
['🤣', 'SÓ-NA-GARGALHADA-DC'], ['💃', 'DONA-DO-PEDAÇO-DC'],
['🍻', 'BEBIDA-E-AMIZADE-DC'], ['💸', 'DEVEDORA-DE-PIX-DC'],
['🔥', 'CHAMA-QUE-EU-VOU-DC'], ['💋', 'BEIJO-DE-BOTECO-DC'],
['🍷', 'BRINDE-AOS-BOATOS-DC'], ['🤣', 'RISADA-E-CALOTE-DC'],
['💰', 'PATROCINA-O-ROLÊ-DC'], ['🍻', 'ULTIMA-RODADA-DC']
];

// ---------------------------------------------------------------
// Criação automática da tabela (roda só uma vez)
// ---------------------------------------------------------------
let tabelaOk = false;
async function garantirTabela() {
    if (tabelaOk) return;
    await pool.query(`
        CREATE TABLE IF NOT EXISTS damas_pix_keys (
            user_id   TEXT PRIMARY KEY,
            chave     TEXT UNIQUE NOT NULL,
            emoji     TEXT NOT NULL,
            criado_em TIMESTAMP DEFAULT NOW()
        )
    `);
    tabelaOk = true;
}

// ---------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------
function extractDigits(number) {
    if (!number) return null;
    return number.replace(/@.*$/, '').replace(/\D/g, '');
}

function getNumeroReal(message) {
    if (message.key.participantAlt) return message.key.participantAlt;
    if (message.key.participant) return message.key.participant;
    return message.key.remoteJid;
}

// Tira emoji/espaços e deixa só LETRAS, NÚMEROS e hífen
function normalizarChave(texto) {
    return texto.toUpperCase().replace(/[^A-ZÀ-Ú0-9-]/g, '');
}

function gerarChave() {
    const [emoji, palavra] = PALAVRAS[Math.floor(Math.random() * PALAVRAS.length)];
    const numero = Math.floor(100 + Math.random() * 900); // 100–999
    return { emoji, chave: `${palavra}-${numero}` };
}

// ---------------------------------------------------------------
// #pix  →  gera (ou mostra) a chave PIX da pessoa
// ---------------------------------------------------------------
export async function pixHandler(sock, message) {
    const from = message.key.remoteJid;
    try {
        await garantirTabela();

        const userId = extractDigits(getNumeroReal(message));

        // Já tem chave? Só mostra.
        let res = await pool.query(
            `SELECT chave, emoji FROM damas_pix_keys WHERE user_id = $1`,
            [userId]
        );

        let criouAgora = false;
        if (!res.rows[0]) {
            // Tenta gerar uma chave única (até 10 tentativas)
            for (let i = 0; i < 10; i++) {
                const { emoji, chave } = gerarChave();
                try {
                    await pool.query(
                        `INSERT INTO damas_pix_keys (user_id, chave, emoji) VALUES ($1, $2, $3)`,
                        [userId, chave, emoji]
                    );
                    res = { rows: [{ chave, emoji }] };
                    criouAgora = true;
                    break;
                } catch (e) {
                    if (e.code !== '23505') throw e; // 23505 = duplicada, tenta outra
                    // Se o user_id já existe (corrida entre duas mensagens), busca a existente
                    const existente = await pool.query(
                        `SELECT chave, emoji FROM damas_pix_keys WHERE user_id = $1`,
                        [userId]
                    );
                    if (existente.rows[0]) {
                        res = existente;
                        break;
                    }
                }
            }
            if (!res.rows[0]) throw new Error('Não consegui gerar chave única');
        }

        await flushDC();
        const saldoRes = await pool.query(
            `SELECT saldo FROM damas_dc_wallets WHERE user_id = $1`,
            [userId]
        );
        const saldo = Number(saldoRes.rows[0]?.saldo || 0);
        const { chave, emoji } = res.rows[0];

        await sock.sendMessage(from, {
            text: `🏦 *BANCO DAMAS*\n\n` +
                  (criouAgora ? `Sua chave PIX foi gerada!\n\n` : `Sua chave PIX:\n\n`) +
                  `🔑 CHAVE: ${emoji}${chave}\n\n` +
                  `💰 Saldo: ${saldo.toLocaleString('pt-BR')} DCs\n\n` +
                  `Para receber, compartilhe sua chave!`
        }, { quoted: message });
    } catch (err) {
        console.error('[pixHandler] Erro:', err.message);
        await sock.sendMessage(from, {
            text: '❌ Erro ao gerar sua chave PIX.'
        }, { quoted: message });
    }
}

// ---------------------------------------------------------------
// #enviar CHAVE valor  →  transfere DCs usando a chave PIX
// ---------------------------------------------------------------
export async function enviarPixHandler(sock, message, content) {
    const from = message.key.remoteJid;
    try {
        await garantirTabela();
        await flushDC();

        const remetenteId = extractDigits(getNumeroReal(message));

        // content esperado: "#enviar 🍺CALOTEIRO-728 100"
        const partes = content.trim().split(/\s+/);
        const valorTxt = partes[partes.length - 1];
        const chaveTxt = partes.slice(1, -1).join('');

        const valor = parseFloat(String(valorTxt).replace(',', '.'));
        if (!chaveTxt || isNaN(valor) || valor <= 0) {
            await sock.sendMessage(from, {
                text: '⚠️ Use: *#enviar CHAVE VALOR*\nEx: *#enviar CALOTEIRO-728 100*'
            }, { quoted: message });
            return;
        }

        const chave = normalizarChave(chaveTxt);
        const dest = await pool.query(
            `SELECT user_id FROM damas_pix_keys WHERE chave = $1`,
            [chave]
        );
        if (!dest.rows[0]) {
            await sock.sendMessage(from, {
                text: '❌ Chave PIX não encontrada.'
            }, { quoted: message });
            return;
        }
        const destinatarioId = dest.rows[0].user_id;

        if (destinatarioId === remetenteId) {
            await sock.sendMessage(from, {
                text: '⚠️ Você não pode enviar PIX para si mesma(o)!'
            }, { quoted: message });
            return;
        }

        let saldoInsuficiente = null;

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Trava a linha e confere o saldo dentro da transação
            const s = await client.query(
                `SELECT saldo FROM damas_dc_wallets WHERE user_id = $1 FOR UPDATE`,
                [remetenteId]
            );
            const saldo = Number(s.rows[0]?.saldo || 0);

            if (saldo < valor) {
                await client.query('ROLLBACK');
                saldoInsuficiente = saldo;
            } else {
                await client.query(
                    `UPDATE damas_dc_wallets SET saldo = saldo - $1, atualizado_em = NOW() WHERE user_id = $2`,
                    [valor, remetenteId]
                );
                await client.query(
                    `INSERT INTO damas_dc_wallets (user_id, saldo) VALUES ($1, $2)
                     ON CONFLICT (user_id)
                     DO UPDATE SET saldo = damas_dc_wallets.saldo + $2, atualizado_em = NOW()`,
                    [destinatarioId, valor]
                );
                await client.query('COMMIT');
            }
        } catch (err) {
            await client.query('ROLLBACK').catch(() => {});
            throw err;
        } finally {
            client.release();
        }

        if (saldoInsuficiente !== null) {
            await sock.sendMessage(from, {
                text: `❌ Saldo insuficiente! Você tem *${saldoInsuficiente.toLocaleString('pt-BR')} DCs*.`
            }, { quoted: message });
            return;
        }

        await sock.sendMessage(from, {
            text: `💸 *TRANSFERÊNCIA REALIZADA!*\n\n` +
                  `👤 Destinatário: @${destinatarioId}\n` +
                  `💰 Valor: ${valor.toLocaleString('pt-BR')} DCs\n\n` +
                  `✅ Operação concluída!\n\n` +
                  `🏦 Banco Damas agradece!`,
            mentions: [`${destinatarioId}@s.whatsapp.net`]
        }, { quoted: message });
    } catch (err) {
        console.error('[enviarPixHandler] Erro:', err.message);
        await sock.sendMessage(from, {
            text: '❌ Erro ao processar o PIX.'
        }, { quoted: message });
    }
}