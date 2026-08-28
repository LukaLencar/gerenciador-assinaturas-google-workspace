const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const SOURCES = [
  'src/regras.js',
  'src/google.js',
  'src/preview.js',
  'src/app.js'
];

const EXPECTED_PUBLIC_API = [
  'verificarProntidao',
  'gerarPreview',
  'atualizarAssinaturas',
  'verStatusAtualizacao',
  'cancelarAtualizacao'
].sort();

const EXPECTED_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/admin.directory.user.readonly',
  'https://www.googleapis.com/auth/script.external_request',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/userinfo.email'
];

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message + ' | expected=' + expected + ' actual=' + actual);
  }
}

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function allText() {
  return fs.readdirSync(ROOT, { withFileTypes: true }).flatMap(function walk(entry) {
    const full = path.join(ROOT, entry.name);
    if (entry.name === 'node_modules' || entry.name === '.git') return [];
    if (entry.isDirectory()) {
      return fs.readdirSync(full, { withFileTypes: true }).flatMap(child => walk({
        name: path.join(entry.name, child.name),
        isDirectory: () => child.isDirectory(),
        isFile: () => child.isFile()
      }));
    }
    return entry.isFile() && /\.(js|json|html|md|csv|gitignore|example)$/.test(entry.name)
      ? [fs.readFileSync(full, 'utf8')]
      : [];
  }).join('\n');
}

function countPattern(text, pattern) {
  return (text.match(pattern) || []).length;
}

function topLevelFunctions(relPath) {
  const text = read(relPath);
  const names = [];
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.startsWith('function ', i) && depth === 0) {
      const match = /^function\s+([A-Za-z0-9_]+)\s*\(/.exec(text.slice(i));
      if (match) names.push(match[1]);
    }
    if (text[i] === '{') depth++;
    if (text[i] === '}') depth--;
  }
  return names;
}

function allTopLevelFunctions() {
  return SOURCES.flatMap(file => topLevelFunctions(file)).sort();
}

function sourceForVm(relPath) {
  let source = read(relPath);
  if (relPath === 'src/app.js') {
    source = source.replace(
      '  return Object.freeze({\n    obterConfigExecucao: obterConfigExecucao,',
      [
        '  this.__appTestHooks = Object.freeze({',
        '    gerarFingerprintBase: gerarFingerprintBase,',
        '    criarListaCandidatosAtualizacao: criarListaCandidatosAtualizacao',
        '  });',
        '',
        '  return Object.freeze({',
        '    obterConfigExecucao: obterConfigExecucao,'
      ].join('\n')
    );
  }
  return source;
}

function appScriptBundle() {
  return SOURCES.map(sourceForVm).join('\n') + '\nthis.__hooks = Object.freeze({ AppInterno, GoogleInterno, PreviewInterno, Regras, app: this.__appTestHooks });';
}

function createServiceAccount() {
  const account = {};
  account['client_' + 'email'] = 'service-account@example.com';
  account['private_' + 'key'] = 'PLACEHOLDER_KEY_VALUE';
  return account;
}

function decodeBase64Url(value) {
  let normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  while (normalized.length % 4) normalized += '=';
  return Buffer.from(normalized, 'base64').toString('utf8');
}

