// ---- Social Agent API ----
//
// In production, the frontend is served by the same server as the API.
// Use same-origin relative URLs to avoid CORS/preflight issues.
const API_BASE_URL =
    import.meta.env.VITE_API_BASE_URL ??
    (import.meta.env.DEV ? "http://localhost:3333" : "");

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
    response: string;
    sources: string[];
}

/** Envia a URL para o Social Agent e retorna o conteúdo gerado. */
export async function runSocialAgent(
    data: SocialAgentRequest,
): Promise<SocialAgentResponse> {
    const response = await fetch(`${API_BASE_URL}/social-agent`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
    });

    if (!response.ok) {
        throw new Error(`Error: ${response.statusText}`);
    }

    return response.json();
}

// ---- Strategist Inlinks API ----

export interface StrategistInlinksRequest {
    urlPrincipal: string;
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
    message: string;
    principalUrl: string;
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
    const response = await fetch(`${API_BASE_URL}/strategist/inlinks`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
    });

    if (!response.ok) {
        throw new Error(`Error: ${response.statusText}`);
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
            error?: string;
            details?: unknown;
        };
        if (data?.error && typeof data.error === "string") {
            fallback = data.error;
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
    const response = await fetch(`${API_BASE_URL}/strategist/content-reviewer`, {
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
    const response = await fetch(
        `${API_BASE_URL}/strategist/content-reviewer/template`,
    );

    if (!response.ok) {
        throw new Error(`Error: ${response.statusText}`);
    }

    return response.text();
}

/** Envia CSV (upload) para revisão de conteúdo. */
export async function runContentReviewerCsv(
    file: File,
): Promise<ContentReviewerResponse> {
    const form = new FormData();
    form.append("file", file);

    const response = await fetch(`${API_BASE_URL}/strategist/content-reviewer`, {
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
    details?: unknown;
}

export async function runTrendsMaster(
    data: TrendsConfig,
): Promise<TrendsRunResponse> {
    const response = await fetch(`${API_BASE_URL}/api/trends-master/run`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
    });

    if (!response.ok) {
        throw new Error(`Error: ${response.statusText}`);
    }

    return response.json();
}

export async function getTrendsMasterConfig(): Promise<{
    success: boolean;
    config: TrendsConfig;
}> {
    const response = await fetch(`${API_BASE_URL}/api/trends-master/config`);

    if (!response.ok) {
        throw new Error(`Error: ${response.statusText}`);
    }

    return response.json();
}

export async function updateTrendsMasterConfig(
    data: TrendsConfig,
): Promise<{ success: boolean; error?: string }> {
    const response = await fetch(`${API_BASE_URL}/api/trends-master/config`, {
        method: "PUT",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
    });

    if (!response.ok) {
        throw new Error(`Error: ${response.statusText}`);
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
