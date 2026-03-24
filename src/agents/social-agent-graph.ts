import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { ChatOpenAI } from "@langchain/openai";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { getOpenAIApiKey } from "../envSchema";
import { extractTextFromHtml } from "../use-case/extract-content";
import { saveCleanContent } from "../use-case/save-content";
import { retrieveContext } from "../use-case/rag.ts";
import { extractTokenUsage, type TokenUsage } from "../use-case/llm-metrics";

const IntentSchema = z.enum([
    "ask_later",
    "linkedin_text",
    "instagram_post",
    "video_reels",
    "video_tiktok",
    "video_youtube",
    "video_linkedin",
]);

const IntentChoiceSchema = z.enum([
    "1",
    "2",
    "3",
    "4",
    "5",
    "6",
    "linkedin_text",
    "instagram_post",
    "video_reels",
    "video_tiktok",
    "video_youtube",
    "video_linkedin",
]);

type SocialAgentInput = {
    userId: string;
    url: string;
    intent?: string;
    query?: string;
    tone?: string;
    feedback?: string;
    previousResponse?: string;
};

const AgentState = Annotation.Root({
    userId: Annotation<string>(),
    url: Annotation<string>(),
    intent: Annotation<string | undefined>(),
    intentNormalized: Annotation<z.infer<typeof IntentSchema> | undefined>(),
    query: Annotation<string | undefined>(),
    tone: Annotation<string | undefined>(),
    feedback: Annotation<string | undefined>(),
    previousResponse: Annotation<string | undefined>(),
    content: Annotation<string | undefined>(),
    response: Annotation<string | undefined>(),
    sources: Annotation<string[] | undefined>(),
    usage: Annotation<TokenUsage | undefined>(),
});

type SocialAgentState = typeof AgentState.State;

const extractContentTool = tool(
    async ({ userId, url }) => {
        const content = await extractTextFromHtml(url);
        await saveCleanContent(userId, url, content);
        return { content };
    },
    {
        name: "extract_url_content",
        description: "Extrai e salva o conteúdo limpo de uma URL.",
        schema: z.object({
            userId: z.string().min(1),
            url: z.string().url(),
        }),
    },
);

const retrieveContextTool = tool(
    async ({ userId, query, limit, url }) => {
        const rows = await retrieveContext(userId, query, limit ?? 5, url);
        const context = rows.map((row) => row.content).join("\n\n");
        const sources = rows.map((row) => row.url);
        return { context, sources };
    },
    {
        name: "retrieve_context",
        description: "Recupera contexto relevante do banco vetorial.",
        schema: z.object({
            userId: z.string().min(1),
            query: z.string().min(1),
            limit: z.number().int().positive().max(20).optional(),
            url: z.string().url().optional(),
        }),
    },
);

let llm: ChatOpenAI | undefined;

const getLlm = (): ChatOpenAI => {
    if (!llm) {
        llm = new ChatOpenAI({
            apiKey: getOpenAIApiKey(),
            model: "gpt-4o-mini",
            temperature: 0.3,
        });
    }

    return llm;
};

const normalizeIntent = (
    intent?: string,
): z.infer<typeof IntentSchema> | undefined => {
    if (!intent) return undefined;

    const raw = intent.trim();
    const value = raw.toLowerCase();

    // Common "ask later" variants: user pastes URL and wants to decide later.
    if (
        value === "perguntar depois" ||
        value === "perguntar_depois" ||
        value === "ask later" ||
        value === "ask_later" ||
        value.includes("perguntar depois")
    ) {
        return "ask_later";
    }

    // Accept numeric choices when the user replies with an option from the list.
    const numericChoice =
        value === "1" ||
        value === "2" ||
        value === "3" ||
        value === "4" ||
        value === "5" ||
        value === "6";

    if (numericChoice) {
        const map: Record<
            z.infer<typeof IntentChoiceSchema>,
            z.infer<typeof IntentSchema>
        > = {
            "1": "linkedin_text",
            "2": "instagram_post",
            "3": "video_reels",
            "4": "video_tiktok",
            "5": "video_youtube",
            "6": "video_linkedin",
            linkedin_text: "linkedin_text",
            instagram_post: "instagram_post",
            video_reels: "video_reels",
            video_tiktok: "video_tiktok",
            video_youtube: "video_youtube",
            video_linkedin: "video_linkedin",
        };

        try {
            const choice = IntentChoiceSchema.parse(raw);
            return map[choice];
        } catch {
            // fallthrough
        }
    }

    // Natural language normalization
    if (value.includes("linkedin") && value.includes("post"))
        return "linkedin_text";
    if (value.includes("instagram")) return "instagram_post";
    if (value.includes("reels")) return "video_reels";
    if (value.includes("tiktok")) return "video_tiktok";
    if (value.includes("youtube")) return "video_youtube";
    if (value.includes("linkedin") && value.includes("video"))
        return "video_linkedin";

    try {
        return IntentSchema.parse(raw);
    } catch {
        return undefined;
    }
};

