import { test, expect } from "bun:test";

/**
 * E2E negative tests for Strategist Inlinks.
 *
 * Focus:
 * - Request validation (422) for malformed inputs
 * - Dedupe behavior (including principal URL included among satellites)
 * - "No eligible blocks" behavior should NOT crash (should return 200 with rejections)
 *
 * Notes:
 * - These tests are designed to be resilient and not depend on exact model output.
 * - They assume the backend is reachable and configured (DB, keys, etc.).
 */

type ApiErrorPayload = {
  success?: boolean;
  error?: string;
  details?: unknown;
};

type InlinksRejected = {
  url: string;
  reason: string;
  score?: number;
};

type StrategistInlinksResponse = {
  message?: string;
  principalUrl?: string;
  totalAnalise?: number;

  // Back-compat fields
  totalSelecionadas?: number;
  selecionadas?: Array<{ url: string; sentence: string; anchor: string }>;
  rejeitadas?: InlinksRejected[];

  // Debugging payloads (optional)
  blocks?: unknown[];
  edits?: unknown[];

  // HTML payloads (optional)
  originalContent?: string;
  linkedContent?: string;
  modifiedContent?: string;
};

const BASE_URL =
  (process.env.SOCIAL_AGENT_E2E_BASE_URL || "").trim() ||
  "http://localhost:3333";

async function postInlinksRaw(body: unknown): Promise<{
  status: number;
  json: StrategistInlinksResponse | ApiErrorPayload | { error: unknown };
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

function isValidationError(payload: unknown): payload is ApiErrorPayload {
  if (!payload || typeof payload !== "object") return false;
  const p = payload as any;
  return p.error === "VALIDATION" || p.success === false;
}

function assertOkResponse(payload: unknown): asserts payload is StrategistInlinksResponse {
  expect(payload).toBeTruthy();
  expect(typeof (payload as any).message).toBe("string");
  // principalUrl may be present depending on implementation
}

test("E2E negative: validation rejects missing urlPrincipal", async () => {
  const { status, json } = await postInlinksRaw({
    // urlPrincipal missing
    urlsAnalise: ["https://www.kumon.com.br/blog/ingles1/curso-intensivo-de-ingles/"],
  });

  expect(status).toBe(422);
  expect(isValidationError(json)).toBe(true);
});

test("E2E negative: validation rejects empty urlsAnalise", async () => {
  const { status, json } = await postInlinksRaw({
    urlPrincipal: "https://www.kumon.com.br/cursos/curso-de-ingles/",
    urlsAnalise: [],
  });

  expect(status).toBe(422);
  expect(isValidationError(json)).toBe(true);
});

test("E2E negative: validation rejects invalid URLs", async () => {
  const { status, json } = await postInlinksRaw({
    urlPrincipal: "not-a-url",
    urlsAnalise: ["also-not-a-url"],
  });

  expect(status).toBe(422);
  expect(isValidationError(json)).toBe(true);
});

test("E2E negative: dedupe removes principal URL if included among satellites", async () => {
  const principal = "https://www.kumon.com.br/cursos/curso-de-ingles/";
  const satellite = "https://www.kumon.com.br/blog/ingles1/curso-intensivo-de-ingles/";

  const { status, json } = await postInlinksRaw({
    urlPrincipal: principal,
    urlsAnalise: [
      principal, // should be filtered out
      principal, // duplicates should be removed too
      satellite,
      satellite, // duplicates should be removed
    ],
  });

  expect(status).toBe(200);
  assertOkResponse(json);

  // totalAnalise should reflect only the deduped, filtered satellites (expected: 1)
  if (typeof (json as any).totalAnalise === "number") {
    expect((json as any).totalAnalise).toBe(1);
  }

  // If the API returns `rejeitadas`, ensure it doesn't list the principal as a candidate.
  const rejeitadas = (json as any).rejeitadas as InlinksRejected[] | undefined;
  if (Array.isArray(rejeitadas)) {
    const normalized = (u: string) => {
      try {
        const url = new URL(u);
        url.hash = "";
        url.search = "";
        url.pathname = url.pathname.replace(/\/+$/, "");
        return url.toString();
      } catch {
        return u;
      }
    };

    const principalNorm = normalized(principal);
    expect(rejeitadas.some((r) => normalized(r.url) === principalNorm)).toBe(false);
  }
});

test(
  "E2E negative: no eligible blocks should return 200 with rejections (not 500)",
  async () => {
    /**
     * We need a pillar page where, after intro protections, there are effectively no eligible blocks:
     * - No <h2> OR
     * - No paragraph/list blocks after the first <h2> OR
     * - Everything already contains links
     *
     * In practice, this can vary by content. We use a controllable strategy:
     * - Point principal to a minimal HTML endpoint isn't possible here (server extracts remote HTML).
     * - So we pick a page that commonly lacks H2 / has limited content.
     *
     * If this URL changes, override by setting:
     *   STRATEGIST_INLINKS_E2E_MINIMAL_URL
     */
    const minimalPrincipal =
      (process.env.STRATEGIST_INLINKS_E2E_MINIMAL_URL || "").trim() ||
      "https://example.com/";

    const { status, json } = await postInlinksRaw({
      urlPrincipal: minimalPrincipal,
      urlsAnalise: ["https://www.kumon.com.br/blog/ingles1/curso-intensivo-de-ingles/"],
    });

    // We accept either:
    // - 200: graceful response with rejeitadas explaining lack of eligible blocks
    // - 500: would indicate a regression (this test should catch it)
    expect(status).toBe(200);

    assertOkResponse(json);

    // Prefer to assert we got rejections and/or zero selections when no eligible blocks
    if (typeof (json as any).totalSelecionadas === "number") {
      expect((json as any).totalSelecionadas).toBe(0);
    }

    const rejeitadas = (json as any).rejeitadas as InlinksRejected[] | undefined;
    if (Array.isArray(rejeitadas)) {
      expect(rejeitadas.length).toBeGreaterThan(0);

      // Look for a reason that indicates "no eligible blocks" or intro protection
      const reasons = rejeitadas.map((r) => r.reason || "").join(" | ");
      expect(reasons.length).toBeGreaterThan(0);
    }
  },
  120_000,
);
