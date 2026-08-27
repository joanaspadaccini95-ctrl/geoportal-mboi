import {
    USER_AGENT, BBOX, dentroDaRegiao, normalizar, parseCoord,
    resolverLocalizacao
} from './_geo.js';

const SHEET_ID = process.env.SHEET_ID || '1jASW5jiS2ji4yl-YkUxMM0XSj9UtF6UwBF0cTN_rHUU';
const SHEET_NAME = process.env.SHEET_NAME || 'Página1';

// Limites por invocação (evita estourar o tempo máximo da função)
const ORCAMENTO_MS = 45000;
const MAX_NOVOS_POR_CHAMADA = 40;

// Cache de localização em memória (persiste enquanto o lambda estiver quente)
const cacheGeo = new Map();

// Rótulo para células de Categoria / Subprefeitura em branco
const SEM_VALOR = 'Não informado';

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
                    const r = await resolverLocalizacao(endereco);
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
