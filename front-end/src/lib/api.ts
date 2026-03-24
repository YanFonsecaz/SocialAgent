// ---- Social Agent API ----
//
// In production, the frontend is served by the same server as the API.
// Use same-origin relative URLs to avoid CORS/preflight issues.
const API_BASE_URL =
    import.meta.env.VITE_API_BASE_URL ??
    (import.meta.env.DEV ? "http://localhost:3333" : "");

export class UnauthorizedError extends Error {
    constructor() {
        super("UNAUTHORIZED");
    }
}

type ApiFetchOptions = RequestInit & {
    suppressUnauthorizedRedirect?: boolean;
};

async function apiFetch(
    path: string,
    options: ApiFetchOptions = {},
): Promise<Response> {
    const { suppressUnauthorizedRedirect, ...requestInit } = options;
    const response = await fetch(`${API_BASE_URL}${path}`, {
        credentials: "include",
        ...requestInit,
    });

    if (response.status === 401) {
        if (
            !suppressUnauthorizedRedirect &&
            typeof window !== "undefined" &&
            window.location.pathname !== "/login"
        ) {
            window.location.href = "/login";
        }
        throw new UnauthorizedError();
    }

    return response;
}

export interface AuthRequestMagicLinkInput {
    email: string;
}

export interface AuthVerifyMagicLinkInput {
    token: string;
    callbackURL?: string;
}

export interface AuthSessionResponse {
    authenticated: boolean;
    user?: {
        id: string;
        email: string;
        name?: string;
    };
}

export type LlmGenerationStatus = "draft" | "approved";

export interface LlmGeneration {
    id: string;
    userId: string;
    tool: string;
    model?: string;
    prompt?: string;
    output?: string;
    status: LlmGenerationStatus;
    tokensIn?: number;
    tokensOut?: number;
    latencyMs?: number;
    costUsd?: string;
    createdAt: string;
    approvedAt?: string;
}

export interface LlmGenerationListResponse {
    items: LlmGeneration[];
    page: number;
    pageSize: number;
    total: number;
}

export interface LlmGenerationListFilters {
    tool?: string;
    status?: LlmGenerationStatus;
    from?: string;
    to?: string;
    page?: number;
    pageSize?: number;
}

export async function requestMagicLink(
    data: AuthRequestMagicLinkInput,
): Promise<{ success: boolean; message?: string }> {
    const response = await apiFetch("/auth/magic-link/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        suppressUnauthorizedRedirect: true,
    });

    if (!response.ok) {
        throw new Error(await parseApiError(response));
    }

    return response.json();
}

export async function verifyMagicLink(
    data: AuthVerifyMagicLinkInput,
): Promise<AuthSessionResponse> {
    const response = await apiFetch("/auth/magic-link/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        suppressUnauthorizedRedirect: true,
    });

    if (!response.ok) {
        throw new Error(await parseApiError(response));
    }

    return response.json();
}

export async function getAuthSession(): Promise<AuthSessionResponse> {
    const response = await apiFetch("/auth/session", {
        suppressUnauthorizedRedirect: true,
    });

    if (!response.ok) {
        throw new Error(await parseApiError(response));
    }

    return response.json();
}

export async function logout(): Promise<{ success: boolean }> {
    const response = await apiFetch("/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
    });

    if (!response.ok) {
        throw new Error(await parseApiError(response));
    }

    return response.json();
}

export async function listLlmGenerations(
    filters: LlmGenerationListFilters = {},
): Promise<LlmGenerationListResponse> {
    const search = new URLSearchParams();
    if (filters.tool) search.set("tool", filters.tool);
    if (filters.status) search.set("status", filters.status);
    if (filters.from) search.set("from", filters.from);
    if (filters.to) search.set("to", filters.to);
    search.set("page", String(filters.page ?? 1));
    search.set("pageSize", String(filters.pageSize ?? 20));

    const response = await apiFetch(`/llm/generations?${search.toString()}`);
    if (!response.ok) {
        throw new Error(await parseApiError(response));
    }

    return response.json();
}

