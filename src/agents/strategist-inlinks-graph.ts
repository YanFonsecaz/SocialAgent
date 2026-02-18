import { z } from "zod";
import { ChatOpenAI } from "@langchain/openai";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { extractTextFromHtml } from "../use-case/extract-content";
import { embedBatch, embedText } from "../use-case/embeddings";

const DecisionSchema = z.object({
  ok: z.boolean().describe("Se o link deve ser inserido ou não"),
  url: z.string().url().optional(),
  original_sentence: z
    .string()
    .optional()
    .describe("A frase exata no texto original onde o link será inserido"),
  modified_sentence: z
    .string()
    .optional()
    .describe("A frase reescrita com o link em formato Markdown"),
  anchor: z.string().optional().describe("O texto âncora escolhido"),
  reason: z.string().describe("Justificativa da decisão de SEO"),
  seo_metrics: z
    .object({
      relevance: z.number().describe("Nota de relevância temática (0-100)"),
      authority: z.number().describe("Nota de autoridade percebida (0-100)"),
    })
    .optional(),
});

export type SeoLinkReport = {
  targetUrl: string;
  anchor: string;
  originalSentence: string;
  modifiedSentence: string;
  positionIndex?: number;
  insertionStrategy?: "inline" | "semantic-paragraph" | "append";
  insertionContext?: string;
  justification: string;
  metrics?: { relevance: number; authority: number };
};

export type StrategistInlinksInput = {
  principalUrl: string;
  analysisUrls: string[];
  principalContent?: string;
  maxCandidates?: number;
  similarityThreshold?: number;
};

export type StrategistInlinksResult = {
  principalUrl: string;
  modifiedContent: string;
  report: SeoLinkReport[];
  metrics: {
    totalLinks: number;
    density: number;
    candidatesAnalyzed: number;
  };
  // Mantendo compatibilidade legada por segurança, mas idealmente depreciada
  selectedUrls: Array<{ url: string; sentence: string; anchor: string }>;
  rejected: Array<{ url: string; reason: string; score?: number }>;
};

type CandidateItem = {
  url: string;
  content: string;
  score: number;
};

const AgentState = Annotation.Root({
  principalUrl: Annotation<string>(),
  analysisUrls: Annotation<string[]>(),
  principalContent: Annotation<string>(),
  analysisContents: Annotation<string[]>({
    reducer: (a, b) => a.concat(b),
    default: () => [],
  }),
  scoredCandidates: Annotation<CandidateItem[]>({
    reducer: (a, b) => a.concat(b),
    default: () => [],
  }),
  modifiedContent: Annotation<string>({
    reducer: (x, y) => y ?? x,
    default: () => "",
  }),
  report: Annotation<SeoLinkReport[]>({
    reducer: (a, b) => a.concat(b),
    default: () => [],
  }),
  selectedUrls: Annotation<
    Array<{ url: string; sentence: string; anchor: string }>
  >({
    reducer: (a, b) => a.concat(b),
    default: () => [],
  }),
  rejected: Annotation<Array<{ url: string; reason: string; score?: number }>>({
    reducer: (a, b) => a.concat(b),
    default: () => [],
  }),
  maxCandidates: Annotation<number | undefined>(),
  similarityThreshold: Annotation<number | undefined>(),
});

type StrategistInlinksState = typeof AgentState.State;

const llm = new ChatOpenAI({
  model: "gpt-4o-mini",
  temperature: 0,
});

const cosineSimilarity = (a: number[], b: number[]): number => {
  if (a.length !== b.length) {
    throw new Error("Embedding length mismatch.");
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }

  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
};

const fetchMany = async (
  urls: string[],
  concurrency = 5,
): Promise<string[]> => {
  const results: string[] = new Array(urls.length);
  let cursor = 0;

  const workers = Array.from({ length: concurrency }).map(async () => {
    while (cursor < urls.length) {
      const index = cursor++;
      const url = urls[index];
      if (!url) {
        results[index] = "";
        continue;
      }
      try {
        results[index] = await extractTextFromHtml(url);
      } catch (error) {
        console.error("Falha ao extrair URL:", url, error);
        results[index] = "";
      }
    }
  });

  await Promise.all(workers);
  return results;
};

