const PreviewInterno = (function() {
  function obterConfigExecucaoPreview() {
    return AppInterno.obterConfigExecucao();
  }

  function mapearColaboradoresDaPlanilha() {
    return AppInterno.mapearColaboradoresDaPlanilha();
  }

  function obterDadosDoUsuario(emailUsuario) {
    return GoogleInterno.obterDadosDoUsuario(emailUsuario);
  }

  function prepararDadosAssinatura(dadosUsuario, infoDepto) {
    return Regras.prepararDadosAssinatura(dadosUsuario, infoDepto);
  }

const GERENCIADOR_ASSINATURAS_PREVIEW_EMAILS_KEY = 'GERENCIADOR_ASSINATURAS_PREVIEW_EMAILS';
const MAX_ALVOS_PREVIEW_ASSINATURAS = 20;
const MAX_ASSINATURAS_POR_RASCUNHO_PREVIEW_ASSINATURAS = 10;
const MAX_HTML_PREVIEW_RASCUNHO_ASSINATURAS = 80000;

function gerarPreviewAssinaturasV2() {
  const resultado = criarResultadoPreviewAssinaturas();
  const lock = LockService.getScriptLock();
  let lockObtido = false;

  try {
    lockObtido = lock.tryLock(obterTimeoutLockPreviewAssinaturas());
    if (!lockObtido) {
      return concluirPreviewAssinaturas(resultado, false, 'EXECUCAO_PREVIEW_JA_EM_ANDAMENTO');
    }

    const executor = resolverEmailExecutorPreviewAssinaturas();
    resultado.executorResolvido = executor.sucesso;

    if (!executor.sucesso) {
      return concluirPreviewAssinaturas(resultado, false, executor.status);
    }

    const configuracao = lerAlvosPreviewAssinaturas();
    resultado.usuariosSolicitados = configuracao.usuariosSolicitados || 0;

    if (!configuracao.sucesso) {
      return concluirPreviewAssinaturas(resultado, false, configuracao.status);
    }

    const processamento = processarAlvosPreviewAssinaturas(configuracao.emails);
    preencherResumoProcessamentoPreviewAssinaturas(resultado, processamento);

    const lotes = montarLotesPreviewAssinaturas(processamento.itens);

    if (lotes.length === 0) {
      return concluirPreviewAssinaturas(resultado, false, 'PREVIEW_ASSINATURAS_SEM_ASSINATURAS_VALIDAS');
    }

    for (let i = 0; i < lotes.length; i++) {
      const lote = lotes[i];
      const html = montarHtmlRascunhoPreviewAssinaturas(lote, i + 1, lotes.length);
      const assunto = montarAssuntoPreviewAssinaturas(i + 1, lotes.length);

      try {
        criarRascunhoPreviewAssinaturasViaGmailApi(
          executor.email,
          assunto,
          html
        );
      } catch (erroDraft) {
        resultado.erroClassificado = 'FALHA_CRIACAO_RASCUNHO_PREVIEW';
        return concluirPreviewAssinaturas(resultado, false, 'FALHA_CRIACAO_RASCUNHO_PREVIEW');
      }

      resultado.rascunhosCriados++;
      resultado.lotes.push({
        numero: i + 1,
        quantidadeAssinaturas: lote.quantidadeAssinaturas,
        quantidadePendencias: lote.quantidadePendencias
      });
    }

    return concluirPreviewAssinaturas(resultado, true, 'PREVIEW_ASSINATURAS_GERADO');
  } catch (erro) {
    resultado.erroClassificado = 'FALHA_GERAL_PREVIEW_ASSINATURAS';
    return concluirPreviewAssinaturas(resultado, false, 'FALHA_GERAL_PREVIEW_ASSINATURAS');
  } finally {
    if (lockObtido) {
      lock.releaseLock();
    }
  }
}

function validarGrupoPreviewAssinaturasV2() {
  const resultado = criarResultadoPreflightPreviewAssinaturas();

  try {
    const configuracao = lerAlvosPreviewAssinaturas();
    resultado.usuariosSolicitados = configuracao.usuariosSolicitados || 0;

    if (!configuracao.sucesso) {
      return concluirPreviewAssinaturas(resultado, false, configuracao.status);
    }

    const processamento = processarAlvosPreviewAssinaturas(configuracao.emails);
    preencherResumoProcessamentoPreviewAssinaturas(resultado, processamento);

    resultado.usuariosValidos = resultado.assinaturasGeradas;
    resultado.diversidade = processamento.diversidade;
    resultado.estimativa = criarEstimativaBatchingPreviewAssinaturas(processamento.itens);

    if (resultado.usuariosValidos === 0) {
      return concluirPreviewAssinaturas(resultado, false, 'PREFLIGHT_PREVIEW_ASSINATURAS_SEM_ASSINATURAS_VALIDAS');
    }

    return concluirPreviewAssinaturas(resultado, true, 'PREFLIGHT_PREVIEW_ASSINATURAS_OK');
  } catch (erro) {
    resultado.erroClassificado = 'FALHA_GERAL_PREFLIGHT_PREVIEW_ASSINATURAS';
    return concluirPreviewAssinaturas(resultado, false, 'FALHA_GERAL_PREFLIGHT_PREVIEW_ASSINATURAS');
  }
}

function criarRascunhoPreviewAssinaturasViaGmailApi(destinatario, assunto, html) {
  const raw = montarMensagemMimePreviewV2(destinatario, assunto, html);
  return Gmail.Users.Drafts.create({
    message: {
      raw: raw
    }
  }, 'me');
}

function montarMensagemMimePreviewV2(destinatario, assunto, html) {
  const linhas = [
    'To: ' + sanitizarHeaderMimePreviewAssinaturas(destinatario),
    'Subject: ' + sanitizarHeaderMimePreviewAssinaturas(assunto),
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    html || ''
  ];

  return codificarBase64UrlPreviewAssinaturas(linhas.join('\r\n'));
}

function sanitizarHeaderMimePreviewAssinaturas(valor) {
  return (valor || '').toString().replace(/[\r\n]+/g, ' ').trim();
}

function codificarBase64UrlPreviewAssinaturas(conteudo) {
  const bytes = Utilities.newBlob(conteudo || '', 'message/rfc822', 'preview.eml').getBytes();
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/g, '');
}

function criarResultadoPreviewAssinaturas() {
  return {
    sucesso: false,
    status: 'PREVIEW_ASSINATURAS_INICIADO',
    usuariosSolicitados: 0,
    usuariosProcessados: 0,
    assinaturasGeradas: 0,
    pendencias: 0,
    rascunhosCriados: 0,
    executorResolvido: false,
    porStatus: {},
    lotes: []
  };
}

function criarResultadoPreflightPreviewAssinaturas() {
  return {
    sucesso: false,
    status: 'PREFLIGHT_PREVIEW_ASSINATURAS_INICIADO',
    usuariosSolicitados: 0,
    usuariosProcessados: 0,
    usuariosValidos: 0,
    assinaturasGeradas: 0,
    pendencias: 0,
    diversidade: {
      matriz: 0,
      filial: 0,
      comCelular: 0,
      semCelular: 0
    },
    porStatus: {},
    estimativa: {
      rascunhosPorQuantidade: 0,
      maxAssinaturasPorRascunho: MAX_ASSINATURAS_POR_RASCUNHO_PREVIEW_ASSINATURAS,
      htmlTotalEstimado: 0,
      limiteHtmlProvocouDivisao: false
    }
  };
}

function concluirPreviewAssinaturas(resultado, sucesso, status) {
  resultado.sucesso = sucesso;
  resultado.status = status;
  return resultado;
}

function obterTimeoutLockPreviewAssinaturas() {
  if (typeof obterConfigExecucaoPreview() !== 'undefined' && obterConfigExecucaoPreview().LOCK_TIMEOUT_MS) {
    return obterConfigExecucaoPreview().LOCK_TIMEOUT_MS;
  }

  return 5000;
}

function resolverEmailExecutorPreviewAssinaturas() {
  const emailEfetivo = obterEmailSessaoPreviewAssinaturas('effective');
  if (!emailEfetivo) {
    return {
      sucesso: false,
      status: 'EMAIL_EXECUTOR_PREVIEW_NAO_RESOLVIDO',
      email: ''
    };
  }

  const emailAtivo = obterEmailSessaoPreviewAssinaturas('active');
  if (emailAtivo && emailAtivo !== emailEfetivo) {
    return {
      sucesso: false,
      status: 'CONTEXTO_EXECUTOR_PREVIEW_DIVERGENTE',
      email: ''
    };
  }

  return {
    sucesso: true,
    status: 'EMAIL_EXECUTOR_PREVIEW_RESOLVIDO',
    email: emailEfetivo
  };
}

function obterEmailSessaoPreviewAssinaturas(tipo) {
  try {
    if (tipo === 'active' && typeof Session !== 'undefined' && Session.getActiveUser) {
      return normalizarEmailPreviewAssinaturas(Session.getActiveUser().getEmail());
    }

    if (tipo === 'effective' && typeof Session !== 'undefined' && Session.getEffectiveUser) {
      return normalizarEmailPreviewAssinaturas(Session.getEffectiveUser().getEmail());
    }
  } catch (erro) {
    return '';
  }

  return '';
}

function lerAlvosPreviewAssinaturas() {
  const valor = PropertiesService.getScriptProperties().getProperty(GERENCIADOR_ASSINATURAS_PREVIEW_EMAILS_KEY);

  if (valor === null || valor === undefined || !valor.toString().trim()) {
    return {
      sucesso: false,
      status: 'PREVIEW_ASSINATURAS_ALVOS_NAO_CONFIGURADOS',
      emails: [],
      usuariosSolicitados: 0
    };
  }

  let bruto;
  try {
    bruto = JSON.parse(valor);
  } catch (erro) {
    return {
      sucesso: false,
      status: 'PREVIEW_ASSINATURAS_CONFIG_INVALIDA',
      emails: [],
      usuariosSolicitados: 0
    };
  }

  if (!Array.isArray(bruto)) {
    return {
      sucesso: false,
      status: 'PREVIEW_ASSINATURAS_CONFIG_INVALIDA',
      emails: [],
      usuariosSolicitados: 0
    };
  }

  const emails = normalizarListaEmailsPreviewAssinaturas(bruto);
  if (!emails.sucesso) {
    return {
      sucesso: false,
      status: emails.status,
      emails: [],
      usuariosSolicitados: 0
    };
  }

  if (emails.valores.length === 0) {
    return {
      sucesso: false,
      status: 'PREVIEW_ASSINATURAS_ALVOS_NAO_CONFIGURADOS',
      emails: [],
      usuariosSolicitados: 0
    };
  }

  if (emails.valores.length > MAX_ALVOS_PREVIEW_ASSINATURAS) {
    return {
      sucesso: false,
      status: 'PREVIEW_ASSINATURAS_LIMITE_ALVOS_EXCEDIDO',
      emails: [],
      usuariosSolicitados: emails.valores.length
    };
  }

  return {
    sucesso: true,
    status: 'PREVIEW_ASSINATURAS_ALVOS_OK',
    emails: emails.valores,
    usuariosSolicitados: emails.valores.length
  };
}

function normalizarListaEmailsPreviewAssinaturas(lista) {
  const vistos = {};
  const valores = [];

  for (let i = 0; i < lista.length; i++) {
    if (typeof lista[i] !== 'string') {
      return {
        sucesso: false,
        status: 'PREVIEW_ASSINATURAS_CONFIG_INVALIDA',
        valores: []
      };
    }

    const email = normalizarEmailPreviewAssinaturas(lista[i]);
    if (!email) {
      continue;
    }

    if (!validarFormatoEmailPreviewAssinaturas(email)) {
      return {
        sucesso: false,
        status: 'PREVIEW_ASSINATURAS_CONFIG_INVALIDA',
        valores: []
      };
    }

    if (!vistos[email]) {
      vistos[email] = true;
      valores.push(email);
    }
  }

  return {
    sucesso: true,
    status: 'PREVIEW_ASSINATURAS_EMAILS_NORMALIZADOS',
    valores: valores.sort()
  };
}

function normalizarEmailPreviewAssinaturas(email) {
  return email ? email.toString().trim().toLowerCase() : '';
}

function validarFormatoEmailPreviewAssinaturas(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function criarIndiceBaseFinalPreviewAssinaturas(mapaColaboradores) {
  const indice = {};

  if (mapaColaboradores && typeof mapaColaboradores.forEach === 'function') {
    mapaColaboradores.forEach((info, email) => {
      const emailNormalizado = normalizarEmailPreviewAssinaturas(email);
      if (emailNormalizado) {
        indice[emailNormalizado] = info;
      }
    });
  }

  return indice;
}

function processarAlvosPreviewAssinaturas(emails) {
  const mapaColaboradores = mapearColaboradoresDaPlanilha();
  const indiceBaseFinal = criarIndiceBaseFinalPreviewAssinaturas(mapaColaboradores);
  const processamento = {
    itens: [],
    usuariosProcessados: 0,
    assinaturasGeradas: 0,
    pendencias: 0,
    diversidade: {
      matriz: 0,
      filial: 0,
      comCelular: 0,
      semCelular: 0
    },
    porStatus: {}
  };

  emails.forEach((email, indice) => {
    const item = processarAlvoPreviewAssinaturas(email, indice + 1, indiceBaseFinal);
    processamento.itens.push(item);
    processamento.usuariosProcessados++;
    incrementarStatusPreviewAssinaturas(processamento.porStatus, item.status);

    if (item.sucesso) {
      processamento.assinaturasGeradas++;
      incrementarDiversidadePreviewAssinaturas(processamento.diversidade, item);
    } else {
      processamento.pendencias++;
    }
  });

  return processamento;
}

function preencherResumoProcessamentoPreviewAssinaturas(resultado, processamento) {
  resultado.usuariosProcessados = processamento.usuariosProcessados;
  resultado.assinaturasGeradas = processamento.assinaturasGeradas;
  resultado.pendencias = processamento.pendencias;
  resultado.porStatus = processamento.porStatus;
}

function incrementarStatusPreviewAssinaturas(porStatus, status) {
  const chave = status || 'PREVIEW_ASSINATURAS_STATUS_DESCONHECIDO';
  porStatus[chave] = (porStatus[chave] || 0) + 1;
}

function incrementarDiversidadePreviewAssinaturas(diversidade, item) {
  if (item.isMatriz) {
    diversidade.matriz++;
  } else {
    diversidade.filial++;
  }

  if (item.possuiCelular) {
    diversidade.comCelular++;
  } else {
    diversidade.semCelular++;
  }
}

function processarAlvoPreviewAssinaturas(email, ordem, indiceBaseFinal) {
  const infoDepto = indiceBaseFinal[email];

  if (!infoDepto) {
    return criarPendenciaPreviewAssinaturas(ordem, 'USUARIO_NAO_ENCONTRADO_NA_BASE');
  }

  if (infoDepto.sucesso === false) {
    return criarPendenciaPreviewAssinaturas(ordem, infoDepto.status || 'CARGO_NAO_MAPEADO');
  }

  if (!infoDepto.cargoPadrao) {
    return criarPendenciaPreviewAssinaturas(ordem, 'CARGO_NAO_MAPEADO');
  }

  if (!validarEnderecoPreviewAssinaturas(infoDepto)) {
    return criarPendenciaPreviewAssinaturas(ordem, 'ENDERECO_INCOMPLETO');
  }

  const dadosUsuario = obterDadosDoUsuario(email);
  if (!dadosUsuario) {
    return criarPendenciaPreviewAssinaturas(ordem, 'USUARIO_NAO_ENCONTRADO');
  }

  const dadosAssinatura = prepararDadosAssinatura(dadosUsuario, infoDepto);
  const assinaturaHtml = renderizarAssinaturaPreviewAssinaturas(dadosAssinatura);

  return {
    sucesso: true,
    ordem: ordem,
    status: 'REGRA_BASE_OK',
    isMatriz: Boolean(infoDepto.isMatriz),
    possuiCelular: Boolean(dadosAssinatura.celular && dadosAssinatura.celular.toString().trim()),
    html: assinaturaHtml
  };
}

function criarPendenciaPreviewAssinaturas(ordem, status) {
  return {
    sucesso: false,
    ordem: ordem,
    status: status || 'PREVIEW_ASSINATURAS_PENDENTE',
    html: ''
  };
}

function validarEnderecoPreviewAssinaturas(infoDepto) {
  return Boolean(
    infoDepto &&
    infoDepto.endereco &&
    infoDepto.endereco.linha1 &&
    infoDepto.endereco.linha2 &&
    typeof infoDepto.endereco.telefone === 'string'
  );
}

function renderizarAssinaturaPreviewAssinaturas(dadosAssinatura) {
  const template = HtmlService.createTemplateFromFile('templates/padrao');
  template.nome = dadosAssinatura.nome;
  template.cargo = dadosAssinatura.cargo;
  template.departamento = dadosAssinatura.departamento;
  template.enderecoLinha1 = dadosAssinatura.enderecoLinha1;
  template.enderecoLinha2 = dadosAssinatura.enderecoLinha2;
  template.telefoneFixo = dadosAssinatura.telefoneFixo;
  template.celular = dadosAssinatura.celular;

  return template.evaluate().getContent();
}

function montarLotesPreviewAssinaturas(itens) {
  const lotes = [];
  let loteAtual = criarLotePreviewAssinaturas();

  itens.forEach(item => {
    if (!item.sucesso) {
      return;
    }

    const htmlItem = item.html || '';
    const separador = loteAtual.itens.length > 0 ? montarSeparadorPreviewAssinaturas() : '';
    const tamanhoAdicional = separador.length + htmlItem.length;
    const excedeQuantidade =
      loteAtual.quantidadeAssinaturas >= MAX_ASSINATURAS_POR_RASCUNHO_PREVIEW_ASSINATURAS;
    const excedeTamanho = loteAtual.itens.length > 0 &&
      (loteAtual.tamanhoHtml + tamanhoAdicional + tamanhoEnvelopePreviewAssinaturas()) > MAX_HTML_PREVIEW_RASCUNHO_ASSINATURAS;

    if ((excedeQuantidade || excedeTamanho) && loteAtual.itens.length > 0) {
      lotes.push(loteAtual);
      loteAtual = criarLotePreviewAssinaturas();
    }

    loteAtual.itens.push(item);
    loteAtual.tamanhoHtml += (loteAtual.itens.length > 1 ? montarSeparadorPreviewAssinaturas().length : 0) + htmlItem.length;
    loteAtual.quantidadeAssinaturas++;
  });

  if (loteAtual.itens.length > 0) {
    lotes.push(loteAtual);
  }

  return lotes;
}

function criarEstimativaBatchingPreviewAssinaturas(itens) {
  const lotes = montarLotesPreviewAssinaturas(itens);
  const assinaturasValidas = itens.filter(item => item.sucesso).length;
  const rascunhosPorQuantidade = Math.ceil(assinaturasValidas / MAX_ASSINATURAS_POR_RASCUNHO_PREVIEW_ASSINATURAS);
  const htmlTotalEstimado = lotes.reduce((total, lote) => total + lote.tamanhoHtml, 0);

  return {
    rascunhosPorQuantidade: lotes.length,
    maxAssinaturasPorRascunho: MAX_ASSINATURAS_POR_RASCUNHO_PREVIEW_ASSINATURAS,
    htmlTotalEstimado: htmlTotalEstimado,
    limiteHtmlProvocouDivisao: lotes.length > rascunhosPorQuantidade
  };
}

function criarLotePreviewAssinaturas() {
  return {
    itens: [],
    quantidadeAssinaturas: 0,
    quantidadePendencias: 0,
    tamanhoHtml: 0
  };
}

function tamanhoEnvelopePreviewAssinaturas() {
  return 1200;
}

function montarHtmlRascunhoPreviewAssinaturas(lote, numero, total) {
  const partes = lote.itens.map(item => item.html || '');
  return partes.join(montarSeparadorPreviewAssinaturas());
}

function montarAssuntoPreviewAssinaturas(numero, total) {
  return 'Assinaturas ' +
    formatarNumeroPreviewAssinaturas(numero) + '/' +
    formatarNumeroPreviewAssinaturas(total);
}

function montarSeparadorPreviewAssinaturas() {
  return '<div style="margin: 24px 0; border-top: 1px solid #dddddd;"></div>';
}

function formatarNumeroPreviewAssinaturas(numero) {
  return numero < 10 ? '0' + numero : numero.toString();
}

function escaparHtmlPreviewAssinaturas(valor) {
  return (valor || '').toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}


  function gerarPreviewComPreflight() {
    const preflight = validarGrupoPreviewAssinaturasV2();
    if (!preflight.sucesso) {
      const resultado = criarResultadoPreviewAssinaturas();
      resultado.usuariosSolicitados = preflight.usuariosSolicitados || 0;
      resultado.usuariosProcessados = preflight.usuariosProcessados || 0;
      resultado.assinaturasGeradas = preflight.assinaturasGeradas || 0;
      resultado.pendencias = preflight.pendencias || 0;
      resultado.porStatus = preflight.porStatus || {};
      return concluirPreviewAssinaturas(resultado, false, preflight.status);
    }

    return gerarPreviewAssinaturasV2();
  }

  return Object.freeze({
    gerarPreview: gerarPreviewComPreflight,
    validarGrupoPreview: validarGrupoPreviewAssinaturasV2
  });
})();
