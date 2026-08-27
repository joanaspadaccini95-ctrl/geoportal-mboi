# Organizações Parceiras — M'Boi Mirim

Mapa público das organizações parceiras da região do M'Boi Mirim (Zona Sul de São Paulo), alimentado **diretamente por uma planilha do Google Sheets**. Qualquer pessoa com acesso de edição à planilha atualiza o mapa — não é preciso mexer no código nem republicar o site.

---

## 1. Estrutura do projeto

```
.
├── index.html          Estrutura da página do mapa
├── instrucoes.html     Passo a passo para quem vai preencher a planilha
├── style.css           Design system (glassmorphism / teal)
├── config.js           ⚙️ ÚNICO arquivo que você precisa editar no dia a dia
├── app.js              Lógica do mapa, busca, lista e exportação
├── incluir.html        Formulário de inclusão com alfinete arrastável
├── incluir.js          Lógica do formulário
├── api/
│   ├── _geo.js         Módulo interno: links do Maps, geocodificação, reverso
│   ├── dados.js        Lê a planilha → localiza → devolve GeoJSON
│   ├── resolver.js     Apoio ao formulário (link/endereço → ponto, ponto → endereço)
│   └── incluir.js      Recebe o formulário → valida → manda gravar
├── apps-script/
│   └── Codigo.gs       Script que mora DENTRO da planilha e faz a gravação
├── package.json
└── vercel.json
```

**Não há `server.py` / `server.ps1`.** Na Vercel o site é servido como estático + uma função serverless. Para rodar localmente, use `vercel dev` (item 5).

---

## 2. Pré-requisito na planilha ⚠️

A planilha **precisa estar pública para leitura**. Sem isso o mapa aparece vazio.

1. Abra a planilha → **Compartilhar**
2. Em "Acesso geral", selecione **Qualquer pessoa com o link**
3. Papel: **Leitor**

Layout esperado (linha 1 = cabeçalho):

| Coluna | Cabeçalho | Uso |
|---|---|---|
| A | `Nome da Organização` | Busca e título do balão |
| B | `Serviços oferecidos` | Exibido no balão |
| C | `Endereco` | **Localização — fallback** |
| D | `Latitude` | **Localização — prioridade** |
| E | `Longitude` | **Localização — prioridade** |
| F | `Contato` | Exibido no balão |
| — | `Categoria` | Cor + ícone do ponto, filtro e legenda |
| — | `Subprefeitura` | Filtro |
| … | *(livre)* | Novas colunas aparecem no balão automaticamente |

`Categoria` e `Subprefeitura` são localizadas **pelo nome do cabeçalho**, não pela posição — pode colocá-las em qualquer coluna. Se alguma não existir, o filtro correspondente simplesmente não aparece.

Três propriedades importantes:

- **Colunas novas não exigem alteração de código.** Se alguém adicionar `Horário de funcionamento` na coluna G, ela passa a aparecer no balão e na exportação sozinha.
- **Colunas vazias em uma linha não aparecem** no balão daquela organização.
- **`Latitude` e `Longitude` não aparecem no balão** (seriam ruído para o público), mas saem na exportação `.xlsx`.

### Preenchendo Latitude / Longitude

Aceita vírgula ou ponto como separador decimal — `-23,685918` e `-23.685918` funcionam igual.

Deixar as duas em branco é perfeitamente válido: a organização será localizada pelo endereço. Preencher é o caminho para **cravar** a posição exata, e é o que você deve fazer sempre que o ponto automático cair no lugar errado.

Duas proteções embutidas: se as colunas estiverem trocadas (longitude em `Latitude`), o sistema detecta e corrige sozinho; e se a coordenada cair fora da Zona Sul, o ponto é plotado assim mesmo — sua entrada manual sempre vence — mas o balão avisa `fora da região esperada`.

**Atalho útil:** exporte o `.xlsx` depois que o mapa carregar. As colunas `Latitude`/`Longitude` vêm preenchidas inclusive nas linhas que foram geocodificadas pelo endereço — basta conferir e colar de volta na planilha para congelar as posições.

---

## 3. Publicar no GitHub + Vercel

**a) GitHub**

```bash
cd geoportal-mboi
git init
git add .
git commit -m "Geoportal Organizações Parceiras - M'Boi Mirim"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/geoportal-mboi.git
git push -u origin main
```

**b) Vercel**

