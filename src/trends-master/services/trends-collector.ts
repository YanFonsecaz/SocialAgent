import { envValid } from "../../envSchema";
import { mapWithConcurrency } from "./concurrency";
import { fetchWithRetry } from "./http-utils";
import { TrendsPeriod, TrendItem } from "../types";
import { validateTrendRelevance } from "../agents/content-analysis-agent";

const SERPAPI_BASE_URL = "https://serpapi.com/search";
const SERPAPI_TIMEOUT_MS = 10000;

type SerpApiResponse = {
  search_metadata?: {
    status?: string;
  };
  trending_searches?: Array<{
    query?: string;
    search_volume?: number;
  }>;
  related_queries?: {
    top?: Array<{ query?: string; extracted_value?: number; value?: string }>;
    rising?: Array<{ query?: string; extracted_value?: number; value?: string }>;
  };
};

const PERIOD_LABEL: Record<TrendsPeriod, string> = {
  // SerpAPI aceita "now X-d" (sem hífen). Com hífen ("now 1-d") retorna:
  // { "error": "Invalid date format." }
  diario: "now 1d",
  semanal: "now 7d",
  mensal: "now 30d",
};

function getPeriodDateParam(periodo: TrendsPeriod): string {
  return PERIOD_LABEL[periodo] ?? "now 30-d";
}

function buildSerpApiUrl(params: Record<string, string>): string {
  const searchParams = new URLSearchParams({
    ...params,
    api_key: envValid.SERPAPI_API_KEY,
  });
  return `${SERPAPI_BASE_URL}?${searchParams.toString()}`;
}

async function fetchSerpApi<T>(params: Record<string, string>): Promise<T> {
  const url = buildSerpApiUrl(params);
  const data = await fetchWithRetry<T>(
    url,
    { method: "GET" },
    { timeoutMs: SERPAPI_TIMEOUT_MS },
    {
      maxRetries: 3,
      initialDelayMs: 1000,
      maxDelayMs: 8000,
    },
  );
  return data;
}

function normalizeCategoryTerms(category: string): string[] {
  return category
    .toLowerCase()
    .split(" ")
    .map((t) => t.trim())
    .filter((t) => t.length > 2);
}

async function collectTrendingNow(
  category: string,
  topN: number,
): Promise<TrendItem[]> {
  const data = await fetchSerpApi<SerpApiResponse>({
    engine: "google_trends_trending_now",
    geo: "BR",
    hl: "pt",
  });

  const trendingSearches = data.trending_searches ?? [];
  if (trendingSearches.length === 0) return [];

  const normalizedCat = category.toLowerCase().trim();
  const catTerms = normalizeCategoryTerms(category);

  const candidates = trendingSearches.filter((s) => {
    const query = (s.query ?? "").toLowerCase();
    return catTerms.some((term) => query.includes(term));
  });

  const validated = await mapWithConcurrency(
    candidates.slice(0, 15),
    { concurrency: 5 },
    async (item) => {
      const isValid = await validateTrendRelevance(item.query ?? "", category);
      return isValid ? item : null;
    },
  );

  const validatedItems = validated.filter(
    (item): item is NonNullable<typeof item> => !!item,
  );

  const finalItems =
    validatedItems.length > 0
      ? validatedItems
      : trendingSearches.filter((s) => {
          const query = (s.query ?? "").toLowerCase();
          if (catTerms.length > 1) {
            return catTerms.every((term) => query.includes(term));
          }
          return query.includes(normalizedCat);
        });

  return finalItems.slice(0, topN).map((item) => ({
    keyword: item.query ?? "",
    type: "top",
    score: item.search_volume?.toString(),
  }));
}

async function collectRelatedQueries(
  baseQuery: string,
  periodo: TrendsPeriod,
  topN: number,
  risingN: number,
  seen: Set<string>,
): Promise<TrendItem[]> {
  const data = await fetchSerpApi<SerpApiResponse>({
    engine: "google_trends",
    data_type: "RELATED_QUERIES",
    q: baseQuery,
    hl: "pt",
    geo: "BR",
    date: getPeriodDateParam(periodo),
  });

  if (data.search_metadata?.status !== "Success") {
    return [];
  }

  const related = data.related_queries ?? {};
  const results: TrendItem[] = [];

  for (const item of (related.top ?? []).slice(0, topN)) {
    const query = item.query;
    if (!query || seen.has(query)) continue;
    seen.add(query);
    results.push({
      keyword: query,
      type: "top",
      score: item.extracted_value ?? item.value,
    });
  }

  for (const item of (related.rising ?? []).slice(0, risingN)) {
    const query = item.query;
    if (!query || seen.has(query)) continue;
    seen.add(query);
    results.push({
      keyword: query,
      type: "rising",
      score: item.extracted_value ?? item.value,
    });
  }

  return results;
}

function buildBaseQueries(sector: string, customTopics?: string[]): string[] {
  if (customTopics && customTopics.length > 0) {
    return customTopics;
  }

  const queries = [sector];
  const normalized = sector.toLowerCase().trim();

  if (!normalized.includes("brasil") && !normalized.includes("mercado")) {
    queries.push(`${sector} brasil`);
  }

  return queries;
}

export async function collectTrends(
  sector: string,
  periodo: TrendsPeriod,
  topN: number,
  risingN: number,
  customTopics?: string[],
): Promise<TrendItem[]> {
  const results: TrendItem[] = [];
  const seen = new Set<string>();

  try {
    const baseQueries = buildBaseQueries(sector, customTopics);

    if (periodo === "diario" && (!customTopics || customTopics.length === 0)) {
      const trendingNow = await collectTrendingNow(sector, topN * 2);
      if (trendingNow.length > 0) {
        results.push(...trendingNow.slice(0, topN));
      }
    }

    for (const query of baseQueries) {
      const related = await collectRelatedQueries(
        query,
        periodo,
        topN,
        risingN,
        seen,
      );
      results.push(...related);

      if (results.length >= (topN + risingN) * 2) break;
    }

    if (results.length === 0 && customTopics && customTopics.length > 0) {
      return customTopics.map((topic) => ({ keyword: topic, type: "top" }));
    }

    return results;
  } catch (error) {
    console.error("[Trends Master] Erro ao coletar trends:", error);
    if (customTopics && customTopics.length > 0) {
      return customTopics.map((topic) => ({ keyword: topic, type: "top" }));
    }
    return [];
  }
}
