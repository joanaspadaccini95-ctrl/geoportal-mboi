/**
 * /api/dados  —  Serverless Function (Vercel / Node 20)
 *
 * Fluxo de localização de cada organização (em cascata, para na primeira que resolver):
 *   1. Colunas Latitude / Longitude da planilha  ← prioridade
 *   2. Cache em memória (endereço já resolvido em chamada anterior)
 *   3. Geocodificação pelo Endereço (coluna C):
 *        3a. Nominatim/OSM com o endereço completo
 *        3b. ViaCEP (CEP extraído do próprio endereço) → logradouro/bairro → Nominatim
 *        3c. Nominatim apenas pelo CEP
 *
 * Devolve GeoJSON de pontos com todas as colunas da planilha nas properties.
 */

const SHEET_ID = process.env.SHEET_ID || '1jASW5jiS2ji4yl-YkUxMM0XSj9UtF6UwBF0cTN_rHUU';
const SHEET_NAME = process.env.SHEET_NAME || 'Página1';

// Identificação exigida pela política de uso do Nominatim
const USER_AGENT = process.env.GEOCODER_UA || 'geoportal-mboi-mirim/1.0 (mapa de organizacoes parceiras)';

// Retângulo de sanidade: região do M'Boi Mirim / Zona Sul de SP
const BBOX = { latMin: -23.92, latMax: -23.55, lonMin: -46.92, lonMax: -46.60 };
// Viewbox enviado ao Nominatim como viés de busca (lonMin, latMax, lonMax, latMin)
const VIEWBOX = `${BBOX.lonMin},${BBOX.latMax},${BBOX.lonMax},${BBOX.latMin}`;

// Limites por invocação (evita estourar o tempo máximo da função)
const ORCAMENTO_MS = 45000;
const MAX_NOVOS_POR_CHAMADA = 40;

// Cache de geocodificação em memória (persiste enquanto o lambda estiver quente)
const cacheGeo = new Map();

// Rótulo para células de Categoria / Subprefeitura em branco
const SEM_VALOR = 'Não informado';

/* ==========================================================================
   UTILITÁRIOS
   ========================================================================== */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function normalizar(txt) {
    return String(txt || '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function soDigitos(txt) {
    return String(txt || '').replace(/\D/g, '');
}

/**
 * Converte texto em número decimal aceitando vírgula OU ponto como separador.
 * A planilha em pt-BR exporta "-23,685918"; outras origens usam "-23.685918".
 */
function parseCoord(valor) {
    const txt = String(valor ?? '').trim();
    if (!txt) return NaN;
    // Se tem vírgula e ponto, o último separador é o decimal
    let limpo = txt.replace(/\s/g, '');
    if (limpo.includes(',') && limpo.includes('.')) {
        limpo = limpo.lastIndexOf(',') > limpo.lastIndexOf('.')
            ? limpo.replace(/\./g, '').replace(',', '.')
            : limpo.replace(/,/g, '');
    } else {
        limpo = limpo.replace(',', '.');
    }
    const n = parseFloat(limpo);
    return Number.isFinite(n) ? n : NaN;
}

/** Parser de CSV que respeita aspas, vírgulas internas e quebras de linha. */
function parseCSV(texto) {
    const linhas = [];
    let linha = [];
    let campo = '';
    let dentroAspas = false;

    for (let i = 0; i < texto.length; i++) {
        const c = texto[i];
        if (dentroAspas) {
            if (c === '"') {
                if (texto[i + 1] === '"') { campo += '"'; i++; }
                else dentroAspas = false;
            } else {
                campo += c;
            }
        } else {
            if (c === '"') dentroAspas = true;
            else if (c === ',') { linha.push(campo); campo = ''; }
            else if (c === '\n') { linha.push(campo); linhas.push(linha); linha = []; campo = ''; }
            else if (c !== '\r') campo += c;
        }
    }
    if (campo.length > 0 || linha.length > 0) { linha.push(campo); linhas.push(linha); }
    return linhas;
}

function dentroDaRegiao(lat, lon) {
    return lat >= BBOX.latMin && lat <= BBOX.latMax && lon >= BBOX.lonMin && lon <= BBOX.lonMax;
}

/** Extrai o CEP de dentro da string de endereço (ex.: "..., São Paulo - SP, 05879-000"). */
function extrairCEP(endereco) {
    const m = String(endereco || '').match(/(\d{5})-?(\d{3})(?!\d)/);
    return m ? `${m[1]}${m[2]}` : '';
}

function extrairNumero(endereco) {
    const m = String(endereco || '').match(/,\s*(\d{1,6})\b/);
    return m ? m[1] : '';
}

/* ==========================================================================
   GEOCODIFICAÇÃO
   ========================================================================== */

// Fila serializada: 1 requisição a cada 1,1 s (política do Nominatim)
let fila = Promise.resolve();
function enfileirar(fn) {
    const resultado = fila.then(fn, fn);
    fila = resultado.then(() => sleep(1100), () => sleep(1100));
    return resultado;
}

async function buscarJSON(url, timeoutMs = 8000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const resp = await fetch(url, {
            signal: ctrl.signal,
            headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json', 'Accept-Language': 'pt-BR' }
        });
        if (!resp.ok) return null;
        return await resp.json();
    } catch {
        return null;
    } finally {
        clearTimeout(t);
    }
}

