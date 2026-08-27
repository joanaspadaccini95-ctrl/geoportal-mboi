/**
 * ============================================================================
 *  BANCO DE DADOS — Organizações Parceiras M'Boi Mirim
 * ============================================================================
 *
 *  Este arquivo NÃO faz parte do site. Ele mora dentro da planilha e é a
 *  ÚNICA porta de entrada e saída dos dados. Com ele instalado, a planilha
 *  pode ficar totalmente PRIVADA — só você a enxerga.
 *
 *  ─────────────────────────────────────────────────────────────────────────
 *  COMO INSTALAR (uma vez só):
 *
 *   1. Abra a planilha no Google Sheets
 *   2. Menu  Extensões → Apps Script
 *   3. Apague tudo o que estiver na tela e cole ESTE arquivo inteiro
 *   4. Troque o valor de CODIGO_ACESSO abaixo por uma senha sua
 *   5. Clique no disquete (Salvar)
 *   6. Clique em  Implantar → Nova implantação
 *   7. Na engrenagem, escolha  Aplicativo da Web
 *        Executar como:        Eu (seu e-mail)
 *        Quem pode acessar:    Qualquer pessoa
 *   8. Clique em Implantar e autorize (o Google pede permissão duas vezes)
 *   9. COPIE a URL que termina em /exec
 *  10. Na Vercel, em Settings → Environment Variables, crie:
 *        APPS_SCRIPT_URL = a URL copiada
 *        CODIGO_ACESSO   = a mesma senha do passo 4
 *  11. Na Vercel, aba Deployments → "..." do último → Redeploy
 *  12. Só então: tire o compartilhamento público da planilha
 *      (Compartilhar → Acesso geral → Restrito)
 *
 *  ─────────────────────────────────────────────────────────────────────────
 *  SEMPRE que editar este arquivo, refaça:
 *  Implantar → Gerenciar implantações → lápis → Versão: Nova → Implantar
 *  Salvar sozinho NÃO atualiza o que o site enxerga.
 *  ─────────────────────────────────────────────────────────────────────────
 *
 *  COLUNAS: o script cria sozinho as que faltarem (ID, Situação, Atualizado
 *  em, Atualizado por, Observação) e preenche o ID das linhas antigas.
 *  Você não precisa mexer na planilha.
 * ============================================================================
 */

// ⚠️ TROQUE ESTA SENHA (use a mesma na variável CODIGO_ACESSO da Vercel)
var CODIGO_ACESSO = 'mboi2026';

// Nome da aba onde as organizações ficam
var ABA_PRINCIPAL = 'Página1';

// Colunas de controle criadas automaticamente
var COL_ID = 'ID';
var COL_SITUACAO = 'Situação';
var COL_ATUALIZADO_EM = 'Atualizado em';
var COL_ATUALIZADO_POR = 'Atualizado por';
var COL_OBSERVACAO = 'Observação';

var SITUACAO_ATIVA = 'Em funcionamento';
var SITUACAO_ENCERRADA = 'Encerrada';

/* ==========================================================================
   PONTO DE ENTRADA
   ========================================================================== */

function doPost(e) {
  var trava = LockService.getScriptLock();
  try {
    trava.waitLock(25000);

    var dados = JSON.parse(e.postData.contents);

    if (String(dados.codigo) !== String(CODIGO_ACESSO)) {
      return responder(false, 'Código de acesso incorreto.');
    }

    var aba = prepararAba();

    switch (dados.acao) {
      case 'listar':   return acaoListar(aba);
      case 'incluir':  return acaoIncluir(aba, dados);
      case 'editar':   return acaoEditar(aba, dados);
      case 'situacao': return acaoSituacao(aba, dados);
      default:         return responder(false, 'Ação desconhecida: ' + dados.acao);
    }

  } catch (erro) {
    return responder(false, 'Erro: ' + erro.message);
  } finally {
    try { trava.releaseLock(); } catch (ignorado) {}
  }
}

function doGet() {
  return ContentService
    .createTextOutput('Gravador do Geoportal ativo. Use POST.')
    .setMimeType(ContentService.MimeType.TEXT);
}

/* ==========================================================================
   AÇÕES
   ========================================================================== */

function acaoListar(aba) {
  var cabecalhos = lerCabecalhos(aba);
  var ultimaLinha = aba.getLastRow();

  var registros = [];
  if (ultimaLinha > 1) {
    var valores = aba.getRange(2, 1, ultimaLinha - 1, cabecalhos.length).getDisplayValues();
    for (var i = 0; i < valores.length; i++) {
      var reg = {};
      var temConteudo = false;
      for (var j = 0; j < cabecalhos.length; j++) {
        var v = String(valores[i][j] || '').trim();
        reg[cabecalhos[j]] = v;
        if (v !== '') temConteudo = true;
      }
      if (temConteudo) registros.push(reg);
    }
  }

  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, campos: cabecalhos, registros: registros }))
    .setMimeType(ContentService.MimeType.JSON);
}

