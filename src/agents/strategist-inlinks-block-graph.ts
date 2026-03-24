import { z } from "zod";
import { ChatOpenAI } from "@langchain/openai";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { embedBatch, embedText } from "../use-case/embeddings";
import {
    extractTextFromHtml,
    extractMetadataFromUrl,
} from "../use-case/extract-content";
import {
    DEFAULT_INTRO_BLOCKS_TO_SKIP,
    isEarlyStageGettingStarted,
    isLaterStageOrPrereqHeavy,
    anchorContainsDistinctiveToken,
} from "../use-case/inlinks/heuristics";
import { extractTokenUsage, type TokenUsage } from "../use-case/llm-metrics";

type AnchorHint = {
    anchor: string;
    /** Topic tokens derived from destination slug (normalized). */
    slugTopicTokens?: string[];
    /** How the hint was generated (useful for debugging/telemetry). */
    source: "slug_topic";
};

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
    usage?: TokenUsage;
};

type CandidateItem = {
    url: string;
    content: string;
    score: number;
};

type UsageTotals = {
    tokensIn: number;
    tokensOut: number;
};

const emptyUsageTotals = (): UsageTotals => ({
    tokensIn: 0,
    tokensOut: 0,
});

const addUsageToTotals = (
    totals: UsageTotals,
    usage: TokenUsage | null | undefined,
): void => {
    if (!usage) {
        return;
    }

    const tokensIn = usage.tokensIn ?? 0;
    const tokensOut = usage.tokensOut ?? 0;

    totals.tokensIn += Number.isFinite(tokensIn) ? tokensIn : 0;
    totals.tokensOut += Number.isFinite(tokensOut) ? tokensOut : 0;
};

