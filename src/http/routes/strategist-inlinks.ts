import Elysia from "elysia";
import { z } from "zod";
import { db } from "../../db/connection";
import { strategistInlinks as strategistInlinksTable } from "../../db/schema";
import { runStrategistInlinksBlockGraph } from "../../agents/strategist-inlinks-block-graph";
import {
    extractHtmlFromUrl,
    extractTextFromHtml,
} from "../../use-case/extract-content";
import { saveCleanContent } from "../../use-case/save-content";
import {
    parseHtmlToBlocks,
    type InlinksBlock,
} from "../../use-case/inlinks/paragraphs";
import { applyBlockEditsToHtml } from "../../use-case/inlinks/apply-edits";
import {
    resolveAuthContext,
    unauthorizedResponse,
} from "../plugins/auth-guard";
import { logLlmGeneration } from "../../use-case/log-generation";
import { buildGenerationMetrics } from "../../use-case/llm-metrics";
import { createApiErrorResponse } from "../error-response";
import { getRequestId } from "../request-context";
import { UnsafeUrlError } from "../../security/ssrf";

const normalizeUrl = (value: string): string => {
    const u = new URL(value);
    u.hash = "";
    u.search = "";
    u.pathname = u.pathname.replace(/\/+$/, "");
    return u.toString();
};

const findFirstH2Index = (blocks: InlinksBlock[]): number => {
    return blocks.findIndex((b) => b.type === "heading" && b.tag === "h2");
};

const toPrincipalBlocks = (
    blocks: InlinksBlock[],
    options?: {
        /**
         * If true, drop paragraph/list blocks that appear before the first H2.
         * This is a stronger "introduction protection" than skipping the first N blocks,
         * and better aligns with editorial structure.
         */
        avoidBeforeFirstH2?: boolean;

        /**
         * Fallback intro protection: skip the first N paragraph/list blocks (after applying
         * avoidBeforeFirstH2, if enabled).
         */
        skipFirstN?: number;
    },
): Array<{
    id: string;
    type: "paragraph" | "list_item";
    text: string;
    containsLink: boolean;
}> => {
    const avoidBeforeFirstH2 = options?.avoidBeforeFirstH2 ?? true;
    const skipFirstN = options?.skipFirstN ?? 3;

    const firstH2Index = avoidBeforeFirstH2 ? findFirstH2Index(blocks) : -1;

    const paragraphLike = blocks.filter(
        (b): b is InlinksBlock & { type: "paragraph" | "list_item" } =>
            b.type === "paragraph" || b.type === "list_item",
    );

    const filteredByStructure =
        avoidBeforeFirstH2 && firstH2Index >= 0
            ? paragraphLike.filter(
                  (b) => b.charStart >= (blocks[firstH2Index]?.charStart ?? 0),
              )
            : paragraphLike;

    const filteredByFallback =
        filteredByStructure.length > skipFirstN
            ? filteredByStructure.slice(skipFirstN)
            : [];

    return filteredByFallback.map((b) => ({
        id: b.id,
        type: b.type,
        text: b.text,
        containsLink: b.containsLink,
    }));
};

const STRATEGIST_SOURCE_TYPE_URL = "url";
const STRATEGIST_SOURCE_TYPE_MANUAL = "manual";
const MANUAL_CONTENT_MAX_CHARS = 50_000;

const urlPrincipalSchema = z.url().min(1).max(255);
const urlsAnaliseSchema = z.array(z.url().min(1).max(255)).min(1).max(100);

const strategistInlinksBodySchema = z
    .union([
        z.object({
            sourceType: z.literal(STRATEGIST_SOURCE_TYPE_URL),
            urlPrincipal: urlPrincipalSchema,
            urlsAnalise: urlsAnaliseSchema,
        }),
        z.object({
            sourceType: z.literal(STRATEGIST_SOURCE_TYPE_MANUAL),
            urlPrincipal: urlPrincipalSchema.optional(),
            conteudoPrincipal: z
                .string()
                .trim()
                .min(1)
                .max(MANUAL_CONTENT_MAX_CHARS),
            urlsAnalise: urlsAnaliseSchema,
        }),
        z.object({
            urlPrincipal: urlPrincipalSchema,
            urlsAnalise: urlsAnaliseSchema,
        }),
    ])
    .transform((value) => {
        if ("sourceType" in value) {
            return value;
        }

        return {
            sourceType: STRATEGIST_SOURCE_TYPE_URL,
            urlPrincipal: value.urlPrincipal,
            urlsAnalise: value.urlsAnalise,
        } as const;
    });

type StrategistInlinksBody = z.infer<typeof strategistInlinksBodySchema>;

const escapeHtml = (value: string): string =>
    value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");

const manualTextToHtml = (text: string): string => {
    const paragraphs = text
        .split(/\n{2,}/)
        .map((part) => part.trim())
        .filter((part) => part.length > 0)
        .map((part) => `<p>${escapeHtml(part).replaceAll("\n", "<br />")}</p>`);

    if (paragraphs.length === 0) {
        return "<article><p></p></article>";
    }

    return `<article>${paragraphs.join("")}</article>`;
};

const buildManualReference = (userId: string, requestId: string): string =>
    `manual://${encodeURIComponent(userId)}/${encodeURIComponent(requestId)}`;