function acaoIncluir(aba, dados) {
  if (!dados.nome || String(dados.nome).trim().length < 3) {
    return responder(false, 'Nome da organização não informado.');
  }

  var cabecalhos = lerCabecalhos(aba);
  var id = gerarId();
  var agora = carimboDeHoje();

  var mapa = montarMapa(dados);
  mapa[normalizar(COL_ID)] = id;
  mapa[normalizar(COL_SITUACAO)] = SITUACAO_ATIVA;
  mapa[normalizar(COL_ATUALIZADO_EM)] = agora;
  mapa[normalizar(COL_ATUALIZADO_POR)] = String(dados.quem || '').trim();
  mapa[normalizar(COL_OBSERVACAO)] = String(dados.observacao || '').trim();

  var linha = cabecalhos.map(function (titulo) {
    var chave = normalizar(titulo);
    return mapa.hasOwnProperty(chave) ? (mapa[chave] || '') : '';
  });

  aba.appendRow(linha);
  formatarTextoCoordenadas(aba, cabecalhos, aba.getLastRow());

  return responder(true, 'Organização cadastrada.', { id: id });
}

function acaoEditar(aba, dados) {
  var linha = acharLinhaPorId(aba, dados.id);
  if (linha < 0) return responder(false, 'Organização não encontrada. Recarregue o mapa e tente de novo.');

  var cabecalhos = lerCabecalhos(aba);
  var mapa = montarMapa(dados);

  // ID e Situação NÃO são alterados aqui: a situação tem ação própria
  mapa[normalizar(COL_ATUALIZADO_EM)] = carimboDeHoje();
  mapa[normalizar(COL_ATUALIZADO_POR)] = String(dados.quem || '').trim();
  if (dados.observacao !== undefined) {
    mapa[normalizar(COL_OBSERVACAO)] = String(dados.observacao || '').trim();
  }

  for (var j = 0; j < cabecalhos.length; j++) {
    var chave = normalizar(cabecalhos[j]);
    if (chave === normalizar(COL_ID) || chave === normalizar(COL_SITUACAO)) continue;
    if (mapa.hasOwnProperty(chave)) {
      aba.getRange(linha, j + 1).setValue(mapa[chave] || '');
    }
  }

  formatarTextoCoordenadas(aba, cabecalhos, linha);
  return responder(true, 'Organização atualizada.');
}

/** Marca como encerrada ou confirma que continua em funcionamento. */
function acaoSituacao(aba, dados) {
  var linha = acharLinhaPorId(aba, dados.id);
  if (linha < 0) return responder(false, 'Organização não encontrada. Recarregue o mapa e tente de novo.');

  var cabecalhos = lerCabecalhos(aba);
  var nova = (String(dados.situacao) === SITUACAO_ENCERRADA) ? SITUACAO_ENCERRADA : SITUACAO_ATIVA;

  definir(aba, cabecalhos, linha, COL_SITUACAO, nova);
  definir(aba, cabecalhos, linha, COL_ATUALIZADO_EM, carimboDeHoje());
  definir(aba, cabecalhos, linha, COL_ATUALIZADO_POR, String(dados.quem || '').trim());

  if (dados.observacao) {
    var col = indiceDe(cabecalhos, COL_OBSERVACAO);
    if (col > 0) {
      var anterior = String(aba.getRange(linha, col).getValue() || '').trim();
      var nota = carimboDeHoje() + ': ' + String(dados.observacao).trim();
      aba.getRange(linha, col).setValue(anterior ? (anterior + ' | ' + nota) : nota);
    }
  }

  return responder(true, nova === SITUACAO_ENCERRADA
    ? 'Organização marcada como encerrada.'
    : 'Funcionamento confirmado.');
}

/* ==========================================================================
   ESTRUTURA DA PLANILHA
   ========================================================================== */

/** Garante que as colunas de controle existem e que toda linha tem ID. */
function prepararAba() {
  var planilha = SpreadsheetApp.getActiveSpreadsheet();
  var aba = planilha.getSheetByName(ABA_PRINCIPAL);
  if (!aba) aba = planilha.getSheets()[0];
  if (!aba) throw new Error('Nenhuma aba encontrada na planilha.');

  var cabecalhos = lerCabecalhos(aba);
  var faltando = [];
  [COL_ID, COL_SITUACAO, COL_ATUALIZADO_EM, COL_ATUALIZADO_POR, COL_OBSERVACAO]
    .forEach(function (nome) {
      if (indiceDe(cabecalhos, nome) === 0) faltando.push(nome);
    });

  if (faltando.length > 0) {
    var inicio = cabecalhos.length + 1;
    aba.getRange(1, inicio, 1, faltando.length).setValues([faltando]);
    aba.getRange(1, inicio, 1, faltando.length).setFontWeight('bold');
    cabecalhos = lerCabecalhos(aba);
  }

  // Preenche ID e Situação das linhas que ainda não têm
  var ultima = aba.getLastRow();
  if (ultima > 1) {
    var colId = indiceDe(cabecalhos, COL_ID);
    var colSit = indiceDe(cabecalhos, COL_SITUACAO);

    var ids = aba.getRange(2, colId, ultima - 1, 1).getValues();
    var sits = colSit > 0 ? aba.getRange(2, colSit, ultima - 1, 1).getValues() : null;
    var mudouId = false, mudouSit = false;

    for (var i = 0; i < ids.length; i++) {
      var linhaTemConteudo = String(aba.getRange(i + 2, 1).getValue() || '').trim() !== '' ||
                             String(aba.getRange(i + 2, 2).getValue() || '').trim() !== '';
      if (!linhaTemConteudo) continue;

      if (String(ids[i][0] || '').trim() === '') { ids[i][0] = gerarId(); mudouId = true; }
      if (sits && String(sits[i][0] || '').trim() === '') { sits[i][0] = SITUACAO_ATIVA; mudouSit = true; }
    }
    if (mudouId) aba.getRange(2, colId, ids.length, 1).setValues(ids);
    if (mudouSit) aba.getRange(2, colSit, sits.length, 1).setValues(sits);
  }

  return aba;
}