async function nominatim(params) {
    const qs = new URLSearchParams({
        format: 'jsonv2',
        limit: '3',
        countrycodes: 'br',
        viewbox: VIEWBOX,
        addressdetails: '0',
        ...params
    });
    const dados = await enfileirar(() =>
        buscarJSON(`https://nominatim.openstreetmap.org/search?${qs.toString()}`)
    );
    if (!Array.isArray(dados)) return null;

    for (const item of dados) {
        const lat = parseFloat(item.lat);
        const lon = parseFloat(item.lon);
        if (Number.isFinite(lat) && Number.isFinite(lon) && dentroDaRegiao(lat, lon)) {
            return { lat, lon };
        }
    }
    return null;
}

async function viaCep(cep) {
    const limpo = soDigitos(cep);
    if (limpo.length !== 8) return null;
    return await buscarJSON(`https://viacep.com.br/ws/${limpo}/json/`, 6000);
}

/** Prepara a string de busca a partir do endereço bruto da planilha. */
function prepararEndereco(endereco) {
    let txt = String(endereco || '').trim();
    if (!txt) return '';
    // Remove o CEP do fim (o Nominatim se confunde com ele no texto livre)
    txt = txt.replace(/,?\s*\d{5}-?\d{3}\s*$/, '').trim();
    if (!/s[ãa]o paulo/i.test(txt)) txt += ', São Paulo';
    if (!/\bsp\b/i.test(txt)) txt += ' - SP';
    return `${txt}, Brasil`;
}

/**
 * Cascata de geocodificação a partir do ENDEREÇO (coluna C).
 * O CEP é extraído do próprio endereço — não há mais coluna de CEP.
 * Retorna { lat, lon, precisao } ou null.
 */
async function geocodificarPorEndereco(endereco) {
    if (!String(endereco || '').trim()) return null;

    // 1) Endereço completo em texto livre
    const consulta = prepararEndereco(endereco);
    if (consulta) {
        const r = await nominatim({ q: consulta });
        if (r) return { ...r, precisao: 'endereço completo' };
    }

    const cep = extrairCEP(endereco);

    // 2) ViaCEP resolve logradouro/bairro, e o Nominatim georreferencia
    if (cep) {
        const cepInfo = await viaCep(cep);
        if (cepInfo && !cepInfo.erro && cepInfo.logradouro) {
            const numero = extrairNumero(endereco);
            const partes = [
                numero ? `${cepInfo.logradouro}, ${numero}` : cepInfo.logradouro,
                cepInfo.bairro,
                cepInfo.localidade || 'São Paulo',
                cepInfo.uf || 'SP',
                'Brasil'
            ].filter(Boolean);

            const r = await nominatim({ q: partes.join(', ') });
            if (r) return { ...r, precisao: numero ? 'logradouro + número (via CEP)' : 'logradouro (via CEP)' };

            // 2b) Sem o número — cai no eixo do logradouro
            if (numero) {
                const r2 = await nominatim({
                    q: [cepInfo.logradouro, cepInfo.bairro, 'São Paulo', 'SP', 'Brasil'].filter(Boolean).join(', ')
                });
                if (r2) return { ...r2, precisao: 'logradouro (via CEP)' };
            }
        }

        // 3) Busca estruturada apenas pelo CEP
        const r3 = await nominatim({ postalcode: `${cep.slice(0, 5)}-${cep.slice(5)}`, city: 'São Paulo' });
        if (r3) return { ...r3, precisao: 'CEP' };
    }

    return null;
}

