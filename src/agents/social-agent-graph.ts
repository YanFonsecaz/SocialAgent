import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { ChatOpenAI } from "@langchain/openai";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { extractTextFromHtml } from "../use-case/extract-content";
import { saveCleanContent } from "../use-case/save-content";
import { retrieveContext } from "../use-case/rag.ts";

const IntentSchema = z.enum([
  "linkedin_text",
  "instagram_post",
  "video_reels",
  "video_tiktok",
  "video_youtube",
  "video_linkedin",
]);

type SocialAgentInput = {
  url: string;
  intent?: string;
  query?: string;
  tone?: string;
  feedback?: string;
  previousResponse?: string;
};

const AgentState = Annotation.Root({
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
});

type SocialAgentState = typeof AgentState.State;

const extractContentTool = tool(
  async ({ url }) => {
    const content = await extractTextFromHtml(url);
    await saveCleanContent(url, content);
    return { content };
  },
  {
    name: "extract_url_content",
    description: "Extrai e salva o conteúdo limpo de uma URL.",
    schema: z.object({
      url: z.string().url(),
    }),
  },
);

const retrieveContextTool = tool(
  async ({ query, limit, url }) => {
    const rows = await retrieveContext(query, limit ?? 5, url);
    const context = rows.map((row) => row.content).join("\n\n");
    const sources = rows.map((row) => row.url);
    return { context, sources };
  },
  {
    name: "retrieve_context",
    description: "Recupera contexto relevante do banco vetorial.",
    schema: z.object({
      query: z.string().min(1),
      limit: z.number().int().positive().max(20).optional(),
      url: z.string().url().optional(),
    }),
  },
);

const llm = new ChatOpenAI({
  model: "gpt-4o-mini",
  temperature: 0.3,
});

const normalizeIntent = (
  intent?: string,
): z.infer<typeof IntentSchema> | undefined => {
  if (!intent) return undefined;
  const value = intent.toLowerCase();

  if (value.includes("linkedin") && value.includes("post"))
    return "linkedin_text";
  if (value.includes("instagram")) return "instagram_post";
  if (value.includes("reels")) return "video_reels";
  if (value.includes("tiktok")) return "video_tiktok";
  if (value.includes("youtube")) return "video_youtube";
  if (value.includes("linkedin") && value.includes("video"))
    return "video_linkedin";

  try {
    return IntentSchema.parse(intent);
  } catch {
    return undefined;
  }
};

const buildIntentQuestion = () =>
  [
    "Como você deseja reutilizar o conteúdo?",
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
    linkedin_text:
      "Post textual para LinkedIn com título, 3-6 bullets e pergunta final.",
    instagram_post:
      "Legenda curta + indicação de imagem sugerida (descrição da imagem).",
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
  const { url, intent, query, tone, feedback, previousResponse } = state;
  const normalized = normalizeIntent(intent);

  const result = await extractContentTool.invoke({ url });

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
  if (!intent) {
    return { response: buildIntentQuestion() };
  }

  const retrieval = await retrieveContextTool.invoke({
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

  const response = await llm.invoke([
    { role: "system", content: "Siga as instruções e não invente fatos." },
    { role: "user", content: prompt },
  ]);

  return {
    response: response.content ?? "",
    sources,
  };
};

const routeAfterExtract = (state: SocialAgentState) =>
  state.intentNormalized ? "generate" : "ask";

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
    url: input.url,
    intent: input.intent,
    query: input.query,
    tone: input.tone,
    feedback: input.feedback,
    previousResponse: input.previousResponse,
  });
};
