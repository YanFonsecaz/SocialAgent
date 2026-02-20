import React, { useState } from "react";
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
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import clsx from "clsx";
import DOMPurify from "dompurify";
import {
  runStrategistInlinks,
  type StrategistInlinksResponse,
} from "../lib/api";
import { AppHeader } from "./AppHeader";

/** Página de análise de inlinks: permite enviar URL principal + URLs satélites para identificar oportunidades de linking interno. */
export function StrategistInlinks() {
  const [principalUrl, setPrincipalUrl] = useState("");
  const [urlsText, setUrlsText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<StrategistInlinksResponse | null>(null);
  const [showRejected, setShowRejected] = useState(false);
  const [showDiffModal, setShowDiffModal] = useState(false);

  /** Extrai URLs válidas do texto do textarea (uma por linha). */
  const parseUrls = (text: string): string[] => {
    return text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  };

  const validUrls = parseUrls(urlsText);
  const validUrlCount = validUrls.length;

  /** Submete os dados para análise. */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!principalUrl || validUrls.length === 0) return;

    setError(null);
    setIsLoading(true);
    setResult(null);

    try {
      const response = await runStrategistInlinks({
        urlPrincipal: principalUrl,
        urlsAnalise: validUrls,
      });
      setResult(response);
    } catch (err) {
      console.error(err);
      setError(
        "Falha ao analisar inlinks. Verifique se o backend está rodando.",
      );
    } finally {
      setIsLoading(false);
    }
  };

  const sanitizeHtml = (html: string): string => {
    // Mantém <mark> e classes de highlight; remove vetores comuns de XSS.
    // Obs: não sanitizamos o conteúdo de `result.selecionadas` aqui, apenas o HTML externo.
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
    mode: "original" | "linked" | "modified",
  ): string => {
    if (!html) return "";
    const className =
      mode === "original"
        ? "inlink-highlight-original"
        : mode === "modified"
          ? "inlink-highlight-modified"
          : "inlink-highlight-linked";

    // Primeiro sanitiza para evitar XSS e também estabilizar render.
    const sanitized = sanitizeHtml(html);

    // Se já veio marcado pelo backend, preserva.
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

  const originalHtml = result
    ? buildHighlightedHtml(
        result.originalContent,
        result.selecionadas,
        "original",
      )
    : "";

  const linkedHtml = result
    ? buildHighlightedHtml(result.linkedContent, result.selecionadas, "linked")
    : "";

  const modifiedHtml = result
    ? buildHighlightedHtml(
        result.modifiedContent,
        result.selecionadas,
        "modified",
      )
    : "";

  return (
    <div className="flex flex-col h-screen bg-gray-50 text-gray-900 font-sans">
      <AppHeader />

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <aside className="w-96 bg-white border-r border-gray-100 p-6 flex flex-col gap-6 overflow-y-auto hidden md:flex">
          <div>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">
              Configuração
            </h2>

            <form
              id="strategist-form"
              onSubmit={handleSubmit}
              className="flex flex-col gap-4"
            >
              {/* URL Principal */}
              <div className="space-y-1">
                <label
                  htmlFor="principal-url"
                  className="text-sm font-medium text-gray-700"
                >
                  URL Principal <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <Globe className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                  <input
                    id="principal-url"
                    type="url"
                    required
                    placeholder="https://exemplo.com/artigo-principal"
                    value={principalUrl}
                    onChange={(e) => setPrincipalUrl(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors text-sm"
                  />
                </div>
                <p className="text-xs text-gray-400">
                  Página que receberá os links internos.
                </p>
              </div>

              {/* URLs de Análise */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="analysis-urls"
                    className="text-sm font-medium text-gray-700"
                  >
                    URLs de Análise <span className="text-red-500">*</span>
                  </label>
                  <div className="flex items-center gap-2">
                    {validUrlCount > 0 && (
                      <span className="text-xs font-medium bg-orange-50 text-primary px-2 py-0.5 rounded-full">
                        {validUrlCount} URL{validUrlCount !== 1 ? "s" : ""}
                      </span>
                    )}
                    {urlsText.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setUrlsText("")}
                        className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                        title="Limpar tudo"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
                <p className="text-xs text-gray-400 mb-2">
                  Cole todas as URLs de uma vez, uma por linha (máx. 100).
                </p>
                <textarea
                  id="analysis-urls"
                  placeholder={
                    "https://exemplo.com/artigo-1\nhttps://exemplo.com/artigo-2\nhttps://exemplo.com/artigo-3"
                  }
                  value={urlsText}
                  onChange={(e) => setUrlsText(e.target.value)}
                  rows={8}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors text-sm font-mono leading-relaxed resize-y"
                />
              </div>

              <button
                type="submit"
                disabled={isLoading || !principalUrl || validUrlCount === 0}
                className={clsx(
                  "mt-4 w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg font-medium text-white transition-all shadow-sm hover:shadow-md",
                  isLoading || !principalUrl || validUrlCount === 0
                    ? "bg-gray-300 cursor-not-allowed"
                    : "bg-primary hover:bg-orange-600 active:scale-[0.98]",
                )}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Analisando...
                  </>
                ) : (
                  <>
                    <Link2 className="w-4 h-4" />
                    Analisar Inlinks
                  </>
                )}
              </button>
            </form>
          </div>

          <div className="mt-auto">
            <div className="p-4 bg-orange-50 rounded-lg border border-orange-100">
              <h3 className="text-xs font-semibold text-orange-800 mb-1 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                Como funciona
              </h3>
              <p className="text-xs text-orange-700 leading-relaxed">
                Informe a URL principal (destino dos links) e as URLs satélites.
                A IA analisará cada satélite para encontrar oportunidades de
                linking interno, sugerindo âncoras e frases.
              </p>
            </div>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 flex flex-col bg-gray-50/50 relative overflow-y-auto">
          <div className="flex-1 p-4 md:p-8">
            {/* Empty State */}
            {!result && !isLoading && !error && (
              <div className="flex flex-col items-center justify-center h-full text-center text-gray-400 p-8">
                <div className="w-16 h-16 bg-white rounded-2xl shadow-sm flex items-center justify-center mb-4">
                  <Link2 className="w-8 h-8 text-primary/60" />
                </div>
                <h3 className="text-lg font-medium text-gray-900 mb-2">
                  Strategist Inlinks
                </h3>
                <p className="max-w-md mx-auto">
                  Identifique oportunidades de linking interno. Insira uma URL
                  principal e as URLs satélites na barra lateral para começar a
                  análise.
                </p>
              </div>
            )}

            {/* Error */}
            {error && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="max-w-4xl mx-auto w-full p-4 bg-red-50 border border-red-100 rounded-2xl flex items-center gap-3 text-red-800"
              >
                <AlertCircle className="w-5 h-5 flex-shrink-0" />
                <p className="text-sm">{error}</p>
              </motion.div>
            )}

            {/* Loading */}
            {isLoading && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-col items-center justify-center h-full text-center text-gray-500 gap-4"
              >
                <Loader2 className="w-10 h-10 text-primary animate-spin" />
                <div>
                  <p className="text-sm font-medium text-gray-700">
                    Analisando URLs...
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    Isso pode levar alguns minutos dependendo da quantidade de
                    URLs.
                  </p>
                </div>
              </motion.div>
            )}

            {showDiffModal && result && (
              <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
                <div className="w-full max-w-3xl rounded-xl bg-white shadow-lg overflow-hidden">
                  <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
                    <div className="flex items-center gap-3">
                      <h4 className="text-sm font-semibold text-gray-900">
                        Mudanças sugeridas pela IA
                      </h4>
                      <span className="text-[11px] font-medium text-gray-500 bg-gray-50 border border-gray-200 px-2 py-0.5 rounded-full">
                        {result.report.length} alterações
                      </span>
                      <span className="text-[11px] font-medium text-gray-500 bg-gray-50 border border-gray-200 px-2 py-0.5 rounded-full">
                        {result.selecionadas.length} links
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowDiffModal(false)}
                      className="text-xs font-medium text-gray-500 hover:text-gray-700"
                    >
                      Fechar
                    </button>
                  </div>
                  <div className="max-h-[70vh] overflow-y-auto p-4 space-y-4">
                    {(result.report ?? []).length === 0 && (
                      <p className="text-sm text-gray-500">
                        Nenhuma mudança registrada.
                      </p>
                    )}
                    {(result.report ?? []).map((item, idx) => (
                      <div
                        key={`${item.targetUrl}-${idx}`}
                        className="rounded-lg border border-gray-100 p-3"
                      >
                        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                          Mudança {idx + 1}
                        </p>
                        <p className="text-xs text-gray-500 mb-2">
                          URL:{" "}
                          <a
                            href={item.targetUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-primary hover:underline break-all"
                          >
                            {item.targetUrl}
                          </a>
                        </p>
                        {item.insertionStrategy && (
                          <p className="text-xs text-gray-400 mb-3">
                            Inserção:{" "}
                            <span className="font-medium text-gray-600">
                              {item.insertionStrategy}
                            </span>
                          </p>
                        )}
                        <div className="space-y-3">
                          <div>
                            <p className="text-xs font-semibold text-gray-400">
                              Antes
                            </p>
                            <p className="text-sm text-gray-700">
                              {item.originalSentence}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs font-semibold text-gray-400">
                              Depois
                            </p>
                            <p className="text-sm text-gray-700">
                              {item.modifiedSentence}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Results */}
            {result && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="w-full max-w-none 2xl:max-w-[1400px] mx-auto space-y-6 px-2 md:px-4"
              >
                {/* Summary Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                      Analisadas
                    </p>
                    <p className="text-3xl font-bold text-gray-900 mt-1">
                      {result.totalAnalise}
                    </p>
                  </div>
                  <div className="bg-white rounded-xl border border-green-100 p-5 shadow-sm">
                    <p className="text-xs font-semibold text-green-600 uppercase tracking-wider">
                      Selecionadas
                    </p>
                    <p className="text-3xl font-bold text-green-700 mt-1">
                      {result.totalSelecionadas}
                    </p>
                  </div>
                  <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                      Rejeitadas
                    </p>
                    <p className="text-3xl font-bold text-gray-500 mt-1">
                      {result.rejeitadas.length}
                    </p>
                  </div>
                </div>

                {/* Principal URL */}
                <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">
                    URL Principal
                  </p>
                  <a
                    href={result.principalUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm text-primary hover:underline break-all"
                  >
                    {result.principalUrl}
                  </a>
                </div>

                {/* Conteúdo original vs. conteúdo com links */}
                {(result.linkedContent || result.originalContent) && (
                  <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
                    <style>{`
                      .inlink-highlight-original {
                        background: #ffe3e3 !important;
                        color: #c92a2a !important;
                        padding: 0 3px;
                        border-radius: 3px;
                        font-weight: 600;
                        display: inline-block;
                      }
                      .inlink-highlight-linked {
                        background: #d3f9d8 !important;
                        color: #2b8a3e !important;
                        padding: 0 3px;
                        border-radius: 3px;
                        font-weight: 600;
                        display: inline-block;
                      }
                      .inlink-highlight-linked a {
                        color: #2b8a3e !important;
                        text-decoration: underline;
                      }
                      .inlink-highlight-modified {
                        background: #e7f5ff !important;
                        color: #1c7ed6 !important;
                        padding: 0 3px;
                        border-radius: 3px;
                        font-weight: 600;
                        display: inline-block;
                      }
                      .inlink-highlight-modified a {
                        color: #1c7ed6 !important;
                        text-decoration: underline;
                      }
                    `}</style>
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                      Conteúdo com Links
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 xl:gap-6">
                      <div className="rounded-lg border border-gray-100 bg-gray-50 p-5">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                            Conteúdo Original
                          </p>
                          <button
                            type="button"
                            onClick={() =>
                              navigator.clipboard.writeText(originalHtml)
                            }
                            className="text-xs font-medium text-primary hover:underline"
                          >
                            Copiar HTML
                          </button>
                        </div>
                        <div
                          className="prose prose-sm max-w-none text-gray-700"
                          dangerouslySetInnerHTML={{
                            __html: originalHtml,
                          }}
                        />
                      </div>
                      <div className="rounded-lg border border-gray-100 bg-white p-5">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                            Conteúdo com Inlinks
                          </p>
                          <button
                            type="button"
                            onClick={() =>
                              navigator.clipboard.writeText(
                                result.linkedContent,
                              )
                            }
                            className="text-xs font-medium text-primary hover:underline"
                          >
                            Copiar HTML
                          </button>
                        </div>
                        <div
                          className="prose prose-sm max-w-none text-gray-700"
                          dangerouslySetInnerHTML={{
                            __html: linkedHtml,
                          }}
                        />
                      </div>
                      <div className="rounded-lg border border-gray-100 bg-white p-5">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                            Conteúdo Ajustado pela IA
                          </p>
                          <div className="flex items-center gap-3">
                            <button
                              type="button"
                              onClick={() => setShowDiffModal(true)}
                              className="text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 px-2.5 py-1 rounded-md hover:bg-blue-100 hover:text-blue-800"
                            >
                              Ver mudanças
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                navigator.clipboard.writeText(modifiedHtml)
                              }
                              className="text-xs font-medium text-primary hover:underline"
                            >
                              Copiar HTML
                            </button>
                          </div>
                        </div>
                        <div
                          className="prose prose-sm max-w-none text-gray-700"
                          dangerouslySetInnerHTML={{
                            __html: modifiedHtml,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* Selected Inlinks */}
                {result.selecionadas.length > 0 && (
                  <div className="bg-white rounded-xl border border-green-100 shadow-sm overflow-hidden">
                    <div className="p-5 border-b border-green-50">
                      <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-green-600" />
                        Oportunidades Encontradas ({result.selecionadas.length})
                      </h3>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-gray-50 text-left">
                            <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                              URL Satélite
                            </th>
                            <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                              Âncora
                            </th>
                            <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                              Frase
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {result.selecionadas.map((item, idx) => (
                            <tr
                              key={idx}
                              className="hover:bg-gray-50/50 transition-colors"
                            >
                              <td className="px-5 py-4">
                                <a
                                  href={item.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-primary hover:underline break-all text-xs"
                                >
                                  {item.url}
                                </a>
                              </td>
                              <td className="px-5 py-4">
                                <span className="inline-block bg-orange-50 text-primary px-2 py-0.5 rounded text-xs font-medium">
                                  {item.anchor}
                                </span>
                              </td>
                              <td className="px-5 py-4 text-gray-600 text-xs leading-relaxed max-w-md">
                                {item.sentence}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Rejected Inlinks (collapsible) */}
                {result.rejeitadas.length > 0 && (
                  <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                    <button
                      onClick={() => setShowRejected(!showRejected)}
                      className="w-full p-5 flex items-center justify-between text-left hover:bg-gray-50 transition-colors"
                    >
                      <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                        <XCircle className="w-4 h-4 text-gray-400" />
                        Rejeitadas ({result.rejeitadas.length})
                      </h3>
                      {showRejected ? (
                        <ChevronUp className="w-4 h-4 text-gray-400" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-gray-400" />
                      )}
                    </button>

                    <AnimatePresence>
                      {showRejected && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className="overflow-hidden"
                        >
                          <div className="overflow-x-auto border-t border-gray-50">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="bg-gray-50 text-left">
                                  <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                                    URL
                                  </th>
                                  <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                                    Motivo
                                  </th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-50">
                                {result.rejeitadas.map((item, idx) => (
                                  <tr
                                    key={idx}
                                    className="hover:bg-gray-50/50 transition-colors"
                                  >
                                    <td className="px-5 py-4">
                                      <a
                                        href={item.url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-gray-600 hover:underline break-all text-xs"
                                      >
                                        {item.url}
                                      </a>
                                    </td>
                                    <td className="px-5 py-4 text-gray-500 text-xs">
                                      {item.reason}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )}

                {/* No results */}
                {result.selecionadas.length === 0 &&
                  result.rejeitadas.length === 0 && (
                    <div className="bg-white rounded-xl border border-gray-100 p-8 shadow-sm text-center">
                      <p className="text-sm text-gray-500">
                        Nenhuma oportunidade de inlink foi identificada.
                      </p>
                    </div>
                  )}
              </motion.div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
