import { test, expect } from "bun:test";
import { createE2eAuthSession } from "./e2e-auth-session";

type ApiResponse = {
    status: number;
    json: unknown;
};

const BASE_URL =
    process.env.SOCIAL_AGENT_E2E_BASE_URL?.trim() || "http://localhost:3333";

async function requestJson(
    path: string,
    init?: RequestInit,
): Promise<ApiResponse> {
    const response = await fetch(`${BASE_URL}${path}`, init);
    let json: unknown;

    try {
        json = await response.json();
    } catch {
        json = null;
    }

    return {
        status: response.status,
        json,
    };
}

test("E2E smoke: rotas protegidas retornam 401 sem sessão", async () => {
    const social = await requestJson("/social-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "https://example.com" }),
    });

    const inlinks = await requestJson("/strategist/inlinks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            urlPrincipal: "https://example.com",
            urlsAnalise: ["https://example.org"],
        }),
    });

    const contentTemplate = await requestJson(
        "/strategist/content-reviewer/template",
    );
    const trendsConfig = await requestJson("/api/trends-master/config");
    const generations = await requestJson("/llm/generations?page=1&pageSize=5");

    expect(social.status).toBe(401);
    expect(inlinks.status).toBe(401);
    expect(contentTemplate.status).toBe(401);
    expect(trendsConfig.status).toBe(401);
    expect(generations.status).toBe(401);
}, 60_000);

test("E2E smoke: sessão seeded acessa rotas protegidas", async () => {
    const session = await createE2eAuthSession();
    const authHeaders = {
        Cookie: session.cookieHeader,
    };

    const authSession = await requestJson("/auth/session", {
        headers: authHeaders,
    });

    expect(authSession.status).toBe(200);
    expect((authSession.json as { authenticated?: boolean }).authenticated).toBe(
        true,
    );

    const social = await requestJson("/social-agent", {
        method: "POST",
        headers: {
            ...authHeaders,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
    });

    expect(social.status).toBe(422);

    const inlinks = await requestJson("/strategist/inlinks", {
        method: "POST",
        headers: {
            ...authHeaders,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
    });

    expect(inlinks.status).toBe(422);

    const template = await fetch(
        `${BASE_URL}/strategist/content-reviewer/template`,
        {
            headers: authHeaders,
        },
    );

    expect(template.status).toBe(200);

    const config = await requestJson("/api/trends-master/config", {
        headers: authHeaders,
    });

    expect(config.status).toBe(200);

    const generations = await requestJson("/llm/generations?page=1&pageSize=5", {
        headers: authHeaders,
    });

    expect(generations.status).toBe(200);
}, 60_000);
