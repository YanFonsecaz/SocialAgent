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

const isDev = (): boolean => {
    const env = (Bun.env.NODE_ENV ?? "").toLowerCase();
    return env !== "production";
};

const serializeErrorForClient = (error: unknown) => {
    if (error instanceof Error) {
        return {
            name: error.name,
            message: error.message,
            stack: error.stack,
        };
    }
    return { message: String(error) };
};

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

export const strategistInlinks = new Elysia().post(
    "/strategist/inlinks",
    async ({ body }) => {
        const { urlPrincipal, urlsAnalise } = body;

        try {
            // 1) Normalize, dedupe, and block auto-link
            const principalNormalized = normalizeUrl(urlPrincipal);
            const analysisUrlsNormalized = urlsAnalise.map(normalizeUrl);
            const analysisUrlsDeduped = Array.from(
                new Set(analysisUrlsNormalized),
            );
            const filteredAnalysisUrls = analysisUrlsDeduped.filter(
                (u) => u !== principalNormalized,
            );

            // 2) Extract and persist principal content (RAG store)
            const principalText = await extractTextFromHtml(urlPrincipal);
            await saveCleanContent(urlPrincipal, principalText);

            // 3) Extract principal HTML (Readability) and parse blocks (source of truth for editing)
            const principalHtml = await extractHtmlFromUrl(urlPrincipal);
            const { blocks } = parseHtmlToBlocks(principalHtml);

            // Restrict to paragraph/list items only (per UX decision), but avoid intro:
            // - Prefer: do not insert before first H2
            // - Fallback: skip first N blocks
            const principalBlocks = toPrincipalBlocks(blocks, {
                avoidBeforeFirstH2: true,
                skipFirstN: 3,
            });

            // 4) Run block-based agent graph
            const graphResult = await runStrategistInlinksBlockGraph({
                principalUrl: urlPrincipal,
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
                principalUrl: urlPrincipal,
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

            // 7) Response: new contract includes blocks + edits for debugging/UX
            return {
                message: "Inlinks analisados com sucesso",
                principalUrl: urlPrincipal,
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

            const payload = isDev()
                ? {
                      error: "Falha ao processar as URLs",
                      details: serializeErrorForClient(error),
                  }
                : { error: "Falha ao processar as URLs" };

            return new Response(JSON.stringify(payload), {
                status: 500,
                headers: { "Content-Type": "application/json" },
            });
        }
    },
    {
        body: z.object({
            urlPrincipal: z.url().min(1).max(255),
            urlsAnalise: z.array(z.url().min(1).max(255)).min(1).max(100),
        }),
    },
);