function createEnv(options = {}) {
  const props = Object.assign({
    SPREADSHEET_ID: 'spreadsheet-example-id',
    SERVICE_ACCOUNT_KEY: JSON.stringify(createServiceAccount()),
    GERENCIADOR_ASSINATURAS_PREVIEW_EMAILS: JSON.stringify([
      'ana.silva@example.com',
      'bruno.costa@example.com'
    ])
  }, options.props || {});

  const state = {
    logs: [],
    fetches: [],
    services: [],
    resets: 0,
    draftCreates: [],
    sleeps: [],
    currentSignature: '<assinatura-antiga>'
  };

  const propertyStore = {
    getProperty(key) {
      return Object.prototype.hasOwnProperty.call(props, key) ? props[key] : null;
    },
    setProperty(key, value) {
      props[key] = String(value);
      return this;
    },
    deleteProperty(key) {
      delete props[key];
      return this;
    },
    getProperties() {
      return Object.assign({}, props);
    }
  };

  function emailFromUrl(url) {
    const match = /\/users\/([^/]+)\/settings\/sendAs\//.exec(url);
    return match ? decodeURIComponent(match[1]) : 'usuario@example.com';
  }

  const context = {
    console: {
      log(message) { state.logs.push(String(message || '')); },
      error() {}
    },
    PropertiesService: {
      getScriptProperties() { return propertyStore; }
    },
    LockService: {
      getScriptLock() {
        return {
          tryLock() { return true; },
          releaseLock() {}
        };
      }
    },
    OAuth2: {
      createService(name) {
        const service = {
          name,
          subject: '',
          setTokenUrl() { return this; },
          setPrivateKey() { return this; },
          setIssuer() { return this; },
          setSubject(value) { this.subject = value; return this; },
          setPropertyStore() { return this; },
          setParam() { return this; },
          setScope(value) { this.scope = value; return this; },
          hasAccess() { return true; },
          getAccessToken() { return 'LOCAL_ONLY_TOKEN'; },
          reset() { state.resets++; }
        };
        state.services.push(service);
        return service;
      }
    },
    UrlFetchApp: {
      fetch(url, fetchOptions) {
        const method = ((fetchOptions && fetchOptions.method) || 'get').toLowerCase();
        const email = emailFromUrl(url);
        const planned = (options.fetchPlan || [])[state.fetches.length];
        const status = planned && planned.status ? planned.status : 200;

        if (method === 'patch' && status >= 200 && status < 300) {
          const payload = JSON.parse(fetchOptions.payload || '{}');
          state.currentSignature = payload.signature || '';
        }

        state.fetches.push({ method, status });

        return {
          getResponseCode() { return status; },
          getContentText() {
            return JSON.stringify({
              sendAsEmail: email,
              signature: state.currentSignature,
              isPrimary: true,
              isDefault: true
            });
          }
        };
      }
    },
    AdminDirectory: {
      Users: {
        get(email) {
          return {
            name: { fullName: email.split('@')[0].replace('.', ' ') },
            organizations: [{ title: 'Analista', department: 'Tecnologia' }],
            phones: [
              { type: 'work', value: '(11) 3000-0000' },
              { type: 'mobile', value: '(11) 90000-0000' }
            ]
          };
        }
      },
      Members: {
        list() {
          throw new Error('Members.list nao e usado pelos testes publicos');
        }
      }
    },
    SpreadsheetApp: {
      openById(id) {
        assertEqual(id, 'spreadsheet-example-id', 'SPREADSHEET_ID');
        return {
          getSheetByName(name) {
            assertEqual(name, 'Base Assinaturas', 'nome da aba');
            return {
              getLastRow() { return 4; },
              getLastColumn() { return 4; },
              getDataRange() {
                return {
                  getValues() {
                    return [
                      ['Email', 'Nome Completo', 'Departamento', 'Filial'],
                      ['ana.silva@example.com', 'Ana Silva', 'Tecnologia', 'Matriz'],
                      ['bruno.costa@example.com', 'Bruno Costa', 'Comercial', 'Unidade Sao Paulo'],
                      ['carla.souza@example.com', 'Carla Souza', 'Operacoes', 'Unidade Campinas']
                    ];
                  }
                };
              }
            };
          }
        };
      }
    },
    Session: {
      getEffectiveUser() {
        return { getEmail() { return 'executor@example.com'; } };
      },
      getActiveUser() {
        return { getEmail() { return 'executor@example.com'; } };
      }
    },
    HtmlService: {
      createTemplateFromFile() {
        const template = {};
        template.evaluate = function evaluate() {
          return {
            getContent() {
              return '<div>Empresa Exemplo|' + (template.nome || '') + '|' + (template.departamento || '') + '</div>';
            }
          };
        };
        return template;
      }
    },
    Gmail: {
      Users: {
        Drafts: {
          create(payload) {
            state.draftCreates.push(payload);
            return { id: 'draft-example' };
          }
        },
        Messages: {
          send() {
            throw new Error('send nao deve ser usado');
          }
        }
      }
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      Charset: { UTF_8: 'UTF_8' },
      computeDigest(algorithm, text) {
        return Array.from(crypto.createHash('sha256').update(String(text || ''), 'utf8').digest())
          .map(byte => byte > 127 ? byte - 256 : byte);
      },
      newBlob(text) {
        return {
          getBytes() {
            return Buffer.from(String(text || ''), 'utf8');
          }
        };
      },
      base64EncodeWebSafe(bytes) {
        return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
      },
      sleep(ms) {
        state.sleeps.push(ms);
      }
    },
    Date,
    JSON,
    Map,
    Number,
    Object,
    RegExp,
    String,
    Boolean,
    Math,
    Buffer,
    encodeURIComponent,
    decodeURIComponent
  };

  vm.createContext(context);
  vm.runInContext(appScriptBundle(), context, { filename: 'apps-script-public.js' });
  return { context, state, props };
}

test('estrutura publica preserva somente configuracao clasp segura', () => {
  assert(fs.existsSync(path.join(ROOT, 'src', 'app.js')), 'src/app.js ausente');
  assert(fs.existsSync(path.join(ROOT, 'templates', 'padrao.html')), 'template ausente');
  assert(fs.existsSync(path.join(ROOT, '.clasp.json.example')), '.clasp.json.example ausente');
  assert(fs.existsSync(path.join(ROOT, '.gitignore')), '.gitignore ausente');
  assert(!fs.existsSync(path.join(ROOT, '.clasp.json')), '.clasp.json real nao deve existir');
});

