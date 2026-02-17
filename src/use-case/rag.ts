import OpenAI from "openai";
import { cosineDistance, sql } from "drizzle-orm";
import { db } from "../db/connection";
import { storeContent } from "../db/schema/store-content";
import { envValid } from "../envSchema";
import { embedText } from "./embeddings";

const client = new OpenAI({
  apiKey: envValid.OPENAI_API_KEY,
});

export type RetrievedChunk = {
  id: string;
  url: string;
  content: string;
  distance: number;
};

export type RagQueryInput = {
  query: string;
  limit?: number;
  tone?: string;
  goal?: string;
  audience?: string;
  maxCharacters?: number;
};

export type RagQueryResult = {
  answer: string;
  sources: string[];
  context: string;
};

export const retrieveContext = async (
  query: string,
  limit = 5,
  url?: string,
): Promise<RetrievedChunk[]> => {
  const queryEmbedding = await embedText(query);
  const similarity = sql<number>`1 - (${cosineDistance(storeContent.embedding, queryEmbedding)})`;

  const rows = await db
    .select({
      id: storeContent.id,
      url: storeContent.url,
      content: storeContent.content,
      similarity,
    })
    .from(storeContent)
    .where(url ? sql`${storeContent.url} = ${url}` : undefined)
    .orderBy((t) => sql`${t.similarity} DESC`)
    .limit(limit);

  return rows.map((r) => ({ ...r, distance: 0 })); // distance isn't effectively used, preserving interface
};

const buildRagPrompt = (input: {
  query: string;
  context: string;
  tone?: string;
  goal?: string;
  audience?: string;
  maxCharacters?: number;
}): string => {
  const goal =
    input.goal ??
    "Maximizar o alcance e o engajamento orgânico nas redes sociais";
  const audience =
    input.audience ?? "Criadores de conteúdo e profissionais de marketing";
  const tone =
    input.tone ??
    "estrategista sênior de mídia social, direto, prático e orientado a resultados";
  const maxChars = input.maxCharacters ?? 1300;

  return [
    "Você é um estrategista sênior de mídia social especializado em transformar conteúdos longos em peças otimizadas para Reels, TikTok e YouTube.",
    `Objetivo geral: ${goal}.`,
    `Público-alvo principal: ${audience}.`,
    `Tom: ${tone}.`,
    `Limite máximo de resposta: ${maxChars} caracteres (se precisar cortar, priorize clareza e praticidade).`,
    "",
    "Instruções de atuação:",
    "- Analise profundamente o contexto fornecido e identifique a mensagem central e 3 a 5 insights-chave.",
    "- Crie estratégias de reaproveitamento (repurposing) do conteúdo para diferentes formatos de vídeo.",
    "- Use apenas informações do contexto. Se faltar dado relevante, deixe isso explícito.",
    "- Não invente fatos ou métricas. Quando fizer suposições, sinalize como hipótese.",
    "",
    "Entregáveis obrigatórios (nesta ordem):",
    "1) Resumo estratégico da mensagem central do conteúdo.",
    "2) Roteiro para Reels (gancho forte inicial, desenvolvimento breve e CTA claro).",
    "3) Roteiro para TikTok (gancho ainda mais rápido, linguagem dinâmica e CTA direto).",
    "4) Roteiro para YouTube (introdução, desenvolvimento em tópicos e CTA final).",
    "5) Análise de performance esperada para cada plataforma (gancho, retenção, CTA e possíveis riscos).",
    "6) Sugestões de hashtags estratégicas separadas por plataforma (Reels, TikTok e YouTube).",
    "7) Recomendações de timing de postagem (dias, horários e cadência sugerida por plataforma).",
    "8) Variações de conteúdo para testar (pelo menos 3 ganchos alternativos e 2 variações de CTA).",
    "",
    "Boas práticas e tendências atuais a considerar:",
    "- Utilize linguagem natural em português do Brasil, podendo incluir termos em inglês quando fizer sentido.",
    "- Priorize estruturas que prendam a atenção nos primeiros 3 segundos.",
    "- Considere consumo mobile, formato vertical e comportamento típico do feed de cada plataforma.",
    "",
    "Contexto para análise e criação:",
    input.context,
    "",
    `Pedido específico do usuário ou foco desejado: ${input.query}`,
  ].join("\n");
};

export const answerWithRag = async (
  input: RagQueryInput,
): Promise<RagQueryResult> => {
  if (!input.query || input.query.trim().length === 0) {
    throw new Error("Consulta vazia. Forneça uma pergunta válida.");
  }

  const rows = await retrieveContext(input.query, input.limit ?? 5);
  const context = rows.map((row) => row.content).join("\n\n");

  const prompt = buildRagPrompt({
    query: input.query,
    context,
    tone: input.tone,
    goal: input.goal,
    audience: input.audience,
    maxCharacters: input.maxCharacters,
  });

  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.2,
    messages: [
      {
        role: "developer",
        content: "Use estritamente o contexto fornecido. Não invente fatos.",
      },
      { role: "user", content: prompt },
    ],
  });

  const answer = response.choices[0]?.message?.content?.trim();

  if (!answer) {
    throw new Error("Falha ao gerar resposta RAG.");
  }

  return {
    answer,
    sources: rows.map((row) => row.url),
    context,
  };
};
