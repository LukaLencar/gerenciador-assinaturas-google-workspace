const GoogleInterno = (function() {
  function obterConfigExecucaoGoogle() {
    return AppInterno.obterConfigExecucao();
  }

  function sanitizarMensagemErro(mensagem) {
    return Regras.sanitizarMensagemErro(mensagem);
  }

  function criarResultadoProcessamento(sucesso, status, email, mensagem, extras) {
    return Regras.criarResultadoProcessamento(sucesso, status, email, mensagem, extras);
  }

function obterContaDeServico() {
  const chaveJson = PropertiesService.getScriptProperties().getProperty('SERVICE_ACCOUNT_KEY');

  if (!chaveJson) {
    throw new Error('SERVICE_ACCOUNT_KEY_NAO_CONFIGURADA');
  }

  let contaDeServico;
  try {
    contaDeServico = JSON.parse(chaveJson);
  } catch (erro) {
    throw new Error('SERVICE_ACCOUNT_KEY_JSON_INVALIDO');
  }

  if (!contaDeServico || !contaDeServico.client_email || !contaDeServico.private_key) {
    throw new Error('SERVICE_ACCOUNT_KEY_CAMPOS_OBRIGATORIOS_AUSENTES');
  }

  return contaDeServico;
}


function obterServicoOAuth(emailUsuario) {
  const emailNormalizado = normalizarEmailGmailApi(emailUsuario);
  const contaDeServico = obterContaDeServico();

  return OAuth2.createService(criarNomeServicoOAuthGmail(emailNormalizado))
    .setTokenUrl('https://oauth2.googleapis.com/token')
    .setPrivateKey(contaDeServico.private_key)
    .setIssuer(contaDeServico.client_email)
    .setSubject(emailNormalizado)
    .setPropertyStore(PropertiesService.getScriptProperties())
    .setParam('access_type', 'offline')
    .setScope('https://www.googleapis.com/auth/gmail.settings.basic');
}

function executarComOAuthDelegado(emailUsuario, callback) {
  let servico = null;

  try {
    servico = obterServicoOAuth(emailUsuario);
    return callback(servico, normalizarEmailGmailApi(emailUsuario));
  } finally {
    resetarServicoOAuthDelegado(servico);
  }
}

function resetarServicoOAuthDelegado(servico) {
  try {
    if (servico && typeof servico.reset === 'function') {
      servico.reset();
    }
  } catch (erroReset) {
    // A limpeza de token nao deve mascarar o resultado tecnico da operacao principal.
  }
}

function criarNomeServicoOAuthGmail(emailUsuario) {
  const hashEmail = criarHashCurtoGmailApi(calcularHashCompletoGmailApi(normalizarEmailGmailApi(emailUsuario)));
  return 'Gmail_' + (hashEmail || 'usuario');
}

function deveTentarNovamenteGmail(codigoStatus) {
  return codigoStatus === 429 || (codigoStatus >= 500 && codigoStatus <= 599);
}

function calcularBackoffGmail(tentativa) {
  return obterConfigExecucaoGoogle().BACKOFF_BASE_MS * Math.pow(2, tentativa - 1);
}

function aguardarRetryGmail(tentativa) {
  const tempoEspera = calcularBackoffGmail(tentativa);
  if (typeof Utilities !== 'undefined' && Utilities.sleep) {
    Utilities.sleep(tempoEspera);
  }
}

function injetarAssinatura(emailUsuario, dadosAssinatura) {
  try {
    const template = HtmlService.createTemplateFromFile('templates/padrao');
    
    template.nome = dadosAssinatura.nome;
    template.cargo = dadosAssinatura.cargo;
    template.departamento = dadosAssinatura.departamento; 
    template.enderecoLinha1 = dadosAssinatura.enderecoLinha1;
    template.enderecoLinha2 = dadosAssinatura.enderecoLinha2; 
    template.telefoneFixo = dadosAssinatura.telefoneFixo;     
    template.celular = dadosAssinatura.celular;
    template.email = emailUsuario;
    
    const htmlFinal = template.evaluate().getContent();

    const emailNormalizado = normalizarEmailGmailApi(emailUsuario);
    const emailMascarado = mascararEmailGmailApi(emailNormalizado);
    return executarComOAuthDelegado(emailNormalizado, function(servico) {
      if (!servico.hasAccess()) {
        console.error(`O robô não tem acesso para alterar a conta de: ${emailMascarado}`);
        return criarResultadoProcessamento(false, 'ERRO_GMAIL_API', emailNormalizado, 'Serviço OAuth sem acesso para atualizar a assinatura.', {
          httpStatus: null,
          tentativas: 0
        });
      }

      const getInicial = obterSendAsGmailComServico(emailNormalizado, servico);
      if (!getInicial.sucesso) {
        return criarResultadoProcessamento(false, 'ERRO_GMAIL_API', emailNormalizado, 'Falha na Gmail API ao ler assinatura atual.', {
          httpStatus: getInicial.sanitizado.httpStatus,
          tentativas: getInicial.sanitizado.tentativas || 0,
          statusDetalhado: getInicial.status
        });
      }

      const patch = atualizarAssinaturaGmailComConfirmacao(emailNormalizado, htmlFinal, {
        servico: servico,
        assinaturaAnterior: getInicial.assinaturaAtual
      });

      if (patch.sucesso) {
        console.log(`Assinatura atualizada com sucesso para: ${emailMascarado}`);
        return criarResultadoProcessamento(true, 'ASSINATURA_ATUALIZADA', emailNormalizado, 'Assinatura atualizada com sucesso.', patch.sanitizado);
      }

      console.error(`Falha na API para ${emailMascarado}. Status: ${patch.status}`);
      return criarResultadoProcessamento(false, 'ERRO_GMAIL_API', emailNormalizado, 'Falha na Gmail API ao atualizar assinatura.', patch.sanitizado);
    });
    
  } catch (erro) {
    const mensagemSanitizada = sanitizarMensagemErro(erro.message);
    console.error(`Erro ao injetar assinatura para ${mascararEmailGmailApi(emailUsuario)}: ` + mensagemSanitizada);
    return criarResultadoProcessamento(false, 'ERRO_GMAIL_API', emailUsuario, mensagemSanitizada, {
      httpStatus: null,
      tentativas: 0
    });
  }
}

function atualizarAssinaturaGmailComConfirmacao(emailUsuario, htmlAssinatura, opcoes) {
  const emailNormalizado = normalizarEmailGmailApi(emailUsuario);
  const html = typeof htmlAssinatura === 'string' ? htmlAssinatura : '';
  const assinaturaAnterior = opcoes && typeof opcoes.assinaturaAnterior === 'string' ? opcoes.assinaturaAnterior : '';

  if (!opcoes || !opcoes.servico) {
    return executarComOAuthDelegado(emailNormalizado, function(servico) {
      return atualizarAssinaturaGmailComConfirmacao(emailNormalizado, html, {
        servico: servico,
        assinaturaAnterior: assinaturaAnterior
      });
    });
  }

  const servico = opcoes.servico;
  const resultadoBase = criarResultadoAtualizacaoAssinaturaGmailVazio(assinaturaAnterior);

  if (!emailNormalizado || !html) {
    return concluirResultadoAtualizacaoAssinaturaGmail(resultadoBase, false, 'PATCH_GMAIL_DADOS_INVALIDOS');
  }

  if (!servico || !servico.hasAccess || !servico.hasAccess()) {
    return concluirResultadoAtualizacaoAssinaturaGmail(resultadoBase, false, 'OAUTH_GMAIL_SEM_ACESSO');
  }

  const url = criarUrlSendAsGmailApi(emailNormalizado);
  const respostaPatch = executarFetchGmailComRetry(url, {
    method: 'patch',
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + servico.getAccessToken()
    },
    payload: JSON.stringify({
      signature: html
    }),
    muteHttpExceptions: true
  });

  resultadoBase.httpStatus = respostaPatch.httpStatus;
  resultadoBase.tentativas = respostaPatch.tentativas;
  resultadoBase.patchHttpOk = respostaPatch.sucesso;

  if (!respostaPatch.sucesso) {
    return concluirResultadoAtualizacaoAssinaturaGmail(resultadoBase, false, 'PATCH_GMAIL_FALHOU');
  }

  const respostaGmail = analisarSendAsGmailApi(respostaPatch.resposta, emailNormalizado);
  resultadoBase.respostaGmail = respostaGmail.interno;
  resultadoBase.sanitizado.respostaGmail = respostaGmail.sanitizado;

  if (!respostaGmail.sucesso) {
    return concluirResultadoAtualizacaoAssinaturaGmail(resultadoBase, false, respostaGmail.status);
  }

  const getPosPatch = obterSendAsGmailComServico(emailNormalizado, servico);
  resultadoBase.getPosPatch = getPosPatch.sanitizado;

  if (!getPosPatch.sucesso) {
    return concluirResultadoAtualizacaoAssinaturaGmail(resultadoBase, false, getPosPatch.status);
  }

  const assinaturaRespostaPatch = respostaGmail.assinatura || '';
  const assinaturaCanonica = getPosPatch.assinaturaAtual || '';
  const hashHtmlCompleto = calcularHashCompletoGmailApi(html);
  const hashRespostaPatchCompleto = calcularHashCompletoGmailApi(assinaturaRespostaPatch);
  const hashCanonicoCompleto = calcularHashCompletoGmailApi(assinaturaCanonica);
  const hashAnteriorCompleto = calcularHashCompletoGmailApi(assinaturaAnterior);
  const gmailPersistiuRespostaPatch = Boolean(
    assinaturaCanonica === assinaturaRespostaPatch &&
    hashCanonicoCompleto === hashRespostaPatchCompleto
  );
  const gmailSanitizouHtml = Boolean(
    html.length !== assinaturaRespostaPatch.length ||
    hashHtmlCompleto !== hashRespostaPatchCompleto
  );
  const alteracaoEfetiva = Boolean(
    assinaturaAnterior.length !== assinaturaCanonica.length ||
    hashAnteriorCompleto !== hashCanonicoCompleto
  );

  resultadoBase.assinaturaAnterior = assinaturaAnterior;
  resultadoBase.signatureRespostaPatch = assinaturaRespostaPatch;
  resultadoBase.assinaturaCanonica = assinaturaCanonica;
  resultadoBase.gmailPersistiuRespostaPatch = gmailPersistiuRespostaPatch;
  resultadoBase.gmailSanitizouHtml = gmailSanitizouHtml;
  resultadoBase.alteracaoEfetiva = alteracaoEfetiva;
  resultadoBase.sanitizado.gmailPersistiuRespostaPatch = gmailPersistiuRespostaPatch;
  resultadoBase.sanitizado.gmailSanitizouHtml = gmailSanitizouHtml;
  resultadoBase.sanitizado.alteracaoEfetiva = alteracaoEfetiva;
  resultadoBase.sanitizado.tamanhoAnterior = assinaturaAnterior.length;
  resultadoBase.sanitizado.tamanhoNovoCanonico = assinaturaCanonica.length;
  resultadoBase.sanitizado.hashAnteriorCurto = criarHashCurtoGmailApi(hashAnteriorCompleto);
  resultadoBase.sanitizado.hashNovoCurto = criarHashCurtoGmailApi(hashCanonicoCompleto);
  resultadoBase.sanitizado.hashRespostaPatchCurto = criarHashCurtoGmailApi(hashRespostaPatchCompleto);
  resultadoBase.sanitizado.hashesCorrespondem = hashRespostaPatchCompleto === hashCanonicoCompleto;

  if (!gmailPersistiuRespostaPatch) {
    return concluirResultadoAtualizacaoAssinaturaGmail(resultadoBase, false, 'PATCH_GMAIL_DIVERGENCIA_POS_GET');
  }

  if (!alteracaoEfetiva) {
    return concluirResultadoAtualizacaoAssinaturaGmail(resultadoBase, true, 'PATCH_GMAIL_OK_SEM_ALTERACAO_EFETIVA');
  }

  return concluirResultadoAtualizacaoAssinaturaGmail(resultadoBase, true, 'PATCH_GMAIL_CONFIRMADO');
}

function obterSendAsGmailComServico(emailUsuario, servico) {
  const emailNormalizado = normalizarEmailGmailApi(emailUsuario);
  const resultadoVazio = {
    sucesso: false,
    status: 'GMAIL_READ_FALHOU',
    assinaturaAtual: '',
    sendAs: null,
    sanitizado: {
      gmailReadOk: false,
      httpStatus: null,
      tentativas: 0,
      sendAsEncontrado: false,
      sendAsCorrespondeAoAlvo: false,
      isPrimary: false,
      isDefault: false,
      assinaturaAtualExiste: false,
      tamanhoAssinaturaAtual: 0,
      hashAssinaturaAtual: ''
    }
  };

  if (!emailNormalizado || !servico || !servico.getAccessToken) {
    return resultadoVazio;
  }

  const resposta = executarFetchGmailComRetry(criarUrlSendAsGmailApi(emailNormalizado), {
    method: 'get',
    headers: {
      Authorization: 'Bearer ' + servico.getAccessToken()
    },
    muteHttpExceptions: true
  });

  if (!resposta.sucesso) {
    resultadoVazio.sanitizado.httpStatus = resposta.httpStatus;
    resultadoVazio.sanitizado.tentativas = resposta.tentativas;
    return resultadoVazio;
  }

  const analise = analisarSendAsGmailApi(resposta.resposta, emailNormalizado);
  if (!analise.sucesso) {
    return {
      sucesso: false,
      status: analise.status === 'PATCH_GMAIL_RESPOSTA_INCOMPLETA' ? 'GMAIL_READ_FALHOU' : analise.status,
      assinaturaAtual: '',
      sendAs: analise.sendAs,
      sanitizado: Object.assign({}, analise.sanitizado, {
        gmailReadOk: false,
        httpStatus: resposta.httpStatus,
        tentativas: resposta.tentativas,
        sendAsEncontrado: Boolean(analise.sendAs)
      })
    };
  }

  return {
    sucesso: true,
    status: 'GMAIL_READ_OK',
    assinaturaAtual: analise.assinatura,
    sendAs: analise.sendAs,
    sanitizado: {
      gmailReadOk: true,
      httpStatus: resposta.httpStatus,
      tentativas: resposta.tentativas,
      sendAsEncontrado: true,
      sendAsCorrespondeAoAlvo: analise.interno.sendAsCorrespondeAoAlvo,
      isPrimary: analise.interno.isPrimary,
      isDefault: analise.interno.isDefault,
      assinaturaAtualExiste: Boolean(analise.assinatura),
      tamanhoAssinaturaAtual: analise.assinatura.length,
      hashAssinaturaAtual: criarHashCurtoGmailApi(calcularHashCompletoGmailApi(analise.assinatura))
    }
  };
}

function executarFetchGmailComRetry(url, options) {
  const maxTentativas = obterMaxTentativasGmailApi();
  let ultimaResposta = null;
  let ultimoStatus = null;

  for (let tentativa = 1; tentativa <= maxTentativas; tentativa++) {
    try {
      ultimaResposta = UrlFetchApp.fetch(url, options);
      ultimoStatus = ultimaResposta.getResponseCode();
    } catch (erroFetch) {
      return {
        sucesso: false,
        status: 'GMAIL_FETCH_FALHOU',
        resposta: null,
        httpStatus: null,
        tentativas: tentativa
      };
    }

    if (ultimoStatus >= 200 && ultimoStatus < 300) {
      return {
        sucesso: true,
        status: 'GMAIL_HTTP_OK',
        resposta: ultimaResposta,
        httpStatus: ultimoStatus,
        tentativas: tentativa
      };
    }

    if (deveTentarNovamenteGmail(ultimoStatus) && tentativa < maxTentativas) {
      aguardarRetryGmail(tentativa);
      continue;
    }

    return {
      sucesso: false,
      status: 'GMAIL_HTTP_FALHOU',
      resposta: ultimaResposta,
      httpStatus: ultimoStatus,
      tentativas: tentativa
    };
  }

  return {
    sucesso: false,
    status: 'GMAIL_HTTP_FALHOU',
    resposta: ultimaResposta,
    httpStatus: ultimoStatus,
    tentativas: maxTentativas
  };
}

function analisarSendAsGmailApi(resposta, emailUsuario) {
  const vazio = criarRespostaGmailApiVazia();
  try {
    const sendAs = JSON.parse(resposta.getContentText() || '{}') || {};
    const assinatura = typeof sendAs.signature === 'string' ? sendAs.signature : '';
    const possuiSignature = typeof sendAs.signature === 'string';
    const sendAsEmail = sendAs.sendAsEmail ? normalizarEmailGmailApi(sendAs.sendAsEmail) : '';
    const sendAsCorrespondeAoAlvo = Boolean(sendAsEmail && sendAsEmail === normalizarEmailGmailApi(emailUsuario));
    const hashSignatureCompleto = possuiSignature ? calcularHashCompletoGmailApi(assinatura) : '';
    const respostaCompleta = Boolean(sendAsCorrespondeAoAlvo && possuiSignature);

    return {
      sucesso: respostaCompleta,
      status: respostaCompleta ? 'PATCH_GMAIL_RESPOSTA_OK' : 'PATCH_GMAIL_RESPOSTA_INCOMPLETA',
      assinatura: assinatura,
      sendAs: sendAs,
      interno: {
        sendAsCorrespondeAoAlvo: sendAsCorrespondeAoAlvo,
        isPrimary: Boolean(sendAs.isPrimary),
        isDefault: Boolean(sendAs.isDefault),
        possuiSignature: possuiSignature,
        tamanhoSignature: assinatura.length,
        hashSignatureCompleto: hashSignatureCompleto
      },
      sanitizado: {
        sendAsCorrespondeAoAlvo: sendAsCorrespondeAoAlvo,
        isPrimary: Boolean(sendAs.isPrimary),
        isDefault: Boolean(sendAs.isDefault),
        possuiSignature: possuiSignature,
        tamanhoSignature: assinatura.length,
        hashSignatureCurto: criarHashCurtoGmailApi(hashSignatureCompleto)
      }
    };
  } catch (erro) {
    return {
      sucesso: false,
      status: 'PATCH_GMAIL_RESPOSTA_INCOMPLETA',
      assinatura: '',
      sendAs: null,
      interno: vazio,
      sanitizado: criarRespostaGmailApiSanitizadaVazia()
    };
  }
}

function criarResultadoAtualizacaoAssinaturaGmailVazio(assinaturaAnterior) {
  const hashAnteriorCompleto = calcularHashCompletoGmailApi(assinaturaAnterior || '');
  return {
    sucesso: false,
    status: 'PATCH_GMAIL_INICIADO',
    httpStatus: null,
    tentativas: 0,
    patchHttpOk: false,
    gmailPersistiuRespostaPatch: false,
    gmailSanitizouHtml: false,
    alteracaoEfetiva: false,
    assinaturaAnterior: assinaturaAnterior || '',
    signatureRespostaPatch: '',
    assinaturaCanonica: '',
    respostaGmail: criarRespostaGmailApiVazia(),
    getPosPatch: {},
    sanitizado: {
      httpStatus: null,
      tentativas: 0,
      campoAtualizado: 'signature',
      gmailPersistiuRespostaPatch: false,
      gmailSanitizouHtml: false,
      alteracaoEfetiva: false,
      tamanhoAnterior: (assinaturaAnterior || '').length,
      tamanhoNovoCanonico: 0,
      hashAnteriorCurto: criarHashCurtoGmailApi(hashAnteriorCompleto),
      hashNovoCurto: '',
      hashRespostaPatchCurto: '',
      hashesCorrespondem: false,
      respostaGmail: criarRespostaGmailApiSanitizadaVazia()
    }
  };
}

function concluirResultadoAtualizacaoAssinaturaGmail(resultado, sucesso, status) {
  resultado.sucesso = sucesso;
  resultado.status = status;
  resultado.sanitizado.httpStatus = resultado.httpStatus;
  resultado.sanitizado.tentativas = resultado.tentativas;
  resultado.sanitizado.statusDetalhado = status;
  return resultado;
}

function criarRespostaGmailApiVazia() {
  return {
    sendAsCorrespondeAoAlvo: false,
    isPrimary: false,
    isDefault: false,
    possuiSignature: false,
    tamanhoSignature: 0,
    hashSignatureCompleto: ''
  };
}

function criarRespostaGmailApiSanitizadaVazia() {
  return {
    sendAsCorrespondeAoAlvo: false,
    isPrimary: false,
    isDefault: false,
    possuiSignature: false,
    tamanhoSignature: 0,
    hashSignatureCurto: ''
  };
}

function criarUrlSendAsGmailApi(emailUsuario) {
  const emailCodificado = encodeURIComponent(normalizarEmailGmailApi(emailUsuario));
  return 'https://gmail.googleapis.com/gmail/v1/users/' + emailCodificado + '/settings/sendAs/' + emailCodificado;
}

function normalizarEmailGmailApi(emailUsuario) {
  return emailUsuario ? emailUsuario.toString().trim().toLowerCase() : '';
}

function mascararEmailGmailApi(emailUsuario) {
  const normalizado = normalizarEmailGmailApi(emailUsuario);
  const partes = normalizado.split('@');
  if (partes.length !== 2) {
    return '';
  }

  const local = partes[0] || '';
  return local.substring(0, Math.min(2, local.length)) + '***@...';
}

function obterMaxTentativasGmailApi() {
  if (typeof obterConfigExecucaoGoogle() !== 'undefined' && obterConfigExecucaoGoogle().MAX_TENTATIVAS_GMAIL) {
    return obterConfigExecucaoGoogle().MAX_TENTATIVAS_GMAIL;
  }

  return 3;
}

function calcularHashCompletoGmailApi(conteudo) {
  const texto = conteudo || '';
  if (typeof Utilities !== 'undefined' && Utilities.computeDigest) {
    const bytes = Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      texto,
      Utilities.Charset.UTF_8
    );

    return bytes.map(byte => {
      const valor = byte < 0 ? byte + 256 : byte;
      return ('0' + valor.toString(16)).slice(-2);
    }).join('');
  }

  return gerarHashFallbackGmailApi(texto);
}

