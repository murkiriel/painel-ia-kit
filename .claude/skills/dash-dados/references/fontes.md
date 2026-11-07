# Cuidados por tipo de fonte

## Planilhas e CSV

**Pergunte:**

- Quem envia o arquivo, e com que frequência?
- O arquivo novo substitui o anterior ou acumula? Se substitui, substitui tudo ou só uma parte, como um mês ou uma filial?
- A estrutura pode mudar? Alguém edita à mão?

**Confira:**

- Codificação (UTF-8 ou Latin-1) e separador (vírgula, ponto e vírgula ou tabulação).
- Número em formato brasileiro: `1.234,56` vira `1.234` ou `1,234` se for lido do jeito errado. Confira o total depois da leitura.
- Data como texto, ou como número de série do Excel.
- Linhas de título, subtotal e rodapé, que entram na soma se não forem retiradas.
- Abas e linhas ocultas, células mescladas e fórmulas com erro.

**Na carga:**

- Rejeite o arquivo inteiro quando faltar uma coluna obrigatória. Carga parcial parece correta e não é.
- Para substituir uma parte, apague e insira só aquela parte, na mesma transação.
- Guarde o nome e o hash do arquivo no log, para saber de onde veio cada carga.

## Bancos SQL

**Pergunte:**

- Qual é o banco, e como se chega nele?
- Existe usuário somente leitura? Se não existe, peça um. Não use usuário com permissão de escrita.
- Existe documentação das tabelas e consultas prontas?
- Há horário de pouco uso para consultas pesadas?

**Confira:**

- Teste cada consulta com um limite de linhas antes de usar, e mostre o resultado.
- Não invente consulta nem tabela. Sem certeza da estrutura, consulte o catálogo do banco ou peça a documentação.
- Compare a contagem da sua consulta com a de uma consulta sem junções. Junção pode duplicar ou perder linhas.
- Limite o tempo de consulta para não prejudicar o sistema de origem.

**Atualização incremental:**

- Existe coluna de alteração? Ela muda em toda edição ou só na criação? Tem índice?
- Sem coluna confiável, faça a carga completa, em horário de pouco uso.
- Releia uma pequena janela sobreposta a cada execução, para não perder registros gravados durante a carga.

**Registros excluídos na fonte:**

| Estratégia | Quando usar |
|---|---|
| Manter | Histórico que nunca deve sumir |
| Marcar como inativo | É preciso saber o que saiu e quando |
| Carga completa periódica | Tabela pequena ou média |
| Comparar chaves e remover ausentes | Tabela grande, sem carga completa viável |

Sem estratégia, o dashboard continua mostrando registros que não existem mais.

## APIs REST

**Pergunte:**

- Como é a autenticação, e quem fornece a credencial?
- Qual é o limite de chamadas?
- Como funciona a paginação, e qual é o máximo por página?
- A API tem ambiente de teste? Há custo por chamada?

**Confira, pois é aqui que moram os limites silenciosos:**

- Pedir mais que o máximo de uma página: dá erro ou corta sem avisar?
- Filtro por data: é aplicado de verdade? Compare com o resultado sem filtro.
- Página vazia no meio: é o fim ou uma falha? Compare com o total informado, quando houver.
- Mudança na ordem entre páginas pode repetir ou perder itens. Remova duplicatas pela chave e confira a contagem.
- Um mesmo acesso pode guardar estado por usuário, como a unidade selecionada. Nesse caso, faça uma coleta por vez.
- Consulta grande demais pode receber erro em vez de corte. Divida por período.

**Na carga:**

- Respeite o limite, com espera e novas tentativas, nunca em repetição imediata.
- Credencial só em variável de ambiente, nunca no código ou no log.
- Coleta interrompida é falha: não publique o dado parcial.
