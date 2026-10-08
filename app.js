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
        situacoes: [],           // [{nome, total}]
        estiloCategoria: new Map(), // nome -> {cor, icone}

        filtroCategoria: new Set(),
        filtroSubpref: new Set(),
        filtroSituacao: new Set(),

        selecionado: null,
        carregando: false,
        tentouRecarregar: false
    };

    const CHAVE_QUEM = 'mboi_quem';

    /* ======================================================================
       1. INICIALIZAÇÃO
       ====================================================================== */

    function init() {
        document.getElementById('appTitle').textContent = CONFIG.title;
        document.getElementById('appSubtitle').textContent = CONFIG.subtitle;
        document.title = CONFIG.title;

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

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `basemap-btn ${idx === 0 ? 'active' : ''}`;
            btn.dataset.id = bm.id;
            btn.title = bm.name;
            btn.innerHTML = `<i class="fa-solid ${bm.icon || 'fa-map'}"></i><span>${bm.name}</span>`;
            btn.addEventListener('click', () => switchBaseMap(bm.id));
            container.appendChild(btn);
        });

        state.camadaPontos = L.layerGroup().addTo(state.map);
    }

    function switchBaseMap(id) {
        if (state.activeBaseMapLayer) state.map.removeLayer(state.activeBaseMapLayer);
        state.activeBaseMapLayer = state.baseMapLayers[id];
        state.activeBaseMapLayer.addTo(state.map);
        document.querySelectorAll('.basemap-btn').forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.id === id);
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

    /**
     * Aceita o ícone escrito das duas formas no config.js:
     *   "fa-handshake"            (só o nome)
     *   "fa-solid fa-handshake"   (classe completa)
     */
    function normalizarIcone(icone) {
        const txt = String(icone || CONFIG.iconePadrao || 'fa-location-dot').trim();
        return /\bfa-(solid|regular|brands|light|thin|duotone)\b/.test(txt) ? txt : `fa-solid ${txt}`;
    }

    function ehEncerrada(situacao) {
        const v = normalizar(situacao);
        return v === 'encerrada' || v === 'duplicada';
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
            state.situacoes = meta.situacoes || [];

            montarEstilosCategoria();

            // Todos os filtros começam marcados
            state.filtroCategoria = new Set(state.categorias.map((c) => c.nome));
            state.filtroSubpref = new Set(state.subprefeituras.map((s) => s.nome));
            const ocultas = (CONFIG.situacoesOcultasPorPadrao || [])
                .map((v) => normalizar(v));
            state.filtroSituacao = new Set(
                state.situacoes.map((s) => s.nome).filter((n) => !ocultas.includes(normalizar(n)))
            );

            renderizarFiltros();
            renderizarPontos();
            aplicarFiltros();

            // Veio do formulário? Vai direto para a organização em vez de
            // enquadrar tudo — é o que evita a pessoa achar que não gravou.
            if (!focarOrganizacaoDaURL()) ajustarEnquadramento();

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

    /**
     * Item 4: depois de cadastrar/corrigir, o formulário manda a pessoa de
     * volta ao mapa com ?org=<id>. Aqui o mapa aproxima na organização, abre
     * o balão e mostra a caixa de confirmação.
     * Devolve true quando encontrou e focou algo.
     */
    function focarOrganizacaoDaURL() {
        const params = new URLSearchParams(location.search);
        const id = params.get('org');
        if (!id) return false;

        const indice = state.features.findIndex((f) => f.properties._id === id);
        if (indice === -1) {
            // Ainda não apareceu na leitura (cache). Tenta de novo uma vez.
            if (!state.tentouRecarregar) {
                state.tentouRecarregar = true;
                setTimeout(() => carregarDados(true), 1500);
            }
            return false;
        }

        const f = state.features[indice];

        // Se a situação dela estiver desmarcada no filtro, marca — senão o
        // ponto não aparece e a pessoa acha de novo que não gravou.
        const sit = f.properties._situacao;
        if (sit && !state.filtroSituacao.has(sit)) {
            state.filtroSituacao.add(sit);
            renderizarFiltros();
            aplicarFiltros();
        }

        if (!f.geometry) {
            showToast('A organização foi gravada, mas ainda não tem posição no mapa.', 'error');
            return true;
        }

        destacar(indice, true);
        mostrarConfirmacao(f.properties, params.get('acao') === 'editar');
        limparURL();
        return true;
    }

    function mostrarConfirmacao(props, foiEdicao) {
        const caixa = document.getElementById('confirmaBox');
        document.getElementById('confirmaTitulo').textContent = foiEdicao
            ? `${props[state.colunaNome] || 'Organização'} foi atualizada`
            : `${props[state.colunaNome] || 'Organização'} foi cadastrada`;
        document.getElementById('confirmaSub').textContent =
            'Confira no mapa se o ponto está no lugar certo.';
        document.getElementById('confirmaCorrigir').href =
            `${CONFIG.incluirUrl}?id=${encodeURIComponent(props._id)}`;
        caixa.hidden = false;
    }

    /** Tira o ?org= da barra de endereço para o recarregar não repetir tudo. */
    function limparURL() {
        try {
            history.replaceState(null, '', location.pathname);
        } catch { /* navegador pode bloquear */ }
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

    function criarIcone(categoria, destaque = false, encerrada = false) {
        const { cor, icone } = estiloDe(categoria);
        const tamanho = destaque ? CONFIG.marcador.tamanhoDestaque : CONFIG.marcador.tamanho;

        return L.divIcon({
            className: 'marcador-cat',
            html: `<div class="pino ${destaque ? 'destaque' : ''} ${encerrada ? 'encerrada' : ''}" style="--cor:${cor}; --tam:${tamanho}px">
                     <i class="${normalizarIcone(icone)}"></i>
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
                icon: criarIcone(categoria, false, f.properties._encerrada),
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

        const encerrada = props._encerrada;
        const selo = encerrada
            ? `<div class="popup-selo"><i class="fa-solid fa-circle-xmark"></i> ${escapar(props._situacao || 'Encerrada')}</div>`
            : '';

        const verificacao = props._atualizadoEm
            ? `<div class="popup-verificado">
                 <i class="fa-solid fa-clock-rotate-left"></i>
                 Informação confirmada em ${escapar(props._atualizadoEm)}${props._atualizadoPor ? ' por ' + escapar(props._atualizadoPor) : ''}
               </div>`
            : '';

        const acoes = props._id ? `
            <div class="popup-acoes">
                <a class="pop-btn editar" href="${CONFIG.incluirUrl}?id=${encodeURIComponent(props._id)}">
                    <i class="fa-solid fa-pen"></i> Corrigir
                </a>
                ${encerrada
                    ? `<button class="pop-btn reabrir" data-acao="reabrir" data-id="${escapar(props._id)}" data-nome="${escapar(nome)}">
                         <i class="fa-solid fa-rotate-left"></i> Voltou a funcionar
                       </button>`
                    : `<button class="pop-btn confirmar" data-acao="confirmar" data-id="${escapar(props._id)}" data-nome="${escapar(nome)}">
                         <i class="fa-solid fa-check"></i> Continua aberta
                       </button>
                       <button class="pop-btn encerrar" data-acao="encerrar" data-id="${escapar(props._id)}" data-nome="${escapar(nome)}">
                         <i class="fa-solid fa-xmark"></i> Fechou / repetida
                       </button>`}
            </div>` : '';

        return `
            <div class="popup-dossier ${encerrada ? 'encerrada' : ''}">
                <div class="popup-header">
                    <h4>
                        <span class="popup-icone" style="background:${cor}"><i class="${normalizarIcone(icone)}"></i></span>
                        ${escapar(nome)}
                    </h4>
                    ${selo}
                </div>
                ${linhas || '<div class="popup-row"><span class="popup-val">Sem informações adicionais.</span></div>'}
                ${verificacao}
                ${precisao}
                ${acoes}
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
            containerId: 'filtroSituacaoLista',
            grupoId: 'grupoSituacao',
            itens: state.situacoes,
            selecionados: state.filtroSituacao,
            tipoMarca: 'situacao'
        });

        montarGrupoFiltro({
            containerId: 'filtroCategoriaLista',
            grupoId: 'grupoCategoria',
            itens: state.categorias,
            selecionados: state.filtroCategoria,
            tipoMarca: 'categoria'
        });

        montarGrupoFiltro({
            containerId: 'filtroSubprefLista',
            grupoId: 'grupoSubpref',
            itens: state.subprefeituras,
            selecionados: state.filtroSubpref,
            tipoMarca: 'simples'
        });
    }

    function montarGrupoFiltro({ containerId, grupoId, itens, selecionados, tipoMarca }) {
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

            let marca;
            if (tipoMarca === 'categoria') {
                const { cor, icone } = estiloDe(item.nome);
                marca = `<span class="filtro-icone" style="background:${cor}"><i class="${normalizarIcone(icone)}"></i></span>`;
            } else if (tipoMarca === 'situacao') {
                const encerrada = ehEncerrada(item.nome);
                marca = `<span class="filtro-icone ${encerrada ? 'apagada' : ''}" style="background:${encerrada ? '#94a3b8' : '#00a86b'}">
                            <i class="fa-solid ${encerrada ? 'fa-circle-xmark' : 'fa-circle-check'}"></i>
                         </span>`;
            } else {
                marca = '<span class="filtro-bullet"></span>';
            }

            linha.innerHTML = `
                <input type="checkbox" ${selecionados.has(item.nome) ? 'checked' : ''} data-valor="${escapar(item.nome)}">
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
        const mapa = {
            categoria: { itens: state.categorias, alvo: state.filtroCategoria, container: 'filtroCategoriaLista' },
            subpref: { itens: state.subprefeituras, alvo: state.filtroSubpref, container: 'filtroSubprefLista' },
            situacao: { itens: state.situacoes, alvo: state.filtroSituacao, container: 'filtroSituacaoLista' }
        };
        const config = mapa[qual];
        if (!config) return;

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

            // Filtro de situação
            if (state.situacoes.length > 0 && !state.filtroSituacao.has(p._situacao || 'Em funcionamento')) return false;

            return true;
        });

        const indicesVisiveis = new Set(state.visiveis.map((f) => state.features.indexOf(f)));

        state.marcadores.forEach((marcador, i) => {
            const visivel = indicesVisiveis.has(i);
            if (visivel && !state.camadaPontos.hasLayer(marcador)) state.camadaPontos.addLayer(marcador);
            if (!visivel && state.camadaPontos.hasLayer(marcador)) state.camadaPontos.removeLayer(marcador);
        });

        renderizarLista();
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
            item.className = `org-item ${temGeo ? '' : 'sem-geo'} ${f.properties._encerrada ? 'encerrada' : ''}`;
            item.dataset.idx = i;

            const endereco = f.properties[state.colunaEndereco] || '';
            item.innerHTML = `
                <span class="org-icone" style="background:${temGeo ? cor : '#64748b'}"><i class="${normalizarIcone(icone)}"></i></span>
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
        marcador.setIcon(criarIcone(categoria, true, f.properties._encerrada));
        marcador.setZIndexOffset(1000);

        document.querySelectorAll('.org-item').forEach((el) => {
            el.classList.toggle('active', Number(el.dataset.idx) === indice);
        });

        if (abrirPopup) {
            state.map.flyTo(marcador.getLatLng(), Math.max(state.map.getZoom(), 17), { duration: 0.7 });
            setTimeout(() => {
                marcador.openPopup();
                centralizarBalao();
            }, 320);
        }
    }

    /**
     * O balão abre ACIMA do ponto. Se o mapa centraliza no ponto, metade do
     * balão fica fora da tela. Aqui o mapa desloca para baixo metade da altura
     * do balão, deixando o conjunto balão+ponto centralizado.
     */
    function centralizarBalao() {
        setTimeout(() => {
            const popup = state.map._popup;
            if (!popup) return;
            const el = popup.getElement();
            if (!el) return;

            const altura = el.offsetHeight;
            if (!altura) return;

            // Metade da altura do balão, limitada para não exagerar em telas baixas
            const limite = Math.round(state.map.getSize().y * 0.32);
            const deslocamento = Math.min(Math.round(altura / 2), limite);

            state.map.panBy([0, -deslocamento], { animate: true, duration: 0.35 });
        }, 120);
    }

    function limparDestaque() {
        if (state.selecionado !== null && state.marcadores.has(state.selecionado)) {
            const marcador = state.marcadores.get(state.selecionado);
            const f = state.features[state.selecionado];
            marcador.setIcon(criarIcone(f.properties._categoria || CONFIG.semValor, false, f.properties._encerrada));
            marcador.setZIndexOffset(0);
        }
        state.selecionado = null;
        document.querySelectorAll('.org-item.active').forEach((el) => el.classList.remove('active'));
    }


    /* ======================================================================
       8b. AÇÕES DE SITUAÇÃO (confirmar / encerrar / reabrir)
       ====================================================================== */

    let acaoPendente = null;

    function abrirModalSituacao(acao, id, nome) {
        acaoPendente = { acao, id, nome };

        const textos = {
            confirmar: {
                titulo: 'Confirmar funcionamento',
                texto: `Você está confirmando que <strong>${escapar(nome)}</strong> continua funcionando. A data de hoje ficará registrada.`,
                botao: 'Confirmar que está aberta',
                classe: 'ok',
                pedirObs: false
            },
            encerrar: {
                titulo: 'Tirar do mapa',
                texto: `<strong>${escapar(nome)}</strong> sairá do mapa, mas <strong>nada é apagado</strong>: o registro fica guardado e pode voltar a qualquer momento.`,
                botao: 'Confirmar',
                classe: 'perigo',
                pedirObs: true,
                pedirMotivo: true
            },
            reabrir: {
                titulo: 'Voltou a funcionar',
                texto: `<strong>${escapar(nome)}</strong> voltará a aparecer no mapa.`,
                botao: 'Marcar como em funcionamento',
                classe: 'ok',
                pedirObs: false
            }
        }[acao];

        document.getElementById('modalTitulo').textContent = textos.titulo;
        document.getElementById('modalTexto').innerHTML = textos.texto;
        document.getElementById('modalGrupoObs').hidden = !textos.pedirObs;
        document.getElementById('modalGrupoMotivo').hidden = !textos.pedirMotivo;
        document.getElementById('modalObs').value = '';
        document.getElementById('modalMotivo').value = 'Encerrada';

        const btn = document.getElementById('modalConfirmar');
        btn.textContent = textos.botao;
        btn.className = `modal-btn ${textos.classe}`;

        // Preenche o nome já usado antes
        try {
            const q = localStorage.getItem(CHAVE_QUEM);
            if (q) document.getElementById('modalQuem').value = q;
        } catch { /* navegador pode bloquear */ }

        document.getElementById('modalErro').textContent = '';
        document.getElementById('modalSituacao').classList.add('aberto');
    }

    function fecharModal() {
        document.getElementById('modalSituacao').classList.remove('aberto');
        acaoPendente = null;
    }

    async function enviarSituacao() {
        if (!acaoPendente) return;

        const quem = document.getElementById('modalQuem').value.trim();
        const erro = document.getElementById('modalErro');

        const btn = document.getElementById('modalConfirmar');
        const rotulo = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Enviando…';
        erro.textContent = '';

        try {
            const resp = await fetch('/api/registro', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    acao: 'situacao',
                    id: acaoPendente.id,
                    situacao: acaoPendente.acao === 'encerrar'
                        ? document.getElementById('modalMotivo').value
                        : 'Em funcionamento',
                    observacao: document.getElementById('modalObs').value.trim(),
                    quem
                })
            });
            const d = await resp.json();

            if (!d.ok) { erro.textContent = d.erro || 'Não foi possível registrar.'; return; }

            try { if (quem) localStorage.setItem(CHAVE_QUEM, quem); }
            catch { /* segue */ }

            fecharModal();
            state.map.closePopup();
            showToast(d.mensagem || 'Registrado.', 'success');
            carregarDados(true);

        } catch {
            erro.textContent = 'Falha de conexão. Tente de novo.';
        } finally {
            btn.disabled = false;
            btn.textContent = rotulo;
        }
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
                ? 'fa-solid fa-chevron-left'
                : 'fa-solid fa-chevron-right';
        });

        // Recolher / expandir cada grupo de filtro
        document.querySelectorAll('.group-toggle').forEach((botao) => {
            botao.addEventListener('click', () => {
                const grupo = botao.closest('.filter-group');
                if (grupo) grupo.classList.toggle('recolhido');
            });
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

        // Botões dentro do balão (o conteúdo é recriado a cada abertura)
        document.addEventListener('click', (e) => {
            const btn = e.target.closest('.pop-btn[data-acao]');
            if (!btn) return;
            e.preventDefault();
            abrirModalSituacao(btn.dataset.acao, btn.dataset.id, btn.dataset.nome);
        });

        document.getElementById('modalCancelar').addEventListener('click', fecharModal);
        document.getElementById('modalConfirmar').addEventListener('click', enviarSituacao);
        document.getElementById('modalSituacao').addEventListener('click', (e) => {
            if (e.target.id === 'modalSituacao') fecharModal();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') fecharModal();
        });

        document.getElementById('confirmaOk').addEventListener('click', () => {
            document.getElementById('confirmaBox').hidden = true;
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
