import Elysia from "elysia";
import { z } from "zod";
import {
    runContentReviewerGraph,
    type ContentReviewItem,
} from "../../agents/content-reviewer-graph";
import {
    resolveAuthContext,
    unauthorizedResponse,
} from "../plugins/auth-guard";
import { logLlmGeneration } from "../../use-case/log-generation";
import { buildGenerationMetrics } from "../../use-case/llm-metrics";
import { createApiErrorResponse } from "../error-response";
import { UnsafeUrlError } from "../../security/ssrf";
import { getRequestId } from "../request-context";

const normalizeUrl = (value: string): string => {
    const u = new URL(value);
    u.hash = "";
    u.search = "";
    u.pathname = u.pathname.replace(/\/+$/, "");
    return u.toString();
};

const ContentReviewItemSchema = z.object({
    url: z.string().url().min(1).max(2048),
    contentType: z.enum(["blog", "copy", "descricao"]),
    primaryKeyword: z.string().min(1),
    supportingKeywords: z.array(z.string().min(1)),
    expectedWordCount: z.number().int().positive(),
    outline: z.array(z.string().min(1)),
    cta: z.string().min(1),
    personaPain: z.string().min(1),
    internalLinksTarget: z.number().int().positive().optional(),
    maxInternalLinks: z.number().int().positive().optional(),
    titleTagExpected: z.string().min(1).optional(),
});

const ContentReviewRequestSchema = z.object({
    items: z.array(ContentReviewItemSchema).min(1).max(100),
    guidelines: z.string().min(1).max(5000).optional(),
});

const toList = (value: string | string[] | undefined): string[] => {
    if (!value) return [];
    if (Array.isArray(value)) return value.map((v) => v.trim()).filter(Boolean);
    return value
        .split(/[;\n\r]+/)
        .map((v) => v.trim())
        .filter(Boolean);
};

const toKeywordsList = (value: string | string[] | undefined): string[] => {
    if (!value) return [];
    if (Array.isArray(value)) return value.map((v) => v.trim()).filter(Boolean);
    const normalized = value.replace(/\r/g, "");
    // Prefer semicolon/newline as canonical separators. Comma is used only as
    // fallback to support legacy rows that do not include semicolons.
    if (normalized.includes(";") || normalized.includes("\n")) {
        return normalized
            .split(/[;\n]+/)
            .map((v) => v.trim())
            .filter(Boolean);
    }
    return normalized
        .split(/[,]+/)
        .map((v) => v.trim())
        .filter(Boolean);
};

const detectCsvDelimiter = (text: string): "," | ";" => {
    const source = text.replace(/^\uFEFF/, "");
    let inQuotes = false;
    let commas = 0;
    let semicolons = 0;

    for (let i = 0; i < source.length; i += 1) {
        const char = source[i];

        if (char === '"') {
            const next = source[i + 1];
            if (inQuotes && next === '"') {
                i += 1;
            } else {
                inQuotes = !inQuotes;
            }
            continue;
        }

        if (!inQuotes && (char === "\n" || char === "\r")) {
            break;
        }

        if (!inQuotes && char === ",") commas += 1;
        if (!inQuotes && char === ";") semicolons += 1;
    }

    return semicolons > commas ? ";" : ",";
};

const parseCsvRows = (text: string, delimiter: "," | ";"): string[][] => {
    const source = text.replace(/^\uFEFF/, "");
    const rows: string[][] = [];
    let row: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < source.length; i += 1) {
        const char = source[i];

        if (char === '"') {
            const next = source[i + 1];
            if (inQuotes && next === '"') {
                current += '"';
                i += 1;
            } else {
                inQuotes = !inQuotes;
            }
            continue;
        }

        if (char === delimiter && !inQuotes) {
            row.push(current);
            current = "";
            continue;
        }

        if ((char === "\n" || char === "\r") && !inQuotes) {
            if (char === "\r" && source[i + 1] === "\n") {
                i += 1;
            }
            row.push(current);
            current = "";
            if (row.some((cell) => cell.trim().length > 0)) {
                rows.push(row);
            }
            row = [];
            continue;
        }

        current += char;
    }

    row.push(current);
    if (row.some((cell) => cell.trim().length > 0)) {
        rows.push(row);
    }

    return rows;
};