const extractPrincipalNode = async (state: StrategistInlinksState) => {
  if (state.principalContent && state.principalContent.trim().length > 0) {
    return { principalContent: state.principalContent };
  }

  const principalContent = await extractTextFromHtml(state.principalUrl);
  return { principalContent };
};

const extractCandidatesNode = async (state: StrategistInlinksState) => {
  const contents = await fetchMany(state.analysisUrls, 5);
  return { analysisContents: contents };
};

const scoreCandidatesNode = async (state: StrategistInlinksState) => {
  const { principalContent, analysisUrls, analysisContents } = state;

  const principalEmbedding = await embedText(principalContent);
  const validCandidates = analysisUrls
    .map((url, index) => ({
      url,
      content: analysisContents[index] ?? "",
    }))
    .filter((item) => item.content.trim().length > 0);

  if (validCandidates.length === 0) {
    return {
      scoredCandidates: [],
      rejected: analysisUrls.map((url) => ({
        url,
        reason: "Conteúdo vazio ou indisponível.",
      })),
    };
  }

  const embeddings = await embedBatch(
    validCandidates.map((item) => item.content),
  );

  const scored: CandidateItem[] = validCandidates.map((item, index) => ({
    url: item.url,
    content: item.content,
    score: cosineSimilarity(principalEmbedding, embeddings[index] ?? []),
  }));

  const threshold = state.similarityThreshold ?? 0.2;
  const maxCandidates = state.maxCandidates ?? 30;

  const filtered = scored
    .filter((item) => item.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxCandidates);

  const rejected = scored
    .filter((item) => !filtered.includes(item))
    .map((item) => ({
      url: item.url,
      reason: "Similaridade abaixo do limiar ou fora do top.",
      score: item.score,
    }));

  return {
    scoredCandidates: filtered,
    rejected,
  };
};

