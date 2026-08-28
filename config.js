/**
 * Configuração Central — Geoportal "Organizações Parceiras - M'Boi Mirim"
 *
 * ⚙️  ESTE É O ÚNICO ARQUIVO QUE VOCÊ PRECISA EDITAR NO DIA A DIA.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  COMO ACRESCENTAR UMA CATEGORIA NOVA
 *  1. Acrescente o valor na validação de dados da planilha (coluna Categoria)
 *  2. Acrescente uma linha no bloco "categorias" abaixo, no mesmo formato
 *  O nome precisa ser IGUAL ao da planilha (acentos e maiúsculas não importam).
 *
 *  Se você esquecer o passo 2, nada quebra: a categoria aparece assim mesmo,
 *  com uma cor automática e o ícone padrão. O passo 2 serve para ESCOLHER
 *  a cor e o ícone.
 *
 *  COMO TROCAR UM ÍCONE
 *  Procure em https://fontawesome.com/search?o=r&m=free&s=solid
 *  e copie o nome que começa com "fa-" (ex.: fa-house, fa-book, fa-heart).
 *
 *  AS SUBPREFEITURAS NÃO PRECISAM DE CONFIGURAÇÃO NENHUMA:
 *  o filtro é montado sozinho com o que existir na planilha.
 * ─────────────────────────────────────────────────────────────────────────
 */

const CONFIG = {
    title: "Organizações Parceiras - M'Boi Mirim",
    subtitle: "Mapa colaborativo de organizações e serviços — Zona Sul de São Paulo",

    // Endpoint da Serverless Function (Vercel) que lê a planilha e devolve GeoJSON
    apiPath: "/api/dados",

    // Nomes EXATOS dos cabeçalhos da planilha (linha 1)
    colunas: {
        nome: "Nome da Organização",   // busca e título do balão
        endereco: "Endereco",          // localização (fallback)
        latitude: "Latitude",          // localização (prioridade)
        longitude: "Longitude",        // localização (prioridade)
        categoria: "Categoria",        // cor + ícone + filtro + legenda
        subprefeitura: "Subprefeitura" // filtro
    },

    /* =====================================================================
       CATEGORIAS — cor e ícone de cada uma
       ===================================================================== */
    categorias: {
        "Associações Beneficentes": { cor: "#3498db", icone: "fa-hand-holding-heart"},
        "Equipamentos Públicos": { cor: "#e67e22", icone: "fa-solid fa-building-columns"},
        "Organizações Sociais": { cor: "#f1c40f", icone: "fa-solid fa-handshake" },
    },

    // Cores sorteadas automaticamente para categorias ainda não configuradas acima
    paletaAuto: [
        "#e74c3c", "#3498db", "#e67e22", "#9b59b6", "#16a085",
        "#f1c40f", "#27ae60", "#2980b9", "#d35400", "#c0392b",
        "#1abc9c", "#8e44ad", "#34495e", "#f39c12", "#7f8c8d"
    ],

    // Ícone usado por categorias ainda não configuradas acima
    iconePadrao: "fa-location-dot",

    // Rótulo usado quando a célula de Categoria/Subprefeitura está vazia
    semValor: "Não informado",

    /* =====================================================================
       SUBPREFEITURAS — usadas apenas para montar a lista do formulário
       de inclusão. O FILTRO do mapa não depende disto: ele é montado com
       o que existir na planilha. Ajuste conforme a validação de dados.
       ===================================================================== */
    subprefeituras: [
        "M'Boi Mirim",
        "Capela do Socorro",
        "Cidade Ademar",
        "Parelheiros",
    ],

    // Enquadramento inicial (vale só até a planilha carregar)
    mapa: {
        center: [-23.7150, -46.7550],
        zoom: 13
    },

    // Tamanho do marcador em pixels
    marcador: {
        tamanho: 34,
        tamanhoDestaque: 46
    },

    // Mapas de fundo
    baseMaps: [
        {
            id: "satellite",
            name: "Satélite",
            icon: "fa-earth-americas",
            url: "https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}",
            attribution: "&copy; Google",
            maxZoom: 20
        },
        {
            id: "osm",
            name: "Ruas",
            icon: "fa-road",
            url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
            attribution: "&copy; OpenStreetMap contributors",
            maxZoom: 19
        }
    ],

    // Nome do arquivo gerado na exportação (.xlsx)
    exportFileName: "organizacoes_parceiras_mboi_mirim",

    // Página de instruções (botão "Como incluir" no cabeçalho)
    instrucoesUrl: "./instrucoes.html",

    // Formulário de inclusão pelo próprio site
    incluirUrl: "./incluir.html"
};
