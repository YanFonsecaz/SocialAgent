import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "../db/connection";
import { llmGenerations } from "../db/schema";

export type GenerationStatus = "draft" | "approved";

export type GenerationListFilters = {
    tool?: string;
    status?: GenerationStatus;
    from?: Date;
    to?: Date;
    page: number;
    pageSize: number;
};

export type PublicLlmGeneration = {
    id: string;
    userId: string;
    tool: string;
    model?: string;
    prompt?: string;
    output?: string;
    status: GenerationStatus;
    tokensIn?: number;
    tokensOut?: number;
    latencyMs?: number;
    costUsd?: string;
    createdAt: string;
    approvedAt?: string;
};

type ApprovalResult =
    | { kind: "updated"; generation: PublicLlmGeneration }
    | { kind: "not_found" }
    | { kind: "invalid_transition" };

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const VALID_STATUSES: GenerationStatus[] = ["draft", "approved"];
const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const parsePositiveInt = (
    value: string | null,
    field: "page" | "pageSize",
): number | undefined => {
    if (value === null || value.trim().length === 0) {
        return undefined;
    }

    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) {
        throw new Error(`Parâmetro ${field} inválido.`);
    }

    if (field === "pageSize" && parsed > MAX_PAGE_SIZE) {
        throw new Error(`Parâmetro ${field} inválido.`);
    }

    return parsed;
};

const parseDate = (value: string | null, field: "from" | "to"): Date | undefined => {
    if (value === null || value.trim().length === 0) {
        return undefined;
    }

    const trimmed = value.trim();
    if (DATE_ONLY_REGEX.test(trimmed)) {
        const normalized =
            field === "to"
                ? `${trimmed}T23:59:59.999Z`
                : `${trimmed}T00:00:00.000Z`;
        const parsedDateOnly = new Date(normalized);
        if (Number.isNaN(parsedDateOnly.getTime())) {
            throw new Error(`Parâmetro ${field} inválido.`);
        }
        return parsedDateOnly;
    }

    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) {
        throw new Error(`Parâmetro ${field} inválido.`);
    }

    return parsed;
};

const toPublicGeneration = (
    row: typeof llmGenerations.$inferSelect,
): PublicLlmGeneration => ({
    id: row.id,
    userId: row.userId,
    tool: row.tool,
    model: row.model ?? undefined,
    prompt: row.prompt ?? undefined,
    output: row.output ?? undefined,
    status: row.status === "approved" ? "approved" : "draft",
    tokensIn: row.tokensIn ?? undefined,
    tokensOut: row.tokensOut ?? undefined,
    latencyMs: row.latencyMs ?? undefined,
    costUsd: row.costUsd ?? undefined,
    createdAt: row.createdAt.toISOString(),
    approvedAt: row.approvedAt ? row.approvedAt.toISOString() : undefined,
});

export const isValidGenerationStatusTransition = (
    currentStatus: GenerationStatus,
    nextStatus: GenerationStatus,
): boolean => currentStatus === "draft" && nextStatus === "approved";

export const parseGenerationListFilters = (
    searchParams: URLSearchParams,
): GenerationListFilters => {
    const toolRaw = searchParams.get("tool");
    const statusRaw = searchParams.get("status");
    const page = parsePositiveInt(searchParams.get("page"), "page") ?? DEFAULT_PAGE;
    const pageSize =
        parsePositiveInt(searchParams.get("pageSize"), "pageSize") ??
        DEFAULT_PAGE_SIZE;
    const from = parseDate(searchParams.get("from"), "from");
    const to = parseDate(searchParams.get("to"), "to");

    if (from && to && from.getTime() > to.getTime()) {
        throw new Error("Intervalo de datas inválido.");
    }

    let status: GenerationStatus | undefined;
    if (statusRaw && statusRaw.trim().length > 0) {
        if (!VALID_STATUSES.includes(statusRaw as GenerationStatus)) {
            throw new Error("Parâmetro status inválido.");
        }
        status = statusRaw as GenerationStatus;
    }

    const tool = toolRaw?.trim() || undefined;

    return {
        tool,
        status,
        from,
        to,
        page,
        pageSize,
    };
};

export const listLlmGenerationsByUser = async (
    userId: string,
    filters: GenerationListFilters,
): Promise<{ items: PublicLlmGeneration[]; total: number }> => {
    const whereClause = and(
        eq(llmGenerations.userId, userId),
        filters.tool ? eq(llmGenerations.tool, filters.tool) : undefined,
        filters.status ? eq(llmGenerations.status, filters.status) : undefined,
        filters.from ? gte(llmGenerations.createdAt, filters.from) : undefined,
        filters.to ? lte(llmGenerations.createdAt, filters.to) : undefined,
    );

    const offset = (filters.page - 1) * filters.pageSize;

    const [countRow] = await db
        .select({
            total: sql<number>`count(*)`,
        })
        .from(llmGenerations)
        .where(whereClause);

    const rows = await db
        .select()
        .from(llmGenerations)
        .where(whereClause)
        .orderBy(desc(llmGenerations.createdAt))
        .limit(filters.pageSize)
        .offset(offset);

    return {
        items: rows.map(toPublicGeneration),
        total: Number(countRow?.total ?? 0),
    };
};

export const approveLlmGenerationByUser = async (
    userId: string,
    generationId: string,
): Promise<ApprovalResult> => {
    const [updated] = await db
        .update(llmGenerations)
        .set({
            status: "approved",
            approvedAt: new Date(),
        })
        .where(
            and(
                eq(llmGenerations.id, generationId),
                eq(llmGenerations.userId, userId),
                eq(llmGenerations.status, "draft"),
            ),
        )
        .returning();

    if (updated) {
        return {
            kind: "updated",
            generation: toPublicGeneration(updated),
        };
    }

    const [existing] = await db
        .select({
            id: llmGenerations.id,
            status: llmGenerations.status,
        })
        .from(llmGenerations)
        .where(
            and(
                eq(llmGenerations.id, generationId),
                eq(llmGenerations.userId, userId),
            ),
        )
        .limit(1);

    if (!existing) {
        return { kind: "not_found" };
    }

    return { kind: "invalid_transition" };
};