const judgeCandidatesNode = async (state: StrategistInlinksState) => {
  const selectedUrls: Array<{ url: string; sentence: string; anchor: string }> =
    [];
  const rejected: Array<{ url: string; reason: string; score?: number }> = [];
  const report: SeoLinkReport[] = [];

  let modifiedContent = state.principalContent;
  const wordCount = modifiedContent.split(/\s+/).length;
  // Limite de densidade: 3 a 5 links por 1000 palavras. Usando 4 como target.
  const maxLinks = Math.max(2, Math.ceil((wordCount / 1000) * 4));
  let linksInserted = 0;

  const extractSentenceByAnchor = (
    content: string,
    anchorValue: string,
  ): string | null => {
    const normalizedAnchor = anchorValue.trim();
    if (!normalizedAnchor) return null;

    const normalize = (value: string) =>
      value.replace(/\u00a0/g, " ").toLowerCase();

    const normalizedContent = normalize(content);
    const index = normalizedContent.indexOf(normalize(normalizedAnchor));
    if (index === -1) return null;

    const before = content.slice(0, index);
    const after = content.slice(index + normalizedAnchor.length);

    const start = Math.max(
      before.lastIndexOf("."),
      before.lastIndexOf("!"),
      before.lastIndexOf("?"),
      before.lastIndexOf("\n"),
    );
    const endCandidates = [
      after.indexOf("."),
      after.indexOf("!"),
      after.indexOf("?"),
      after.indexOf("\n"),
    ].filter((value) => value !== -1);
    const endOffset =
      endCandidates.length > 0 ? Math.min(...endCandidates) : after.length;

    const sentenceStart = start === -1 ? 0 : start + 1;
    const sentenceEnd = index + normalizedAnchor.length + endOffset;

    const sentence = content.slice(sentenceStart, sentenceEnd).trim();
    return sentence.length > 0 ? sentence : null;
  };

  const findBestInsertionParagraph = (
    content: string,
    candidateText: string,
  ): { index: number; paragraph: string } => {
    const paragraphs = content
      .split(/\n{2,}/)
      .filter((paragraph) => paragraph.trim().length > 0);

    if (paragraphs.length === 0) {
      return { index: -1, paragraph: "" };
    }

    const normalizeTokens = (value: string) =>
      value
        .toLowerCase()
        .replace(/\u00a0/g, " ")
        .replace(/[^a-z0-9áéíóúãõâêîôûàç\s]+/gi, " ")
        .split(/\s+/)
        .filter((token) => token.length > 2);

    const candidateTokens = new Set(normalizeTokens(candidateText));
    let bestIndex = 0;
    let bestScore = -1;

    paragraphs.forEach((paragraph, index) => {
      const tokens = normalizeTokens(paragraph);
      if (tokens.length === 0) return;
      let score = 0;

      for (const token of tokens) {
        if (candidateTokens.has(token)) score++;
      }

      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });

    return { index: bestIndex, paragraph: paragraphs[bestIndex] ?? "" };
  };

  for (const candidate of state.scoredCandidates) {
    // Validação de Limite
    if (linksInserted >= maxLinks) {
      rejected.push({
        url: candidate.url,
        reason: "Limite máximo de densidade de links atingido.",
        score: candidate.score,
      });
      continue;
    }

    // Validação de Duplicidade
    if (report.some((r) => r.targetUrl === candidate.url)) {
      rejected.push({
        url: candidate.url,
        reason: "URL já linkada anteriormente neste conteúdo.",
        score: candidate.score,
      });
      continue;
    }

    const prompt = [
      "Atue como um Especialista Sênior em SEO e Link Building.",
      "Sua missão é analisar o Artigo Pilar e decidir se deve inserir um link interno para a URL candidata.",
      "",
      "REGRAS ESTRATÉGICAS:",
      "1. Identifique oportunidades naturais de inserção. Não force.",
      "2. EVITE COMPLETAMENTE âncoras genéricas ('clique aqui', 'leia mais', 'neste link').",
      "3. Use âncoras contextuais ricas semanticamente que descrevam o destino.",
      "4. Priorize links que aumentem a autoridade temática e a profundidade do conteúdo.",
      "5. Se decidir linkar, retorne a frase original EXATA e a frase modificada com Markdown.",
      "6. A frase ORIGINAL deve ser copiada literalmente do Artigo Pilar, sem alterar uma vírgula.",
      "7. Se não existir uma frase adequada, você pode CRIAR uma nova frase curta e natural (reescrita) com o link.",
      "8. Quando criar uma nova frase, deixe original_sentence vazio e retorne modified_sentence como a frase completa.",
      "9. Se não houver contexto adequado, retorne ok: false.",
      "",
      "DADOS DO CANDIDATO:",
      `URL: ${candidate.url}`,
      "Conteúdo (trecho):",
      candidate.content.slice(0, 800) + "...",
      "",
      "ARTIGO PILAR (Contexto Atual):",
      modifiedContent,
      "",
      "Responda SOMENTE com JSON válido no seguinte formato:",
      `{
        "ok": boolean,
        "url": "${candidate.url}",
        "reason": "Justificativa detalhada da escolha ou rejeição",
        "original_sentence": "Frase exata do texto onde o link será inserido",
        "modified_sentence": "Frase reescrita com o link em Markdown [ancora](url)",
        "anchor": "Texto da âncora escolhido",
        "seo_metrics": {
          "relevance": number (0-100),
          "authority": number (0-100)
        }
      }`,
    ].join("\n");

    try {
      const response = await llm.invoke([
        { role: "system", content: "Responda apenas JSON válido." },
        { role: "user", content: prompt },
      ]);

      const raw = typeof response.content === "string" ? response.content : "";
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      const parsedJson = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
      const parsed = parsedJson ? DecisionSchema.safeParse(parsedJson) : null;

      if (parsed?.success && parsed.data.ok) {
        const {
          original_sentence,
          modified_sentence,
          anchor,
          url,
          reason,
          seo_metrics,
        } = parsed.data;

        if (modified_sentence && anchor && url) {
          const anchorSentence =
            original_sentence && modifiedContent.includes(original_sentence)
              ? original_sentence
              : extractSentenceByAnchor(modifiedContent, anchor);

          if (anchorSentence && modifiedContent.includes(anchorSentence)) {
            const positionIndex = modifiedContent.indexOf(anchorSentence);

            modifiedContent = modifiedContent.replace(
              anchorSentence,
              modified_sentence,
            );

            linksInserted++;

            selectedUrls.push({
              url,
              sentence: modified_sentence,
              anchor,
            });

            report.push({
              targetUrl: url,
              anchor,
              originalSentence: anchorSentence,
              modifiedSentence: modified_sentence,
              positionIndex,
              insertionStrategy: "inline",
              insertionContext: anchorSentence,
              justification: reason,
              metrics: seo_metrics,
            });
          } else {
            const rewrittenSentence = modified_sentence.trim();
            if (rewrittenSentence.length > 0) {
              const paragraphs = modifiedContent
                .split(/\n{2,}/)
                .filter((paragraph) => paragraph.trim().length > 0);

              if (paragraphs.length === 0) {
                modifiedContent = rewrittenSentence;
                linksInserted++;

                selectedUrls.push({
                  url,
                  sentence: rewrittenSentence,
                  anchor,
                });

                report.push({
                  targetUrl: url,
                  anchor,
                  originalSentence: "[Trecho novo]",
                  modifiedSentence: rewrittenSentence,
                  positionIndex: 0,
                  insertionStrategy: "append",
                  insertionContext: "",
                  justification: reason,
                  metrics: seo_metrics,
                });
              } else {
                const { index: paragraphIndex, paragraph } =
                  findBestInsertionParagraph(
                    modifiedContent,
                    candidate.content,
                  );

                const safeIndex =
                  paragraphIndex >= 0 && paragraphIndex < paragraphs.length
                    ? paragraphIndex
                    : paragraphs.length - 1;

                paragraphs.splice(safeIndex + 1, 0, rewrittenSentence);
                modifiedContent = paragraphs.join("\n\n");

                const positionIndex = paragraphs
                  .slice(0, safeIndex + 1)
                  .join("\n\n").length;

                linksInserted++;

                selectedUrls.push({
                  url,
                  sentence: rewrittenSentence,
                  anchor,
                });

                report.push({
                  targetUrl: url,
                  anchor,
                  originalSentence: "[Trecho novo]",
                  modifiedSentence: rewrittenSentence,
                  positionIndex,
                  insertionStrategy: "semantic-paragraph",
                  insertionContext: paragraph,
                  justification: reason,
                  metrics: seo_metrics,
                });
              }
            } else {
              rejected.push({
                url: candidate.url,
                reason:
                  "Frase original não encontrada (conflito de edição ou alucinação).",
                score: candidate.score,
              });
            }
          }
        } else {
          rejected.push({
            url: candidate.url,
            reason: "Dados incompletos no JSON retornado.",
            score: candidate.score,
          });
        }
      } else if (parsed?.success) {
        rejected.push({
          url: candidate.url,
          reason: parsed.data.reason,
          score: candidate.score,
        });
      } else {
        rejected.push({
          url: candidate.url,
          reason: "Falha ao validar a resposta do modelo.",
          score: candidate.score,
        });
      }
    } catch (error) {
      console.error("Erro ao avaliar candidato:", candidate.url, error);
      rejected.push({
        url: candidate.url,
        reason: "Erro de execução no agente SEO.",
        score: candidate.score,
      });
    }
  }

  return { selectedUrls, rejected, modifiedContent, report };
};

