import { expect, test } from "bun:test";
import { and, desc, eq } from "drizzle-orm";
import { createE2eAuthSession } from "./e2e-auth-session";

process.env.DATABASE_URL ??=
    "postgres://postgres:postgres@localhost:5433/social_agent";
process.env.OPENAI_API_KEY ??= "test-openai-key";
process.env.SERPAPI_API_KEY ??= "test-serpapi-key";
process.env.APP_BASE_URL ??=
    process.env.SOCIAL_AGENT_E2E_BASE_URL ?? "http://localhost:3333";
process.env.BETTER_AUTH_SECRET ??= "e2e-dev-secret";

const BASE_URL =
    process.env.SOCIAL_AGENT_E2E_BASE_URL?.trim() || "http://localhost:3333";

type ApiResponse<T = unknown> = {
    status: number;
    json: T;
};

async function requestJson<T = unknown>(
    path: string,
    init?: RequestInit,
): Promise<ApiResponse<T>> {
    const response = await fetch(`${BASE_URL}${path}`, init);
    const json = (await response.json()) as T;
    return {
        status: response.status,
        json,
    };
}

test("E2E approval flow: aprova geração draft e persiste approvedAt", async () => {
    const session = await createE2eAuthSession();
    const { db } = await import("../src/db/connection");
    const { llmGenerations } = await import("../src/db/schema");

    const generationId = crypto.randomUUID();
    const now = new Date();

    await db.insert(llmGenerations).values({
        id: generationId,
        userId: session.userId,
        tool: "social-agent",
        model: "gpt-4o-mini",
        prompt: "test prompt",
        output: "test output",
        status: "draft",
        tokensIn: 10,
        tokensOut: 5,
        latencyMs: 42,
        costUsd: "0.000005",
        createdAt: now,
    });

    const approveResponse = await requestJson<{
        success: boolean;
        generation: {
            id: string;
            status: string;
            approvedAt?: string;
        };
    }>(`/llm/generations/${generationId}/status`, {
        method: "PATCH",
        headers: {
            Cookie: session.cookieHeader,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: "approved" }),
    });

    expect(approveResponse.status).toBe(200);
    expect(approveResponse.json.success).toBe(true);
    expect(approveResponse.json.generation.id).toBe(generationId);
    expect(approveResponse.json.generation.status).toBe("approved");
    expect(approveResponse.json.generation.approvedAt).toBeTruthy();

    const [row] = await db
        .select({
            id: llmGenerations.id,
            status: llmGenerations.status,
            approvedAt: llmGenerations.approvedAt,
        })
        .from(llmGenerations)
        .where(
            and(
                eq(llmGenerations.id, generationId),
                eq(llmGenerations.userId, session.userId),
            ),
        )
        .orderBy(desc(llmGenerations.createdAt))
        .limit(1);

    expect(row?.id).toBe(generationId);
    expect(row?.status).toBe("approved");
    expect(row?.approvedAt).toBeInstanceOf(Date);

    const listResponse = await requestJson<{
        items: Array<{ id: string; status: string; approvedAt?: string }>;
    }>("/llm/generations?status=approved&page=1&pageSize=20", {
        headers: {
            Cookie: session.cookieHeader,
        },
    });

    expect(listResponse.status).toBe(200);
    expect(
        listResponse.json.items.some(
            (item) => item.id === generationId && item.status === "approved",
        ),
    ).toBe(true);
}, 60_000);
