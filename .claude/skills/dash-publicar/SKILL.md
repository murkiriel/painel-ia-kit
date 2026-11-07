---
name: dash-publicar
description: Prepara a publicação de um dashboard em servidor com login, site estático com agregados ou uso local, decidindo o que pode ir para o navegador e varrendo segredos e dados pessoais. Use sempre que o usuário falar em publicar, colocar no ar, hospedar, compartilhar, login, permissões, implantar ou tornar um dashboard ou repositório público.
---

# Publicar um dashboard

Publicar é a parte mais difícil de desfazer: um dado que saiu pode ter sido copiado ou indexado. Cada publicação exige confirmação específica, mesmo com um plano aprovado. Explique antes para onde vai, quem passa a ver e como desfazer.

## Escolha o modo

| Modo | Quando usar | O que vai para o navegador |
|---|---|---|
| **Servidor com login** | Dado interno, ou cada pessoa vê uma parte. Obrigatório para dado interno | Só o que aquele usuário pode ver, a cada consulta |
| **Site estático** | Dado que pode ser público, sem servidor | **Tudo**: arquivos de dados inteiros, que qualquer um pode baixar |
| **Local** | Uma pessoa, na própria máquina | Nada sai dela, se o servidor escutar só o endereço local |

Regra simples: num site estático, todo arquivo publicado é público, mesmo que nenhuma tela o mostre. Esconder uma coluna na tela não protege o dado. Em dúvida se o dado é interno, ele é interno.

## Portal

O servidor com login é o portal do projeto: a página de login, o painel com os cartões, a administração e a API de cada dashboard (`/api/d/<slug>/...`). O portal não tem versão estática. O site estático de um dashboard continua existindo, por dashboard, só para dado público, e leva só a tela e os arquivos dele.

- **Acesso:** o administrador escolhe quais dashboards cada pessoa vê e, nos que têm recorte (UF, fazenda, unidade), quais itens dele. Sem acesso, o dashboard responde como se não existisse.
- **Miniatura:** gerada depois de cada carga (`npm run thumbnail`) com o navegador da máquina, em modo invisível, e guardada fora do repositório. Ela mostra dados: só é servida a quem tem acesso ao dashboard.
- **Agente:** um provedor por projeto, no `.env`. Cada dashboard declara no cartão se tem agente.
- **Categorias:** definidas na administração e gravadas no banco do portal. Num portal que já existia sem elas, rode `portal_upgrade_categories.sql` (ou o equivalente do SQLite) antes de subir o código novo, sem apagar pessoas nem acessos. A categoria é só um atalho de acesso: ela grava acesso por dashboard.
- **Dashboard novo:** entra no portal que já existe, com o mesmo login. Siga "Acrescentar um dashboard" no README do modelo, e confira de novo a varredura e as permissões abaixo.

## Servidor com login

**Sessão:**

- Senha com hash lento e sal (`scrypt` já vem no Node), comparada em tempo constante.
- Sessão com token aleatório em cookie `httpOnly`, `SameSite=Lax` e `Secure`. Nunca em `localStorage`, onde qualquer script consegue ler.
- Sessão com validade, guardada no banco e removida ao sair.
- Token CSRF por sessão, exigido em toda rota de escrita.
- Mesmo tempo de resposta para usuário inexistente e senha errada, com limite de tentativas por usuário e outro, maior, por endereço. Só por endereço, um proxy bloquearia a equipe inteira. Login longo demais é recusado antes, e o contador não cresce sem limite.
- Modo de acesso desconhecido impede o servidor de subir. Um erro de digitação nunca abre o acesso.
- Primeiro login criado pelo navegador, no primeiro acesso, só de dentro do próprio computador do dashboard. Pela rede, nunca: quem chegasse primeiro viraria dono do painel. Enquanto não houver usuário, o servidor só escuta na própria máquina, qualquer que seja o `HOST`. Sem proxy na frente antes disso, e sem cadastro aberto.

**Permissões:**

- O filtro por perfil ou unidade fica no backend e vem da sessão, nunca de parâmetro da URL.
- O teste de permissão tenta acessar o dado de outro usuário e precisa falhar.
- Toda rota de dados exige sessão. Teste cada uma sem estar logado.

**Banco e segredos:**

- Cada dashboard tem o próprio schema (ou arquivo) e os próprios usuários de banco, de leitura e de carga, só com permissão nele. Uma consulta errada de um dashboard não lê o outro, porque o banco recusa. O portal (pessoas, sessões e acessos) tem o schema dele, com usuários próprios para o login e para a administração, que não enxergam os dados dos dashboards.
- A carga de cada dashboard usa o usuário dele, com permissão só nas tabelas dele.
- **SQLite não tem usuários:** a leitura abre com `readOnly`, e cada conexão tem uma lista de permissões, provada por `npm run check:security`. Quem abre o arquivo com outro programa passa por cima: proteja a pasta e diga isso no plano. Ele bloqueia o processo durante cada consulta e atende uma máquina: servidor com muitos usuários pede Postgres.
- Segredos em variável de ambiente, fora do repositório. Nunca copie, imprima ou registre o valor; o projeto traz só um `.env.example` sem valores.
- Erro para o usuário não revela SQL, caminho nem detalhe interno. Endereço malformado responde 400, sem derrubar o servidor.
- Logs sem senha, token nem dado pessoal desnecessário.

