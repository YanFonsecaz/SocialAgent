import { z } from "zod";
import { ChatOpenAI } from "@langchain/openai";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { embedBatch, embedText } from "../use-case/embeddings";
import { extractTextFromHtml } from "../use-case/extract-content";

/**
 * Block-based Strategist Inlinks Graph
 *
 * Goal:
 * - Decide internal link insertions using paragraph/list-item blocks (NOT headings).
 * - Avoid fragile string matching against the full HTML by referencing a stable `blockId`.
 * - Support "free rewrite" within a block (LLM can rewrite block text to naturally insert link).
 *
 * Notes:
 * - This graph expects the caller to provide `principalBlocks` whenever possible.
 *   If not provided, it falls back to extracting principalContent as plain text (legacy).
 * - The caller should pre-filter analysisUrls (dedupe, remove principalUrl) in the HTTP layer.
 */

export type PrincipalBlockType = "paragraph" | "list_item";

export type PrincipalBlock = {
  id: string;
  type: PrincipalBlockType;
  text: string;
  containsLink: boolean;
};

export type StrategistInlinksBlockInput = {
  principalUrl: string;
  analysisUrls: string[];
  /**
   * Prefer passing blocks parsed from the Readability HTML output.
   * Must contain only paragraph/list_item blocks.
   */
  principalBlocks?: PrincipalBlock[];

  /**
   * Legacy plain text fallback (if blocks not provided).
   * If both are provided, blocks take precedence.
   */
  principalContent?: string;

  /**
   * Optional controls
   */
  maxCandidates?: number;
  similarityThreshold?: number;

  /**
   * Hard limit on how many insertions we will accept (UX/SEO density).
   * If omitted, computed from word count.
   */
  maxLinks?: number;
};

export type BlockEdit = {
  blockId: string;
  targetUrl: string;
  anchor: string;
  /**
   * The original block text snapshot used for diff/UX.
   */
  originalBlockText: string;
  /**
   * New block text in Markdown (must contain a single [anchor](url)).
   */
  modifiedBlockText: string;

  /**
   * Whether this edit is intended to overwrite the full block text (true),
   * or just represents a sentence-level suggestion (false). We default to true.
   */
  overwriteBlock: boolean;

  /**
   * LLM justification + optional metrics
   */
  justification: string;
  metrics?: { relevance: number; authority: number };

  /**
   * For transparency
   */
  skippedReason?:
    | "already_linked"
    | "no_valid_block"
    | "density_limit"
    | "duplicate";
};

export type StrategistInlinksBlockResult = {
  principalUrl: string;
  /**
   * The chosen edits (ordered in the same order they were applied).
   */
  edits: BlockEdit[];
  /**
   * Rejections for debugging/UX
   */
  rejected: Array<{ url: string; reason: string; score?: number }>;

  /**
   * Diagnostics
   */
  metrics: {
    totalLinks: number;
    densityPer1000Words: number;
    candidatesAnalyzed: number;
    eligibleBlocks: number;
  };
};

type CandidateItem = {
  url: string;
  content: string;
  score: number;
};

const DecisionSchema = z.object({
  ok: z.boolean(),
  url: z.string().url(),
  block_id: z.string().min(1),
  anchor: z.string().min(1),
  original_block_text: z.string().min(1),
  modified_block_text: z.string().min(1),
  reason: z.string().min(1),
  overwrite_block: z.boolean().optional(),
  seo_metrics: z
    .object({
      relevance: z.number().min(0).max(100),
      authority: z.number().min(0).max(100),
    })
    .optional(),
});

const AgentState = Annotation.Root({
  principalUrl: Annotation<string>(),
  analysisUrls: Annotation<string[]>(),

  // Preferred
  principalBlocks: Annotation<PrincipalBlock[] | undefined>(),

  // Legacy fallback
  principalContent: Annotation<string>(),

  analysisContents: Annotation<string[]>({
    reducer: (a, b) => a.concat(b),
    default: () => [],
  }),

  scoredCandidates: Annotation<CandidateItem[]>({
    reducer: (a, b) => a.concat(b),
    default: () => [],
  }),

  edits: Annotation<BlockEdit[]>({
    reducer: (a, b) => a.concat(b),
    default: () => [],
  }),

  rejected: Annotation<Array<{ url: string; reason: string; score?: number }>>({
    reducer: (a, b) => a.concat(b),
    default: () => [],
  }),

  maxCandidates: Annotation<number | undefined>(),
  similarityThreshold: Annotation<number | undefined>(),
  maxLinks: Annotation<number | undefined>(),
});

