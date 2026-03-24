import { expect, mock, test } from "bun:test";
import { Elysia } from "elysia";

type GraphInput = {
    principalUrl: string;
    analysisUrls: string[];
    principalBlocks: Array<{
        id: string;
        type: "paragraph" | "list_item";
        text: string;
        containsLink: boolean;
    }>;
    principalContent: string;
};

const state = {
    extractTextCalls: [] as string[],
    extractHtmlCalls: [] as string[],
    parseHtmlCalls: [] as string[],
    saveContentCalls: [] as Array<{
        userId: string;
        url: string;
        content: string;
    }>,
    graphCalls: [] as GraphInput[],
};

const resetState = () => {
    state.extractTextCalls.length = 0;
    state.extractHtmlCalls.length = 0;
    state.parseHtmlCalls.length = 0;
    state.saveContentCalls.length = 0;
    state.graphCalls.length = 0;
};

mock.module("../plugins/auth-guard", () => ({
    resolveAuthContext: async () => ({
        userId: "user-test-1",
        email: "user-test-1@npbrasil.com",
        name: "User Test",
    }),
    unauthorizedResponse: () =>
        new Response(JSON.stringify({ success: false, error: "UNAUTHORIZED" }), {
            status: 401,
            headers: {
                "Content-Type": "application/json",
            },
        }),
}));

mock.module("../../use-case/log-generation", () => ({
    logLlmGeneration: async () => "gen-strategist-inlinks",
}));

mock.module("../../agents/strategist-inlinks-block-graph", () => ({
    runStrategistInlinksBlockGraph: async (input: GraphInput) => {
        state.graphCalls.push(input);
        return {
            principalUrl: input.principalUrl,
            edits: [],
            rejected: [],
            usage: undefined,
        };
    },
}));

mock.module("../../use-case/extract-content", () => ({
    extractTextFromHtml: async (url: string) => {
        state.extractTextCalls.push(url);
        return "conteudo-principal-extraido";
    },
    extractHtmlFromUrl: async (url: string) => {
        state.extractHtmlCalls.push(url);
        return "<article><h2>Título</h2><p>Bloco 1</p><p>Bloco 2</p><p>Bloco 3</p><p>Bloco 4</p></article>";
    },
}));

mock.module("../../use-case/save-content", () => ({
    saveCleanContent: async (userId: string, url: string, content: string) => {
        state.saveContentCalls.push({ userId, url, content });
    },
}));

mock.module("../../use-case/inlinks/paragraphs", () => ({
    parseHtmlToBlocks: (html: string) => {
        state.parseHtmlCalls.push(html);
        return {
            blocks: [
                {
                    id: "h2-1",
                    type: "heading",
                    tag: "h2",
                    text: "Título",
                    html: "<h2>Título</h2>",
                    path: "article>h2:nth-of-type(1)",
                    containsLink: false,
                    charStart: 0,
                    charEnd: 10,
                },
                {
                    id: "p-1",
                    type: "paragraph",
                    tag: "p",
                    text: "Bloco 1",
                    html: "<p>Bloco 1</p>",
                    path: "article>p:nth-of-type(1)",
                    containsLink: false,
                    charStart: 11,
                    charEnd: 20,
                },
                {
                    id: "p-2",
                    type: "paragraph",
                    tag: "p",
                    text: "Bloco 2",
                    html: "<p>Bloco 2</p>",
                    path: "article>p:nth-of-type(2)",
                    containsLink: false,
                    charStart: 21,
                    charEnd: 30,
                },
                {
                    id: "p-3",
                    type: "paragraph",
                    tag: "p",
                    text: "Bloco 3",
                    html: "<p>Bloco 3</p>",
                    path: "article>p:nth-of-type(3)",
                    containsLink: false,
                    charStart: 31,
                    charEnd: 40,
                },
                {
                    id: "p-4",
                    type: "paragraph",
                    tag: "p",
                    text: "Bloco 4",
                    html: "<p>Bloco 4</p>",
                    path: "article>p:nth-of-type(4)",
                    containsLink: false,
                    charStart: 41,
                    charEnd: 50,
                },
            ],
        };
    },
}));

