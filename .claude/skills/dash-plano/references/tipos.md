# Tipos de dashboard

Consulte ao montar o dicionário de indicadores e as telas.

## Gestão e KPIs

**Pergunta central:** estamos no caminho, e onde agir?

- **Abertura:** nome do dashboard, período e última atualização.
- **Visão geral:** até 8 KPIs em linha. Quando fizer sentido, o mesmo período do ano anterior fica logo abaixo.
- **Comparação:** realizado contra meta ou contra o ano anterior, com a diferença em linha própria.
- **Evolução:** linha mensal, com o mês como `out/26`.
- **Detalhe:** tabela até a linha de origem.

Perguntas que costumam faltar:

- Qual é a meta, e de onde ela vem?
- O mês em andamento entra? Se entrar, diga isso no título, porque a comparação com um mês fechado engana.
- O ano está incompleto? Compare com os mesmos meses do ano anterior e escreva "jan a set" no título. Com menos meses de um lado, a variação fica como `—`.
- O indicador é soma, média ou último valor? Média de médias e soma de saldos costumam dar número errado.

## Financeiro

**Pergunta central:** quanto entrou, saiu e sobrou, e por quê?

**O nome precisa dizer o que o dado prova.** Estes valores não são a mesma coisa, e nenhum deles vira "pago" sem a prova do pagamento:

| Termo | O que prova |
|---|---|
| Faturado | A nota foi emitida |
| Provisionado | Há expectativa de pagar ou receber |
| Ajustado | Houve um lançamento contábil, não necessariamente dinheiro |
| Pago ou recebido | O dinheiro se moveu |

**Antes de construir, pergunte:**

- A visão é por competência (quando aconteceu) ou por caixa (quando o dinheiro se moveu)? Os números serão diferentes, e os dois podem estar certos.
- Devoluções, cancelamentos e estornos entram como? Eles podem inflar ou reduzir o total sem aviso.
- Há lançamentos que não são dinheiro, como transferências entre contas ou ajustes? Eles inflam o total se forem somados.

**Na tela:**

- Demonstrativo em linhas numeradas, com o nome e a conta de cada uma, para o leitor refazer.
- A diferença vira linha própria. Se os números não fecham, a linha mostra quanto falta e o motivo.
- Quem paga ou decide vê cada componente em coluna separada: devido, lançado e a diferença.
- Quantidade e valor lado a lado quando os dois importam, com o valor primeiro. Totalize quantidade só na mesma unidade.
- Preço unitário com formato fixo de 2 a 4 casas, nunca compacto.
- Cruze a mesma grandeza por fontes independentes quando houver mais de uma, e mostre a diferença.
- Inconsistência aparece como "a verificar", nunca como acusação.

## Outros tipos

O método é o mesmo: comece pela decisão, monte o dicionário de indicadores e escolha o gráfico pela pergunta. Se o tipo exigir algo fora da stack, trate como pergunta com opções e custo.
