# painel-ia-kit

Kit para criar dashboards com agentes de IA, com o número certo na tela e sem dado inventado. Pensado para quem conhece o negócio e não necessariamente programa.

O agente investiga, faz perguntas e apresenta um plano. Só constrói depois da sua aprovação, e só entrega depois de conferir os números com a fonte.

## O que tem aqui

| Pasta ou arquivo | O que é |
|---|---|
| [AGENTS.md](AGENTS.md) | As regras do agente, lidas em toda conversa |
| [.claude/skills](.claude/skills) | O passo a passo de cada etapa: plano, dados, números, telas, interações, agente, validação e publicação |
| [modelo](modelo) | Projeto completo que roda, para copiar e adaptar: um portal (login, painel com um cartão por dashboard e administração de acessos) e um dashboard de exemplo, com dados públicos de produção agrícola do IBGE. Dashboard novo é uma pasta, no mesmo portal |
| [DECISOES.md](DECISOES.md) | As decisões do kit, o que foi provado e o que ficou sem prova |

## Como usar

1. Abra esta pasta no Claude Code. Outras ferramentas de IA podem ler o `AGENTS.md`.
2. Peça o dashboard com as suas palavras, como "quero um painel de vendas por região a partir desta planilha".
3. Responda às perguntas e aprove o plano.
4. Confira o resultado na tela.

Para ver o exemplo funcionando, instale o [Node](https://nodejs.org) 24 ou mais novo e siga o [README do modelo](modelo/README.md).

## Stack

React, TypeScript, Vite, ECharts e AG Grid na tela. Node e Postgres no servidor, ou SQLite quando não houver banco disponível. MapLibre quando precisar de mapa. Fontes: planilhas e CSV, bancos SQL e APIs REST. Publicação em servidor com login, site estático com agregados ou local.

Todo projeto tem um portal, e cada dashboard tem dados próprios, separados pelo banco. Os três modos foram provados no exemplo: local, servidor com login e site estático, este na própria máquina, sem publicar em lugar nenhum. O mapa usa MapLibre, só com contornos guardados no projeto, e abre sem internet. O exemplo roda em Postgres ou em SQLite, escolhido no `.env`, com as mesmas telas e os mesmos números. No primeiro acesso com login, a própria página cria o primeiro usuário, só de dentro da máquina do dashboard. O agente responde pela API do Claude, com chave, ou pela assinatura, sem chave, para quem é dono dela. O site estático é gerado por um comando e só serve para dado público: veja o que ele publica e o que fica de fora no [README do modelo](modelo/README.md#site-estático).

## Licença

O kit usa a licença MIT: veja o arquivo [LICENSE](LICENSE). Os avisos do que vem de terceiros, como os contornos do IBGE e as bibliotecas que o site gerado embute, estão em [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
