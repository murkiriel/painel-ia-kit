# painel-ia-kit: decisões

Kit público para criar dashboards com agentes de IA: system prompt, skills em Markdown, modelo de código e um exemplo que roda.

Este arquivo guarda as decisões, o que foi provado e o que ficou sem prova.

## Produto

| Tema | Decisão |
|---|---|
| Nome | `painel-ia-kit`, livre no GitHub e no npm. O pacote do modelo é `painel-ia-kit-modelo` |
| Público | Qualquer pessoa. O kit é genérico e não cita empresas nem sistemas internos |
| Idioma | Português |
| Ferramentas de IA | Claude Code, com `AGENTS.md` para outras ferramentas lerem as mesmas regras |
| Entrega | System prompt, skills, modelo de código e dashboard de exemplo |
| Tipos de dashboard | Gestão e KPIs; financeiro |
| Licença | MIT, no arquivo `LICENSE` da raiz. O que vem de terceiros leva o aviso em `THIRD_PARTY_NOTICES.md`: os contornos do IBGE, as licenças das bibliotecas que o site gerado embute e o texto da licença BSD de 3 cláusulas do MapLibre, cujo aviso acompanha o que for distribuído |
| Dados do exemplo | Não entram no repositório. Quem usa baixa do IBGE na própria máquina, com a fonte citada na tela |
| Dashboards de projetos | Ficam fora do kit, em pasta própria e com git próprio. O kit só traz o modelo |

## Stack

| Camada | Escolha |
|---|---|
| Tela | React, TypeScript e Vite |
| Gráficos | ECharts |
| Tabelas | AG Grid |
| Mapas | MapLibre, quando o projeto precisar, só com contornos guardados no projeto. Mapas não são foco da primeira versão |
| Backend | Node, sem framework e sem etapa de compilação |
| Banco | Sempre que der, um banco: o disponível primeiro; Postgres é o padrão suportado; sem nenhum disponível, no mínimo SQLite. Em desenvolvimento, `embedded-postgres` dentro da pasta do projeto, sem instalar nada no sistema. O `modelo/` roda nos dois, escolhido no `.env` |
| Fontes de dados | Planilhas e CSV; bancos SQL; APIs REST |
| Publicação | Servidor com login, que é o portal do projeto; site estático com agregados, por dashboard; local na própria máquina |
| Dependências | Nada fora da stack, como o Playwright, entra no kit |

Cada modo de publicação define o que pode ir para o navegador. Dado interno exige servidor com login.

## Dashboards

