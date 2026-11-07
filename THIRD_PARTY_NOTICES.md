# Avisos de terceiros

O kit usa a licença MIT (veja [LICENSE](LICENSE)). Este arquivo diz o que vem de terceiros: o que está dentro do repositório e o que o site gerado leva das bibliotecas.

## Dentro do repositório

### Contornos das UFs (IBGE)

- **Arquivo:** `modelo/dashboards/producao-agricola/web/ufs.geo.json`.
- **Origem:** a API de malhas do IBGE (Instituto Brasileiro de Geografia e Estatística). Os contornos vêm de `https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR?intrarregiao=UF&qualidade=minima&formato=application/vnd.geo%2Bjson`, a malha mais simplificada que o IBGE publica, dividida por UF. As siglas e os nomes vêm de `https://servicodados.ibge.gov.br/api/v1/localidades/estados`.
- **O que o script faz:** `modelo/dashboards/producao-agricola/scripts/outlines.ts` (`npm run outlines`) baixa as duas respostas, confere que a malha traz exatamente as 27 UFs, arredonda as coordenadas a 3 casas, tira pontos repetidos em sequência e anéis com menos de 4 pontos, junta a sigla e o nome de cada UF, ordena por código e grava o arquivo. Ele não muda a forma dos contornos de nenhum outro jeito.
- **Fonte no próprio arquivo:** o campo `source` guarda o editor (`IBGE`), os dois endereços e a data do download (`downloadedAt`). O mapa mostra "Contornos: IBGE, malha simplificada" na tela.

### Conteúdo copiado nas skills, nas regras e no modelo

Não há texto, código nem imagem de terceiros copiados nas skills (`.claude/skills`), no `AGENTS.md` nem no código do `modelo/`. As funções de formato e de filtro, os componentes e as regras são do próprio kit. Se um dia entrar conteúdo de terceiros, o aviso de autoria entra aqui.

## Dependências npm

Elas não estão no repositório: `npm install` as baixa a partir do `package.json` e do `package-lock.json`. Mas o site gerado (`npm run build` e `npm run build:static`) embute algumas delas no pacote. **Quem distribui o site gerado leva os avisos dessas bibliotecas:** mantenha, junto do site, o texto de licença de cada pacote embutido e os avisos que ele pede.

As licenças abaixo vêm do campo `license` do `package.json` de cada pacote, nas versões fixadas no projeto.

| Pacote | Versão | Licença | Onde entra |
|---|---|---|---|
| React e React DOM | 19.3.1 | MIT | Embutido no site |
| ECharts | 6.1.0 | Apache-2.0 | Embutido no site |
| ZRender (usado pelo ECharts) | 6.1.0 | BSD-3-Clause | Embutido no site, com o ECharts |
| AG Grid Community, `ag-grid-react` e `@ag-grid-community/locale` | 36.2.0 | MIT | Embutido no site |
| MapLibre GL | 6.16.0 | BSD-3-Clause | Embutido no site. O texto da licença está no fim deste arquivo |
| Vite | 8.3.5 | MIT | Ferramenta de build. Em geral não vai para o site; trechos de apoio que ele acrescente ao pacote seguem a mesma licença MIT |
| `embedded-postgres` | 18.6.0-beta.19 | MIT | Só em desenvolvimento, para o banco descartável dos testes. Não vai para o site |
| `pg` e `@anthropic-ai/sdk` | 8.23.1 e 1.3.0 | MIT e Apache-2.0 | Só no servidor. Não vão para o site |

O ECharts é Apache-2.0 e traz um arquivo `NOTICE`, que acompanha o pacote:

```text
Apache ECharts
Copyright 2017-2026 The Apache Software Foundation

This product includes software developed at
The Apache Software Foundation (https://www.apache.org/).
```

## Licença do MapLibre GL JS

Texto copiado de `node_modules/maplibre-gl/LICENSE.txt`, na versão 6.16.0. Ele também cobre trechos de outros projetos que o MapLibre contém.

```text
Copyright (c) 2023, MapLibre contributors

All rights reserved.

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

    * Redistributions of source code must retain the above copyright notice,
      this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright notice,
      this list of conditions and the following disclaimer in the documentation
      and/or other materials provided with the distribution.
    * Neither the name of MapLibre GL JS nor the names of its contributors
      may be used to endorse or promote products derived from this software
      without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR
CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.


-------------------------------------------------------------------------------

Contains code from mapbox-gl-js v1.13 and earlier

Version v1.13 of mapbox-gl-js and earlier are licensed under a BSD-3-Clause license

Copyright (c) 2020, Mapbox
Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

* Redistributions of source code must retain the above copyright notice,
  this list of conditions and the following disclaimer.
* Redistributions in binary form must reproduce the above copyright notice,
  this list of conditions and the following disclaimer in the documentation
  and/or other materials provided with the distribution.
* Neither the name of Mapbox GL JS nor the names of its contributors
  may be used to endorse or promote products derived from this software
  without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR
CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE,
EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.


-------------------------------------------------------------------------------

Contains code from glfx.js

Copyright (C) 2011 by Evan Wallace

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

--------------------------------------------------------------------------------

Contains a portion of d3-color https://github.com/d3/d3-color

Copyright 2010-2016 Mike Bostock
All rights reserved.

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

* Redistributions of source code must retain the above copyright notice, this
  list of conditions and the following disclaimer.

* Redistributions in binary form must reproduce the above copyright notice,
  this list of conditions and the following disclaimer in the documentation
  and/or other materials provided with the distribution.

* Neither the name of the author nor the names of contributors may be used to
  endorse or promote products derived from this software without specific prior
  written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR
ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```
