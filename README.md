# Gerenciador de Assinaturas Google Workspace

[![CI](https://github.com/LukaLencar/gerenciador-assinaturas-google-workspace/actions/workflows/ci.yml/badge.svg)](https://github.com/LukaLencar/gerenciador-assinaturas-google-workspace/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Versão pública e sanitizada de um projeto em Google Apps Script para padronizar assinaturas do Gmail em contas de um domínio Google Workspace.

O repositório demonstra uma arquitetura segura para ler uma base de colaboradores, aplicar regras de negócio de assinatura, gerar preview visual em rascunhos e atualizar assinaturas Gmail com confirmação canônica.

## Visão Geral

O sistema usa uma planilha Google como fonte operacional. Cada linha representa um usuário e informa email, nome completo, departamento e filial. O Apps Script lê a base, busca dados complementares no Admin Directory, monta a assinatura HTML e atualiza a assinatura principal do Gmail via Gmail API.

Esta versão contem somente dados fictícios e placeholders. Nenhuma credencial, ID de ambiente, domínio corporativo real ou informação operacional privada foi publicada neste repositório.

## Arquitetura

- `src/app.js`: orquestração, checkpoint, lote, status publico e sanitização dos logs.
- `src/google.js`: integração com Admin Directory, Service Account, OAuth2, Gmail sendAs GET/PATCH/GET e health check.
- `src/preview.js`: preflight e preview em rascunhos da conta executora.
- `src/regras.js`: regras fictícias de departamentos, unidades, telefones e dados de assinatura.
- `templates/padrao.html`: template HTML sanitizado da assinatura.

## Principais Funcionalidades

- Atualização centralizada de assinaturas Gmail.
- Leitura da base via Google Sheets.
- Consulta de usuários pelo Google Workspace Admin SDK.
- Atualização de assinatura via Gmail API.
- Service Account com Domain-Wide Delegation para operacoes delegadas.
- Preview em rascunhos usando `Gmail.Users.Drafts.create`.
- Processamento em lotes com `ScriptLock`.
- Checkpoint e retomada segura.
- Retry restrito a HTTP 429 e 5xx.
- Confirmação canônica: PATCH seguido de GET.
- Fingerprint da base usando email, departamento e filial.
- Sanitização de logs e retornos públicos.
- Ciclo OAuth efêmero com `reset()` em `finally`.
- Prevenção de falso WhatsApp quando celular e telefone fixo coincidem.

## API Pública

As funções globais expostas no Apps Script são:

- `verificarProntidao()`: valida configurações, planilha, Admin Directory, Service Account e leitura Gmail.
- `gerarPreview()`: cria rascunhos com assinaturas válidas para conferência visual.
- `atualizarAssinaturas()`: processa a base em lotes e aplica assinaturas.
- `verStatusAtualizacao()`: retorna o estado sanitizado do checkpoint.
- `cancelarAtualizacao()`: remove o checkpoint de execução ativa.

## Fluxo de Execução

1. O operador configura `SPREADSHEET_ID`, `SERVICE_ACCOUNT_KEY` e, opcionalmente, `GERENCIADOR_ASSINATURAS_PREVIEW_EMAILS`.
2. `verificarProntidao()` confirma os acessos mínimos.
3. `gerarPreview()` permite revisar visualmente as assinaturas sem PATCH.
4. `atualizarAssinaturas()` processa a base em lotes.
5. Cada usuário passa por GET inicial, PATCH e GET pós-PATCH.
6. O checkpoint e salvo após cada item processado e removido ao concluir.

## Segurança

- Credenciais não ficam no código.
- `.clasp.json` real e ignorado.
- `SERVICE_ACCOUNT_KEY` deve ficar em Script Properties.
- Tokens OAuth delegados sao limpos com `reset()` ao final de cada unidade lógica.
- Logs públicos removem emails, nomes, telefones, endereços, HTML, tokens e payloads sensiveis.
- O manifest usa um conjunto explícito e enxuto de scopes.

Mais detalhes: [docs/SECURITY.md](docs/SECURITY.md).

## Configuração

Consulte [docs/SETUP.md](docs/SETUP.md) para preparar Apps Script, Advanced Services, OAuth2 library, Service Account, Domain-Wide Delegation, Script Properties e `clasp`.

## Script Properties

Obrigatorias:

- `SPREADSHEET_ID`: ID da planilha de base.
- `SERVICE_ACCOUNT_KEY`: JSON da Service Account, configurado diretamente no Apps Script.

Opcionais/operacionais:

- `GERENCIADOR_ASSINATURAS_PREVIEW_EMAILS`: array JSON de emails para preview.
- `GERENCIADOR_ASSINATURAS_CHECKPOINT_V1`: criada automaticamente durante a execução em lote e removida na conclusão.

## Preview

O preview cria rascunhos na conta executora. O corpo do rascunho contém somente assinaturas válidas e separadores discretos entre elas. Pendências aparecem apenas no retorno estruturado sanitizado.

## Atualização em Lote

O lote padrão processa até 40 usuários por execução e respeita limite de tempo. A retomada usa checkpoint com fingerprint da base para evitar execução híbrida quando a planilha muda no meio do processo.

## Testes

```bash
npm test
npm run check
```

Os testes públicos usam mocks locais e não chamam Google APIs.

## Limitações / Observações

- Este repositório e uma versão demonstrativa e sanitizada.
- Os dados em `docs/examples/base-assinaturas.csv` são fictícios.
- A atualização real exige Google Workspace, Admin SDK, Gmail API, Service Account e DWD corretamente configurados.

## Tecnologias

- Google Apps Script V8
- Google Sheets
- Google Workspace Admin SDK
- Gmail API
- Apps Script OAuth2 Library
- Node.js para testes locais

## Autor

Lucas Alencar
