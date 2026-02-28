import { test, expect } from "bun:test";
import {
    normalizeForTokens,
    tokenizeNoStopwords,
    isEarlyStageGettingStarted,
    isLaterStageOrPrereqHeavy,
    extractDistinctiveTokens,
    anchorContainsDistinctiveToken,
    anchorTokenOverlap,
    isGenericAnchor,
} from "./heuristics";

test("normalizeForTokens: lowercases, strips punctuation, normalizes whitespace", () => {
    expect(normalizeForTokens("  Olá,   Mundo! ")).toBe("olá mundo");
    expect(normalizeForTokens("Inglês—básico\t\t(2026)")).toBe(
        "inglês básico 2026",
    );
    expect(normalizeForTokens("\u00a0CNPJ\u00a0")).toBe("cnpj");
});

test("tokenizeNoStopwords: removes stopwords and short tokens", () => {
    const tokens = tokenizeNoStopwords(
        "Como aprender inglês do zero com um método simples e claro",
    );
    // "como", "do", "um", "e" should be removed; keep meaningful tokens
    expect(tokens).toContain("aprender");
    expect(tokens).toContain("inglês");
    expect(tokens).toContain("zero");
    expect(tokens).toContain("método");
    expect(tokens).toContain("simples");
    expect(tokens).toContain("claro");
    expect(tokens).not.toContain("como");
    expect(tokens).not.toContain("do");
    expect(tokens).not.toContain("um");
    expect(tokens).not.toContain("e");
});

test("isEarlyStageGettingStarted: detects early-stage / onboarding signals (pt-BR)", () => {
    expect(
        isEarlyStageGettingStarted("Passo a passo: como aprender inglês do zero"),
    ).toBe(true);

    expect(
        isEarlyStageGettingStarted("Como abrir um CNPJ: primeiros passos"),
    ).toBe(true);

    expect(
        isEarlyStageGettingStarted("Guia completo de gramática avançada"),
    ).toBe(false);
});

test("isLaterStageOrPrereqHeavy: detects later-stage / prerequisite-heavy topics (business admin signals)", () => {
    expect(
        isLaterStageOrPrereqHeavy("É fundamental consultar dívidas no CNPJ"),
    ).toBe(true);

    expect(isLaterStageOrPrereqHeavy("Como alterar o CNAE no CNPJ")).toBe(true);

    // This heuristic is intentionally focused on business administrative prerequisites.
    // It should NOT classify learning-level topics as "prereq-heavy" by default.
    expect(isLaterStageOrPrereqHeavy("Como ser fluente em inglês")).toBe(false);
    expect(isLaterStageOrPrereqHeavy("Dicas para iniciantes em inglês")).toBe(
        false,
    );
});

test("extractDistinctiveTokens: returns a small list and avoids overly generic cluster tokens", () => {
    const content =
        "Neste guia de curso intensivo de inglês, você aprende técnicas de imersão, cronograma intensivo e exercícios diários. Um curso intensivo ajuda a acelerar a fluência.";
    const tokens = extractDistinctiveTokens(content);

    expect(Array.isArray(tokens)).toBe(true);
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens.length).toBeLessThanOrEqual(8);

    // Should not include overly generic words like "inglês" or "curso"
    expect(tokens).not.toContain("inglês");
    expect(tokens).not.toContain("curso");

    // Should include something more specific when present
    // (we keep this loose to avoid brittle tests)
    expect(
        tokens.some((t) =>
            ["intensivo", "imersão", "imersao", "cronograma"].includes(t),
        ),
    ).toBe(true);
});

test("anchorContainsDistinctiveToken: accepts anchors that match destination topic (token-level or phrase-level fallback)", () => {
    const candidate =
        "Curso intensivo de inglês: cronograma intensivo, imersão e exercícios diários para acelerar resultados.";

    // Token-level / title-level: should pass
    expect(
        anchorContainsDistinctiveToken("curso intensivo de inglês", candidate),
    ).toBe(true);

    // Phrase-level fallback: if the destination content contains the anchor phrase, accept
    expect(
        anchorContainsDistinctiveToken("cronograma intensivo", candidate),
    ).toBe(true);

    // Generic anchor that doesn't reflect the destination topic should fail
    expect(anchorContainsDistinctiveToken("curso de inglês", candidate)).toBe(
        false,
    );
});

test("anchorTokenOverlap: counts overlap between anchor and candidate tokens", () => {
    const candidate =
        "Aprender inglês com aplicativos: lista de aplicativos, exercícios e prática diária.";
    const overlap = anchorTokenOverlap(
        "aplicativos para aprender inglês",
        candidate,
    );

    expect(overlap.anchorTokenCount).toBeGreaterThan(0);
    expect(overlap.overlapCount).toBeGreaterThan(0);
});

test("isGenericAnchor: rejects vague or generic anchors", () => {
    expect(isGenericAnchor("clique aqui")).toBe(true);
    expect(isGenericAnchor("saiba mais")).toBe(true);
    expect(isGenericAnchor("aqui")).toBe(true);
    expect(isGenericAnchor("2026")).toBe(true);
    expect(isGenericAnchor("guia")).toBe(true);

    expect(isGenericAnchor("curso intensivo de inglês")).toBe(false);
    expect(isGenericAnchor("aplicativos para aprender inglês")).toBe(false);
});