type StrategistInlinksBlockState = typeof AgentState.State;

const llm = new ChatOpenAI({
  model: "gpt-4o-mini",
  temperature: 0,
});

const cosineSimilarity = (a: number[], b: number[]): number => {
  if (a.length !== b.length) throw new Error("Embedding length mismatch.");

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
      } catch (err) {
        console.error("Falha ao extrair URL candidata:", url, err);
        results[index] = "";
      }
    }
  });

  await Promise.all(workers);
  return results;
};

const extractPrincipalNode = async (state: StrategistInlinksBlockState) => {
  // Prefer blocks if provided
  if (state.principalBlocks && state.principalBlocks.length > 0) {
    const principalContent = state.principalBlocks
      .map((b) => b.text)
      .join("\n\n")
      .trim();

    return {
      principalBlocks: state.principalBlocks,
      principalContent,
    };
  }

  // Legacy fallback
  if (state.principalContent && state.principalContent.trim().length > 0) {
    return { principalContent: state.principalContent };
  }

  const principalContent = await extractTextFromHtml(state.principalUrl);
  return { principalContent };
};

const extractCandidatesNode = async (state: StrategistInlinksBlockState) => {
  const contents = await fetchMany(state.analysisUrls, 5);
  return { analysisContents: contents };
};

const scoreCandidatesNode = async (state: StrategistInlinksBlockState) => {
  const principalEmbedding = await embedText(state.principalContent);

  const validCandidates = state.analysisUrls
    .map((url, index) => ({
      url,
      content: state.analysisContents[index] ?? "",
    }))
    .filter((c) => c.content.trim().length > 0);

  if (validCandidates.length === 0) {
    return {
      scoredCandidates: [],
      rejected: state.analysisUrls.map((url) => ({
        url,
        reason: "Conteúdo vazio ou indisponível.",
      })),
    };
  }

  const embeddings = await embedBatch(validCandidates.map((c) => c.content));

  const scored: CandidateItem[] = validCandidates.map((c, i) => ({
    url: c.url,
    content: c.content,
    score: cosineSimilarity(principalEmbedding, embeddings[i] ?? []),
  }));

  const threshold = state.similarityThreshold ?? 0.2;
  const maxCandidates = state.maxCandidates ?? 30;

  const filtered = scored
    .filter((c) => c.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxCandidates);

  const rejected = scored
    .filter((c) => !filtered.includes(c))
    .map((c) => ({
      url: c.url,
      reason: "Similaridade abaixo do limiar ou fora do top.",
      score: c.score,
    }));

  return { scoredCandidates: filtered, rejected };
};

const computeMaxLinks = (content: string, explicit?: number): number => {
  if (typeof explicit === "number" && Number.isFinite(explicit) && explicit > 0)
    return Math.floor(explicit);

  const wc =
    content.trim().length === 0 ? 0 : content.trim().split(/\s+/).length;
  // 3-5 links por 1000 palavras; alvo 4, mínimo 2
  return Math.max(2, Math.ceil((wc / 1000) * 4));
};

const pickBestBlock = (
  blocks: PrincipalBlock[],
  candidateContent: string,
): PrincipalBlock | null => {
  // token-overlap heuristic: fast and deterministic
  const normalizeTokens = (value: string) =>
    value
      .toLowerCase()
      .replace(/\u00a0/g, " ")
      .replace(/[^a-z0-9áéíóúãõâêîôûàç\s]+/gi, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2);

  const candTokens = new Set(normalizeTokens(candidateContent));
  if (candTokens.size === 0) return null;

  let best: PrincipalBlock | null = null;
  let bestScore = -1;

  for (const b of blocks) {
    const tokens = normalizeTokens(b.text);
    if (tokens.length === 0) continue;

    let score = 0;
    for (const t of tokens) if (candTokens.has(t)) score++;

    if (score > bestScore) {
      bestScore = score;
      best = b;
    }
  }

  return best;
};

const ensureSingleMarkdownLink = (
  modifiedBlockText: string,
  expectedUrl: string,
): boolean => {
  // Expect exactly one markdown link and it must point to expectedUrl
  const matches = [...modifiedBlockText.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)];
  if (matches.length !== 1) return false;
  const url = matches[0]?.[1]?.trim();
  return url === expectedUrl;
};

