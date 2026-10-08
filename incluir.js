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
        registro: null,
        existentes: [],          // organizações já cadastradas (para checar repetição)
        duplicataIgnorada: false
    };

    /* ======================================================================
       1. MAPA
       ====================================================================== */

    function iniciarMapa() {
        state.map = L.map('mapa', { center: CONFIG.mapa.center, zoom: CONFIG.mapa.zoom });

        // Satélite COM nomes de ruas: dá para reconhecer o telhado e conferir
        // a rua e os estabelecimentos vizinhos ao mesmo tempo.
        const base = CONFIG.baseMaps.find((b) => b.id === CONFIG.mapaDoFormulario)
                  || CONFIG.baseMaps[0];
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
        verificarRepetida();
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
            verificarRepetida();

            if (d.endereco && !el('endereco').value.trim()) el('endereco').value = d.endereco;
            aplicarSubprefeitura(d.candidatosSubprefeitura, d.bairro);

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
        marcarSubprefeitura('procurando');

        state.reverseTimer = setTimeout(async () => {
            const p = state.alfinete.getLatLng();
            try {
                const resp = await fetch('/api/resolver', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ acao: 'reverso', lat: p.lat, lon: p.lng })
                });
                const d = await resp.json();
                if (!d.ok) { marcarSubprefeitura('falhou'); return; }

                if (d.endereco && !(somenteSeVazio && el('endereco').value.trim())) {
                    if (!el('endereco').value.trim()) el('endereco').value = d.endereco;
                }
                aplicarSubprefeitura(d.candidatosSubprefeitura, d.bairro);

            } catch {
                marcarSubprefeitura('falhou');
            }
        }, 700);
    }

    /* ======================================================================
       2b. SUBPREFEITURA AUTOMÁTICA
       O OpenStreetMap devolve nomes de distrito a partir da coordenada; aqui
       eles são comparados com a lista oficial do config.js. Só entra no
       cadastro o que casar com a lista — é o que impede erro de digitação e
       classificação errada.
       ====================================================================== */

    function simplificar(txt) {
        return String(txt || '')
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]/gi, '')
            .toLowerCase();
    }

    function aplicarSubprefeitura(candidatos, bairro) {
        const oficiais = CONFIG.subprefeituras || [];
        const lista = Array.isArray(candidatos) ? candidatos : [];

        let encontrada = '';
        for (const c of lista) {
            const achou = oficiais.find((o) => simplificar(o) === simplificar(c));
            if (achou) { encontrada = achou; break; }
        }

        el('subprefeitura').value = encontrada;

        if (encontrada) {
            marcarSubprefeitura('detectada', encontrada);
        } else {
            marcarSubprefeitura('falhou', '', bairro || (lista[0] || ''));
        }
    }

    function marcarSubprefeitura(estado, nome, pista) {
        const caixa = el('subprefCaixa');
        const texto = el('subprefTexto');
        const icone = caixa.querySelector('i');

        caixa.classList.remove('detectada', 'falhou');

        if (estado === 'procurando') {
            icone.className = 'fa-solid fa-spinner fa-spin';
            texto.textContent = 'Identificando a subprefeitura…';
        } else if (estado === 'detectada') {
            caixa.classList.add('detectada');
            icone.className = 'fa-solid fa-circle-check';
            texto.textContent = nome;
        } else {
            caixa.classList.add('falhou');
            icone.className = 'fa-solid fa-circle-question';
            texto.textContent = pista
                ? `Não reconhecida (o mapa indicou "${pista}"). Será deixada em branco.`
                : 'Não foi possível identificar. Será deixada em branco.';
            el('subprefeitura').value = '';
        }
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
            (d.meta?.subprefeituras || []).forEach((x) => { if (x.nome !== CONFIG.semValor) subs.add(x.nome); });

            // Guarda as já cadastradas para avisar sobre repetição
            const colNome = d.meta?.colunaNome || CONFIG.colunas.nome;
            state.existentes = (d.features || [])
                .filter((f) => f.geometry && f.properties._id !== state.idEdicao)
                .map((f) => ({
                    id: f.properties._id,
                    nome: f.properties[colNome] || '',
                    situacao: f.properties._situacao || '',
                    lat: f.geometry.coordinates[1],
                    lon: f.geometry.coordinates[0]
                }));
        } catch { /* segue com o config.js */ }

        preencherSelect('categoria', [...nomes].sort((a, b) => a.localeCompare(b, 'pt-BR')));
        // Subprefeitura não tem select: é detectada pela posição do alfinete.
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
       3b. AVISO DE ORGANIZAÇÃO REPETIDA
       ====================================================================== */

    const PALAVRAS_VAZIAS = new Set([
        'associacao', 'associacoes', 'instituto', 'institucao', 'entidade',
        'centro', 'casa', 'sociedade', 'nucleo', 'projeto', 'grupo',
        'de', 'da', 'do', 'das', 'dos', 'e', 'a', 'o', 'sp', 'em'
    ]);

    function palavrasChave(nome) {
        const limpo = String(nome || '')
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .toLowerCase().replace(/[^a-z0-9 ]/g, ' ');
        return new Set(limpo.split(/\s+/).filter((t) => t && !PALAVRAS_VAZIAS.has(t)));
    }

    /**
     * Duas palavras contam como a mesma se forem iguais OU se compartilharem
     * as 4 primeiras letras. Sem isso, erros de digitação passam batido:
     * "Santo Mártinez" e "Santos Mártires" não teriam nenhuma palavra em
     * comum, apesar de serem a mesma organização.
     */
    function mesmaPalavra(x, y) {
        if (x === y) return true;
        if (x.length < 4 || y.length < 4) return false;
        return x.slice(0, 4) === y.slice(0, 4);
    }

    /** Proporção de palavras em comum entre os dois nomes (0 a 1). */
    function semelhanca(a, b) {
        const A = [...palavrasChave(a)], B = [...palavrasChave(b)];
        if (A.length === 0 || B.length === 0) return 0;

        const usados = new Array(B.length).fill(false);
        let comuns = 0;
        for (const x of A) {
            for (let i = 0; i < B.length; i++) {
                if (!usados[i] && mesmaPalavra(x, B[i])) { usados[i] = true; comuns++; break; }
            }
        }
        return comuns / (A.length + B.length - comuns);
    }

    function distanciaMetros(lat1, lon1, lat2, lon2) {
        const R = 6371000, rad = Math.PI / 180;
        const x = (lon2 - lon1) * rad * Math.cos((lat1 + lat2) / 2 * rad);
        const y = (lat2 - lat1) * rad;
        return Math.sqrt(x * x + y * y) * R;
    }

    /** Procura uma organização parecida no mesmo lugar. */
    function procurarRepetida() {
        const nome = el('nome').value.trim();
        if (!nome || state.existentes.length === 0) return null;

        const cfg = CONFIG.duplicatas || {};
        const raio = cfg.distanciaMetros || 150;
        const minimo = cfg.semelhancaMinima || 0.5;

        const p = state.posicionado ? state.alfinete.getLatLng() : null;

        let melhor = null;
        for (const org of state.existentes) {
            const sem = semelhanca(nome, org.nome);
            if (sem < minimo) continue;

            const dist = p ? distanciaMetros(p.lat, p.lng, org.lat, org.lon) : null;

            // Nome quase idêntico conta mesmo longe; parecido só se estiver perto
            const vale = sem >= 0.85 || (dist !== null && dist <= raio);
            if (!vale) continue;

            if (!melhor || sem > melhor.sem) melhor = { org, sem, dist };
        }
        return melhor;
    }

    function verificarRepetida() {
        const caixa = el('avisoRepetida');
        if (state.idEdicao || state.duplicataIgnorada) { caixa.hidden = true; return; }

        const achado = procurarRepetida();
        if (!achado) { caixa.hidden = true; return; }

        const { org, dist } = achado;
        const onde = dist === null
            ? 'já está cadastrada'
            : (dist < 20 ? 'já está cadastrada praticamente no mesmo ponto'
                         : `já está cadastrada a ${Math.round(dist)} metros daqui`);

        el('repetidaTexto').innerHTML =
            `<strong>${escapar(org.nome)}</strong> ${onde}` +
            (org.situacao && org.situacao !== 'Em funcionamento'
                ? ` <em>(marcada como ${escapar(org.situacao)})</em>` : '') + '.';
        el('repetidaCorrigir').href = `./incluir.html?id=${encodeURIComponent(org.id)}`;
        caixa.hidden = false;
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
            if (cat) { preencherSelect('categoria', [cat]); el('categoria').value = cat; }
            if (sub) { el('subprefeitura').value = sub; marcarSubprefeitura('detectada', sub); }

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
        if (quem.length < 2) {
            mostrarResultado(false, 'Escreva seu nome antes de enviar — fica registrado quem informou.');
            el('quem').focus();
            el('quem').scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
        }
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

                // Em vez de só avisar "pronto", leva a pessoa ao mapa já
                // aproximado na organização. É o que impede o cadastro
                // repetido por achar que não gravou.
                const id = state.idEdicao || d.id || '';
                const acao = state.idEdicao ? 'editar' : 'novo';

                mostrarResultado(true,
                    `<strong>${escapar(nome)} foi ${state.idEdicao ? 'atualizada' : 'cadastrada'}.</strong><br>` +
                    `Levando você ao mapa para conferir a posição…`);

                setTimeout(() => {
                    location.href = id
                        ? `./index.html?org=${encodeURIComponent(id)}&acao=${acao}`
                        : './index.html';
                }, 900);
                return;
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

    el('nome').addEventListener('blur', verificarRepetida);
    el('repetidaIgnorar').addEventListener('click', () => {
        state.duplicataIgnorada = true;
        el('avisoRepetida').hidden = true;
    });

    el('btnLocalizar').addEventListener('click', localizar);
    el('entradaLocal').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); localizar(); }
    });
    el('formulario').addEventListener('submit', enviar);
});