function gerarHashFallbackGmailApi(texto) {
  let hash = 2166136261;
  for (let i = 0; i < texto.length; i++) {
    hash ^= texto.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }

  return ('00000000' + (hash >>> 0).toString(16)).slice(-8);
}

function criarHashCurtoGmailApi(hashCompleto) {
  return (hashCompleto || '').substring(0, 12);
}


function obterMembrosDoGrupo(emailDoGrupo) {
  try {
    const resposta = AdminDirectory.Members.list(emailDoGrupo);
    const membros = resposta.members;
    
    if (!membros || membros.length === 0) {
      return [];
    }

    // Filtra para garantir que apenas usuários (e não outros grupos) sejam retornados
    return membros
      .filter(membro => membro.type === 'USER')
      .map(membro => membro.email);
      
  } catch (erro) {
    console.error("Erro ao buscar membros do grupo: " + erro.message);
    return [];
  }
}

function obterDadosDoUsuario(emailUsuario) {
  try {
    const usuario = AdminDirectory.Users.get(emailUsuario, { projection: 'full' });
    
    let cargo = "Colaborador";
    let departamento = "Empresa Exemplo";
    let telefone = "(11) 3000-0000";
    let celular = "";

    if (usuario.organizations && usuario.organizations.length > 0) {
      cargo = usuario.organizations[0].title || cargo;
      departamento = usuario.organizations[0].department || departamento;
    }

    if (usuario.phones && usuario.phones.length > 0) {
      usuario.phones.forEach(phone => {
        if (phone.type === 'work') {
          telefone = phone.value;
        } else if (phone.type === 'mobile') {
          celular = phone.value;
        }
      });
    }

    return {
      nome: usuario.name.fullName,
      cargo: cargo,
      departamento: departamento,
      telefone: telefone,
      celular: celular || ''
    };

  } catch (erro) {
    console.error(`Erro ao buscar dados do perfil de ${emailUsuario}: ` + erro.message);
    return null;
  }
}