function lerCabecalhos(aba) {
  var largura = Math.max(aba.getLastColumn(), 1);
  return aba.getRange(1, 1, 1, largura).getValues()[0]
    .map(function (h) { return String(h || '').trim(); })
    .filter(function (h) { return h !== ''; });
}

function acharLinhaPorId(aba, id) {
  var alvo = String(id || '').trim();
  if (!alvo) return -1;

  var cabecalhos = lerCabecalhos(aba);
  var col = indiceDe(cabecalhos, COL_ID);
  if (col === 0) return -1;

  var ultima = aba.getLastRow();
  if (ultima < 2) return -1;

  var ids = aba.getRange(2, col, ultima - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0] || '').trim() === alvo) return i + 2;
  }
  return -1;
}

/* ==========================================================================
   AUXILIARES
   ========================================================================== */

/** Traduz os campos vindos do site para os nomes de coluna da planilha. */
function montarMapa(dados) {
  var mapa = {};
  var pares = [
    ['nome da organizacao', dados.nome], ['organizacao', dados.nome], ['nome', dados.nome],
    ['servicos oferecidos', dados.servicos], ['servicos', dados.servicos],
    ['endereco', dados.endereco],
    ['latitude', dados.latitude], ['longitude', dados.longitude],
    ['contato', dados.contato],
    ['categoria', dados.categoria],
    ['subprefeitura', dados.subprefeitura]
  ];
  pares.forEach(function (p) {
    if (p[1] !== undefined && p[1] !== null) mapa[p[0]] = p[1];
  });
  return mapa;
}

function definir(aba, cabecalhos, linha, nomeColuna, valor) {
  var col = indiceDe(cabecalhos, nomeColuna);
  if (col > 0) aba.getRange(linha, col).setValue(valor);
}

/** Latitude e Longitude como texto, para o Sheets não arredondar. */
function formatarTextoCoordenadas(aba, cabecalhos, linha) {
  ['Latitude', 'Longitude'].forEach(function (campo) {
    var col = indiceDe(cabecalhos, campo);
    if (col > 0) aba.getRange(linha, col).setNumberFormat('@');
  });
}

function gerarId() {
  return 'ORG-' + Date.now().toString(36).toUpperCase() +
         '-' + Math.floor(Math.random() * 1296).toString(36).toUpperCase();
}

function carimboDeHoje() {
  return Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'dd/MM/yyyy');
}

function normalizar(txt) {
  return String(txt || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function indiceDe(cabecalhos, nome) {
  var alvo = normalizar(nome);
  for (var i = 0; i < cabecalhos.length; i++) {
    if (normalizar(cabecalhos[i]) === alvo) return i + 1;
  }
  return 0;
}

function responder(ok, mensagem, extra) {
  var corpo = ok ? { ok: true, mensagem: mensagem } : { ok: false, erro: mensagem };
  if (extra) for (var k in extra) corpo[k] = extra[k];
  return ContentService
    .createTextOutput(JSON.stringify(corpo))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ==========================================================================
   TESTE — rode pelo editor para conferir a instalação.
   Grava uma linha de teste; apague-a depois.
   ========================================================================== */
function testarInstalacao() {
  var falso = { postData: { contents: JSON.stringify({
    codigo: CODIGO_ACESSO, acao: 'incluir',
    nome: 'TESTE - pode apagar', servicos: 'Teste de instalação',
    endereco: 'Rua de Teste, 1', latitude: '-23.700000', longitude: '-46.770000',
    contato: '11999999999', categoria: 'Outros', subprefeitura: "M'Boi Mirim",
    quem: 'Instalação'
  }) } };
  Logger.log(doPost(falso).getContent());

  var listar = { postData: { contents: JSON.stringify({ codigo: CODIGO_ACESSO, acao: 'listar' }) } };
  Logger.log(doPost(listar).getContent());
}
