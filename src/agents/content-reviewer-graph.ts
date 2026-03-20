import { z } from "zod";
import { ChatOpenAI } from "@langchain/openai";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import * as cheerio from "cheerio";
import { extractPageBundleFromUrl } from "../use-case/extract-content";

export type ContentReviewItem = {
    url: string;
    contentType: "blog" | "copy" | "descricao";
    primaryKeyword: string;
    supportingKeywords: string[];
    expectedWordCount: number;
    outline: string[];
    cta: string;
    personaPain: string;
    internalLinksTarget?: number;
    maxInternalLinks?: number;
    titleTagExpected?: string;
};

export type ContentReviewInput = {
    items: ContentReviewItem[];
    /** Optional high-level guidance for the reviewer. */
    guidelines?: string;
};

export type ContentReviewDecision = {
    url: string;
    status: "approved" | "rejected" | "error";
    reason: string;
};

export type ContentReviewResult = {
    results: ContentReviewDecision[];
    total: number;
    approved: number;
    rejected: number;
    errors: number;
};

const DecisionSchema = z.object({
    status: z.enum(["approved", "rejected", "error"]),
    reason: z.string().min(1),
});

const SubjectiveSchema = z.object({
    ok: z.boolean(),
    reason: z.string().min(1),
});

const AgentState = Annotation.Root({
    items: Annotation<ContentReviewItem[]>(),
    guidelines: Annotation<string | undefined>(),
    currentIndex: Annotation<number | undefined>(),
    results: Annotation<ContentReviewDecision[]>({
        reducer: (a, b) => a.concat(b),
        default: () => [],
    }),
});

type ContentReviewerState = typeof AgentState.State;

const llm = new ChatOpenAI({
    model: "gpt-4o-mini",
    temperature: 0,
});

const normalizeText = (value: string): string =>
    value.toLowerCase().replace(/\s+/g, " ").trim();

const normalizeForComparison = (value: string): string =>
    normalizeText(value)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .replace(/\s+/g, " ")
        .trim();

const toComparableWords = (value: string): string[] =>
    normalizeForComparison(value)
        .split(" ")
        .map((w) => w.trim())
        .filter((w) => w.length >= 3);

const headingMatches = (expected: string, candidate: string): boolean => {
    const a = normalizeForComparison(expected);
    const b = normalizeForComparison(candidate);
    if (!a || !b) return false;
    if (a.includes(b) || b.includes(a)) return true;

    const expectedWords = toComparableWords(a);
    const candidateWords = new Set(toComparableWords(b));
    if (expectedWords.length === 0) return false;

    const overlap = expectedWords.filter((w) => candidateWords.has(w)).length;
    return overlap / expectedWords.length >= 0.65;
};