function verificarProntidaoAmbiente() {
  const resultado = criarResultadoHealthCheckAmbiente();

  try {
    const executor = resolverExecutorHealthCheckAmbiente();
    resultado.executorResolvido = executor.sucesso;
    if (!executor.sucesso) {
      return concluirHealthCheckAmbiente(resultado, false, executor.status);
    }

    const planilha = verificarPlanilhaHealthCheckAmbiente();
    resultado.planilhaAcessivel = planilha.planilhaAcessivel;
    resultado.abaBaseAcessivel = planilha.abaBaseAcessivel;
    if (!planilha.sucesso) {
      return concluirHealthCheckAmbiente(resultado, false, planilha.status);
    }

    const contaServico = verificarContaServicoHealthCheckAmbiente();
    resultado.serviceAccountConfigurada = contaServico.configurada;
    resultado.serviceAccountValida = contaServico.valida;
    if (!contaServico.sucesso) {
      return concluirHealthCheckAmbiente(resultado, false, contaServico.status);
    }

    const admin = verificarAdminUsersGetHealthCheckAmbiente(executor.email);
    resultado.adminUsersGetOk = admin.sucesso;
    if (!admin.sucesso) {
      return concluirHealthCheckAmbiente(resultado, false, admin.status);
    }

    const oauthGmail = verificarOAuthEGmailHealthCheckAmbiente(executor.email);
    resultado.oauthDelegadoOk = oauthGmail.oauthDelegadoOk;
    resultado.gmailSendAsGetOk = oauthGmail.gmailSendAsGetOk;
    if (!oauthGmail.sucesso) {
      return concluirHealthCheckAmbiente(resultado, false, oauthGmail.status);
    }

    return concluirHealthCheckAmbiente(resultado, true, 'AMBIENTE_PRONTO');
  } catch (erro) {
    return concluirHealthCheckAmbiente(resultado, false, 'HEALTH_CHECK_AMBIENTE_FALHOU');
  }
}

