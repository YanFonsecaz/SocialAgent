import { expect, test } from "bun:test";

process.env.DATABASE_URL ??= "postgres://postgres:postgres@localhost:5433/social_agent";
process.env.OPENAI_API_KEY ??= "test-openai-key";
process.env.SERPAPI_API_KEY ??= "test-serpapi-key";
process.env.APP_BASE_URL ??= "http://localhost:3333";
process.env.BETTER_AUTH_SECRET ??= "test-better-auth-secret-32-characters-minimum";

const { isAllowedNpEmail } = await import("./auth");

test("isAllowedNpEmail: aceita domínio com trim e uppercase", () => {
    expect(isAllowedNpEmail("  USER@NPBRASIL.COM ")).toBe(true);
});

test("isAllowedNpEmail: rejeita domínios externos", () => {
    expect(isAllowedNpEmail("user@gmail.com")).toBe(false);
    expect(isAllowedNpEmail("user@npbrasil.com.br")).toBe(false);
});
