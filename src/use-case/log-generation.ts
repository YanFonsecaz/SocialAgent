import { db } from "../db/connection";
import { llmGenerations } from "../db/schema";

type LogLlmGenerationInput = {
    userId: string;
    tool: string;
    model?: string;
    prompt?: string;
    output?: string;
    status?: "draft" | "approved";
    tokensIn?: number;
    tokensOut?: number;
    latencyMs?: number;
    costUsd?: string;
};

export const logLlmGeneration = async (
    input: LogLlmGenerationInput,
): Promise<string> => {
    const id = crypto.randomUUID();
    await db.insert(llmGenerations).values({
        id,
        userId: input.userId,
        tool: input.tool,
        model: input.model,
        prompt: input.prompt,
        output: input.output,
        status: input.status ?? "draft",
        tokensIn: input.tokensIn,
        tokensOut: input.tokensOut,
        latencyMs: input.latencyMs,
        costUsd: input.costUsd,
    });

    return id;
};

