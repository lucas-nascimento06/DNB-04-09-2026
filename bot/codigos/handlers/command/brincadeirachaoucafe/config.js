// Configuração da brincadeira Chá ou Café
const config = {
  prefixo: '#',

  // Comandos que criam o convite: #chaoucafe @maria  ou  #cc @maria
  comandosConvite: ['chaoucafe', 'cc'],

  // Comandos de resposta da pessoa marcada: #cha ou #cafe
  comandosResposta: ['cha', 'cafe'],

  // Comandos que só enviam o poster + regras (ADM: marca todos de forma invisível e fixa)
  comandosPoster: ['brincadeirachaoucafe', 'bcc'],

  // Comandos de ADM que INICIAM a brincadeira (zera a anterior e reabre se estiver encerrada)
  comandosIniciar: ['icc', 'iniciabrincadeiracc'],

  // Comandos de ADM que ENCERRAM a brincadeira no grupo e limpam o banco de dados
  comandosEncerrar: ['ebcc', 'encerrabrincadeiracc'],

  // A brincadeira só funciona nestes grupos
  gruposPermitidos: [
    '120363412511975026@g.us', // GRUPO_PRINCIPAL
    '120363431558953171@g.us', // GRUPO_ADMINS
    '120363430900442230@g.us', // GRUPO "Chá ou café" (teste)
  ],

  // Só funciona em grupos
  somenteGrupos: true,
};

export const {
  prefixo,
  comandosConvite,
  comandosResposta,
  comandosPoster,
  comandosIniciar,
  comandosEncerrar,
  gruposPermitidos,
  somenteGrupos,
} = config;
export default config;