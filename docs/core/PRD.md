# PRD — MVP SaaS Interno NP Brasil (SEO + Marketing com LLM)

## 1. Resumo

Este documento define o MVP de um SaaS interno para os times de SEO e Marketing da NP Brasil.

Objetivos principais:
- Permitir acesso apenas para usuários com e-mail `@npbrasil.com`.
- Garantir isolamento de dados e configurações por usuário no banco de dados.
- Entregar ferramentas iniciais de SEO e Marketing com integração a LLM.
- Registrar histórico de uso, métricas de geração e custos estimados.

Fora de escopo neste ciclo:
- Multi-tenant para clientes externos.
- Billing, assinatura e cobrança.
- Integrações complexas com múltiplos CRMs.
- SSO corporativo avançado.

## 2. Objetivos de Produto

- Reduzir tempo operacional de tarefas de SEO e Marketing.
- Padronizar qualidade de outputs via workflows guiados por IA.
- Oferecer rastreabilidade por usuário (histórico, status de aprovação, custo).

Métricas de sucesso do MVP:
- Adoção semanal interna.
- Redução de tempo por tarefa.
- Taxa de aprovação humana dos conteúdos gerados.
- Visibilidade de custo LLM por usuário e por ferramenta.

## 3. Escopo do MVP

Ferramentas obrigatórias:
- Social Agent: reaproveitamento de conteúdo para formatos sociais.
- Strategist Inlinks: sugestões de links internos com aplicação guiada.
- Content Reviewer: revisão técnica/editorial de conteúdos.
- Trends Master: coleta, análise e relatório de tendências.

Governança de conteúdo:
- Toda geração nasce em status `draft`.
- Apenas o usuário pode marcar como `approved`.
- Não há publicação automática em canais externos no MVP.

Histórico:
- Listagem por usuário.
- Filtros por ferramenta, período e status.

## 4. Autenticação e Acesso

Fluxo escolhido:
- `magic link` por e-mail corporativo.

Regras:
- Aceitar somente e-mails com domínio `@npbrasil.com`.
- Token com uso único.
- Expiração do token em 15 minutos.
- Rejeitar token expirado ou já utilizado.
- Autoacesso para qualquer e-mail válido do domínio.

Sessão:
- Cookie HTTP-only.
- Duração de 8 horas.

Endpoints de autenticação:
- `POST /auth/magic-link/request`
- `POST /auth/magic-link/verify`
- `GET /auth/session`
- `POST /auth/logout`

## 5. Dados e Isolamento por Usuário

Entidades novas:
- `users`
- `auth_sessions`
- `user_settings`
- `llm_generations`

Regras de isolamento:
- Toda leitura/escrita usa `user_id` da sessão autenticada.
- Configurações e histórico são sempre individuais.
- Nenhuma rota de ferramenta pode acessar dados de outro usuário.

Retenção:
- Guardar prompts, respostas e metadados em `llm_generations`.
- Janela de retenção: 180 dias.
- Limpeza automática diária de registros vencidos.

## 6. Integração LLM e Operação

Estratégia inicial:
- Provedor único no MVP: OpenAI.
- Manter integração acoplada ao OpenAI neste ciclo para reduzir complexidade de entrega.

Metadados por execução:
- Modelo utilizado.
- Tokens de entrada e saída.
- Latência.
- Custo estimado.
- Status (`draft` ou `approved`).

Política de custo no MVP:
- Apenas monitoramento e alertas.
- Sem bloqueio por cota nesta fase.

## 7. Impactos em APIs e Tipos

Rotas existentes que passam a exigir sessão autenticada:
- `/social-agent`
- `/strategist/inlinks`
- `/strategist/content-reviewer`
- `/api/trends-master/*`

Mudança de comportamento:
- `GET/PUT /api/trends-master/config` deixam de ser globais e passam a ser por usuário logado.
- Respostas de execução devem incluir `generationId` para rastreabilidade no histórico.

Tipos centrais esperados:
- `User`
- `AuthSession`
- `UserSettings`
- `LlmGeneration`

## 8. Critérios de Aceite e Testes

Autenticação:
- Login com `@npbrasil.com` funciona ponta a ponta.
- Domínio inválido é rejeitado.
- Token expirado e token reutilizado são rejeitados.
- Rotas protegidas sem sessão retornam não autorizado.

Isolamento:
- Usuário A não acessa dados/configurações do Usuário B.
- Histórico e preferências ficam isolados por `user_id`.

Funcionalidade:
- As ferramentas MVP ativas geram conteúdo e persistem histórico.
- Fluxo `draft -> approved` funciona corretamente.

Operação:
- Métricas de tokens, latência e custo por execução são registradas.
- Job diário remove dados com mais de 180 dias.
- Rotas atuais continuam funcionais após exigência de autenticação.

## 9. Assunções e Defaults

- Não há papéis avançados no MVP (todos os usuários têm o mesmo perfil).
- Sem integração de publicação externa neste ciclo.
- Sem billing/cotas bloqueantes neste momento.
- Arquitetura preparada para evolução futura de SSO, multi-provedor LLM e integrações com CRM.
