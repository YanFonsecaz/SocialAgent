import { expect, mock, test } from "bun:test";
import { Elysia } from "elysia";

type LoggedGenerationInput = {
    tool: string;
    tokensIn?: number;
    tokensOut?: number;
    latencyMs?: number;
    costUsd?: string;
    status: string;
};

const loggedGenerations: LoggedGenerationInput[] = [];

mock.module("../plugins/auth-guard", () => ({
    resolveAuthContext: async () => ({
        userId: "user-test-1",
        email: "user@npbrasil.com",
        name: "User Test",
    }),
    unauthorizedResponse: () =>
        new Response(
            JSON.stringify({ success: false, error: "UNAUTHORIZED" }),
            {
                status: 401,
                headers: {
                    "Content-Type": "application/json",
                },
            },
        ),
}));

mock.module("../../use-case/log-generation", () => ({
    logLlmGeneration: async (input: LoggedGenerationInput) => {
        loggedGenerations.push(input);
        return `gen-${input.tool}`;
    },
}));

mock.module("../../agents/social-agent-graph", () => ({
    runSocialAgent: async () => ({
        response: "ok",
        sources: ["https://example.com/source"],
        usage: {
            tokensIn: 111,
            tokensOut: 222,
            totalTokens: 333,
        },
    }),
}));

mock.module("../../agents/strategist-inlinks-block-graph", () => ({
    runStrategistInlinksBlockGraph: async () => ({
        principalUrl: "https://example.com/principal",
        edits: [
            {
                blockId: "b1",
                targetUrl: "https://example.com/target",
                anchor: "anchor test",
                originalBlockText: "original",
                modifiedBlockText:
                    "original com [anchor test](https://example.com/target)",
                overwriteBlock: true,
                justification: "fit",
                metrics: { relevance: 90, authority: 70 },
            },
        ],
        rejected: [],
        metrics: {
            totalLinks: 1,
            densityPer1000Words: 1,
            candidatesAnalyzed: 1,
            eligibleBlocks: 1,
        },
        usage: {
            tokensIn: 30,
            tokensOut: 20,
            totalTokens: 50,
        },
    }),
}));

mock.module("../../use-case/extract-content", () => ({
    extractTextFromHtml: async () => "conteúdo principal",
    extractHtmlFromUrl: async () =>
        "<article><h2>Título</h2><p>Texto principal.</p></article>",
}));

mock.module("../../use-case/save-content", () => ({
    saveCleanContent: async () => undefined,
}));

mock.module("../../use-case/inlinks/paragraphs", () => ({
    parseHtmlToBlocks: () => ({
        blocks: [
            {
                id: "b1",
                type: "paragraph",
                tag: "p",
                text: "Texto principal.",
                html: "<p>Texto principal.</p>",
                path: "article>p:nth-of-type(1)",
                containsLink: false,
                charStart: 0,
                charEnd: 15,
            },
        ],
    }),
}));

mock.module("../../use-case/inlinks/apply-edits", () => ({
    applyBlockEditsToHtml: () => ({
        applied: {
            totalEdits: 1,
            appliedLinked: 1,
            appliedModified: 1,
            skippedAlreadyLinked: 0,
            skippedBlockNotFound: 0,
        },
        modifiedHtml:
            "<article><h2>Título</h2><p>Texto com [anchor](https://example.com/target).</p></article>",
        originalHtml: "<article><h2>Título</h2><p>Texto principal.</p></article>",
        linkedHtml:
            "<article><h2>Título</h2><p>Texto com [anchor](https://example.com/target).</p></article>",
    }),
}));

mock.module("../../db/connection", () => ({
    db: {
        insert: () => ({
            values: () => ({
                returning: async () => [
                    {
                        analysisUrl: "https://example.com/target",
                        sentence: "Texto com link",
                        anchor: "anchor test",
                    },
                ],
            }),
        }),
    },
}));

mock.module("../../db/schema", () => ({
    strategistInlinks: {
        analysisUrl: "analysis_url",
        sentence: "sentence",
        anchor: "anchor",
    },
}));

mock.module("../../agents/content-reviewer-graph", () => ({
    runContentReviewerGraph: async () => ({
        results: [
            {
                url: "https://example.com/post",
                status: "approved",
                reason: "ok",
            },
        ],
        total: 1,
        approved: 1,
        rejected: 0,
        errors: 0,
        usage: {
            tokensIn: 10,
            tokensOut: 5,
            totalTokens: 15,
        },
    }),
}));

