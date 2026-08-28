/**
 * /api/registro — inclui, edita e muda a situação de uma organização
 *
 * GET                          → { ok, ativo, exigeCodigo }
 * GET  ?id=ORG-XXXX            → { ok, registro }        (para preencher o formulário de edição)
 * POST { acao: 'incluir',  … } → cria
 * POST { acao: 'editar',   … } → altera um registro existente (exige id)
 * POST { acao: 'situacao', … } → marca como encerrada ou confirma funcionamento
 *
 * Nada é apagado: encerrar é uma marcação, e fica registrado quem e quando.
 */

import { dentroDaRegiao } from './_geo.js';
import { chamarPlanilha, PLANILHA_ATIVA } from './_planilha.js';

const LIMITE_TEXTO = 500;
const SITUACAO_ATIVA = 'Em funcionamento';
const SITUACAO_ENCERRADA = 'Encerrada';

function limpar(txt) {
    return String(txt ?? '').trim().slice(0, LIMITE_TEXTO);
}

/** Number(null) e Number('') devolvem 0, o que passaria no isFinite. */
function numero(valor) {
    if (valor === null || valor === undefined || String(valor).trim() === '') return NaN;
    const n = Number(valor);
    return Number.isFinite(n) ? n : NaN;
}

export default async function handler(req, res) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');

    /* ================= GET ================= */
    if (req.method === 'GET') {
        const id = limpar(req.query?.id);

        if (!id) {
            return res.status(200).json({ ok: true, ativo: PLANILHA_ATIVA });
        }

        if (!PLANILHA_ATIVA) {
            return res.status(503).json({ ok: false, erro: 'A planilha não foi configurada.' });
        }

        const r = await chamarPlanilha({ acao: 'listar' });
        if (!r || r.ok === false) {
            return res.status(502).json({ ok: false, erro: (r && r.erro) || 'Falha ao ler a planilha.' });
        }

        const alvo = (r.registros || []).find((reg) => {
            const chave = Object.keys(reg).find((k) => k.trim().toUpperCase() === 'ID');
            return chave && String(reg[chave]).trim() === id;
        });

        if (!alvo) return res.status(404).json({ ok: false, erro: 'Organização não encontrada.' });
        return res.status(200).json({ ok: true, registro: alvo });
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ ok: false, erro: 'Método não permitido.' });
    }

    if (!PLANILHA_ATIVA) {
        return res.status(503).json({
            ok: false,
            erro: 'A inclusão pelo site ainda não foi configurada. Avise a pessoa responsável.'
        });
    }

    try {
        const corpo = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

        // Sem código de acesso: qualquer pessoa pode incluir, corrigir e mudar a
        // situação. A URL do Apps Script continua protegida — ela só é conhecida
        // pelo servidor, e o código dela é acrescentado em _planilha.js.
        const quem = limpar(corpo.quem) || 'Não informado';

        const acao = corpo.acao || 'incluir';

        /* ============ MUDANÇA DE SITUAÇÃO ============ */
        if (acao === 'situacao') {
            const id = limpar(corpo.id);
            if (!id) return res.status(400).json({ ok: false, erro: 'Registro não identificado.' });

            const situacao = String(corpo.situacao) === SITUACAO_ENCERRADA
                ? SITUACAO_ENCERRADA : SITUACAO_ATIVA;

            const r = await chamarPlanilha({
                acao: 'situacao', id, situacao, quem,
                observacao: limpar(corpo.observacao)
            });

            if (!r || r.ok === false) {
                return res.status(502).json({ ok: false, erro: (r && r.erro) || 'Não foi possível registrar.' });
            }
            return res.status(200).json({ ok: true, mensagem: r.mensagem || 'Registrado.' });
        }

        /* ============ INCLUIR / EDITAR ============ */
        const nome = limpar(corpo.nome);
        if (nome.length < 3) {
            return res.status(400).json({ ok: false, erro: 'Informe o nome da organização.' });
        }

        const lat = numero(corpo.lat);
        const lon = numero(corpo.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
            return res.status(400).json({ ok: false, erro: 'Marque o local no mapa antes de enviar.' });
        }
        if (!dentroDaRegiao(lat, lon)) {
            return res.status(400).json({
                ok: false,
                erro: 'O alfinete está fora da região atendida. Confira a posição no mapa.'
            });
        }

        const registro = {
            nome,
            servicos: limpar(corpo.servicos),
            endereco: limpar(corpo.endereco),
            latitude: lat.toFixed(6),
            longitude: lon.toFixed(6),
            contato: limpar(corpo.contato),
            categoria: limpar(corpo.categoria),
            subprefeitura: limpar(corpo.subprefeitura),
            quem
        };

        if (acao === 'editar') {
            const id = limpar(corpo.id);
            if (!id) return res.status(400).json({ ok: false, erro: 'Registro não identificado.' });

            const r = await chamarPlanilha({ acao: 'editar', id, ...registro });
            if (!r || r.ok === false) {
                return res.status(502).json({ ok: false, erro: (r && r.erro) || 'Não foi possível salvar.' });
            }
            return res.status(200).json({ ok: true, mensagem: 'Organização atualizada.' });
        }

        const r = await chamarPlanilha({ acao: 'incluir', ...registro });
        if (!r || r.ok === false) {
            return res.status(502).json({ ok: false, erro: (r && r.erro) || 'Não foi possível cadastrar.' });
        }
        return res.status(200).json({ ok: true, mensagem: 'Organização cadastrada.', id: r.id });

    } catch (erro) {
        return res.status(500).json({ ok: false, erro: erro.message || 'Erro inesperado.' });
    }
}
