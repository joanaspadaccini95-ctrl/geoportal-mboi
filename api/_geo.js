/**
 * api/_geo.js — Biblioteca compartilhada de localização
 *
 * Arquivos começados com "_" NÃO viram endpoints na Vercel: é um módulo interno,
 * usado por api/dados.js (leitura da planilha) e api/resolver.js (formulário).
 *
 * Resolve, em ordem de confiabilidade:
 *   1. Coordenadas cruas coladas ("-23.68, -46.79")
 *   2. Link do Google Maps (curto ou longo) → coordenadas exatas
 *   3. Endereço em texto → Nominatim / ViaCEP
 */

export const USER_AGENT =
    process.env.GEOCODER_UA || 'geoportal-mboi-mirim/1.0 (mapa de organizacoes parceiras)';

// Retângulo de sanidade: região do M'Boi Mirim / Zona Sul de SP
export const BBOX = { latMin: -23.92, latMax: -23.55, lonMin: -46.92, lonMax: -46.60 };
export const VIEWBOX = `${BBOX.lonMin},${BBOX.latMax},${BBOX.lonMax},${BBOX.latMin}`;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function dentroDaRegiao(lat, lon) {
    return lat >= BBOX.latMin && lat <= BBOX.latMax && lon >= BBOX.lonMin && lon <= BBOX.lonMax;
}

