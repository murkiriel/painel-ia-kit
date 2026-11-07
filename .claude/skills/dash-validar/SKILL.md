---
name: dash-validar
description: Prova que os números do dashboard estão certos antes de entregar, com conferência contra a fonte, testes automáticos, revisor independente e verificação na tela. Use sempre antes de dizer que um dashboard ou indicador está pronto, depois de corrigir um número, e quando alguém perguntar se os dados batem.
---

# Validar antes de entregar

Compilar não prova nada sobre o número. Quem escreveu a consulta tende a repetir o próprio erro ao conferi-la, por isso a revisão independente é obrigatória.

Só diga "pronto" depois das cinco etapas. Se uma não pôde ser feita, diga qual e por quê.

## 1. Conferência com a fonte

Compare cada indicador do dicionário com um cálculo feito direto na fonte, sem usar o código do dashboard.

| Indicador | Recorte | Fonte | Dashboard | Diferença | Situação |
|---|---|---|---|---|---|
| Faturamento (R$) | out/26 | 1.234.567,89 | 1.234.567,89 | 0,00 | OK |
| Notas (qtd) | out/26 | 1.204 | 1.198 | -6 | DIVERGE |

- Só entregue com 0 divergências entre o painel e a fonte. Com divergência, a situação é "não pronto", mesmo que a causa seja conhecida.
- **Fonte contra outra publicação é outra conferência.** O painel pode estar certo e o arquivo divergir de outro documento da mesma fonte. Mostre as duas separadas, nomeie cada diferença e leve a decisão ao usuário: aceitar, acrescentar a outra publicação ou esperar a correção. Sem outra publicação, diga que o total não teve confirmação independente.
- Diferença legítima, como um ajuste manual aprovado, vira linha própria na conferência, com nome e motivo, e aí a conta fecha.
- Leia o valor final na API ou na tela, não a fórmula nem o script.
- Confira pelo menos: o total geral, um recorte por dimensão e o período mais recente. A soma das partes tem que bater com o total.
- Confira também as telas entre si: o mesmo indicador, com o mesmo filtro, dá o mesmo número.
- Compare com o total que a fonte publica, não com a soma das suas próprias linhas. Conferir um download com ele mesmo não prova nada.
- Todo indicador da tela entra na conferência. Se a fonte não publica o total, confira as partes.
- Não mexa no dashboard só para bater. Descubra a causa da diferença.

**À vista:** a conferência fica visível, com `OK` ou `DIVERGE` e a contagem de divergências, em uma tela restrita do dashboard ou, em site estático, em um relatório da entrega, fora do que é público. Um número pode quebrar depois da entrega, quando a fonte muda.

**A fonte pode mudar durante o trabalho.** Registre data e hora da conferência. Uma diferença causada por dado novo não é erro, mas precisa ser informada. Refaça a conferência lendo os dois lados no mesmo momento, para chegar a 0.

## 2. Testes automáticos

Não tocam dado real, rede nem credencial. Dados de teste ficam no próprio teste.

- **Módulo de formatos:** os testes da skill `dash-numeros`.
- **Regras de negócio:** cada regra do dicionário, com um caso que entra e um que fica de fora.
- **Dados:** duplicata, nulo, linha rejeitada e falha no meio da carga.
- **Interações:** a lista da skill `dash-interacoes`.
- **Agente:** a lista da skill `dash-agente`, quando houver.

Não afrouxe teste para passar. Ao corrigir um erro, escreva antes o teste que falha, e prove que ele falha sem a correção.

## 3. Revisor independente

Um agente novo, sem as suas conclusões, refaz as consultas do zero. Ele acha o que você não vê, porque não parte das suas premissas.

**Passe a ele só:** a pergunta de negócio, o dicionário de indicadores e o acesso de leitura à fonte. **Não passe:** seus números, suas consultas, sua explicação nem o que você acha que pode estar errado.

Use este pedido:

```markdown
Você é um revisor independente. Só leitura: não altere nada.

**O que conferir:** <indicadores e recortes>
**Regras:** <dicionário de indicadores>
**Fonte:** <como acessar, somente leitura>

Calcule cada indicador direto na fonte. Depois, abra o dashboard em <endereço> e compare com o que aparece na tela. Procure também:
- contagem dupla e linhas perdidas em junção;
- registro que entra ou fica de fora contra a regra;
- campo de texto livre com valores não previstos;
- rótulo que sugere o que o dado não prova;
- número escondido, mal formatado ou na unidade errada.

**Devolva:**
STATUS: concluído | parcial | bloqueado
| Item | Cálculo próprio | Na tela | Situação | Evidência |
Depois, o que não foi possível conferir e por quê.
Separe o provado do apenas indicado. Não faça suposições.
```

Espere o retorno antes de entregar: entrega com revisão em aberto não está pronta.

Depois de receber o retorno:

- Compare com a sua conferência. Cada diferença é investigada, e não descartada.
- Confirme cada achado antes de agir, porque o revisor também erra.
- Corrigiu um número ou a regra de um número? O revisor confere de novo aquele item.
- Só mudou texto ou tela? Você mesmo confere o texto contra os números ao lado, sem nova passada, e diz na entrega o que ele não viu. Texto de aviso gerado na correção costuma ser o que erra.

Se a ferramenta em uso não permitir um agente separado, peça ao usuário uma nova sessão para a revisão e informe que ela está pendente. Não troque por uma autorrevisão.

## 4. Ver na tela

Abra o dashboard em um navegador, com os dados, e use como o usuário usaria. **As verificações de tela rodam em navegador invisível** (headless, sem `headless=False`), a miniatura usa `--headless=new`, e todo processo de prova, de servidor ou de navegador, é criado com `windowsHide: true`: ninguém usa o computador com janelas se abrindo.