export async function approveLlmGeneration(
    generationId: string,
): Promise<{ success: boolean; generation: LlmGeneration }> {
    const response = await apiFetch(`/llm/generations/${generationId}/status`, {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: "approved" }),
    });

    if (!response.ok) {
        throw new Error(await parseApiError(response));
    }

    return response.json();
}

// ---- Social Agent API ----

export interface SocialAgentRequest {
    url: string;
    intent?: string;
    query?: string;
    tone?: string;
    feedback?: string;
    previousResponse?: string;
}

export interface SocialAgentResponse {
    generationId?: string;
    response: string;
    sources: string[];
}

/** Envia a URL para o Social Agent e retorna o conteúdo gerado. */
export async function runSocialAgent(
    data: SocialAgentRequest,
): Promise<SocialAgentResponse> {
    const response = await apiFetch(`/social-agent`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
    });

    if (!response.ok) {
        throw new Error(await parseApiError(response));
    }

    return response.json();
}

// ---- Strategist Inlinks API ----

export interface StrategistInlinksRequest {
    sourceType?: "url" | "manual";
    urlPrincipal?: string;
    conteudoPrincipal?: string;
    urlsAnalise: string[];
}

export interface SelectedInlink {
    url: string;
    sentence: string;
    anchor: string;
}

export interface RejectedInlink {
    url: string;
    reason: string;
    score?: number;
}

export interface LlmChangeReportItem {
    targetUrl: string;
    anchor: string;
    originalSentence: string;
    modifiedSentence: string;
    positionIndex?: number;
    insertionStrategy?: "inline" | "semantic-paragraph" | "append" | "block";
    insertionContext?: string;
    justification: string;
    metrics?: { relevance: number; authority: number };
}

export interface InlinksBlock {
    id: string;
    type: "heading" | "paragraph" | "list_item" | "blockquote" | "code" | "other";
    tag: string;
    text: string;
    html: string;
    path: string;
    containsLink: boolean;
    charStart: number;
    charEnd: number;
}

export interface BlockEdit {
    blockId: string;
    targetUrl: string;
    anchor: string;
    originalBlockText: string;
    modifiedBlockText: string;
    overwriteBlock: boolean;
    justification: string;
    metrics?: { relevance: number; authority: number };
    skippedReason?:
        | "already_linked"
        | "no_valid_block"
        | "density_limit"
        | "duplicate";
}

export interface ApplyEditsStats {
    totalEdits: number;
    appliedLinked: number;
    appliedModified: number;
    skippedAlreadyLinked: number;
    skippedBlockNotFound: number;
}

export interface StrategistInlinksResponse {
    generationId?: string;
    message: string;
    principalUrl: string;
    principalInputMode?: "url" | "manual";
    totalAnalise: number;
    totalSelecionadas: number;
    selecionadas: SelectedInlink[];
    rejeitadas: RejectedInlink[];
    totalPersistidas: number;

    // New block-based contract (for debugging/UX)
    blocks?: InlinksBlock[];
    edits?: BlockEdit[];
    applied?: ApplyEditsStats;

    // Diff modal (kept for current UI)
    report: LlmChangeReportItem[];

    // 3-column HTML payloads
    modifiedContent: string;
    originalContent: string;
    linkedContent: string;
}

/** Envia URLs para análise de inlinks e retorna as oportunidades encontradas. */
export async function runStrategistInlinks(
    data: StrategistInlinksRequest,
): Promise<StrategistInlinksResponse> {
    const response = await apiFetch(`/strategist/inlinks`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
    });

    if (!response.ok) {
        throw new Error(await parseApiError(response));
    }

    return response.json();
}

// ---- Content Reviewer API ----

export interface ContentReviewItem {
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
}

export interface ContentReviewerRequest {
    items: ContentReviewItem[];
    guidelines?: string;
}

export interface ContentReviewerDecision {
    url: string;
    status: "approved" | "rejected" | "error";
    reason: string;
}

