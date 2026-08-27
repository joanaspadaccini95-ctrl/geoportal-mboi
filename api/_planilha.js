/**
 * api/_planilha.js — canal único de conversa com a planilha
 *
 * Todo acesso à planilha (leitura e escrita) passa por aqui, e daqui para o
 * Apps Script. O navegador nunca fala com a planilha: a URL e o código de
 * acesso vivem só em variáveis de ambiente da Vercel.
 */

export const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL || '';
export const CODIGO_ACESSO = process.env.CODIGO_ACESSO || '';
export const PLANILHA_ATIVA = Boolean(APPS_SCRIPT_URL);

const TIMEOUT_MS = 20000;

/**
 * Envia uma ação ao Apps Script e devolve a resposta já em objeto.
 * O código de acesso é acrescentado aqui — quem chama não precisa saber dele.
 */
export async function chamarPlanilha(corpo) {
    if (!APPS_SCRIPT_URL) {
        return { ok: false, erro: 'A planilha não foi configurada (falta APPS_SCRIPT_URL).' };
    }

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

    try {
        const resp = await fetch(APPS_SCRIPT_URL, {
            method: 'POST',
            signal: ctrl.signal,
            redirect: 'follow',
            // text/plain evita o "preflight" do Apps Script
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ ...corpo, codigo: CODIGO_ACESSO })
        });

        const texto = await resp.text();
        try {
            return JSON.parse(texto);
        } catch {
            return { ok: false, erro: 'Resposta inesperada da planilha: ' + texto.slice(0, 160) };
        }

    } catch (erro) {
        return {
            ok: false,
            erro: erro && erro.name === 'AbortError'
                ? 'A planilha demorou demais para responder. Tente de novo em instantes.'
                : 'Falha ao falar com a planilha: ' + (erro.message || 'erro desconhecido')
        };
    } finally {
        clearTimeout(t);
    }
}