1. Acesse [vercel.com](https://vercel.com) e entre com a conta do GitHub
2. **Add New → Project → Import** o repositório
3. Framework Preset: **Other**. Build Command e Output Directory: **deixe em branco**
4. **Deploy**

Pronto — a URL pública sai em cerca de um minuto. Cada `git push` na branch `main` republica o site automaticamente.

**c) Variáveis de ambiente (opcional)**

Em *Settings → Environment Variables*, se quiser trocar de planilha sem mexer no código:

| Variável | Padrão |
|---|---|
| `SHEET_ID` | `1jASW5jiS2ji4yl-YkUxMM0XSj9UtF6UwBF0cTN_rHUU` |
| `SHEET_NAME` | `Página1` |
| `GEOCODER_UA` | identificação enviada ao Nominatim — vale colocar um e-mail de contato |

---

## 4. Como funciona a geocodificação

A função `api/dados.js` tenta, **em cascata**, e para na primeira que resolver:

1. **Colunas `Latitude` / `Longitude`** da planilha — prioridade absoluta, sem nenhuma chamada externa
2. **Cache** — endereço já resolvido em uma chamada anterior
3. **Geocodificação pelo endereço** (coluna C), ela mesma em cascata:
   - Nominatim (OpenStreetMap) com o endereço completo
   - ViaCEP: o CEP é extraído de dentro do próprio endereço → logradouro + bairro → Nominatim
   - Nominatim apenas com o CEP (menos preciso, cai no centro da faixa)

Não existe mais coluna de CEP: quando ele é necessário, é lido do final da string de endereço.

Todo resultado passa por uma **validação de retângulo** (`BBOX` em `api/dados.js`): se o ponto cair fora da Zona Sul de São Paulo, é descartado e a cascata continua. Isso evita o clássico erro de mandar a organização para outro estado por causa de um nome de rua repetido.

O balão mostra, no rodapé, **qual estratégia localizou o ponto** — útil para saber em quais linhas vale preencher LATITUDE/LONGITUDE na mão.

**Cache em três camadas:**

- as colunas `Latitude`/`Longitude` da planilha (permanente)
- memória da função (chamadas seguidas não regeocodificam nada)
- CDN da Vercel (15 min quando tudo está resolvido, 1 min quando há pendências)

**Limite por chamada:** vale só para linhas *sem* coordenada. No máximo 40 endereços novos ou 45 segundos, porque o Nominatim exige 1 requisição por segundo. Se você colar 100 organizações de uma vez, o mapa avisa quantas ficaram pendentes; basta clicar em **Atualizar** algumas vezes até zerar. Depois disso fica instantâneo.

---

## 4b. Categorias, cores e ícones

Nada aqui é obrigatório: o sistema **descobre sozinho** quais categorias e subprefeituras existem na planilha e monta os filtros e a legenda a partir do que encontrar.

### Acrescentar uma categoria

1. Acrescente o valor na validação de dados da planilha
2. *(opcional)* Acrescente a linha correspondente no bloco `categorias` do `config.js`

Pulando o passo 2 nada quebra — a categoria aparece com uma cor automática da paleta e o ícone padrão. O passo 2 serve só para **escolher** a cor e o ícone.

```js
"Agroecologia Urbana": { cor: "#27ae60", icone: "fa-seedling" },
```

O nome é comparado ignorando acentos e maiúsculas, então `"Saude"` no `config.js` casa com `"Saúde"` na planilha.

### Trocar um ícone