export interface ContentReviewerResponse {
    generationId?: string;
    message: string;
    results: ContentReviewerDecision[];
    total: number;
    approved: number;
    rejected: number;
    errors?: number;
}

async function parseApiError(response: Response): Promise<string> {
    let fallback = `Error: ${response.statusText}`;
    try {
        const data = (await response.json()) as {
            error?:
                | string
                | {
                      code?: string;
                      message?: string;
                  };
            details?: unknown;
            success?: boolean;
        };
        if (typeof data?.error === "string" && data.error.trim().length > 0) {
            fallback = data.error;
        } else if (
            data?.error &&
            typeof data.error === "object" &&
            typeof data.error.message === "string" &&
            data.error.message.trim().length > 0
        ) {
            fallback = data.error.message;
        }
    } catch {
        // Ignore JSON parse errors and keep fallback status text.
    }
    return fallback;
}

/** Envia itens para revisão de conteúdo (JSON). */
export async function runContentReviewer(
    data: ContentReviewerRequest,
): Promise<ContentReviewerResponse> {
    const response = await apiFetch(`/strategist/content-reviewer`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
    });

    if (!response.ok) {
        throw new Error(await parseApiError(response));
    }

    return response.json();
}

/** Baixa o template CSV de revisão de conteúdo. */
export async function fetchContentReviewerTemplate(): Promise<string> {
    const response = await apiFetch(`/strategist/content-reviewer/template`);

    if (!response.ok) {
        throw new Error(await parseApiError(response));
    }

    return response.text();
}

/** Envia CSV (upload) para revisão de conteúdo. */
export async function runContentReviewerCsv(
    file: File,
): Promise<ContentReviewerResponse> {
    const form = new FormData();
    form.append("file", file);

    const response = await apiFetch(`/strategist/content-reviewer`, {
        method: "POST",
        body: form,
    });

    if (!response.ok) {
        throw new Error(await parseApiError(response));
    }

    return response.json();
}

// ---- Trends Master API ----

export interface TrendsConfig {
    sector: string;
    periods: Array<"diario" | "semanal" | "mensal">;
    topN: number;
    risingN: number;
    maxArticles: number;
    customTopics?: string[];
    emailEnabled: boolean;
    emailRecipients: string[];
    emailMode?: string;
    emailApiProvider?: string;
}

export interface TrendsReport {
    sector: string;
    generatedAt: string | Date;
    periods: Array<{
        label: string;
        periodo: "diario" | "semanal" | "mensal";
        trends: Array<{
            keyword: string;
            type: "top" | "rising";
            score?: number | string;
        }>;
        news: Array<{
            keyword: string;
            articles: Array<{
                title: string;
                link: string;
                source: string;
                date: string;
                snippet?: string;
                thumbnail?: string;
            }>;
        }>;
    }>;
    summary: string;
    markdown: string;
}

export interface TrendsRunResponse {
    success: boolean;
    report?: TrendsReport;
    error?: string;
    generationId?: string;
}

export async function runTrendsMaster(
    data: TrendsConfig,
): Promise<TrendsRunResponse> {
    const response = await apiFetch(`/api/trends-master/run`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
    });

    if (!response.ok) {
        throw new Error(await parseApiError(response));
    }

    return response.json();
}

export async function getTrendsMasterConfig(): Promise<{
    success: boolean;
    config: TrendsConfig;
}> {
    const response = await apiFetch(`/api/trends-master/config`);

    if (!response.ok) {
        throw new Error(await parseApiError(response));
    }

    return response.json();
}

export async function updateTrendsMasterConfig(
    data: TrendsConfig,
): Promise<{ success: boolean; error?: string }> {
    const response = await apiFetch(`/api/trends-master/config`, {
        method: "PUT",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
    });

    if (!response.ok) {
        throw new Error(await parseApiError(response));
    }

    const payload = (await response.json()) as {
        success: boolean;
        error?: string;
    };
    if (!payload.success) {
        throw new Error(payload.error || "Falha ao salvar configuração");
    }

    return payload;
}