mock.module("../../trends-master/run-trends-master", () => ({
    runTrendsMasterPipeline: async () => ({
        success: true,
        report: {
            sector: "Tecnologia",
            generatedAt: new Date().toISOString(),
            periods: [],
            summary: "Resumo",
            markdown: "# Relatório",
        },
        usage: {
            tokensIn: 9,
            tokensOut: 8,
            totalTokens: 17,
        },
    }),
}));

mock.module("../../trends-master/repositories/config-repository", () => ({
    loadTrendsConfig: async () => ({
        sector: "Tecnologia",
        periods: ["diario"],
        topN: 5,
        risingN: 5,
        maxArticles: 3,
        emailRecipients: [],
        emailEnabled: false,
    }),
    saveTrendsConfig: async () => true,
}));

const { socialAgentRoutes } = await import("./social-agent");
const { strategistInlinks } = await import("./strategist-inlinks");
const { contentReviewerRoutes } = await import("./content-reviewer");
const { trendsMasterRoutes } = await import("./trends-master");

const app = new Elysia()
    .use(socialAgentRoutes)
    .use(strategistInlinks)
    .use(contentReviewerRoutes)
    .use(trendsMasterRoutes);

const requestJson = async (path: string, init?: RequestInit) => {
    const response = await app.handle(
        new Request(`http://localhost${path}`, init),
    );
    const json = await response.json();
    return {
        status: response.status,
        json,
    };
};

const findLogByTool = (tool: string): LoggedGenerationInput | undefined =>
    loggedGenerations.find((entry) => entry.tool === tool);

test("persistência de métricas LLM por ferramenta (social/inlinks/content/trends)", async () => {
    loggedGenerations.length = 0;

    const socialResponse = await requestJson("/social-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            url: "https://example.com/article",
            intent: "linkedin_text",
        }),
    });
    expect(socialResponse.status).toBe(200);
    expect((socialResponse.json as { generationId?: string }).generationId).toBe(
        "gen-social-agent",
    );

    const inlinksResponse = await requestJson("/strategist/inlinks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            urlPrincipal: "https://example.com/principal",
            urlsAnalise: ["https://example.com/target"],
        }),
    });
    expect(inlinksResponse.status).toBe(200);
    expect((inlinksResponse.json as { generationId?: string }).generationId).toBe(
        "gen-strategist-inlinks",
    );

    const contentResponse = await requestJson("/strategist/content-reviewer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            items: [
                {
                    url: "https://example.com/post",
                    contentType: "blog",
                    primaryKeyword: "seo",
                    supportingKeywords: ["conteudo"],
                    expectedWordCount: 300,
                    outline: ["H2: Introdução"],
                    cta: "fale conosco",
                    personaPain: "falta de tráfego",
                },
            ],
        }),
    });
    expect(contentResponse.status).toBe(200);
    expect((contentResponse.json as { generationId?: string }).generationId).toBe(
        "gen-content-reviewer",
    );

    const trendsResponse = await requestJson("/api/trends-master/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            sector: "Tecnologia",
            periods: ["diario"],
            topN: 5,
            risingN: 5,
            maxArticles: 3,
            customTopics: [],
            emailEnabled: false,
            emailRecipients: [],
            emailMode: "smtp",
        }),
    });
    expect(trendsResponse.status).toBe(200);
    expect((trendsResponse.json as { generationId?: string }).generationId).toBe(
        "gen-trends-master",
    );

    const socialLog = findLogByTool("social-agent");
    const inlinksLog = findLogByTool("strategist-inlinks");
    const contentLog = findLogByTool("content-reviewer");
    const trendsLog = findLogByTool("trends-master");

    expect(socialLog?.tokensIn).toBe(111);
    expect(socialLog?.tokensOut).toBe(222);
    expect(socialLog?.costUsd).toBe("0.000150");
    expect((socialLog?.latencyMs ?? -1) >= 0).toBe(true);

    expect(inlinksLog?.tokensIn).toBe(30);
    expect(inlinksLog?.tokensOut).toBe(20);
    expect(inlinksLog?.costUsd).toBe("0.000017");
    expect((inlinksLog?.latencyMs ?? -1) >= 0).toBe(true);

    expect(contentLog?.tokensIn).toBe(10);
    expect(contentLog?.tokensOut).toBe(5);
    expect(contentLog?.costUsd).toBe("0.000005");
    expect((contentLog?.latencyMs ?? -1) >= 0).toBe(true);

    expect(trendsLog?.tokensIn).toBe(9);
    expect(trendsLog?.tokensOut).toBe(8);
    expect(trendsLog?.costUsd).toBe("0.000006");
    expect((trendsLog?.latencyMs ?? -1) >= 0).toBe(true);

    expect(loggedGenerations.length).toBe(4);
});
