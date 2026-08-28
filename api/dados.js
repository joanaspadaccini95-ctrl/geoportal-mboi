/**
 * /api/dados — devolve o GeoJSON que alimenta o mapa
 *
 * Lê a planilha PRIVADA através do Apps Script. Se APPS_SCRIPT_URL não estiver
 * configurada, cai no modo antigo (CSV público) para não deixar o site no ar
 * sem dados durante a migração.
 */

import { dentroDaRegiao, normalizar, parseCoord, resolverLocalizacao } from './_geo.js';
import { chamarPlanilha, PLANILHA_ATIVA } from './_planilha.js';

const SHEET_ID = process.env.SHEET_ID || '1jASW5jiS2ji4yl-YkUxMM0XSj9UtF6UwBF0cTN_rHUU';
const SHEET_NAME = process.env.SHEET_NAME || 'Página1';

const ORCAMENTO_MS = 45000;
const MAX_NOVOS_POR_CHAMADA = 40;

const cacheGeo = new Map();

const SEM_VALOR = 'Não informado';
const SITUACAO_ENCERRADA = 'Encerrada';

// Colunas de controle: existem para o sistema, não para quem consulta o mapa
const COLUNAS_INTERNAS = ['id', 'latitude', 'longitude'];

/* ==========================================================================
   LEITURA
   ========================================================================== */