export const strategistInlinks = new Elysia().post(
    "/strategist/inlinks",
    async ({ body, request }) => {
        const requestId = getRequestId(request);
        const payload = body as StrategistInlinksBody;
        const { urlsAnalise } = payload;
        const sourceType = payload.sourceType;
        const authContext = await resolveAuthContext(request);
        if (!authContext) {
            return unauthorizedResponse();
        }
        const startedAt = Date.now();

        try {
            const normalizedPrincipalUrl =
                payload.urlPrincipal && payload.urlPrincipal.trim().length > 0
                    ? normalizeUrl(payload.urlPrincipal)
                    : undefined;
            const principalReference =
                normalizedPrincipalUrl ??
                buildManualReference(authContext.userId, requestId);

            // 1) Normalize, dedupe, and block auto-link
            const analysisUrlsNormalized = urlsAnalise.map(normalizeUrl);
            const analysisUrlsDeduped = Array.from(
                new Set(analysisUrlsNormalized),
            );
            const filteredAnalysisUrls = normalizedPrincipalUrl
                ? analysisUrlsDeduped.filter((u) => u !== normalizedPrincipalUrl)
                : analysisUrlsDeduped;

            // 2) Resolve and persist principal content (RAG store)
            const principalText =
                sourceType === STRATEGIST_SOURCE_TYPE_MANUAL
                    ? payload.conteudoPrincipal.trim()
                    : await extractTextFromHtml(normalizedPrincipalUrl as string);
            const principalHtml =
                sourceType === STRATEGIST_SOURCE_TYPE_MANUAL
                    ? manualTextToHtml(principalText)
                    : await extractHtmlFromUrl(normalizedPrincipalUrl as string);
            await saveCleanContent(
                authContext.userId,
                principalReference,
                principalText,
            );

            // 3) Parse blocks from principal source (source of truth for editing)
            const { blocks } = parseHtmlToBlocks(principalHtml);

            // Restrict to paragraph/list items only (per UX decision), but avoid intro:
            // - Prefer: do not insert before first H2
            // - Fallback: skip first N blocks
            const principalBlocks = toPrincipalBlocks(blocks, {
                avoidBeforeFirstH2:
                    sourceType === STRATEGIST_SOURCE_TYPE_MANUAL ? false : true,
                skipFirstN:
                    sourceType === STRATEGIST_SOURCE_TYPE_MANUAL ? 0 : 3,
            });

            // 4) Run block-based agent graph
            const graphResult = await runStrategistInlinksBlockGraph({
                principalUrl: principalReference,
                analysisUrls: filteredAnalysisUrls,
                principalBlocks,
                // fallback text is still provided for density computation / embeddings
                principalContent: principalBlocks.map((b) => b.text).join("\n\n"),
            });

            // 5) Apply edits to HTML for 3 columns (original/linked/modified)
            const applied = applyBlockEditsToHtml({
                htmlContent: principalHtml,
                blocks,
                edits: graphResult.edits.map((e) => ({
                    blockId: e.blockId,
                    targetUrl: e.targetUrl,
                    anchor: e.anchor,
                    originalBlockText: e.originalBlockText,
                    modifiedBlockText: e.modifiedBlockText,
                    overwriteBlock: e.overwriteBlock,
                })),
                preserveExistingLinks: true,
            });

            // 6) Persist selected URLs (compat: keep old table shape)
            const rows = graphResult.edits.map((item) => ({
                userId: authContext.userId,
                principalUrl: principalReference,
                analysisUrl: item.targetUrl,
                sentence: item.modifiedBlockText,
                anchor: item.anchor,
            }));

            const inserted =
                rows.length === 0
                    ? []
                    : await db
                          .insert(strategistInlinksTable)
                          .values(rows)
                          .returning({
                              analysisUrl: strategistInlinksTable.analysisUrl,
                              sentence: strategistInlinksTable.sentence,
                              anchor: strategistInlinksTable.anchor,
                          });

            const generationId = await logLlmGeneration({
                userId: authContext.userId,
                tool: "strategist-inlinks",
                model: "gpt-4o-mini",
                prompt: JSON.stringify(payload),
                output: JSON.stringify({
                    totalSelecionadas: graphResult.edits.length,
                    totalPersistidas: inserted.length,
                }),
                status: "draft",
                ...buildGenerationMetrics({
                    tool: "strategist-inlinks",
                    startedAt,
                    model: "gpt-4o-mini",
                    usage: graphResult.usage,
                }),
            });

            // 7) Response: new contract includes blocks + edits for debugging/UX
            return {
                generationId,
                message: "Inlinks analisados com sucesso",
                principalUrl: principalReference,
                principalInputMode: sourceType,
                totalAnalise: filteredAnalysisUrls.length,

                // New contract
                blocks,
                edits: graphResult.edits,
                applied: applied.applied,

                // Backward compat fields used by current front
                totalSelecionadas: graphResult.edits.length,
                selecionadas: graphResult.edits.map((e) => ({
                    url: e.targetUrl,
                    sentence: e.modifiedBlockText,
                    anchor: e.anchor,
                })),
                rejeitadas: graphResult.rejected,
                totalPersistidas: inserted.length,
                report: graphResult.edits.map((e) => ({
                    targetUrl: e.targetUrl,
                    anchor: e.anchor,
                    originalSentence: e.originalBlockText,
                    modifiedSentence: e.modifiedBlockText,
                    justification: e.justification,
                    metrics: e.metrics,
                    insertionStrategy: "block",
                    insertionContext: e.originalBlockText,
                })),
                modifiedContent: applied.modifiedHtml,
                originalContent: applied.originalHtml,
                linkedContent: applied.linkedHtml,
            };
        } catch (error) {
            console.error("Falha ao processar inlinks:", error);

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
                code: "STRATEGIST_INLINKS_FAILED",
                message: "Falha ao processar as URLs.",
                requestId,
                details: error,
            });
        }
    },
    {
        body: strategistInlinksBodySchema,
    },
);