function criarResultadoHealthCheckAmbiente() {
  return {
    sucesso: false,
    status: 'AMBIENTE_NAO_VERIFICADO',
    executorResolvido: false,
    planilhaAcessivel: false,
    abaBaseAcessivel: false,
    adminUsersGetOk: false,
    serviceAccountConfigurada: false,
    serviceAccountValida: false,
    oauthDelegadoOk: false,
    gmailSendAsGetOk: false
  };
}

function concluirHealthCheckAmbiente(resultado, sucesso, status) {
  resultado.sucesso = sucesso;
  resultado.status = status || (sucesso ? 'AMBIENTE_PRONTO' : 'AMBIENTE_NAO_PRONTO');
  return resultado;
}

function resolverExecutorHealthCheckAmbiente() {
  try {
    if (typeof Session === 'undefined' || !Session.getEffectiveUser) {
      return criarFalhaHealthCheckAmbiente('EMAIL_EXECUTOR_NAO_RESOLVIDO');
    }

    const usuario = Session.getEffectiveUser();
    const email = usuario && usuario.getEmail ? normalizarEmailHealthCheckAmbiente(usuario.getEmail()) : '';

    if (!email) {
      return criarFalhaHealthCheckAmbiente('EMAIL_EXECUTOR_NAO_RESOLVIDO');
    }

    return {
      sucesso: true,
      status: 'EMAIL_EXECUTOR_RESOLVIDO',
      email: email
    };
  } catch (erro) {
    return criarFalhaHealthCheckAmbiente('EMAIL_EXECUTOR_NAO_RESOLVIDO');
  }
}

