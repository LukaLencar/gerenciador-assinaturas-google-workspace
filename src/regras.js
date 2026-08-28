const Regras = (function() {
const DICIONARIO_CARGOS = {
  'ADMINISTRATIVO': 'Administrativo',
  'COMERCIAL': 'Comercial',
  'FINANCEIRO': 'Financeiro',
  'OPERACOES': 'Operacoes',
  'RECURSOS HUMANOS': 'Recursos Humanos',
  'RH': 'Recursos Humanos',
  'TECNOLOGIA': 'Tecnologia',
  'TI': 'Tecnologia',
  'DIRETORIA': 'Diretoria'
};

const DICIONARIO_ENDERECOS = {
  'MATRIZ': {
    linha1: 'Av. Exemplo, 1000 - 10 andar',
    linha2: 'Centro Empresarial Exemplo - CEP: 00000-000 - Sao Paulo - SP - Brasil',
    telefone: '(11) 3000-0000'
  },
  'UNIDADE SAO PAULO': {
    linha1: 'Rua Modelo, 200 - Sala 10',
    linha2: 'Bairro Exemplo - CEP: 00000-001 - Sao Paulo - SP - Brasil',
    telefone: '(11) 3000-0001'
  },
  'UNIDADE CAMPINAS': {
    linha1: 'Av. Demonstracao, 300 - Conjunto 5',
    linha2: 'Bairro Exemplo - CEP: 00000-002 - Campinas - SP - Brasil',
    telefone: '(19) 3000-0002'
  },
  'UNIDADE RECIFE': {
    linha1: 'Rua Publica, 400 - Sala 20',
    linha2: 'Bairro Exemplo - CEP: 00000-003 - Recife - PE - Brasil',
    telefone: '(81) 3000-0003'
  }
};

const SETORES_ENDERECO_ALTERNATIVO_MATRIZ = [
  'DIRETORIA',
  'TECNOLOGIA',
  'TI'
];

function normalizarTextoParaBusca(texto) {
  if (!texto) return '';
  return texto.toString().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
}

function formatarNomeFilial(texto) {
  if (!texto) return '';
  const excecoes = ['de', 'da', 'do', 'das', 'dos', 'e'];
  const partes = texto.toString().trim().toLowerCase().split(' - ');
  const nomeCidade = partes[0].split(' ').map((palavra, index) => {
    if (excecoes.indexOf(palavra) >= 0 && index !== 0) return palavra;
    return palavra.charAt(0).toUpperCase() + palavra.slice(1);
  }).join(' ');

  if (partes.length > 1) {
    return nomeCidade + ' - ' + partes[1].toUpperCase();
  }

  return nomeCidade;
}

function sanitizarMensagemErro(mensagem) {
  if (!mensagem) return 'Erro nao detalhado.';
  let mensagemSanitizada = mensagem.toString()
    .replace(/-----BEGIN[\s\S]*?-----END [^-]+-----/g, '[CONTEUDO_SENSIVEL_REMOVIDO]')
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/g, 'Bearer [TOKEN_REMOVIDO]');
  const camposSensiveis = ['private' + '_key', 'client' + '_email', 'client' + '_id'];

  camposSensiveis.forEach(campo => {
    const regexCampo = new RegExp('"' + campo + '"\\s*:\\s*"[^"]+"', 'gi');
    mensagemSanitizada = mensagemSanitizada.replace(regexCampo, '"' + campo + '":"[REMOVIDO]"');
  });

  return mensagemSanitizada;
}

function criarResultadoProcessamento(sucesso, status, email, mensagem, extras) {
  const resultado = {
    sucesso: sucesso,
    status: status,
    email: email || '',
    mensagem: mensagem || ''
  };

  if (extras) {
    Object.keys(extras).forEach(chave => {
      if (extras[chave] !== undefined) {
        resultado[chave] = extras[chave];
      }
    });
  }

  return resultado;
}

function anexarEmailAoResultado(resultado, email) {
  return criarResultadoProcessamento(false, resultado.status, email, resultado.mensagem, {
    filial: resultado.filial,
    departamento: resultado.departamento
  });
}

function validarEndereco(endereco) {
  if (!endereco) {
    return criarResultadoProcessamento(false, 'ENDERECO_INCOMPLETO', '', 'Endereco nao localizado.');
  }

  if (!endereco.linha1 || !endereco.linha1.toString().trim() || !endereco.linha2 || !endereco.linha2.toString().trim()) {
    return criarResultadoProcessamento(false, 'ENDERECO_INCOMPLETO', '', 'Endereco incompleto.');
  }

  return {
    sucesso: true,
    endereco: endereco
  };
}

function resolverEnderecoFilial(filialNormalizada) {
  const filial = filialNormalizada || '';
  const isMatriz = filial === '' || filial === 'MATRIZ';
  const chaveEndereco = isMatriz ? 'MATRIZ' : filial;
  const endereco = DICIONARIO_ENDERECOS[chaveEndereco];

  if (!isMatriz && !endereco) {
    return criarResultadoProcessamento(false, 'FILIAL_NAO_MAPEADA', '', 'Filial nao mapeada.', {
      filial: chaveEndereco
    });
  }

  const validacaoEndereco = validarEndereco(endereco);
  if (!validacaoEndereco.sucesso) {
    return criarResultadoProcessamento(false, 'ENDERECO_INCOMPLETO', '', validacaoEndereco.mensagem, {
      filial: chaveEndereco
    });
  }

  return {
    sucesso: true,
    isMatriz: isMatriz,
    filial: chaveEndereco,
    endereco: endereco
  };
}

function obterEnderecoComRegraDeAndar(filialNormalizada, setorNormalizado) {
  const resolucaoEndereco = resolverEnderecoFilial(filialNormalizada);
  if (!resolucaoEndereco.sucesso) {
    return resolucaoEndereco;
  }

  const enderecoFinal = {
    linha1: resolucaoEndereco.endereco.linha1,
    linha2: resolucaoEndereco.endereco.linha2,
    telefone: resolucaoEndereco.endereco.telefone
  };

  if (resolucaoEndereco.isMatriz && SETORES_ENDERECO_ALTERNATIVO_MATRIZ.indexOf(setorNormalizado) >= 0) {
    enderecoFinal.linha1 = 'Av. Exemplo, 1000 - 20 andar';
  }

  const validacaoEndereco = validarEndereco(enderecoFinal);
  if (!validacaoEndereco.sucesso) {
    return criarResultadoProcessamento(false, 'ENDERECO_INCOMPLETO', '', validacaoEndereco.mensagem, {
      filial: resolucaoEndereco.filial
    });
  }

  return {
    sucesso: true,
    isMatriz: resolucaoEndereco.isMatriz,
    filial: resolucaoEndereco.filial,
    endereco: enderecoFinal
  };
}

function obterCargoPadrao(setorNormalizado, isMatriz) {
  if (!isMatriz) return 'Unidade';
  return DICIONARIO_CARGOS[setorNormalizado] || '';
}

function obterNomeVisualDepartamento(departamentoPlanilha, filialPlanilha, setorNormalizado, isMatriz) {
  if (!isMatriz) {
    return 'Unidade ' + formatarNomeFilial(filialPlanilha);
  }

  if (setorNormalizado === 'TECNOLOGIA' || setorNormalizado === 'TI') return 'Departamento de Tecnologia';
  if (setorNormalizado === 'RH') return 'Departamento de Recursos Humanos';
  return 'Departamento ' + departamentoPlanilha;
}

function montarInfoDepartamento(departamentoPlanilha, filialPlanilha) {
  const setorNormalizado = normalizarTextoParaBusca(departamentoPlanilha);
  const filialNormalizada = normalizarTextoParaBusca(filialPlanilha);
  const resolucaoEndereco = obterEnderecoComRegraDeAndar(filialNormalizada, setorNormalizado);

  if (!resolucaoEndereco.sucesso) {
    return criarResultadoProcessamento(false, resolucaoEndereco.status, '', resolucaoEndereco.mensagem, {
      filial: filialNormalizada || 'MATRIZ',
      departamento: setorNormalizado
    });
  }

  const cargo = obterCargoPadrao(setorNormalizado, resolucaoEndereco.isMatriz);
  if (!cargo) {
    return criarResultadoProcessamento(false, 'CARGO_NAO_MAPEADO', '', 'Cargo/departamento nao mapeado.', {
      filial: resolucaoEndereco.filial,
      departamento: setorNormalizado
    });
  }

  return {
    sucesso: true,
    departamentoVisual: obterNomeVisualDepartamento(departamentoPlanilha, filialPlanilha, setorNormalizado, resolucaoEndereco.isMatriz),
    cargoPadrao: cargo,
    endereco: resolucaoEndereco.endereco,
    isMatriz: resolucaoEndereco.isMatriz,
    filial: resolucaoEndereco.filial,
    departamento: setorNormalizado
  };
}

function prepararTelefoneFixoAssinatura(telefone) {
  const telefoneFixo = telefone ? telefone.toString().trim() : '';
  return telefoneFixo === '(00) 0000-0000' ? '' : telefoneFixo;
}

function prepararCelularAssinatura(celular, telefoneFixo) {
  let celularAssinatura = celular ? celular.toString().trim() : '';
  if (celularAssinatura.toLowerCase() === 'undefined' || celularAssinatura.toLowerCase() === 'null') {
    celularAssinatura = '';
  }
  if (celularAssinatura === telefoneFixo) {
    celularAssinatura = '';
  }
  return celularAssinatura;
}

function prepararDadosAssinatura(dadosUsuario, infoDepto) {
  const telefoneFixo = prepararTelefoneFixoAssinatura(infoDepto.endereco.telefone || '');
  const celular = prepararCelularAssinatura(dadosUsuario.celular, telefoneFixo);

  return {
    nome: dadosUsuario.nome,
    cargo: infoDepto.cargoPadrao,
    departamento: infoDepto.departamentoVisual,
    enderecoLinha1: infoDepto.endereco.linha1,
    enderecoLinha2: infoDepto.endereco.linha2,
    telefoneFixo: telefoneFixo,
    celular: celular
  };
}

function criarResumoResultados(resultados) {
  const resumo = {
    processados: resultados.length,
    sucessos: 0,
    falhas: 0,
    porStatus: {}
  };

  resultados.forEach(resultado => {
    if (resultado.sucesso) {
      resumo.sucessos++;
    } else {
      resumo.falhas++;
    }

    const status = resultado.status || 'ERRO_GMAIL_API';
    resumo.porStatus[status] = (resumo.porStatus[status] || 0) + 1;
  });

  return resumo;
}

  return Object.freeze({
    normalizarTextoParaBusca: normalizarTextoParaBusca,
    formatarNomeFilial: formatarNomeFilial,
    montarInfoDepartamento: montarInfoDepartamento,
    prepararDadosAssinatura: prepararDadosAssinatura,
    prepararTelefoneFixoAssinatura: prepararTelefoneFixoAssinatura,
    prepararCelularAssinatura: prepararCelularAssinatura,
    criarResultadoProcessamento: criarResultadoProcessamento,
    anexarEmailAoResultado: anexarEmailAoResultado,
    criarResumoResultados: criarResumoResultados,
    sanitizarMensagemErro: sanitizarMensagemErro
  });
})();
