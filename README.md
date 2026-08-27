# Organizações Parceiras — M'Boi Mirim

Mapa público das organizações parceiras da região do M'Boi Mirim (Zona Sul de São Paulo), alimentado **diretamente por uma planilha do Google Sheets**. Qualquer pessoa com acesso de edição à planilha atualiza o mapa — não é preciso mexer no código nem republicar o site.

---

## 1. Estrutura do projeto

```
.
├── index.html          Mapa
├── incluir.html        Formulário (cadastro e edição)
├── incluir.js
├── instrucoes.html     Passo a passo para a equipe
├── style.css
├── config.js           ⚙️ cores, ícones, mapas base
├── app.js
├── api/
│   ├── _geo.js         Links do Maps, geocodificação, reverso
│   ├── _planilha.js    Canal único com o Apps Script
│   ├── dados.js        Lê a planilha → GeoJSON
│   ├── resolver.js     Link/endereço → ponto, ponto → endereço
│   └── registro.js     Incluir, editar, mudar situação
├── apps-script/
│   └── Codigo.gs       Roda DENTRO da planilha (instalar uma vez)
├── package.json
└── vercel.json
```

**Não há `server.py` / `server.ps1`.** Na Vercel o site é servido como estático + uma função serverless. Para rodar localmente, use `vercel dev` (item 5).

---

## 2. Onde os dados ficam

A planilha do Google Sheets continua sendo o banco de dados, mas passa a ser **privada**: ninguém além de você a abre. Todo acesso — leitura e escrita — passa pelo Apps Script instalado dentro dela.

```
navegador → /api/dados     → Apps Script → planilha   (leitura)
navegador → /api/registro  → Apps Script → planilha   (escrita)
```

O navegador nunca fala com a planilha. A URL do Apps Script e o código de acesso vivem só em variáveis de ambiente da Vercel, fora do alcance de quem abrir o código-fonte da página.

**Por que manter a planilha e não um banco de dados de verdade:** você continua com um lugar para consertar dados na mão. Um typo, um alfinete 200 m fora do lugar — você abre a planilha e corrige. Com Postgres, cada correção exigiria uma tela de administração ou SQL. Para uma base de dezenas ou poucas centenas de organizações, a planilha ganha.

### Colunas

O script cria sozinho o que faltar. Você não precisa mexer na planilha.

| Coluna | Origem | Uso |
|---|---|---|
| `Nome da Organização` | formulário | busca, título do balão |
| `Serviços oferecidos` | formulário | balão |
| `Endereco` | formulário / reverso | balão, exportação |
| `Latitude` / `Longitude` | alfinete | posição no mapa — **não** aparece no balão nem na exportação |
| `Contato` | formulário | balão |
| `Categoria` | formulário | cor, ícone, filtro, legenda |
| `Subprefeitura` | formulário | filtro |
| `ID` | automático | identifica a linha na edição — **não** exportado |
| `Situação` | botões do balão | `Em funcionamento` ou `Encerrada` |
| `Atualizado em` | automático | data da última mexida |
| `Atualizado por` | formulário | quem informou |
| `Observação` | formulário | histórico das mudanças de situação |

---

## 3b. Instalação do Apps Script

Siga o passo a passo comentado no topo de `apps-script/Codigo.gs`. Ao final você terá uma URL terminada em `/exec`.

Na Vercel, em *Settings → Environment Variables*:

| Variável | Valor |
|---|---|
| `APPS_SCRIPT_URL` | a URL `/exec` |
| `CODIGO_ACESSO` | a senha combinada com a equipe |

Depois: *Deployments* → "..." do último → **Redeploy**. Variáveis novas não valem para deploys já publicados.

**Só então** torne a planilha privada: *Compartilhar → Acesso geral → Restrito*.

Enquanto `APPS_SCRIPT_URL` não existir, o site cai no modo antigo (CSV público) e o formulário se desativa sozinho com um aviso. Nada quebra durante a migração.

**Sempre que editar o `Codigo.gs`**, salvar não basta: *Implantar → Gerenciar implantações → lápis → Versão: Nova → Implantar*.

---

## 4. Como a equipe usa

Tudo pelo site, com o código de acesso. Nada de planilha.

- **Incluir** — botão verde no cabeçalho. Nome, serviços, categoria, contato e a posição.
- **Corrigir** — clique no ponto → botão *Corrigir* no balão. Abre o mesmo formulário preenchido, e o registro continua sendo o mesmo (sem duplicata).
- **Continua aberta** — um clique. Registra a data, e o balão passa a mostrar "informação confirmada em…".
- **Fechou** — some do mapa, mas **nada é apagado**: vira `Situação = Encerrada`, com quem informou, quando e o motivo. O checkbox *Mostrar encerradas*, no painel esquerdo, traz de volta, e daí o botão vira *Voltou a funcionar*.

O nome de quem informou e o código ficam guardados no navegador depois do primeiro uso, então confirmar funcionamento vira mesmo um clique.

### Três formas de marcar a posição

O **alfinete é a fonte da verdade**. Link do Maps, endereço digitado e arraste manual são só três formas de posicioná-lo; o que é gravado é sempre a coordenada final.

| Caminho | Quando usar | Precisão |
|---|---|---|
| Colar link do Google Maps | melhor no celular (Compartilhar → Copiar link) | exata |
| Escrever o endereço + Achar | quando não se tem o link | aproximada, confira |
| Arrastar o alfinete | sempre disponível, e o mais preciso | exata |

---

## 4b. Categorias, cores e ícones

O sistema **descobre sozinho** quais categorias e subprefeituras existem e monta filtros e legenda com o que encontrar.

Para escolher cor e ícone de uma categoria, acrescente a linha no bloco `categorias` do `config.js`:

```js
"Agroecologia Urbana": { cor: "#27ae60", icone: "fa-seedling" },
```

Sem isso, a categoria aparece do mesmo jeito, com cor automática da paleta e ícone padrão. Ícones em [fontawesome.com](https://fontawesome.com/search?o=r&m=free&s=solid) — filtre por **Free** e **Solid**.

A lista `subprefeituras` do `config.js` serve só para montar o menu do formulário.

---

## 4c. Exportação

O botão **Exportar** baixa um `.xlsx` com as organizações visíveis no momento (respeitando busca e filtros). Saem `Latitude`, `Longitude` e `ID` — são dados internos.

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
