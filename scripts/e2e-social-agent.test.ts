import { test, expect } from "bun:test";

/**
 * End-to-end (smoke) test for Social Agent.
 *
 * What it validates:
 * 1) Calling POST /social-agent with intent=ask_later returns an options prompt (does NOT generate final content).
 * 2) Calling POST /social-agent with intent="1" (LinkedIn) advances to content generation and returns a non-empty response.
 *
 * How to run:
 *   1) Start the backend server in another terminal:
 *        bun --hot SocialAgent/src/http/server.ts
 *      (or the project’s usual server command)
 *
 *   2) In this repo root:
 *        bun test SocialAgent/scripts/e2e-social-agent.test.ts
 *
 * Configuration:
 * - Set SOCIAL_AGENT_E2E_BASE_URL if the API is not on http://localhost:3000
 * - Set SOCIAL_AGENT_E2E_URL to a deterministic public URL (recommended).
 *
 * Notes:
 * - This is a smoke test. It does not assert exact output text, only that the flow works.
 * - The agent may require LLM credentials configured in the backend environment.
 */

type SocialAgentResponse = {
    response: string;
    sources?: string[];
};

const BASE_URL =
    process.env.SOCIAL_AGENT_E2E_BASE_URL?.trim() || "http://localhost:3333";

// Use a stable URL to reduce flakiness. You can override via env.
const CONTENT_URL =
    process.env.SOCIAL_AGENT_E2E_URL?.trim() ||
    "https://www.kumon.com.br/cursos/curso-de-ingles/"; // stable real-world content

async function postSocialAgent(body: {
    url: string;
    intent?: string;
    query?: string;
    tone?: string;
    feedback?: string;
    previousResponse?: string;
}): Promise<{ status: number; json: SocialAgentResponse | { error: unknown } }> {
    const res = await fetch(`${BASE_URL}/social-agent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });

    let json: unknown = null;
    try {
        json = await res.json();
    } catch {
        json = { error: "Non-JSON response from server" };
    }

    return { status: res.status, json: json as any };
}

function assertHasResponseShape(
    payload: unknown,
): asserts payload is SocialAgentResponse {
    expect(payload).toBeTruthy();
    expect(typeof (payload as any).response).toBe("string");
}

test("E2E: ask_later -> option 1 (LinkedIn) advances to generation", async () => {
    // Step 1: ask_later should return the options prompt.
    const step1 = await postSocialAgent({
        url: CONTENT_URL,
        intent: "ask_later",
        // keep query empty to mimic the “ask later then choose” UX
    });

    if (step1.status !== 200) {
        // Provide a useful failure message without crashing on shape assumptions.
        throw new Error(
            `Step 1 failed: HTTP ${step1.status}. Payload: ${JSON.stringify(
                step1.json,
            )}`,
        );
    }

    assertHasResponseShape(step1.json);

    const optionsText = step1.json.response;
    expect(optionsText.length).toBeGreaterThan(0);

    // Loosely verify it is the options question (Portuguese prompt).
    expect(optionsText).toContain("Como você deseja reutilizar o conteúdo?");
    expect(optionsText).toContain("Opções:");
    expect(optionsText).toContain("1)");
    expect(optionsText).toContain("2)");
    expect(optionsText).toContain("6)");

    // Step 2: selecting option "1" should generate content.
    const step2 = await postSocialAgent({
        url: CONTENT_URL,
        intent: "1",
        // Optional: give a stable tone to reduce variance
        tone: "profissional, claro e direto",
    });

    if (step2.status !== 200) {
        throw new Error(
            `Step 2 failed: HTTP ${step2.status}. Payload: ${JSON.stringify(
                step2.json,
            )}`,
        );
    }

    assertHasResponseShape(step2.json);

    const generated = step2.json.response;
    expect(generated.length).toBeGreaterThan(50);

    // It should not just repeat the options again (that would indicate the flow is stuck).
    expect(generated).not.toContain("Opções:");

    // Sources are optional, but if present should be an array.
    if ((step2.json as any).sources !== undefined) {
        expect(Array.isArray((step2.json as any).sources)).toBe(true);
    }
}, // Give enough time for URL extraction + RAG + LLM.
60_000);
