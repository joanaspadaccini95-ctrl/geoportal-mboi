/**
 * /api/resolver — apoio ao formulário de inclusão
 *
 * POST { acao: 'localizar', valor: '<link do Maps | endereço | coordenadas>' }
 *   → { ok, lat, lon, precisao, endereco }
 *
 * POST { acao: 'reverso', lat, lon }
 *   → { ok, endereco }   (usado quando a pessoa só arrasta o alfinete)
 */

import {
    resolverLocalizacao, nominatimReverso, dentroDaRegiao, BBOX
} from './_geo.js';

export default async function handler(req, res) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');

    if (req.method !== 'POST') {
        return res.status(405).json({ ok: false, erro: 'Método não permitido.' });
    }

    try {
        const corpo = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
        const acao = corpo.acao;

        /* ---------- Coordenada → endereço ---------- */
        if (acao === 'reverso') {
            const lat = Number(corpo.lat);
            const lon = Number(corpo.lon);
            if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
                return res.status(400).json({ ok: false, erro: 'Coordenadas inválidas.' });
            }
            const r = await nominatimReverso(lat, lon);
            return res.status(200).json({
                ok: true,
                endereco: r.endereco,
                candidatosSubprefeitura: r.candidatos,
                bairro: r.bairro
            });
        }

        /* ---------- Link / endereço / coordenadas → ponto ---------- */
        if (acao === 'localizar') {
            const valor = String(corpo.valor || '').trim();
            if (!valor) {
                return res.status(400).json({ ok: false, erro: 'Nada foi informado.' });
            }

            const r = await resolverLocalizacao(valor);
            if (!r) {
                return res.status(200).json({
                    ok: false,
                    erro: 'Não consegui encontrar esse lugar. Tente colar o link do Google Maps ou arraste o alfinete no mapa.'
                });
            }

            // Texto legível para gravar na planilha + subprefeitura
            let reverso = { endereco: '', candidatos: [], bairro: '' };
            try { reverso = await nominatimReverso(r.lat, r.lon); } catch { /* opcional */ }

            return res.status(200).json({
                ok: true,
                lat: r.lat,
                lon: r.lon,
                precisao: r.precisao,
                endereco: reverso.endereco,
                candidatosSubprefeitura: reverso.candidatos,
                bairro: reverso.bairro,
                foraDaRegiao: !dentroDaRegiao(r.lat, r.lon)
            });
        }

        return res.status(400).json({ ok: false, erro: 'Ação desconhecida.' });

    } catch (erro) {
        return res.status(500).json({ ok: false, erro: erro.message || 'Erro inesperado.' });
    }
}
