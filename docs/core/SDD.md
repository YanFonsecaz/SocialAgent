## SDD — SocialAgent MVP

### Resumo
- Objetivo: operar o SaaS interno com autenticação corporativa `@npbrasil.com`, isolamento total por usuário e trilha de evolução técnica definida.
- Fase MVP atual: SolidJS (Vite), Bun + Elysia, Drizzle + Postgres/pgvector, LangChain + LangGraph, OpenAI acoplado.
- Fase evolução: evolução do RAG para híbrido com rerank.
- Ambientes: Dev com Postgres local (docker compose) e Produção com Render (`Web + Cron Job`).

### Arquitetura e Interfaces (decisão fechada)
- Frontend:
  - Solid Router com rotas protegidas por sessão (`/`, `/strategist`, `/content-reviewer`, `/trends-master`, `/history`).
  - Cliente API envia cookie de sessão (`credentials: "include"`).
  - Migração para Solid concluída mantendo contrato de rotas e APIs.
- Backend:
  - Middleware global de autenticação para todas as rotas de ferramentas.
  - Sessão resolvida 1x por request (cache em memória por `Request`) para reduzir latência e evitar divergência de autorização.
  - Contrato de erro HTTP padronizado (`success: false`, `error.code`, `error.message`, `requestId`).
  - Hardening de URL externas com proteção SSRF (bloqueio de localhost/IPs privados/hosts inválidos).
  - Rotas públicas de auth:
    - `POST /auth/magic-link/request` `{ email }`
    - `POST /auth/magic-link/verify` `{ token }`
  - Rotas autenticadas:
    - `GET /auth/session` -> `{ user }`
    - `POST /auth/logout`
    - `GET /llm/generations?tool=&status=&from=&to=&page=`
    - `PATCH /llm/generations/:id/status` `{ status: "approved" }`
- Tipos públicos obrigatórios:
  - `User { id, email, domain, createdAt, lastLoginAt }`
  - `AuthSession { id, userId, expiresAt, revokedAt }`
  - `UserSettings { userId, tone, language, defaultsJson }`
  - `LlmGeneration { id, userId, tool, model, prompt, output, status, tokensIn, tokensOut, latencyMs, costUsd, createdAt, approvedAt }`
- Fluxo de auth:
  - Magic link com token one-time, TTL 15 min, domínio validado em `@npbrasil.com`.
  - Sessão em cookie HTTP-only (`better-auth.session_token`), `SameSite=Lax`, `Secure` em produção, TTL 8h.

### Dados, RAG e Qualidade Técnica
- Tabelas novas:
  - Better Auth: `user`, `session`, `account`, `verification`.
  - Produto: `user_settings`, `llm_generations`.
- Refatorações obrigatórias:
  - Adicionar `user_id` em `store_content`, `strategist_inlinks`, `trends_config`.
  - `trends_config` deixa de usar `id=default` global e passa a chave por usuário.
- Índices obrigatórios:
  - `store_content`: índice vetorial em `embedding` (HNSW ou IVFFlat), índice `user_id`, índice `created_at`.
  - Busca híbrida (fase evolução): coluna `content_tsv tsvector` + índice GIN.
  - `llm_generations`: índice composto `(user_id, created_at desc)` e `(user_id, tool, status)`.
- RAG MVP atual:
  - Recuperação vetorial por similaridade com escopo por `user_id`.
  - Resposta com `sources` e `generationId` nas ferramentas de geração.
- RAG fase evolução:
  - Ingestão: chunking + embeddings (`text-embedding-3-small`, 1536).
  - Recuperação: híbrida (vetor + keyword BM25/tsvector), fusão por RRF.
  - Rerank: LLM no top-N (ex: top 20 -> rerank top 5).
  - Geração final usa apenas contexto reranqueado + `sources` obrigatório.
- Governança:
  - Toda geração inicia `draft`.
  - Apenas transição `draft -> approved`.
  - Retenção de `llm_generations`: 180 dias.

### Infra, Operação e Lacunas a Adicionar
- Dev:
  - Manter `docker-compose` com `pgvector/pg16`.
  - Adicionar scripts de banco: `db:generate`, `db:migrate`, `db:studio` (Drizzle).
- Produção (Render):
  - `Web Service`: API + frontend estático.
  - `Cron Job` diário (03:00 UTC): limpeza de sessões expiradas, tokens expirados e gerações >180 dias.
- Variáveis obrigatórias:
  - `DATABASE_URL`, `OPENAI_API_KEY`, `SERPAPI_API_KEY`, `APP_BASE_URL`, `BETTER_AUTH_SECRET`.
  - SMTP (já suportado) para envio de magic link.
- Observabilidade mínima:
  - Log estruturado por request com `requestId`, `userId`, `tool`, `latencyMs`, `status`.
  - Métricas por ferramenta: erro, latência, tokens, custo USD.
  - Rate limit em `POST /auth/magic-link/request` por IP e por e-mail (janela deslizante no processo).
- Backlog técnico da fase evolução:
  - Evoluir recuperação para RAG híbrido + rerank em todas as ferramentas.
  - Padronizar deploy em Render e descontinuar pipeline legado quando aprovado.

### Metodologia de Entrega (TDD obrigatório)
- Regra geral: toda funcionalidade nova ou correção relevante deve seguir ciclo TDD.
- Ciclo obrigatório por item:
  - Red: escrever teste primeiro e validar falha.
  - Green: implementar mínimo para passar.
  - Refactor: melhorar código mantendo testes verdes.
- Escopo de testes por camada:
  - Frontend Solid (MVP): testes de componente e fluxo de rota autenticada.
  - Backend Elysia: testes de rota/middleware e isolamento por usuário.
  - Casos críticos (auth e RAG): testes de integração ponta a ponta.
- Critério de merge:
  - Sem merge com teste novo faltando para regra de negócio nova.
  - Sem merge com teste quebrado em pipeline.

### Testes e Critérios de Aceite
- Auth:
  - Aceita `@npbrasil.com`, rejeita outros domínios.
  - Rejeita token expirado/reutilizado.
  - Rotas protegidas retornam `401` sem sessão.
- Isolamento:
  - Usuário A não lê/escreve dados do usuário B em nenhuma rota.
- RAG:
  - Recuperação híbrida + rerank retorna resultados mais relevantes que baseline vetorial.
  - Respostas com `sources` e `generationId`.
- Operação:
  - Cron remove dados vencidos diariamente.
  - Métricas de tokens/custo/latência persistidas por geração.
- Regressão:
  - Funcionalidades atuais (`social-agent`, `strategist`, `content-reviewer`, `trends-master`) continuam operando sob autenticação.
  - E2E smoke autenticado cobre sessão seeded no DB e valida `401` sem sessão + fluxo protegido com sessão válida.
- TDD:
  - Cada requisito novo possui teste escrito antes da implementação.
  - PR deve evidenciar ciclo Red -> Green -> Refactor.

### Assunções
- Sem billing, multi-tenant externo e SSO avançado no MVP.
- Provedor LLM inicial único: OpenAI.
- Sem bloqueio de cota no MVP; apenas monitoramento e alertas.
