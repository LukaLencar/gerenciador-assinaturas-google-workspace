const AppInterno = (function() {
  function normalizarTextoParaBusca(texto) {
    return Regras.normalizarTextoParaBusca(texto);
  }

  function montarInfoDepartamento(departamentoPlanilha, filialPlanilha) {
    return Regras.montarInfoDepartamento(departamentoPlanilha, filialPlanilha);
  }

  function prepararDadosAssinatura(dadosUsuario, infoDepto) {
    return Regras.prepararDadosAssinatura(dadosUsuario, infoDepto);
  }

  function criarResultadoProcessamento(sucesso, status, email, mensagem, extras) {
    return Regras.criarResultadoProcessamento(sucesso, status, email, mensagem, extras);
  }

  function anexarEmailAoResultado(resultado, email) {
    return Regras.anexarEmailAoResultado(resultado, email);
  }

  function sanitizarMensagemErro(mensagem) {
    return Regras.sanitizarMensagemErro(mensagem);
  }

  function obterDadosDoUsuario(emailUsuario) {
    return GoogleInterno.obterDadosDoUsuario(emailUsuario);
  }

  function injetarAssinatura(emailUsuario, dadosAssinatura) {
    return GoogleInterno.injetarAssinatura(emailUsuario, dadosAssinatura);
  }

const CONFIG_EXECUCAO = Object.freeze({
  TAMANHO_MAXIMO_LOTE: 40,
  LIMITE_TEMPO_EXECUCAO_MS: 240000,
  MAX_TENTATIVAS_GMAIL: 3,
  BACKOFF_BASE_MS: 500,
  CHECKPOINT_KEY: 'GERENCIADOR_ASSINATURAS_CHECKPOINT_V1',
  LOCK_TIMEOUT_MS: 5000
});


function obterAgoraIsoExecucao() {
  return new Date().toISOString();
}

function criarResumoExecucaoVazio() {
  return {
    processados: 0,
    sucessos: 0,
    falhas: 0,
    porStatus: {}
  };
}

function obterCheckpointKeyExecucao(opcoes) {
  return opcoes && opcoes.checkpointKey ? opcoes.checkpointKey : CONFIG_EXECUCAO.CHECKPOINT_KEY;
}

function carregarCheckpointExecucaoPorKey(checkpointKey) {
  const valor = PropertiesService.getScriptProperties().getProperty(checkpointKey);
  if (!valor) return null;

  try {
    return JSON.parse(valor);
  } catch (erro) {
    return {
      versao: 1,
      modo: 'EMPRESA_TODA',
      status: 'BLOQUEADA',
      iniciadoEm: '',
      atualizadoEm: obterAgoraIsoExecucao(),
      proximoIndice: 0,
      totalBase: 0,
      fingerprintBase: '',
      acumulado: criarResumoExecucaoVazio(),
      mensagem: 'Checkpoint operacional inválido.'
    };
  }
}

function carregarCheckpointExecucao(checkpointKey) {
  return carregarCheckpointExecucaoPorKey(checkpointKey || CONFIG_EXECUCAO.CHECKPOINT_KEY);
}

function salvarCheckpointExecucaoPorKey(checkpointKey, checkpoint) {
  PropertiesService.getScriptProperties().setProperty(
    checkpointKey,
    JSON.stringify(checkpoint)
  );
}

function salvarCheckpointExecucao(checkpoint, checkpointKey) {
  salvarCheckpointExecucaoPorKey(checkpointKey || CONFIG_EXECUCAO.CHECKPOINT_KEY, checkpoint);
}

function limparCheckpointExecucaoPorKey(checkpointKey) {
  PropertiesService.getScriptProperties().deleteProperty(checkpointKey);
}

function limparCheckpointExecucao(checkpointKey) {
  limparCheckpointExecucaoPorKey(checkpointKey || CONFIG_EXECUCAO.CHECKPOINT_KEY);
}

function normalizarConfiguracaoCheckpointExecucao(opcoes) {
  const config = opcoes || {};
  return {
    modo: config.modo || 'EMPRESA_TODA',
    checkpointKey: obterCheckpointKeyExecucao(config),
    tamanhoLote: config.tamanhoLote || CONFIG_EXECUCAO.TAMANHO_MAXIMO_LOTE,
    limiteTempoExecucaoMs: config.limiteTempoExecucaoMs || CONFIG_EXECUCAO.LIMITE_TEMPO_EXECUCAO_MS,
    lockTimeoutMs: config.lockTimeoutMs || CONFIG_EXECUCAO.LOCK_TIMEOUT_MS,
    statusLockIndisponivel: config.statusLockIndisponivel || 'EXECUCAO_JA_EM_ANDAMENTO',
    mensagemLockIndisponivel: config.mensagemLockIndisponivel || 'Já existe uma atualização em andamento.',
    statusBaseAlterada: config.statusBaseAlterada || 'BASE_ALTERADA_DURANTE_EXECUCAO',
    statusConcluido: config.statusConcluido || 'EXECUCAO_CONCLUIDA',
    statusLoteProcessado: config.statusLoteProcessado || 'LOTE_PROCESSADO',
    statusErro: config.statusErro || 'BLOQUEADA',
    mensagemConcluido: config.mensagemConcluido || 'Atualização da empresa concluída.',
    mensagemLoteProcessado: config.mensagemLoteProcessado || 'Lote processado. Execute atualizarAssinaturas novamente para continuar.',
    ultimoCampo: config.ultimoCampo || 'ultimoEmailProcessado',
    obterIdentificadorUltimo: config.obterIdentificadorUltimo || function(candidato) {
      return candidato && candidato.email ? candidato.email : '';
    },
    obterContextoCandidatos: config.obterContextoCandidatos,
    processarCandidato: config.processarCandidato,
    validarAntesDeCheckpoint: config.validarAntesDeCheckpoint,
    criarResultadoFalha: config.criarResultadoFalha,
    criarResultadoConcluido: config.criarResultadoConcluido,
    criarResultadoLote: config.criarResultadoLote,
    bloquearCheckpointEmErroBase: config.bloquearCheckpointEmErroBase !== false
  };
}

function executarProcessamentoComCheckpoint(opcoes) {
  const config = normalizarConfiguracaoCheckpointExecucao(opcoes);
  const inicioExecucao = Date.now();
  const lock = LockService.getScriptLock();
  let lockObtido = false;

  try {
    lockObtido = lock.tryLock(config.lockTimeoutMs);
    if (!lockObtido) {
      return criarResultadoFalhaCheckpointGenerico(config, config.statusLockIndisponivel, config.mensagemLockIndisponivel);
    }

    const contexto = config.obterContextoCandidatos ? config.obterContextoCandidatos() : {
      sucesso: false,
      status: config.statusErro,
      mensagem: 'Contexto de candidatos não configurado.'
    };

    if (!contexto.sucesso) {
      return criarResultadoFalhaCheckpointGenerico(config, contexto.status || config.statusErro, contexto.mensagem || 'Falha ao preparar candidatos.', contexto.extras);
    }

    const candidatos = contexto.candidatos || [];
    const fingerprintBase = contexto.fingerprintBase || gerarFingerprintBase(candidatos);

    if (config.validarAntesDeCheckpoint) {
      const validacaoPrevia = config.validarAntesDeCheckpoint(contexto, fingerprintBase);
      if (!validacaoPrevia.sucesso) {
        return criarResultadoFalhaCheckpointGenerico(
          config,
          validacaoPrevia.status || config.statusErro,
          validacaoPrevia.mensagem || 'Execução não autorizada.',
          validacaoPrevia.extras
        );
      }
    }

    let checkpoint = carregarCheckpointExecucaoPorKey(config.checkpointKey);

    if (!checkpoint) {
      checkpoint = criarCheckpointExecucao(candidatos, fingerprintBase, {
        modo: config.modo,
        batchId: contexto.checkpointBatchId || contexto.batchId || ''
      });
      salvarCheckpointExecucaoPorKey(config.checkpointKey, checkpoint);
    } else {
      const validacaoCheckpoint = validarCheckpointContraBase(checkpoint, candidatos, fingerprintBase, {
        modo: config.modo,
        statusBaseAlterada: config.statusBaseAlterada
      });
      if (!validacaoCheckpoint.sucesso) {
        if (config.bloquearCheckpointEmErroBase) {
          marcarCheckpointBloqueado(checkpoint, validacaoCheckpoint.mensagem, config.checkpointKey);
        }
        return criarResultadoFalhaCheckpointGenerico(config, validacaoCheckpoint.status, validacaoCheckpoint.mensagem, {
          concluida: false,
          proximoIndice: checkpoint.proximoIndice,
          total: candidatos.length,
          resumo: checkpoint.acumulado
        });
      }
    }

    const lote = processarLoteCandidatosExecucao(
      candidatos,
      checkpoint,
      inicioExecucao,
      function(candidato, indiceAtual) {
        return config.processarCandidato(candidato, indiceAtual, contexto);
      },
      function(checkpointAtualizado) {
        salvarCheckpointExecucaoPorKey(config.checkpointKey, checkpointAtualizado);
      },
      config
    );

    if (lote.concluida) {
      const resumoFinal = checkpoint.acumulado;
      limparCheckpointExecucaoPorKey(config.checkpointKey);
      return criarResultadoConcluidoCheckpointGenerico(config, candidatos, checkpoint, lote, resumoFinal, contexto);
    }

    checkpoint.status = 'EM_ANDAMENTO';
    checkpoint.atualizadoEm = obterAgoraIsoExecucao();
    salvarCheckpointExecucaoPorKey(config.checkpointKey, checkpoint);

    return criarResultadoLoteCheckpointGenerico(config, candidatos, checkpoint, lote, contexto);
  } catch (erro) {
    const mensagemSanitizada = sanitizarMensagemErro(erro && erro.message ? erro.message : '');
    return criarResultadoFalhaCheckpointGenerico(config, config.statusErro, mensagemSanitizada);
  } finally {
    if (lockObtido) {
      lock.releaseLock();
    }
  }
}

function criarResultadoFalhaCheckpointGenerico(config, status, mensagem, extras) {
  if (config.criarResultadoFalha) {
    return config.criarResultadoFalha(status, mensagem, extras);
  }

  return criarResultadoProcessamento(false, status, '', mensagem, extras);
}

function criarResultadoConcluidoCheckpointGenerico(config, candidatos, checkpoint, lote, resumoFinal, contexto) {
  if (config.criarResultadoConcluido) {
    return config.criarResultadoConcluido(candidatos, checkpoint, lote, resumoFinal, contexto);
  }

  return {
    sucesso: true,
    status: config.statusConcluido,
    concluida: true,
    total: candidatos.length,
    resumo: resumoFinal,
    lote: lote,
    mensagem: config.mensagemConcluido
  };
}

function criarResultadoLoteCheckpointGenerico(config, candidatos, checkpoint, lote, contexto) {
  if (config.criarResultadoLote) {
    return config.criarResultadoLote(candidatos, checkpoint, lote, contexto);
  }

  return {
    sucesso: true,
    status: config.statusLoteProcessado,
    concluida: false,
    proximoIndice: checkpoint.proximoIndice,
    total: candidatos.length,
    resumo: checkpoint.acumulado,
    lote: lote,
    mensagem: config.mensagemLoteProcessado
  };
}

function criarListaCandidatosAtualizacao(mapaColaboradores) {
  const candidatos = [];
  mapaColaboradores.forEach((info, email) => {
    candidatos.push({
      email: email,
      emailNormalizado: normalizarEmailParaFingerprint(email),
      departamentoBaseFinal: normalizarCampoBaseParaFingerprint(info && info.departamentoBaseFinal),
      filialBaseFinal: normalizarCampoBaseParaFingerprint(info && info.filialBaseFinal),
      info: info
    });
  });

  return candidatos.sort((a, b) => a.emailNormalizado.localeCompare(b.emailNormalizado));
}

function normalizarEmailParaFingerprint(email) {
  return email ? email.toString().trim().toLowerCase() : '';
}

function normalizarCampoBaseParaFingerprint(valor) {
  return normalizarTextoParaBusca(valor || '');
}

function criarLinhaFingerprintCandidato(candidato) {
  return [
    normalizarEmailParaFingerprint(candidato.emailNormalizado || candidato.email),
    normalizarCampoBaseParaFingerprint(candidato.departamentoBaseFinal),
    normalizarCampoBaseParaFingerprint(candidato.filialBaseFinal)
  ].join('|');
}

function gerarHashLocalDeterministico(texto) {
  let hash = 2166136261;
  for (let i = 0; i < texto.length; i++) {
    hash ^= texto.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return ('00000000' + (hash >>> 0).toString(16)).slice(-8);
}

function gerarFingerprintBase(candidatos) {
  const candidatosOrdenados = candidatos.slice().sort((a, b) => {
    return normalizarEmailParaFingerprint(a.emailNormalizado || a.email).localeCompare(
      normalizarEmailParaFingerprint(b.emailNormalizado || b.email)
    );
  });
  const textoBase = candidatosOrdenados.map(criarLinhaFingerprintCandidato).join('\n');

  if (typeof Utilities !== 'undefined' && Utilities.computeDigest) {
    const digest = Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      textoBase,
      Utilities.Charset.UTF_8
    );

    return digest.map(byte => {
      const valor = byte < 0 ? byte + 256 : byte;
      return ('0' + valor.toString(16)).slice(-2);
    }).join('');
  }

  return gerarHashLocalDeterministico(textoBase);
}

function criarCheckpointExecucao(candidatos, fingerprintBase, opcoes) {
  const agora = obterAgoraIsoExecucao();
  const config = opcoes || {};

  const checkpoint = {
    versao: 1,
    modo: config.modo || 'EMPRESA_TODA',
    status: 'EM_ANDAMENTO',
    iniciadoEm: agora,
    atualizadoEm: agora,
    proximoIndice: 0,
    totalBase: candidatos.length,
    fingerprintBase: fingerprintBase,
    acumulado: criarResumoExecucaoVazio()
  };

  if (config.batchId) {
    checkpoint.batchId = config.batchId;
  }

  return checkpoint;
}

function validarCheckpointContraBase(checkpoint, candidatos, fingerprintBase, opcoes) {
  const config = opcoes || {};
  const modoEsperado = config.modo || 'EMPRESA_TODA';
  const statusBaseAlterada = config.statusBaseAlterada || 'BASE_ALTERADA_DURANTE_EXECUCAO';

  if (!checkpoint) {
    return {
      sucesso: true
    };
  }

  if (checkpoint.status === 'BLOQUEADA') {
    return criarResultadoProcessamento(false, statusBaseAlterada, '', checkpoint.mensagem || 'Execução bloqueada.');
  }

  if (checkpoint.modo !== modoEsperado || checkpoint.versao !== 1) {
    return criarResultadoProcessamento(false, statusBaseAlterada, '', 'Checkpoint incompatível com a execução atual.');
  }

  if (checkpoint.totalBase !== candidatos.length || checkpoint.fingerprintBase !== fingerprintBase) {
    return criarResultadoProcessamento(false, statusBaseAlterada, '', 'A base mudou durante a execução.');
  }

  if (checkpoint.proximoIndice < 0 || checkpoint.proximoIndice > candidatos.length) {
    return criarResultadoProcessamento(false, statusBaseAlterada, '', 'Checkpoint aponta para posição inválida da base.');
  }

  return {
    sucesso: true
  };
}

function marcarCheckpointBloqueado(checkpoint, mensagem, checkpointKey) {
  checkpoint.status = 'BLOQUEADA';
  checkpoint.atualizadoEm = obterAgoraIsoExecucao();
  checkpoint.mensagem = mensagem || 'Execução bloqueada.';
  salvarCheckpointExecucao(checkpoint, checkpointKey || CONFIG_EXECUCAO.CHECKPOINT_KEY);
}

function incorporarResultadoAoResumo(resumo, resultado) {
  const resultadoClassificado = classificarResultadoProcessamento(resultado);
  resumo.processados++;
  if (resultadoClassificado.sucesso) {
    resumo.sucessos++;
  } else {
    resumo.falhas++;
  }

  const status = resultadoClassificado.status;
  resumo.porStatus[status] = (resumo.porStatus[status] || 0) + 1;
}

function classificarResultadoProcessamento(resultado) {
  if (!resultado || typeof resultado !== 'object') {
    return criarResultadoProcessamento(false, 'FALHA_NAO_CLASSIFICADA', '', 'Falha sem resultado classificado.');
  }

  const status = normalizarStatusResultadoProcessamento(resultado.status, resultado.sucesso);
  resultado.status = status;
  return resultado;
}

function normalizarStatusResultadoProcessamento(status, sucesso) {
  const statusNormalizado = status ? status.toString().trim() : '';
  if (statusNormalizado) {
    return statusNormalizado;
  }

  return sucesso ? 'SUCESSO_NAO_CLASSIFICADO' : 'FALHA_NAO_CLASSIFICADA';
}

function criarResultadoFalhaCandidatoNaoClassificada() {
  return criarResultadoProcessamento(
    false,
    'FALHA_NAO_CLASSIFICADA',
    '',
    'Falha inesperada ao processar colaborador.'
  );
}

function processarLoteCandidatosExecucao(candidatos, checkpoint, inicioExecucao, processarCandidato, salvarAposItem, opcoes) {
  const config = normalizarConfiguracaoCheckpointExecucao(opcoes);
  const inicioIndice = checkpoint.proximoIndice || 0;
  let processadosNesteLote = 0;
  let limiteTempoAtingido = false;

  while (checkpoint.proximoIndice < candidatos.length && processadosNesteLote < config.tamanhoLote) {
    if (Date.now() - inicioExecucao >= config.limiteTempoExecucaoMs) {
      limiteTempoAtingido = true;
      break;
    }

    const indiceAtual = checkpoint.proximoIndice;
    const candidato = candidatos[indiceAtual];
    let resultado;
    try {
      resultado = processarCandidato(candidato, indiceAtual);
    } catch (erroCandidato) {
      resultado = criarResultadoFalhaCandidatoNaoClassificada();
    }

    incorporarResultadoAoResumo(checkpoint.acumulado, resultado);
    checkpoint.proximoIndice = indiceAtual + 1;
    if (config.ultimoCampo) {
      checkpoint[config.ultimoCampo] = config.obterIdentificadorUltimo(candidato, indiceAtual);
    }
    checkpoint.atualizadoEm = obterAgoraIsoExecucao();

    // Se houver interrupção antes deste salvar, no máximo este colaborador será repetido na retomada.
    if (salvarAposItem) {
      salvarAposItem(checkpoint);
    }

    processadosNesteLote++;
  }

  return {
    inicioIndice: inicioIndice,
    fimIndice: checkpoint.proximoIndice,
    processadosNesteLote: processadosNesteLote,
    limiteTempoAtingido: limiteTempoAtingido,
    concluida: checkpoint.proximoIndice >= candidatos.length
  };
}

function obterStatusAtualizacaoEmpresaToda() {
  const checkpoint = carregarCheckpointExecucao();

  if (!checkpoint) {
    return {
      emAndamento: false,
      status: 'SEM_EXECUCAO_ATIVA'
    };
  }

  return {
    emAndamento: checkpoint.status === 'EM_ANDAMENTO',
    status: checkpoint.status,
    iniciadoEm: checkpoint.iniciadoEm,
    atualizadoEm: checkpoint.atualizadoEm,
    proximoIndice: checkpoint.proximoIndice,
    totalBase: checkpoint.totalBase,
    resumo: checkpoint.acumulado
  };
}

function cancelarAtualizacaoEmpresaToda() {
  const lock = LockService.getScriptLock();
  let lockObtido = false;

  try {
    lockObtido = lock.tryLock(CONFIG_EXECUCAO.LOCK_TIMEOUT_MS);
    if (!lockObtido) {
      return criarResultadoProcessamento(false, 'EXECUCAO_JA_EM_ANDAMENTO', '', 'Já existe uma atualização em andamento.');
    }

    const checkpoint = carregarCheckpointExecucao();
    if (!checkpoint) {
      return criarResultadoProcessamento(false, 'SEM_EXECUCAO_ATIVA', '', 'Não há execução ativa para cancelar.');
    }

    limparCheckpointExecucao();
    return criarResultadoProcessamento(true, 'EXECUCAO_CANCELADA', '', 'Execução cancelada. Assinaturas já aplicadas não foram desfeitas.');
  } finally {
    if (lockObtido) {
      lock.releaseLock();
    }
  }
}


// Gerenciador de Assinaturas Google Workspace
// Arquivo principal de execucao

// 1. Configuracoes gerais
const SPREADSHEET_ID_PROPERTY = 'SPREADSHEET_ID';
const NOME_ABA_DADOS = 'Base Assinaturas';

const EMAILS_IGNORADOS = [
  'sistema@example.com'
];

function obterIdPlanilhaDadosConfigurada() {
  const id = PropertiesService.getScriptProperties().getProperty(SPREADSHEET_ID_PROPERTY);
  if (!id || !id.toString().trim()) {
    throw new Error('SPREADSHEET_ID_NAO_CONFIGURADO');
  }
  return id.toString().trim();
}

// 2. Motor de Leitura da Planilha
function mapearColaboradoresDaPlanilha() {
  const planilha = SpreadsheetApp.openById(obterIdPlanilhaDadosConfigurada()).getSheetByName(NOME_ABA_DADOS);
  const dados = planilha.getDataRange().getValues();
  const mapa = new Map();

  for (let i = 1; i < dados.length; i++) {
    const email = dados[i][0] ? dados[i][0].toString().trim() : '';
    const departamentoPlanilha = dados[i][2] ? dados[i][2].toString().trim() : ''; 
    const filialPlanilha = dados[i][3] ? dados[i][3].toString().trim() : ''; 

    if (!email || email.includes('#N') || departamentoPlanilha.includes('#N') || EMAILS_IGNORADOS.includes(email.toLowerCase())) continue;

    const infoDepto = montarInfoDepartamento(departamentoPlanilha, filialPlanilha);
    infoDepto.email = email;
    infoDepto.emailBaseFinal = email.toLowerCase();
    infoDepto.departamentoBaseFinal = normalizarTextoParaBusca(departamentoPlanilha);
    infoDepto.filialBaseFinal = normalizarTextoParaBusca(filialPlanilha);
    mapa.set(email, infoDepto);
  }
  return mapa;
}

// =======================================================================
// INJEÇÃO NO GMAIL
// =======================================================================

// Função centralizada para aplicar a regra do telefone e injetar
function processarEInjetarAssinatura(emailUsuario, infoDepto) {
  if (!infoDepto) {
    return criarResultadoProcessamento(false, 'CARGO_NAO_MAPEADO', emailUsuario, 'Dados do colaborador não foram processados.');
  }

  if (infoDepto.sucesso === false) {
    return anexarEmailAoResultado(infoDepto, emailUsuario);
  }

  if (!infoDepto.cargoPadrao) {
    return criarResultadoProcessamento(false, 'CARGO_NAO_MAPEADO', emailUsuario, 'Cargo/departamento não mapeado.', {
      filial: infoDepto.filial,
      departamento: infoDepto.departamento
    });
  }

  const dadosUsuario = obterDadosDoUsuario(emailUsuario); 
  if (!dadosUsuario) {
    return criarResultadoProcessamento(false, 'USUARIO_NAO_ENCONTRADO', emailUsuario, 'Usuário não localizado no Google Workspace.', {
      filial: infoDepto.filial,
      departamento: infoDepto.departamento
    });
  }

  const dadosAssinatura = prepararDadosAssinatura(dadosUsuario, infoDepto);
  return injetarAssinatura(emailUsuario, dadosAssinatura);
}

// ===================================================
// FUNÇÃO OFICIAL: RODA PARA A EMPRESA INTEIRA
// ===================================================
function executarAtualizacaoEmpresaToda() {
  console.log("ATENÇÃO: Iniciando injeção REAL para TODA A EMPRESA...");

  return executarProcessamentoComCheckpoint({
    modo: 'EMPRESA_TODA',
    checkpointKey: CONFIG_EXECUCAO.CHECKPOINT_KEY,
    tamanhoLote: CONFIG_EXECUCAO.TAMANHO_MAXIMO_LOTE,
    limiteTempoExecucaoMs: CONFIG_EXECUCAO.LIMITE_TEMPO_EXECUCAO_MS,
    lockTimeoutMs: CONFIG_EXECUCAO.LOCK_TIMEOUT_MS,
    statusLockIndisponivel: 'EXECUCAO_JA_EM_ANDAMENTO',
    statusBaseAlterada: 'BASE_ALTERADA_DURANTE_EXECUCAO',
    statusConcluido: 'EXECUCAO_CONCLUIDA',
    statusLoteProcessado: 'LOTE_PROCESSADO',
    statusErro: 'BLOQUEADA',
    obterContextoCandidatos: function() {
      const mapaColaboradores = mapearColaboradoresDaPlanilha();
      const candidatos = criarListaCandidatosAtualizacao(mapaColaboradores);
      return {
        sucesso: true,
        candidatos: candidatos,
        fingerprintBase: gerarFingerprintBase(candidatos)
      };
    },
    processarCandidato: function(candidato) {
      return processarEInjetarAssinatura(candidato.email, candidato.info);
    },
    criarResultadoConcluido: function(candidatos, checkpoint, lote, resumoFinal) {
      console.log('Execução concluída: ' + JSON.stringify(resumoFinal));
      return {
        sucesso: true,
        status: 'EXECUCAO_CONCLUIDA',
        concluida: true,
        total: candidatos.length,
        resumo: resumoFinal,
        lote: lote,
        mensagem: 'Atualização da empresa concluída.'
      };
    },
    criarResultadoLote: function(candidatos, checkpoint, lote) {
      console.log('Lote processado: ' + JSON.stringify(lote));
      return {
        sucesso: true,
        status: 'LOTE_PROCESSADO',
        concluida: false,
        proximoIndice: checkpoint.proximoIndice,
        total: candidatos.length,
        resumo: checkpoint.acumulado,
        lote: lote,
        mensagem: 'Lote processado. Execute atualizarAssinaturas novamente para continuar.'
      };
    }
  });
}


  function obterConfigExecucao() {
    return CONFIG_EXECUCAO;
  }

  function obterIdPlanilhaDados() {
    return obterIdPlanilhaDadosConfigurada();
  }

  function obterNomeAbaDados() {
    return NOME_ABA_DADOS;
  }

  function verStatusAtualizacaoPublico() {
    const statusAtual = obterStatusAtualizacaoEmpresaToda();
    if (!statusAtual || statusAtual.status === 'SEM_EXECUCAO_ATIVA') {
      return {
        sucesso: true,
        status: 'SEM_EXECUCAO',
        emAndamento: false
      };
    }

    const resumo = statusAtual.resumo || {};
    return {
      sucesso: true,
      status: statusAtual.emAndamento ? 'EM_ANDAMENTO' : statusAtual.status,
      emAndamento: Boolean(statusAtual.emAndamento),
      processados: resumo.processados || 0,
      total: statusAtual.totalBase || 0,
      proximoIndice: statusAtual.proximoIndice || 0,
      sucessos: resumo.sucessos || 0,
      falhas: resumo.falhas || 0,
      porStatus: sanitizarPorStatusResultadoPublico(resumo.porStatus || {}),
      atualizadoEm: statusAtual.atualizadoEm || ''
    };
  }

  function cancelarAtualizacaoPublico() {
    const resultado = cancelarAtualizacaoEmpresaToda();
    resultado.observacao = 'Cancelamento remove apenas o checkpoint; assinaturas ja processadas nao sao desfeitas.';
    return resultado;
  }

  function executarOperacaoPublica(rotulo, executar) {
    const resultado = executar();
    const seguro = sanitizarResultadoPublico(resultado);
    console.log(rotulo + '=' + JSON.stringify(seguro));
    return seguro;
  }

  function sanitizarResultadoPublico(valor, chave) {
    if (valor === null || valor === undefined) {
      return valor;
    }

    if (Array.isArray(valor)) {
      return valor.map(item => sanitizarResultadoPublico(item, chave));
    }

    if (typeof valor === 'object') {
      const seguro = {};
      Object.keys(valor).forEach(nomeChave => {
        if (nomeChave === 'porStatus') {
          seguro[nomeChave] = sanitizarPorStatusResultadoPublico(valor[nomeChave]);
        } else if (!deveOmitirChaveResultadoPublico(nomeChave)) {
          seguro[nomeChave] = sanitizarResultadoPublico(valor[nomeChave], nomeChave);
        }
      });
      return seguro;
    }

    if (typeof valor === 'string') {
      return sanitizarTextoResultadoPublico(valor, chave);
    }

    return valor;
  }

  function deveOmitirChaveResultadoPublico(chave) {
    const normalizada = (chave || '').toString().toLowerCase();
    return normalizada === 'email' ||
      normalizada.indexOf('email') >= 0 ||
      normalizada.indexOf('nome') >= 0 ||
      normalizada.indexOf('telefone') >= 0 ||
      normalizada.indexOf('celular') >= 0 ||
      normalizada.indexOf('endereco') >= 0 ||
      normalizada.indexOf('html') >= 0 ||
      normalizada === 'signature' ||
      normalizada === 'assinatura' ||
      normalizada === 'assinaturaatual' ||
      normalizada === 'signaturerespostapatch' ||
      normalizada === 'assinaturacanonica' ||
      normalizada === 'assinaturaanterior' ||
      normalizada.indexOf('token') >= 0 ||
      normalizada.indexOf('authorization') >= 0 ||
      normalizada.indexOf('credencial') >= 0 ||
      normalizada.indexOf('private') >= 0 ||
      normalizada.indexOf('client_') >= 0 ||
      normalizada === 'headers' ||
      normalizada === 'payload' ||
      normalizada === 'sendas';
  }

  function sanitizarTextoResultadoPublico(texto, chave) {
    if (!texto) {
      return texto;
    }

    const normalizada = (chave || '').toString().toLowerCase();
    if (normalizada.indexOf('mensagem') >= 0 || normalizada.indexOf('status') >= 0 || normalizada.indexOf('observacao') >= 0) {
      return Regras.sanitizarMensagemErro(texto);
    }

    if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+.[A-Z]{2,}/i.test(texto) || /<[^>]+>/.test(texto) || /Bearers+/i.test(texto)) {
      return '[REMOVIDO]';
    }

    return Regras.sanitizarMensagemErro(texto);
  }

  function sanitizarPorStatusResultadoPublico(porStatus) {
    const seguro = {};
    if (!porStatus || typeof porStatus !== 'object') {
      return seguro;
    }

    Object.keys(porStatus).forEach(status => {
      const chaveSegura = sanitizarChavePorStatusResultadoPublico(status);
      const quantidade = Number(porStatus[status]) || 0;
      seguro[chaveSegura] = (seguro[chaveSegura] || 0) + quantidade;
    });

    return seguro;
  }

  function sanitizarChavePorStatusResultadoPublico(status) {
    const texto = status ? status.toString().trim().toUpperCase() : '';
    if (!texto) {
      return 'STATUS_NAO_CLASSIFICADO';
    }

    if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(texto) || /<[^>]+>/.test(texto) || /BEARER\s+/i.test(texto)) {
      return 'STATUS_REMOVIDO';
    }

    const chave = texto.replace(/[^A-Z0-9_]/g, '_').replace(/_+/g, '_').substring(0, 80);
    return chave || 'STATUS_NAO_CLASSIFICADO';
  }

  return Object.freeze({
    obterConfigExecucao: obterConfigExecucao,
    obterIdPlanilhaDados: obterIdPlanilhaDados,
    obterNomeAbaDados: obterNomeAbaDados,
    mapearColaboradoresDaPlanilha: mapearColaboradoresDaPlanilha,
    atualizarAssinaturas: executarAtualizacaoEmpresaToda,
    verStatusAtualizacao: verStatusAtualizacaoPublico,
    cancelarAtualizacao: cancelarAtualizacaoPublico,
    executarOperacaoPublica: executarOperacaoPublica
  });
})();

function verificarProntidao() {
  return AppInterno.executarOperacaoPublica('VERIFICAR_PRONTIDAO', function() {
    return GoogleInterno.verificarProntidao();
  });
}

function gerarPreview() {
  return AppInterno.executarOperacaoPublica('GERAR_PREVIEW', function() {
    return PreviewInterno.gerarPreview();
  });
}

function atualizarAssinaturas() {
  return AppInterno.executarOperacaoPublica('ATUALIZAR_ASSINATURAS', function() {
    return AppInterno.atualizarAssinaturas();
  });
}

function verStatusAtualizacao() {
  return AppInterno.executarOperacaoPublica('STATUS_ATUALIZACAO', function() {
    return AppInterno.verStatusAtualizacao();
  });
}

function cancelarAtualizacao() {
  return AppInterno.executarOperacaoPublica('CANCELAR_ATUALIZACAO', function() {
    return AppInterno.cancelarAtualizacao();
  });
}