- **Interações padrão:** filtros globais salvos na URL, filtro cruzado e detalhamento até a linha de origem. Em site estático público, com totais pré-calculados e detalhe até o menor agregado publicado.
- **Telas:** pensados para computador, com leitura clara no celular.
- **Visual:** tema neutro e sóbrio, com cores e fontes em tokens, fácil de trocar pela marca de cada empresa. Espaço pequeno e uniforme entre os blocos.
- **Números:** todo valor na tela; só em gráfico denso, onde o rótulo não cabe, a dica do mouse basta. Valor em R$ sempre resumido, como `R$ 604 K` e `R$ 3,40 M`, com 2 casas em M, B e T, e nenhuma em K, com o exato na dica do mouse e na conferência. Preço unitário, quantidade e área não são resumidos. Donut com o total no centro.
- **Peso:** em quilos, nunca convertido para toneladas para encurtar, em cartão, gráfico, tabela e resposta do agente. Se a fonte publica em outra unidade, ela fica como veio.
- **Abertura:** no período mais recente. Sem período escolhido, a área fica como `—`.
- **Gráfico por ano:** mostra todos os anos e destaca o escolhido.
- **Eixo de meses:** só com o mês. A base de cada ponto vai para a dica do mouse.
- **Valores das regiões:** dentro de cada faixa da coluna, quando couber.
- **Legenda:** clicar filtra, como clicar em um item. É um botão fora do gráfico, para o teclado alcançar. Continua sem ocultar série.
- **Filtros:** todos numa linha só e completos onde se aplicam. Filtro que pegaria só parte da tela engana; esse caso vai para o usuário decidir.
- **"Todos" nunca em destaque:** a caixa de filtro só fica azul quando o filtro restringe algo. Na caixa, a opção "Todos" tem valor vazio.
- **Abas:** com cara de botão. O 1º nível é preenchido e o 2º tem contorno.
- **Texto dentro de barra colorida:** branco em negrito, com a cor um tom mais escuro se preciso para ler (por exemplo, um verde claro passou de #29B866 a #1E8449 no preenchimento).
- **Dica do mapa:** só com o valor exato. O resumido repetia o mesmo número com menos casas ("57%" e "56,5%").
- **Laser para apresentar:** botão "Laser" no cabeçalho do portal e dos dashboards. Ligado, o ponteiro vira um ponto vermelho em todas as telas. A escolha fica no `localStorage`, com try/catch: sem ele, vale até fechar a página. Está em `modelo/web/src/laser.ts` e `components/LaserToggle.tsx`.
- **Ajuda:** o ícone de explicação é "i", nunca "?".
- **Uso real:** todo dashboard passa por uso real no navegador antes da entrega. Passar nos testes não basta: o teste do piloto no navegador achou 31 problemas depois de tudo verde, todos corrigidos.

## Módulo de agente (opcional)

- **Consultas:** usa consultas pré-aprovadas como ferramentas, em vez de escrever SQL livre.
- **Respostas:** respeita os filtros da tela, mostra de onde veio cada número (indicador, período e filtros, sem sistema, API, SQL ou caminho de arquivo) e recusa o que as ferramentas não cobrem.
- **Permissões:** nunca altera dados.
- **Tela:** botão flutuante no canto inferior direito, que abre uma janelinha de chat.
- **Modelo:** configurável, com a API do Claude como padrão. Cada projeto decide quais dados podem sair.
- **Por dashboard:** o provedor é configurado uma vez por projeto, no `.env`. Cada dashboard diz no cartão se tem agente, e só esses mostram o botão e aceitam a rota. O agente usa só as ferramentas do dashboard dele, com a permissão de quem pergunta.
- **Assinatura:** o agente também roda pela assinatura, com `claude -p`, sem chave de API. Com login, só se os usuários forem o dono dela. É a forma padrão de testar na própria máquina. O executável roda sem ferramentas, e um teste trava isso. Um arquivo do agente tem exceção nomeada na trava que proíbe processo externo. O executável também pode estar no PATH, o login é conferido ao subir e um disjuntor avisa a pessoa (limite, login, falhas seguidas). Está em `modelo/server/agent/subscriptionModel.ts`, com testes.
- **Chave de API:** `.env` só para testar na própria máquina, com uma chave dedicada e limite de gasto. Em produção, cofre de segredos ou variáveis protegidas do servidor.

Provado:

- **Pela assinatura:** o conjunto de 10 perguntas da skill `dash-agente` deu 10 de 10, conferidas à mão contra a API, e uma pergunta real pelo chat com o login ligado.
- **Pela API:** o adaptador foi provado num projeto feito a partir do modelo.
- **Com modelo simulado:** um dashboard com agente e outro sem, no exemplo pequeno. Quebrar a regra reprova.
- **Dados separados:** o agente de um dashboard só vê os dados dele.

Sem prova: o agente com modelo real perguntando por mês.

## Método de trabalho

- **Plano antes:** o agente investiga, tira dúvidas e apresenta um plano. Só constrói depois da aprovação. A escolha técnica vem pronta no plano; regra de negócio é do usuário.
- **Arquivos:** o plano autoriza só os arquivos listados, inclusive documentação e memória do agente.
- **Ajustes viram regra:** o que o usuário pede ao ver o dashboard entra no `AGENTS.md`, nas skills e no modelo, e substitui a regra anterior.
- **Commit:** ao fim de cada tarefa concluída; push e publicação só com ok do usuário.
- **Pesquisa:** sem perguntar, só a documentação oficial da stack e das APIs em uso.
- **Respostas:** curtas; parecer e levantamento longos vão para arquivo, com o resumo na conversa.
- **Rotinas:** carga ou envio automático é código separado do agente do dashboard, aprovado no plano, com um único ponto de envio.
- **Números:** um dashboard só está correto quando os totais batem com a fonte, há testes automáticos e um revisor independente, sem as conclusões do autor, refaz as contas.
- **Duas conferências:** painel contra a fonte exige 0 divergências. Fonte contra outra publicação é nomeada, e o usuário decide.
- **Revisão:** número mudou, o revisor reconfere. Só texto mudou, o autor confere e avisa. Não se fecha entrega com revisão em aberto.
- **Provas de tela:** em navegador invisível. Nenhum processo de prova abre janela.
- **Baterias de tela:** ficam fora do repositório. O `npm test` cobre regras e servidor. Cada projeto monta a sua bateria de tela a partir da skill `dash-validar`.
- **Conteúdo de referência:** o material de referência é próprio ou está sob licença MIT, e pode ser reaproveitado. O que vier de terceiros mantém o aviso de autoria em `THIRD_PARTY_NOTICES.md`. Tudo é adaptado à stack e ao método do kit, sem instruções ligadas a outra plataforma.

Provado: um agente novo construiu um painel com o CSV público de arrecadação da Receita só com as regras e as skills. A divergência entre o arquivo e as publicações da Receita foi aceita como diferença da fonte.

## Portal

| Tema | Decisão |
|---|---|
| Portal | Todo projeto tem um portal: a página de login, com o primeiro acesso pelo navegador, e um painel com um cartão para cada dashboard, mesmo com um só. Dashboard novo entra no mesmo portal, com o mesmo login |
| Projeto | Um servidor e um banco por projeto. Cada dashboard em uma pasta própria, com endereço (`/d/<slug>`) e API (`/api/d/<slug>/...`) próprios |
| Cartão | Nome, uma frase do que o dashboard responde, fonte, data da última atualização, se tem agente e uma miniatura |
| Miniatura | Foto real da tela, tirada depois de cada carga com o navegador já instalado, em modo invisível, sem instalar dependência. Só é servida a quem tem acesso ao dashboard, depois do login. Sem navegador, o cartão fica sem imagem |
| Acesso | O administrador escolhe, na tela de administração do portal, quais dashboards cada pessoa vê e, nos que têm recorte (UF, fazenda, unidade), quais itens dele: criar pessoa com senha provisória, marcar, tirar acesso, desativar, redefinir senha. A senha provisória obriga a troca. O administrador vê tudo. Dashboard sem acesso responde como um que não existe |
| Recorte | O recorte de acesso é opcional e tem nome próprio, declarado no dashboard (`scope`, com o nome do item no singular e no plural, o gênero e a lista de itens com código e nome). A tela e as mensagens usam esse nome ("Todas as fazendas", "Escolha ao menos um talhão."). Dashboard sem recorte tem só acesso "com" ou "sem", e as consultas dele recebem sempre a lista vazia: uma consulta que filtrasse por ela por engano não traria nada, e nada vazaria. Uma regra só de permissão decide o que cada pessoa vê (`grantedScope`): a lista parcial sai sem repetidos e só com códigos conhecidos, permissão vazia nunca vira acesso a tudo, e a linha parcial de um dashboard sem recorte não dá acesso. O servidor não sobe com `states` antigo, recorte sem itens, código repetido ou vazio, ou nome do recorte incompleto. As colunas do banco continuam com o nome antigo, e um comentário no SQL explica |
| Nome | O login, o primeiro acesso, a troca de senha, o título da aba e o manifesto usam o nome do projeto. O nome de um dashboard só aparece dentro dele e no cartão |
| Dados | Cada dashboard tem schema próprio no Postgres e arquivo próprio no SQLite, e usuários de banco de leitura e de carga só com permissão nele. A área comum guarda só o portal. Nenhuma tabela é compartilhada. Ler dados de dois dashboards só no futuro, declarado de forma explícita no dashboard que consome, com a permissão correspondente e documentado: o lugar está previsto, e nada foi implementado |
| Primeiro login | Criado pelo navegador no primeiro acesso, só de dentro do computador do dashboard, sem código de instalação. Enquanto não houver usuário, o servidor só escuta na própria máquina, qualquer que seja o `HOST`. Depois, ao reiniciar, abre no `HOST` configurado, e sem HTTPS a senha trafega sem criptografia |
| Provas com outra fonte | A prova do mês, que usa um CSV mensal de outra fonte, é ferramenta do kit, fora de qualquer dashboard |
| Escolha técnica | Sem camada de abstração além do necessário: um objeto de descrição por dashboard (`dashboard.ts`), uma lista no servidor e outra na tela. Na tela, uma aplicação só, com a tela de cada dashboard carregada sob demanda |

Provado:

- **Portal:** 26 testes com dois dashboards de exemplo escritos à mão, sem dado real nem rede, em SQLite: cartões só dos dashboards permitidos, recusa byte a byte igual à de um dashboard inexistente (dados, informações, agente e miniatura), limite por UF chegando à consulta, administração só para o administrador e com CSRF, senha provisória só em hash e obrigando a troca, desativar, reativar e redefinir, primeiro acesso como antes. Oito travas quebradas de propósito, uma de cada vez, reprovaram o teste.
- **Dados separados:** `test/isolation.test.ts`, nos dois motores: a leitura de um dashboard é recusada pelo banco ao ler o schema ou o arquivo de outro, a carga de um não grava no outro, e uma varredura confirma que as consultas só citam o schema do próprio dashboard. Dar ao leitor de um dashboard permissão no schema de outro reprova os testes.
- **Nome do projeto:** `test/project-name.test.ts` reprova se o nome ou o endereço de um dashboard aparecer no login, no título, nas mensagens do servidor ou na administração.
- **Mesmos números:** o dashboard do IBGE bate com a fonte, e `npm run check:engines` deu 0 diferenças entre Postgres e SQLite.
- **Uso real:** no navegador invisível, em 1366 e 390 pixels, login, painel, cartões, miniaturas, administração e as permissões por dashboard e por UF, com recusa igual à de um dashboard inexistente.
- **Recorte opcional:** `test/scope.test.ts`, os dashboards de exemplo sem recorte e com nomes de recorte masculino e feminino, a linha parcial de um dashboard sem recorte e o mesmo código repetido. `npm run check:login` em Postgres e em SQLite, `npm run dash -- check-login` e `npm run check:security` sem diferença, e a administração em navegador invisível, em 1366 e 390 pixels. Com a trava de isolamento quebrada de propósito, `npm test` reprova. Sem o tratamento dos repetidos, 3 testes reprovam; sem a regra "só o acesso total vale sem recorte", 3 testes reprovam.
- **Primeiro login:** em Postgres e em SQLite. Um revisor independente achou 2 defeitos graves: a rede criando o dono atrás de proxy e o usuário de login virando superusuário pela função do banco. Depois da correção, os ataques repetidos não passaram.

Sem prova:

- A miniatura em outro navegador além do Edge.
- Uma instalação com HTTPS.
- Uso por muitas pessoas ao mesmo tempo.
- Um proxy na própria máquina que não se identifique não dá para detectar.
- A última rodada de ajustes menores do primeiro login foi conferida pelo autor, com os testes e as baterias, sem nova passada do revisor.

## Piloto

- **Fonte:** produção agrícola do IBGE, por API oficial. O site do CEPEA bloqueia robôs e agentes de IA, e por isso não é fonte.
- **Modelo e exemplo:** um projeto só, em `modelo/`, com o que é do exemplo em pastas próprias, para não duplicar código.
- **Quantidade:** só aparece com uma lavoura escolhida. A fonte não publica o total em toneladas, e a soma engana: em 2024, 66,9% dela é cana.
- **Abacaxi e coco-da-baía:** marcados como "unidade a verificar", porque a nota da fonte não pôde ser lida.
- **2025:** a fonte traz 14 lavouras novas e tira 7. A tela avisa que a variação não compara a mesma lista.

Provado: a stack, com dados públicos do agro (produção agrícola do IBGE), em modo local e em servidor com login.

Sem prova: a nota da tabela 5457 no site do SIDRA, que decide a unidade do abacaxi e do coco-da-baía.

## Mês

- **Dimensão opcional:** desligada no exemplo, que é anual, e ligada com `MONTH_FILTER=on`.
- **Mês sem ano:** é recusado, mesmo sem `ano` na URL, para o link não mudar de sentido quando entra um ano novo.

Provado:

- `npm run check:month` compara a API com a soma feita direto no CSV mensal da Receita, com 0 divergências, em um esquema temporário.
- A tela foi usada no navegador com o mês ligado.
- Com login, o mês foi provado pela API, com permissão limitada e vazia.

Sem prova: o mês com login na tela; o agente com modelo real perguntando por mês.

## SQLite

- **Escolha:** `DB_ENGINE=sqlite` no `.env` escolhe um arquivo em `.data`, com `node:sqlite`, sem dependência nova, sem `embedded-postgres` e sem porta. O Postgres continua o padrão.
- **Mesmas telas:** as mesmas telas e conferências rodam nos dois motores, com agente e login.
- **Erros:** motor desconhecido impede o servidor de subir. Arquivo ausente ou sem tabelas vira mensagem em português, e a tela funciona depois da carga, sem reiniciar.
- **Números iguais:** dinheiro, quantidade e área em inteiro, com a escala da coluna em `numeric_scale`. Soma em `BigInt`, sem o limite de 64 bits. Participação e variação refazem em `BigInt` a divisão do `NUMERIC`, com a mesma escala do resultado e o mesmo arredondamento. Ordem em português por `Intl.Collator`, já que o `node:sqlite` não deixa criar uma ordem própria.
- **Segurança:** sem usuários de banco, a separação de `002_grants.sql` vira listas de permissão por conexão. A leitura abre com `readOnly` e `query_only`, e cada trava segura sozinha, em teste. Quem abre o arquivo com outro programa passa por cima: a pasta precisa ser protegida, e isso está no README e nas skills.
- **Duas diferenças aceitas:** com `NUMERIC` sem limite, o Postgres guarda as casas de cada linha, e o SQLite tem uma escala por coluna: `1234.5` e `1234.5000`. O número é o mesmo, e a tela também. Com `NUMERIC(20,4)`, o texto é igual. E um login com o caractere nulo responde 500 no Postgres, que recusa esse byte, e 401 no SQLite. Nos dois, ninguém entra.
- **Ordem no Postgres:** a ordem das UFs desempata pelo código, a das regiões pelo nome, e as listas de nomes da permissão têm `ORDER BY`. Sem isso, itens com o mesmo valor saíam na ordem que o plano da consulta desse, e dois motores nunca bateriam. Nenhum número muda.
- **`npm run check`:** recusa o dashboard sem dados, em vez de dizer "0 divergências" sem comparar nada.
- **Limites de uso:** bloqueia o processo durante cada consulta, sem limite de tempo, e atende bem uma máquina, com um escritor por vez. Tempos no README.

Provado:

- **Números iguais:** as divisões do `NUMERIC` em `BigInt` foram conferidas contra o próprio Postgres em 10 mil divisões sorteadas.
- **Os dois motores:** `npm run check:engines` compara, byte a byte, 19.951 respostas da API e consultas com permissão limitada, em três conjuntos: o exemplo, um mês derivado dele, com 4 casas e lacunas, e o CSV mensal da Receita. 0 diferenças. Com `--sabotar`, 1 centavo a mais reprova. Quebrar de propósito as contas, a ordem e as travas reprova: 17 mudanças, 17 reprovadas.
- **Segurança:** o hash do arquivo não muda depois das tentativas de escrita.
- **Desempenho:** com 233 mil linhas, a consulta mais pesada leva 0,7 s.
- **Uso no navegador:** as mesmas baterias rodaram nos dois motores, com os mesmos resultados.

Sem prova:

- A carga com a rede de verdade, em SQLite: rodou com o mesmo código e as respostas refeitas do Postgres, para não consultar o IBGE à toa.
- Outro Node além do 26.13, outro sistema além do Windows, e uso por muitas pessoas ao mesmo tempo.
- A bateria do mês, que espera 0,5 s depois de cada clique, vê o título anterior em 3 a 5 de 112 verificações, conforme a rodada. Com 2,5 s de espera, passa em todas.
- Duas verificações da bateria dos 31 achados, sobre o seletor pelo teclado, reprovam igual nos dois motores: ela espera 4 seletores, e o mapa trouxe o quinto. Não é defeito do dashboard.

## Site estático

- **Geração:** `npm run build:static` lê o banco do `.env` e gera em `dist-static`, ignorada pelo git, a mesma tela, com cada resposta pré-calculada pelas rotas do modelo. Tamanho no exemplo: 85.701 arquivos e 124,3 MB, para um limite de 100 mil arquivos e 200 MB.
- **Só dado público:** com `AUTH_MODE=login`, com o mês ligado ou com carga falha, ele recusa, e o site anterior fica como está.
- **Fora do site:** UF com lavoura como filtro, porque esses 1.145 pares em 12 períodos levariam o site a cerca de 250 mil arquivos e 360 MB, em uma estimativa. Também a outra ordem da tabela com lavoura e região juntas, e, em outra ordem, as páginas depois da primeira. Decisão técnica, reversível em `shared/staticSite.ts`. O controle que levaria a isso fica desligado, e a tela diz por quê. O número de cada UF na lavoura continua à vista no mapa, no gráfico e na tabela.
- **Menor agregado:** uma linha por ano, UF e lavoura. No exemplo, ele é a própria linha tratada, que já é um total publicado pela fonte, e a tela o chama assim, em vez de "linhas de origem". A camada bruta da carga, os totais da conferência e o registro das cargas não saem.
- **Ordenar:** a tabela ordena no recorte publicado, com arquivo próprio para cada coluna e sentido, na primeira página. Coluna só com `—` e tabela de uma linha não ordenam. A seta sempre diz a ordem que vale.
- **Nenhum clique leva a um número errado:** o nome do arquivo é o texto da consulta, sem arquivo a tela avisa, e cada arquivo foi comparado.
- **Fora do site, por não existirem nele:** o agente, a Conferência e a combinação de UF com lavoura.

Provado:

- **Arquivos:** `npm run check:static` comparou com a API, pela rede, todos os 85.693 arquivos de dados, byte a byte, mais 3.711 leituras por outro nome e 79 recusas de link inválido, com 0 diferenças. Com `-- --sabotar`, e com 1 byte trocado no disco, reprova.
- **Totais:** os totais do site batem com os do IBGE guardados pela carga, em 1.650 comparações, sem consultar a fonte de novo.
- **Dois motores:** gerado a partir de um SQLite com os mesmos dados, os 85.693 arquivos são iguais aos do Postgres, e a mesma conferência dá 0 diferenças contra um servidor em SQLite.
- **Todos os cliques:** `check:static` segue todos os cliques possíveis a partir da abertura, com as funções da tela: 146.410 endereços, 12,4 milhões de cliques e 0 blocos sem arquivo. Sem os controles desligados, essa prova reprova, e `npm test` mostra isso.
- **Tela:** no Edge, com um servidor de arquivos simples, em subpasta, e a porta 8787 bloqueada, em 1920, 1366, 800 e 390 pixels: 591 verificações, com 53 links diretos em cada largura e 208 passos ao acaso comparados à tela do servidor, nos cartões, títulos, seletores, legenda, rótulos do mapa e linhas da tabela. Incluem legenda, mapa, colunas, barras, donut, seletores, cabeçalhos, páginas, recarregar, Voltar, link fora do publicado, arquivo ausente e resposta inválida. Nenhum pedido foi à 8787 nem para fora. As baterias anteriores, adaptadas, deram 273 de 273. No modo com servidor, as mesmas baterias, sem alteração, deram 327 de 327.

Sem prova:

- Hospedagem de verdade, que pode tratar diferente um arquivo com `&` e `=` no nome ou devolver a tela no lugar de um arquivo ausente, caso em que o bloco avisa que o arquivo está ilegível.
- Outro navegador além do Edge, celular físico e placa de vídeo real.
- O navegador sobre o site gerado em SQLite, porque os arquivos de dados são iguais.
- O número desenhado dentro dos gráficos não foi lido na tela: ele vem da mesma resposta comparada byte a byte.

## Mapa

- **Biblioteca:** MapLibre GL 6.16.0 só com os contornos das UFs, da malha pública do IBGE guardada no projeto, sem serviço externo.
- **Clique:** clicar em um estado filtra os outros blocos, com seleção própria do bloco.
- **Contornos:** `modelo/dashboards/producao-agricola/web/ufs.geo.json`, da API de malhas do IBGE (`servicodados.ibge.gov.br`, `v3/malhas/paises/BR`, divisão por UF, qualidade mínima), com siglas e nomes de `v1/localidades/estados`. Baixados por `npm run outlines`. O script só arredonda as coordenadas e guarda a origem no próprio arquivo.
- **Acesso à fonte:** o `robots.txt` de `servicodados.ibge.gov.br` não respondeu em 3 tentativas, de até 60 segundos cada, sem recusa. O de `www.ibge.gov.br` respondeu, e não trata da API. A API de malhas é documentada para consulta automática e respondeu a um pedido identificado, sem se passar por navegador. As páginas de termos tentadas no portal devolveram 403, e não se insistiu.
- **Faixas de cor:** com um número parecido de UFs em cada uma, porque poucos valores muito grandes deixariam quase todo o mapa na mesma cor. Decisão técnica, reversível em `colorScale`.
- **Celular:** com menos de 480 pixels de mapa, o rótulo não sai da própria UF, porque cairia sobre outra e pareceria ser dela. Parte das UFs fica só com a sigla ou sem rótulo, com o valor no toque e no gráfico por UF.
- **Troca rápida de aba:** erro de mapa que já saiu da tela é ignorado, a criação tenta de novo e o contexto gráfico perdido tem 3 s para voltar antes do aviso de falha.

Provado: no navegador, nenhuma requisição saiu do próprio servidor, com a rede externa cortada. Cada uma das 27 UFs foi clicada em 4 larguras, conferindo a URL e os cartões com a API. Zero e valor nulo foram provados com resposta simulada, porque nenhum recorte real tem esses casos.

Sem prova: celular físico, outro navegador além do Edge e placa de vídeo real, porque o teste usou o WebGL por software.