const buildItemsFromCsv = (
    csv: string,
): {
    items: ContentReviewItem[];
    guidelines?: string;
} => {
    const delimiter = detectCsvDelimiter(csv);
    const rows = parseCsvRows(csv, delimiter);
    if (rows.length === 0) {
        throw new Error("CSV vazio.");
    }

    let headers = (rows[0] ?? []).map((h) => h.trim().toLowerCase());
    const dataRows = rows.slice(1);

    if (!headers.includes("url")) {
        headers = [
            "url",
            "contenttype",
            "primarykeyword",
            "supportingkeywords",
            "expectedwordcount",
            "outline",
            "cta",
            "personapain",
            "internallinkstarget",
            "maxinternallinks",
            "titletagexpected",
            "guidelines",
        ];
    }

    const items: ContentReviewItem[] = [];
    let globalGuidelines: string | undefined;

    for (const row of dataRows) {
        const record: Record<string, string> = {};
        headers.forEach((header, idx) => {
            if (!header) return;
            record[header] = (row[idx] ?? "").trim();
        });

        if (!globalGuidelines && record.guidelines) {
            globalGuidelines = record.guidelines;
        }

        const itemCandidate: ContentReviewItem = {
            url: normalizeUrl(record.url || ""),
            contentType:
                (record.contenttype?.toLowerCase() as ContentReviewItem["contentType"]) ||
                "blog",
            primaryKeyword: record.primarykeyword || "",
            supportingKeywords: toKeywordsList(record.supportingkeywords),
            expectedWordCount: Number(record.expectedwordcount || 0),
            outline: toList(record.outline),
            cta: record.cta || "",
            personaPain: record.personapain || "não informado",
            internalLinksTarget: record.internallinkstarget
                ? Number(record.internallinkstarget)
                : undefined,
            maxInternalLinks: record.maxinternallinks
                ? Number(record.maxinternallinks)
                : undefined,
            titleTagExpected: record.titletagexpected || undefined,
        };

        const validated = ContentReviewItemSchema.parse(itemCandidate);
        items.push(validated);
    }

    return { items, guidelines: globalGuidelines };
};

const parseJsonBody = async (
    request: Request,
): Promise<{ items: ContentReviewItem[]; guidelines?: string }> => {
    const raw = await request.json();
    const parsed = ContentReviewRequestSchema.parse(raw);
    return {
        items: parsed.items.map((item) => ({
            ...item,
            url: normalizeUrl(item.url),
            supportingKeywords: toList(item.supportingKeywords),
            outline: toList(item.outline),
        })),
        guidelines: parsed.guidelines?.trim() || undefined,
    };
};

const parseCsvBody = async (
    request: Request,
): Promise<{ items: ContentReviewItem[]; guidelines?: string }> => {
    const contentType = request.headers.get("content-type") ?? "";

    if (contentType.includes("multipart/form-data")) {
        const form = await request.formData();
        const file = form.get("file") ?? form.get("csv");
        if (!(file instanceof File)) {
            throw new Error("Arquivo CSV não encontrado no form-data.");
        }
        const text = await file.text();
        return buildItemsFromCsv(text);
    }

    const text = await request.text();
    return buildItemsFromCsv(text);
};

export const contentReviewerRoutes = new Elysia()
    .get("/strategist/content-reviewer/template", () => {
        const template = [
            "url,contentType,primaryKeyword,supportingKeywords,expectedWordCount,outline,cta,personaPain,internalLinksTarget,maxInternalLinks,titleTagExpected",
            "https://exemplo.com/post-1,blog,marketing de conteúdo,funil;seo,1200,H2: Introdução; H2: Estratégia; H2: Conclusão,Baixar ebook,falta de leads qualificados,3,12,marketing de conteúdo para empresas",
        ].join("\n");
        return new Response(template, {
            headers: { "Content-Type": "text/csv; charset=utf-8" },
        });
    })
    .post("/strategist/content-reviewer", async ({ request }) => {
        const requestId = getRequestId(request);
        try {
            const authContext = await resolveAuthContext(request);
            if (!authContext) {
                return unauthorizedResponse();
            }
            const startedAt = Date.now();

            const contentType = request.headers.get("content-type") ?? "";
            const isJson = contentType.includes("application/json");

            const { items, guidelines } = isJson
                ? await parseJsonBody(request)
                : await parseCsvBody(request);

            const review = await runContentReviewerGraph({
                items,
                guidelines,
            });

            const generationId = await logLlmGeneration({
                userId: authContext.userId,
                tool: "content-reviewer",
                model: "gpt-4o-mini",
                prompt: JSON.stringify({
                    itemsCount: items.length,
                    guidelines: guidelines ?? "",
                }),
                output: JSON.stringify({
                    total: review.total,
                    approved: review.approved,
                    rejected: review.rejected,
                    errors: review.errors,
                }),
                status: "draft",
                ...buildGenerationMetrics({
                    tool: "content-reviewer",
                    startedAt,
                    model: "gpt-4o-mini",
                    usage: review.usage,
                }),
            });

            return {
                generationId,
                message: "Conteúdo revisado com sucesso",
                results: review.results,
                total: review.total,
                approved: review.approved,
                rejected: review.rejected,
                errors: review.errors,
            };
        } catch (error) {
            console.error("Falha ao revisar conteúdo:", error);

            if (error instanceof z.ZodError) {
                return createApiErrorResponse({
                    status: 422,
                    code: "VALIDATION_ERROR",
                    message: "Falha ao validar payload de revisão.",
                    requestId,
                    details: error.issues,
                });
            }

            if (error instanceof UnsafeUrlError) {
                return createApiErrorResponse({
                    status: 422,
                    code: "INVALID_URL_TARGET",
                    message: error.message,
                    requestId,
                });
            }

            return createApiErrorResponse({
                status: 500,
                code: "CONTENT_REVIEWER_FAILED",
                message: "Falha ao revisar conteúdo.",
                requestId,
                details: error,
            });
        }
    });
