import { test, expect } from "bun:test";

/**
 * E2E contract test for Strategist Inlinks.
 *
 * Validates, using the API "blocks/edits" contract (not HTML diffs), that:
 *  - No edit targets a block that appears before the first H2 in the pillar content.
 *  - No edit targets a block that is within the first N paragraph/list blocks after the first H2
 *    (fallback intro protection).
 *
 * This complements the HTML-based E2E test by asserting invariants at the block-graph layer.
 *
 * Run (with backend up or via harness):
 *   SOCIAL_AGENT_E2E_BASE_URL="http://localhost:3333" bun test SocialAgent/scripts/e2e-strategist-inlinks.contract.test.ts
 *
 * Env:
 *  - SOCIAL_AGENT_E2E_BASE_URL: defaults to http://localhost:3333
 */

type InlinksBlockType =
  | "heading"
  | "paragraph"
  | "list_item"
  | "blockquote"
  | "code"
  | "other";

type InlinksBlock = {
  id: string;
  type: InlinksBlockType;
  tag: string;
  text: string;
  html: string;
  path: string;
  containsLink: boolean;
  charStart: number;
  charEnd: number;
};

type BlockEdit = {
  blockId: string;
  targetUrl: string;
  anchor: string;
  originalBlockText: string;
  modifiedBlockText: string;
  overwriteBlock: boolean;
  justification?: string;
  metrics?: { relevance: number; authority: number };
};

type StrategistInlinksResponse = {
  message?: string;
  principalUrl?: string;

  blocks?: InlinksBlock[];
  edits?: BlockEdit[];

  // 3-column HTML payloads (not required for this contract test)
  originalContent?: string;
  linkedContent?: string;
  modifiedContent?: string;

  // Back-compat
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

// Keep aligned with server-side configuration in `src/http/routes/strategist-inlinks.ts`:
//   toPrincipalBlocks(..., { avoidBeforeFirstH2: true, skipFirstN: 3 })
const SKIP_FIRST_N_BLOCKS_AFTER_H2 = 3;

async function postStrategistInlinks(body: {
  urlPrincipal: string;
  urlsAnalise: string[];
}): Promise<{ status: number; json: StrategistInlinksResponse | { error: any } }> {
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

function assertHasBlocksAndEdits(
  payload: unknown,
): asserts payload is StrategistInlinksResponse & {
  blocks: InlinksBlock[];
  edits: BlockEdit[];
} {
  expect(payload).toBeTruthy();
  expect(Array.isArray((payload as any).blocks)).toBe(true);
  expect(Array.isArray((payload as any).edits)).toBe(true);
}

function indexBlocksById(blocks: InlinksBlock[]): Map<string, InlinksBlock> {
  const map = new Map<string, InlinksBlock>();
  for (const b of blocks) map.set(b.id, b);
  return map;
}

function findFirstH2Index(blocks: InlinksBlock[]): number {
  return blocks.findIndex((b) => b.type === "heading" && b.tag === "h2");
}

function collectEligibleBlockIdsAfterFirstH2(
  blocks: InlinksBlock[],
  skipFirstN: number,
): Set<string> {
  const firstH2Index = findFirstH2Index(blocks);
  if (firstH2Index < 0) return new Set<string>();

  // Determine the document-order slice after (and including) the first H2
  const after = blocks.slice(firstH2Index);

  // Only paragraph-like blocks are eligible for linking edits in this system
  const paragraphLike = after.filter(
    (b) => b.type === "paragraph" || b.type === "list_item",
  );

  // Apply fallback "skip first N paragraph-like blocks"
  const eligible = paragraphLike.slice(Math.max(0, skipFirstN));

  return new Set(eligible.map((b) => b.id));
}

test(
  "E2E contract: edits must target blocks after first H2 and after fallback skip window",
  async () => {
    const { status, json } = await postStrategistInlinks({
      urlPrincipal: PILLAR_URL,
      urlsAnalise: SATELLITE_URLS,
    });

    if (status !== 200) {
      throw new Error(
        `Request failed: HTTP ${status}. Payload: ${JSON.stringify(json)}`,
      );
    }

    assertHasBlocksAndEdits(json);

    const blocks = json.blocks;
    const edits = json.edits;

    // Sanity: we expect to have at least one H2 so the "intro" boundary exists.
    const firstH2Index = findFirstH2Index(blocks);
    expect(firstH2Index).toBeGreaterThanOrEqual(0);

    const blocksById = indexBlocksById(blocks);
    const eligibleIds = collectEligibleBlockIdsAfterFirstH2(
      blocks,
      SKIP_FIRST_N_BLOCKS_AFTER_H2,
    );

    // We don't require edits to exist (depending on heuristics, the agent may reject all),
    // but if edits exist, they MUST obey the contract.
    for (const e of edits) {
      const b = blocksById.get(e.blockId);
      expect(b).toBeDefined();

      // The edit must target a paragraph-like block
      expect(b?.type === "paragraph" || b?.type === "list_item").toBe(true);

      // Critical assertions:
      // - not before first H2
      // - not inside the fallback skip window after H2
      expect(eligibleIds.has(e.blockId)).toBe(true);
    }

    // Extra sanity checks (non-brittle)
    expect(blocks.length).toBeGreaterThan(0);
    expect(typeof json.principalUrl === "string" || json.principalUrl === undefined).toBe(true);
  },
  120_000,
);
