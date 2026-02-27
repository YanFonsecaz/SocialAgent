import { test, expect } from "bun:test";

/**
 * E2E (smoke) test for Strategist Inlinks.
 *
 * Goal:
 *  - Validate that NO new links are inserted before the first H2 in the pillar page.
 *  - Add extra guardrails validation:
 *    - The page contains an H2 (so the "intro" boundary is meaningful).
 *    - Fallback protection: do not insert links in the first N paragraphs after the first H2.
 *
 * How it works:
 *  1) Calls POST /strategist/inlinks with a real pillar + satellite URLs.
 *  2) Receives HTML payloads: originalContent + linkedContent.
 *  3) Extracts:
 *     - the substring "before first H2" from both original and linked HTML
 *     - the substring "after first H2" and inspects the first N <p> blocks
 *  4) Compares:
 *     - The set of hrefs before first H2 must be identical (no new links introduced).
 *     - The set of hrefs inside the first N paragraphs after the first H2 must be identical (fallback skip).
 *
 * Requirements:
 *  - Backend must be running and accessible.
 *  - The backend must be configured with the required credentials (LLM, etc.) so it can generate edits.
 *
 * Run:
 *  - Start backend (example):
 *      bun --hot SocialAgent/src/http/server.ts
 *  - Run test:
 *      SOCIAL_AGENT_E2E_BASE_URL="http://localhost:3333" bun test SocialAgent/scripts/e2e-strategist-inlinks.test.ts
 *
 * Env:
 *  - SOCIAL_AGENT_E2E_BASE_URL: defaults to http://localhost:3333
 */

type StrategistInlinksResponse = {
    message?: string;
    principalUrl?: string;

    // 3-column HTML payloads
    originalContent?: string;
    linkedContent?: string;
    modifiedContent?: string;

    // Debugging payloads (optional)
    edits?: unknown[];
    rejeitadas?: unknown[];
};

const BASE_URL =
    (process.env.SOCIAL_AGENT_E2E_BASE_URL || "").trim() ||
    "http://localhost:3333";

const PILLAR_URL = "https://www.kumon.com.br/cursos/curso-de-ingles/";
const SATELLITE_URLS = [
    "https://www.kumon.com.br/blog/ingles1/curso-intensivo-de-ingles/",
    "https://www.kumon.com.br/blog/e-possivel-aprender-ingles-sem-sair-de-casa-estudando-apenas-30-minutos-por-dia-/",
    "https://www.kumon.com.br/blog/ingles1/como-ser-fluente-em-ingles/",
    "https://www.kumon.com.br/blog/kumon-de-ingles-o-primeiro-passo-para-uma-carreira-de-sucesso-nos-eua/",
    "https://www.kumon.com.br/blog/como-usar-os-porques-entenda-em-5-minutos-e-nunca-mais-esqueca-/",
    "https://www.kumon.com.br/blog/ingles1/aplicativos-aprender-ingles/",
];

// Keep aligned with server-side fallback (skipFirstN: 3)
const SKIP_FIRST_N_PARAGRAPHS_AFTER_H2 = 3;

async function postStrategistInlinks(body: {
    urlPrincipal: string;
    urlsAnalise: string[];
}): Promise<{
    status: number;
    json: StrategistInlinksResponse | { error: any };
}> {
    const res = await fetch(`${BASE_URL}/strategist/inlinks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });

    let json: unknown = null;
    try {
        json = await res.json();
    } catch {
        json = { error: "Non-JSON response from server" };
    }

    return { status: res.status, json: json as any };
}

function stripScriptsAndStyles(html: string): string {
    return html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "");
}

function beforeFirstH2(html: string): string {
    const cleaned = stripScriptsAndStyles(html);
    const idx = cleaned.search(/<h2\b[^>]*>/i);
    if (idx === -1) {
        // If there's no H2, we conservatively treat the "intro" as the full content.
        return cleaned;
    }
    return cleaned.slice(0, idx);
}

function afterFirstH2(html: string): string {
    const cleaned = stripScriptsAndStyles(html);
    const idx = cleaned.search(/<h2\b[^>]*>/i);
    if (idx === -1) return "";
    return cleaned.slice(idx);
}

function extractHrefs(htmlFragment: string): string[] {
    const hrefs: string[] = [];
    const re = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi;

    let m: RegExpExecArray | null;
    while ((m = re.exec(htmlFragment)) !== null) {
        const href = (m[1] || "").trim();
        if (!href) continue;
        hrefs.push(href);
    }

    // Normalize: drop hash-only differences for stable comparisons
    return hrefs
        .map((h) => {
            try {
                // only normalize absolute URLs
                const u = new URL(h);
                u.hash = "";
                return u.toString();
            } catch {
                return h; // relative URL, keep as-is
            }
        })
        .sort();
}

function firstNParagraphFragments(html: string, n: number): string[] {
    const cleaned = stripScriptsAndStyles(html);

    // Capture <p ...>...</p> blocks (non-greedy)
    const matches = cleaned.match(/<p\b[^>]*>[\s\S]*?<\/p>/gi) ?? [];
    return matches.slice(0, Math.max(0, n));
}

function assertHasHtmlPayload(
    payload: any,
): asserts payload is StrategistInlinksResponse {
    expect(payload).toBeTruthy();
    expect(typeof payload.originalContent).toBe("string");
    expect(typeof payload.linkedContent).toBe("string");
}

test("E2E: Strategist Inlinks must not insert links before the first H2", async () => {
    const { status, json } = await postStrategistInlinks({
        urlPrincipal: PILLAR_URL,
        urlsAnalise: SATELLITE_URLS,
    });

    if (status !== 200) {
        throw new Error(
            `Request failed: HTTP ${status}. Payload: ${JSON.stringify(json)}`,
        );
    }

    assertHasHtmlPayload(json);

    const originalHtml = json.originalContent || "";
    const linkedHtml = json.linkedContent || "";

    // Sanity: this test relies on a meaningful H2 boundary
    expect(originalHtml).toMatch(/<h2\b[^>]*>/i);

    const originalIntro = beforeFirstH2(originalHtml);
    const linkedIntro = beforeFirstH2(linkedHtml);

    // Extract href lists from intro fragments
    const originalHrefs = extractHrefs(originalIntro);
    const linkedHrefs = extractHrefs(linkedIntro);

    // Primary assertion: no new links in intro
    expect(linkedHrefs).toEqual(originalHrefs);

    // Fallback assertion: no new links in the first N paragraphs right after the first H2
    const originalAfter = afterFirstH2(originalHtml);
    const linkedAfter = afterFirstH2(linkedHtml);

    const originalFirstParas = firstNParagraphFragments(
        originalAfter,
        SKIP_FIRST_N_PARAGRAPHS_AFTER_H2,
    );
    const linkedFirstParas = firstNParagraphFragments(
        linkedAfter,
        SKIP_FIRST_N_PARAGRAPHS_AFTER_H2,
    );

    // Ensure we actually found paragraphs to validate (avoid false sense of safety)
    expect(originalFirstParas.length).toBeGreaterThan(0);

    const originalFallbackHrefs = extractHrefs(originalFirstParas.join("\n"));
    const linkedFallbackHrefs = extractHrefs(linkedFirstParas.join("\n"));

    expect(linkedFallbackHrefs).toEqual(originalFallbackHrefs);

    // Secondary sanity checks (helps debug regressions)
    expect(originalHtml.length).toBeGreaterThan(50);
    expect(linkedHtml.length).toBeGreaterThan(50);
}, // Give enough time for extraction + scoring + LLM + apply-edits
120_000);
