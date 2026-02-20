export type RetryOptions = {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  retryOn?: (status: number) => boolean;
};

export type TimeoutOptions = {
  timeoutMs: number;
};

const defaultRetryOn = (status: number) =>
  status === 429 || (status >= 500 && status <= 599);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function computeDelay(attempt: number, initialDelayMs: number, maxDelayMs: number) {
  const delay = initialDelayMs * Math.pow(2, attempt);
  return Math.min(delay, maxDelayMs);
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  { timeoutMs }: TimeoutOptions
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(input, {
      ...init,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function fetchWithRetry<T = unknown>(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeout: TimeoutOptions,
  retry: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelayMs = 1000,
    maxDelayMs = 8000,
    retryOn = defaultRetryOn,
  } = retry;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetchWithTimeout(input, init, timeout);

      if (!response.ok) {
        if (retryOn(response.status) && attempt < maxRetries) {
          const delay = computeDelay(attempt, initialDelayMs, maxDelayMs);
          await sleep(delay);
          continue;
        }

        const error: any = new Error(
          `HTTP error: ${response.status} ${response.statusText}`
        );
        error.status = response.status;
        error.body = await safeReadText(response);
        throw error;
      }

      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        return (await response.json()) as T;
      }

      return (await response.text()) as T;
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        const delay = computeDelay(attempt, initialDelayMs, maxDelayMs);
        await sleep(delay);
        continue;
      }
    }
  }

  throw lastError;
}

async function safeReadText(response: Response): Promise<string | undefined> {
  try {
    return await response.text();
  } catch {
    return undefined;
  }
}