## Memória do servidor (VPS)

Servidor pequeno tem limite de memória, e o processo do portal precisa caber nele com folga. Num serviço com `MemoryMax=150M`, por exemplo, o portal já usa de 63 a 126 MB, e o agente com memória de conversa guarda texto livre das pessoas no próprio processo.

- **Meça antes de publicar:** o uso do processo do portal parado e depois de uma sessão com várias perguntas, e compare com o limite. Sem folga, diminua os tetos ou aumente o limite.
- **Tetos da conversa, no `.env`:** `AGENT_MEMORY_TURNS` (trocas por conversa), `AGENT_MEMORY_IDLE_MINUTES` (tempo sem uso), `AGENT_MEMORY_MAX_CONVERSATIONS` (conversas guardadas ao mesmo tempo) e `AGENT_MEMORY_MAX_CHARS` (caracteres por conversa). O pior caso é o teto de conversas vezes o de caracteres: com 200 e 20 mil, são uns 4 milhões de caracteres, na casa de 8 MB. Valor inválido impede o servidor de subir.
- **Reiniciar o serviço apaga todas as conversas:** a memória não vai para o banco, e isso é intencional. Avise quem usa.
- **Agente pela assinatura** é individual: com login, só se os usuários forem o dono dela. Para outras pessoas, a API.

## Site estático

- **Só agregados.** Gere os arquivos com as colunas que as telas usam, e nada de linha individual.
- **Interações pré-calculadas.** Filtro cruzado e detalhamento usam totais prontos para as combinações previstas no plano. O detalhe vai até o menor agregado publicado, e a tela avisa que as linhas não são públicas. Veja a skill `dash-interacoes`.
- **Meça antes de gerar.** Conte as combinações de filtros, páginas e ordens, e defina um limite de arquivos e de tamanho. O que não couber fica de fora, dito no plano e na tela: controle desligado ou mensagem, nunca número vazio ou zero. O [modelo](../../../modelo/README.md#site-estático) traz o gerador pronto, `npm run build:static`, com a tabela do que entrou e do que ficou de fora.
- **Cada arquivo é a resposta da API.** O nome sai do texto da consulta, e `npm run check:static` compara byte a byte. Sem arquivo para a consulta, a tela avisa, em vez de mostrar outro número.
- **Diga a data.** Sem consulta ao vivo, a tela diz de quando são os dados.
- **Agregado pode revelar pessoa:** um grupo com um único registro mostra o valor daquele registro. Defina um tamanho mínimo de grupo quando houver dado pessoal.
- **Sem agente nem chave no site:** chave no navegador é chave pública.
- **Sem conferência no site:** o relatório de conferência fica fora do que é publicado.
- **Fonte permite?** Confirme que a licença da fonte permite publicar os dados.
- **Confira o que saiu:** abra a pasta gerada e leia a lista de arquivos e colunas. Não confie na configuração. A varredura do modelo reprova segredo, caminho local, SQL, conexão de banco e coluna que a tela não usa, mas não substitui essa leitura.
- **Falha na carga não publica:** mantenha o site anterior no ar e avise.

## Varredura antes de publicar

Varra os arquivos que serão publicados e, em repositório público, também o histórico de commits e os autores. O que entrou no histórico continua lá, mesmo depois de apagado do arquivo.

| O que procurar | Exemplos |
|---|---|
| Segredos | Senhas, tokens, chaves, `.env`, conexão com senha, chaves em histórico de commits |
| Dados pessoais | Nome de pessoa, CPF, e-mail, telefone, e-mail pessoal do autor do commit |
| Dados internos | Nome de empresa, sistema, servidor, caminho de arquivo, IP, tabela interna |
| Dados reais em exemplos | Planilhas, capturas de tela, testes e metadados de arquivos |
| Lixo | Mapas de código desnecessários, arquivos temporários, logs, `node_modules` |

Informe o que encontrou sem reproduzir o valor do segredo. Um segredo já publicado precisa ser trocado, porque apagá-lo não basta. Decisão de publicar com qualquer achado é do usuário.

## Roteiro

**1. Apresente:**

```markdown
**Publicar:** <o quê>
**Onde:** <endereço e modo>
**Quem passa a ver:** <público>
**Dados que saem:** <campos e nível de agregação>
**Dados que vão a terceiros:** <provedor de IA, hospedagem, ou nenhum>
**Varredura:** <resultado>
**Validação:** <resultado da skill dash-validar>
**Como desfazer:** <o que dá para reverter e o que não dá>
```

**2. Espere a confirmação específica** para esta publicação.

**3. Publique e confira no endereço final:**

- [ ] O dashboard abre e os números são os da validação.
- [ ] Sem login, nenhuma tela ou rota de dados responde (servidor com login).
- [ ] Não há arquivo além do previsto (site estático).
- [ ] A última atualização aparece, e a carga agendada rodou.
- [ ] O uso de memória do processo, depois de algumas perguntas ao agente, está dentro do limite do servidor (servidor com login e agente).

**4. Feche** com o endereço, o que foi publicado e a data. Sem o que confirmar, o trabalho não terminou.
