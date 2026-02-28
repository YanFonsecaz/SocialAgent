/**
 * Inlinks heuristics (pure, testable)
 *
 * Goals:
 * - Provide deterministic guardrails for internal link insertion quality.
 * - Keep these functions side-effect-free, so they can be unit-tested with `bun test`.
 *
 * Notes:
 * - These heuristics are intentionally conservative. Treat them as guardrails, not truth.
 * - They are language-aware primarily for Portuguese (pt-BR), but should work reasonably
 *   for mixed content.
 */

export const DEFAULT_INTRO_BLOCKS_TO_SKIP = 3;

const STOPWORDS = new Set([
    "a",
    "o",
    "os",
    "as",
    "um",
    "uma",
    "uns",
    "umas",
    "de",
    "do",
    "da",
    "dos",
    "das",
    "no",
    "na",
    "nos",
    "nas",
    "em",
    "para",
    "por",
    "com",
    "sem",
    "e",
    "ou",
    "que",
    "como",
    "mais",
    "menos",
    "sobre",
    "até",
    "entre",
    "também",
    "veja",
    "confira",
    "clique",
    "aqui",
    "saiba",
    "leia",
    "entenda",
    "descubra",
    "guia",
    "artigo",
    "conteúdo",
    "conteudo",
    "post",
]);

const TOO_GENERIC_CLUSTER_TOKENS = new Set([
    // business-ish
    "cnpj",
    "empresa",
    "abrir",
    "abertura",
    "negócio",
    "negocio",
    "processo",
    "passo",
    "passos",
    "guia",
    "como",
    "documentos",
    "documento",
    "registro",
    "formalização",
    "formalizacao",

    // english learning-ish
    "inglês",
    "ingles",
    "curso",
    "aulas",
    "aula",
    "aprender",
    "aprendizado",
    "estudar",
    "estudo",
    "método",
    "metodo",
]);

// When building "title-like" n-grams, we should NOT drop terms like "abrir"/"como"/"curso",
// because phrases like "como abrir um restaurante" are actually valid anchor matches.
// This set is only used by the n-gram fallback (phrase-level), not by token-level distinctiveness.
const NGRAM_ALLOWLIST = new Set([
    "abrir",
    "abertura",
    "como",
    "curso",
    "cursos",
    "aprender",
    "ingles",
    "inglês",
]);

// Common breadcrumb/navigation noise tokens we want to ignore when extracting "distinctive" terms.
const BREADCRUMB_TOKENS = new Set([
    "início",
    "inicio",
    "home",
    "menu",
    "blog",
    "categoria",
    "categorias",
    "sobre",
]);

/**
 * Extracts candidate "title-like" phrases from the beginning of the content.
 *
 * Motivation:
 * Some sites prepend breadcrumb-like headings ("Início » ...") and the real title
 * may be near the top. For anchor↔destination coherence we want a robust fallback
 * that accepts anchors matching the destination title/slug semantics even if
 * token-frequency heuristics are noisy.
 *
 * We generate n-grams (2-5 words) from the early slice, excluding stopwords/noise.
 */
function extractTitleNGrams(candidateContent: string): string[] {
    const earlySlice = candidateContent.slice(0, 700);

    // Tokenize with existing rules, but keep certain "generic" terms that are
    // essential to match common destination-title phrases (e.g., "como abrir um restaurante").
    const tokens = tokenizeNoStopwords(earlySlice)
        // remove generic cluster terms EXCEPT allowlisted ones for phrase matching
        .filter(
            (t) => !TOO_GENERIC_CLUSTER_TOKENS.has(t) || NGRAM_ALLOWLIST.has(t),
        )
        // remove breadcrumb noise
        .filter((t) => !BREADCRUMB_TOKENS.has(t));

    if (tokens.length === 0) return [];

    const grams = new Set<string>();

    // Build 2-5 word n-grams
    const minN = 2;
    const maxN = 5;

    for (let i = 0; i < tokens.length; i++) {
        for (let n = minN; n <= maxN; n++) {
            const slice = tokens.slice(i, i + n);
            if (slice.length !== n) continue;

            // Avoid n-grams that are still too generic (all tokens are allowlisted)
            // unless they contain a non-allowlisted "topic" token like "restaurante".
            const hasTopicToken = slice.some((t) => !NGRAM_ALLOWLIST.has(t));
            if (!hasTopicToken) continue;

            grams.add(slice.join(" "));
        }
    }

    // Return a small list (stable order) to avoid over-accepting
    return Array.from(grams).slice(0, 80);
}