const buildIntentQuestion = () =>
    [
        "Como você deseja reutilizar o conteúdo?",
        "",
        "Responda com o número (1-6) ou com o nome da intenção (ex: linkedin_text).",
        "",
        "Opções:",
        "1) Transformar o conteúdo em um post textual para LinkedIn",
        "2) Criar um post para Instagram (imagem + legenda)",
        "3) Gerar um roteiro de vídeo para Reels",
        "4) Gerar um roteiro de vídeo para TikTok",
        "5) Gerar um roteiro de vídeo para YouTube",
        "6) Gerar um roteiro de vídeo para LinkedIn",
    ].join("\n");

const buildGenerationPrompt = (input: {
    intent: z.infer<typeof IntentSchema>;
    context: string;
    tone?: string;
    feedback?: string;
    previousResponse?: string;
}) => {
    const tone = input.tone ?? "profissional, claro e direto";
    const feedback = input.feedback?.trim() || "Nenhum";
    const previousResponse = input.previousResponse?.trim() || "Nenhuma";

    const formatMap: Record<z.infer<typeof IntentSchema>, string> = {
        ask_later:
            "Somente apresente as opções de reutilização do conteúdo (não gere conteúdo final).",
        linkedin_text:
            "Post para LinkedIn com título + introdução contextual (2-4 frases) + texto corrido estruturado em parágrafos curtos (sem bullets) + pergunta final.",
        instagram_post:
            "Legenda estruturada (gancho + desenvolvimento + fechamento) + CTA claro (comentário, salvar, compartilhar ou clicar no link) + sugestão de imagem (descrição da imagem).",
        video_reels:
            "Roteiro curto para Reels com gancho, desenvolvimento e CTA final.",
        video_tiktok:
            "Roteiro curto para TikTok com gancho rápido e linguagem dinâmica.",
        video_youtube:
            "Roteiro estruturado para YouTube com introdução, tópicos e CTA.",
        video_linkedin:
            "Roteiro profissional para vídeo no LinkedIn com tom corporativo.",
    };

    return [
        "Você é um especialista em criação de conteúdo.",
        `Formato: ${formatMap[input.intent]}`,
        `Tom: ${tone}`,
        `Feedback do usuário: ${feedback}`,
        `Resposta anterior: ${previousResponse}`,
        "",
        "Regras:",
        "- Use apenas informações do contexto.",
        "- Não invente fatos.",
        "- Seja objetivo e claro.",
        "- Se houver feedback, ajuste o texto conforme solicitado e evite repetir a resposta anterior.",
        "",
        "Contexto:",
        input.context,
    ].join("\n");
};

const extractNode = async (state: SocialAgentState) => {
    const { userId, url, intent, query, tone, feedback, previousResponse } =
        state;
    const normalized = normalizeIntent(intent);

    const result = await extractContentTool.invoke({ userId, url });

    return {
        content: result.content,
        intentNormalized: normalized,
        query,
        tone,
        feedback,
        previousResponse,
    };
};

const askIntentNode = async () => ({
    response: buildIntentQuestion(),
});

const generateNode = async (state: SocialAgentState) => {
    const intent = state.intentNormalized;

    if (!intent || intent === "ask_later") {
        return { response: buildIntentQuestion() };
    }

    const retrieval = await retrieveContextTool.invoke({
        userId: state.userId,
        query: state.query || state.intent || "resuma o conteúdo",
        limit: 5,
        url: state.url,
    });

    const context = retrieval.context;
    const sources = retrieval.sources;

    const prompt = buildGenerationPrompt({
        intent,
        context,
        tone: state.tone,
        feedback: state.feedback,
        previousResponse: state.previousResponse,
    });

    const response = await getLlm().invoke([
        { role: "system", content: "Siga as instruções e não invente fatos." },
        { role: "user", content: prompt },
    ]);
    const usage = extractTokenUsage(response) ?? undefined;

    return {
        response: response.content ?? "",
        sources,
        usage,
    };
};

const routeAfterExtract = (state: SocialAgentState) =>
    state.intentNormalized && state.intentNormalized !== "ask_later"
        ? "generate"
        : "ask";

export const socialAgentGraph = new StateGraph(AgentState)
    .addNode("extract", extractNode)
    .addNode("ask", askIntentNode)
    .addNode("generate", generateNode)
    .addEdge(START, "extract")
    .addConditionalEdges("extract", routeAfterExtract, ["ask", "generate"])
    .addEdge("ask", END)
    .addEdge("generate", END)
    .compile();

export const runSocialAgent = async (
    input: SocialAgentInput,
): Promise<SocialAgentState> => {
    return socialAgentGraph.invoke({
        userId: input.userId,
        url: input.url,
        intent: input.intent,
        query: input.query,
        tone: input.tone,
        feedback: input.feedback,
        previousResponse: input.previousResponse,
    });
};
