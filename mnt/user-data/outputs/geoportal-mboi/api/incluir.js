/**
 * /api/incluir — grava uma organização nova na planilha
 *
 * O navegador NUNCA fala com a planilha diretamente. O caminho é:
 *   formulário → /api/incluir (valida) → Google Apps Script (grava)
 *
 * Assim a URL do Apps Script e o código de acesso ficam só no servidor,
 * fora do alcance de quem abrir o código-fonte da página.
 *
 * Variáveis de ambiente necessárias na Vercel:
 *   APPS_SCRIPT_URL   URL do Web App publicado a partir da planilha
 *   CODIGO_ACESSO     senha combinada com a equipe (ex.: mboi2026)
 */

import { dentroDaRegiao } from './_geo.js';

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL || '';
const CODIGO_ACESSO = process.env.CODIGO_ACESSO || '';

const LIMITE_TEXTO = 500;

function limpar(txt) {
    return String(txt ?? '').trim().slice(0, LIMITE_TEXTO);
}

export default async function handler(req, res) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');

    /* ---------- GET: o formulário pergunta se a inclusão está ativa ---------- */
    if (req.method === 'GET') {
        return res.status(200).json({
            ok: true,
            ativo: Boolean(APPS_SCRIPT_URL),
            exigeCodigo: Boolean(CODIGO_ACESSO)
        });
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ ok: false, erro: 'Método não permitido.' });
    }

    if (!APPS_SCRIPT_URL) {
        return res.status(503).json({
            ok: false,
            erro: 'A inclusão pelo site ainda não foi configurada. Use a planilha por enquanto.'
        });
    }

    try {
        const corpo = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

        /* ---------- Código de acesso ---------- */
        if (CODIGO_ACESSO && limpar(corpo.codigo) !== CODIGO_ACESSO) {
            return res.status(403).json({ ok: false, erro: 'Código de acesso incorreto.' });
        }

        /* ---------- Validação ---------- */
        const nome = limpar(corpo.nome);
        if (nome.length < 3) {
            return res.status(400).json({ ok: false, erro: 'Informe o nome da organização.' });
        }

        // Atenção: Number(null) e Number('') devolvem 0, que passaria no isFinite.
        // Por isso a checagem de "veio vazio" vem antes da conversão.
        const veioLat = corpo.lat !== null && corpo.lat !== undefined && String(corpo.lat).trim() !== '';
        const veioLon = corpo.lon !== null && corpo.lon !== undefined && String(corpo.lon).trim() !== '';
        const lat = veioLat ? Number(corpo.lat) : NaN;
        const lon = veioLon ? Number(corpo.lon) : NaN;

        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
            return res.status(400).json({ ok: false, erro: 'Marque o local no mapa antes de enviar.' });
        }
        if (!dentroDaRegiao(lat, lon)) {
            return res.status(400).json({
                ok: false,
                erro: 'O alfinete está fora da região atendida. Confira a posição no mapa.'
            });
        }

        /* ---------- Monta o registro ---------- */
        const registro = {
            nome,
            servicos: limpar(corpo.servicos),
            endereco: limpar(corpo.endereco),
            latitude: lat.toFixed(6),
            longitude: lon.toFixed(6),
            contato: limpar(corpo.contato),
            categoria: limpar(corpo.categoria),
            subprefeitura: limpar(corpo.subprefeitura)
        };

        /* ---------- Encaminha para o Apps Script ---------- */
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 15000);

        let resposta;
        try {
            const r = await fetch(APPS_SCRIPT_URL, {
                method: 'POST',
                signal: ctrl.signal,
                redirect: 'follow',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({ ...registro, codigo: CODIGO_ACESSO })
            });
            const texto = await r.text();
            try { resposta = JSON.parse(texto); }
            catch { resposta = { ok: r.ok, mensagem: texto.slice(0, 200) }; }
        } finally {
            clearTimeout(t);
        }

        if (!resposta || resposta.ok === false) {
            return res.status(502).json({
                ok: false,
                erro: (resposta && resposta.erro) || 'A planilha recusou o envio. Avise a pessoa responsável.'
            });
        }

        return res.status(200).json({ ok: true, mensagem: 'Organização cadastrada!' });

    } catch (erro) {
        const abortou = erro && erro.name === 'AbortError';
        return res.status(500).json({
            ok: false,
            erro: abortou
                ? 'A planilha demorou demais para responder. Tente de novo em instantes.'
                : (erro.message || 'Erro inesperado ao gravar.')
        });
    }
}
