
import * as cheerio from "cheerio";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";


export const extractTextFromHtml = async (
  urlContent: string,
): Promise<string> => {
  const controller = new AbortController();
  const timeoutMs = 60000;

  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(urlContent, {
      signal: controller.signal,
      headers: {
        "User-Agent": "SocialAgentBot/1.0",
      },
    });

    if (!response.ok) {
      throw new Error(
        `Falha ao buscar a URL (${response.status} ${response.statusText}).`,
      );
    }

    const html = await response.text();
    
    // First attempt: Use Readability
    const dom = new JSDOM(html, { url: urlContent });
    // @ts-ignore
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (article && article.textContent && article.textContent.trim().length > 100) {
      return article.textContent.replace(/\s+/g, " ").trim();
    }

    console.warn("Readability failed or returned insufficient content. Falling back to Cheerio.");

    // Fallback: Cheerio (Basic)
    const $ = cheerio.load(html);
    $(
      "script,style,noscript, iframe,svg,img,video,audio,footer,header,nav,aside",
    ).remove();
    return $("body").text().replace(/\s+/g, " ").trim();
  } finally {
    clearTimeout(timeoutId);
  }
};

