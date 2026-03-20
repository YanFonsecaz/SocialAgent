# Repository Guidelines

## Project Structure & Module Organization
- `src/` contains the backend code (Bun + TypeScript). Main server entrypoint: `src/http/server.ts`; API routes are under `src/http/routes`.
- `front-end/` contains the Vite frontend. Built frontend assets go to `front-end/dist/`.
- `dist/` stores backend build artifacts.
- `scripts/` includes local automation and E2E tests (for example `scripts/e2e-social-agent.test.ts`).
- `drizzle/` stores SQL migrations and migration metadata.

## Build, Test, and Development Commands
- `bun install`: install dependencies.
- `bun run dev`: run backend in watch mode.
- `bun run --cwd front-end dev`: run frontend locally (Vite).
- `bun run build`: build backend to `dist/`.
- `bun run build:front`: build frontend.
- `bun run build:all`: build frontend and backend.
- `bun run start`: run production backend from `dist/`.
- `bun test`: run test suite.
- `bun run test:e2e:local`: start backend harness, wait for health check, and run E2E tests.

## Coding Style & Naming Conventions
- Language: TypeScript (ES modules), strict compiler settings via `tsconfig.json`.
- Use 4-space indentation and keep imports explicit and grouped by module type.
- Naming: `camelCase` for variables/functions, `PascalCase` for types/classes, `kebab-case` for route and script filenames.
- Keep route handlers small; move reusable logic into dedicated service/helper modules.

## Testing Guidelines
- Framework/runtime: `bun test`.
- Place E2E tests in `scripts/` with `e2e-*.test.ts` naming.
- Prefer scenario-driven tests around API flows; assert status codes and key response fields.
- For local E2E, ensure Postgres is up and `DATABASE_URL` is valid.

## Commit & Pull Request Guidelines
- Recent history favors short imperative subjects (for example: `Improve inlinks selection`, `Deploy v3`).
- Keep commits focused and atomic; one logical change per commit.
- PRs should include: purpose, impacted modules, test commands run, and any env/migration notes.
- Add screenshots only when frontend behavior changes.

## Security & Configuration Tips
- Required env vars are validated in `src/envSchema.ts` (`DATABASE_URL`, `OPENAI_API_KEY`, `SERPAPI_API_KEY`, optional `CORS_ORIGIN`).
- Never commit secrets or `.env` files.
- When schema changes are introduced, commit the corresponding file in `drizzle/`.
