import { createMemo, createSignal } from "solid-js";
import {
    Link2,
    Globe,
    Loader2,
    CheckCircle2,
    XCircle,
    Trash2,
    AlertCircle,
    ChevronDown,
    ChevronUp,
    HelpCircle,
} from "lucide-solid";
import clsx from "clsx";
import DOMPurify from "dompurify";
import { runStrategistInlinks, type StrategistInlinksResponse } from "../lib/api";
import { AppHeader } from "./AppHeader";
import { HelpModal } from "./HelpModal";
import { GenerationApprovalCard } from "./GenerationApprovalCard";
import helpMarkdownRaw from "../docs/user/strategist-inlinks.md";

type UiChangeItem = {
    targetUrl: string;
    anchor: string;
    originalText: string;
    modifiedText: string;
    justification: string;
    source: "edits" | "report";
    blockId?: string;
    insertionStrategy?: "inline" | "semantic-paragraph" | "append" | "block";
};

type ErrorWithDetails =
    | {
          error?: string;
          details?: {
              name?: string;
              message?: string;
              stack?: string;
          };
      }
    | unknown;

type StrategistSourceType = "url" | "manual";

export function StrategistInlinks() {
    const [sourceType, setSourceType] =
        createSignal<StrategistSourceType>("url");
    const [principalUrl, setPrincipalUrl] = createSignal("");
    const [manualContent, setManualContent] = createSignal("");
    const [urlsText, setUrlsText] = createSignal("");
    const [isLoading, setIsLoading] = createSignal(false);
    const [error, setError] = createSignal<string | null>(null);
    const [errorDetails, setErrorDetails] = createSignal<string | null>(null);
    const [result, setResult] = createSignal<StrategistInlinksResponse | null>(null);
    const [showRejected, setShowRejected] = createSignal(false);
    const [showDiffModal, setShowDiffModal] = createSignal(false);
    const [isHelpOpen, setIsHelpOpen] = createSignal(false);
    const [latestGenerationId, setLatestGenerationId] = createSignal<
        string | null
    >(null);

    const helpMarkdown = createMemo(() =>
        typeof helpMarkdownRaw === "string"
            ? helpMarkdownRaw
            : String(helpMarkdownRaw),
    );

    const parseUrls = (text: string): string[] => {
        return text
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line.length > 0);
    };

    const validUrls = createMemo(() => parseUrls(urlsText()));
    const validUrlCount = createMemo(() => validUrls().length);
    const isUrlSource = createMemo(() => sourceType() === "url");
    const isManualSource = createMemo(() => sourceType() === "manual");
    const normalizedPrincipalUrl = createMemo(() => principalUrl().trim());
    const normalizedManualContent = createMemo(() => manualContent().trim());
    const canSubmit = createMemo(() =>
        isUrlSource()
            ? normalizedPrincipalUrl().length > 0 && validUrlCount() > 0
            : normalizedManualContent().length > 0 && validUrlCount() > 0,
    );

    const stringifyMaybeErrorDetails = (err: ErrorWithDetails): string | null => {
        if (!err || typeof err !== "object") return null;
        const e = err as Record<string, unknown>;

        const details = e?.details;
        if (details && typeof details === "object") {
            const detailsRecord = details as Record<string, unknown>;
            const message =
                typeof detailsRecord.message === "string"
                    ? detailsRecord.message
                    : undefined;
            const stack =
                typeof detailsRecord.stack === "string"
                    ? detailsRecord.stack
                    : undefined;
            if (message || stack) {
                return [message, stack].filter(Boolean).join("\n");
            }
        }

        if (err instanceof Error && typeof err.message === "string") {
            return err.message;
        }

        return null;
    };

    const handleSubmit = async (e: SubmitEvent) => {
        e.preventDefault();

        if (!canSubmit()) return;

        setError(null);
        setErrorDetails(null);
        setIsLoading(true);
        setResult(null);
        setLatestGenerationId(null);

        try {
            const response = await runStrategistInlinks(
                isManualSource()
                    ? {
                          sourceType: "manual",
                          conteudoPrincipal: normalizedManualContent(),
                          urlsAnalise: validUrls(),
                          ...(normalizedPrincipalUrl()
                              ? { urlPrincipal: normalizedPrincipalUrl() }
                              : {}),
                      }
                    : {
                          sourceType: "url",
                          urlPrincipal: normalizedPrincipalUrl(),
                          urlsAnalise: validUrls(),
                      },
            );
            setResult(response);
            setLatestGenerationId(response.generationId ?? null);
        } catch (err) {
            console.error(err);
            setError("Falha ao analisar inlinks. Verifique se o backend está rodando.");
            setErrorDetails(stringifyMaybeErrorDetails(err as ErrorWithDetails));
        } finally {
            setIsLoading(false);
        }
    };

    const sanitizeHtml = (html: string): string => {
        return DOMPurify.sanitize(html, {
            USE_PROFILES: { html: true },
            ADD_TAGS: ["mark"],
            ADD_ATTR: ["class", "target", "rel"],
            ALLOWED_ATTR: [
                "href",
                "src",
                "alt",
                "title",
                "class",
                "target",
                "rel",
                "loading",
                "decoding",
                "fetchpriority",
                "width",
                "height",
                "srcset",
                "sizes",
                "id",
            ],
            FORBID_TAGS: ["script", "style", "iframe", "object", "embed"],
            FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover"],
        });
    };

    const buildHighlightedHtml = (
        html: string,
        items: StrategistInlinksResponse["selecionadas"],
        mode: "original" | "modified",
    ): string => {
        if (!html) return "";
        const className =
            mode === "original"
                ? "inlink-highlight-original"
                : "inlink-highlight-modified";

        const sanitized = sanitizeHtml(html);

        if (sanitized.includes(className)) return sanitized;
        if (typeof window === "undefined") return sanitized;

        const parser = new DOMParser();
        const doc = parser.parseFromString(
            `<div id="root">${sanitized}</div>`,
            "text/html",
        );
        const root = doc.getElementById("root");
        const nodeFilter = doc.defaultView?.NodeFilter ?? window.NodeFilter;

        if (!root || !nodeFilter) return sanitized;

        const normalizeForSearch = (value: string) =>
            value.replace(/\u00a0/g, " ").toLowerCase();

        const applyHighlight = (
            anchor: string,
            replacementHtml: string,
        ): boolean => {
            const walker = doc.createTreeWalker(root, nodeFilter.SHOW_TEXT);
            let node = walker.nextNode();

            const normalizedAnchor = normalizeForSearch(anchor);

            while (node) {
                const text = node.nodeValue ?? "";
                const normalizedText = normalizeForSearch(text);
                const index = normalizedText.indexOf(normalizedAnchor);

                if (index !== -1 && node.parentNode) {
                    const before = text.slice(0, index);
                    const after = text.slice(index + anchor.length);
                    const span = doc.createElement("span");
                    span.innerHTML = `${before}${replacementHtml}${after}`;
                    node.parentNode.replaceChild(span, node);
                    return true;
                }

                node = walker.nextNode();
            }

            return false;
        };

        for (const item of items) {
            const anchor = item.anchor?.trim();
            if (!anchor) continue;

            const replacement =
                mode === "original"
                    ? `<mark class="${className}">${anchor}</mark>`
                    : `<mark class="${className}"><a href="${item.url}" target="_blank" rel="noopener noreferrer">${anchor}</a></mark>`;

            applyHighlight(anchor, replacement);
        }

        return root.innerHTML;
    };

    const uiChanges = createMemo<UiChangeItem[]>(() => {
        const current = result();
        if (!current) return [];

        if (current.edits && current.edits.length > 0) {
            return current.edits.map((edit) => ({
                targetUrl: edit.targetUrl,
                anchor: edit.anchor,
                originalText: edit.originalBlockText,
                modifiedText: edit.modifiedBlockText,
                justification: edit.justification,
                source: "edits",
                blockId: edit.blockId,
            }));
        }

        return current.report.map((item) => ({
            targetUrl: item.targetUrl,
            anchor: item.anchor,
            originalText: item.originalSentence,
            modifiedText: item.modifiedSentence,
            justification: item.justification,
            source: "report",
            insertionStrategy: item.insertionStrategy,
        }));
    });

    const originalHtml = createMemo(() => {
        const current = result();
        if (!current) return "";
        return buildHighlightedHtml(
            current.originalContent,
            current.selecionadas,
            "original",
        );
    });

    const modifiedHtml = createMemo(() => {
        const current = result();
        if (!current) return "";
        return buildHighlightedHtml(
            current.modifiedContent,
            current.selecionadas,
            "modified",
        );
    });

    const shouldRenderPrincipalAsUrl = createMemo(() => {
        const current = result();
        if (!current) return false;
        try {
            const parsed = new URL(current.principalUrl);
            return parsed.protocol === "http:" || parsed.protocol === "https:";
        } catch {
            return false;
        }
    });

    return (
        <div class="flex flex-col h-screen bg-gray-50 text-gray-900 font-sans">
            <AppHeader />

            <div class="flex-1 flex flex-col md:flex-row overflow-hidden">
                <aside class="w-full md:w-96 bg-white border-b md:border-b-0 md:border-r border-gray-100 p-4 md:p-6 flex flex-col gap-6 overflow-y-auto max-h-[48vh] md:max-h-none">
                    <div>
                        <div class="flex items-center justify-between mb-4">
                            <h2 class="text-sm font-semibold text-gray-500 uppercase tracking-wider">
                                Configuração
                            </h2>

                            <button
                                type="button"
                                onClick={() => setIsHelpOpen(true)}
                                class="text-xs text-gray-600 hover:text-gray-800 flex items-center gap-1"
                                title="Ajuda"
                            >
                                <HelpCircle class="w-3.5 h-3.5" />
                                Ajuda
                            </button>
                        </div>

                        <form
                            id="strategist-form"
                            onSubmit={handleSubmit}
                            class="flex flex-col gap-4"
                        >
                            <div class="space-y-2">
                                <p class="text-sm font-medium text-gray-700">
                                    Fonte do conteúdo principal{" "}
                                    <span class="text-red-500">*</span>
                                </p>
                                <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    <label
                                        for="source-url"
                                        class={clsx(
                                            "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm cursor-pointer transition-colors",
                                            isUrlSource()
                                                ? "border-primary bg-orange-50 text-primary"
                                                : "border-gray-200 text-gray-600 hover:border-gray-300",
                                        )}
                                    >
                                        <input
                                            id="source-url"
                                            type="radio"
                                            name="source-type"
                                            checked={isUrlSource()}
                                            onChange={() => setSourceType("url")}
                                            class="accent-primary"
                                        />
                                        Usar URL principal
                                    </label>
                                    <label
                                        for="source-manual"
                                        class={clsx(
                                            "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm cursor-pointer transition-colors",
                                            isManualSource()
                                                ? "border-primary bg-orange-50 text-primary"
                                                : "border-gray-200 text-gray-600 hover:border-gray-300",
                                        )}
                                    >
                                        <input
                                            id="source-manual"
                                            type="radio"
                                            name="source-type"
                                            checked={isManualSource()}
                                            onChange={() => setSourceType("manual")}
                                            class="accent-primary"
                                        />
                                        Usar conteúdo digitado
                                    </label>
                                </div>
                            </div>

                            <div class="space-y-1">
                                <label for="principal-url" class="text-sm font-medium text-gray-700">
                                    URL Principal{" "}
                                    {isUrlSource() ? (
                                        <span class="text-red-500">*</span>
                                    ) : (
                                        <span class="text-gray-400">(opcional)</span>
                                    )}
                                </label>
                                <div class="relative">
                                    <Globe class="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                                    <input
                                        id="principal-url"
                                        type="url"
                                        required={isUrlSource()}
                                        placeholder="https://exemplo.com/artigo-principal"
                                        value={principalUrl()}
                                        onInput={(e) =>
                                            setPrincipalUrl(
                                                (e.currentTarget as HTMLInputElement).value,
                                            )
                                        }
                                        class="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors text-sm"
                                    />
                                </div>
                                <p class="text-xs text-gray-400">
                                    {isUrlSource()
                                        ? "Página que receberá os links internos."
                                        : "Opcional no modo manual. Se informado, evita auto-link para a própria URL."}
                                </p>
                            </div>

                            {isManualSource() && (
                                <div class="space-y-1">
                                    <label for="manual-content" class="text-sm font-medium text-gray-700">
                                        Conteúdo digitado{" "}
                                        <span class="text-red-500">*</span>
                                    </label>
                                    <p class="text-xs text-gray-400 mb-2">
                                        Insira o conteúdo principal em texto puro (quebras de linha são preservadas).
                                    </p>
                                    <textarea
                                        id="manual-content"
                                        required={isManualSource()}
                                        placeholder={
                                            "Digite aqui o conteúdo principal para mapeamento de inlinks..."
                                        }
                                        value={manualContent()}
                                        onInput={(e) =>
                                            setManualContent(
                                                (e.currentTarget as HTMLTextAreaElement).value,
                                            )
                                        }
                                        rows={10}
                                        maxLength={50000}
                                        class="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors text-sm leading-relaxed resize-y"
                                    />
                                    <p class="text-xs text-gray-400">
                                        {manualContent().length.toLocaleString("pt-BR")} / 50.000 caracteres
                                    </p>
                                </div>
                            )}

                            <div class="space-y-1">
                                <div class="flex items-center justify-between">
                                    <label for="analysis-urls" class="text-sm font-medium text-gray-700">
                                        URLs de Análise <span class="text-red-500">*</span>
                                    </label>
                                    <div class="flex items-center gap-2">
                                        {validUrlCount() > 0 && (
                                            <span class="text-xs font-medium bg-orange-50 text-primary px-2 py-0.5 rounded-full">
                                                {validUrlCount()} URL{validUrlCount() !== 1 ? "s" : ""}
                                            </span>
                                        )}
                                        {urlsText().length > 0 && (
                                            <button
                                                type="button"
                                                onClick={() => setUrlsText("")}
                                                class="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                                                title="Limpar tudo"
                                            >
                                                <Trash2 class="w-3.5 h-3.5" />
                                            </button>
                                        )}
                                    </div>
                                </div>
                                <p class="text-xs text-gray-400 mb-2">
                                    Cole todas as URLs de uma vez, uma por linha (máx. 100).
                                </p>
                                <textarea
                                    id="analysis-urls"
                                    placeholder={
                                        "https://exemplo.com/artigo-1\nhttps://exemplo.com/artigo-2\nhttps://exemplo.com/artigo-3"
                                    }
                                    value={urlsText()}
                                    onInput={(e) =>
                                        setUrlsText((e.currentTarget as HTMLTextAreaElement).value)
                                    }
                                    rows={8}
                                    class="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors text-sm font-mono leading-relaxed resize-y"
                                />
                            </div>

                            <button
                                type="submit"
                                disabled={isLoading() || !canSubmit()}
                                class={clsx(
                                    "mt-4 w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg font-medium text-white transition-all shadow-sm hover:shadow-md",
                                    isLoading() || !canSubmit()
                                        ? "bg-gray-300 cursor-not-allowed"
                                        : "bg-primary hover:bg-orange-600 active:scale-[0.98]",
                                )}
                            >
                                {isLoading() ? (
                                    <>
                                        <Loader2 class="w-4 h-4 animate-spin" />
                                        Analisando...
                                    </>
                                ) : (
                                    <>
                                        <Link2 class="w-4 h-4" />
                                        Analisar Inlinks
                                    </>
                                )}
                            </button>
                        </form>
                    </div>

                    <div class="mt-auto">
                        <div class="p-4 bg-orange-50 rounded-lg border border-orange-100">
                            <h3 class="text-xs font-semibold text-orange-800 mb-1 flex items-center gap-1">
                                <AlertCircle class="w-3 h-3" />
                                Como funciona
                            </h3>
                            <p class="text-xs text-orange-700 leading-relaxed">
                                Escolha entre URL principal ou conteúdo digitado e informe as URLs satélites para identificar oportunidades de linking interno.
                            </p>
                        </div>
                    </div>
                </aside>

                <main class="flex-1 flex flex-col bg-gray-50/50 relative overflow-y-auto">
                    <div class="flex-1 p-4 md:p-8">
                        <div class="max-w-4xl mx-auto w-full mb-4">
                            <GenerationApprovalCard generationId={latestGenerationId()} />
                        </div>

                        {!result() && !isLoading() && !error() && (
                            <div class="flex flex-col items-center justify-center h-full text-center text-gray-400 p-8">
                                <div class="w-16 h-16 bg-white rounded-2xl shadow-sm flex items-center justify-center mb-4">
                                    <Link2 class="w-8 h-8 text-primary/60" />
                                </div>
                                <h3 class="text-lg font-medium text-gray-900 mb-2">
                                    Strategist Inlinks
                                </h3>
                                <p class="max-w-md mx-auto">
                                    Identifique oportunidades de linking interno usando URL principal ou conteúdo digitado com URLs satélites.
                                </p>
                            </div>
                        )}

                        {error() && (
                            <div class="max-w-4xl mx-auto w-full p-4 bg-red-50 border border-red-100 rounded-2xl flex items-start gap-3 text-red-800">
                                <AlertCircle class="w-5 h-5 flex-shrink-0 mt-0.5" />
                                <div class="space-y-1">
                                    <p class="text-sm">{error()}</p>
                                    {errorDetails() && (
                                        <pre class="text-xs text-red-700 bg-red-100/60 border border-red-100 rounded-md p-2 whitespace-pre-wrap">
                                            {errorDetails()}
                                        </pre>
                                    )}
                                </div>
                            </div>
                        )}

                        {isLoading() && (
                            <div class="flex flex-col items-center justify-center h-full text-center text-gray-500 gap-4">
                                <Loader2 class="w-10 h-10 text-primary animate-spin" />
                                <div>
                                    <p class="text-sm font-medium text-gray-700">
                                        Analisando URLs...
                                    </p>
                                    <p class="text-xs text-gray-400 mt-1">
                                        Isso pode levar alguns minutos dependendo da quantidade de URLs.
                                    </p>
                                </div>
                            </div>
                        )}

                        {showDiffModal() && result() && (
                            <div class="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
                                <div class="w-full max-w-3xl rounded-xl bg-white shadow-lg overflow-hidden">
                                    <div class="flex items-center justify-between border-b border-gray-100 px-4 py-3">
                                        <div class="flex items-center gap-3">
                                            <h4 class="text-sm font-semibold text-gray-900">
                                                Mudanças sugeridas pela IA
                                            </h4>
                                            <span class="text-[11px] font-medium text-gray-500 bg-gray-50 border border-gray-200 px-2 py-0.5 rounded-full">
                                                {uiChanges().length} alterações
                                            </span>
                                            <span class="text-[11px] font-medium text-gray-500 bg-gray-50 border border-gray-200 px-2 py-0.5 rounded-full">
                                                {result()!.selecionadas.length} links
                                            </span>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => setShowDiffModal(false)}
                                            class="text-xs font-medium text-gray-500 hover:text-gray-700"
                                        >
                                            Fechar
                                        </button>
                                    </div>
                                    <div class="max-h-[70vh] overflow-y-auto p-4 space-y-4">
                                        {uiChanges().length === 0 && (
                                            <p class="text-sm text-gray-500">
                                                Nenhuma mudança registrada.
                                            </p>
                                        )}
                                        {uiChanges().map((item, idx) => (
                                            <div class="rounded-lg border border-gray-100 p-3">
                                                <p class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                                                    Mudança {idx + 1}
                                                </p>
                                                <p class="text-xs text-gray-500 mb-2">
                                                    URL:{" "}
                                                    <a
                                                        href={item.targetUrl}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        class="text-primary hover:underline break-all"
                                                    >
                                                        {item.targetUrl}
                                                    </a>
                                                </p>
                                                <div class="space-y-3">
                                                    <div>
                                                        <p class="text-xs font-semibold text-gray-400">Antes</p>
                                                        <p class="text-sm text-gray-700">{item.originalText}</p>
                                                    </div>
                                                    <div>
                                                        <p class="text-xs font-semibold text-gray-400">Depois</p>
                                                        <p class="text-sm text-gray-700">{item.modifiedText}</p>
                                                    </div>
                                                    {item.justification && (
                                                        <div>
                                                            <p class="text-xs font-semibold text-gray-400">
                                                                Justificativa
                                                            </p>
                                                            <p class="text-sm text-gray-600">
                                                                {item.justification}
                                                            </p>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}

                        {result() && (
                            <div class="w-full max-w-none 2xl:max-w-[1400px] mx-auto space-y-6 px-2 md:px-4">
                                <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    <div class="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
                                        <p class="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                                            Analisadas
                                        </p>
                                        <p class="text-3xl font-bold text-gray-900 mt-1">
                                            {result()!.totalAnalise}
                                        </p>
                                    </div>
                                    <div class="bg-white rounded-xl border border-green-100 p-5 shadow-sm">
                                        <p class="text-xs font-semibold text-green-600 uppercase tracking-wider">
                                            Selecionadas
                                        </p>
                                        <p class="text-3xl font-bold text-green-700 mt-1">
                                            {result()!.totalSelecionadas}
                                        </p>
                                    </div>
                                    <div class="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
                                        <p class="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                                            Rejeitadas
                                        </p>
                                        <p class="text-3xl font-bold text-gray-500 mt-1">
                                            {result()!.rejeitadas.length}
                                        </p>
                                    </div>
                                </div>

                                <div class="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
                                    <p class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">
                                        URL Principal
                                    </p>
                                    {shouldRenderPrincipalAsUrl() ? (
                                        <a
                                            href={result()!.principalUrl}
                                            target="_blank"
                                            rel="noreferrer"
                                            class="text-sm text-primary hover:underline break-all"
                                        >
                                            {result()!.principalUrl}
                                        </a>
                                    ) : (
                                        <p class="text-sm text-gray-600">
                                            Conteúdo digitado (sem URL)
                                        </p>
                                    )}
                                </div>

                                {(result()!.modifiedContent || result()!.originalContent) && (
                                    <div class="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
                                        <style>{`
                                            .inlink-highlight-original { background: #ffe3e3 !important; color: #c92a2a !important; padding: 0 3px; border-radius: 3px; font-weight: 600; display: inline-block; }
                                            .inlink-highlight-modified { background: #e7f5ff !important; color: #1c7ed6 !important; padding: 0 3px; border-radius: 3px; font-weight: 600; display: inline-block; }
                                            .inlink-highlight-modified a { color: #1c7ed6 !important; text-decoration: underline; }
                                        `}</style>
                                        <p class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                                            Conteúdo com Links
                                        </p>
                                        <div class="grid grid-cols-1 xl:grid-cols-2 gap-4 xl:gap-6">
                                            <div class="rounded-lg border border-gray-100 bg-gray-50 p-5">
                                                <div class="flex items-center justify-between mb-2">
                                                    <p class="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                                                        Conteúdo Original
                                                    </p>
                                                    <button
                                                        type="button"
                                                        onClick={() =>
                                                            void navigator.clipboard.writeText(originalHtml())
                                                        }
                                                        class="text-xs font-medium text-primary hover:underline"
                                                    >
                                                        Copiar HTML
                                                    </button>
                                                </div>
                                                <div class="prose prose-sm max-w-none text-gray-700" innerHTML={originalHtml()} />
                                            </div>
                                            <div class="rounded-lg border border-gray-100 bg-white p-5">
                                                <div class="flex items-center justify-between mb-2">
                                                    <p class="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                                                        Conteúdo Ajustado pela IA
                                                    </p>
                                                    <div class="flex items-center gap-3">
                                                        <button
                                                            type="button"
                                                            onClick={() => setShowDiffModal(true)}
                                                            class="text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 px-2.5 py-1 rounded-md hover:bg-blue-100 hover:text-blue-800"
                                                        >
                                                            Ver mudanças
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() =>
                                                                void navigator.clipboard.writeText(modifiedHtml())
                                                            }
                                                            class="text-xs font-medium text-primary hover:underline"
                                                        >
                                                            Copiar HTML
                                                        </button>
                                                    </div>
                                                </div>
                                                <div class="prose prose-sm max-w-none text-gray-700" innerHTML={modifiedHtml()} />
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {result()!.selecionadas.length > 0 && (
                                    <div class="bg-white rounded-xl border border-green-100 shadow-sm overflow-hidden">
                                        <div class="p-5 border-b border-green-50">
                                            <h3 class="text-sm font-semibold text-gray-900 flex items-center gap-2">
                                                <CheckCircle2 class="w-4 h-4 text-green-600" />
                                                Oportunidades Encontradas ({result()!.selecionadas.length})
                                            </h3>
                                        </div>
                                        <div class="overflow-x-auto">
                                            <table class="w-full text-sm">
                                                <thead>
                                                    <tr class="bg-gray-50 text-left">
                                                        <th class="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                                                            URL Satélite
                                                        </th>
                                                        <th class="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                                                            Âncora
                                                        </th>
                                                        <th class="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                                                            Frase
                                                        </th>
                                                    </tr>
                                                </thead>
                                                <tbody class="divide-y divide-gray-50">
                                                    {result()!.selecionadas.map((item) => (
                                                        <tr class="hover:bg-gray-50/50 transition-colors">
                                                            <td class="px-5 py-4">
                                                                <a href={item.url} target="_blank" rel="noreferrer" class="text-primary hover:underline break-all text-xs">
                                                                    {item.url}
                                                                </a>
                                                            </td>
                                                            <td class="px-5 py-4">
                                                                <span class="inline-block bg-orange-50 text-primary px-2 py-0.5 rounded text-xs font-medium">
                                                                    {item.anchor}
                                                                </span>
                                                            </td>
                                                            <td class="px-5 py-4 text-gray-600 text-xs leading-relaxed max-w-md">
                                                                {item.sentence}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                )}

                                {result()!.rejeitadas.length > 0 && (
                                    <div class="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                                        <button
                                            onClick={() => setShowRejected((prev) => !prev)}
                                            class="w-full p-5 flex items-center justify-between text-left hover:bg-gray-50 transition-colors"
                                        >
                                            <h3 class="text-sm font-semibold text-gray-900 flex items-center gap-2">
                                                <XCircle class="w-4 h-4 text-gray-400" />
                                                Rejeitadas ({result()!.rejeitadas.length})
                                            </h3>
                                            {showRejected() ? (
                                                <ChevronUp class="w-4 h-4 text-gray-400" />
                                            ) : (
                                                <ChevronDown class="w-4 h-4 text-gray-400" />
                                            )}
                                        </button>

                                        {showRejected() && (
                                            <div class="overflow-x-auto border-t border-gray-50">
                                                <table class="w-full text-sm">
                                                    <thead>
                                                        <tr class="bg-gray-50 text-left">
                                                            <th class="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                                                                URL
                                                            </th>
                                                            <th class="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                                                                Motivo
                                                            </th>
                                                            <th class="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                                                                Score
                                                            </th>
                                                        </tr>
                                                    </thead>
                                                    <tbody class="divide-y divide-gray-50">
                                                        {result()!.rejeitadas.map((item) => (
                                                            <tr class="hover:bg-gray-50/50 transition-colors">
                                                                <td class="px-5 py-4">
                                                                    <a
                                                                        href={item.url}
                                                                        target="_blank"
                                                                        rel="noreferrer"
                                                                        class="text-gray-600 hover:underline break-all text-xs"
                                                                    >
                                                                        {item.url}
                                                                    </a>
                                                                </td>
                                                                <td class="px-5 py-4 text-gray-500 text-xs">
                                                                    {item.reason || "Sem motivo informado"}
                                                                </td>
                                                                <td class="px-5 py-4 text-gray-500 text-xs">
                                                                    {typeof item.score === "number"
                                                                        ? item.score.toFixed(2)
                                                                        : "—"}
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    <HelpModal
                        open={isHelpOpen()}
                        title="Ajuda — Strategist Inlinks"
                        markdown={helpMarkdown()}
                        onClose={() => setIsHelpOpen(false)}
                    />
                </main>
            </div>
        </div>
    );
}