test('manifest preserva cinco scopes e servicos Apps Script', () => {
  const manifest = JSON.parse(read('appsscript.json'));
  assertEqual((manifest.oauthScopes || []).join('|'), EXPECTED_SCOPES.join('|'), 'scopes');
  assertEqual(manifest.timeZone, 'America/Sao_Paulo', 'timezone');
  assertEqual(manifest.runtimeVersion, 'V8', 'runtime');
  assertEqual(manifest.exceptionLogging, 'STACKDRIVER', 'exception logging');
  assert(manifest.dependencies.enabledAdvancedServices.some(service => service.userSymbol === 'AdminDirectory' && service.version === 'directory_v1'), 'AdminDirectory ausente');
  assert(manifest.dependencies.enabledAdvancedServices.some(service => service.userSymbol === 'Gmail' && service.version === 'v1'), 'Gmail ausente');
  assert(manifest.dependencies.libraries.some(library => library.userSymbol === 'OAuth2' && String(library.version) === '43'), 'OAuth2 v43 ausente');
});

test('API publica final possui exatamente cinco funcoes', () => {
  assertEqual(allTopLevelFunctions().join('|'), EXPECTED_PUBLIC_API.join('|'), 'API publica');
  assertEqual(countPattern(allText(), /function\s+[A-Za-z0-9_]*ComLog\s*\(/g), 0, 'ComLog');
});

test('pacote nao contem identificadores empresariais reais conhecidos', () => {
  const text = allText();
  const termosPrivados = [
    String.fromCharCode(116, 100, 109) + 'logistica',
    String.fromCharCode(84, 68, 77),
    'Base ' + 'Final',
    'HOMO' + 'LOGACAO_',
    'Homo' + 'logacao',
    'homo' + 'logacao'
  ];
  assertEqual(new RegExp(termosPrivados.join('|'), 'i').test(text), false, 'identificador real/historico');
  assertEqual(/openById\s*\(\s*['"][A-Za-z0-9_-]{20,}['"]\s*\)/.test(read('src/app.js')), false, 'spreadsheet hardcoded');
});

test('planilha usa Script Property SPREADSHEET_ID e aba generica', () => {
  const app = read('src/app.js');
  assert(app.includes("SPREADSHEET_ID_PROPERTY = 'SPREADSHEET_ID'"), 'SPREADSHEET_ID');
  assert(app.includes("NOME_ABA_DADOS = 'Base Assinaturas'"), 'aba generica');
});

test('regras usam matriz/unidade ficticias', () => {
  const env = createEnv();
  const matriz = env.context.__hooks.Regras.montarInfoDepartamento('Tecnologia', 'Matriz');
  const unidade = env.context.__hooks.Regras.montarInfoDepartamento('Comercial', 'Unidade Sao Paulo');
  assertEqual(matriz.sucesso, true, 'matriz sucesso');
  assertEqual(matriz.cargoPadrao, 'Tecnologia', 'cargo matriz');
  assert(matriz.endereco.linha1.includes('20 andar'), 'regra alternativa matriz');
  assertEqual(unidade.sucesso, true, 'unidade sucesso');
  assertEqual(unidade.cargoPadrao, 'Unidade', 'cargo unidade');
  assert(unidade.departamentoVisual.includes('Unidade'), 'visual unidade');
});

test('celular opcional evita falso WhatsApp', () => {
  const regras = createEnv().context.__hooks.Regras;
  assertEqual(regras.prepararCelularAssinatura('(11) 3000-0000', '(11) 3000-0000'), '', 'celular igual telefone');
  assertEqual(regras.prepararCelularAssinatura('(11) 90000-0000', '(11) 3000-0000'), '(11) 90000-0000', 'celular valido');
});

test('fingerprint considera email departamento e filial com ordem deterministica', () => {
  const hooks = createEnv().context.__hooks.app;
  const base = [
    { email: 'ana.silva@example.com', departamentoBaseFinal: 'TECNOLOGIA', filialBaseFinal: 'MATRIZ' },
    { email: 'bruno.costa@example.com', departamentoBaseFinal: 'COMERCIAL', filialBaseFinal: 'UNIDADE SAO PAULO' }
  ];
  const invertida = base.slice().reverse();
  const departamentoAlterado = [
    { email: 'ana.silva@example.com', departamentoBaseFinal: 'FINANCEIRO', filialBaseFinal: 'MATRIZ' },
    base[1]
  ];
  const filialAlterada = [
    { email: 'ana.silva@example.com', departamentoBaseFinal: 'TECNOLOGIA', filialBaseFinal: 'UNIDADE CAMPINAS' },
    base[1]
  ];

  assertEqual(hooks.gerarFingerprintBase(base), hooks.gerarFingerprintBase(invertida), 'ordem deterministica');
  assert(hooks.gerarFingerprintBase(base) !== hooks.gerarFingerprintBase(departamentoAlterado), 'departamento altera fingerprint');
  assert(hooks.gerarFingerprintBase(base) !== hooks.gerarFingerprintBase(filialAlterada), 'filial altera fingerprint');
});

test('retorno publico remove campos sensiveis', () => {
  const env = createEnv();
  const result = env.context.__hooks.AppInterno.executarOperacaoPublica('TESTE', () => ({
    sucesso: true,
    status: 'OK',
    email: 'ana.silva@example.com',
    nome: 'Ana Silva',
    telefone: '(11) 3000-0000',
    endereco: 'Av. Exemplo',
    html: '<div>assinatura</div>',
    headers: { Authorization: 'Bearer ' + 'LOCAL_ONLY_TOKEN' },
    porStatus: { 'OK': 1 }
  }));
  const serialized = JSON.stringify(result);
  assertEqual(result.sucesso, true, 'sucesso');
  assert(!/ana\.silva|Ana Silva|3000-0000|<div>|Bearer|Authorization/i.test(serialized), 'dado sensivel no retorno');
});

test('OAuth delegado usa servico opaco e reset em finally', () => {
  const env = createEnv();
  const result = env.context.__hooks.GoogleInterno.injetarAssinatura('ana.silva@example.com', {
    nome: 'Ana Silva',
    cargo: 'Tecnologia',
    departamento: 'Departamento de Tecnologia',
    enderecoLinha1: 'Av. Exemplo, 1000 - 20 andar',
    enderecoLinha2: 'Sao Paulo - SP',
    telefoneFixo: '(11) 3000-0000',
    celular: ''
  });
  assertEqual(result.sucesso, true, 'patch sucesso');
  assertEqual(env.state.fetches.map(fetch => fetch.method).join('|'), 'get|patch|get', 'GET/PATCH/GET');
  assertEqual(env.state.services.length, 1, 'servico unico');
  assert(env.state.services[0].name.indexOf('Gmail_') === 0, 'prefixo Gmail');
  assert(!env.state.services[0].name.includes('ana.silva'), 'service name nao contem email');
  assertEqual(env.state.resets, 1, 'reset unico');
});

test('retry 429/5xx preserva unidade OAuth ate conclusao', () => {
  const env = createEnv({
    fetchPlan: [
      { status: 200 },
      { status: 429 },
      { status: 500 },
      { status: 200 },
      { status: 200 }
    ]
  });
  env.context.__hooks.GoogleInterno.injetarAssinatura('ana.silva@example.com', {
    nome: 'Ana Silva',
    cargo: 'Tecnologia',
    departamento: 'Departamento de Tecnologia',
    enderecoLinha1: 'Av. Exemplo, 1000 - 20 andar',
    enderecoLinha2: 'Sao Paulo - SP',
    telefoneFixo: '(11) 3000-0000',
    celular: ''
  });
  assertEqual(env.state.fetches.map(fetch => fetch.method).join('|'), 'get|patch|patch|patch|get', 'retries');
  assertEqual(env.state.sleeps.length, 2, 'backoff');
  assertEqual(env.state.resets, 1, 'reset final');
});

test('preview cria draft sem OAuth delegado e sem texto tecnico', () => {
  const env = createEnv();
  const result = env.context.gerarPreview();
  assertEqual(result.sucesso, true, 'preview sucesso');
  assertEqual(env.state.services.length, 0, 'sem OAuth delegado');
  assertEqual(env.state.draftCreates.length, 1, 'draft criado');
  const raw = env.state.draftCreates[0].message.raw;
  const mime = decodeBase64Url(raw);
  assert(/Subject: Assinaturas 01\/01/.test(mime), 'assunto');
  const termosTecnicos = ['HOMO' + 'LOG', 'COLA' + 'BORADOR', 'DE' + 'BUG', 'TES' + 'TE'];
  assert(!new RegExp(termosTecnicos.join('|'), 'i').test(mime), 'texto tecnico');
});

let passed = 0;
tests.forEach(item => {
  item.fn();
  passed++;
});

console.log('PUBLIC_TESTS_OK=' + passed + '/' + tests.length);
console.log('PUBLIC_API=5/5');
console.log('PUBLIC_SCOPES=5/5');
console.log('PUBLIC_GOOGLE_CALLS=MOCKS_ONLY');