- [ ] Telas carregam sem erro no console.
- [ ] Os números na tela são os mesmos da conferência.
- [ ] Filtros, filtro cruzado e detalhamento funcionam, e o link copiado reproduz a tela.
- [ ] Nenhum rótulo cortado ou sobreposto, e nenhum `NaN` ou `undefined`.
- [ ] A última atualização e os avisos aparecem.
- [ ] Sem dados e falha aparecem como estados diferentes.
- [ ] A leitura funciona na largura de um celular.
- [ ] Checklist da skill `dash-numeros` conferido.
- [ ] Portal: o painel mostra um cartão para cada dashboard permitido, com miniatura, data e fonte, e nenhum a mais.
- [ ] Permissão por dashboard: quem não tem um dashboard não vê o cartão, não abre a miniatura e não alcança a API dele, e a recusa é idêntica à de um dashboard que não existe (tela, API e miniatura).
- [ ] Permissão pelo recorte dentro de cada dashboard que tem um: seletor, título, mapa, tabela e agente só mostram os itens da pessoa. Em dashboard sem recorte, o acesso é só com ou sem, e quem não tem recebe a mesma recusa de um dashboard que não existe.
- [ ] Administração: só o administrador abre a tela e as rotas dela, com CSRF; criar pessoa, marcar dashboards e recortes, tirar acesso, desativar e redefinir senha funcionam, e a senha provisória obriga a troca.
- [ ] O login, o primeiro acesso, a troca de senha e o título da aba usam o nome do projeto, nunca o de um dashboard.
- [ ] Separação dos dados: a leitura de um dashboard é recusada pelo banco ao ler o schema ou o arquivo de outro (Postgres e SQLite), a carga de um não grava no outro, e uma varredura confirma que as consultas de cada um só citam o schema dele (`test/isolation.test.ts`).

Se não for possível abrir a tela, diga isso. Não informe que está funcionando sem ter visto.

### Agente com memória, com o modelo real

Se o dashboard tem agente, a prova com o modelo real inclui a conversa. Suba um servidor seu, em outra porta, com login e só nesta máquina, com pessoas temporárias (`teste_`) que saem ao final, e confira:

- [ ] Uma pergunta, o seguimento ("e em agosto?") e um segundo seguimento usam o contexto, e todo número da resposta confere contra a API do dashboard.
- [ ] Depois de "Nova conversa", o mesmo seguimento não usa o contexto antigo.
- [ ] Uma pergunta fora do tema recebe a recusa normal, sem a mensagem de números. Repita em cada dashboard com agente.
- [ ] Uma pessoa com um item só do recorte nunca recebe oferta de outro.
- [ ] Captura de tela, em 1366 e 390 pixels, com navegador invisível: o negrito e as listas aparecem formatados, sem asterisco solto, e o texto de abertura diz o aviso de dados pessoais uma vez.
- [ ] Ao recarregar a página, a conversa guardada no servidor aparece.

## 5. Usar como uma pessoa

Passar nos testes não prova que a tela está boa: no piloto do kit, 31 problemas apareceram só ao usar o dashboard depois de tudo verde. Abra o navegador e procure defeitos de propósito:

- **Clique em tudo:** cada barra, fatia e coluna, o nome, o número, cada item da legenda, o menor item da lista, cada "i" de ajuda e cada cabeçalho. A legenda filtra os outros blocos, e o segundo clique retira. Clique duas vezes no mesmo lugar, sem mover o mouse: o segundo clique precisa retirar a seleção, em cada item, com e sem avisos na tela.
- **Combine filtros:** clique em um item e escolha outro no seletor. Escolha valores incompatíveis. Compare o seletor, os títulos e os números: eles dizem a mesma coisa?
- **Desconfie do número:** ele faz sentido no mundo real? Uma soma de área maior que o país revela um erro que nenhum teste pega.
- **Procure número escondido:** o que só aparece com o mouse e caberia na tela?
- **Mude a largura:** 1920, 1366, 1024, 800 e 390 pixels. A captura de página inteira pode mostrar a tabela com linhas faltando ou colunas sobrepostas sem que isso aconteça: confirme na janela real antes de tratar como defeito.
- **Force falhas:** servidor fora do ar, resposta inválida, link alterado à mão, página além do fim.
- **Entre com cada perfil:** acesso total, limitado e sem acesso. O título e os botões fazem sentido para cada um?
- **Use o agente:** a resposta é legível? A origem traz nomes?

Registre cada achado com o passo para repetir, corrija, e transforme em teste o que puder ser automatizado.

## Depois de uma correção

Compare antes e depois, e explique cada diferença:

| Indicador | Antes | Depois | Diferença | Motivo |
|---|---|---|---|---|
| Faturamento (R$) | 1.240.000,00 | 1.234.567,89 | -5.432,11 | 6 notas canceladas contadas por engano |

Se um número mudou e ninguém sabe por quê, a correção não terminou.

## Fechamento

Responda curto. Se o detalhe for longo, salve em arquivo e diga onde está.

```markdown
**Situação:** <pronto | não pronto>
**Mudou:** <o que foi feito>
**Contagens:** <indicadores conferidos, divergências, testes>
**Revisor independente:** <o que encontrou>
**Problemas e decisões:** <o que apareceu e como foi resolvido>
**Não deu para conferir:** <o que e por quê>
**Pendente com o usuário:** <o que depende de você>
```

Na conferência, traga só o que divergiu, a menos que o usuário peça tudo.
