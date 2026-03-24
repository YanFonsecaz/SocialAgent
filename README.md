# socialagent

## Requisitos

- Bun instalado
- Uma instância de Postgres acessível (local ou remota)
- Chaves/variáveis de ambiente necessárias (ver abaixo)

## Instalar dependências

```bash
bun install
```

## Banco (Postgres) via Docker Compose (dev)

Para desenvolvimento local, você pode subir um Postgres (com pgvector) via Docker Compose, mapeando a porta **5433** no host:

```bash
docker compose up -d
```

Isso expõe o Postgres em:

- Host: `localhost`
- Porta: `5433`
- Usuário: `postgres`
- Senha: `postgres`
- Database: `social_agent`

`DATABASE_URL` correspondente:

```bash
export DATABASE_URL="postgres://postgres:postgres@localhost:5433/social_agent"
```

> Observação: este repositório valida `DATABASE_URL` como URL. Garanta que a string esteja correta.

### Reset reprodutível de banco (dev)

Para evitar drift de schema local, use:

```bash
bun run db:reset:dev
```

Esse comando:
- remove todas as tabelas do schema `public`;
- limpa metadata de migrations (`schema drizzle`);
- garante extensões `vector` e `pgcrypto`;
- reaplica todas as migrations (`db:migrate`).

Proteções:
- bloqueia execução com `NODE_ENV=production`;
- por padrão só permite host local (`localhost`, `127.0.0.1`, `::1`).

Override (somente se você souber o que está fazendo):

```bash
DB_RESET_ALLOW_NON_LOCAL=true bun run db:reset:dev
```

## Configuração do ambiente (desenvolvimento)

Este projeto separa validação de env por contexto:

- `src/envSchema.ts` (server/runtime HTTP)
- `src/envDbSchema.ts` (db-cli/migrations/scripts de banco)

Para rodar backend e frontend localmente, você precisa definir:

- `DATABASE_URL` (Postgres)
- `OPENAI_API_KEY`
- `SERPAPI_API_KEY` (necessária pelo schema; se você ainda não usa o recurso, defina um valor válido para passar na validação)
- `APP_BASE_URL` (ex.: `http://localhost:3333`)
- `BETTER_AUTH_SECRET` (segredo da sessão/auth)
- `CORS_ORIGIN` (opcional; default no servidor permite `http://localhost:5173`)
- Email transacional:
  - SMTP: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM`
  - API HTTP: `EMAIL_API_PROVIDER` + `EMAIL_PROVIDER_API_KEY` + `EMAIL_FROM`
  - Alternativas aceitas por provider: `RESEND_API_KEY`, `SENDGRID_API_KEY`, `POSTMARK_SERVER_TOKEN`

### Exemplo (macOS / Linux)

Execute no terminal (substitua pelos seus valores):

```bash
export DATABASE_URL="postgres://postgres:postgres@localhost:5433/social_agent"
export OPENAI_API_KEY="SUA_OPENAI_API_KEY"
export SERPAPI_API_KEY="SUA_SERPAPI_API_KEY"
export APP_BASE_URL="http://localhost:3333"
export BETTER_AUTH_SECRET="SEU_SEGREDO_FORTE"
export CORS_ORIGIN="http://localhost:5173"
```

### Exemplo (Windows PowerShell)

```powershell
$env:DATABASE_URL="postgres://postgres:postgres@localhost:5433/social_agent"
$env:OPENAI_API_KEY="SUA_OPENAI_API_KEY"
$env:SERPAPI_API_KEY="SUA_SERPAPI_API_KEY"
$env:APP_BASE_URL="http://localhost:3333"
$env:BETTER_AUTH_SECRET="SEU_SEGREDO_FORTE"
$env:CORS_ORIGIN="http://localhost:5173"
```

### Magic link por e-mail em produção

Para o login por magic link, o backend precisa conseguir entregar e-mail. O projeto aceita dois modos:

- SMTP tradicional
- API HTTP (`resend`, `sendgrid` ou `postmark`)

Exemplo com API HTTP:

```bash
export EMAIL_FROM="no-reply@seudominio.com"
export EMAIL_API_PROVIDER="resend"
export RESEND_API_KEY="SUA_CHAVE"
```

Se você usar `EMAIL_PROVIDER_API_KEY`, ele substitui a chave específica do provider.

## Rodar o backend (API) em desenvolvimento

O backend roda por padrão na porta `3333` (ou na porta definida por `PORT`).

```bash
bun run dev
```

Saúde do banco (verifica conexão com o Postgres):

- `GET http://localhost:3333/health/db`

## Rodar o front-end em desenvolvimento

Em outro terminal:

```bash
bun run --cwd front-end dev
```

Front padrão (Vite):

- `http://localhost:5173`

## Build e execução como produção (local)

Build completo (front + backend):

```bash
bun run build:all
```

Rodar build:

```bash
bun run start
```

## Testes end-to-end (local)

### Opção 1 — rodar E2E com backend já rodando

Com o backend rodando, você pode executar os E2E:

#### Smoke autenticado (sessão seeded em DB)

```bash
SOCIAL_AGENT_E2E_BASE_URL="http://localhost:3333" bun test scripts/e2e-authenticated-smoke.test.ts
```

#### Fluxo de aprovação pós-geração

```bash
SOCIAL_AGENT_E2E_BASE_URL="http://localhost:3333" bun test scripts/e2e-generation-approval-flow.test.ts
```

#### Mobile (viewports 375x812 e 390x844)

```bash
SOCIAL_AGENT_E2E_BASE_URL="http://localhost:3333" bun test scripts/e2e-mobile-authenticated.test.ts
```

#### Suítes legadas (opcionais)

```bash
SOCIAL_AGENT_E2E_BASE_URL="http://localhost:3333" bun test scripts/e2e-social-agent.test.ts
SOCIAL_AGENT_E2E_BASE_URL="http://localhost:3333" bun test scripts/e2e-strategist-inlinks.test.ts
```

### Opção 2 — rodar E2E com harness (sobe backend, aguarda health e executa testes)

Este projeto inclui um harness local para automatizar:

- subir o backend (sem `--watch`)
- aguardar servidor ativo (`/`)
- rodar os testes E2E
- encerrar o servidor ao final

Rodar suíte padrão (smoke autenticado):

```bash
bun run test:e2e:local
```

A suíte padrão agora cobre:
- smoke autenticado;
- fluxo de aprovação pós-geração;
- navegação mobile autenticada (375x812 e 390x844).

Rodar testes específicos:

```bash
bun run test:e2e:local -- --tests scripts/e2e-strategist-inlinks.test.ts
```

Aumentar timeout do healthcheck (útil se Postgres demorar para subir):

```bash
bun run test:e2e:local -- --healthTimeoutMs 90000
```

This project was created using `bun init` in bun v1.3.8. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
