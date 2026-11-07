---
name: dash-tela
description: Monta as telas do dashboard em React, com layout, tema em tokens, gráficos ECharts, tabelas AG Grid e mapas MapLibre. Use sempre que for criar ou alterar uma tela, cartão de KPI, gráfico, tabela, mapa, tema, cor ou layout de dashboard, ou escolher o tipo de gráfico para uma pergunta.
---

# Telas do dashboard

A tela existe para responder a uma pergunta sem esforço. Um desenho bonito que esconde o número falhou.

## Portal e cartão

Todo projeto tem um portal, e o dashboard é uma página dentro dele (`/d/<slug>`). O modelo traz as telas prontas, em `web/src/portal`.

- **Entrada:** o login, o primeiro acesso, a troca de senha, o título da página (`<title>`) e o nome do manifesto, se houver, usam o **nome do projeto** (`web/src/project.ts`). O nome de um dashboard só aparece dentro dele e no cartão dele. Um teste (`test/project-name.test.ts`) reprova se o nome ou o endereço de um dashboard aparecer nessas telas, nas mensagens do servidor ou na administração escrita no código.
- **Categorias no painel:** os cartões saem agrupados por categoria, na ordem que a administração definiu (`server/categories.ts`). O título da seção só aparece quando a pessoa vê dashboards de mais de uma categoria: com uma só, o painel fica como um painel sem categorias. Dashboard sem categoria vai para "Sem categoria", por último. Categoria sem dashboard visível não aparece. Dentro do dashboard, um selo discreto diz a categoria.
- **Painel:** um cartão para cada dashboard que a pessoa pode ver, mesmo com um só. Cada cartão traz o nome, uma frase do que o dashboard responde, a fonte, a data da última atualização e a miniatura. Sem acesso a nenhum dashboard, o painel explica. Banco do dashboard fora do ar aparece como "não foi possível ler a data", nunca como uma data inventada.
- **Miniatura:** a foto real da tela, tirada depois de cada carga com o navegador que já está na máquina, em modo invisível (`npm run thumbnail`). Sem navegador, o cartão fica sem imagem e diz isso. A imagem mostra dados, então só é servida a quem tem acesso àquele dashboard, depois do login.
- **Administração:** só o administrador vê o link. Criar pessoa com senha provisória, marcar dashboards e, nos que têm recorte, os itens dele (o botão se chama "Dashboards e acessos", e os textos usam o nome do recorte: "Todas as fazendas", "Só estes talhões"; sem recorte, só "Sem acesso" e "Com acesso"), tirar acesso, desativar e redefinir senha. Criar, renomear, ordenar e apagar categorias (só vazia) e escolher a categoria de cada dashboard. Na tela de uma pessoa, cada categoria é um atalho: marcar dá acesso total a todos os dashboards dela, um acesso por dashboard, desmarcar tira, e a tela diz se a pessoa tem todos, alguns ou nenhum. O recorte do dashboard, quando houver, continua por dashboard. A senha provisória aparece uma vez, e a pessoa a troca no primeiro acesso.
- **Chat do agente:** o texto da resposta mostra negrito, listas com marcador e parágrafos, montados como elementos React, nunca como HTML do modelo (`web/src/chatText.ts`). A janela mostra a conversa guardada no servidor, ao abrir e ao recarregar, tem o botão "Nova conversa" e diz quanto ela lembra. O aviso de dados pessoais aparece uma vez só. Detalhes na skill dash-agente.
- **Laser:** o cabeçalho do portal e o de cada dashboard têm o botão "Laser". Ligado, o mouse vira um ponto vermelho em todo o portal, para apresentar. A escolha fica no navegador e vale ao trocar de página. O botão some em tela de toque, e a foto da miniatura sai sem ele. O modelo traz o botão pronto em `web/src/components/LaserToggle.tsx`, com a regra em `web/src/laser.ts`.
- **Dentro do dashboard:** cabeçalho com o caminho de volta ao painel, o título do dashboard, o botão "Laser" e, se a pessoa pode, a conferência. A descrição do dashboard para o portal (cartão, recorte de acesso, agente) fica na pasta dele.