export const strategistInlinksGraph = new StateGraph(AgentState)
  .addNode("extractPrincipal", extractPrincipalNode)
  .addNode("extractCandidates", extractCandidatesNode)
  .addNode("scoreCandidates", scoreCandidatesNode)
  .addNode("judgeCandidates", judgeCandidatesNode)
  .addEdge(START, "extractPrincipal")
  .addEdge("extractPrincipal", "extractCandidates")
  .addEdge("extractCandidates", "scoreCandidates")
  .addEdge("scoreCandidates", "judgeCandidates")
  .addEdge("judgeCandidates", END)
  .compile();

export const runStrategistInlinksGraph = async (
  input: StrategistInlinksInput,
): Promise<StrategistInlinksResult> => {
  const result = await strategistInlinksGraph.invoke({
    principalUrl: input.principalUrl,
    analysisUrls: input.analysisUrls,
    principalContent: input.principalContent,
    maxCandidates: input.maxCandidates,
    similarityThreshold: input.similarityThreshold,
  });

  const modifiedContent = result.modifiedContent ?? "";
  const report = result.report ?? [];
  const wordCount = modifiedContent.split(/\s+/).length;
  const density = wordCount > 0 ? (report.length / wordCount) * 1000 : 0;

  return {
    principalUrl: result.principalUrl,
    selectedUrls: result.selectedUrls ?? [],
    rejected: result.rejected ?? [],
    modifiedContent,
    report,
    metrics: {
      totalLinks: report.length,
      density,
      candidatesAnalyzed: (result.scoredCandidates ?? []).length,
    },
  };
};