Procure em [fontawesome.com](https://fontawesome.com/search?o=r&m=free&s=solid) — filtre por **Free** e **Solid** — e copie o nome que começa com `fa-`. Ícones marcados como Pro não funcionam.

### Acrescentar uma subprefeitura

Só na planilha. O filtro se monta sozinho, sem configuração.

---

## 4c. Página de instruções

O `instrucoes.html` é a página ligada ao botão **Como incluir** do cabeçalho, escrita para pessoas com pouca familiaridade com computador. Cobre: abrir a planilha, achar a linha vazia, copiar o endereço completo do Google Maps (com ênfase no CEP), usar as listas suspensas e, como passo opcional, pegar coordenadas pelo clique com o botão direito no Google Maps.

As ilustrações são desenhos vetoriais embutidos no próprio arquivo — não há imagens externas para se perder. Para trocá-las por capturas de tela reais, coloque os arquivos numa pasta `img/` e substitua cada bloco `<svg>...</svg>` por `<img src="./img/nome.png" alt="descrição">`.

---

## 4d. Inclusão pelo próprio site

O formulário em `incluir.html` deixa a pessoa cadastrar uma organização sem abrir a planilha. **O alfinete arrastável é a fonte da verdade**: link do Maps, endereço digitado e arraste manual são só três formas de posicioná-lo, e o que vai para a planilha é sempre a coordenada final. Isso elimina a geocodificação por adivinhação.

### Como o dado chega à planilha

```
navegador → /api/incluir (valida) → Apps Script (grava) → planilha
```

O navegador nunca fala com a planilha. A URL do Apps Script e o código de acesso ficam só em variáveis de ambiente na Vercel, fora do alcance de quem abrir o código-fonte da página.

### Instalação (uma vez só)

1. Abra `apps-script/Codigo.gs` e siga o passo a passo comentado no topo do arquivo
2. Ao final você terá uma URL terminada em `/exec`
3. Na Vercel, em *Settings → Environment Variables*, crie:

| Variável | Valor |
|---|---|
| `APPS_SCRIPT_URL` | a URL `/exec` copiada |
| `CODIGO_ACESSO` | a senha combinada com a equipe |

4. Aba *Deployments* → botão "..." do último → **Redeploy**

Enquanto `APPS_SCRIPT_URL` não existir, o formulário se desativa sozinho e mostra um aviso apontando para a planilha. Nada quebra.

### Moderação

No `Codigo.gs`, mudando `MODERACAO` para `true`, os envios do site passam a cair numa aba `Pendentes` (criada sozinha, com o mesmo cabeçalho) em vez da aba principal. Você revisa e move as linhas aprovadas.

### Sobre a segurança

O Apps Script precisa ser publicado como "Qualquer pessoa" para o site conseguir gravar — a proteção real é o `CODIGO_ACESSO`. Isso basta contra robôs e curiosos, mas não é uma senha individual: quem tem o código pode incluir. Para uma base pública de organizações parceiras, é uma troca razoável. Se um dia precisar de controle por pessoa, o caminho seria Google Forms com login exigido, ou autenticação de verdade no portal.

---

## 4e. Links do Google Maps na coluna Endereço

A coluna `Endereco` aceita três conteúdos diferentes, e a API reconhece qual é qual:

| O que a pessoa cola | Como é resolvido | Precisão |
|---|---|---|
| `https://maps.app.goo.gl/…` | Expande o link e lê as coordenadas de dentro | Exata |
| `-23.685918, -46.792683` | Usa direto | Exata |
| `R. Feitiço da Vila, 399 - …, 05879-000` | Nominatim → ViaCEP → CEP | Aproximada |

O link é o melhor caminho no celular: no Google Maps é **Compartilhar → Copiar link**, um toque. E é mais preciso que o endereço em texto, porque não passa por adivinhação nenhuma.

---

## 5. Rodar localmente

```bash
npm i -g vercel
cd geoportal-mboi
vercel dev
```

Abre em `http://localhost:3000`. Abrir o `index.html` direto pelo navegador **não funciona** — a rota `/api/dados` não existe sem o `vercel dev`.

---

## 6. Ajustes rápidos (tudo em `config.js`)

| O que mudar | Onde |
|---|---|
| Título e subtítulo do cabeçalho | `title`, `subtitle` |
| Cor e tamanho dos pontos | `ponto`, `pontoDestaque` |
| Enquadramento inicial | `mapa.center`, `mapa.zoom` |
| Mapas base | `baseMaps` (adicione ou remova itens do array) |
| Nome do arquivo exportado | `exportFileName` |
| Esconder o botão "Planilha" | `planilhaUrl: ""` |

A paleta geral do site fica nas variáveis CSS do topo de `style.css` (`--primary`, `--bg-dark`, etc.).

---

## 7. Problemas comuns

| Sintoma | Causa provável |
|---|---|
| Mapa vazio, erro no toast | Planilha não está compartilhada como "qualquer pessoa com o link" |
| Aviso de "endereços não localizados" que não some | Endereço ambíguo demais — preencha `Latitude`/`Longitude` na planilha |
| Ponto no lugar errado | Idem — corrija por `Latitude`/`Longitude` |
| Alterei a planilha e o mapa não mudou | Clique em **Atualizar** (o botão ignora o cache da CDN) |
| Aba renomeada e mapa quebrou | Atualize a variável `SHEET_NAME` na Vercel |
