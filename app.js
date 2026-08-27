/**
 * Organizações Parceiras - M'Boi Mirim
 * Aplicação WebGIS (Leaflet) alimentada por planilha Google Sheets via /api/dados
 */

document.addEventListener('DOMContentLoaded', () => {

    const state = {
        map: null,
        baseMapLayers: {},
        activeBaseMapLayer: null,
        camadaPontos: null,

        features: [],            // todas as feições recebidas da API
        visiveis: [],            // feições que passam em busca + filtros
        marcadores: new Map(),   // índice -> layer do Leaflet

        campos: [],              // colunas para exportação (ordem da planilha)
        camposPopup: [],         // colunas exibidas no balão
        colunaNome: CONFIG.colunas.nome,
        colunaEndereco: CONFIG.colunas.endereco,

        categorias: [],          // [{nome, total}]
        subprefeituras: [],      // [{nome, total}]
        estiloCategoria: new Map(), // nome -> {cor, icone}

        filtroCategoria: new Set(),   // vazio = tudo marcado ainda não inicializado
        filtroSubpref: new Set(),

        selecionado: null,
        carregando: false
    };

    /* ======================================================================
       1. INICIALIZAÇÃO
       ====================================================================== */

    function init() {
        document.getElementById('appTitle').textContent = CONFIG.title;
        document.getElementById('appSubtitle').textContent = CONFIG.subtitle;
        document.title = CONFIG.title;

        if (CONFIG.planilhaUrl) {
            const link = document.getElementById('btnPlanilha');
            link.href = CONFIG.planilhaUrl;
            link.hidden = false;
        }
        if (CONFIG.incluirUrl) {
            const link = document.getElementById('btnIncluir');
            link.href = CONFIG.incluirUrl;
            link.hidden = false;
        }
        if (CONFIG.instrucoesUrl) {
            const link = document.getElementById('btnInstrucoes');
            link.href = CONFIG.instrucoesUrl;
            link.hidden = false;
        }

        initMap();
        setupEventListeners();
        carregarDados();
    }

    function initMap() {
        state.map = L.map('map', {
            center: CONFIG.mapa.center,
            zoom: CONFIG.mapa.zoom,
            zoomControl: false
        });

        L.control.zoom({ position: 'topright' }).addTo(state.map);
        L.control.scale({ position: 'bottomleft', imperial: false }).addTo(state.map);

        const container = document.getElementById('basemapContainer');
        container.innerHTML = '';
        container.style.gridTemplateColumns = `repeat(${Math.min(CONFIG.baseMaps.length, 3)}, 1fr)`;

        CONFIG.baseMaps.forEach((bm, idx) => {
            const tileLayer = L.tileLayer(bm.url, {
                attribution: bm.attribution,
                maxZoom: bm.maxZoom,
                crossOrigin: true
            });
            state.baseMapLayers[bm.id] = tileLayer;

            if (idx === 0) {
                tileLayer.addTo(state.map);
                state.activeBaseMapLayer = tileLayer;
            }

            const card = document.createElement('div');
            card.className = `basemap-card ${idx === 0 ? 'active' : ''}`;
            card.dataset.id = bm.id;
            card.innerHTML = `<i class="fa-solid ${bm.icon || 'fa-map'}"></i><span>${bm.name}</span>`;
            card.addEventListener('click', () => switchBaseMap(bm.id));
            container.appendChild(card);
        });

        state.camadaPontos = L.layerGroup().addTo(state.map);
    }

    function switchBaseMap(id) {
        if (state.activeBaseMapLayer) state.map.removeLayer(state.activeBaseMapLayer);
        state.activeBaseMapLayer = state.baseMapLayers[id];
        state.activeBaseMapLayer.addTo(state.map);
        document.querySelectorAll('.basemap-card').forEach((card) => {
            card.classList.toggle('active', card.dataset.id === id);
        });
    }

    /* ======================================================================
       2. ESTILO DAS CATEGORIAS
       ====================================================================== */

    function normalizar(txt) {
        return String(txt || '')
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/\s+/g, ' ')
            .toLowerCase().trim();
    }

    /**
     * Monta o mapa "categoria -> {cor, icone}".
     * Casa o valor da planilha com o CONFIG ignorando acento e maiúscula.
     * Categoria não configurada recebe cor automática da paleta.
     */
    function montarEstilosCategoria() {
        state.estiloCategoria.clear();

        // Índice do CONFIG por nome normalizado
        const configPorNome = new Map();
        Object.entries(CONFIG.categorias || {}).forEach(([nome, estilo]) => {
            configPorNome.set(normalizar(nome), estilo);
        });

        const paleta = CONFIG.paletaAuto || ['#95a5a6'];
        let proximaCor = 0;

        state.categorias.forEach((cat) => {
            const doConfig = configPorNome.get(normalizar(cat.nome));
            if (doConfig) {
                state.estiloCategoria.set(cat.nome, {
                    cor: doConfig.cor,
                    icone: doConfig.icone || CONFIG.iconePadrao
                });
            } else {
                state.estiloCategoria.set(cat.nome, {
                    cor: paleta[proximaCor % paleta.length],
                    icone: CONFIG.iconePadrao
                });
                proximaCor++;
            }
        });
    }

    function estiloDe(categoria) {
        return state.estiloCategoria.get(categoria)
            || { cor: '#95a5a6', icone: CONFIG.iconePadrao };
    }

    /* ======================================================================
       3. CARREGAMENTO DOS DADOS
       ====================================================================== */

    async function carregarDados(forcar = false) {
        if (state.carregando) return;
        state.carregando = true;
        mostrarLoading(true);

        const btn = document.getElementById('btnRefresh');
        btn.classList.add('is-loading');

        try {
            const url = forcar ? `${CONFIG.apiPath}?t=${Date.now()}` : CONFIG.apiPath;
            const resp = await fetch(url, { cache: forcar ? 'no-store' : 'default' });
            const dados = await resp.json();

            if (dados.meta && dados.meta.erro) throw new Error(dados.meta.erro);

            const meta = dados.meta || {};
            state.features = Array.isArray(dados.features) ? dados.features : [];
            state.campos = meta.campos || [];
            state.camposPopup = meta.camposPopup || state.campos;
            state.colunaNome = meta.colunaNome || CONFIG.colunas.nome;
            state.colunaEndereco = meta.colunaEndereco || CONFIG.colunas.endereco;
            state.categorias = meta.categorias || [];
            state.subprefeituras = meta.subprefeituras || [];

            montarEstilosCategoria();

            // Todos os filtros começam marcados
            state.filtroCategoria = new Set(state.categorias.map((c) => c.nome));
            state.filtroSubpref = new Set(state.subprefeituras.map((s) => s.nome));

            renderizarFiltros();
            renderizarLegenda();
            renderizarPontos();
            aplicarFiltros();
            ajustarEnquadramento();
            avisarPendencias(meta);

            const geo = meta.geocodificados || 0;
            showToast(`${geo} ${geo === 1 ? 'organização carregada' : 'organizações carregadas'}.`, 'success');

        } catch (erro) {
            console.error('[carregarDados]', erro);
            showToast(erro.message || 'Falha ao carregar os dados da planilha.', 'error');
            document.getElementById('orgList').innerHTML =
                `<div class="list-empty">Não foi possível carregar os dados.<br>Tente novamente em instantes.</div>`;
        } finally {
            btn.classList.remove('is-loading');
            state.carregando = false;
            mostrarLoading(false);
        }
    }

    function avisarPendencias(meta) {
        const badge = document.getElementById('pendingBadge');
        if (meta.pendentes && meta.pendentes > 0) {
            document.getElementById('pendingText').textContent =
                `${meta.pendentes} ${meta.pendentes === 1 ? 'endereço ainda não foi localizado' : 'endereços ainda não foram localizados'}. ` +
                `Clique em "Atualizar" em alguns segundos.`;
            badge.hidden = false;
            setTimeout(() => { badge.hidden = true; }, 12000);
        } else {
            badge.hidden = true;
        }
    }

    /* ======================================================================
       4. MARCADORES (ícone + cor da categoria)
       ====================================================================== */

    function criarIcone(categoria, destaque = false) {
        const { cor, icone } = estiloDe(categoria);
        const tamanho = destaque ? CONFIG.marcador.tamanhoDestaque : CONFIG.marcador.tamanho;

        return L.divIcon({
            className: 'marcador-cat',
            html: `<div class="pino ${destaque ? 'destaque' : ''}" style="--cor:${cor}; --tam:${tamanho}px">
                     <i class="fa-solid ${icone}"></i>
                   </div>`,
            iconSize: [tamanho, tamanho],
            iconAnchor: [tamanho / 2, tamanho / 2],
            popupAnchor: [0, -tamanho / 2]
        });
    }

    function renderizarPontos() {
        state.camadaPontos.clearLayers();
        state.marcadores.clear();

        state.features.forEach((f, i) => {
            if (!f.geometry || !Array.isArray(f.geometry.coordinates)) return;

            const [lon, lat] = f.geometry.coordinates;
            const categoria = f.properties._categoria || CONFIG.semValor;

            const marcador = L.marker([lat, lon], {
                icon: criarIcone(categoria, false),
                title: f.properties[state.colunaNome] || ''
            });

            // Balão SOMENTE no clique
            marcador.bindPopup(() => montarPopup(f.properties), {
                maxWidth: 340,
                autoPanPadding: [40, 40],
                closeButton: true
            });

            marcador.on('click', () => destacar(i, false));
            marcador.on('popupclose', () => limparDestaque());

            marcador.addTo(state.camadaPontos);
            state.marcadores.set(i, marcador);
        });
    }

    function montarPopup(props) {
        const nome = props[state.colunaNome] || 'Organização sem nome';
        const categoria = props._categoria || CONFIG.semValor;
        const { cor, icone } = estiloDe(categoria);

        const linhas = state.camposPopup
            .filter((campo) => campo !== state.colunaNome)
            .map((campo) => {
                const valor = props[campo];
                if (!valor) return '';
                return `
                    <div class="popup-row">
                        <span class="popup-label">${escapar(campo)}</span>
                        <span class="popup-val">${formatarValor(valor)}</span>
                    </div>`;
            })
            .join('');

        const precisao = props._precisao
            ? `<div class="popup-footer"><i class="fa-solid fa-location-dot"></i> Localização por ${escapar(props._precisao)}</div>`
            : '';

        return `
            <div class="popup-dossier">
                <div class="popup-header">
                    <h4>
                        <span class="popup-icone" style="background:${cor}"><i class="fa-solid ${icone}"></i></span>
                        ${escapar(nome)}
                    </h4>
                </div>
                ${linhas || '<div class="popup-row"><span class="popup-val">Sem informações adicionais.</span></div>'}
                ${precisao}
            </div>`;
    }

    /** Transforma e-mails, telefones e links em elementos clicáveis. */
    function formatarValor(valor) {
        const txt = String(valor).trim();

        if (/^https?:\/\//i.test(txt)) {
            return `<a href="${escapar(txt)}" target="_blank" rel="noopener">${escapar(txt)}</a>`;
        }
        if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(txt)) {
            return `<a href="mailto:${escapar(txt)}">${escapar(txt)}</a>`;
        }
        const digitos = txt.replace(/\D/g, '');
        if (/^[\d\s()+-]+$/.test(txt) && digitos.length >= 8 && digitos.length <= 13) {
            return `<a href="tel:+55${digitos}">${escapar(formatarTelefone(digitos))}</a>`;
        }
        return escapar(txt).replace(/\n/g, '<br>');
    }

    function formatarTelefone(d) {
        if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
        if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
        return d;
    }

    function escapar(txt) {
        const div = document.createElement('div');
        div.textContent = String(txt ?? '');
        return div.innerHTML;
    }

    function ajustarEnquadramento() {
        const pontos = state.visiveis
            .filter((f) => f.geometry)
            .map((f) => [f.geometry.coordinates[1], f.geometry.coordinates[0]]);

        if (pontos.length === 0) return;
        if (pontos.length === 1) {
            state.map.setView(pontos[0], 16);
        } else {
            state.map.fitBounds(L.latLngBounds(pontos), { padding: [80, 80], maxZoom: 16 });
        }
    }

    /* ======================================================================
       5. FILTROS (Categoria + Subprefeitura) e BUSCA
       ====================================================================== */

    function renderizarFiltros() {
        montarGrupoFiltro({
            containerId: 'filtroCategoriaLista',
            grupoId: 'grupoCategoria',
            itens: state.categorias,
            selecionados: state.filtroCategoria,
            comCor: true
        });

        montarGrupoFiltro({
            containerId: 'filtroSubprefLista',
            grupoId: 'grupoSubpref',
            itens: state.subprefeituras,
            selecionados: state.filtroSubpref,
            comCor: false
        });
    }

    function montarGrupoFiltro({ containerId, grupoId, itens, selecionados, comCor }) {
        const container = document.getElementById(containerId);
        const grupo = document.getElementById(grupoId);
        container.innerHTML = '';

        // Esconde o bloco inteiro se a coluna não existir na planilha
        if (!itens || itens.length === 0) {
            grupo.hidden = true;
            return;
        }
        grupo.hidden = false;

        itens.forEach((item) => {
            const linha = document.createElement('label');
            linha.className = 'filtro-item';

            const marca = comCor
                ? (() => {
                    const { cor, icone } = estiloDe(item.nome);
                    return `<span class="filtro-icone" style="background:${cor}"><i class="fa-solid ${icone}"></i></span>`;
                })()
                : '<span class="filtro-bullet"></span>';

            linha.innerHTML = `
                <input type="checkbox" checked data-valor="${escapar(item.nome)}">
                ${marca}
                <span class="filtro-nome">${escapar(item.nome)}</span>
                <span class="filtro-total">${item.total}</span>`;

            linha.querySelector('input').addEventListener('change', (e) => {
                if (e.target.checked) selecionados.add(item.nome);
                else selecionados.delete(item.nome);
                aplicarFiltros();
            });

            container.appendChild(linha);
        });
    }

    function alternarTodos(qual, marcar) {
        const config = qual === 'categoria'
            ? { itens: state.categorias, alvo: state.filtroCategoria, container: 'filtroCategoriaLista' }
            : { itens: state.subprefeituras, alvo: state.filtroSubpref, container: 'filtroSubprefLista' };

        config.alvo.clear();
        if (marcar) config.itens.forEach((i) => config.alvo.add(i.nome));

        document.querySelectorAll(`#${config.container} input[type=checkbox]`)
            .forEach((cb) => { cb.checked = marcar; });

        aplicarFiltros();
    }

    function aplicarFiltros() {
        const termo = normalizar(document.getElementById('searchInput').value);
        document.getElementById('searchClear').hidden = !document.getElementById('searchInput').value;

        state.visiveis = state.features.filter((f) => {
            const p = f.properties;

            // Busca pelo nome da organização (coluna A)
            if (termo && !normalizar(p[state.colunaNome]).includes(termo)) return false;

            // Filtro de categoria
            if (state.categorias.length > 0 && !state.filtroCategoria.has(p._categoria || CONFIG.semValor)) return false;

            // Filtro de subprefeitura
            if (state.subprefeituras.length > 0 && !state.filtroSubpref.has(p._subprefeitura || CONFIG.semValor)) return false;

            return true;
        });

        const indicesVisiveis = new Set(state.visiveis.map((f) => state.features.indexOf(f)));

        state.marcadores.forEach((marcador, i) => {
            const visivel = indicesVisiveis.has(i);
            if (visivel && !state.camadaPontos.hasLayer(marcador)) state.camadaPontos.addLayer(marcador);
            if (!visivel && state.camadaPontos.hasLayer(marcador)) state.camadaPontos.removeLayer(marcador);
        });

        renderizarLista();
        renderizarLegenda();
        atualizarContadores();

        // Com um único resultado de busca, aproxima automaticamente
        if (termo && state.visiveis.length === 1) {
            const i = state.features.indexOf(state.visiveis[0]);
            if (state.marcadores.has(i)) destacar(i, true);
        }
    }

    function atualizarContadores() {
        const comGeo = state.visiveis.filter((f) => f.geometry).length;
        document.getElementById('countPill').textContent = state.visiveis.length;
        document.getElementById('listCount').textContent =
            comGeo === state.visiveis.length ? `${comGeo}` : `${comGeo} de ${state.visiveis.length} no mapa`;
    }

    /* ======================================================================
       6. LEGENDA (canto inferior direito)
       ====================================================================== */

    function renderizarLegenda() {
        const box = document.getElementById('legendaLista');
        const caixa = document.getElementById('legendaBox');
        box.innerHTML = '';

        if (state.categorias.length === 0) {
            caixa.hidden = true;
            return;
        }
        caixa.hidden = false;

        // Conta quantas estão visíveis agora em cada categoria
        const visiveisPorCat = new Map();
        state.visiveis.forEach((f) => {
            const c = f.properties._categoria || CONFIG.semValor;
            visiveisPorCat.set(c, (visiveisPorCat.get(c) || 0) + 1);
        });

        state.categorias.forEach((cat) => {
            const { cor, icone } = estiloDe(cat.nome);
            const qtd = visiveisPorCat.get(cat.nome) || 0;

            const item = document.createElement('div');
            item.className = `legenda-item ${qtd === 0 ? 'apagado' : ''}`;
            item.innerHTML = `
                <span class="legenda-icone" style="background:${cor}"><i class="fa-solid ${icone}"></i></span>
                <span class="legenda-nome">${escapar(cat.nome)}</span>
                <span class="legenda-total">${qtd}</span>`;
            box.appendChild(item);
        });
    }

    /* ======================================================================
       7. LISTA LATERAL
       ====================================================================== */

    function renderizarLista() {
        const lista = document.getElementById('orgList');
        lista.innerHTML = '';

        if (state.visiveis.length === 0) {
            lista.innerHTML = `<div class="list-empty">Nenhuma organização encontrada com os filtros atuais.</div>`;
            return;
        }

        const ordenadas = [...state.visiveis].sort((a, b) =>
            String(a.properties[state.colunaNome] || '').localeCompare(String(b.properties[state.colunaNome] || ''), 'pt-BR')
        );

        ordenadas.forEach((f) => {
            const i = state.features.indexOf(f);
            const temGeo = !!f.geometry;
            const categoria = f.properties._categoria || CONFIG.semValor;
            const { cor, icone } = estiloDe(categoria);

            const item = document.createElement('div');
            item.className = `org-item ${temGeo ? '' : 'sem-geo'}`;
            item.dataset.idx = i;

            const endereco = f.properties[state.colunaEndereco] || '';
            item.innerHTML = `
                <span class="org-icone" style="background:${temGeo ? cor : '#64748b'}"><i class="fa-solid ${icone}"></i></span>
                <span class="org-item-text">
                    <strong>${escapar(f.properties[state.colunaNome] || 'Sem nome')}</strong>
                    <small>${temGeo ? escapar(endereco) : 'Endereço não localizado no mapa'}</small>
                </span>`;

            item.addEventListener('click', () => {
                if (!temGeo) {
                    showToast('Esta organização ainda não foi localizada no mapa.', 'error');
                    return;
                }
                destacar(i, true);
            });

            lista.appendChild(item);
        });
    }

    /* ======================================================================
       8. DESTAQUE / SELEÇÃO
       ====================================================================== */

    function destacar(indice, abrirPopup) {
        limparDestaque();
        const marcador = state.marcadores.get(indice);
        if (!marcador) return;

        const f = state.features[indice];
        const categoria = f.properties._categoria || CONFIG.semValor;

        state.selecionado = indice;
        marcador.setIcon(criarIcone(categoria, true));
        marcador.setZIndexOffset(1000);

        document.querySelectorAll('.org-item').forEach((el) => {
            el.classList.toggle('active', Number(el.dataset.idx) === indice);
        });

        if (abrirPopup) {
            state.map.flyTo(marcador.getLatLng(), Math.max(state.map.getZoom(), 17), { duration: 0.7 });
            setTimeout(() => marcador.openPopup(), 300);
        }
    }

    function limparDestaque() {
        if (state.selecionado !== null && state.marcadores.has(state.selecionado)) {
            const marcador = state.marcadores.get(state.selecionado);
            const f = state.features[state.selecionado];
            marcador.setIcon(criarIcone(f.properties._categoria || CONFIG.semValor, false));
            marcador.setZIndexOffset(0);
        }
        state.selecionado = null;
        document.querySelectorAll('.org-item.active').forEach((el) => el.classList.remove('active'));
    }

    /* ======================================================================
       9. EXPORTAÇÃO .XLSX
       ====================================================================== */

    function exportarXLSX() {
        if (state.visiveis.length === 0) {
            showToast('Não há registros para exportar.', 'error');
            return;
        }

        // Exporta na ordem exata das colunas da planilha.
        const colunas = [...state.campos];

        const linhas = state.visiveis.map((f) => {
            const obj = {};
            colunas.forEach((campo) => { obj[campo] = f.properties[campo] || ''; });
            return obj;
        });

        const ws = XLSX.utils.json_to_sheet(linhas, { header: colunas });

        ws['!cols'] = colunas.map((c) => {
            const maior = Math.max(c.length, ...linhas.map((l) => String(l[c] || '').length));
            return { wch: Math.min(Math.max(maior + 2, 12), 60) };
        });

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Organizações');

        const data = new Date();
        const carimbo = `${String(data.getDate()).padStart(2, '0')}-${String(data.getMonth() + 1).padStart(2, '0')}-${data.getFullYear()}`;
        XLSX.writeFile(wb, `${CONFIG.exportFileName}_${carimbo}.xlsx`);

        showToast(`${linhas.length} ${linhas.length === 1 ? 'registro exportado' : 'registros exportados'}.`, 'success');
    }

    /* ======================================================================
       10. EVENTOS
       ====================================================================== */

    function setupEventListeners() {
        const sidebar = document.getElementById('sidebar');
        document.getElementById('btnToggleSidebar').addEventListener('click', (e) => {
            sidebar.classList.toggle('collapsed');
            const icone = e.currentTarget.querySelector('i');
            icone.className = sidebar.classList.contains('collapsed')
                ? 'fa-solid fa-chevron-right'
                : 'fa-solid fa-chevron-left';
        });

        let debounce;
        document.getElementById('searchInput').addEventListener('input', () => {
            clearTimeout(debounce);
            debounce = setTimeout(() => aplicarFiltros(), 180);
        });

        document.getElementById('searchClear').addEventListener('click', () => {
            const input = document.getElementById('searchInput');
            input.value = '';
            aplicarFiltros();
            input.focus();
        });

        document.querySelectorAll('[data-todos]').forEach((btn) => {
            btn.addEventListener('click', () => {
                alternarTodos(btn.dataset.grupo, btn.dataset.todos === 'marcar');
            });
        });

        document.getElementById('legendaToggle').addEventListener('click', () => {
            document.getElementById('legendaBox').classList.toggle('recolhida');
        });

        document.getElementById('btnRefresh').addEventListener('click', () => carregarDados(true));
        document.getElementById('btnExport').addEventListener('click', exportarXLSX);
    }

    /* ======================================================================
       11. UI AUXILIAR
       ====================================================================== */

    let toastTimer;
    function showToast(mensagem, tipo = 'info') {
        const toast = document.getElementById('toast');
        const icone = toast.querySelector('i');
        document.getElementById('toastMsg').textContent = mensagem;

        toast.className = `toast show ${tipo}`;
        icone.className = tipo === 'error' ? 'fa-solid fa-triangle-exclamation'
            : tipo === 'success' ? 'fa-solid fa-circle-check'
            : 'fa-solid fa-circle-info';

        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toast.classList.remove('show'), 4000);
    }

    function mostrarLoading(ativo) {
        document.getElementById('loadingOverlay').classList.toggle('hidden', !ativo);
    }

    init();
});
