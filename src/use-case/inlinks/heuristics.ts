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
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
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

  const patterns: RegExp[] = [
    // business later-stage / prerequisites
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
    /\balterar\b/i,
    /\b(cnae|inscri[cç][aã]o estadual|icms)\b/i,
    /\bemiss[aã]o de nota\b/i,

    // learning later-stage
    /\bfluente\b/i,
    /\bprofici[eê]ncia\b/i,
    /\bavançad[ao]\b/i,
    /\bintermedi[aá]ri[ao]\b/i,
    /\btoefl\b/i,
    /\bielts\b/i,
  ];

  return patterns.some((re) => re.test(v));
}

/**
 * Extracts a small list of "distinctive" tokens from candidate content.
 * This is used to enforce anchor↔destination coherence beyond generic cluster terms.
 */
export function extractDistinctiveTokens(candidateContent: string): string[] {
  const tokens = tokenizeNoStopwords(candidateContent);

  const freq = new Map<string, number>();
  for (const t of tokens) freq.set(t, (freq.get(t) ?? 0) + 1);

  const sorted = [...freq.entries()]
    .filter(([t]) => !TOO_GENERIC_CLUSTER_TOKENS.has(t))
    // prefer tokens that appear less frequently in the excerpt
    .sort((a, b) => a[1] - b[1])
    .map(([t]) => t);

  // keep a small set to reduce false positives
  return sorted.slice(0, 8);
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
  if (distinctive.length === 0) return false;

  return distinctive.some((t) => aTokens.has(t));
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
