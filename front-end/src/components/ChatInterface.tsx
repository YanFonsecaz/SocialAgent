import { createEffect, createMemo, createSignal } from "solid-js";
import {
    Send,
    Globe,
    Loader2,
    Sparkles,
    User,
    Bot,
    AlertCircle,
    HelpCircle,
} from "lucide-solid";
import { runSocialAgent } from "../lib/api";
import { AppHeader } from "./AppHeader";
import clsx from "clsx";
import { HelpModal } from "./HelpModal";
import { MarkdownContent } from "./MarkdownContent";
import { GenerationApprovalCard } from "./GenerationApprovalCard";
import helpMarkdownRaw from "../docs/user/social-agent.md";

interface Message {
    id: string;
    role: "user" | "assistant";
    content: string;
    sources?: string[];
    timestamp: number;
    quickReplies?: Array<{
        label: string;
        intentValue: string;
    }>;
}

const INTENT_OPTIONS = [
    { value: "linkedin_text", label: "Post para LinkedIn" },
    { value: "instagram_post", label: "Post para Instagram" },
    { value: "video_reels", label: "Roteiro para Reels" },
    { value: "video_tiktok", label: "Roteiro para TikTok" },
    { value: "video_youtube", label: "Roteiro para YouTube" },
    { value: "video_linkedin", label: "Vídeo para LinkedIn" },
] as const;

const intentToOptionNumber = (value: string): string | null => {
    switch (value) {
        case "linkedin_text":
            return "1";
        case "instagram_post":
            return "2";
        case "video_reels":
            return "3";
        case "video_tiktok":
            return "4";
        case "video_youtube":
            return "5";
        case "video_linkedin":
            return "6";
        default:
            return null;
    }
};

const parseNumericIntentFromText = (text: string): string | null => {
    const trimmed = text.trim();
    const match = trimmed.match(/^([1-6])(?:\s*[\)\.\-:]|\s+|$)/);
    return match?.[1] ?? null;
};

