import * as cheerio from "cheerio";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

export type ExtractedPageMetadata = {
    url: string;
    title?: string;
    h1?: string;
    canonicalUrl?: string;
};

const isProduction = (): boolean => {
    return (process.env.NODE_ENV ?? "").toLowerCase() === "production";
};

const stripToCheerioText = (html: string): string => {
    const $ = cheerio.load(html);
    $(
        "script,style,noscript, iframe,svg,img,video,audio,footer,header,nav,aside",
    ).remove();
    return $("body").text().replace(/\s+/g, " ").trim();
};

const normalizeWhitespace = (value: string): string =>
    value
        .replace(/\u00a0/g, " ")
        .replace(/\s+/g, " ")
        .trim();

const safeAbsoluteUrl = (
    maybeUrl: string,
    baseUrl: string,
): string | undefined => {
    const raw = (maybeUrl ?? "").trim();
    if (!raw) return undefined;
    try {
        return new URL(raw, baseUrl).toString();
    } catch {
        return undefined;
    }
};

const stripToCheerioBodyHtml = (html: string): string => {
    const $ = cheerio.load(html);
    $(
        "script,style,noscript, iframe,svg,img,video,audio,footer,header,nav,aside",
    ).remove();

    const bodyHtml = $("body").html();
    return bodyHtml?.trim() ?? "";
};

const createReadabilityDom = (html: string, urlContent: string): JSDOM => {
    // Avoid executing scripts and avoid pulling in external resources.
    // Note: In jsdom, `resources` must be undefined, "usable", or an object.
    // Leaving it undefined prevents resource loading behavior that can trigger CSSOM parsing.
    return new JSDOM(html, {
        url: urlContent,
        pretendToBeVisual: false,
        runScripts: "outside-only",
    });
};

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

        // In production, prefer Cheerio-only to avoid jsdom/cssom crashes in some runtimes.
        if (isProduction()) {
            return stripToCheerioText(html);
        }

        // Dev/local: try Readability first, but never let it crash the request.
        try {
            const dom = createReadabilityDom(html, urlContent);
            // @ts-ignore
            const reader = new Readability(dom.window.document);
            const article = reader.parse();

            if (
                article &&
                article.textContent &&
                article.textContent.trim().length > 100
            ) {
                return article.textContent.replace(/\s+/g, " ").trim();
            }
        } catch (error) {
            console.warn(
                "Readability/JSDOM crashed. Falling back to Cheerio.",
                error,
            );
        }

        return stripToCheerioText(html);
    } finally {
        clearTimeout(timeoutId);
    }
};

export const extractHtmlFromUrl = async (urlContent: string): Promise<string> => {
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

        // In production, prefer Cheerio-only to avoid jsdom/cssom crashes in some runtimes.
        if (isProduction()) {
            return stripToCheerioBodyHtml(html);
        }

        // Dev/local: try Readability first, but never let it crash the request.
        try {
            const dom = createReadabilityDom(html, urlContent);
            // @ts-ignore
            const reader = new Readability(dom.window.document);
            const article = reader.parse();

            if (
                article &&
                article.content &&
                article.content.trim().length > 50
            ) {
                return article.content.trim();
            }
        } catch (error) {
            console.warn(
                "Readability/JSDOM crashed. Falling back to Cheerio.",
                error,
            );
        }

        return stripToCheerioBodyHtml(html);
    } finally {
        clearTimeout(timeoutId);
    }
};

export const extractMetadataFromUrl = async (
    urlContent: string,
): Promise<ExtractedPageMetadata> => {
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
        const $ = cheerio.load(html);

        const title = normalizeWhitespace($("title").first().text() || "");
        const h1 = normalizeWhitespace($("h1").first().text() || "");

        const canonicalHref =
            $("link[rel='canonical']").attr("href") ||
            $('link[rel="canonical"]').attr("href") ||
            "";

        const canonicalUrl = safeAbsoluteUrl(canonicalHref, urlContent);

        return {
            url: urlContent,
            title: title || undefined,
            h1: h1 || undefined,
            canonicalUrl,
        };
    } finally {
        clearTimeout(timeoutId);
    }
};
