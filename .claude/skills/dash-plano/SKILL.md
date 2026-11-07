---
name: dash-plano
description: Transforma um pedido de dashboard em perguntas, dicionário de indicadores e plano para aprovação, antes de qualquer código. Use sempre que o usuário pedir um dashboard, painel, relatório interativo, KPI ou indicador novo, ou uma mudança grande em um dashboard existente, mesmo sem usar a palavra "plano".
---

# Do pedido ao plano aprovado

O plano existe para o usuário decidir antes do código, quando mudar de ideia ainda é barato. Nesta etapa, nada é criado nem alterado: só leitura.

## 1. Entenda o pedido

Leia o que já existe: arquivos, dados de exemplo, dashboards anteriores. Pergunte só o que a leitura não responde, em rodadas de até 4 perguntas, cada uma com 2 a 4 opções e uma recomendada. Comece pelo que muda o número. Se o usuário não responde em tempo real, entregue o plano junto, com as decisões em aberto e as opções recomendadas. O plano vai na resposta, mesmo longo: nesta etapa nada é gravado.

Precisa ficar claro:

| Tema | Pergunta |
|---|---|
| Decisão | Quem vai usar e o que vai decidir com isso? |
| Indicadores | Quais números? Qual a conta? O que entra e o que fica de fora? |
| Recorte | Qual período, unidade ou área? O que está fora de propósito? |
| Fontes | De onde vem o dado? Quem dá acesso de leitura? |
| Atualização | De quanto em quanto tempo? Qual atraso é aceitável? |
| Público | Quem pode ver? O dado é interno? Cada pessoa vê tudo ou só uma parte? |
| Projeto | Este dashboard entra em um projeto que já existe? Se sim, ele ganha um cartão no portal que já existe, com o mesmo login, o mesmo servidor e o mesmo banco, em uma pasta própria e com dados próprios. Se não, o projeto novo já nasce com o portal, mesmo com um dashboard só |
| Acesso | Quem administra o portal? Cada pessoa vê quais dashboards? Cada dashboard tem um recorte de acesso (UF, fazenda, unidade...) e qual é o nome dele, ou o acesso é só "com" ou "sem"? |
| Agente | Vai ter agente para perguntas? Se sim, use a skill `dash-agente`. O provedor é um só por projeto, mas cada dashboard diz se tem agente |

Não pergunte o que é escolha técnica: decida e apresente no plano, com o motivo. Regra de negócio ambígua sempre vira pergunta, porque um número certo com a regra errada continua errado.

## 2. Monte o dicionário de indicadores

Todo número do dashboard entra nesta tabela antes de ir para a tela. É aqui que aparecem as divergências de entendimento.

| Indicador (com unidade) | Conta | Entra | Fica de fora | Fonte | Formato |
|---|---|---|---|---|---|
| Faturamento (R$) | soma de `valor` | notas emitidas | notas canceladas | arquivo de vendas | `R$ 3,40 M` |

Use as palavras da equipe e da fonte. Nome novo só com aviso, explicação e alternativa. Os formatos estão na skill `dash-numeros`.

Para gestão, KPIs e financeiro, consulte [tipos.md](references/tipos.md).

## 3. Olhe o dado real

Antes de prometer um indicador, confira com uma amostra e uma contagem, só lendo, que ele existe na fonte. Veja colunas, valores distintos, período coberto e totais. Se o acesso ainda não existe, registre "não testado" no plano. Os cuidados por tipo de fonte estão na skill `dash-dados`.

## 4. Adapte a stack só no que for preciso

A stack do `AGENTS.md` é o padrão. Cada necessidade muda uma peça, não o conjunto:

| Necessidade | O que muda |
|---|---|
| Dado interno ou por pessoa | Servidor com login e filtro no backend |
| Dado público e agregado, sem servidor | Site estático com arquivos de agregados |
| Só uma pessoa, na própria máquina | Publicação local |
| Mapa | Entra o MapLibre |
| Muitas linhas no detalhe | Paginação no servidor |
| Fonte lenta ou com limite de chamadas | Carga periódica no banco, em vez de consulta direta |
| Há banco disponível | Use-o; Postgres é o padrão suportado |
| Nenhum banco disponível | No mínimo SQLite, com os limites na skill `dash-dados` |
| Número quase em tempo real | Consulta direta à fonte, com a hora da leitura na tela |
| Fora da lista acima | Pergunta com opções e custo. Dependência nova só depois de discutir |

## 5. Apresente o plano

Use este modelo. Corte a seção que não se aplica, e escreva o plano para quem não programa.

```markdown
# Plano: <nome do dashboard>

## Contexto e o que já foi testado
<O pedido em duas linhas. O que foi conferido, com o resultado.>

## Decisões já fechadas
<O que o usuário decidiu, com data.>

## Indicadores
<Dicionário de indicadores.>

## Contrato de dados
<Como na skill `dash-dados`, para cada fonte.>

## Telas
<Abertura, visão geral e detalhe. Em cada tela: cartões, gráficos e tabelas, com a pergunta que respondem.>

## Passos e arquivos
<Passos numerados, com os arquivos que mudam, inclusive documentação e memória.>

## Escolhas técnicas
<O que foi escolhido e por quê, em linguagem simples.>

## Fica de fora
<O que não será feito e o que não muda.>

## Riscos, custo e como desfazer
<Risco com nível, tempo e chamadas estimados, efeito colateral e como reverter cada ação destrutiva.>

## Verificação
<Como será provado: totais que vão bater, testes e o que será visto na tela.>
```

## 6. Pare e espere

Apresente o plano e aguarde a aprovação. Ela vale exatamente para o que está escrito. Registre a data e as decisões, no arquivo listado no plano. Se o escopo mudar depois, faça um novo plano em vez de seguir improvisando.