const isLikelyUrl = (value: string): boolean => {
    const trimmed = value.trim();
    if (!trimmed) return false;
    if (/^https?:\/\//i.test(trimmed)) return true;
    return /^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(trimmed);
};

const normalizeComparableUrl = (value: string): string | undefined => {
    const raw = value.trim();
    if (!raw) return undefined;
    try {
        const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
        const u = new URL(withProtocol);
        u.hash = "";
        u.search = "";
        u.pathname = u.pathname.replace(/\/+$/, "");
        return u.toString();
    } catch {
        return undefined;
    }
};

const escapeRegExp = (value: string): string =>
    value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const countWords = (value: string): number =>
    value.split(/\s+/).filter(Boolean).length;

const countOccurrences = (text: string, term: string): number => {
    const trimmed = term.trim();
    if (!trimmed) return 0;
    const pattern = new RegExp(`\\b${escapeRegExp(trimmed)}\\b`, "gi");
    return (text.match(pattern) || []).length;
};

const parseOutlineToken = (value: string): string =>
    normalizeText(value.replace(/^h\d\s*[:\-–]\s*/i, "").trim());

const parseOutlineDirective = (
    value: string,
): { level: "h1" | "h2" | "any"; text: string } => {
    const normalized = value.trim();
    const match = normalized.match(/^(h[1-6])\s*[:\-–]\s*(.+)$/i);
    if (!match) {
        return { level: "any", text: parseOutlineToken(normalized) };
    }

    const headingTag = (match[1] ?? "").toLowerCase();
    const level = headingTag === "h1" ? "h1" : headingTag === "h2" ? "h2" : "any";
    return {
        level,
        text: parseOutlineToken(match[2] ?? ""),
    };
};

const getHeadings = ($: cheerio.CheerioAPI) => ({
    title: normalizeText($("title").first().text() || ""),
    h1: normalizeText($("h1").first().text() || ""),
    h1Count: $("h1").length,
    h2: $("h2")
        .map((_, el) => normalizeText($(el).text()))
        .get()
        .filter(Boolean),
});

const getParagraphs = ($: cheerio.CheerioAPI): string[] =>
    $("p")
        .map((_, el) => normalizeText($(el).text()))
        .get()
        .filter(Boolean);

const getInternalLinksCount = (url: string, $: cheerio.CheerioAPI): number => {
    let count = 0;
    const base = new URL(url);
    $("a[href]").each((_, el) => {
        const href = $(el).attr("href")?.trim() || "";
        if (!href || href.startsWith("#") || href.startsWith("mailto:")) return;
        try {
            const resolved = new URL(href, base);
            if (resolved.hostname === base.hostname) count += 1;
        } catch {
            return;
        }
    });
    return count;
};

const hasContentAfterH2 = ($: cheerio.CheerioAPI): boolean => {
    const h2s = $("h2").toArray();
    if (h2s.length === 0) return false;

    return h2s.every((h2) => {
        let textAfter = "";
        let next = $(h2).next();
        while (next.length > 0 && !next.is("h2")) {
            textAfter += ` ${next.text()}`;
            const nextCandidate = next.next();
            if (nextCandidate.length === 0) {
                break;
            }
            next = nextCandidate;
        }
        return normalizeText(textAfter).length > 0;
    });
};

const isLikelyGenericImageName = (src: string): boolean => {
    const filename = src.split("/").pop() ?? "";
    const base = (filename.split("?")[0] ?? "").toLowerCase();
    return (
        base.startsWith("image") ||
        base.startsWith("img") ||
        base.startsWith("screenshot") ||
        base.startsWith("photo")
    );
};

const evaluateRules = (params: {
    item: ContentReviewItem;
    text: string;
    html: string;
    metadata?: {
        title?: string;
        h1?: string;
    };
}) => {
    const failures: string[] = [];
    const text = normalizeText(params.text);
    const wordCount = countWords(text);
    const keywordCount = countOccurrences(text, params.item.primaryKeyword);
    const density = wordCount > 0 ? (keywordCount / wordCount) * 100 : 0;

    const densityRange =
        params.item.contentType === "blog"
            ? { min: 0.6, max: 1.0 }
            : { min: 1.8, max: 2.2 };

    if (density < densityRange.min || density > densityRange.max) {
        failures.push(
            `Densidade da palavra-chave fora do esperado (${density.toFixed(
                2,
            )}%).`,
        );
    }

    for (const keyword of params.item.supportingKeywords) {
        if (countOccurrences(text, keyword) === 0) {
            failures.push(`Palavra-chave de apoio ausente: ${keyword}.`);
        }
    }

    const expectedWords = params.item.expectedWordCount;
    const tolerance = expectedWords * 0.1;
    if (Math.abs(wordCount - expectedWords) > tolerance) {
        failures.push("Número de palavras fora da tolerância de 10%.");
    }

    const $ = cheerio.load(params.html);

    const headings = getHeadings($);

    const h1FromMetadata = normalizeText(params.metadata?.h1 || "");
    const titleFromMetadata = normalizeText(params.metadata?.title || "");
    const effectiveH1 = h1FromMetadata || headings.h1;
    const effectiveTitle = titleFromMetadata || headings.title;

    if (!effectiveH1) {
        failures.push("Estrutura de headings inválida (H1 ausente).");
    } else if (!h1FromMetadata && headings.h1Count !== 1) {
        failures.push("Estrutura de headings inválida (H1 duplicado).");
    }
    if (wordCount >= 600 && headings.h2.length === 0) {
        failures.push("Estrutura de headings insuficiente (H2 ausentes).");
    }

    const outlineTokens = params.item.outline.map(parseOutlineDirective);
    for (const token of outlineTokens) {
        if (!token.text) continue;

        const found =
            token.level === "h1"
                ? headingMatches(token.text, effectiveH1)
                : token.level === "h2"
                  ? headings.h2.some((h2) => headingMatches(token.text, h2))
                  : headingMatches(token.text, effectiveH1) ||
                    headings.h2.some((h2) => headingMatches(token.text, h2));

        if (!found) {
            failures.push(`Outline esperado não encontrado: ${token.text}.`);
        }
    }

    if (headings.h2.length > 0 && !hasContentAfterH2($)) {
        failures.push("Falta conteúdo após todos os H2.");
    }

    const internalLinks = getInternalLinksCount(params.item.url, $);
    const autoMinLinks =
        wordCount >= 3000 ? 6 : wordCount >= 2000 ? 4 : wordCount >= 1000 ? 3 : 0;
    const minLinks = params.item.internalLinksTarget ?? autoMinLinks;
    if (internalLinks < minLinks) {
        failures.push("Quantidade insuficiente de links internos.");
    }
    const excessiveLimit =
        params.item.maxInternalLinks ?? Math.max(10, minLinks * 3);
    if (internalLinks > excessiveLimit) {
        failures.push("Quantidade excessiva de links internos.");
    }

    const paragraphs = getParagraphs($);
    const longParagraphs = paragraphs.filter((p) => countWords(p) > 180).length;
    if (longParagraphs > 0) {
        failures.push("Escaneabilidade baixa (parágrafos muito longos).");
    }

    const images = $("img")
        .map((_, el) => $(el).attr("src")?.trim() || "")
        .get()
        .filter(Boolean);
    if (images.some((src) => isLikelyGenericImageName(src))) {
        failures.push("Imagens com nomes genéricos (não renomeadas).");
    }

    if (!effectiveTitle) {
        failures.push("Title tag ausente.");
    } else if (effectiveTitle === effectiveH1) {
        failures.push("Title tag igual ao H1.");
    } else if (
        params.item.titleTagExpected &&
        !headingMatches(params.item.titleTagExpected, effectiveTitle)
    ) {
        failures.push("Title tag não está otimizado conforme esperado.");
    }

    const ctaNormalized = normalizeText(params.item.cta);
    if (ctaNormalized) {
        if (isLikelyUrl(params.item.cta)) {
            const expectedCtaUrl = normalizeComparableUrl(params.item.cta);
            const foundCtaLink = (() => {
                if (!expectedCtaUrl) return false;
                return $("a[href]")
                    .map((_, el) => {
                        const href = ($(el).attr("href") || "").trim();
                        if (!href) return "";
                        try {
                            return normalizeComparableUrl(
                                new URL(href, params.item.url).toString(),
                            );
                        } catch {
                            return normalizeComparableUrl(href);
                        }
                    })
                    .get()
                    .filter(Boolean)
                    .some((href) => {
                        const candidate = href as string;
                        return (
                            candidate === expectedCtaUrl ||
                            candidate.startsWith(expectedCtaUrl)
                        );
                    });
            })();

            if (!foundCtaLink) {
                failures.push("CTA correto não encontrado.");
            }
        } else if (!text.includes(ctaNormalized)) {
            failures.push("CTA correto não encontrado.");
        }
    }

    return {
        failures,
        metrics: {
            wordCount,
            density,
            internalLinks,
            h1: effectiveH1,
            title: effectiveTitle,
        },
    };
};

const buildSubjectivePrompt = (params: {
    item: ContentReviewItem;
    content: string;
    h1: string;
    title: string;
    guidelines?: string;
}): string => {
    const extraGuidelines = params.guidelines?.trim();
    return [
        "Você é um revisor de conteúdo.",
        `URL: ${params.item.url}`,
        `H1: ${params.h1 || "N/A"}`,
        `Title: ${params.title || "N/A"}`,
        `Dor da persona: ${params.item.personaPain}`,
        `Palavra-chave principal: ${params.item.primaryKeyword}`,
        extraGuidelines ? `Diretrizes extras: ${extraGuidelines}` : "",
        "",
        "Verifique se o texto responde o que propõe no H1 e se está relacionado com a dor da persona.",
        "Responda com ok=true/false e um motivo objetivo.",
        "",
        "Conteúdo extraído:",
        params.content,
    ]
        .filter(Boolean)
        .join("\n");
};

const reviewNextUrl = async (
    state: ContentReviewerState,
): Promise<Partial<ContentReviewerState>> => {
    const index = state.currentIndex ?? 0;
    const items = state.items ?? [];

    if (index >= items.length) {
        return {};
    }

    const item = items[index];
    if (!item?.url) {
        return {
            currentIndex: index + 1,
            results: [
                {
                    url: item?.url ?? "",
                    status: "rejected",
                    reason: "URL inválida.",
                },
            ],
        };
    }

    try {
        const page = await extractPageBundleFromUrl(item.url);
        const rules = evaluateRules({
            item,
            text: page.text,
            html: page.html,
            metadata: page.metadata,
        });

        const prompt = buildSubjectivePrompt({
            item,
            content: page.text.slice(0, 4000),
            h1: rules.metrics.h1,
            title: rules.metrics.title,
            guidelines: state.guidelines,
        });

        const subjective = await llm
            .withStructuredOutput(SubjectiveSchema)
            .invoke(prompt);

        const failures = [...rules.failures];
        if (!subjective.ok) {
            failures.push(subjective.reason);
        }

        const decision: ContentReviewDecision = failures.length
            ? {
                  url: item.url,
                  status: "rejected",
                  reason: failures.join(" | "),
              }
            : {
                  url: item.url,
                  status: "approved",
                  reason: subjective.reason,
              };

        return {
            currentIndex: index + 1,
            results: [decision],
        };
    } catch (error) {
        const reason =
            error instanceof Error
                ? error.message
                : "Falha ao extrair ou revisar o conteúdo.";
        const decision: ContentReviewDecision = {
            url: item.url,
            status: "error",
            reason,
        };

        return {
            currentIndex: index + 1,
            results: [decision],
        };
    }
};

const shouldContinue = (state: ContentReviewerState): typeof END | "review" => {
    const index = state.currentIndex ?? 0;
    const total = state.items?.length ?? 0;
    return index < total ? "review" : END;
};

const graph = new StateGraph(AgentState)
    .addNode("review", reviewNextUrl)
    .addEdge(START, "review")
    .addConditionalEdges("review", shouldContinue);

export const runContentReviewerGraph = async (
    input: ContentReviewInput,
): Promise<ContentReviewResult> => {
    const runner = graph.compile();

    const output = await runner.invoke({
        items: input.items,
        guidelines: input.guidelines,
        results: [],
    });

    const results = output.results ?? [];
    const approved = results.filter((r) => r.status === "approved").length;
    const rejected = results.filter((r) => r.status === "rejected").length;
    const errors = results.filter((r) => r.status === "error").length;

    return {
        results,
        total: results.length,
        approved,
        rejected,
        errors,
    };
};