const isGenericAnchor = (anchor: string): boolean => {
  const a = anchor
    .toLowerCase()
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!a) return true;

  // Very generic CTA anchors
  const genericPhrases = new Set([
    "clique aqui",
    "aqui",
    "saiba mais",
    "leia mais",
    "neste link",
    "confira",
    "veja",
    "acesse",
    "entenda",
    "descubra",
  ]);
  if (genericPhrases.has(a)) return true;

  // Overly vague anchors that tend to be low-signal in SEO context
  // (keep this conservative; we can expand based on real output)
  const vaguePatterns: RegExp[] = [
    /^modelo\s*\d{4}$/i,
    /^modelos?\s*(mais)?\s*(recentes|novos|antigos)?$/i,
    /^opções?\s*(disponíveis)?$/i,
    /^lista\s*(completa)?$/i,
    /^artigo$/i,
    /^conteúdo$/i,
    /^post$/i,
    /^guia$/i,
    /^veja\s*(a)?\s*lista$/i,
  ];
  if (vaguePatterns.some((re) => re.test(a))) return true;

  // Too short anchors are usually non-descriptive
  const wordCount = a.split(" ").filter(Boolean).length;
  if (wordCount < 2) return true;

  // Avoid anchors that are only numbers / years
  if (/^\d+$/i.test(a)) return true;

  return false;
};

const anchorTokenOverlap = (
  anchor: string,
  candidateContent: string,
): { overlapCount: number; anchorTokenCount: number } => {
  const normalize = (v: string) =>
    v
      .toLowerCase()
      .replace(/\u00a0/g, " ")
      .replace(/[^a-z0-9áéíóúãõâêîôûàç\s]+/gi, " ")
      .replace(/\s+/g, " ")
      .trim();

  const stopwords = new Set([
    "a",
    "o",
    "os",
    "as",
    "um",
    "uma",
    "uns",
    "umas",
    "de",
    "do",
    "da",
    "dos",
    "das",
    "no",
    "na",
    "nos",
    "nas",
    "em",
    "para",
    "por",
    "com",
    "sem",
    "e",
    "ou",
    "que",
    "como",
    "mais",
    "menos",
    "sobre",
    "até",
    "entre",
    "também",
    "veja",
    "confira",
  ]);

  const tokenize = (v: string) =>
    normalize(v)
      .split(" ")
      .map((t) => t.trim())
      .filter((t) => t.length > 2 && !stopwords.has(t));

  const aTokens = tokenize(anchor);
  if (aTokens.length === 0) return { overlapCount: 0, anchorTokenCount: 0 };

  const cTokens = new Set(tokenize(candidateContent));

  let overlap = 0;
  for (const t of aTokens) {
    if (cTokens.has(t)) overlap++;
  }

  return { overlapCount: overlap, anchorTokenCount: aTokens.length };
};

