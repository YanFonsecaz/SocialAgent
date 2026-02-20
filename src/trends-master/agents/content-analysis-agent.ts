import { envValid } from "../../envSchema";
import { fetchWithRetry } from "../services/http-utils";
import type { NewsResult } from "../types";

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type OpenAIChatResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

const OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions";

type LlmOptions = {
  model?: string;
  temperature?: number;
  timeoutMs?: number;
};

async function callOpenAIChat(
  messages: ChatMessage[],
  options: LlmOptions = {},
): Promise<string> {
  const {
    model = "gpt-4o-mini",
    temperature = 0.2,
    timeoutMs = 12000,
  } = options;

  const body = JSON.stringify({
    model,
    temperature,
    messages,
  });

  const response = await fetchWithRetry<OpenAIChatResponse>(
    OPENAI_ENDPOINT,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${envValid.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body,
    },
    { timeoutMs },
    {
      maxRetries: 2,
      initialDelayMs: 1000,
      maxDelayMs: 6000,
    },
  );

  return response?.choices?.[0]?.message?.content?.trim() ?? "";
}

export async function summarizeTrends(
  sector: string,
  allNews: NewsResult[],
): Promise<string> {
  try {
    const bullets: string[] = [];

    for (const item of allNews) {
      if (!item.keyword) continue;
      bullets.push(`- Palavra-chave: ${item.keyword}`);
      for (const article of item.articles.slice(0, 3)) {
        bullets.push(
          `  - ${article.title} (${article.source}) — ${article.link}`,
        );
      }
    }

    const systemPrompt =
      "Você é um assistente que escreve em português do Brasil.";
    const userPrompt = [
      "Você é um analista de inteligência de mercado.",
      `Setor: ${sector}`,
      "",
      "Com base nas palavras-chave e notícias coletadas,",
      "elabore um resumo breve (5–10 linhas) destacando tendências, riscos e oportunidades.",
      "Use um tom claro e objetivo. Em seguida, liste as fontes em bullet points.",
      "",
      "Fontes coletadas:",
      bullets.join("\n"),
    ].join("\n");

    const content = await callOpenAIChat(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      { temperature: 0.2, timeoutMs: 15000 },
    );

    return content || "Resumo não disponível.";
  } catch (error) {
    console.error("[Trends Summarizer] Erro ao gerar resumo:", error);
    return "Resumo não disponível: erro ao processar com LLM.";
  }
}

export async function summarizeArticle(content: string): Promise<string> {
  try {
    const truncated = content.slice(0, 4000);

    const systemPrompt =
      "Você é um assistente que resume notícias em português do Brasil.";
    const userPrompt = [
      "Resuma o texto abaixo em 1 ou 2 frases curtas e objetivas,",
      "focando apenas no fato principal da notícia.",
      "",
      "Texto:",
      truncated,
    ].join("\n");

    const summary = await callOpenAIChat(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      { model: "gpt-4o-mini", temperature: 0.1, timeoutMs: 10000 },
    );

    return summary.trim();
  } catch (error) {
    console.warn("[Summarizer] Falha ao resumir artigo:", error);
    return "";
  }
}

export async function validateTrendRelevance(
  term: string,
  category: string,
): Promise<boolean> {
  try {
    const systemPrompt = "Você é um classificador de tópicos rigoroso.";
    const userPrompt = [
      `O termo de pesquisa "${term}" é semanticamente relevante e diretamente relacionado ao setor/categoria "${category}"?`,
      "",
      'Responda APENAS com "SIM" ou "NAO".',
      "Exemplos:",
      '- Trend: "ChatGPT", Categoria: "Inteligência Artificial" -> SIM',
      '- Trend: "Lava e Seca", Categoria: "Inteligência Artificial" -> NAO',
      '- Trend: "iPhone 15", Categoria: "Carros" -> NAO',
    ].join("\n");

    const content = await callOpenAIChat(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      { model: "gpt-4o-mini", temperature: 0.0, timeoutMs: 10000 },
    );

    return content.trim().toUpperCase().includes("SIM");
  } catch (error) {
    console.warn(
      `[Summarizer] Erro ao validar tendência "${term}":`,
      error,
    );
    return false;
  }
}