/* ==========================================================================
   LEITURA DA PLANILHA
   ========================================================================== */

async function lerPlanilha() {
    const urls = [
        `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(SHEET_NAME)}`,
        `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv`
    ];

    for (const url of urls) {
        try {
            const resp = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
            if (!resp.ok) continue;
            const texto = await resp.text();
            if (texto && !texto.trim().startsWith('<')) return texto;
        } catch { /* tenta a próxima URL */ }
    }
    throw new Error('Não foi possível ler a planilha. Verifique se ela está compartilhada como "qualquer pessoa com o link pode ver".');
}

/* ==========================================================================
   HANDLER
   ========================================================================== */

export default async function handler(req, res) {
    const inicio = Date.now();

    try {
        const csv = await lerPlanilha();
        const linhas = parseCSV(csv).filter((l) => l.some((c) => String(c).trim() !== ''));

        if (linhas.length < 2) {
            return responder(res, {
                type: 'FeatureCollection',
                features: [],
                meta: { campos: [], camposPopup: [], categorias: [], subprefeituras: [], total: 0, geocodificados: 0, pendentes: 0, aviso: 'Planilha sem registros preenchidos.' }
            }, 60);
        }

        const cabecalhos = linhas[0].map((h) => String(h).trim());
        const registros = linhas.slice(1);

        // Localiza colunas pelo nome; se não achar, cai na posição padrão
        const idx = (candidatos, posicaoPadrao) => {
            for (const cand of candidatos) {
                const i = cabecalhos.findIndex((h) => normalizar(h) === normalizar(cand));
                if (i !== -1) return i;
            }
            return posicaoPadrao;
        };

        const iNome = idx(['Nome da Organização', 'Organização', 'Nome'], 0);
        const iEndereco = idx(['Endereco', 'Endereço'], 2);
        const iLat = cabecalhos.findIndex((h) => /^lat(itude)?$/i.test(String(h).trim()));
        const iLon = cabecalhos.findIndex((h) => /^(lon|lng|long|longitude)$/i.test(String(h).trim()));
        const iCategoria = idx(['Categoria', 'Categorias', 'Tipo'], -1);
        const iSubpref = idx(['Subprefeitura', 'Sub-prefeitura', 'Sub prefeitura'], -1);

        // campos      → todas as colunas, na ordem da planilha (usado na exportação .xlsx)
        // camposPopup → sem Latitude/Longitude (usado no balão do mapa)
        const campos = cabecalhos.map((h, i) => ({ nome: h, i })).filter((c) => c.nome !== '');
        const camposPopup = campos.filter((c) => c.i !== iLat && c.i !== iLon);

        // Valores distintos encontrados (alimentam os filtros e a legenda)
        const contagemCategoria = new Map();
        const contagemSubpref = new Map();

        const features = [];
        let geocodificados = 0;
        let pendentes = 0;
        let porCoordenada = 0;
        let porEndereco = 0;
        let novos = 0;

        for (const linha of registros) {
            const nome = String(linha[iNome] || '').trim();
            if (!nome) continue; // ignora linhas em branco

            const endereco = String(linha[iEndereco] || '').trim();

            const props = {};
            for (const c of campos) props[c.nome] = String(linha[c.i] ?? '').trim();

            // Categoria e Subprefeitura (célula vazia vira SEM_VALOR)
            const categoria = iCategoria !== -1
                ? (String(linha[iCategoria] || '').trim() || SEM_VALOR) : SEM_VALOR;
            const subpref = iSubpref !== -1
                ? (String(linha[iSubpref] || '').trim() || SEM_VALOR) : SEM_VALOR;

            contagemCategoria.set(categoria, (contagemCategoria.get(categoria) || 0) + 1);
            contagemSubpref.set(subpref, (contagemSubpref.get(subpref) || 0) + 1);

            let ponto = null;
            let origem = '';

            /* ---- 1. Latitude / Longitude da planilha (PRIORIDADE) ---- */
            if (iLat !== -1 && iLon !== -1) {
                let lat = parseCoord(linha[iLat]);
                let lon = parseCoord(linha[iLon]);

                if (Number.isFinite(lat) && Number.isFinite(lon)) {
                    let precisao = 'coordenada da planilha';

                    // Correção automática de colunas invertidas
                    if (!dentroDaRegiao(lat, lon) && dentroDaRegiao(lon, lat)) {
                        [lat, lon] = [lon, lat];
                        precisao = 'coordenada da planilha (lat/long invertidas — corrigido)';
                    } else if (!dentroDaRegiao(lat, lon)) {
                        precisao = 'coordenada da planilha (fora da região esperada)';
                    }

                    ponto = { lat, lon, precisao };
                    origem = 'planilha';
                    porCoordenada++;
                }
            }

            /* ---- 2. Cache em memória ---- */
            const chave = normalizar(endereco);
            if (!ponto && chave && cacheGeo.has(chave)) {
                const cacheado = cacheGeo.get(chave);
                if (cacheado) {
                    ponto = cacheado;
                    origem = 'cache';
                    porEndereco++;
                }
            }

            /* ---- 3. Geocodificação pelo endereço ---- */
            if (!ponto && chave && !cacheGeo.has(chave)) {
                const temTempo = Date.now() - inicio < ORCAMENTO_MS && novos < MAX_NOVOS_POR_CHAMADA;
                if (temTempo) {
                    novos++;
                    const r = await geocodificarPorEndereco(endereco);
                    if (r) {
                        ponto = { lat: r.lat, lon: r.lon, precisao: r.precisao };
                        cacheGeo.set(chave, ponto);
                        origem = 'geocodificação';
                        porEndereco++;
                    } else {
                        cacheGeo.set(chave, null); // marca como insolúvel para não repetir
                    }
                }
            }

            if (ponto) {
                geocodificados++;
                // Devolve as coordenadas efetivas nas colunas da planilha (útil na exportação)
                if (iLat !== -1) props[cabecalhos[iLat]] = ponto.lat.toFixed(6);
                if (iLon !== -1) props[cabecalhos[iLon]] = ponto.lon.toFixed(6);

                features.push({
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: [ponto.lon, ponto.lat] },
                    properties: { ...props, _categoria: categoria, _subprefeitura: subpref, _precisao: ponto.precisao, _origem: origem }
                });
            } else {
                pendentes++;
                features.push({
                    type: 'Feature',
                    geometry: null,
                    properties: { ...props, _categoria: categoria, _subprefeitura: subpref, _precisao: 'não localizado', _origem: '' }
                });
            }
        }

        const payload = {
            type: 'FeatureCollection',
            features,
            meta: {
                campos: campos.map((c) => c.nome),
                camposPopup: camposPopup.map((c) => c.nome),
                colunaNome: cabecalhos[iNome] || 'Nome da Organização',
                colunaEndereco: cabecalhos[iEndereco] || 'Endereco',
                colunaCategoria: iCategoria !== -1 ? cabecalhos[iCategoria] : null,
                colunaSubprefeitura: iSubpref !== -1 ? cabecalhos[iSubpref] : null,
                categorias: ordenarContagem(contagemCategoria),
                subprefeituras: ordenarContagem(contagemSubpref),
                total: features.length,
                geocodificados,
                porCoordenada,
                porEndereco,
                pendentes,
                atualizado: new Date().toISOString(),
                duracaoMs: Date.now() - inicio
            }
        };

        // Se ainda há pendências, cacheia por pouco tempo para que a próxima chamada complete
        return responder(res, payload, pendentes > 0 ? 60 : 900);

    } catch (erro) {
        res.setHeader('Cache-Control', 'no-store');
        return res.status(500).json({
            type: 'FeatureCollection',
            features: [],
            meta: { erro: erro.message || 'Erro desconhecido ao processar os dados.' }
        });
    }
}

/** Converte o Map de contagens em lista ordenada alfabeticamente ('Não informado' por último). */
function ordenarContagem(mapa) {
    return [...mapa.entries()]
        .map(([nome, total]) => ({ nome, total }))
        .sort((a, b) => {
            if (a.nome === SEM_VALOR) return 1;
            if (b.nome === SEM_VALOR) return -1;
            return a.nome.localeCompare(b.nome, 'pt-BR');
        });
}

function responder(res, payload, sMaxAge) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', `public, s-maxage=${sMaxAge}, stale-while-revalidate=86400`);
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).json(payload);
}