## Estrutura

Três níveis, nesta ordem:

1. **Abertura:** nome, período e última atualização.
2. **Visão geral:** KPIs e principais gráficos.
3. **Detalhe:** tabelas até a linha de origem.

De cima para baixo, em cada tela:

```text
┌──────────────────────────────────────────────────────────┐
│ Cabeçalho fino: título                                   │
├──────────────────────────────────────────────────────────┤
│ Filtros  [Limpar filtros]   período · última atualização │
├──────────────────────────────────────────────────────────┤
│ KPI      KPI      KPI      KPI      KPI      KPI         │
├────────────────────────────┬─────────────────────────────┤
│ Gráfico                    │ Gráfico                     │
├────────────────────────────┴─────────────────────────────┤
│ Tabela                                                   │
└──────────────────────────────────────────────────────────┘
```

- **Pensado para computador.** No celular, os blocos viram uma coluna, o cartão continua com valor e nome, e a tabela rola para o lado com a primeira coluna fixa.
- **Espaço pequeno e uniforme** entre os blocos, sempre o mesmo token.
- **Estilo plano:** sem borda, sombra nem canto arredondado. A única exceção são as abas, que têm cara de botão, com borda e fundo.
- **Abas:** cada aba tem cara de botão. No primeiro nível, a selecionada fica preenchida na cor principal, com texto branco. No segundo nível (subabas), a selecionada tem contorno e fundo claro da cor principal. No celular, as abas quebram em linhas, sem aba cortada.
- **Filtros numa linha:** em 1366 px de largura, todos os filtros cabem numa linha só. A caixa fica estreita, com reticências, e o nome inteiro aparece na dica do mouse.
- **Sem cartão apertado:** se valor e nome não cabem, mude o desenho.
- **Copie antes de criar:** procure um componente parecido no projeto. O [modelo](../../../modelo) traz os blocos prontos.

## Tema em tokens

Toda cor, fonte e espaço vem de um token. Trocar a marca é trocar este bloco, sem tocar em componente:

```css
:root {
  /* Marca */
  --color-primary: #1f63b0;
  --font-family: Inter, "Segoe UI", system-ui, sans-serif;

  /* Sentido: use só quando a cor significar algo */
  --color-positive: #1b7f4b;
  --color-negative: #c0392b;
  --color-warning: #b26a00;

  /* Séries, nesta ordem fixa */
  --chart-1: #1f63b0;
  --chart-2: #c8701a;
  --chart-3: #1e9486;
  --chart-4: #8e5ba6;
  --chart-5: #9c8a14;
  --chart-6: #c2557a;

  /* Superfícies e texto */
  --color-surface: #fcfcfb;
  --color-background: #f3f4f6;
  --color-text: #22262b;
  --color-text-muted: #5b6570;
  --color-grid: #e3e5e8;

  /* Espaço */
  --gap: 8px;
  --pad: 12px;
}
```

A paleta de séries foi validada para daltonismo e contraste sobre a superfície clara acima. Se trocar as cores, valide de novo. O ECharts e o AG Grid leem estes tokens em um só lugar, para não haver cor solta.

## Escolha o gráfico pela pergunta

| Pergunta | Forma |
|---|---|
| Um número e como ele está | Cartão de KPI |
| Quem é maior? | Barra horizontal, ordenada, quando os nomes forem longos; coluna, quando forem curtos |
| Como evoluiu? | Linha ou coluna por mês |
| De que partes é feito o total? | Donut, até 5 fatias; mais que isso, barra |
| Composição ao longo do tempo | Coluna empilhada, sempre com total |
| Duas medidas no mesmo período | Coluna e linha, ou dois gráficos |
| Valor exato de muitos itens | Tabela |
| Onde o valor se concentra? | Mapa por área, ao lado do gráfico com todos os itens |

Título e rótulo dizem o escopo e o período. Formate com a skill `dash-numeros`.

## Regras de gráfico

