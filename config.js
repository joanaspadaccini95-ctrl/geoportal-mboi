/**
 * Configuração Central — Geoportal "Organizações Parceiras"
 *
 * ⚙️  ESTE É O ÚNICO ARQUIVO QUE VOCÊ PRECISA EDITAR NO DIA A DIA.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  COMO ACRESCENTAR UMA CATEGORIA NOVA
 *  1. Acrescente o valor na validação de dados da planilha (coluna Categoria)
 *  2. Acrescente uma linha no bloco "categorias" abaixo, no mesmo formato
 *
 *  Se você esquecer o passo 2, nada quebra: a categoria aparece assim mesmo,
 *  com uma cor automática e o ícone padrão. O passo 2 serve para ESCOLHER
 *  a cor e o ícone.
 *
 *  COMO TROCAR UM ÍCONE
 *  Procure em https://fontawesome.com/search?o=r&m=free&s=solid
 *  Pode escrever só "fa-handshake" ou a classe inteira "fa-solid fa-handshake".
 * ─────────────────────────────────────────────────────────────────────────
 */

const CONFIG = {
    title: "Organizações Parceiras",
    subtitle: "Mapa colaborativo de organizações e serviços",

    // Endpoint da Serverless Function (Vercel) que lê a planilha e devolve GeoJSON
    apiPath: "/api/dados",

    // Nomes EXATOS dos cabeçalhos da planilha (linha 1)
    colunas: {
        nome: "Nome da Organização",
        endereco: "Endereco",
        latitude: "Latitude",
        longitude: "Longitude",
        categoria: "Categoria",
        subprefeitura: "Subprefeitura"
    },

    /* =====================================================================
       CATEGORIAS — cor e ícone de cada uma
       ===================================================================== */
    categorias: {
        "Associações Beneficentes": { cor: "#3498db", icone: "fa-solid fa-hand-holding-heart" },
        "Equipamentos Públicos":    { cor: "#e67e22", icone: "fa-solid fa-building-columns" },
        "Organizações Sociais":     { cor: "#f1c40f", icone: "fa-solid fa-handshake" }
    },

    // Cores automáticas para categorias ainda não configuradas acima
    paletaAuto: [
        "#e74c3c", "#3498db", "#e67e22", "#9b59b6", "#16a085",
        "#f1c40f", "#27ae60", "#2980b9", "#d35400", "#c0392b",
        "#1abc9c", "#8e44ad", "#34495e", "#f39c12", "#7f8c8d"
    ],

    iconePadrao: "fa-location-dot",
    semValor: "Não informado",

    /* =====================================================================
       SITUAÇÕES
       Quais vêm DESMARCADAS ao abrir o mapa. "Duplicada" fica oculta por
       padrão para não poluir; quem quiser revisar marca o filtro.
       ===================================================================== */
    situacoesOcultasPorPadrao: ["Duplicada"],

    // Lista do formulário de inclusão (o filtro do mapa não depende disto)
    subprefeituras: [
        "M'Boi Mirim",
        "Capela do Socorro",
        "Cidade Ademar",
        "Parelheiros"
    ],

    // Enquadramento inicial (vale só até a planilha carregar)
    mapa: {
        center: [-23.7150, -46.7550],
        zoom: 13
    },

    marcador: {
        tamanho: 34,
        tamanhoDestaque: 46
    },

    /* =====================================================================
       MAPAS DE FUNDO
       O "hybrid" (satélite com nomes de ruas) é o usado no mapa do
       formulário de inclusão — ver campo mapaDoFormulario, abaixo.
       ===================================================================== */
    baseMaps: [
        {
            id: "hybrid",
            name: "Satélite + nomes",
            icon: "fa-satellite",
            url: "https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}",
            attribution: "&copy; Google",
            maxZoom: 20
        },
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

    // Qual mapa base o formulário de inclusão usa (id de baseMaps)
    mapaDoFormulario: "hybrid",

    /* =====================================================================
       DETECÇÃO DE DUPLICATAS no formulário
       ===================================================================== */
    duplicatas: {
        distanciaMetros: 150,   // raio considerado "no mesmo lugar"
        semelhancaMinima: 0.5   // 0 a 1 — quanto os nomes precisam se parecer
    },

    exportFileName: "organizacoes_parceiras",
    instrucoesUrl: "./instrucoes.html",
    incluirUrl: "./incluir.html"
};
