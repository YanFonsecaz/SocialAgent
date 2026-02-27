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

## Configuração do ambiente (desenvolvimento)

Este projeto valida variáveis de ambiente via `src/envSchema.ts`. Para rodar localmente, você precisa definir:

- `DATABASE_URL` (Postgres)
- `OPENAI_API_KEY`
- `SERPAPI_API_KEY` (necessária pelo schema; se você ainda não usa o recurso, defina um valor válido para passar na validação)
- `CORS_ORIGIN` (opcional; default no servidor permite `http://localhost:5173`)

### Exemplo (macOS / Linux)

Execute no terminal (substitua pelos seus valores):

```bash
export DATABASE_URL="postgres://postgres:postgres@localhost:5433/social_agent"
export OPENAI_API_KEY="SUA_OPENAI_API_KEY"
export SERPAPI_API_KEY="SUA_SERPAPI_API_KEY"
export CORS_ORIGIN="http://localhost:5173"
```

### Exemplo (Windows PowerShell)

```powershell
$env:DATABASE_URL="postgres://postgres:postgres@localhost:5433/social_agent"
$env:OPENAI_API_KEY="SUA_OPENAI_API_KEY"
$env:SERPAPI_API_KEY="SUA_SERPAPI_API_KEY"
$env:CORS_ORIGIN="http://localhost:5173"
```

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

Com o backend rodando, você pode executar os E2E (smoke):

#### Strategist Inlinks — não inserir links antes do primeiro H2

```bash
SOCIAL_AGENT_E2E_BASE_URL="http://localhost:3333" bun test scripts/e2e-strategist-inlinks.test.ts
```

#### Social Agent — fluxo ask_later -> opção 1

```bash
SOCIAL_AGENT_E2E_BASE_URL="http://localhost:3333" bun test scripts/e2e-social-agent.test.ts
```

### Opção 2 — rodar E2E com harness (sobe backend, aguarda health e executa testes)

Este projeto inclui um harness local para automatizar:

- subir o backend (sem `--watch`)
- aguardar o healthcheck (`/health/db`)
- rodar os testes E2E
- encerrar o servidor ao final

Rodar todos os E2E padrão:

```bash
bun run test:e2e:local
```

Rodar apenas um teste específico:

```bash
bun run test:e2e:local -- --tests scripts/e2e-strategist-inlinks.test.ts
```

Aumentar timeout do healthcheck (útil se Postgres demorar para subir):

```bash
bun run test:e2e:local -- --healthTimeoutMs 90000
```

This project was created using `bun init` in bun v1.3.8. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
