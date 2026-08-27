/**
 * incluir.js — formulário de inclusão de organizações
 *
 * O ALFINETE É A FONTE DA VERDADE. O link do Google Maps, o endereço digitado
 * e o arraste manual são apenas três maneiras de posicioná-lo. O que é gravado
 * na planilha é sempre a coordenada final do alfinete.
 */

document.addEventListener('DOMContentLoaded', () => {

    const el = (id) => document.getElementById(id);

    const state = {
        map: null,
        alfinete: null,
        posicionado: false,   // o usuário já confirmou uma posição?
        enviando: false,
        reverseTimer: null
    };

    /* ======================================================================
       1. MAPA
       ====================================================================== */

    function iniciarMapa() {
        state.map = L.map('mapa', {
            center: CONFIG.mapa.center,
            zoom: CONFIG.mapa.zoom
        });

        // Satélite primeiro: é mais fácil reconhecer o telhado do que o nome da rua
        const base = CONFIG.baseMaps[0];
        L.tileLayer(base.url, { attribution: base.attribution, maxZoom: base.maxZoom }).addTo(state.map);

        const icone = L.divIcon({
            className: 'marcador-form',
            html: '<div class="pino-form"><i class="fa-solid fa-location-dot"></i></div>',
            iconSize: [36, 36],
            iconAnchor: [18, 18]
        });

        state.alfinete = L.marker(CONFIG.mapa.center, { icon: icone, draggable: true }).addTo(state.map);

        state.alfinete.on('dragend', () => {
            state.posicionado = true;
            const p = state.alfinete.getLatLng();
            avisar('ok', 'fa-circle-check', `Posição marcada: ${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`);
            buscarEnderecoDaPosicao();
        });

        // Clicar no mapa também move o alfinete
        state.map.on('click', (e) => {
            state.alfinete.setLatLng(e.latlng);
            state.posicionado = true;
            avisar('ok', 'fa-circle-check', `Posição marcada: ${e.latlng.lat.toFixed(6)}, ${e.latlng.lng.toFixed(6)}`);
            buscarEnderecoDaPosicao();
        });
    }

    function avisar(tipo, icone, texto) {
        const caixa = el('statusMapa');
        caixa.className = `status-mapa ${tipo}`;
        caixa.innerHTML = `<i class="fa-solid ${icone}"></i><div>${texto}</div>`;
    }

    /* ======================================================================
       2. LOCALIZAR (link do Maps / endereço / coordenadas)
       ====================================================================== */

    async function localizar() {
        const valor = el('entradaLocal').value.trim();
        if (!valor) {
            avisar('erro', 'fa-circle-exclamation', 'Cole o link do Google Maps ou escreva o endereço.');
            return;
        }

        const btn = el('btnLocalizar');
        btn.disabled = true;
        avisar('neutro', 'fa-spinner fa-spin', 'Procurando o lugar…');

        try {
            const resp = await fetch('/api/resolver', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ acao: 'localizar', valor })
            });
            const d = await resp.json();

            if (!d.ok) {
                avisar('erro', 'fa-circle-exclamation',
                    d.erro || 'Não encontrei esse lugar. Tente arrastar o alfinete no mapa.');
                return;
            }

            state.alfinete.setLatLng([d.lat, d.lon]);
            state.map.setView([d.lat, d.lon], 18);
            state.posicionado = true;

            if (d.endereco && !el('endereco').value.trim()) el('endereco').value = d.endereco;

            if (d.foraDaRegiao) {
                avisar('aviso', 'fa-triangle-exclamation',
                    'Achei o lugar, mas ele está fora da região atendida. Confira se é isso mesmo antes de enviar.');
            } else {
                avisar('ok', 'fa-circle-check',
                    `Encontrado por ${d.precisao}. <strong>Confira no mapa</strong> e arraste o alfinete se precisar ajustar.`);
            }

        } catch (erro) {
            avisar('erro', 'fa-circle-exclamation', 'Falha de conexão. Tente de novo.');
        } finally {
            btn.disabled = false;
        }
    }

    /** Coordenada → endereço, para preencher o campo sozinho. */
    function buscarEnderecoDaPosicao() {
        clearTimeout(state.reverseTimer);
        state.reverseTimer = setTimeout(async () => {
            const p = state.alfinete.getLatLng();
            try {
                const resp = await fetch('/api/resolver', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ acao: 'reverso', lat: p.lat, lon: p.lng })
                });
                const d = await resp.json();
                if (d.ok && d.endereco && !el('endereco').value.trim()) {
                    el('endereco').value = d.endereco;
                }
            } catch { /* silencioso: o campo pode ser preenchido à mão */ }
        }, 700);
    }

    /* ======================================================================
       3. LISTAS DE CATEGORIA E SUBPREFEITURA
       ====================================================================== */

    async function preencherListas() {
        // Categorias configuradas no config.js
        const nomes = new Set(Object.keys(CONFIG.categorias || {}));
        const subs = new Set(CONFIG.subprefeituras || []);

        // Mais as que já existem na planilha (descobertas pela API)
        try {
            const resp = await fetch(CONFIG.apiPath);
            const d = await resp.json();
            (d.meta?.categorias || []).forEach((c) => { if (c.nome !== CONFIG.semValor) nomes.add(c.nome); });
            (d.meta?.subprefeituras || []).forEach((s) => { if (s.nome !== CONFIG.semValor) subs.add(s.nome); });
        } catch { /* segue com o que veio do config.js */ }

        preencherSelect('categoria', [...nomes].sort((a, b) => a.localeCompare(b, 'pt-BR')));
        preencherSelect('subprefeitura', [...subs].sort((a, b) => a.localeCompare(b, 'pt-BR')));
    }

    function preencherSelect(id, valores) {
        const select = el(id);
        valores.forEach((v) => {
            const opt = document.createElement('option');
            opt.value = v;
            opt.textContent = v;
            select.appendChild(opt);
        });
    }

    /* ======================================================================
       4. ENVIO
       ====================================================================== */

    async function verificarAtivo() {
        try {
            const resp = await fetch('/api/incluir');
            const d = await resp.json();
            if (!d.ativo) {
                el('avisoDesativado').style.display = 'block';
                el('formulario').style.display = 'none';
                return;
            }
            if (!d.exigeCodigo) el('campoCodigo').style.display = 'none';
        } catch { /* se falhar, deixa o formulário visível */ }
    }

    async function enviar(evento) {
        evento.preventDefault();
        if (state.enviando) return;

        const nome = el('nome').value.trim();
        if (nome.length < 3) {
            mostrarResultado(false, 'Escreva o nome da organização.');
            el('nome').focus();
            return;
        }
        if (!state.posicionado) {
            mostrarResultado(false, 'Marque o local no mapa antes de enviar: cole o link do Google Maps ou arraste o alfinete vermelho.');
            document.getElementById('mapa').scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
        }

        const p = state.alfinete.getLatLng();
        const dados = {
            nome,
            servicos: el('servicos').value.trim(),
            endereco: el('endereco').value.trim(),
            contato: el('contato').value.trim(),
            categoria: el('categoria').value,
            subprefeitura: el('subprefeitura').value,
            codigo: el('codigo').value.trim(),
            lat: p.lat,
            lon: p.lng
        };

        state.enviando = true;
        const btn = el('btnEnviar');
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Enviando…';

        try {
            const resp = await fetch('/api/incluir', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(dados)
            });
            const d = await resp.json();

            if (d.ok) {
                mostrarResultado(true,
                    `<strong>Pronto! ${escapar(nome)} foi cadastrada.</strong><br>` +
                    `Ela aparece no mapa em alguns instantes. ` +
                    `<a href="./index.html" style="color:#1c5c34;font-weight:700">Ver no mapa</a> ou ` +
                    `<a href="#" id="novoCadastro" style="color:#1c5c34;font-weight:700">cadastrar outra</a>.`);
                el('formulario').querySelectorAll('input, textarea, select').forEach((c) => {
                    if (c.id !== 'codigo') c.value = '';
                });
                state.posicionado = false;
                const link = el('novoCadastro');
                if (link) link.addEventListener('click', (e) => { e.preventDefault(); location.reload(); });
            } else {
                mostrarResultado(false, d.erro || 'Não foi possível cadastrar.');
            }

        } catch (erro) {
            mostrarResultado(false, 'Falha de conexão. Confira sua internet e tente de novo.');
        } finally {
            state.enviando = false;
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Cadastrar organização';
        }
    }

    function mostrarResultado(ok, html) {
        const caixa = el('resultado');
        caixa.className = `resultado ${ok ? 'sucesso' : 'falha'}`;
        caixa.innerHTML = html;
        caixa.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    function escapar(txt) {
        const div = document.createElement('div');
        div.textContent = String(txt ?? '');
        return div.innerHTML;
    }

    /* ======================================================================
       5. LIGAÇÕES
       ====================================================================== */

    iniciarMapa();
    preencherListas();
    verificarAtivo();

    el('btnLocalizar').addEventListener('click', localizar);
    el('entradaLocal').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); localizar(); }
    });
    el('formulario').addEventListener('submit', enviar);
});