function verificarPlanilhaHealthCheckAmbiente() {
  const resultado = {
    sucesso: false,
    status: 'PLANILHA_INACESSIVEL',
    planilhaAcessivel: false,
    abaBaseAcessivel: false
  };

  try {
    const planilha = SpreadsheetApp.openById(AppInterno.obterIdPlanilhaDados());
    resultado.planilhaAcessivel = Boolean(planilha);

    if (!planilha || !planilha.getSheetByName) {
      return resultado;
    }

    const aba = planilha.getSheetByName(AppInterno.obterNomeAbaDados());
    resultado.abaBaseAcessivel = Boolean(aba);

    if (!aba || !aba.getLastRow || !aba.getLastColumn) {
      resultado.status = 'ABA_BASE_INACESSIVEL';
      return resultado;
    }

    const ultimaLinha = Number(aba.getLastRow());
    const ultimaColuna = Number(aba.getLastColumn());
    if (ultimaLinha < 1 || ultimaColuna < 1) {
      resultado.status = 'ABA_BASE_SEM_DADOS';
      return resultado;
    }

    resultado.sucesso = true;
    resultado.status = 'BASE_ASSINATURAS_ACESSIVEL';
    return resultado;
  } catch (erro) {
    return resultado;
  }
}

function verificarContaServicoHealthCheckAmbiente() {
  try {
    obterContaDeServico();
    return {
      sucesso: true,
      status: 'SERVICE_ACCOUNT_VALIDA',
      configurada: true,
      valida: true
    };
  } catch (erro) {
    const status = classificarErroContaServicoHealthCheckAmbiente(erro);
    return {
      sucesso: false,
      status: status,
      configurada: status !== 'SERVICE_ACCOUNT_NAO_CONFIGURADA',
      valida: false
    };
  }
}

