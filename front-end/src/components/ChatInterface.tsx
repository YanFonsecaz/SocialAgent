import React, { useState, useRef, useEffect } from "react";
import {
  Send,
  Globe,
  Loader2,
  Sparkles,
  User,
  Bot,
  AlertCircle,
} from "lucide-react";
import remarkGfm from "remark-gfm";
import { motion } from "framer-motion";
import ReactMarkdown from "react-markdown";
import { runSocialAgent } from "../lib/api";
import { AppHeader } from "./AppHeader";
import clsx from "clsx";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: string[];
  timestamp: number;
}

const INTENT_OPTIONS = [
  { value: "linkedin_text", label: "Post para LinkedIn" },
  { value: "instagram_post", label: "Post para Instagram" },
  { value: "video_reels", label: "Roteiro para Reels" },
  { value: "video_tiktok", label: "Roteiro para TikTok" },
  { value: "video_youtube", label: "Roteiro para YouTube" },
  { value: "video_linkedin", label: "Vídeo para LinkedIn" },
];

export function ChatInterface() {
  const [url, setUrl] = useState("");
  const [intent, setIntent] = useState("");
  const [query, setQuery] = useState("");
  const [tone, setTone] = useState("");

  const [refinement, setRefinement] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, error]);

  const lastAssistantResponse =
    [...messages].reverse().find((m) => m.role === "assistant")?.content || "";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url) return;

    setError(null);
    setIsLoading(true);

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: `Analisar: ${url}\nIntenção: ${intent || "Não especificada"}\nTom: ${tone || "Padrão"}`,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMessage]);

    try {
      const result = await runSocialAgent({
        url,
        intent: intent || undefined,
        query: query || undefined,
        tone: tone || undefined,
      });

      const aiMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: result.response,
        sources: result.sources,
        timestamp: Date.now(),
      };

      setMessages((prev) => [...prev, aiMessage]);
    } catch (err) {
      console.error(err);
      setError("Falha ao gerar conteúdo. Verifique se o backend está rodando.");

      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content:
          "Desculpe, encontrei um erro ao processar sua solicitação. Por favor, verifique a conexão com o backend.",
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefine = async () => {
    if (!url || !lastAssistantResponse || !refinement.trim()) return;

    setError(null);
    setIsLoading(true);

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: `Refinar: ${refinement.trim()}`,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMessage]);

    try {
      const result = await runSocialAgent({
        url,
        intent: intent || undefined,
        query: query || undefined,
        tone: tone || undefined,
        feedback: refinement.trim(),
        previousResponse: lastAssistantResponse,
      });

      const aiMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: result.response,
        sources: result.sources,
        timestamp: Date.now(),
      };

      setMessages((prev) => [...prev, aiMessage]);
      setRefinement("");
    } catch (err) {
      console.error(err);
      setError("Falha ao refinar conteúdo. Verifique se o backend está rodando.");

      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content:
          "Desculpe, encontrei um erro ao refinar sua solicitação. Por favor, verifique a conexão com o backend.",
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-gray-50 text-gray-900 font-sans">
      {/* Header */}
      <AppHeader />

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar / Configuration Panel */}
        <aside className="w-80 bg-white border-r border-gray-100 p-6 flex flex-col gap-6 overflow-y-auto hidden md:flex">
          <div>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">
              Configuração
            </h2>

            <form
              id="config-form"
              onSubmit={handleSubmit}
              className="flex flex-col gap-4"
            >
              <div className="space-y-1">
                <label
                  htmlFor="url"
                  className="text-sm font-medium text-gray-700"
                >
                  URL do Conteúdo <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <Globe className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                  <input
                    id="url"
                    type="url"
                    required
                    placeholder="https://exemplo.com/artigo"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors text-sm"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="intent"
                  className="text-sm font-medium text-gray-700"
                >
                  Intenção (Opcional)
                </label>
                <select
                  id="intent"
                  value={intent}
                  onChange={(e) => setIntent(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors text-sm bg-white"
                >
                  <option value="">Perguntar depois</option>
                  {INTENT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="query"
                  className="text-sm font-medium text-gray-700"
                >
                  Consulta Específica (Opcional)
                </label>
                <input
                  id="query"
                  type="text"
                  placeholder="ex: resumir pontos chave"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors text-sm"
                />
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="tone"
                  className="text-sm font-medium text-gray-700"
                >
                  Tom (Opcional)
                </label>
                <input
                  id="tone"
                  type="text"
                  placeholder="ex: profissional, divertido"
                  value={tone}
                  onChange={(e) => setTone(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors text-sm"
                />
              </div>

              <button
                type="submit"
                disabled={isLoading || !url}
                className={clsx(
                  "mt-4 w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg font-medium text-white transition-all shadow-sm hover:shadow-md",
                  isLoading || !url
                    ? "bg-gray-300 cursor-not-allowed"
                    : "bg-primary hover:bg-orange-600 active:scale-[0.98]",
                )}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Processando...
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    Gerar Conteúdo
                  </>
                )}
              </button>
            </form>
          </div>

          <div className="mt-auto">
            <div className="p-4 bg-orange-50 rounded-lg border border-orange-100">
              <h3 className="text-xs font-semibold text-orange-800 mb-1 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                Dica
              </h3>
              <p className="text-xs text-orange-700 leading-relaxed">
                Forneça uma URL para começar. Se não selecionar uma intenção, a IA
                perguntará como você deseja usar o conteúdo.
              </p>
            </div>
          </div>
        </aside>

        {/* Main Chat Area */}
        <main className="flex-1 flex flex-col bg-gray-50/50 relative">
          <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center text-gray-400 p-8">
                <div className="w-16 h-16 bg-white rounded-2xl shadow-sm flex items-center justify-center mb-4">
                  <Sparkles className="w-8 h-8 text-primary/60" />
                </div>
                <h3 className="text-lg font-medium text-gray-900 mb-2">
                  Pronto para criar?
                </h3>
                <p className="max-w-md mx-auto">
                  Insira uma URL na configuração lateral para gerar conteúdo para
                  redes sociais, resumos e roteiros com IA.
                </p>
              </div>
            )}

            {error && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="max-w-3xl mx-auto w-full p-4 bg-red-50 border border-red-100 rounded-2xl flex items-center gap-3 text-red-800"
              >
                <AlertCircle className="w-5 h-5 flex-shrink-0" />
                <p className="text-sm">{error}</p>
              </motion.div>
            )}

            {messages.map((msg) => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={clsx(
                  "flex gap-4 max-w-3xl mx-auto",
                  msg.role === "user" ? "justify-end" : "justify-start",
                )}
              >
                {msg.role === "assistant" && (
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-orange-400 flex items-center justify-center flex-shrink-0 shadow-sm mt-1">
                    <Bot className="w-5 h-5 text-white" />
                  </div>
                )}

                <div
                  className={clsx(
                    "rounded-2xl p-5 shadow-sm text-sm leading-relaxed whitespace-pre-wrap max-w-[85%]",
                    msg.role === "user"
                      ? "bg-white text-gray-800 border-none ml-auto"
                      : "bg-white text-gray-800 border border-gray-100",
                  )}
                >
                  {msg.role === "assistant" ? (
                    <div className="prose prose-sm max-w-none prose-orange">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {typeof msg.content === "string" ? msg.content : ""}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    msg.content
                  )}

                  {msg.sources && msg.sources.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-gray-100">
                      <p className="text-xs font-semibold text-gray-500 mb-2">
                        Fontes:
                      </p>
                      <ul className="space-y-1">
                        {msg.sources.map((source, idx) => (
                          <li key={idx}>
                            <a
                              href={source}
                              target="_blank"
                              rel="noreferrer"
                              className="text-xs text-primary hover:underline truncate block max-w-xs"
                            >
                              {source}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                {msg.role === "user" && (
                  <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0 mt-1">
                    <User className="w-5 h-5 text-gray-500" />
                  </div>
                )}
              </motion.div>
            ))}

            {isLoading && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex gap-4 max-w-3xl mx-auto justify-start"
              >
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-orange-400 flex items-center justify-center flex-shrink-0 mt-1">
                  <Bot className="w-5 h-5 text-white" />
                </div>
                <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 flex items-center gap-2">
                  <span
                    className="w-2 h-2 bg-primary rounded-full animate-bounce"
                    style={{ animationDelay: "0ms" }}
                  ></span>
                  <span
                    className="w-2 h-2 bg-primary rounded-full animate-bounce"
                    style={{ animationDelay: "150ms" }}
                  ></span>
                  <span
                    className="w-2 h-2 bg-primary rounded-full animate-bounce"
                    style={{ animationDelay: "300ms" }}
                  ></span>
                </div>
              </motion.div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="px-4 md:px-8 pb-4">
            <div className="max-w-3xl mx-auto bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-gray-700">
                  Refinar resposta
                </p>
                <span className="text-xs text-gray-400">
                  {lastAssistantResponse
                    ? "Resposta carregada"
                    : "Sem resposta para refinar"}
                </span>
              </div>
              <div className="flex flex-col md:flex-row gap-3">
                <textarea
                  id="refinement"
                  rows={2}
                  placeholder="Ex: aumente o texto, deixe mais persuasivo e inclua um CTA"
                  value={refinement}
                  onChange={(e) => setRefinement(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors text-sm"
                />
                <button
                  type="button"
                  onClick={handleRefine}
                  disabled={
                    isLoading || !lastAssistantResponse || !refinement.trim()
                  }
                  className={clsx(
                    "h-10 px-4 rounded-lg font-medium text-white transition-all shadow-sm hover:shadow-md",
                    isLoading || !lastAssistantResponse || !refinement.trim()
                      ? "bg-gray-300 cursor-not-allowed"
                      : "bg-primary hover:bg-orange-600 active:scale-[0.98]",
                  )}
                >
                  Refinar
                </button>
              </div>
            </div>
          </div>

          {/* Mobile Input - Simplified */}
          <div className="md:hidden p-4 bg-white border-t border-gray-100">
            <button
              onClick={() => document.getElementById("url")?.focus()}
              className="w-full bg-primary text-white p-3 rounded-lg font-medium"
            >
              Configurar & Gerar
            </button>
          </div>
        </main>
      </div>
    </div>
  );
}
