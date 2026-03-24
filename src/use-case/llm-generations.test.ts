import { expect, test } from "bun:test";

process.env.DATABASE_URL ??= "postgres://postgres:postgres@localhost:5433/social_agent";
process.env.OPENAI_API_KEY ??= "test-openai-key";
process.env.SERPAPI_API_KEY ??= "test-serpapi-key";
process.env.APP_BASE_URL ??= "http://localhost:3333";
process.env.BETTER_AUTH_SECRET ??= "test-better-auth-secret";

const {
    isValidGenerationStatusTransition,
    parseGenerationListFilters,
} = await import("./llm-generations");

test("parseGenerationListFilters: aplica defaults de paginação", () => {
    const filters = parseGenerationListFilters(new URLSearchParams());

    expect(filters.page).toBe(1);
    expect(filters.pageSize).toBe(20);
    expect(filters.tool).toBeUndefined();
    expect(filters.status).toBeUndefined();
});

test("parseGenerationListFilters: aceita filtros válidos", () => {
    const filters = parseGenerationListFilters(
        new URLSearchParams({
            tool: "social-agent",
            status: "draft",
            from: "2026-01-01T00:00:00.000Z",
            to: "2026-01-31T23:59:59.000Z",
            page: "2",
            pageSize: "50",
        }),
    );

    expect(filters.tool).toBe("social-agent");
    expect(filters.status).toBe("draft");
    expect(filters.page).toBe(2);
    expect(filters.pageSize).toBe(50);
    expect(filters.from?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(filters.to?.toISOString()).toBe("2026-01-31T23:59:59.000Z");
});

test("parseGenerationListFilters: torna `to` inclusivo até o fim do dia", () => {
    const filters = parseGenerationListFilters(
        new URLSearchParams({
            from: "2026-02-10",
            to: "2026-02-10",
        }),
    );

    expect(filters.from?.toISOString()).toBe("2026-02-10T00:00:00.000Z");
    expect(filters.to?.toISOString()).toBe("2026-02-10T23:59:59.999Z");
});

test("parseGenerationListFilters: rejeita paginação inválida", () => {
    expect(() =>
        parseGenerationListFilters(new URLSearchParams({ page: "0" })),
    ).toThrow("Parâmetro page inválido.");

    expect(() =>
        parseGenerationListFilters(new URLSearchParams({ pageSize: "999" })),
    ).toThrow("Parâmetro pageSize inválido.");
});

test("parseGenerationListFilters: rejeita datas inválidas", () => {
    expect(() =>
        parseGenerationListFilters(new URLSearchParams({ from: "ontem" })),
    ).toThrow("Parâmetro from inválido.");

    expect(() =>
        parseGenerationListFilters(new URLSearchParams({ to: "amanha" })),
    ).toThrow("Parâmetro to inválido.");
});

test("isValidGenerationStatusTransition: permite somente draft -> approved", () => {
    expect(isValidGenerationStatusTransition("draft", "approved")).toBe(true);
    expect(isValidGenerationStatusTransition("draft", "draft")).toBe(false);
    expect(isValidGenerationStatusTransition("approved", "approved")).toBe(false);
    expect(isValidGenerationStatusTransition("approved", "draft")).toBe(false);
});