function classificarErroContaServicoHealthCheckAmbiente(erro) {
  const mensagem = erro && erro.message ? erro.message.toString() : '';

  if (mensagem === 'SERVICE_ACCOUNT' + '_KEY_NAO_CONFIGURADA') {
    return 'SERVICE_ACCOUNT_NAO_CONFIGURADA';
  }

  return 'SERVICE_ACCOUNT_INVALIDA';
}

function verificarAdminUsersGetHealthCheckAmbiente(emailExecutor) {
  try {
    if (typeof AdminDirectory === 'undefined' || !AdminDirectory.Users || !AdminDirectory.Users.get) {
      return criarFalhaHealthCheckAmbiente('ADMIN_USERS_GET_FALHOU');
    }

    const usuario = AdminDirectory.Users.get(emailExecutor, {
      projection: 'basic'
    });

    if (!usuario) {
      return criarFalhaHealthCheckAmbiente('ADMIN_USERS_GET_FALHOU');
    }

    return {
      sucesso: true,
      status: 'ADMIN_USERS_GET_OK'
    };
  } catch (erro) {
    return criarFalhaHealthCheckAmbiente('ADMIN_USERS_GET_FALHOU');
  }
}

function verificarOAuthEGmailHealthCheckAmbiente(emailExecutor) {
  try {
    return executarComOAuthDelegado(emailExecutor, function(servico) {
      const oauth = verificarOAuthDelegadoHealthCheckAmbiente(servico);
      if (!oauth.sucesso) {
        return {
          sucesso: false,
          status: oauth.status,
          oauthDelegadoOk: false,
          gmailSendAsGetOk: false
        };
      }

      const gmail = verificarGmailSendAsGetHealthCheckAmbiente(emailExecutor, servico);
      if (!gmail.sucesso) {
        return {
          sucesso: false,
          status: gmail.status,
          oauthDelegadoOk: true,
          gmailSendAsGetOk: false
        };
      }

      return {
        sucesso: true,
        status: 'OAUTH_E_GMAIL_SENDAS_GET_OK',
        oauthDelegadoOk: true,
        gmailSendAsGetOk: true
      };
    });
  } catch (erro) {
    return {
      sucesso: false,
      status: 'OAUTH_DELEGADO_FALHOU',
      oauthDelegadoOk: false,
      gmailSendAsGetOk: false
    };
  }
}

