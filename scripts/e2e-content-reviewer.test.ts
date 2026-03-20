import { test, expect } from "bun:test";

type ContentReviewerResponse = {
    message?: string;
    results?: Array<{
        url: string;
        status: "approved" | "rejected" | "error";
        reason: string;
    }>;
    total?: number;
    approved?: number;
    rejected?: number;
    errors?: number;
};

const BASE_URL =
    (process.env.SOCIAL_AGENT_E2E_BASE_URL || "").trim() ||
    "http://localhost:3333";

const TEMPLATE_URL = `${BASE_URL}/strategist/content-reviewer/template`;
const REVIEW_URL = `${BASE_URL}/strategist/content-reviewer`;

async function fetchJson<T>(url: string, init?: RequestInit) {
    const res = await fetch(url, init);
    let json: any = null;
    try {
        json = await res.json();
    } catch {
        json = { error: "Non-JSON response from server" };
    }
    return { status: res.status, json: json as T };
}

test("E2E: Content reviewer CSV route accepts file upload and returns results", async () => {
    const templateRes = await fetch(TEMPLATE_URL);
    expect(templateRes.status).toBe(200);
    const templateCsv = await templateRes.text();
    expect(templateCsv).toContain(
        "url,contentType,primaryKeyword,supportingKeywords,expectedWordCount,outline,cta,personaPain,internalLinksTarget,maxInternalLinks,titleTagExpected",
    );

    const csv = [
        "url,contentType,primaryKeyword,supportingKeywords,expectedWordCount,outline,cta,personaPain,internalLinksTarget,maxInternalLinks,titleTagExpected",
        "https://example.com,blog,example keyword,alpha;beta,200,H2: Intro; H2: Body,Assinar agora,dor da persona,1,10,example title",
    ].join("\n");

    const form = new FormData();
    form.append(
        "file",
        new File([csv], "content-reviewer.csv", { type: "text/csv" }),
    );

    const { status, json } = await fetchJson<ContentReviewerResponse>(
        REVIEW_URL,
        {
            method: "POST",
            body: form,
        },
    );

    if (status !== 200) {
        throw new Error(
            `Request failed: HTTP ${status}. Payload: ${JSON.stringify(json)}`,
        );
    }

    expect(json).toBeTruthy();
    expect(Array.isArray(json.results)).toBe(true);
    expect(json.total).toBe(1);
    const firstResult = json.results?.[0];
    if (!firstResult) {
        throw new Error("Resultado vazio no reviewer.");
    }
    expect(firstResult.url).toMatch(/^https:\/\/example\.com\/?$/);
    expect(["approved", "rejected", "error"]).toContain(firstResult.status);
    expect(typeof firstResult.reason).toBe("string");
}, 120_000);

test("E2E: Content reviewer accepts semicolon-separated CSV", async () => {
    const csv = [
        "url;contentType;primaryKeyword;supportingKeywords;expectedWordCount;outline;cta;personaPain;internalLinksTarget;maxInternalLinks;titleTagExpected",
        "https://example.com;blog;example keyword;alpha, beta;200;H2: Intro;Assinar agora;dor da persona;1;10;example title",
    ].join("\n");

    const form = new FormData();
    form.append(
        "file",
        new File([csv], "content-reviewer-semicolon.csv", {
            type: "text/csv",
        }),
    );

    const { status, json } = await fetchJson<ContentReviewerResponse>(
        REVIEW_URL,
        {
            method: "POST",
            body: form,
        },
    );

    if (status !== 200) {
        throw new Error(
            `Request failed: HTTP ${status}. Payload: ${JSON.stringify(json)}`,
        );
    }

    expect(json).toBeTruthy();
    expect(Array.isArray(json.results)).toBe(true);
    expect(json.total).toBe(1);
    const firstResult = json.results?.[0];
    if (!firstResult) {
        throw new Error("Resultado vazio no reviewer.");
    }
    expect(firstResult.url).toMatch(/^https:\/\/example\.com\/?$/);
    expect(["approved", "rejected", "error"]).toContain(firstResult.status);
    expect(typeof firstResult.reason).toBe("string");
}, 120_000);