export function ChatInterface() {
    const [url, setUrl] = createSignal("");
    const [intent, setIntent] = createSignal("");
    const [query, setQuery] = createSignal("");
    const [tone, setTone] = createSignal("");

    const [refinement, setRefinement] = createSignal("");
    const [isLoading, setIsLoading] = createSignal(false);
    const [messages, setMessages] = createSignal<Message[]>([]);
    const [error, setError] = createSignal<string | null>(null);
    const [isHelpOpen, setIsHelpOpen] = createSignal(false);
    const [latestGenerationId, setLatestGenerationId] = createSignal<
        string | null
    >(null);

    let messagesEndRef: HTMLDivElement | undefined;

    const helpMarkdown = createMemo(() =>
        typeof helpMarkdownRaw === "string"
            ? helpMarkdownRaw
            : String(helpMarkdownRaw),
    );

    const scrollToBottom = () => {
        messagesEndRef?.scrollIntoView({ behavior: "smooth" });
    };

    createEffect(() => {
        messages();
        error();
        scrollToBottom();
    });

    const lastAssistantResponse = createMemo(() => {
        const assistant = [...messages()].reverse().find((m) => m.role === "assistant");
        return assistant?.content || "";
    });

    const buildIntentQuickRepliesFromResponse = (
        assistantText: string,
    ): Message["quickReplies"] => {
        if (!assistantText.includes("Opções:")) return undefined;

        return [
            { label: "1) Post para LinkedIn", intentValue: "1" },
            { label: "2) Post para Instagram", intentValue: "2" },
            { label: "3) Roteiro para Reels", intentValue: "3" },
            { label: "4) Roteiro para TikTok", intentValue: "4" },
            { label: "5) Roteiro para YouTube", intentValue: "5" },
            { label: "6) Vídeo para LinkedIn", intentValue: "6" },
        ];
    };

    const runWithIntent = async (intentValue: string) => {
        if (!url()) return;

        setError(null);
        setIsLoading(true);
        setLatestGenerationId(null);

        const userMessage: Message = {
            id: Date.now().toString(),
            role: "user",
            content: `Escolha: ${intentValue}`,
            timestamp: Date.now(),
        };

        setMessages((prev) => [...prev, userMessage]);

        try {
            const result = await runSocialAgent({
                url: url(),
                intent: intentValue,
                query: query() || undefined,
                tone: tone() || undefined,
            });
            setLatestGenerationId(result.generationId ?? null);

            const quickReplies = buildIntentQuickRepliesFromResponse(result.response);

            const aiMessage: Message = {
                id: (Date.now() + 1).toString(),
                role: "assistant",
                content: result.response,
                sources: result.sources,
                timestamp: Date.now(),
                quickReplies,
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

    const handleSubmit = async (e: SubmitEvent) => {
        e.preventDefault();
        if (!url()) return;

        setError(null);
        setIsLoading(true);
        setLatestGenerationId(null);

        const numericFromQuery = query() ? parseNumericIntentFromText(query()) : null;
        const effectiveIntent =
            numericFromQuery ?? intentToOptionNumber(intent()) ?? null;

        const userMessage: Message = {
            id: Date.now().toString(),
            role: "user",
            content: `Analisar: ${url()}\nIntenção: ${
                effectiveIntent ? `Opção ${effectiveIntent}` : "Perguntar depois"
            }\nTom: ${tone() || "Padrão"}`,
            timestamp: Date.now(),
        };

        setMessages((prev) => [...prev, userMessage]);

        try {
            const result = await runSocialAgent({
                url: url(),
                intent: effectiveIntent || "ask_later",
                query: query() || undefined,
                tone: tone() || undefined,
            });
            setLatestGenerationId(result.generationId ?? null);

            const quickReplies = buildIntentQuickRepliesFromResponse(result.response);

            const aiMessage: Message = {
                id: (Date.now() + 1).toString(),
                role: "assistant",
                content: result.response,
                sources: result.sources,
                timestamp: Date.now(),
                quickReplies,
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
        if (!url() || !lastAssistantResponse() || !refinement().trim()) return;

        setError(null);
        setIsLoading(true);
        setLatestGenerationId(null);

        const userMessage: Message = {
            id: Date.now().toString(),
            role: "user",
            content: `Refinar: ${refinement().trim()}`,
            timestamp: Date.now(),
        };

        setMessages((prev) => [...prev, userMessage]);

        try {
            const effectiveIntent = intentToOptionNumber(intent());

            const result = await runSocialAgent({
                url: url(),
                intent: effectiveIntent || "ask_later",
                query: query() || undefined,
                tone: tone() || undefined,
                feedback: refinement().trim(),
                previousResponse: lastAssistantResponse(),
            });
            setLatestGenerationId(result.generationId ?? null);

            const quickReplies = buildIntentQuickRepliesFromResponse(result.response);

            const aiMessage: Message = {
                id: (Date.now() + 1).toString(),
                role: "assistant",
                content: result.response,
                sources: result.sources,
                timestamp: Date.now(),
                quickReplies,
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
        <div class="flex flex-col h-screen bg-gray-50 text-gray-900 font-sans">
            <AppHeader />

            <div class="flex-1 flex flex-col md:flex-row overflow-hidden">
                <aside class="w-full md:w-80 bg-white border-b md:border-b-0 md:border-r border-gray-100 p-4 md:p-6 flex flex-col gap-6 overflow-y-auto max-h-[44vh] md:max-h-none">
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
                            id="config-form"
                            onSubmit={handleSubmit}
                            class="flex flex-col gap-4"
                        >
                            <div class="space-y-1">
                                <label for="url" class="text-sm font-medium text-gray-700">
                                    URL do Conteúdo <span class="text-red-500">*</span>
                                </label>
                                <div class="relative">
                                    <Globe class="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                                    <input
                                        id="url"
                                        type="url"
                                        required
                                        placeholder="https://exemplo.com/artigo"
                                        value={url()}
                                        onInput={(e) =>
                                            setUrl((e.currentTarget as HTMLInputElement).value)
                                        }
                                        class="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors text-sm"
                                    />
                                </div>
                            </div>

                            <div class="space-y-1">
                                <label for="intent" class="text-sm font-medium text-gray-700">
                                    Intenção (Opcional)
                                </label>
                                <select
                                    id="intent"
                                    value={intent()}
                                    onChange={(e) =>
                                        setIntent((e.currentTarget as HTMLSelectElement).value)
                                    }
                                    class="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors text-sm bg-white"
                                >
                                    <option value="">Perguntar depois</option>
                                    {INTENT_OPTIONS.map((opt) => (
                                        <option value={opt.value}>
                                            {opt.label}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div class="space-y-1">
                                <label for="query" class="text-sm font-medium text-gray-700">
                                    Consulta Específica (Opcional)
                                </label>
                                <input
                                    id="query"
                                    type="text"
                                    placeholder="ex: resumir pontos chave"
                                    value={query()}
                                    onInput={(e) =>
                                        setQuery((e.currentTarget as HTMLInputElement).value)
                                    }
                                    class="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors text-sm"
                                />
                            </div>

                            <div class="space-y-1">
                                <label for="tone" class="text-sm font-medium text-gray-700">
                                    Tom (Opcional)
                                </label>
                                <input
                                    id="tone"
                                    type="text"
                                    placeholder="ex: profissional, divertido"
                                    value={tone()}
                                    onInput={(e) =>
                                        setTone((e.currentTarget as HTMLInputElement).value)
                                    }
                                    class="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors text-sm"
                                />
                            </div>

                            <button
                                type="submit"
                                disabled={isLoading() || !url()}
                                class={clsx(
                                    "mt-4 w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg font-medium text-white transition-all shadow-sm hover:shadow-md",
                                    isLoading() || !url()
                                        ? "bg-gray-300 cursor-not-allowed"
                                        : "bg-primary hover:bg-orange-600 active:scale-[0.98]",
                                )}
                            >
                                {isLoading() ? (
                                    <>
                                        <Loader2 class="w-4 h-4 animate-spin" />
                                        Processando...
                                    </>
                                ) : (
                                    <>
                                        <Send class="w-4 h-4" />
                                        Gerar Conteúdo
                                    </>
                                )}
                            </button>
                        </form>
                    </div>

                    <div class="mt-auto">
                        <div class="p-4 bg-orange-50 rounded-lg border border-orange-100">
                            <h3 class="text-xs font-semibold text-orange-800 mb-1 flex items-center gap-1">
                                <AlertCircle class="w-3 h-3" />
                                Dica
                            </h3>
                            <p class="text-xs text-orange-700 leading-relaxed">
                                Forneça uma URL para começar. Se não selecionar uma intenção,
                                a IA perguntará como você deseja usar o conteúdo.
                            </p>
                        </div>
                    </div>
                </aside>

                <main class="flex-1 flex flex-col bg-gray-50/50 relative min-h-0">
                    <div class="flex-1 overflow-y-auto p-4 md:p-8 space-y-6">
                        {messages().length === 0 && (
                            <div class="flex flex-col items-center justify-center h-full text-center text-gray-400 p-8">
                                <div class="w-16 h-16 bg-white rounded-2xl shadow-sm flex items-center justify-center mb-4">
                                    <Sparkles class="w-8 h-8 text-primary/60" />
                                </div>
                                <h3 class="text-lg font-medium text-gray-900 mb-2">
                                    Pronto para criar?
                                </h3>
                                <p class="max-w-md mx-auto">
                                    Insira uma URL na configuração lateral para gerar conteúdo
                                    para redes sociais, resumos e roteiros com IA.
                                </p>
                            </div>
                        )}

                        {error() && (
                            <div class="max-w-3xl mx-auto w-full p-4 bg-red-50 border border-red-100 rounded-2xl flex items-center gap-3 text-red-800">
                                <AlertCircle class="w-5 h-5 flex-shrink-0" />
                                <p class="text-sm">{error()}</p>
                            </div>
                        )}

                        {messages().map((msg) => (
                            <div
                                class={clsx(
                                    "flex gap-4 max-w-3xl mx-auto",
                                    msg.role === "user" ? "justify-end" : "justify-start",
                                )}
                            >
                                {msg.role === "assistant" && (
                                    <div class="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-orange-400 flex items-center justify-center flex-shrink-0 shadow-sm mt-1">
                                        <Bot class="w-5 h-5 text-white" />
                                    </div>
                                )}

                                <div
                                    class={clsx(
                                        "rounded-2xl p-5 shadow-sm text-sm leading-relaxed whitespace-pre-wrap max-w-[85%]",
                                        msg.role === "user"
                                            ? "bg-white text-gray-800 border-none ml-auto"
                                            : "bg-white text-gray-800 border border-gray-100",
                                    )}
                                >
                                    {msg.role === "assistant" ? (
                                        <MarkdownContent
                                            className="prose prose-sm max-w-none prose-orange"
                                            markdown={typeof msg.content === "string" ? msg.content : ""}
                                        />
                                    ) : (
                                        msg.content
                                    )}

                                    {msg.sources && msg.sources.length > 0 && (
                                        <div class="mt-4 pt-4 border-t border-gray-100">
                                            <p class="text-xs font-semibold text-gray-500 mb-2">
                                                Fontes:
                                            </p>
                                            <ul class="space-y-1">
                                                {msg.sources.map((source) => (
                                                    <li>
                                                        <a
                                                            href={source}
                                                            target="_blank"
                                                            rel="noreferrer"
                                                            class="text-xs text-primary hover:underline truncate block max-w-xs"
                                                        >
                                                            {source}
                                                        </a>
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}

                                    {msg.role === "assistant" &&
                                        msg.quickReplies &&
                                        msg.quickReplies.length > 0 && (
                                            <div class="mt-4 pt-4 border-t border-gray-100">
                                                <p class="text-xs font-semibold text-gray-500 mb-2">
                                                    Escolha uma opção:
                                                </p>
                                                <div class="flex flex-wrap gap-2">
                                                    {msg.quickReplies.map((qr) => (
                                                        <button
                                                            type="button"
                                                            disabled={isLoading() || !url()}
                                                            onClick={() => void runWithIntent(qr.intentValue)}
                                                            class={clsx(
                                                                "text-xs px-3 py-1.5 rounded-full border transition-colors",
                                                                isLoading() || !url()
                                                                    ? "bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed"
                                                                    : "bg-white text-gray-700 border-gray-200 hover:border-primary hover:text-primary",
                                                            )}
                                                        >
                                                            {qr.label}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                </div>

                                {msg.role === "user" && (
                                    <div class="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0 mt-1">
                                        <User class="w-5 h-5 text-gray-500" />
                                    </div>
                                )}
                            </div>
                        ))}

                        {isLoading() && (
                            <div class="flex gap-4 max-w-3xl mx-auto justify-start">
                                <div class="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-orange-400 flex items-center justify-center flex-shrink-0 mt-1">
                                    <Bot class="w-5 h-5 text-white" />
                                </div>
                                <div class="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 flex items-center gap-2">
                                    <span class="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ "animation-delay": "0ms" }} />
                                    <span class="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ "animation-delay": "150ms" }} />
                                    <span class="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ "animation-delay": "300ms" }} />
                                </div>
                            </div>
                        )}
                        <div ref={messagesEndRef} />
                    </div>

                    <div class="px-4 md:px-8 pb-4">
                        <div class="max-w-3xl mx-auto mb-4">
                            <GenerationApprovalCard generationId={latestGenerationId()} />
                        </div>

                        <div class="max-w-3xl mx-auto bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
                            <div class="flex items-center justify-between mb-2">
                                <p class="text-sm font-medium text-gray-700">
                                    Refinar resposta
                                </p>
                                <span class="text-xs text-gray-400">
                                    {lastAssistantResponse()
                                        ? "Resposta carregada"
                                        : "Sem resposta para refinar"}
                                </span>
                            </div>
                            <div class="flex flex-col md:flex-row gap-3">
                                <textarea
                                    id="refinement"
                                    rows={2}
                                    placeholder="Ex: aumente o texto, deixe mais persuasivo e inclua um CTA"
                                    value={refinement()}
                                    onInput={(e) =>
                                        setRefinement((e.currentTarget as HTMLTextAreaElement).value)
                                    }
                                    class="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors text-sm"
                                />
                                <button
                                    type="button"
                                    onClick={() => void handleRefine()}
                                    disabled={
                                        isLoading() ||
                                        !lastAssistantResponse() ||
                                        !refinement().trim()
                                    }
                                    class={clsx(
                                        "h-10 px-4 rounded-lg font-medium text-white transition-all shadow-sm hover:shadow-md",
                                        isLoading() ||
                                            !lastAssistantResponse() ||
                                            !refinement().trim()
                                            ? "bg-gray-300 cursor-not-allowed"
                                            : "bg-primary hover:bg-orange-600 active:scale-[0.98]",
                                    )}
                                >
                                    Refinar
                                </button>
                            </div>
                        </div>
                    </div>

                    <HelpModal
                        open={isHelpOpen()}
                        title="Ajuda — Social Agent"
                        markdown={helpMarkdown()}
                        onClose={() => setIsHelpOpen(false)}
                    />
                </main>
            </div>
        </div>
    );
}