const judgeCandidatesNode = async (state: StrategistInlinksBlockState) => {
  const edits: BlockEdit[] = [];
  const rejected: Array<{ url: string; reason: string; score?: number }> = [];

  const hasBlocks = (state.principalBlocks?.length ?? 0) > 0;
  const eligibleBlocks = hasBlocks
    ? (state.principalBlocks ?? []).filter(
        (b) =>
          (b.type === "paragraph" || b.type === "list_item") && !b.containsLink,
      )
    : [];

  const maxLinks = computeMaxLinks(state.principalContent, state.maxLinks);

  const usedUrls = new Set<string>();
  const usedBlockIds = new Set<string>();
  const usedAnchorsNormalized = new Set<string>();

  const normalizeAnchor = (value: string) =>
    value
      .toLowerCase()
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  for (const candidate of state.scoredCandidates) {
    if (edits.length >= maxLinks) {
      rejected.push({
        url: candidate.url,
        reason: "Limite máximo de densidade de links atingido.",
        score: candidate.score,
      });
      continue;
    }

    if (usedUrls.has(candidate.url)) {
      rejected.push({
        url: candidate.url,
        reason: "URL já selecionada anteriormente neste conteúdo.",
        score: candidate.score,
      });
      continue;
    }

    if (!hasBlocks) {
      // Fallback to legacy mode: we can't reliably edit without block IDs.
      rejected.push({
        url: candidate.url,
        reason:
          "Pipeline por blocos não disponível (principalBlocks ausente). Use o modo legado ou forneça blocks.",
        score: candidate.score,
      });
      continue;
    }

    if (eligibleBlocks.length === 0) {
      rejected.push({
        url: candidate.url,
        reason:
          "Não há blocos elegíveis (parágrafos/listas sem links) para inserir novos links.",
        score: candidate.score,
      });
      continue;
    }

    // Prefer a block that hasn't been used yet. If the best block is already used,
    // fall back to the next best by a simple retry strategy:
    // - temporarily filter used blocks and pick again.
    const remainingBlocks = eligibleBlocks.filter(
      (b) => !usedBlockIds.has(b.id),
    );
    const bestBlock = pickBestBlock(
      remainingBlocks.length > 0 ? remainingBlocks : eligibleBlocks,
      candidate.content,
    );

    if (!bestBlock) {
      rejected.push({
        url: candidate.url,
        reason: "Falha ao selecionar um bloco alvo para inserção.",
        score: candidate.score,
      });
      continue;
    }

    // Hard rule: avoid multiple edits targeting the same block
    if (usedBlockIds.has(bestBlock.id)) {
      rejected.push({
        url: candidate.url,
        reason:
          "Bloco alvo já utilizado por outro link (evitando múltiplas alterações no mesmo parágrafo/item).",
        score: candidate.score,
      });
      continue;
    }

    const prompt = [
      "Atue como um Especialista Sênior em SEO e Link Building.",
      "Sua missão é inserir um link interno natural no conteúdo do Artigo Pilar,",
      "mas SOMENTE dentro de UM bloco (parágrafo ou item de lista) fornecido.",
      "",
      "REGRAS CRÍTICAS:",
      "1) Você pode reescrever o bloco, MAS deve preservar o sentido original.",
      "2) Insira exatamente UM link em Markdown no formato: [texto âncora](url).",
      "3) A âncora DEVE ser descritiva e específica. Proibido âncoras genéricas/ambíguas como: 'clique aqui', 'saiba mais', 'leia mais', 'aqui', 'lista completa', 'opções disponíveis', 'modelo 2024', etc.",
      "4) A âncora deve ter 2 a 6 palavras e, sempre que possível, refletir o tópico da URL candidata (termos que aparecem no conteúdo candidato).",
      "5) Não adicione novos fatos. Não invente números.",
      "6) Se não houver inserção natural no bloco fornecido, responda ok:false.",
      "",
      "CANDIDATO:",
      `URL: ${candidate.url}`,
      "Conteúdo candidato (trecho):",
      candidate.content.slice(0, 900) + "...",
      "",
      "BLOCO ALVO (onde você DEVE inserir, se fizer sentido):",
      `block_id: ${bestBlock.id}`,
      `block_type: ${bestBlock.type}`,
      "block_text:",
      bestBlock.text,
      "",
      "Responda SOMENTE com JSON válido no formato:",
      `{
        "ok": boolean,
        "url": "${candidate.url}",
        "block_id": "${bestBlock.id}",
        "anchor": "texto da âncora",
        "original_block_text": "texto original do bloco (copie exatamente o block_text recebido)",
        "modified_block_text": "texto novo do bloco com 1 link markdown",
        "overwrite_block": true,
        "reason": "justificativa",
        "seo_metrics": { "relevance": number, "authority": number }
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

      if (!parsed?.success) {
        rejected.push({
          url: candidate.url,
          reason: "Falha ao validar a resposta do modelo (JSON inválido).",
          score: candidate.score,
        });
        continue;
      }

      const decision = parsed.data;

      if (!decision.ok) {
        rejected.push({
          url: candidate.url,
          reason: decision.reason,
          score: candidate.score,
        });
        continue;
      }

      // Validate block id and block text snapshot
      if (decision.block_id !== bestBlock.id) {
        rejected.push({
          url: candidate.url,
          reason: "Modelo retornou block_id diferente do solicitado.",
          score: candidate.score,
        });
        continue;
      }

      // Ensure it didn't drift the original block text
      if (decision.original_block_text.trim() !== bestBlock.text.trim()) {
        rejected.push({
          url: candidate.url,
          reason:
            "Modelo não copiou o texto original do bloco exatamente (auditoria falhou).",
          score: candidate.score,
        });
        continue;
      }

      // Ensure exactly one markdown link to the expected URL
      if (
        !ensureSingleMarkdownLink(decision.modified_block_text, candidate.url)
      ) {
        rejected.push({
          url: candidate.url,
          reason:
            "O bloco modificado deve conter exatamente 1 link em Markdown apontando para a URL candidata.",
          score: candidate.score,
        });
        continue;
      }

      // Ensure anchor appears inside the markdown link text
      if (!decision.modified_block_text.includes(`[${decision.anchor}](`)) {
        rejected.push({
          url: candidate.url,
          reason:
            "A âncora retornada precisa corresponder ao texto do link em Markdown.",
          score: candidate.score,
        });
        continue;
      }

      // Enforce descriptive anchors (reject generic/low-signal anchors)
      if (isGenericAnchor(decision.anchor)) {
        rejected.push({
          url: candidate.url,
          reason:
            "Âncora rejeitada por ser genérica/ambígua. Use uma âncora descritiva (2-6 palavras) alinhada ao tema da URL candidata.",
          score: candidate.score,
        });
        continue;
      }

      // Prefer anchors with a minimum token overlap with candidate content (ensures topical alignment without being too strict)
      const { overlapCount, anchorTokenCount } = anchorTokenOverlap(
        decision.anchor,
        candidate.content,
      );

      // Threshold: require at least 2 overlapping tokens for longer anchors; allow 1 for short anchors (2-3 tokens).
      const minOverlap =
        anchorTokenCount >= 4 ? 2 : anchorTokenCount >= 2 ? 1 : 0;

      if (overlapCount < minOverlap) {
        rejected.push({
          url: candidate.url,
          reason:
            "Âncora rejeitada por baixa aderência temática ao conteúdo candidato (overlap de termos insuficiente). Use 2-6 palavras com termos que apareçam no conteúdo candidato.",
          score: candidate.score,
        });
        continue;
      }

      // Avoid duplicate anchors across the whole document (UX: prevents "same anchor everywhere")
      const anchorNormalized = normalizeAnchor(decision.anchor);
      if (anchorNormalized.length === 0) {
        rejected.push({
          url: candidate.url,
          reason: "Âncora vazia após normalização.",
          score: candidate.score,
        });
        continue;
      }

      if (usedAnchorsNormalized.has(anchorNormalized)) {
        rejected.push({
          url: candidate.url,
          reason:
            "Âncora já utilizada anteriormente (evitando repetição e melhorando a variedade semântica).",
          score: candidate.score,
        });
        continue;
      }

      // Hard rule (again): prevent multiple edits on the same block even if LLM drifted
      if (usedBlockIds.has(decision.block_id)) {
        rejected.push({
          url: candidate.url,
          reason:
            "Bloco já utilizado por outro link (evitando múltiplas alterações no mesmo bloco).",
          score: candidate.score,
        });
        continue;
      }

      edits.push({
        blockId: decision.block_id,
        targetUrl: candidate.url,
        anchor: decision.anchor,
        originalBlockText: decision.original_block_text,
        modifiedBlockText: decision.modified_block_text,
        overwriteBlock: decision.overwrite_block ?? true,
        justification: decision.reason,
        metrics: decision.seo_metrics,
      });

      usedUrls.add(candidate.url);
      usedBlockIds.add(decision.block_id);
      usedAnchorsNormalized.add(anchorNormalized);
    } catch (err) {
      console.error(
        "Erro ao avaliar candidato (block-graph):",
        candidate.url,
        err,
      );
      rejected.push({
        url: candidate.url,
        reason: "Erro de execução no agente SEO (block-graph).",
        score: candidate.score,
      });
    }
  }

  return { edits, rejected };
};

export const strategistInlinksBlockGraph = new StateGraph(AgentState)
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

export const runStrategistInlinksBlockGraph = async (
  input: StrategistInlinksBlockInput,
): Promise<StrategistInlinksBlockResult> => {
  const result = await strategistInlinksBlockGraph.invoke({
    principalUrl: input.principalUrl,
    analysisUrls: input.analysisUrls,
    principalBlocks: input.principalBlocks,
    principalContent: input.principalContent,
    maxCandidates: input.maxCandidates,
    similarityThreshold: input.similarityThreshold,
    maxLinks: input.maxLinks,
  });

  const content = result.principalContent ?? "";
  const wc =
    content.trim().length === 0 ? 0 : content.trim().split(/\s+/).length;
  const densityPer1000Words =
    wc > 0 ? ((result.edits ?? []).length / wc) * 1000 : 0;

  return {
    principalUrl: result.principalUrl,
    edits: result.edits ?? [],
    rejected: result.rejected ?? [],
    metrics: {
      totalLinks: (result.edits ?? []).length,
      densityPer1000Words,
      candidatesAnalyzed: (result.scoredCandidates ?? []).length,
      eligibleBlocks: (result.principalBlocks ?? []).filter(
        (b) =>
          (b.type === "paragraph" || b.type === "list_item") && !b.containsLink,
      ).length,
    },
  };
};
