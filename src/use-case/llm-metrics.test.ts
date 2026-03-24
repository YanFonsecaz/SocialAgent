import { expect, test } from "bun:test";
import { estimateLlmCostUsd, extractTokenUsage } from "./llm-metrics";

test("estimateLlmCostUsd: calcula custo para gpt-4o-mini", () => {
    const cost = estimateLlmCostUsd({
        model: "gpt-4o-mini",
        tokensIn: 2000,
        tokensOut: 1000,
    });

    expect(cost).toBe("0.000900");
});

test("estimateLlmCostUsd: retorna undefined quando faltam tokens", () => {
    const cost = estimateLlmCostUsd({
        model: "gpt-4o-mini",
        tokensIn: undefined,
        tokensOut: 1000,
    });

    expect(cost).toBeUndefined();
});

test("estimateLlmCostUsd: retorna undefined para modelo sem preço", () => {
    const cost = estimateLlmCostUsd({
        model: "modelo-desconhecido",
        tokensIn: 1000,
        tokensOut: 1000,
    });

    expect(cost).toBeUndefined();
});

test("extractTokenUsage: extrai usage do formato OpenAI", () => {
    const usage = extractTokenUsage({
        usage: {
            prompt_tokens: 321,
            completion_tokens: 123,
            total_tokens: 444,
        },
    });

    expect(usage).toEqual({
        tokensIn: 321,
        tokensOut: 123,
        totalTokens: 444,
    });
});

test("extractTokenUsage: extrai usage do formato LangChain", () => {
    const usage = extractTokenUsage({
        usage_metadata: {
            input_tokens: 80,
            output_tokens: 20,
            total_tokens: 100,
        },
    });

    expect(usage).toEqual({
        tokensIn: 80,
        tokensOut: 20,
        totalTokens: 100,
    });
});

test("extractTokenUsage: retorna null quando usage não existe", () => {
    const usage = extractTokenUsage({ choices: [] });
    expect(usage).toBeNull();
});