const toTokenUsage = (totals: UsageTotals): TokenUsage | undefined => {
    if (totals.tokensIn <= 0 && totals.tokensOut <= 0) {
        return undefined;
    }

    return {
        tokensIn: totals.tokensIn > 0 ? totals.tokensIn : undefined,
        tokensOut: totals.tokensOut > 0 ? totals.tokensOut : undefined,
        totalTokens: totals.tokensIn + totals.tokensOut,
    };
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

const FitJudgeSchema = z.object({
    ok: z.boolean(),
    reason: z.string().min(1),
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

    analysisMetas: Annotation<
        Array<{ url: string; title?: string; h1?: string; canonicalUrl?: string }>
    >({
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
    usageTotals: Annotation<UsageTotals>({
        reducer: (a, b) => ({
            tokensIn: (a?.tokensIn ?? 0) + (b?.tokensIn ?? 0),
            tokensOut: (a?.tokensOut ?? 0) + (b?.tokensOut ?? 0),
        }),
        default: emptyUsageTotals,
    }),
});

type StrategistInlinksBlockState = typeof AgentState.State;

const llm = new ChatOpenAI({
    model: "gpt-4o-mini",
    temperature: 0,
});

// Cheap final judge to validate whether the insertion "fits" the block context.
// Keep temperature at 0 for determinism and avoid verbosity.
const fitJudgeLlm = new ChatOpenAI({
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

const fetchMany = async (urls: string[], concurrency = 5): Promise<string[]> => {
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

const fetchManyMetadata = async (
    urls: string[],
    concurrency = 5,
): Promise<
    Array<{ url: string; title?: string; h1?: string; canonicalUrl?: string }>
> => {
    const results: Array<{
        url: string;
        title?: string;
        h1?: string;
        canonicalUrl?: string;
    }> = new Array(urls.length);
    let cursor = 0;

    const workers = Array.from({ length: concurrency }).map(async () => {
        while (cursor < urls.length) {
            const index = cursor++;
            const url = urls[index];
            if (!url) {
                results[index] = { url: "" };
                continue;
            }

            try {
                const meta = await extractMetadataFromUrl(url);
                results[index] = {
                    url,
                    title: meta.title,
                    h1: meta.h1,
                    canonicalUrl: meta.canonicalUrl,
                };
            } catch (err) {
                console.warn(
                    "Falha ao extrair metadados da URL candidata:",
                    url,
                    err,
                );
                results[index] = { url };
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
    const metas = await fetchManyMetadata(state.analysisUrls, 5);
    return { analysisContents: contents, analysisMetas: metas };
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

const BLOCK_RERANK_TOP_K = 12;
const MAX_BLOCK_EMBEDDINGS = 200;

const rerankBlocksByEmbeddings = async (input: {
    candidateContent: string;
    blocks: PrincipalBlock[];
    topK: number;
    maxBlocks: number;
}): Promise<Array<{ block: PrincipalBlock; score: number }>> => {
    const topK = Math.max(1, Math.floor(input.topK));
    const maxBlocks = Math.max(1, Math.floor(input.maxBlocks));

    const blocks = input.blocks.slice(0, maxBlocks);
    if (blocks.length === 0) return [];

    const [candidateEmbedding] = await embedBatch([input.candidateContent]);
    if (!candidateEmbedding) return [];

    // Embed blocks in batch
    const blockEmbeddings = await embedBatch(blocks.map((b) => b.text));

    const scored = blocks
        .map((block, i) => {
            const emb = blockEmbeddings[i] ?? [];
            const score = cosineSimilarity(candidateEmbedding, emb);
            return { block, score };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);

    return scored;
};

const escapeRegExp = (value: string): string =>
    value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const insertSingleMarkdownLinkProgrammatically = (input: {
    blockText: string;
    anchorText: string;
    url: string;
}): string | null => {
    const blockText = input.blockText;
    const anchorText = input.anchorText.trim();
    const url = input.url.trim();

    if (!blockText.trim() || !anchorText || !url) return null;

    // If already has any markdown link, do not touch (respect "one link per block" & preserve existing links policy).
    if (/\[[^\]]+\]\(([^)]+)\)/.test(blockText)) return null;

    // If the anchor already appears as plain text in the block, wrap the first occurrence.
    const re = new RegExp(`\\b${escapeRegExp(anchorText)}\\b`, "i");
    if (re.test(blockText)) {
        return blockText.replace(re, `[${anchorText}](${url})`);
    }

    // Otherwise, append a short, natural sentence at the end.
    const suffix =
        blockText.endsWith(".") ||
        blockText.endsWith("!") ||
        blockText.endsWith("?")
            ? " "
            : ". ";
    return `${blockText}${suffix}Se você quiser se aprofundar, confira [${anchorText}](${url}).`;
};

const ensureNoHtmlAnchors = (text: string): boolean => {
    // Disallow HTML anchors; we want Markdown link only.
    return !/<a\s+[^>]*href\s*=/i.test(text);
};

const judgeFitForBlock = async (input: {
    principalUrl: string;
    candidateUrl: string;
    candidateTitle?: string;
    candidateH1?: string;
    anchorText: string;
    originalBlockText: string;
    modifiedBlockText: string;
}): Promise<{ ok: boolean; reason: string; usage?: TokenUsage | null }> => {
    // Quick, cheap hard checks before LLM:
    if (!ensureNoHtmlAnchors(input.modifiedBlockText)) {
        return {
            ok: false,
            reason: "Inserção rejeitada: o bloco modificado contém HTML (<a href=...>), permitido apenas Markdown.",
            usage: null,
        };
    }

    // LLM judge:
    // - Validate semantic fit (does the link make sense at this point?)
    // - Validate that the modification preserves meaning and doesn't add unrelated CTA noise
    // - Validate that the anchor phrase matches the destination topic
    const prompt = [
        "Você é um revisor sênior de SEO/editoria.",
        "Avalie se a inserção do link faz sentido DENTRO do bloco, sem desviar a intenção e sem ficar artificial.",
        "",
        "Regras de aprovação:",
        "- O bloco modificado deve manter o sentido original.",
        "- O link deve ser contextualmente relevante para o bloco (encaixe natural).",
        "- A âncora deve representar bem o destino.",
        "- Se parecer 'forçado', 'robótico' ou 'call to action' inadequado para o parágrafo, rejeite.",
        "",
        `URL Pilar: ${input.principalUrl}`,
        `URL Destino: ${input.candidateUrl}`,
        input.candidateTitle ? `Destino title: ${input.candidateTitle}` : "",
        input.candidateH1 ? `Destino h1: ${input.candidateH1}` : "",
        "",
        `Âncora: ${input.anchorText}`,
        "",
        "BLOCO ORIGINAL:",
        input.originalBlockText,
        "",
        "BLOCO MODIFICADO:",
        input.modifiedBlockText,
        "",
        "Responda SOMENTE com JSON válido:",
        `{"ok": boolean, "reason": "..."}`,
    ]
        .filter(Boolean)
        .join("\n");

    const response = await fitJudgeLlm.invoke([
        { role: "system", content: "Responda apenas JSON válido." },
        { role: "user", content: prompt },
    ]);
    const usage = extractTokenUsage(response);

    const raw = typeof response.content === "string" ? response.content : "";
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const parsedJson = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    const parsed = parsedJson ? FitJudgeSchema.safeParse(parsedJson) : null;

    if (!parsed?.success) {
        return {
            ok: false,
            reason: "Inserção rejeitada: verificador final retornou JSON inválido.",
            usage,
        };
    }

    return {
        ...parsed.data,
        usage,
    };
};

const normalizeForSlug = (value: string): string =>
    value
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\u00a0/g, " ")
        .replace(/[^a-z0-9\s-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();

const SLUG_STOPWORDS = new Set([
    "como",
    "abrir",
    "abertura",
    "uma",
    "um",
    "de",
    "da",
    "do",
    "dos",
    "das",
    "e",
    "para",
    "por",
    "no",
    "na",
    "nos",
    "nas",
    "sua",
    "seu",
    "empresa",
    "empresas",
    "negocio",
    "negocios",
    "blog",
    "guia",
    "completo",
    "passo",
    "passos",
    "primeiros",
    "dicas",
]);

const SLUG_INTENT_TOKENS = new Set([
    "roadmap",
    "curriculo",
    "currículo",
    "qual",
    "quais",
    "melhor",
    "facil",
    "fácil",
]);

const tokenizeSlug = (slug: string): string[] =>
    slug
        .split("-")
        .map((t) => normalizeForSlug(t))
        .map((t) => t.trim())
        .filter(Boolean);

/**
 * Extracts 1-2 (sometimes 3) tokens from the destination slug as a "topic noun phrase".
 * Example:
 * - /como-abrir-uma-loja-virtual/ => ["loja","virtual"]
 * - /como-abrir-um-restaurante/ => ["restaurante"]
 */
const extractTopicFromSatelliteSlug = (url: string): string[] | null => {
    try {
        const u = new URL(url);
        const parts = u.pathname
            .split("/")
            .map((p) => p.trim())
            .filter(Boolean);

        const slug = parts[parts.length - 1] ?? "";
        if (!slug) return null;

        const rawTokens = tokenizeSlug(slug);
        const tokens = rawTokens.filter((t) => t.length > 2);

        const contentTokens = tokens.filter(
            (t) => !SLUG_STOPWORDS.has(t) && !SLUG_INTENT_TOKENS.has(t),
        );
        if (contentTokens.length === 0) return null;

        // Prefer 1-3 tokens from the tail (topic noun phrase).
        // Examples:
        // - "como-abrir-uma-loja-virtual" => ["loja","virtual"]
        // - "abrir-uma-agencia-de-viagens" => ["agencia","viagens"]
        // - "qual-a-linguagem-de-programacao-mais-facil-python" => ["python"]
        const maxLen = Math.min(3, contentTokens.length);
        const tail = contentTokens.slice(contentTokens.length - maxLen);

        if (tail.length === 1) return tail;

        // If tail is 3 tokens, keep last 2
        if (tail.length === 3) return tail.slice(1);

        // Otherwise keep 2 tokens
        return tail;
    } catch {
        return null;
    }
};

const inferSlugIntent = (
    url: string,
): "how_to" | "which" | "roadmap" | "curriculum" | "generic" => {
    try {
        const u = new URL(url);
        const parts = u.pathname
            .split("/")
            .map((p) => p.trim())
            .filter(Boolean);
        const slug = parts[parts.length - 1] ?? "";
        const t = slug.toLowerCase();

        if (t.startsWith("como-")) return "how_to";
        if (t.startsWith("qual-") || t.startsWith("quais-")) return "which";
        if (t.includes("roadmap")) return "roadmap";
        if (t.includes("curriculo") || t.includes("curr%C3%ADculo"))
            return "curriculum";
        return "generic";
    } catch {
        return "generic";
    }
};

const normalizeAnchorForMatch = (value: string): string =>
    normalizeForSlug(value).replace(/\s+/g, " ").trim();

const anchorContainsTopicTokens = (
    anchor: string,
    topicTokens: string[],
): boolean => {
    const a = ` ${normalizeAnchorForMatch(anchor)} `;
    const tokens = topicTokens.map(normalizeAnchorForMatch).filter(Boolean);
    if (tokens.length === 0) return false;

    // Require all topic tokens to appear (higher precision).
    return tokens.every((t) => a.includes(` ${t} `));
};

const joinTopicPtBr = (topicTokens: string[]): string => {
    // Keep it simple & deterministic; allow "de" in some common phrases when obvious.
    // We'll re-inject "de" for "agencia viagens" -> "agência de viagens"
    const tokens = topicTokens.map(normalizeAnchorForMatch).filter(Boolean);
    if (
        tokens.length === 2 &&
        tokens[0] === "agencia" &&
        tokens[1] === "viagens"
    ) {
        return "agência de viagens";
    }
    if (tokens.length === 2 && tokens[0] === "loja" && tokens[1] === "virtual") {
        return "loja virtual";
    }
    return tokens.join(" ");
};

const chooseIndefiniteArticlePtBr = (topic: string): "um" | "uma" => {
    // Heuristic: many feminine nouns end with 'a'. Not perfect, but better than nothing.
    const t = normalizeAnchorForMatch(topic);
    if (t.endsWith("a")) return "uma";
    return "um";
};

const chooseIndefiniteArticleForTopicTokensPtBr = (
    topicTokens: string[],
): "um" | "uma" => {
    // Prefer the "head noun" (first token) when topic has multiple words:
    // - "loja virtual" -> head "loja" -> "uma"
    // - "agência de viagens" -> head "agência" -> "uma"
    // Fallback to the full topic string when no tokens.
    const head = topicTokens[0] ?? "";
    return chooseIndefiniteArticlePtBr(head || topicTokens.join(" "));
};

const buildSuggestedAnchorFromTopic = (input: {
    url: string;
    topicTokens: string[];
}): AnchorHint | null => {
    const topicTokens = input.topicTokens;
    const topic = joinTopicPtBr(topicTokens);
    if (!topic) return null;

    const intent = inferSlugIntent(input.url);

    // Template by intent to avoid nonsense anchors (e.g., "como abrir" on "qual-a-linguagem...")
    if (intent === "roadmap") {
        return {
            anchor: "roadmap de programação",
            slugTopicTokens: topicTokens,
            source: "slug_topic",
        };
    }

    if (intent === "curriculum") {
        return {
            anchor: "currículo para programação",
            slugTopicTokens: topicTokens,
            source: "slug_topic",
        };
    }

    if (intent === "which") {
        // If we have a clear tail token like "python", build a specific anchor.
        // Otherwise fall back to a generic, still-coherent anchor.
        if (topicTokens.length >= 1) {
            const last = normalizeAnchorForMatch(
                topicTokens[topicTokens.length - 1] ?? "",
            );
            if (last) {
                return {
                    anchor: `linguagem de programação mais fácil (${last})`,
                    slugTopicTokens: topicTokens,
                    source: "slug_topic",
                };
            }
        }
        return {
            anchor: "melhor linguagem para iniciantes",
            slugTopicTokens: topicTokens,
            source: "slug_topic",
        };
    }

    // Default to "how-to" style only when the slug suggests it.
    const article = chooseIndefiniteArticleForTopicTokensPtBr(topicTokens);

    if (intent === "how_to" || intent === "generic") {
        const anchor =
            topicTokens.length >= 2
                ? `como começar com ${topic}`
                : `como começar com ${topic}`;

        // For business "abrir X" slugs, keep the prior proven pattern.
        // If the slug actually contains "abrir", prefer "como abrir".
        const slugLower = (() => {
            try {
                const u = new URL(input.url);
                const parts = u.pathname.split("/").filter(Boolean);
                return (parts[parts.length - 1] ?? "").toLowerCase();
            } catch {
                return "";
            }
        })();

        const preferAbrir = slugLower.includes("abrir");
        if (preferAbrir) {
            const abrirAnchor =
                topicTokens.length >= 2
                    ? `como abrir ${article} ${topic}`
                    : `abrir ${article} ${topic}`;
            return {
                anchor: abrirAnchor,
                slugTopicTokens: topicTokens,
                source: "slug_topic",
            };
        }

        return { anchor, slugTopicTokens: topicTokens, source: "slug_topic" };
    }

    // fallback
    return {
        anchor: `como começar com ${topic}`,
        slugTopicTokens: topicTokens,
        source: "slug_topic",
    };
};

const pickBestBlockPreferTopic = (input: {
    blocks: PrincipalBlock[];
    candidateContent: string;
    slugTopicTokens?: string[] | null;
}): PrincipalBlock | null => {
    const slugTopicTokens = input.slugTopicTokens ?? null;

    if (slugTopicTokens && slugTopicTokens.length > 0) {
        const topicPhrase = normalizeAnchorForMatch(slugTopicTokens.join(" "));
        const topicParts = slugTopicTokens
            .map(normalizeAnchorForMatch)
            .filter(Boolean);

        // Prefer blocks that mention all topic tokens (highest precision)
        const byAllTokens = input.blocks.filter((b) => {
            const bt = ` ${normalizeAnchorForMatch(b.text)} `;
            return topicParts.every((t) => bt.includes(` ${t} `));
        });
        if (byAllTokens.length > 0) {
            return pickBestBlock(byAllTokens, input.candidateContent);
        }

        // Next: mention the topic phrase
        const byPhrase = input.blocks.filter((b) =>
            normalizeAnchorForMatch(b.text).includes(topicPhrase),
        );
        if (byPhrase.length > 0) {
            return pickBestBlock(byPhrase, input.candidateContent);
        }
    }

    return pickBestBlock(input.blocks, input.candidateContent);
};

const pickBestBlockWithEmbeddingRerank = async (input: {
    blocks: PrincipalBlock[];
    candidateContent: string;
    slugTopicTokens?: string[] | null;
}): Promise<PrincipalBlock | null> => {
    const topCandidates = await rerankBlocksByEmbeddings({
        candidateContent: input.candidateContent,
        blocks: input.blocks,
        topK: BLOCK_RERANK_TOP_K,
        maxBlocks: MAX_BLOCK_EMBEDDINGS,
    });

    if (topCandidates.length === 0) {
        return pickBestBlockPreferTopic(input);
    }

    // Among top-K embedding blocks, prefer topic matches for editorial precision
    const topBlocks = topCandidates.map((c) => c.block);
    return pickBestBlockPreferTopic({
        blocks: topBlocks,
        candidateContent: input.candidateContent,
        slugTopicTokens: input.slugTopicTokens,
    });
};

/**
 * Strategic guardrails
 *
 * Implemented using shared, pure heuristics from `src/use-case/inlinks/heuristics.ts`
 * to avoid duplication and keep behavior consistent across the codebase.
 */
const INTRO_BLOCKS_TO_SKIP = DEFAULT_INTRO_BLOCKS_TO_SKIP;

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

// (removed duplicate slug-topic helpers block; the canonical implementation exists earlier in this file)

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
    const usageTotals = emptyUsageTotals();

    const hasBlocks = (state.principalBlocks?.length ?? 0) > 0;

    // 1) Base eligibility: paragraph/list items without existing links
    const eligibleBlocksBase = hasBlocks
        ? (state.principalBlocks ?? []).filter(
              (b) =>
                  (b.type === "paragraph" || b.type === "list_item") &&
                  !b.containsLink,
          )
        : [];

    // 2) Intro protection: skip the first N eligible blocks.
    // This prevents early "leak" links before the pillar establishes context.
    const eligibleBlocks =
        eligibleBlocksBase.length > INTRO_BLOCKS_TO_SKIP
            ? eligibleBlocksBase.slice(INTRO_BLOCKS_TO_SKIP)
            : [];

    if (
        hasBlocks &&
        eligibleBlocksBase.length > 0 &&
        eligibleBlocks.length === 0
    ) {
        // If we had blocks but all are in the intro "protected zone", we still proceed,
        // but we will reject everything due to no eligible blocks.
        // This is preferable to inserting links in the introduction.
    }

    const maxLinks = computeMaxLinks(state.principalContent, state.maxLinks);

    // Detect pillar stage (getting-started). Used to guard against inserting
    // later-stage/advanced actions into beginner/introduction contexts.
    const pillarIsEarlyStage = isEarlyStageGettingStarted(state.principalContent);

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
                reason: "Pipeline por blocos não disponível (principalBlocks ausente). Use o modo legado ou forneça blocks.",
                score: candidate.score,
            });
            continue;
        }

        if (eligibleBlocks.length === 0) {
            rejected.push({
                url: candidate.url,
                reason: "Não há blocos elegíveis fora da introdução (parágrafos/listas sem links) para inserir novos links.",
                score: candidate.score,
            });
            continue;
        }

        // Journey guardrail: if the pillar is "getting started", avoid candidates that are clearly later-stage
        // or require prerequisites that the user likely doesn't have yet.
        if (pillarIsEarlyStage && isLaterStageOrPrereqHeavy(candidate.content)) {
            rejected.push({
                url: candidate.url,
                reason: "Candidato rejeitado por possível desalinhamento com a jornada do usuário (conteúdo avançado/pré-requisitos) para um pilar de início/passos iniciais.",
                score: candidate.score,
            });
            continue;
        }

        const slugTopicTokens = extractTopicFromSatelliteSlug(candidate.url);
        const anchorHint = slugTopicTokens
            ? buildSuggestedAnchorFromTopic({
                  url: candidate.url,
                  topicTokens: slugTopicTokens,
              })
            : null;

        const meta =
            (state.analysisMetas ?? []).find((m) => m.url === candidate.url) ??
            undefined;

        // Prefer a block that hasn't been used yet. If the best block is already used,
        // fall back to the next best by a simple retry strategy:
        // - temporarily filter used blocks and pick again.
        const remainingBlocks = eligibleBlocks.filter(
            (b) => !usedBlockIds.has(b.id),
        );
        const bestBlock = await pickBestBlockWithEmbeddingRerank({
            blocks: remainingBlocks.length > 0 ? remainingBlocks : eligibleBlocks,
            candidateContent: candidate.content,
            slugTopicTokens,
        });

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
                reason: "Bloco alvo já utilizado por outro link (evitando múltiplas alterações no mesmo parágrafo/item).",
                score: candidate.score,
            });
            continue;
        }

        const prompt = [
            "Atue como um Especialista Sênior em SEO e Link Building.",
            "Sua missão é inserir um link interno natural no conteúdo do Artigo Pilar,",
            "mas SOMENTE dentro de UM bloco (parágrafo ou item de lista) fornecido.",
            "",
            "MODO 2-STEP:",
            "1) A âncora deve ser DETERMINÍSTICA quando fornecida (não invente outra).",
            "2) Seu trabalho é encaixar o link com a âncora fornecida dentro do bloco, preservando o sentido.",
            "",
            "REGRAS CRÍTICAS:",
            "1) Você pode reescrever o bloco, MAS deve preservar o sentido original.",
            "2) Insira exatamente UM link em Markdown no formato: [texto âncora](url).",
            "3) Insira SOMENTE 1 link. Não use HTML (<a href=...>), apenas Markdown.",
            "4) Não adicione novos fatos. Não invente números.",
            "5) Se não houver inserção natural no bloco fornecido, responda ok:false.",
            ...(meta?.title || meta?.h1 || meta?.canonicalUrl
                ? [
                      "",
                      "METADADOS DO DESTINO (para coerência semântica):",
                      meta?.title ? `title: ${meta.title}` : "",
                      meta?.h1 ? `h1: ${meta.h1}` : "",
                      meta?.canonicalUrl ? `canonical: ${meta.canonicalUrl}` : "",
                  ].filter(Boolean)
                : []),
            ...(anchorHint
                ? [
                      "",
                      "ÂNCORA DETERMINÍSTICA (use exatamente este texto como âncora, sem modificar):",
                      anchorHint.anchor,
                  ]
                : []),
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
            const invokeOnce = async (extraInstruction?: string) => {
                const retryPrompt = extraInstruction
                    ? [
                          prompt,
                          "",
                          "INSTRUÇÃO EXTRA (RETRY):",
                          extraInstruction,
                      ].join("\n")
                    : prompt;
                return llm.invoke([
                    { role: "system", content: "Responda apenas JSON válido." },
                    { role: "user", content: retryPrompt },
                ]);
            };

            const response = await invokeOnce();
            addUsageToTotals(usageTotals, extractTokenUsage(response));

            const raw =
                typeof response.content === "string" ? response.content : "";
            const jsonMatch = raw.match(/\{[\s\S]*\}/);
            const parsedJson = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
            const parsed = parsedJson
                ? DecisionSchema.safeParse(parsedJson)
                : null;

            let decision: z.infer<typeof DecisionSchema> | null = null;

            if (parsed?.success) {
                decision = parsed.data;
            } else {
                // Single retry: ask for strictly valid JSON only.
                const retryJsonResponse = await invokeOnce(
                    "Sua resposta anterior não era JSON válido. Responda SOMENTE com JSON válido seguindo exatamente o schema solicitado, sem texto extra.",
                );
                addUsageToTotals(
                    usageTotals,
                    extractTokenUsage(retryJsonResponse),
                );
                const retryRaw =
                    typeof retryJsonResponse.content === "string"
                        ? retryJsonResponse.content
                        : "";
                const retryJsonMatch = retryRaw.match(/\{[\s\S]*\}/);
                const retryParsedJson = retryJsonMatch
                    ? JSON.parse(retryJsonMatch[0])
                    : null;
                const retryParsed = retryParsedJson
                    ? DecisionSchema.safeParse(retryParsedJson)
                    : null;

                if (!retryParsed?.success) {
                    // Fallback programático (sem LLM): se existe âncora determinística, tenta inserir no bloco de forma segura.
                    if (anchorHint?.anchor) {
                        const modified = insertSingleMarkdownLinkProgrammatically(
                            {
                                blockText: bestBlock.text,
                                anchorText: anchorHint.anchor,
                                url: candidate.url,
                            },
                        );

                        if (
                            modified &&
                            ensureSingleMarkdownLink(modified, candidate.url)
                        ) {
                            const anchorText = anchorHint.anchor;
                            edits.push({
                                blockId: bestBlock.id,
                                targetUrl: candidate.url,
                                anchor: anchorText,
                                originalBlockText: bestBlock.text,
                                modifiedBlockText: modified,
                                overwriteBlock: true,
                                justification:
                                    "Fallback programático aplicado (LLM retornou JSON inválido).",
                                metrics: { relevance: 0, authority: 0 },
                            });

                            usedUrls.add(candidate.url);
                            usedBlockIds.add(bestBlock.id);
                            usedAnchorsNormalized.add(
                                anchorText
                                    .toLowerCase()
                                    .replace(/\u00a0/g, " ")
                                    .replace(/\s+/g, " ")
                                    .trim(),
                            );

                            continue;
                        }
                    }

                    rejected.push({
                        url: candidate.url,
                        reason: "Falha ao validar a resposta do modelo (JSON inválido) mesmo após retry.",
                        score: candidate.score,
                    });
                    continue;
                }

                decision = retryParsed.data;
            }

            if (!decision) {
                rejected.push({
                    url: candidate.url,
                    reason: "Falha ao validar a resposta do modelo (decisão ausente).",
                    score: candidate.score,
                });
                continue;
            }

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
                    reason: "Modelo não copiou o texto original do bloco exatamente (auditoria falhou).",
                    score: candidate.score,
                });
                continue;
            }

            // Ensure exactly one markdown link to the expected URL
            if (
                !ensureSingleMarkdownLink(
                    decision.modified_block_text,
                    candidate.url,
                )
            ) {
                // Single retry: ask the model to fix only the formal constraint (exactly one Markdown link to the expected URL)
                const retry = await invokeOnce(
                    [
                        "Corrija SOMENTE o campo modified_block_text para conter exatamente 1 link em Markdown apontando para a URL candidata.",
                        "Não adicione nenhum outro link.",
                        "Não use HTML.",
                        "Mantenha a âncora descritiva e preserve o sentido do bloco.",
                        `A URL do link deve ser exatamente: ${candidate.url}`,
                    ].join(" "),
                );
                addUsageToTotals(usageTotals, extractTokenUsage(retry));
                const retryRaw =
                    typeof retry.content === "string" ? retry.content : "";
                const retryJsonMatch = retryRaw.match(/\{[\s\S]*\}/);
                const retryParsedJson = retryJsonMatch
                    ? JSON.parse(retryJsonMatch[0])
                    : null;
                const retryParsed = retryParsedJson
                    ? DecisionSchema.safeParse(retryParsedJson)
                    : null;

                if (!retryParsed?.success) {
                    // Fallback programático (sem LLM): se existe âncora determinística, tenta inserir no bloco de forma segura.
                    if (anchorHint?.anchor) {
                        const modified = insertSingleMarkdownLinkProgrammatically(
                            {
                                blockText: bestBlock.text,
                                anchorText: anchorHint.anchor,
                                url: candidate.url,
                            },
                        );

                        if (
                            modified &&
                            ensureSingleMarkdownLink(modified, candidate.url)
                        ) {
                            const anchorText = anchorHint.anchor;

                            // Final fit judge
                            const fit = await judgeFitForBlock({
                                principalUrl: state.principalUrl,
                                candidateUrl: candidate.url,
                                candidateTitle: meta?.title,
                                candidateH1: meta?.h1,
                                anchorText,
                                originalBlockText: bestBlock.text,
                                modifiedBlockText: modified,
                            });
                            addUsageToTotals(usageTotals, fit.usage);

                            if (!fit.ok) {
                                rejected.push({
                                    url: candidate.url,
                                    reason: `Inserção rejeitada pelo verificador final (fallback): ${fit.reason}`,
                                    score: candidate.score,
                                });
                                continue;
                            }

                            edits.push({
                                blockId: bestBlock.id,
                                targetUrl: candidate.url,
                                anchor: anchorText,
                                originalBlockText: bestBlock.text,
                                modifiedBlockText: modified,
                                overwriteBlock: true,
                                justification:
                                    "Fallback programático aplicado (LLM retornou JSON inválido).",
                                metrics: { relevance: 0, authority: 0 },
                            });

                            usedUrls.add(candidate.url);
                            usedBlockIds.add(bestBlock.id);
                            usedAnchorsNormalized.add(
                                anchorText
                                    .toLowerCase()
                                    .replace(/\u00a0/g, " ")
                                    .replace(/\s+/g, " ")
                                    .trim(),
                            );

                            continue;
                        }
                    }

                    rejected.push({
                        url: candidate.url,
                        reason: "Falha ao validar a resposta do modelo no retry (JSON inválido).",
                        score: candidate.score,
                    });
                    continue;
                }

                const retryDecision = retryParsed.data;

                if (
                    !retryDecision.ok ||
                    retryDecision.block_id !== bestBlock.id ||
                    retryDecision.original_block_text.trim() !==
                        bestBlock.text.trim() ||
                    !ensureSingleMarkdownLink(
                        retryDecision.modified_block_text,
                        candidate.url,
                    ) ||
                    !retryDecision.modified_block_text.includes(
                        `[${retryDecision.anchor}](`,
                    )
                ) {
                    // Fallback programático (sem LLM): se existe âncora determinística, tenta inserir no bloco de forma segura.
                    if (anchorHint?.anchor) {
                        const modified = insertSingleMarkdownLinkProgrammatically(
                            {
                                blockText: bestBlock.text,
                                anchorText: anchorHint.anchor,
                                url: candidate.url,
                            },
                        );

                        if (
                            modified &&
                            ensureSingleMarkdownLink(modified, candidate.url)
                        ) {
                            const anchorText = anchorHint.anchor;

                            // Final fit judge
                            const fit = await judgeFitForBlock({
                                principalUrl: state.principalUrl,
                                candidateUrl: candidate.url,
                                candidateTitle: meta?.title,
                                candidateH1: meta?.h1,
                                anchorText,
                                originalBlockText: bestBlock.text,
                                modifiedBlockText: modified,
                            });
                            addUsageToTotals(usageTotals, fit.usage);

                            if (!fit.ok) {
                                rejected.push({
                                    url: candidate.url,
                                    reason: `Inserção rejeitada pelo verificador final (fallback): ${fit.reason}`,
                                    score: candidate.score,
                                });
                                continue;
                            }

                            edits.push({
                                blockId: bestBlock.id,
                                targetUrl: candidate.url,
                                anchor: anchorText,
                                originalBlockText: bestBlock.text,
                                modifiedBlockText: modified,
                                overwriteBlock: true,
                                justification:
                                    "Fallback programático aplicado (LLM falhou ao cumprir a regra formal de markdown).",
                                metrics: { relevance: 0, authority: 0 },
                            });

                            usedUrls.add(candidate.url);
                            usedBlockIds.add(bestBlock.id);
                            usedAnchorsNormalized.add(
                                anchorText
                                    .toLowerCase()
                                    .replace(/\u00a0/g, " ")
                                    .replace(/\s+/g, " ")
                                    .trim(),
                            );

                            continue;
                        }
                    }

                    rejected.push({
                        url: candidate.url,
                        reason: "Retry não conseguiu cumprir a regra formal do link Markdown único para a URL candidata.",
                        score: candidate.score,
                    });
                    continue;
                }

                // Replace decision with retryDecision (now compliant)
                decision.ok = retryDecision.ok;
                decision.anchor = retryDecision.anchor;
                decision.modified_block_text = retryDecision.modified_block_text;
                decision.reason = retryDecision.reason;
                decision.seo_metrics = retryDecision.seo_metrics;
            }

            // Ensure anchor appears inside the markdown link text
            if (!decision.modified_block_text.includes(`[${decision.anchor}](`)) {
                rejected.push({
                    url: candidate.url,
                    reason: "A âncora retornada precisa corresponder ao texto do link em Markdown.",
                    score: candidate.score,
                });
                continue;
            }

            // Enforce descriptive anchors (reject generic/low-signal anchors)
            if (isGenericAnchor(decision.anchor)) {
                rejected.push({
                    url: candidate.url,
                    reason: "Âncora rejeitada por ser genérica/ambígua. Use uma âncora descritiva (2-6 palavras) alinhada ao tema da URL candidata.",
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
                    reason: "Âncora rejeitada por baixa aderência temática ao conteúdo candidato (overlap de termos insuficiente). Use 2-6 palavras com termos que apareçam no conteúdo candidato.",
                    score: candidate.score,
                });
                continue;
            }

            // Stronger anchor ↔ destination coherence:
            // require at least one distinctive token from the candidate content to appear in the anchor.
            // This helps avoid anchors like "processo de abertura de empresa" pointing to very specific pages (e.g., CNAE).
            // Prefer slug-topic validation over "distinctive tokens":
            // If we can extract a topic from the satellite URL slug, it is a stronger and more direct signal.
            // In that case, we accept anchors that contain the slug-topic even if "distinctive token" heuristics are noisy.
            if (slugTopicTokens) {
                if (
                    !anchorContainsTopicTokens(decision.anchor, slugTopicTokens)
                ) {
                    rejected.push({
                        url: candidate.url,
                        reason: `Âncora rejeitada por não conter o tópico principal do destino (${slugTopicTokens.join(
                            " ",
                        )}) extraído do slug. Ajuste a âncora para incluir esse termo.`,
                        score: candidate.score,
                    });
                    continue;
                }
            } else {
                // No slug-topic available: fall back to token-level distinctiveness heuristics
                if (
                    !anchorContainsDistinctiveToken(
                        decision.anchor,
                        candidate.content,
                    )
                ) {
                    rejected.push({
                        url: candidate.url,
                        reason: "Âncora rejeitada por baixa correspondência semântica com o destino (faltam termos distintivos do conteúdo candidato na âncora). Ajuste a âncora para refletir o tópico específico da URL de destino.",
                        score: candidate.score,
                    });
                    continue;
                }
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
                    reason: "Âncora já utilizada anteriormente (evitando repetição e melhorando a variedade semântica).",
                    score: candidate.score,
                });
                continue;
            }

            // Hard rule (again): prevent multiple edits on the same block even if LLM drifted
            if (usedBlockIds.has(decision.block_id)) {
                rejected.push({
                    url: candidate.url,
                    reason: "Bloco já utilizado por outro link (evitando múltiplas alterações no mesmo bloco).",
                    score: candidate.score,
                });
                continue;
            }

            const finalFit = await judgeFitForBlock({
                principalUrl: state.principalUrl,
                candidateUrl: candidate.url,
                candidateTitle: meta?.title,
                candidateH1: meta?.h1,
                anchorText: decision.anchor,
                originalBlockText: decision.original_block_text,
                modifiedBlockText: decision.modified_block_text,
            });
            addUsageToTotals(usageTotals, finalFit.usage);

            if (!finalFit.ok) {
                rejected.push({
                    url: candidate.url,
                    reason: `Inserção rejeitada pelo verificador final: ${finalFit.reason}`,
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

    return { edits, rejected, usageTotals };
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
                    (b.type === "paragraph" || b.type === "list_item") &&
                    !b.containsLink,
            ).length,
        },
        usage: toTokenUsage(result.usageTotals ?? emptyUsageTotals()),
    };
};