mock.module("../../use-case/inlinks/apply-edits", () => ({
    applyBlockEditsToHtml: ({ htmlContent }: { htmlContent: string }) => ({
        applied: {
            totalEdits: 0,
            appliedLinked: 0,
            appliedModified: 0,
            skippedAlreadyLinked: 0,
            skippedBlockNotFound: 0,
        },
        modifiedHtml: htmlContent,
        originalHtml: htmlContent,
        linkedHtml: htmlContent,
    }),
}));

mock.module("../../db/connection", () => ({
    db: {
        insert: () => ({
            values: () => ({
                returning: async () => [],
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

const { strategistInlinks } = await import("./strategist-inlinks");

const app = new Elysia().use(strategistInlinks);

const postInlinks = async (body: unknown) => {
    const response = await app.handle(
        new Request("http://localhost/strategist/inlinks", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
        }),
    );

    return {
        status: response.status,
        json: (await response.json()) as Record<string, unknown>,
    };
};

test("compatibilidade legada sem sourceType mantém modo url", async () => {
    resetState();

    const response = await postInlinks({
        urlPrincipal: "https://example.com/pilar/",
        urlsAnalise: [
            "https://example.com/pilar/",
            "https://example.com/satelite/",
            "https://example.com/satelite/",
        ],
    });

    expect(response.status).toBe(200);
    expect(response.json.principalInputMode).toBe("url");
    expect(response.json.principalUrl).toBe("https://example.com/pilar");

    expect(state.extractTextCalls).toEqual(["https://example.com/pilar"]);
    expect(state.extractHtmlCalls).toEqual(["https://example.com/pilar"]);
    expect(state.graphCalls).toHaveLength(1);
    expect(state.graphCalls[0]?.analysisUrls).toEqual([
        "https://example.com/satelite",
    ]);
});

test("modo manual sem URL cria referência manual e não extrai por URL", async () => {
    resetState();

    const response = await postInlinks({
        sourceType: "manual",
        conteudoPrincipal: "Linha 1\n\n<script>alert(1)</script>\nLinha 2",
        urlsAnalise: ["https://example.com/satelite/", "https://example.com/satelite/"],
    });

    expect(response.status).toBe(200);
    expect(response.json.principalInputMode).toBe("manual");

    const principalUrl = String(response.json.principalUrl || "");
    expect(principalUrl.startsWith("manual://user-test-1/")).toBe(true);

    expect(state.extractTextCalls).toHaveLength(0);
    expect(state.extractHtmlCalls).toHaveLength(0);
    expect(state.graphCalls).toHaveLength(1);
    expect(state.graphCalls[0]?.analysisUrls).toEqual([
        "https://example.com/satelite",
    ]);

    expect(state.saveContentCalls).toHaveLength(1);
    expect(state.saveContentCalls[0]?.url.startsWith("manual://user-test-1/")).toBe(
        true,
    );
    expect(state.saveContentCalls[0]?.content).toBe(
        "Linha 1\n\n<script>alert(1)</script>\nLinha 2",
    );

    expect(state.parseHtmlCalls).toHaveLength(1);
    expect(state.parseHtmlCalls[0]).toContain(
        "&lt;script&gt;alert(1)&lt;/script&gt;",
    );
});

test("modo manual com URL principal real filtra auto-link", async () => {
    resetState();

    const response = await postInlinks({
        sourceType: "manual",
        conteudoPrincipal: "Texto manual",
        urlPrincipal: "https://example.com/pilar/",
        urlsAnalise: [
            "https://example.com/pilar/",
            "https://example.com/satelite/",
            "https://example.com/satelite/",
        ],
    });

    expect(response.status).toBe(200);
    expect(response.json.principalInputMode).toBe("manual");
    expect(response.json.principalUrl).toBe("https://example.com/pilar");
    expect(state.graphCalls).toHaveLength(1);
    expect(state.graphCalls[0]?.analysisUrls).toEqual([
        "https://example.com/satelite",
    ]);
});

test("modo manual exige conteudoPrincipal", async () => {
    resetState();

    const response = await postInlinks({
        sourceType: "manual",
        urlsAnalise: ["https://example.com/satelite/"],
    });

    expect(response.status).toBe(422);
});
