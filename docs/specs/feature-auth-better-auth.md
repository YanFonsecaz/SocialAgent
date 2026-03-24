# SPEC — Auth com Better Auth (`@npbrasil.com`)

## Objetivo
Implementar autenticação por magic link usando Better Auth, com acesso restrito a e-mails `@npbrasil.com`, mantendo contrato público em `/auth/*`.

## Contrato de API
- `POST /auth/magic-link/request` `{ email }`
  - `202` em sucesso (mensagem genérica, sem enumeração).
  - `403` para domínio inválido.
- `POST /auth/magic-link/verify` `{ token, callbackURL? }`
  - `200` com `{ authenticated: true, user }` e cookie de sessão.
  - `401` para token inválido/expirado/reutilizado.
- `GET /auth/session`
  - `200` com `{ authenticated: true, user }`.
  - `401` sem sessão válida.
- `POST /auth/logout`
  - `200` com `{ success: true }` e limpeza de cookie.

## Segurança
- Domínio validado no request e também no hook defensivo do Better Auth.
- Sessão em cookie HTTP-only.
- Magic link com token one-time e expiração de 15 minutos.
- Sessão com expiração de 8 horas.
- Sem log de token em plaintext.

## Modelo de Dados
Tabelas adicionadas:
- `user`
- `session`
- `account`
- `verification`
- `user_settings`
- `llm_generations`

Tabelas existentes com escopo por usuário (`user_id` obrigatório):
- `store_content`
- `strategist_inlinks`
- `trends_config`

Regra de migração:
- truncar dados legados antes de impor `user_id NOT NULL`.

## Proteção de Rotas
Rotas protegidas:
- `/social-agent`
- `/strategist/inlinks`
- `/strategist/content-reviewer`
- `/api/trends-master/*`

Rotas públicas:
- `/auth/*`
- `/health/*`
- assets/frontend.

## Frontend
- Nova tela: `/login` (envio de magic link).
- Novo callback: `/auth/callback` (validação do token).
- Todas as chamadas API usam `credentials: "include"`.
- `401` redireciona para `/login`.

## Operação
- Novas env vars:
  - `APP_BASE_URL`
  - `BETTER_AUTH_SECRET`
- Render mantém serviço web e adiciona cron para retenção.
- Script de limpeza: `bun run cleanup:retention`.

