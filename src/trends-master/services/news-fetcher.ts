import { fetchWithRetry } from "./http-utils";
import { mapWithConcurrency } from "./concurrency";
import type { NewsArticle, NewsResult, TrendsPeriod } from "../types";
import { extractTextFromHtml } from "../../use-case/extract-content";
import { summarizeArticle } from "../agents/content-analysis-agent";

type SerpApiNewsResponse = {
  news_results?: Array<{
    title?: string;
    link?: string;
    source?: string | { name?: string };
    date?: string;
    snippet?: string;
    thumbnail?: string;
  }>;
};

const SERPAPI_BASE_URL = "https://serpapi.com/search";
const SERPAPI_TIMEOUT_MS = 12_000;
const MAX_CONCURRENCY = 6;

function getPeriodWhenParam(periodo: TrendsPeriod): string {
  switch (periodo) {
    case "diario":
      return "1d";
    case "semanal":
      return "7d";
    case "mensal":
      return "1m";
    default:
      return "1m";
  }
}

function normalizeSource(source?: string | { name?: string }): string {
  if (!source) return "Google News";
  if (typeof source === "string") return source;
  return source.name || "Google News";
}

function dedupeArticles(articles: NewsArticle[]): NewsArticle[] {
  const seen = new Set<string>();
  return articles.filter((article) => {
    const key = `${article.link}|${article.title}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function fetchSerpApiNews(
  params: Record<string, string>,
): Promise<SerpApiNewsResponse> {
  const apiKey = process.env.SERPAPI_API_KEY;
  if (!apiKey) {
    throw new Error("SERPAPI_API_KEY não configurada no ambiente.");
  }

  const searchParams = new URLSearchParams({ ...params, api_key: apiKey });
  const url = `${SERPAPI_BASE_URL}?${searchParams.toString()}`;

  const data = await fetchWithRetry<SerpApiNewsResponse>(
    url,
    {},
    { timeoutMs: SERPAPI_TIMEOUT_MS },
  );

  return data || {};
}

async function summarizeNewsSnippet(
  link: string,
  fallbackSnippet: string,
): Promise<string> {
  try {
    const content = await extractTextFromHtml(link);
    if (content && content.length > 200) {
      const summary = await summarizeArticle(content);
      if (summary) return summary;
    }
  } catch {
    // fallback below
  }

  return fallbackSnippet || "";
}

async function fetchNewsForKeyword(
  keyword: string,
  maxArticles: number,
  periodo: TrendsPeriod,
): Promise<NewsArticle[]> {
  const data = await fetchSerpApiNews({
    engine: "google_news",
    q: keyword,
    num: String(maxArticles),
    sort_by: "date",
    gl: "br",
    hl: "pt-BR",
    when: getPeriodWhenParam(periodo),
  });

  const results = data.news_results || [];
  const limited = results.slice(0, maxArticles);

  const articles = await mapWithConcurrency(
    limited,
    { concurrency: Math.min(MAX_CONCURRENCY, limited.length || 1) },
    async (item) => {
      const title = item.title || "Sem título";
      const link = item.link || "";
      const source = normalizeSource(item.source);
      const date = item.date || new Date().toISOString();
      const snippet = item.snippet || "";

      let finalSnippet = snippet;

      if (link) {
        finalSnippet = await summarizeNewsSnippet(link, snippet);
      }

      return {
        title,
        link,
        source,
        date,
        snippet: finalSnippet,
        thumbnail: item.thumbnail,
      };
    },
  );

  return dedupeArticles(articles);
}

export async function fetchNews(
  keywords: string[],
  maxArticles: number = 3,
  periodo: TrendsPeriod = "mensal",
): Promise<NewsResult[]> {
  if (!keywords || keywords.length === 0) return [];

  return mapWithConcurrency(
    keywords,
    { concurrency: Math.min(MAX_CONCURRENCY, keywords.length) },
    async (keyword) => {
      try {
        const articles = await fetchNewsForKeyword(keyword, maxArticles, periodo);
        return { keyword, articles };
      } catch (error) {
        console.error(
          `[SerpAPI News] Erro ao buscar notícias para "${keyword}":`,
          error,
        );
        return { keyword, articles: [] };
      }
    },
  );
}

export async function fetchNewsForTerm(
  term: string,
  maxArticles: number = 5,
  periodo: TrendsPeriod = "mensal",
): Promise<NewsResult> {
  try {
    const articles = await fetchNewsForKeyword(term, maxArticles, periodo);
    return { keyword: term, articles };
  } catch (error) {
    console.error(
      `[SerpAPI News] Erro ao buscar notícias para "${term}":`,
      error,
    );
    return { keyword: term, articles: [] };
  }
}
