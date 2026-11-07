---
name: dash-numeros
description: Define como cada número, unidade, percentual, moeda e data aparece no dashboard, com um módulo único de formatação testado. Use sempre que for exibir, formatar, abreviar ou rotular um valor em cartão, gráfico, tabela ou resposta do agente, ou quando um número estiver escondido, mal formatado ou na unidade errada.
---

# Números na tela

Ajuste de formato pedido pelo usuário vira regra: atualize esta skill, o `AGENTS.md` e o módulo juntos.

Um número escondido, mal formatado ou na unidade errada é a falha mais grave depois do dado inventado, porque o leitor decide em cima dele sem perceber o problema.

## Use o módulo único

Copie [format.ts](references/format.ts) e [format.test.ts](references/format.test.ts) para o projeto. Nenhum componente formata por conta própria, e isso inclui rótulos do ECharts e colunas do AG Grid. Assim, o mesmo valor sai igual em toda parte, e mudar o idioma é mudar um só arquivo.

| Tipo | Exemplo | Função | Onde |
|---|---|---|---|
| R$ resumido | `R$ 604 K`, `R$ 3,40 M`, `R$ 1,25 B`, `R$ 5,91 T` | `moneyCompact(v)` | Padrão: cartão, gráfico, tabela e resposta do agente |
| R$ exato | `R$ 1.234.568` | `money(v)` | Só na dica do mouse e na conferência. Com centavos na fonte, `money(v, 2)` |
| Preço unitário | `R$ 12,34` ou `R$ 0,1234` | `money(v, 2)` a `money(v, 4)` | Em todos os lugares; nunca compacto |
| Quantidade | `90.280 kg` | `quantity(v, "kg")` | Unidade no próprio número |
| Decimal | `1.234,56` | `decimal(v, 2)` | Quando não há unidade |
| Percentual | `25,6%` | `percent(v)` | Recebe a fração (`0,256`) |
| Variação | `+12,5%` | `variation(v)` | Sempre com sinal |
| Pontos percentuais | `+1,5 p.p.` | `points(v)` | Diferença entre dois percentuais |
| Data | `31/10/2026` | `date(v)` | Tabela e texto |
| Mês | `out/26` | `month(v)` | Eixo de gráfico (em gráfico de linha, só o mês: veja "Eixo de meses") |
| Data e hora | `31/10/2026 20:00` | `dateTime(v)` | Última atualização |
| Sem dado | `—` | Qualquer uma | Nunca vira zero |
| Valor para desenhar | Número ou nulo | `chartValue(v)` | Dado do gráfico; nunca use `Number(v)`, que transforma sem dado em zero |

O módulo só formata. Se a tela precisar de um total, ele vem do backend.

## Regras de exibição

**Todo número aparece na tela.** Só em gráfico denso, onde o rótulo não cabe, o valor pode ficar na dica do mouse. Antes disso, tente mudar o gráfico: barra horizontal, menos categorias com "Outros" ou tabela junto.

Avise quando um gráfico depender da dica do mouse e for para apresentação ou impressão, porque nesses casos a dica não aparece.

**Unidade:**

- Ela fica junto do número e no nome do indicador: `Peso (kg)`, `Preço médio (R$/kg)`.
- Nunca some unidades diferentes. Se as linhas de uma tabela têm unidades diferentes, não há total de quantidade.
- Não some a mesma coisa de novo. Área e estoque não somam entre períodos: 10 anos de área dariam mais que o território do país. Mostre `—` e diga "Escolha um ano".
- Valor acumulado de vários períodos leva "acumulado" no nome.
- Mesma unidade não basta. Toneladas de soja e de cana somam, mas o número engana, ainda mais se a fonte não publica esse total. Sem sentido para quem decide, mostre `—` e diga como chegar ao número, como "Escolha uma lavoura".
- Unidade duvidosa não é afirmada. Enquanto não houver confirmação, o número fica como veio, marcado como "unidade a verificar", fora de qualquer soma com outros itens. Nesse caso, o nome do indicador não traz a unidade.
- Quem define a unidade é o dicionário de indicadores. Se o dado vem em outra, converta no backend e diga isso no "i".

**Abreviação:**

- Valor em R$ sempre resumido: 2 casas em M, B e T, e nenhuma em K. Abaixo de mil, fica como `R$ 950`.
- Nada de abreviação automática da biblioteca, como `3,4 mil`.
- Preço unitário, quantidade e área não são resumidos.
- Peso fica em quilos, com o número cheio: `5.966.754 kg`, e não `5.966,8 t`. Não converta kg para toneladas para encurtar, em nenhum lugar. Se a fonte já publica em outra unidade, ela fica como veio, sem conversão.
- O valor exato continua disponível na dica do mouse e na conferência, que precisa dele para mostrar diferenças pequenas.

**Eixo de meses:**

- Em gráfico de linha, o eixo mostra só o mês, sem uma segunda linha embaixo dele.
- A base de cada ponto (quantos itens entraram no %) vai para a dica do mouse.

**Sinal e cor:**

- Variação sempre com sinal, porque a cor sozinha não chega a quem não distingue verde de vermelho nem a uma impressão em preto e branco.
- Verde e vermelho só têm significado quando o sentido é claro. Custo que sobe não é "positivo".

**Texto de resumo:**

Frases como "as vendas cresceram 12,5%" são calculadas a partir do dado, nunca digitadas. Texto digitado envelhece e fica errado sem aviso.

## Títulos e rótulos

- Quando não for o total, o título diz o escopo e o período: `Vendas (R$) · Região Sul · jan a out/26`.
- O mesmo nome sempre tem o mesmo número em todas as telas. Se o escopo muda, o nome muda.
- O rótulo não pode sugerir o que o dado não prova: "faturado" não é "pago".
- A diferença entre dois números vira linha própria, com nome, para a conta fechar à vista.

## Antes de entregar

- [ ] Nenhum número sai sem passar pelo módulo.
- [ ] Todo indicador tem unidade no nome e no valor.
- [ ] Nenhum total soma unidades diferentes.
- [ ] Sem dado aparece como `—`, e zero real aparece como zero.
- [ ] Nenhum `NaN`, `undefined`, `null` ou data como `2026-10`.
- [ ] Nenhum valor depende da dica do mouse, exceto em gráfico denso.
- [ ] Valor em R$ sempre resumido, nunca em preço unitário.
- [ ] Eixo de meses em gráfico de linha só com o mês, e a base de cada ponto na dica do mouse.
- [ ] Os testes do módulo passam.
