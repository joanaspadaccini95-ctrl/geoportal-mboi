/**
 * ============================================================================
 *  GRAVADOR DA PLANILHA — Organizações Parceiras M'Boi Mirim
 * ============================================================================
 *
 *  Este arquivo NÃO faz parte do site. Ele mora dentro da planilha.
 *
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
 *   8. Clique em Implantar e autorize (vai pedir permissão duas vezes)
 *   9. COPIE a URL que termina em /exec
 *  10. Na Vercel, em Settings → Environment Variables, crie:
 *        APPS_SCRIPT_URL = a URL copiada
 *        CODIGO_ACESSO   = a mesma senha do passo 4
 *  11. Na Vercel, aba Deployments → botão "..." do último → Redeploy
 *
 *  ATENÇÃO: "Quem pode acessar: Qualquer pessoa" é necessário para o site
 *  conseguir gravar. A proteção é o CODIGO_ACESSO — por isso escolha uma
 *  senha que não seja óbvia e não a divulgue fora da equipe.
 *
 *  SEMPRE que editar este arquivo, refaça:
 *  Implantar → Gerenciar implantações → lápis → Versão: Nova → Implantar
 * ============================================================================
 */

// ⚠️ TROQUE ESTA SENHA (use a mesma na variável CODIGO_ACESSO da Vercel)
var CODIGO_ACESSO = 'mboi2026';

// Nome da aba onde as organizações ficam
var ABA_PRINCIPAL = 'Página1';

// true  = envios do site vão para uma aba "Pendentes" e você aprova depois
// false = envios entram direto na aba principal
var MODERACAO = false;

var ABA_PENDENTES = 'Pendentes';

/* ==========================================================================
   Recebe o envio vindo do site
   ========================================================================== */
function doPost(e) {
  var trava = LockService.getScriptLock();

  try {
    // Evita que dois envios simultâneos escrevam na mesma linha
    trava.waitLock(20000);

    var dados = JSON.parse(e.postData.contents);

    if (String(dados.codigo) !== String(CODIGO_ACESSO)) {
      return responder(false, 'Código de acesso incorreto.');
    }
    if (!dados.nome || String(dados.nome).trim().length < 3) {
      return responder(false, 'Nome da organização não informado.');
    }

    var planilha = SpreadsheetApp.getActiveSpreadsheet();
    var nomeAba = MODERACAO ? ABA_PENDENTES : ABA_PRINCIPAL;
    var aba = planilha.getSheetByName(nomeAba);

    // Cria a aba de moderação na primeira vez, copiando o cabeçalho
    if (!aba && MODERACAO) {
      var principal = planilha.getSheetByName(ABA_PRINCIPAL);
      aba = planilha.insertSheet(ABA_PENDENTES);
      var cab = principal.getRange(1, 1, 1, principal.getLastColumn()).getValues();
      aba.getRange(1, 1, 1, cab[0].length).setValues(cab);
    }
    if (!aba) return responder(false, 'Aba "' + nomeAba + '" não encontrada.');

    // Lê os cabeçalhos: assim a ordem das colunas pode mudar sem quebrar nada
    var cabecalhos = aba.getRange(1, 1, 1, aba.getLastColumn()).getValues()[0];

    var valores = {
      'nome da organizacao': dados.nome,
      'organizacao':         dados.nome,
      'nome':                dados.nome,
      'servicos oferecidos': dados.servicos,
      'servicos':            dados.servicos,
      'endereco':            dados.endereco,
      'latitude':            dados.latitude,
      'longitude':           dados.longitude,
      'contato':             dados.contato,
      'categoria':           dados.categoria,
      'subprefeitura':       dados.subprefeitura
    };

    var linha = cabecalhos.map(function (titulo) {
      var chave = normalizar(titulo);
      return valores.hasOwnProperty(chave) ? (valores[chave] || '') : '';
    });

    aba.appendRow(linha);

    // Latitude e Longitude como TEXTO, para o Sheets não arredondar
    var ultima = aba.getLastRow();
    ['latitude', 'longitude'].forEach(function (campo) {
      var col = indiceDe(cabecalhos, campo);
      if (col > 0) aba.getRange(ultima, col).setNumberFormat('@');
    });

    return responder(true, 'Gravado com sucesso.');

  } catch (erro) {
    return responder(false, 'Erro ao gravar: ' + erro.message);
  } finally {
    try { trava.releaseLock(); } catch (ignorado) {}
  }
}

/* ==========================================================================
   Auxiliares
   ========================================================================== */

// Remove acentos e deixa minúsculo, para casar "Endereço" com "endereco"
function normalizar(txt) {
  return String(txt || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function indiceDe(cabecalhos, nomeNormalizado) {
  for (var i = 0; i < cabecalhos.length; i++) {
    if (normalizar(cabecalhos[i]) === nomeNormalizado) return i + 1;
  }
  return 0;
}

function responder(ok, mensagem) {
  var corpo = ok ? { ok: true, mensagem: mensagem } : { ok: false, erro: mensagem };
  return ContentService
    .createTextOutput(JSON.stringify(corpo))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ==========================================================================
   Teste rápido — rode esta função pelo editor para conferir a instalação.
   Ela grava uma linha de teste na planilha; apague a linha depois.
   ========================================================================== */
function testarGravacao() {
  var falso = {
    postData: {
      contents: JSON.stringify({
        codigo: CODIGO_ACESSO,
        nome: 'TESTE - pode apagar',
        servicos: 'Teste de instalação',
        endereco: 'Rua de Teste, 1',
        latitude: '-23.700000',
        longitude: '-46.770000',
        contato: '11999999999',
        categoria: 'Outros',
        subprefeitura: "M'Boi Mirim"
      })
    }
  };
  Logger.log(doPost(falso).getContent());
}