function verificarOAuthDelegadoHealthCheckAmbiente(servico) {
  try {
    if (!servico || !servico.hasAccess || !servico.hasAccess()) {
      return criarFalhaHealthCheckAmbiente('OAUTH_DELEGADO_SEM_ACESSO');
    }

    return {
      sucesso: true,
      status: 'OAUTH_DELEGADO_OK'
    };
  } catch (erro) {
    return criarFalhaHealthCheckAmbiente('OAUTH_DELEGADO_FALHOU');
  }
}

function verificarGmailSendAsGetHealthCheckAmbiente(emailExecutor, servico) {
  try {
    const leitura = obterSendAsGmailComServico(emailExecutor, servico);

    if (!leitura || !leitura.sucesso) {
      return criarFalhaHealthCheckAmbiente('GMAIL_SENDAS_GET_FALHOU');
    }

    return {
      sucesso: true,
      status: 'GMAIL_SENDAS_GET_OK'
    };
  } catch (erro) {
    return criarFalhaHealthCheckAmbiente('GMAIL_SENDAS_GET_FALHOU');
  }
}

function criarFalhaHealthCheckAmbiente(status) {
  return {
    sucesso: false,
    status: status
  };
}

function normalizarEmailHealthCheckAmbiente(email) {
  return email ? email.toString().trim().toLowerCase() : '';
}


  return Object.freeze({
    obterContaDeServico: obterContaDeServico,
    obterServicoOAuth: obterServicoOAuth,
    obterDadosDoUsuario: obterDadosDoUsuario,
    injetarAssinatura: injetarAssinatura,
    obterSendAsGmailComServico: obterSendAsGmailComServico,
    verificarProntidao: verificarProntidaoAmbiente
  });
})();