export function normalizeForTokens(value: string): string {
    return value
        .toLowerCase()
        .replace(/\u00a0/g, " ")
        .replace(/[^a-z0-9áéíóúãõâêîôûàç\s]+/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
}

export function tokenizeNoStopwords(value: string): string[] {
    return normalizeForTokens(value)
        .split(" ")
        .map((t) => t.trim())
        .filter(
            (t) => t.length > 2 && !STOPWORDS.has(t) && !BREADCRUMB_TOKENS.has(t),
        );
}

/**
 * Detects if a pillar content is likely "getting started"/early-stage.
 * Used to prevent suggesting advanced steps too early.
 */
export function isEarlyStageGettingStarted(text: string): boolean {
    const v = normalizeForTokens(text);

    const patterns: RegExp[] = [
        /\bpasso a passo\b/i,
        /\bcomo (abrir|fazer|criar|começar)\b/i,
        /\bprimeiros passos\b/i,
        /\biniciar\b/i,
        /\bantes de\b/i,
        /\bintrodu[cç][aã]o\b/i,

        // business onboarding signals
        /\babrir (um|uma)?\s*(cnpj|empresa)\b/i,
        /\babrir cnpj\b/i,
        /\bformalizar\b/i,

        // learning onboarding signals
        /\bcomo aprender\b/i,
        /\bcome[cç]ar (a|o)?\s*(aprender|estudar)\b/i,
        /\bdo zero\b/i,
        /\biniciante(s)?\b/i,
    ];

    return patterns.some((re) => re.test(v));
}

/**
 * Detects content that often requires prerequisites (later-stage),
 * and thus can be inappropriate for early-stage pillars/introductions.
 *
 * IMPORTANT: This is a heuristic; it should be applied conditionally.
 */
export function isLaterStageOrPrereqHeavy(text: string): boolean {
    const v = normalizeForTokens(text);

    /**
     * IMPORTANT:
     * This heuristic is a *guardrail* for business onboarding pillars (ex: "como abrir CNPJ"),
     * intended to block insertions that imply prerequisites (already having CNPJ/empresa)
     * or that pull the reader into administrative/advanced detours too early.
     *
     * We keep it focused on *strong* prerequisite signals (debts/certificates/negative status),
     * and we avoid flagging generic "como abrir X" guides as advanced just because they mention
     * operational concepts like CNAE/ICMS in passing.
     */
    const strongPrereqPatterns: RegExp[] = [
        // Strong signals that usually require an existing entity or indicate admin detours
        /\bconsultar (d[ií]vidas|pend[eê]ncias)\b/i,
        /\bd[ií]vida(s)? no cnpj\b/i,
        /\bpend[eê]ncia(s)? no cnpj\b/i,
        /\bregularizar\b/i,
        /\bcertid[aã]o\b/i,
        /\bcnd\b/i,
        /\bprotesto\b/i,
        /\bnegativad[ao]\b/i,
        /\bcobran[cç]a\b/i,
        /\bparcelamento\b/i,
        /\brestri[cç][aã]o\b/i,
        /\binadimpl[eê]ncia\b/i,
    ];

    // If the page is itself a "como abrir" / getting-started guide, we should not treat it
    // as later-stage only because it mentions CNAE/ICMS/inscrição estadual.
    const isHowToOpenGuide =
        /\bcomo abrir\b/i.test(v) ||
        /\bpasso a passo\b/i.test(v) ||
        /\bguia completo\b/i.test(v);

    if (isHowToOpenGuide) {
        return strongPrereqPatterns.some((re) => re.test(v));
    }

    // Outside "como abrir" guides, allow a slightly broader set of admin/after-opening signals.
    const broaderAdminPatterns: RegExp[] = [
        ...strongPrereqPatterns,

        // Changes/operations that typically happen after opening (only when not a how-to guide)
        /\balterar\b/i,
        /\b(cnae|inscri[cç][aã]o estadual|icms)\b/i,
        /\bemiss[aã]o de nota\b/i,
    ];

    return broaderAdminPatterns.some((re) => re.test(v));
}

/**
 * Extracts a small list of "distinctive" tokens from candidate content.
 * This is used to enforce anchor↔destination coherence beyond generic cluster terms.
 */
export function extractDistinctiveTokens(candidateContent: string): string[] {
    // Heuristic improvements:
    // - remove breadcrumb/navigation tokens ("início", "blog", etc.)
    // - remove generic cluster terms
    // - prioritize title/slug-like tokens by over-weighting early text
    //
    // NOTE: we don't have access to the real URL slug here, so we approximate by:
    // - taking the first ~400 chars (where titles/breadcrumbs often appear)
    // - and the next ~2000 chars (body) separately, and ranking tokens that appear early.

    const earlySlice = candidateContent.slice(0, 400);
    const bodySlice = candidateContent.slice(0, 2400);

    const earlyTokens = tokenizeNoStopwords(earlySlice).filter(
        (t) => !TOO_GENERIC_CLUSTER_TOKENS.has(t),
    );
    const bodyTokens = tokenizeNoStopwords(bodySlice).filter(
        (t) => !TOO_GENERIC_CLUSTER_TOKENS.has(t),
    );

    // Frequency table across the body
    const freq = new Map<string, number>();
    for (const t of bodyTokens) freq.set(t, (freq.get(t) ?? 0) + 1);

    // Bonus for tokens that appear in the early slice (likely title/slug-ish)
    const earlySet = new Set(earlyTokens);

    const scored = [...freq.entries()]
        .map(([t, count]) => {
            // lower count is often more specific; early presence is a strong signal
            const earlyBonus = earlySet.has(t) ? 2 : 0;
            const score = earlyBonus * 100 - count; // higher is better
            return { t, count, score };
        })
        // drop anything that still looks like breadcrumb noise after tokenization
        .filter(({ t }) => !BREADCRUMB_TOKENS.has(t))
        .sort((a, b) => b.score - a.score)
        .map(({ t }) => t);

    // keep a small set to reduce false positives
    return scored.slice(0, 8);
}

/**
 * Returns true if the anchor contains at least one distinctive token
 * found in the candidate destination content.
 */
export function anchorContainsDistinctiveToken(
    anchor: string,
    candidateContent: string,
): boolean {
    const aTokens = new Set(tokenizeNoStopwords(anchor));
    if (aTokens.size === 0) return false;

    const distinctive = extractDistinctiveTokens(candidateContent);

    // Primary: token-level distinctive match
    if (distinctive.length > 0 && distinctive.some((t) => aTokens.has(t))) {
        return true;
    }

    // Fallback: title n-grams match (phrase-level)
    // Accept if the normalized anchor contains any "title-like" n-gram.
    const anchorNorm = normalizeForTokens(anchor);
    if (!anchorNorm) return false;

    const grams = extractTitleNGrams(candidateContent);
    if (grams.length === 0) return false;

    // Conservative phrase-level fallback:
    // Accept only if the anchor is clearly tied to the destination title/slug semantics.
    //
    // Rules:
    // 1) Anchor must match (be contained in) some "title-like" n-gram extracted from the destination
    //    (or vice-versa, i.e., the n-gram contains the anchor). This avoids accepting generic anchors
    //    like "curso de inglês" just because they appear somewhere in the destination text.
    // 2) Additionally, require either:
    //    - at least one token-level distinctive match (handled above), OR
    //    - the anchor matches a title-like n-gram (this block).
    //
    // This keeps the fallback useful for cases like "como abrir um restaurante" but avoids
    // over-accepting broad anchors.
    const candidateNorm = normalizeForTokens(candidateContent);

    // Extract title-like n-grams and accept when the anchor aligns with one of them.
    // We check both directions to handle anchors shorter than the title phrase.
    const matchesTitlePhrase = grams.some((g) => {
        const gNorm = normalizeForTokens(g);
        if (!gNorm) return false;
        return gNorm.includes(anchorNorm) || anchorNorm.includes(gNorm);
    });

    if (!matchesTitlePhrase) return false;

    // Extra guard: the title phrase should actually be present in the destination content.
    // (This protects against noisy n-gram generation.)
    return grams.some((g) => candidateNorm.includes(normalizeForTokens(g)));
}

/**
 * Computes token overlap between anchor and candidate content (stopwords removed).
 * Helpful as a weaker alignment metric (distinctive token check is stronger).
 */
export function anchorTokenOverlap(
    anchor: string,
    candidateContent: string,
): { overlapCount: number; anchorTokenCount: number } {
    const aTokens = tokenizeNoStopwords(anchor);
    if (aTokens.length === 0) return { overlapCount: 0, anchorTokenCount: 0 };

    const cTokens = new Set(tokenizeNoStopwords(candidateContent));

    let overlap = 0;
    for (const t of aTokens) if (cTokens.has(t)) overlap++;

    return { overlapCount: overlap, anchorTokenCount: aTokens.length };
}

/**
 * Conservative filter for low-signal or generic anchors.
 * (Kept here because it's part of "anchor quality" heuristics.)
 */
export function isGenericAnchor(anchor: string): boolean {
    const a = anchor
        .toLowerCase()
        .replace(/\u00a0/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    if (!a) return true;

    const genericPhrases = new Set([
        "clique aqui",
        "aqui",
        "saiba mais",
        "leia mais",
        "neste link",
        "confira",
        "veja",
        "acesse",
        "entenda",
        "descubra",
    ]);
    if (genericPhrases.has(a)) return true;

    const vaguePatterns: RegExp[] = [
        /^modelo\s*\d{4}$/i,
        /^modelos?\s*(mais)?\s*(recentes|novos|antigos)?$/i,
        /^opções?\s*(disponíveis)?$/i,
        /^opcoes?\s*(disponiveis)?$/i,
        /^lista\s*(completa)?$/i,
        /^artigo$/i,
        /^conteúdo$/i,
        /^conteudo$/i,
        /^post$/i,
        /^guia$/i,
        /^veja\s*(a)?\s*lista$/i,
    ];
    if (vaguePatterns.some((re) => re.test(a))) return true;

    const wordCount = a.split(" ").filter(Boolean).length;
    if (wordCount < 2) return true;

    if (/^\d+$/i.test(a)) return true;

    return false;
}
