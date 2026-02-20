import { envValid } from "../../envSchema";
import { fetchWithRetry } from "./http-utils";

type SerpApiParams = Record<string, string>;

const CACHE_TTL_MS = 60 * 60 * 1000;
const cache = new Map<string, { data: unknown; timestamp: number }>();

function getCacheKey(params: SerpApiParams): string {
  const searchParams = new URLSearchParams(params);
  return searchParams.toString();
}

function sanitizeUrl(url: string): string {
  return url.replace(/api_key=[^&]+/i, "api_key=HIDDEN");
}

/**
 * Cliente SerpAPI com cache, retry e timeout.
 */
export async function fetchSerpApi<T = unknown>(
  params: SerpApiParams,
  options?: { timeoutMs?: number },
): Promise<T> {
  if (!envValid.SERPAPI_API_KEY) {
    throw new Error("SERPAPI_API_KEY não configurada no ambiente.");
  }

  const searchParams = new URLSearchParams({
    ...params,
    api_key: envValid.SERPAPI_API_KEY,
  });

  const cacheKey = getCacheKey(params);
  const now = Date.now();
  const cached = cache.get(cacheKey);

  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    console.log(`[SerpAPI Cache] Hit: ${params.q || params.engine}`);
    return cached.data as T;
  }

  const url = `https://serpapi.com/search?${searchParams.toString()}`;
  console.log(`[SerpAPI] Calling: ${sanitizeUrl(url)}`);

  const data = await fetchWithRetry<T>(
    url,
    { method: "GET" },
    { timeoutMs: options?.timeoutMs ?? 10000 },
    {
      maxRetries: 3,
      initialDelayMs: 1000,
      maxDelayMs: 8000,
    },
  );

  cache.set(cacheKey, { data, timestamp: now });

  if (cache.size > 200) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) cache.delete(oldestKey);
  }

  return data;
}
