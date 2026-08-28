/**
 * incluir.js — cadastro e edição de organizações
 *
 * Duas formas de abrir a página:
 *   incluir.html            → cadastro novo
 *   incluir.html?id=ORG-XX  → edição de um registro existente
 *
 * O ALFINETE É A FONTE DA VERDADE. Link do Maps, endereço digitado e arraste
 * manual são três maneiras de posicioná-lo; o que é gravado é sempre a
 * coordenada final.
 */

document.addEventListener('DOMContentLoaded', () => {

    const el = (id) => document.getElementById(id);
    const CHAVE_QUEM = 'mboi_quem';

    const state = {
        map: null,
        alfinete: null,
        posicionado: false,
        enviando: false,
        reverseTimer: null,
        idEdicao: new URLSearchParams(location.search).get('id') || '',
        registro: null
    };

    /* ======================================================================
       1. MAPA
       ====================================================================== */

    function iniciarMapa() {
        state.map = L.map('mapa', { center: CONFIG.mapa.center, zoom: CONFIG.mapa.zoom });

        // Satélite primeiro: é mais fácil reconhecer o telhado do que o nome da rua
        const base = CONFIG.baseMaps[0];
        L.tileLayer(base.url, { attribution: base.attribution, maxZoom: base.maxZoom }).addTo(state.map);

        const icone = L.divIcon({
            className: 'marcador-form',
            html: '<div class="pino-form"><i class="fa-solid fa-location-dot"></i></div>',
            iconSize: [36, 36], iconAnchor: [18, 18]
        });

        state.alfinete = L.marker(CONFIG.mapa.center, { icon: icone, draggable: true }).addTo(state.map);

        state.alfinete.on('dragend', () => confirmarPosicao(state.alfinete.getLatLng()));
        state.map.on('click', (e) => {
            state.alfinete.setLatLng(e.latlng);
            confirmarPosicao(e.latlng);
        });
    }

    function confirmarPosicao(p) {
        state.posicionado = true;
        avisar('ok', 'fa-circle-check', `Posição marcada: ${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`);
        buscarEnderecoDaPosicao(true);
    }

    function avisar(tipo, icone, texto) {
        const caixa = el('statusMapa');
        caixa.className = `status-mapa ${tipo}`;
        caixa.innerHTML = `<i class="fa-solid ${icone}"></i><div>${texto}</div>`;
    }

    /* ======================================================================
       2. LOCALIZAR
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
                    'Achei o lugar, mas ele está fora da região atendida. Confira antes de enviar.');
            } else {
                avisar('ok', 'fa-circle-check',
                    `Encontrado por ${d.precisao}. <strong>Confira no mapa</strong> e arraste o alfinete se precisar ajustar.`);
            }
        } catch {
            avisar('erro', 'fa-circle-exclamation', 'Falha de conexão. Tente de novo.');
        } finally {
            btn.disabled = false;
        }
    }

    function buscarEnderecoDaPosicao(somenteSeVazio) {
        clearTimeout(state.reverseTimer);
        state.reverseTimer = setTimeout(async () => {
            if (somenteSeVazio && el('endereco').value.trim()) return;
            const p = state.alfinete.getLatLng();
            try {
                const resp = await fetch('/api/resolver', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ acao: 'reverso', lat: p.lat, lon: p.lng })
                });
                const d = await resp.json();
                if (d.ok && d.endereco && !el('endereco').value.trim()) el('endereco').value = d.endereco;
            } catch { /* o campo pode ser preenchido à mão */ }
        }, 700);
    }

    /* ======================================================================
       3. LISTAS
       ====================================================================== */

    async function preencherListas() {
        const nomes = new Set(Object.keys(CONFIG.categorias || {}));
        const subs = new Set(CONFIG.subprefeituras || []);

        try {
            const resp = await fetch(CONFIG.apiPath);
            const d = await resp.json();
            (d.meta?.categorias || []).forEach((c) => { if (c.nome !== CONFIG.semValor) nomes.add(c.nome); });
            (d.meta?.subprefeituras || []).forEach((s) => { if (s.nome !== CONFIG.semValor) subs.add(s.nome); });
        } catch { /* segue com o config.js */ }

        preencherSelect('categoria', [...nomes].sort((a, b) => a.localeCompare(b, 'pt-BR')));
        preencherSelect('subprefeitura', [...subs].sort((a, b) => a.localeCompare(b, 'pt-BR')));
    }

    function preencherSelect(id, valores) {
        const select = el(id);
        const atual = select.value;
        valores.forEach((v) => {
            if ([...select.options].some((o) => o.value === v)) return;
            const opt = document.createElement('option');
            opt.value = v; opt.textContent = v;
            select.appendChild(opt);
        });
        if (atual) select.value = atual;
    }

    /* ======================================================================
       4. MODO EDIÇÃO
       ====================================================================== */

    function valorPorNome(reg, candidatos) {
        const chaves = Object.keys(reg);
        for (const cand of candidatos) {
            const k = chaves.find((c) =>
                c.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim() ===
                cand.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim());
            if (k) return reg[k];
        }
        return '';
    }

    async function carregarParaEdicao() {
        el('tituloPagina').textContent = 'Editar organização';
        el('cabecalhoTitulo').textContent = 'Editar organização';
        el('btnEnviar').innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Salvar alterações';
        el('avisoEdicao').hidden = false;

        try {
            const resp = await fetch(`/api/registro?id=${encodeURIComponent(state.idEdicao)}`);
            const d = await resp.json();
            if (!d.ok) {
                mostrarResultado(false, d.erro || 'Não encontrei essa organização.');
                el('formulario').style.display = 'none';
                return;
            }

            const reg = d.registro;
            state.registro = reg;

            el('nome').value = valorPorNome(reg, ['Nome da Organização', 'Organização', 'Nome']);
            el('servicos').value = valorPorNome(reg, ['Serviços oferecidos', 'Servicos']);
            el('endereco').value = valorPorNome(reg, ['Endereco', 'Endereço']);
            el('contato').value = valorPorNome(reg, ['Contato']);

            const cat = valorPorNome(reg, ['Categoria']);
            const sub = valorPorNome(reg, ['Subprefeitura']);
            if (cat) preencherSelect('categoria', [cat]), (el('categoria').value = cat);
            if (sub) preencherSelect('subprefeitura', [sub]), (el('subprefeitura').value = sub);

            const lat = parseFloat(String(valorPorNome(reg, ['Latitude'])).replace(',', '.'));
            const lon = parseFloat(String(valorPorNome(reg, ['Longitude'])).replace(',', '.'));
            if (Number.isFinite(lat) && Number.isFinite(lon)) {
                state.alfinete.setLatLng([lat, lon]);
                state.map.setView([lat, lon], 18);
                state.posicionado = true;
                avisar('ok', 'fa-circle-check',
                    'Esta é a posição cadastrada. Arraste o alfinete se precisar corrigir.');
            }
        } catch {
            mostrarResultado(false, 'Falha ao carregar os dados. Recarregue a página.');
        }
    }

    /* ======================================================================
       5. ENVIO
       ====================================================================== */

    async function verificarAtivo() {
        try {
            const resp = await fetch('/api/registro');
            const d = await resp.json();
            if (!d.ativo) {
                el('avisoDesativado').style.display = 'block';
                el('formulario').style.display = 'none';
                return false;
            }
            return true;
        } catch { return true; }
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
        const quem = el('quem').value.trim();
        if (!state.posicionado) {
            mostrarResultado(false, 'Marque o local no mapa: cole o link do Google Maps ou arraste o alfinete vermelho.');
            el('mapa').scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
        }

        const p = state.alfinete.getLatLng();
        const dados = {
            acao: state.idEdicao ? 'editar' : 'incluir',
            id: state.idEdicao,
            nome,
            servicos: el('servicos').value.trim(),
            endereco: el('endereco').value.trim(),
            contato: el('contato').value.trim(),
            categoria: el('categoria').value,
            subprefeitura: el('subprefeitura').value,
            quem,
            lat: p.lat,
            lon: p.lng
        };

        state.enviando = true;
        const btn = el('btnEnviar');
        const rotuloOriginal = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Enviando…';

        try {
            const resp = await fetch('/api/registro', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(dados)
            });
            const d = await resp.json();

            if (d.ok) {
                lembrar(quem);
                if (state.idEdicao) {
                    mostrarResultado(true,
                        `<strong>Alterações salvas.</strong><br>` +
                        `<a href="./index.html" style="color:#1c5c34;font-weight:700">Voltar ao mapa</a>`);
                } else {
                    mostrarResultado(true,
                        `<strong>Pronto! ${escapar(nome)} foi cadastrada.</strong><br>` +
                        `<a href="./index.html" style="color:#1c5c34;font-weight:700">Ver no mapa</a> ou ` +
                        `<a href="./incluir.html" style="color:#1c5c34;font-weight:700">cadastrar outra</a>.`);
                    el('formulario').querySelectorAll('input, textarea, select').forEach((c) => {
                        if (c.id !== 'quem') c.value = '';
                    });
                    state.posicionado = false;
                }
            } else {
                mostrarResultado(false, d.erro || 'Não foi possível salvar.');
            }
        } catch {
            mostrarResultado(false, 'Falha de conexão. Confira sua internet e tente de novo.');
        } finally {
            state.enviando = false;
            btn.disabled = false;
            btn.innerHTML = rotuloOriginal;
        }
    }

    /* ======================================================================
       6. AUXILIARES
       ====================================================================== */

    function lembrar(quem) {
        try { if (quem) localStorage.setItem(CHAVE_QUEM, quem); }
        catch { /* navegador pode bloquear */ }
    }

    function recuperarLembrados() {
        try {
            const q = localStorage.getItem(CHAVE_QUEM);
            if (q) el('quem').value = q;
        } catch { /* segue vazio */ }
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
       7. LIGAÇÕES
       ====================================================================== */

    (async function iniciar() {
        iniciarMapa();
        recuperarLembrados();
        await preencherListas();
        const ativo = await verificarAtivo();
        if (ativo && state.idEdicao) await carregarParaEdicao();
    })();

    el('btnLocalizar').addEventListener('click', localizar);
    el('entradaLocal').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); localizar(); }
    });
    el('formulario').addEventListener('submit', enviar);
});
