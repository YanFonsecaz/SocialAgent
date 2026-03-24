export type TokenUsage = {
    tokensIn?: number;
    tokensOut?: number;
    totalTokens?: number;
};

type EstimateLlmCostInput = {
    model?: string;
    tokensIn?: number;
    tokensOut?: number;
};

type BuildGenerationMetricsInput = {
    tool: string;
    startedAt: number;
    model?: string;
    usage?: TokenUsage | null;
    providerResponse?: unknown;
};

type BuildGenerationMetricsResult = {
    tokensIn?: number;
    tokensOut?: number;
    latencyMs: number;
    costUsd?: string;
};

const MODEL_PRICING_PER_1M: Record<
    string,
    { inputUsdPer1M: number; outputUsdPer1M: number }
> = {
    "gpt-4o-mini": {
        inputUsdPer1M: 0.15,
        outputUsdPer1M: 0.6,
    },
    "gpt-4o": {
        inputUsdPer1M: 5,
        outputUsdPer1M: 15,
    },
};

const asNumber = (value: unknown): number | undefined => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return undefined;
    }
    return value;
};

const toRecord = (value: unknown): Record<string, unknown> | null => {
    if (!value || typeof value !== "object") {
        return null;
    }
    return value as Record<string, unknown>;
};

const normalizeUsage = (value: unknown): TokenUsage | null => {
    const usage = toRecord(value);
    if (!usage) {
        return null;
    }

    const tokensIn =
        asNumber(usage.prompt_tokens) ??
        asNumber(usage.input_tokens) ??
        asNumber(usage.promptTokens) ??
        asNumber(usage.inputTokens);
    const tokensOut =
        asNumber(usage.completion_tokens) ??
        asNumber(usage.output_tokens) ??
        asNumber(usage.completionTokens) ??
        asNumber(usage.outputTokens);
    const totalTokens =
        asNumber(usage.total_tokens) ??
        asNumber(usage.totalTokens) ??
        (tokensIn !== undefined && tokensOut !== undefined
            ? tokensIn + tokensOut
            : undefined);

    if (
        tokensIn === undefined &&
        tokensOut === undefined &&
        totalTokens === undefined
    ) {
        return null;
    }

    return {
        tokensIn,
        tokensOut,
        totalTokens,
    };
};

export const extractTokenUsage = (response: unknown): TokenUsage | null => {
    const payload = toRecord(response);
    if (!payload) {
        return null;
    }

    const directUsage = normalizeUsage(payload.usage);
    if (directUsage) {
        return directUsage;
    }

    const langchainUsage = normalizeUsage(payload.usage_metadata);
    if (langchainUsage) {
        return langchainUsage;
    }

    const responseMetadata = toRecord(payload.response_metadata);
    if (!responseMetadata) {
        return null;
    }

    const tokenUsage = normalizeUsage(responseMetadata.tokenUsage);
    if (tokenUsage) {
        return tokenUsage;
    }

    const metadataUsage = normalizeUsage(responseMetadata.usage);
    if (metadataUsage) {
        return metadataUsage;
    }

    return null;
};

export const estimateLlmCostUsd = (
    input: EstimateLlmCostInput,
): string | undefined => {
    if (!input.model) {
        return undefined;
    }

    const pricing = MODEL_PRICING_PER_1M[input.model];
    if (!pricing) {
        return undefined;
    }

    if (input.tokensIn === undefined || input.tokensOut === undefined) {
        return undefined;
    }

    const inputCost = (input.tokensIn / 1_000_000) * pricing.inputUsdPer1M;
    const outputCost = (input.tokensOut / 1_000_000) * pricing.outputUsdPer1M;

    return (inputCost + outputCost).toFixed(6);
};

export const buildGenerationMetrics = (
    input: BuildGenerationMetricsInput,
): BuildGenerationMetricsResult => {
    const latencyMs = Math.max(0, Date.now() - input.startedAt);
    const usage = input.usage ?? extractTokenUsage(input.providerResponse);

    if (!usage) {
        console.warn(
            `[LLM Metrics] Usage indisponível para ${input.tool}. Gravando apenas latência.`,
        );
    }

    const tokensIn = usage?.tokensIn;
    const tokensOut = usage?.tokensOut;
    const costUsd = estimateLlmCostUsd({
        model: input.model,
        tokensIn,
        tokensOut,
    });

    return {
        tokensIn,
        tokensOut,
        latencyMs,
        costUsd,
    };
};
