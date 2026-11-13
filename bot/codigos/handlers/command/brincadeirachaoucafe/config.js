// Configuração da brincadeira Chá ou Café
const config = {
  prefixo: '#',

  // Comandos que criam o convite: #chaoucafe @maria  ou  #cc @maria
  comandosConvite: ['chaoucafe', 'cc'],

  // Comandos de resposta da pessoa marcada: #cha ou #cafe
  comandosResposta: ['cha', 'cafe'],

  // Comandos que enviam o poster + regras (e REABREM a brincadeira se estiver encerrada, só ADM)
  comandosPoster: ['brincadeirachaoucafe', 'bcc'],

  // Comandos de ADM que ENCERRAM a brincadeira no grupo e limpam o banco de dados
  comandosEncerrar: ['ebcc', 'encerrabrincadeiracc'],

  // A brincadeira só funciona nestes grupos
  gruposPermitidos: [
    '120363412511975026@g.us', // GRUPO_PRINCIPAL
    '120363431558953171@g.us', // GRUPO_ADMINS
    '120363430900442230@g.us', // GRUPO "Chá ou café" (teste)
  ],

  // Tempo para a pessoa marcada responder o CONVITE (5 minutos)
  expiracaoMs: 5 * 60 * 1000,

  // Tempo para a pessoa convidada responder a PERGUNTA do bot (2 minutos)
  prazoRespostaMs: 2 * 60 * 1000,

  // Quanto tempo fica silenciada (mensagens apagadas) se não responder (10 minutos)
  silencioMs: 10 * 60 * 1000,

  // De quanto em quanto tempo o bot confere prazos vencidos
  intervaloVerificacaoMs: 15 * 1000,

  // Só funciona em grupos
  somenteGrupos: true,
};

export const {
  prefixo,
  comandosConvite,
  comandosResposta,
  comandosPoster,
  comandosEncerrar,
  gruposPermitidos,
  expiracaoMs,
  prazoRespostaMs,
  silencioMs,
  intervaloVerificacaoMs,
  somenteGrupos,
} = config;
export default config;