# Setup

Este guia descreve uma instalação genérica. Use apenas contas, IDs e domínios do seu próprio ambiente.

## 1. Criar o Apps Script

1. Crie um novo projeto em Google Apps Script.
2. Copie o ID do script.
3. Crie `.clasp.json` local a partir de `.clasp.json.example`.
4. Nunca versione `.clasp.json`.
5. A `.claspignore` incluída publica somente `appsscript.json`, `src/*.js` e `templates/*.html`.

## 2. Habilitar Advanced Services

No editor Apps Script, habilite:

- Admin Directory API v1
- Gmail API v1

No Google Cloud associado ao script, confirme que as APIs também estão habilitadas.

## 3. Adicionar OAuth2 Library

O manifest referencia a Apps Script OAuth2 Library v43. Ela e usada para montar o fluxo JWT Bearer da Service Account com impersonação por usuário.

Se criar o projeto manualmente pelo editor, confirme que a biblioteca `OAuth2` esta disponível com o mesmo user symbol.

## 4. Criar Service Account

1. Crie uma Service Account em um projeto Google Cloud controlado por você.
2. Gere uma chave JSON somente para configuração do Apps Script.
3. Não salve essa chave dentro do repositório.
4. Cole o JSON em Script Properties como `SERVICE_ACCOUNT_KEY`.

## 5. Configurar Domain-Wide Delegation

No Admin Console do Google Workspace:

1. cadastre o Client ID da Service Account;
2. conceda o escopo delegado necessário para assinatura Gmail;
3. use somente o escopo que o código realmente precisa.

Escopo delegado usado pelo codigo:

```text
https://www.googleapis.com/auth/gmail.settings.basic
```

## 6. Criar a Planilha

Crie uma planilha com a aba:

```text
Base Assinaturas
```

Colunas esperadas:

```text
Email, Nome Completo, Departamento, Filial
```

Use `docs/examples/base-assinaturas.csv` como referencia fictícia.

## 7. Configurar Script Properties

Obrigatórias:

```text
SPREADSHEET_ID
SERVICE_ACCOUNT_KEY
```

Opcional para preview:

```text
GERENCIADOR_ASSINATURAS_PREVIEW_EMAILS
```

Formato da property de preview:

```json
["ana.silva@example.com", "bruno.costa@example.com"]
```

## 8. Instalar com clasp

```bash
npm install -g @google/clasp
clasp login
cp .clasp.json.example .clasp.json
clasp push
```

Revise o projeto no editor Apps Script antes de executar qualquer função.

## 9. Ordem Recomendada

1. Execute `verificarProntidao()`.
2. Configure `GERENCIADOR_ASSINATURAS_PREVIEW_EMAILS`.
3. Execute `gerarPreview()` e confira os rascunhos.
4. Execute `atualizarAssinaturas()` em ciclos até concluir.
5. Use `verStatusAtualizacao()` para acompanhar.
6. Use `cancelarAtualizacao()` somente se precisar remover o checkpoint.

## 10. Testes Locais

```bash
npm test
npm run check
```

Os testes locais usam mocks e não acessam Google APIs.
