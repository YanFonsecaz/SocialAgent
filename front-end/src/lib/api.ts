// ---- Social Agent API ----

export interface SocialAgentRequest {
  url: string;
  intent?: string;
  query?: string;
  tone?: string;
}

export interface SocialAgentResponse {
  response: string;
  sources: string[];
}

/** Envia a URL para o Social Agent e retorna o conteúdo gerado. */
export async function runSocialAgent(
  data: SocialAgentRequest,
): Promise<SocialAgentResponse> {
  const response = await fetch("http://localhost:3333/social-agent", {
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
  const response = await fetch("http://localhost:3333/strategist/inlinks", {
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
