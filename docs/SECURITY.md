# Segurança

Este repositório foi preparado para ser público. Ele não deve conter credenciais, dados empresariais reais, IDs de ambiente ou histórico operacional privado.

## Credenciais

- Não armazene chaves no código.
- Não versione `.clasp.json` real.
- Não versione arquivos de Service Account.
- Configure `SERVICE_ACCOUNT_KEY` em Script Properties.
- Configure `SPREADSHEET_ID` em Script Properties.

## Service Account e DWD

A arquitetura usa Service Account com Domain-Wide Delegation para agir em nome dos usuários somente no escopo delegado necessário para gerenciar assinatura Gmail.

Separe mentalmente três camadas:

- Apps Script `oauthScopes`: permissões do script executor.
- Escopo delegado da Service Account: permisão concedida no Admin Console para impersonação.
- Script Properties: local onde ficam configurações operacionais do script.

## Least Privilege

O manifest declara explicitamente os scopes mínimos usados pela versão demonstrativa:

- `spreadsheets`
- `admin.directory.user.readonly`
- `script.external_request`
- `gmail.compose`
- `userinfo.email`

O PATCH de assinatura usa escopo delegado programático `gmail.settings.basic` no servico OAuth2.

## Tokens Efemeros

O serviço OAuth delegado usa `setPropertyStore(PropertiesService.getScriptProperties())`, exigido pela biblioteca OAuth2. Para evitar acúmulo de estado por usuário, o ciclo de vida e encapsulado em um wrapper que chama `reset()` no `finally`.

Esse reset ocorre apos a unidade completa GET/PATCH/GET, inclusive em exceções.

## Logs Sanitizados

Os wrappers públicos passam por sanitização antes de `console.log`.

Devem ser removidos dos retornos logáveis:

- emails completos;
- nomes;
- telefones;
- endereços;
- HTML;
- assinatura;
- payloads;
- headers;
- tokens;
- credenciais.

## Historico Git

Este workspace nasce sem `.git`. Antes de publicar:

1. rode a varredura de segredos;
2. confirme que `.git` nao existe;
3. confirme que `.clasp.json` real não existe;
4. inicialize Git somente depois da revisão.

## Arquivos Ignorados

O `.gitignore` bloqueia arquivos comuns de segredo:

- `.clasp.json`
- `.env`
- chaves `.pem` e `.key`
- `service-account*.json`
- `credentials*.json`
- `secret*.json`
- `token*.json`
- backups e logs.