- **Barra e coluna:** rótulo ligado e eixo de valores oculto. O rótulo já diz o valor, e o eixo só ocuparia espaço.
- **Série longa com rótulos que se sobrepõem:** primeiro tente o número em pé. Depois, barras horizontais. Se ainda não couber, mostre o eixo, com o valor na dica do mouse.
- **Empilhada:** sempre com o total, vindo do backend, e com o valor dentro de cada faixa, quando couber.
- **Legenda:** legenda de série filtra; escala de cores não. A de série é uma lista de itens: clicar filtra, como na skill `dash-interacoes`. Fica em botões, pela propriedade `legend` do `Chart`, sem a legenda do ECharts. Ela só recebe clique ocultando a série, o que deixaria o total errado. A escala de cores, como a do mapa, não tem item para filtrar, e não pode parecer clicável.
- **Evolução:** mostra todos os períodos e destaca o escolhido, em vez de virar um bloco único. O título diz o intervalo inteiro, não o período escolhido.
- **Sem repetição:** com uma série só, o valor fica acima da coluna, sem repetir dentro dela.
- **Donut:** total no centro.
- **Coluna e linha:** rótulo nas duas e sem eixo de valores. Se as escalas confundirem, separe em dois gráficos.
- **Cor:** série única na cor principal. Verde e vermelho só com significado. Cada categoria tem a mesma cor em todos os gráficos, mesmo quando um filtro muda quantas aparecem. A cor vem do nome da categoria, nunca da posição.
- **Seleção:** o item selecionado fica cheio e os outros, claros, com o texto ainda legível. Se a seleção não está no gráfico, nada se apaga.
- **Legenda:** presente com duas séries ou mais. Com uma série, o título basta.
- **Rótulo no item apagado:** o item apagado transmite a transparência ao texto. Dê `label.opacity: 1`, senão o número fica ilegível.
- **Limpeza:** eixos sem linha nem traço, grade discreta, sem efeito 3D.
- **Texto:** fora da barra, o rótulo fica na cor de texto, nunca na cor da série, para não perder contraste.
- **Número dentro de barra colorida:** fica branco e em negrito. Se a cor da barra for clara demais para o branco, use um tom mais escuro da mesma cor. Na faixa apagada pela seleção, o texto volta à cor de texto, opaco.
- **Eixo de meses:** em gráfico de linha, o eixo mostra só o mês, sem uma segunda linha embaixo dele. A base de cada ponto (quantos itens entraram no %) vai para a dica do mouse.
- **Muitas categorias:** agrupe em "Outros" no backend, com o total conferindo. Nunca gere cor nova. Clicar em "Outros" não filtra.

Os trechos de configuração estão em [echarts.md](references/echarts.md).

## Mapa

Só quando o lugar muda a leitura. O mapa não substitui o gráfico por item: ele fica ao lado, com todos os valores.

- **Só os contornos**, em um GeoJSON guardado no projeto. Sem mapa de ruas, serviço externo, conta ou internet para abrir.
- **Cor:** sequencial de um só tom, da superfície à cor principal, com a legenda em R$ resumido. Sem dado fica neutro, distinto de zero. Negativo tem a cor de sentido do tema, com entrada própria na legenda, só quando existir: sem rótulo, no celular, ele não pode se ler como zero.
- **Legenda:** é uma escala de cores, não uma lista de itens. Não filtra e não parece clicável.
- **Número à vista:** sigla e valor em elementos da página, sem sobreposição. O que não cabe fica na dica do mouse e no gráfico por item.
- **Dica do mouse:** só o valor exato (`56,5%`, `R$ 12.935.673.000`), sem repetir o resumido, que já está na tela.
- **Clique:** uma seleção como a de um gráfico. O mapa continua inteiro, com a área em destaque, os outros blocos filtram e o segundo clique retira, no mesmo lugar, sem mover o mouse: selecionar não move nenhum rótulo.
- **Rolagem:** zoom e arraste desligados, para a página não ficar presa no mapa, inclusive no celular.
- **Falha:** sem WebGL, o bloco avisa em português, e o resto do dashboard funciona. O MapLibre entra em um pedaço separado do bundle.
- **Troca rápida de aba:** o mapa resiste a ela. Erro de mapa que já saiu da tela é ignorado, a criação tenta de novo, e o contexto gráfico perdido tem 3 s para voltar antes do aviso de falha. Veja [mapa.md](references/mapa.md).

