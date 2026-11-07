// O texto do "i" sai daqui, para cada indicador ter uma única explicação.
const SOURCE = "Soma das lavouras temporárias e permanentes. O café entra por arábica e canephora, sem somar o total do café.";
const NOMINAL = "Valor nominal, sem correção pela inflação: anos diferentes não são diretamente comparáveis.";

export const HELP = {
  value: `Valor da produção em reais, no recorte dos filtros. ${SOURCE} ${NOMINAL}`,
  variation: "Variação do valor da produção sobre o ano anterior, no mesmo recorte. Aparece quando há um único ano selecionado. É nominal: parte dela pode ser inflação. Se a fonte passou a incluir ou deixou de incluir lavouras de um ano para o outro, o aviso abaixo do número diz quanto isso pesa.",
  quantity: "Quantidade produzida da lavoura escolhida. Só aparece com uma lavoura: somar toneladas de lavouras diferentes engana, e a fonte não publica esse total. Abacaxi e coco-da-baía têm uma nota da fonte ainda não confirmada, e a unidade deles fica como a verificar.",
  area: `Área colhida em hectares. ${SOURCE} Só aparece com um ano escolhido: somar anos conta a mesma terra de novo.`,
  crops: "Número de lavouras com produção no recorte dos filtros.",
  byYear: `Valor da produção por ano, dividido por região. Mostra sempre todos os anos e destaca o ano escolhido. O número acima da coluna é o total do ano, e o valor de cada região aparece na faixa, quando cabe, ou ao passar o mouse. ${NOMINAL} Clique em uma coluna para escolher o ano.`,
  byRegion: `Participação de cada região no valor da produção, com o total no centro. ${NOMINAL} Clique em uma fatia para filtrar os outros blocos.`,
  map: `Valor da produção por UF no mapa, no recorte dos filtros. Quanto mais escura a cor, maior o valor. Cada faixa da legenda reúne um número parecido de UFs e diz até quanto ela vai. Zero tem o tom mais claro, valor negativo tem cor própria, e UF sem dado no recorte ou fora da sua permissão fica neutra, sem valor. Onde o rótulo não cabe, o valor fica na dica do mouse e no gráfico por UF. Clique em um estado para filtrar os outros blocos: o mapa continua inteiro, com o estado em destaque, e o segundo clique retira. Os contornos são a malha simplificada do IBGE, guardada no dashboard. ${NOMINAL}`,
  byState: `Valor da produção por UF, do maior para o menor. ${NOMINAL} Clique em uma linha para filtrar os outros blocos.`,
  byCrop: `As 10 maiores lavouras por valor da produção, e as demais em Outros. ${NOMINAL} Clique em uma linha para filtrar os outros blocos. Outros não filtra.`,
  detail: `Linhas de origem por ano, UF e lavoura, ou agrupadas pela dimensão escolhida. Clique em uma linha agrupada para filtrar e ver as linhas dela, e no cabeçalho para ordenar. O total vale para todas as páginas. A quantidade só soma dentro de uma lavoura, e a área, dentro de um ano. ${NOMINAL}`,
  check: "Compara o dashboard com o total do Brasil publicado pela fonte, ano a ano. A fonte publica o valor em mil reais, e cada uma das 27 UFs pode diferir em até R$ 1.000 por arredondamento: essa é a tolerância, e a diferença aparece em linha própria. A quantidade é conferida lavoura a lavoura, porque a fonte não publica o total em toneladas.",
  agent: "Responde sobre estes dados, dentro dos filtros atuais da tela. Só lê: não altera nenhum valor.",
};

// Só no site estático.
export const SITE_DETAIL_HELP = `Menor agregado publicado neste site: uma linha por ano, UF e lavoura, ou agrupada pela dimensão escolhida. Não há linhas abaixo disso. Clique em uma linha agrupada para filtrar, e no cabeçalho para ordenar. O total vale para todas as páginas. A quantidade só soma dentro de uma lavoura, e a área, dentro de um ano. ${NOMINAL}`;

// Só com o mês ligado.
export const MONTH_HELP = {
  variation: "Variação do valor da produção sobre o ano anterior, no mesmo recorte e só com os mesmos meses. Se o ano anterior tem menos meses com dado, a variação não existe e aparece como traço. É nominal: parte dela pode ser inflação.",
  area: `Área colhida em hectares. ${SOURCE} Só aparece com um mês escolhido: somar meses conta a mesma terra de novo.`,
  byYear: `${HELP.byYear} Ano sem os 12 meses aparece com os meses no eixo, como "até set".`,
  byMonth: `Valor da produção em cada mês do ano escolhido. O mês escolhido fica em destaque, e mês sem dado no recorte aparece com um traço. ${NOMINAL} Clique em uma coluna para escolher o mês.`,
  detail: `Linhas de origem por mês, UF e lavoura, ou agrupadas pela dimensão escolhida. Clique em uma linha agrupada para filtrar e ver as linhas dela, e no cabeçalho para ordenar. O total vale para todas as páginas. A quantidade só soma dentro de uma lavoura, e a área, dentro de um mês. ${NOMINAL}`,
};