export function normalizar(txt) {
    return String(txt || '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

export function soDigitos(txt) {
    return String(txt || '').replace(/\D/g, '');
}

/**
 * Converte texto em decimal, tolerando os estragos que o Google Sheets faz
 * com coordenadas em planilhas no idioma português.
 *
 * Aceita:
 *   "-23.685918"    ponto decimal
 *   "-23,685918"    vírgula decimal
 *   "-23.659.912"   o Sheets leu o ponto como separador de MILHAR e guardou
 *                   o inteiro -23659912; aqui ele é reconstruído
 *   -23659912       o mesmo caso, já como número
 */
export function parseCoord(valor) {
    const txt = String(valor ?? '').trim();
    if (!txt) return NaN;

    let limpo = txt.replace(/\s/g, '');
    const pontos = (limpo.match(/\./g) || []).length;
    const virgulas = (limpo.match(/,/g) || []).length;

    if (virgulas && pontos) {
        // Tem os dois: o último separador é o decimal
        limpo = limpo.lastIndexOf(',') > limpo.lastIndexOf('.')
            ? limpo.replace(/\./g, '').replace(',', '.')
            : limpo.replace(/,/g, '');
    } else if (pontos > 1) {
        // "-23.659.912" — pontos como separador de milhar
        limpo = limpo.replace(/\./g, '');
    } else if (virgulas > 1) {
        limpo = limpo.replace(/,/g, '');
    } else {
        limpo = limpo.replace(',', '.');
    }

    let n = parseFloat(limpo);
    if (!Number.isFinite(n)) return NaN;

    // Coordenada que perdeu o ponto decimal: -23659912 -> -23.659912
    // Divide por 10 até caber em um grau válido.
    const sinal = n < 0 ? -1 : 1;
    let abs = Math.abs(n);
    let voltas = 0;
    while (abs > 180 && voltas < 12) { abs /= 10; voltas++; }

    return sinal * abs;
}

export function extrairCEP(endereco) {
    const m = String(endereco || '').match(/(\d{5})-?(\d{3})(?!\d)/);
    return m ? `${m[1]}${m[2]}` : '';
}

export function extrairNumero(endereco) {
    const m = String(endereco || '').match(/,\s*(\d{1,6})\b/);
    return m ? m[1] : '';
}

/* ==========================================================================
   REQUISIÇÕES
   ========================================================================== */

// Fila serializada: 1 requisição a cada 1,1 s (política do Nominatim)
let fila = Promise.resolve();
export function enfileirar(fn) {
    const resultado = fila.then(fn, fn);
    fila = resultado.then(() => sleep(1100), () => sleep(1100));
    return resultado;
}

export async function buscarJSON(url, timeoutMs = 8000) {
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

export async function nominatim(params, exigirRegiao = true) {
    const qs = new URLSearchParams({
        format: 'jsonv2', limit: '3', countrycodes: 'br',
        viewbox: VIEWBOX, addressdetails: '0', ...params
    });
    const dados = await enfileirar(() =>
        buscarJSON(`https://nominatim.openstreetmap.org/search?${qs.toString()}`)
    );
    if (!Array.isArray(dados)) return null;

    for (const item of dados) {
        const lat = parseFloat(item.lat);
        const lon = parseFloat(item.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        if (exigirRegiao && !dentroDaRegiao(lat, lon)) continue;
        return { lat, lon, rotulo: item.display_name || '' };
    }
    return null;
}

/** Coordenada → endereço em texto (usado quando a pessoa só arrasta o alfinete). */
export async function nominatimReverso(lat, lon) {
    const qs = new URLSearchParams({
        format: 'jsonv2', lat: String(lat), lon: String(lon),
        zoom: '18', addressdetails: '1'
    });
    const d = await enfileirar(() =>
        buscarJSON(`https://nominatim.openstreetmap.org/reverse?${qs.toString()}`)
    );
    if (!d || !d.address) return '';

    const a = d.address;
    const partes = [];
    if (a.road) partes.push(a.house_number ? `${a.road}, ${a.house_number}` : a.road);
    if (a.suburb || a.neighbourhood) partes.push(a.suburb || a.neighbourhood);
    partes.push(`${a.city || a.town || 'São Paulo'} - ${a.state_code || 'SP'}`);
    if (a.postcode) partes.push(a.postcode);

    return partes.filter(Boolean).join(', ') || (d.display_name || '');
}

export async function viaCep(cep) {
    const limpo = soDigitos(cep);
    if (limpo.length !== 8) return null;
    return await buscarJSON(`https://viacep.com.br/ws/${limpo}/json/`, 6000);
}

/* ==========================================================================
   COORDENADAS CRUAS E LINKS DO GOOGLE MAPS
   ========================================================================== */

/** Reconhece "-23.685918, -46.792683" (ou com vírgula decimal) colado direto. */
export function extrairCoordsDeTexto(texto) {
    const txt = String(texto || '').trim();

    // Formato com ponto decimal: -23.68, -46.79
    let m = txt.match(/^(-?\d{1,3}\.\d+)\s*[,;]\s*(-?\d{1,3}\.\d+)$/);
    // Formato com vírgula decimal: -23,68, -46,79  (separador é a vírgula solta)
    if (!m) m = txt.match(/^(-?\d{1,3},\d+)\s*[;]\s*(-?\d{1,3},\d+)$/);
    if (!m) {
        const p = txt.match(/^(-?\d{1,3},\d+),\s*(-?\d{1,3},\d+)$/);
        if (p) m = p;
    }
    if (!m) return null;

    const lat = parseCoord(m[1]);
    const lon = parseCoord(m[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    return { lat, lon };
}

export function pareceLink(texto) {
    return /^https?:\/\/|(^|\s)(maps\.app\.goo\.gl|goo\.gl\/maps|maps\.google|google\.[a-z.]+\/maps)/i
        .test(String(texto || '').trim());
}

/** Segue o redirecionamento de links encurtados (maps.app.goo.gl). */
async function expandirLink(url) {
    let atual = url;
    for (let i = 0; i < 5; i++) {
        try {
            const resp = await fetch(atual, {
                redirect: 'manual',
                headers: { 'User-Agent': 'Mozilla/5.0 (compatible; geoportal-mboi/1.0)' }
            });
            const destino = resp.headers.get('location');
            if (destino && /^https?:/i.test(destino)) { atual = destino; continue; }

            // Sem cabeçalho Location: pode já ser a URL final, ou o redirect foi seguido
            if (resp.url && resp.url !== atual) { atual = resp.url; continue; }
            break;
        } catch {
            break;
        }
    }
    return atual;
}

/**
 * Extrai coordenadas de uma URL do Google Maps já expandida.
 * Ordem de preferência: !3d/!4d (coordenada do local) > q=/query= > @ (centro do mapa).
 */
export function coordsDeUrlMaps(url) {
    const txt = decodeURIComponent(String(url || ''));

    // !3d<lat>!4d<lon> — a coordenada real do estabelecimento
    let m = txt.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
    if (m) return { lat: parseFloat(m[1]), lon: parseFloat(m[2]), precisao: 'link do Google Maps (local)' };

    // ?q=lat,lng  /  ?query=lat,lng  /  ll=lat,lng
    m = txt.match(/[?&](?:q|query|ll|center|destination)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/);
    if (m) return { lat: parseFloat(m[1]), lon: parseFloat(m[2]), precisao: 'link do Google Maps' };

    // @lat,lng,zoom — centro do mapa no momento do compartilhamento
    m = txt.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (m) return { lat: parseFloat(m[1]), lon: parseFloat(m[2]), precisao: 'link do Google Maps (centro)' };

    return null;
}

/** Link do Google Maps (curto ou longo) → coordenadas. */
export async function resolverLinkMaps(texto) {
    const url = String(texto || '').trim().match(/https?:\/\/\S+/);
    if (!url) return null;

    // Tenta direto (link longo já traz as coordenadas)
    const direto = coordsDeUrlMaps(url[0]);
    if (direto) return direto;

    // Link curto: expande e tenta de novo
    const expandido = await expandirLink(url[0]);
    return coordsDeUrlMaps(expandido);
}

/* ==========================================================================
   CASCATA COMPLETA
   ========================================================================== */

/**
 * Resolve o conteúdo da coluna Endereço, seja ele qual for.
 * Retorna { lat, lon, precisao } ou null.
 */
export async function resolverLocalizacao(endereco) {
    const txt = String(endereco || '').trim();
    if (!txt) return null;

    // 1) Coordenadas coladas direto
    const cru = extrairCoordsDeTexto(txt);
    if (cru) return { ...cru, precisao: 'coordenada colada' };

    // 2) Link do Google Maps
    if (pareceLink(txt)) {
        const doLink = await resolverLinkMaps(txt);
        if (doLink) return doLink;
        return null; // era link mas não deu para ler: não adianta geocodificar a URL
    }

    // 3) Endereço em texto
    return await geocodificarPorEndereco(txt);
}

function prepararEndereco(endereco) {
    let txt = String(endereco || '').trim();
    if (!txt) return '';
    txt = txt.replace(/,?\s*\d{5}-?\d{3}\s*$/, '').trim();
    if (!/s[ãa]o paulo/i.test(txt)) txt += ', São Paulo';
    if (!/\bsp\b/i.test(txt)) txt += ' - SP';
    return `${txt}, Brasil`;
}

export async function geocodificarPorEndereco(endereco) {
    if (!String(endereco || '').trim()) return null;

    const consulta = prepararEndereco(endereco);
    if (consulta) {
        const r = await nominatim({ q: consulta });
        if (r) return { lat: r.lat, lon: r.lon, precisao: 'endereço completo' };
    }

    const cep = extrairCEP(endereco);
    if (cep) {
        const cepInfo = await viaCep(cep);
        if (cepInfo && !cepInfo.erro && cepInfo.logradouro) {
            const numero = extrairNumero(endereco);
            const partes = [
                numero ? `${cepInfo.logradouro}, ${numero}` : cepInfo.logradouro,
                cepInfo.bairro, cepInfo.localidade || 'São Paulo', cepInfo.uf || 'SP', 'Brasil'
            ].filter(Boolean);

            const r = await nominatim({ q: partes.join(', ') });
            if (r) return { lat: r.lat, lon: r.lon, precisao: numero ? 'logradouro + número (via CEP)' : 'logradouro (via CEP)' };

            if (numero) {
                const r2 = await nominatim({
                    q: [cepInfo.logradouro, cepInfo.bairro, 'São Paulo', 'SP', 'Brasil'].filter(Boolean).join(', ')
                });
                if (r2) return { lat: r2.lat, lon: r2.lon, precisao: 'logradouro (via CEP)' };
            }
        }

        const r3 = await nominatim({ postalcode: `${cep.slice(0, 5)}-${cep.slice(5)}`, city: 'São Paulo' });
        if (r3) return { lat: r3.lat, lon: r3.lon, precisao: 'CEP' };
    }

    return null;
}