/** Modo antigo: CSV público. Mantido como rede de segurança. */
function parseCSV(texto) {
    const linhas = [];
    let linha = [], campo = '', dentroAspas = false;
    for (let i = 0; i < texto.length; i++) {
        const c = texto[i];
        if (dentroAspas) {
            if (c === '"') {
                if (texto[i + 1] === '"') { campo += '"'; i++; }
                else dentroAspas = false;
            } else campo += c;
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

async function lerViaCSV() {
    const urls = [
        `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(SHEET_NAME)}`,
        `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv`
    ];
    for (const url of urls) {
        try {
            const resp = await fetch(url);
            if (!resp.ok) continue;
            const texto = await resp.text();
            if (texto && !texto.trim().startsWith('<')) {
                const linhas = parseCSV(texto).filter((l) => l.some((c) => String(c).trim() !== ''));
                if (linhas.length < 1) return { campos: [], registros: [] };
                const campos = linhas[0].map((h) => String(h).trim()).filter(Boolean);
                const registros = linhas.slice(1).map((l) => {
                    const o = {};
                    campos.forEach((c, i) => { o[c] = String(l[i] ?? '').trim(); });
                    return o;
                });
                return { campos, registros };
            }
        } catch { /* tenta a próxima */ }
    }
    throw new Error('Não foi possível ler a planilha.');
}

async function lerPlanilha() {
    if (PLANILHA_ATIVA) {
        const r = await chamarPlanilha({ acao: 'listar' });
        if (!r || r.ok === false) {
            throw new Error((r && r.erro) || 'A planilha não respondeu.');
        }
        return { campos: r.campos || [], registros: r.registros || [] };
    }
    return await lerViaCSV();
}

/* ==========================================================================
   HANDLER
   ========================================================================== */

export default async function handler(req, res) {
    const inicio = Date.now();

    try {
        const { campos: cabecalhos, registros } = await lerPlanilha();

        if (cabecalhos.length === 0) {
            return responder(res, vazio('Planilha sem cabeçalho.'), 60);
        }

        const achar = (candidatos) => {
            for (const cand of candidatos) {
                const c = cabecalhos.find((h) => normalizar(h) === normalizar(cand));
                if (c) return c;
            }
            return null;
        };

        const cNome = achar(['Nome da Organização', 'Organização', 'Nome']) || cabecalhos[0];
        const cEndereco = achar(['Endereco', 'Endereço']);
        const cLat = cabecalhos.find((h) => /^lat(itude)?$/i.test(h));
        const cLon = cabecalhos.find((h) => /^(lon|lng|long|longitude)$/i.test(h));
        const cCategoria = achar(['Categoria', 'Categorias', 'Tipo']);
        const cSubpref = achar(['Subprefeitura', 'Sub-prefeitura']);
        const cId = achar(['ID', 'Id']);
        const cSituacao = achar(['Situação', 'Situacao', 'Status']);
        const cAtualizadoEm = achar(['Atualizado em']);
        const cAtualizadoPor = achar(['Atualizado por']);

        // campos      → exportação (.xlsx): sem ID, sem coordenadas
        // camposPopup → balão do mapa: idem
        const campos = cabecalhos.filter((h) => !COLUNAS_INTERNAS.includes(normalizar(h)));
        const camposPopup = campos.filter((h) => h !== cNome);

        const contagemCategoria = new Map();
        const contagemSubpref = new Map();
        const contagemSituacao = new Map();

        const features = [];
        let geocodificados = 0, pendentes = 0, encerradas = 0;
        let porCoordenada = 0, porEndereco = 0, novos = 0;

        for (const linha of registros) {
            const nome = String(linha[cNome] || '').trim();
            if (!nome) continue;

            const endereco = cEndereco ? String(linha[cEndereco] || '').trim() : '';
            const categoria = (cCategoria && String(linha[cCategoria] || '').trim()) || SEM_VALOR;
            const subpref = (cSubpref && String(linha[cSubpref] || '').trim()) || SEM_VALOR;
            const situacao = (cSituacao && String(linha[cSituacao] || '').trim()) || 'Em funcionamento';
            const encerrada = normalizar(situacao) === normalizar(SITUACAO_ENCERRADA);

            if (encerrada) encerradas++;
            contagemCategoria.set(categoria, (contagemCategoria.get(categoria) || 0) + 1);
            contagemSubpref.set(subpref, (contagemSubpref.get(subpref) || 0) + 1);
            contagemSituacao.set(situacao, (contagemSituacao.get(situacao) || 0) + 1);

            const props = {};
            for (const c of campos) props[c] = String(linha[c] ?? '').trim();

            let ponto = null, origem = '';

            /* 1. Coordenadas da planilha */
            if (cLat && cLon) {
                let lat = parseCoord(linha[cLat]);
                let lon = parseCoord(linha[cLon]);
                if (Number.isFinite(lat) && Number.isFinite(lon)) {
                    let precisao = 'coordenada cadastrada';
                    if (!dentroDaRegiao(lat, lon) && dentroDaRegiao(lon, lat)) {
                        [lat, lon] = [lon, lat];
                        precisao = 'coordenada cadastrada (lat/long invertidas — corrigido)';
                    } else if (!dentroDaRegiao(lat, lon)) {
                        precisao = 'coordenada cadastrada (fora da região esperada)';
                    }
                    ponto = { lat, lon, precisao };
                    origem = 'planilha';
                    porCoordenada++;
                }
            }

            /* 2. Cache */
            const chave = normalizar(endereco);
            if (!ponto && chave && cacheGeo.has(chave)) {
                const cacheado = cacheGeo.get(chave);
                if (cacheado) { ponto = cacheado; origem = 'cache'; porEndereco++; }
            }

            /* 3. Resolução pelo endereço (link do Maps, coordenada colada ou texto) */
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
                        cacheGeo.set(chave, null);
                    }
                }
            }

            const meta = {
                _id: cId ? String(linha[cId] || '').trim() : '',
                _categoria: categoria,
                _subprefeitura: subpref,
                _situacao: situacao,
                _encerrada: encerrada,
                _atualizadoEm: cAtualizadoEm ? String(linha[cAtualizadoEm] || '').trim() : '',
                _atualizadoPor: cAtualizadoPor ? String(linha[cAtualizadoPor] || '').trim() : ''
            };

            if (ponto) {
                geocodificados++;
                features.push({
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: [ponto.lon, ponto.lat] },
                    properties: { ...props, ...meta, _precisao: ponto.precisao, _origem: origem }
                });
            } else {
                pendentes++;
                features.push({
                    type: 'Feature',
                    geometry: null,
                    properties: { ...props, ...meta, _precisao: 'não localizado', _origem: '' }
                });
            }
        }

        const payload = {
            type: 'FeatureCollection',
            features,
            meta: {
                campos, camposPopup,
                colunaNome: cNome,
                colunaEndereco: cEndereco || 'Endereco',
                colunaCategoria: cCategoria,
                colunaSubprefeitura: cSubpref,
                categorias: ordenarContagem(contagemCategoria),
                subprefeituras: ordenarContagem(contagemSubpref),
                situacoes: ordenarSituacao(contagemSituacao),
                total: features.length,
                geocodificados, porCoordenada, porEndereco, pendentes, encerradas,
                fonte: PLANILHA_ATIVA ? 'apps-script' : 'csv-publico',
                atualizado: new Date().toISOString(),
                duracaoMs: Date.now() - inicio
            }
        };

        // Com o Apps Script o cache é curto: edições precisam aparecer rápido
        const segundos = pendentes > 0 ? 30 : (PLANILHA_ATIVA ? 60 : 900);
        return responder(res, payload, segundos);

    } catch (erro) {
        res.setHeader('Cache-Control', 'no-store');
        return res.status(500).json({
            type: 'FeatureCollection',
            features: [],
            meta: { erro: erro.message || 'Erro desconhecido ao processar os dados.' }
        });
    }
}

function vazio(aviso) {
    return {
        type: 'FeatureCollection',
        features: [],
        meta: { campos: [], camposPopup: [], categorias: [], subprefeituras: [], situacoes: [], total: 0, geocodificados: 0, pendentes: 0, aviso }
    };
}

/** "Em funcionamento" sempre primeiro; "Encerrada" depois. */
function ordenarSituacao(mapa) {
    const peso = (n) => (normalizar(n) === 'encerrada' ? 1 : 0);
    return [...mapa.entries()]
        .map(([nome, total]) => ({ nome, total }))
        .sort((a, b) => peso(a.nome) - peso(b.nome) || a.nome.localeCompare(b.nome, 'pt-BR'));
}

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