O componente pronto e os cuidados estão em [mapa.md](references/mapa.md).

## Tabelas

- Compactas, com cabeçalho e linha de total na cor principal.
- Primeira coluna fixa quando houver muitas colunas.
- Números alinhados à direita, com o formato do módulo.
- A linha de total vem do backend e fica fixa no rodapé.
- Ordena ao clicar no cabeçalho, no servidor. Coluna que só mostra "—" não ordena.
- A dica do mouse traz o valor exato em R$ e o texto cortado.
- No celular, o valor fica logo depois do nome, e a barra de rolagem lateral não cobre a última linha.
- As colunas ocupam toda a largura.
- Valor antes da quantidade quando os dois aparecem.

## Estados de cada bloco

Cada cartão, gráfico e tabela trata os seus estados, sem depender dos outros:

| Estado | O que mostra |
|---|---|
| Carregando | Espaço reservado, sem deslocar a tela |
| Falha | Aviso de erro e opção de tentar de novo. Nunca "sem dados" |
| Sem dados | "Sem dados para os filtros atuais" e o botão de limpar |
| Dado velho | Aviso visível, com a data da última atualização |
| Regra quebrada | Aviso na linha dos filtros; some quando tudo estiver certo. No máximo 3, e o resto na conferência |
| Sem dados aqui, mas em outra publicação | Diga isso e o valor publicado, em vez de só "sem dados" |

## Ajuda em cada bloco

Cada KPI, gráfico e tabela tem um "i" com: o que é, a conta, o que entra e o que fica de fora. Sem sistema, API, SQL ou caminho de arquivo. O texto vem do dicionário de indicadores, para ter uma única versão. O ícone de explicação é sempre o "i", nunca o "?". No KPI, o "i" fica colado ao número, logo à direita dele, e não no canto do cartão: em cartão largo, o canto fica longe do que ele explica. A explicação abre por cima, sempre dentro da tela, fecha ao clicar fora, ao rolar ou com Esc, e só uma fica aberta.

## Mensagens e acesso

- Nenhum erro vira tela branca: a tela tem uma barreira de erro, com o caminho de volta ao início.
- Toda mensagem é em português, inclusive a falta de conexão. Traduza o que vem do navegador.
- O número e a unidade nunca se separam em duas linhas.
- Sem acesso aos dados, a tela explica, em vez de mostrar traços.
- O título nunca promete mais do que a permissão de quem vê: quem só vê Mato Grosso não lê "Brasil".
- Botão que a pessoa não pode usar não aparece.
- Sessão que termina volta ao login com o motivo, e mantém os filtros.

## Filtros

Filtros em linha, sempre à vista ao rolar, com botão de limpar e seleção visível. No celular, ficam no início da página, porque a linha é alta demais para ficar fixa. O dashboard abre no período mais recente. Mostre "Todos" quando não houver seleção, e nunca "(Em branco)": dê um nome ao valor vazio, como "Sem região". O nome é só o rótulo, e o filtro usa uma chave reservada.

- **Uma linha só:** todos os filtros ficam numa linha, sem segunda linha de extras. Cada filtro aparece em toda aba onde ele filtra todos os blocos. Se filtraria só parte da aba, não entra sem decisão do usuário. Se não se aplica pelos dados, fica fora.
- **Destaque:** a caixa só fica azul quando o filtro restringe algo. "Todos" ou "Todas" nunca fica azul, mesmo quando o padrão da aba é outro valor. Na caixa, a opção "Todos" tem valor vazio, e a URL guarda o valor que precisar.

O funcionamento está na skill `dash-interacoes`.

## Bibliotecas

Fixe versões exatas no `package.json`. O [modelo](../../../modelo/package.json) roda com ECharts 6.1.0 e AG Grid Community 36.2.0, já provados. Confira a documentação oficial antes de atualizar. O mapa roda com MapLibre GL 6.16.0, também provado, só com os contornos guardados no projeto.
