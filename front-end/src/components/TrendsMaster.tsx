import { createMemo, createSignal, onMount } from "solid-js";
import {
    Sparkles,
    Loader2,
    AlertCircle,
    Save,
    Play,
    RefreshCcw,
    Mail,
    Tag,
    BarChart3,
    HelpCircle,
} from "lucide-solid";
import clsx from "clsx";
import {
    runTrendsMaster,
    getTrendsMasterConfig,
    updateTrendsMasterConfig,
    type TrendsConfig,
    type TrendsReport,
} from "../lib/api";
import { AppHeader } from "./AppHeader";
import { HelpModal } from "./HelpModal";
import { MarkdownContent } from "./MarkdownContent";
import { GenerationApprovalCard } from "./GenerationApprovalCard";
import helpMarkdownRaw from "../docs/user/trends-master.md";

const PERIOD_OPTIONS: Array<{
    value: "diario" | "semanal" | "mensal";
    label: string;
}> = [
    { value: "diario", label: "Diário" },
    { value: "semanal", label: "Semanal" },
    { value: "mensal", label: "Mensal" },
];

const defaultConfig: TrendsConfig = {
    sector: "Tecnologia",
    periods: ["diario", "semanal", "mensal"],
    topN: 5,
    risingN: 5,
    maxArticles: 3,
    customTopics: [],
    emailEnabled: false,
    emailRecipients: [],
    emailMode: "smtp",
    emailApiProvider: undefined,
};

export function TrendsMaster() {
    const [config, setConfig] = createSignal<TrendsConfig>(defaultConfig);
    const [isLoading, setIsLoading] = createSignal(false);
    const [isSaving, setIsSaving] = createSignal(false);
    const [error, setError] = createSignal<string | null>(null);
    const [report, setReport] = createSignal<TrendsReport | null>(null);
    const [isHelpOpen, setIsHelpOpen] = createSignal(false);
    const [latestGenerationId, setLatestGenerationId] = createSignal<
        string | null
    >(null);

    const helpMarkdown = createMemo(() =>
        typeof helpMarkdownRaw === "string"
            ? helpMarkdownRaw
            : String(helpMarkdownRaw),
    );

    const customTopicsText = createMemo(
        () => (config().customTopics || []).join("\n"),
    );

    const emailRecipientsText = createMemo(
        () => (config().emailRecipients || []).join("\n"),
    );

    const handleTogglePeriod = (period: "diario" | "semanal" | "mensal") => {
        setConfig((prev) => {
            const exists = prev.periods.includes(period);
            return {
                ...prev,
                periods: exists
                    ? prev.periods.filter((p) => p !== period)
                    : [...prev.periods, period],
            };
        });
    };

    const handleLoadConfig = async () => {
        setError(null);
        try {
            const response = await getTrendsMasterConfig();
            if (response?.config) {
                setConfig(response.config);
            }
        } catch (err) {
            console.error(err);
            setError("Falha ao carregar configuração.");
        }
    };

    const handleSaveConfig = async () => {
        setIsSaving(true);
        setError(null);
        try {
            await updateTrendsMasterConfig(config());
        } catch (err) {
            console.error(err);
            setError(
                err instanceof Error ? err.message : "Falha ao salvar configuração.",
            );
        } finally {
            setIsSaving(false);
        }
    };

    const handleRun = async (e: SubmitEvent) => {
        e.preventDefault();
        setIsLoading(true);
        setError(null);
        setReport(null);
        setLatestGenerationId(null);

        try {
            const response = await runTrendsMaster(config());
            if (response.success && response.report) {
                setLatestGenerationId(response.generationId ?? null);
                setReport(response.report);
            } else {
                setLatestGenerationId(null);
                setError(response.error || "Falha ao executar pipeline.");
            }
        } catch (err) {
            console.error(err);
            setLatestGenerationId(null);
            setError("Falha ao executar pipeline. Verifique o backend.");
        } finally {
            setIsLoading(false);
        }
    };

    onMount(() => {
        void handleLoadConfig();
    });

    return (
        <div class="flex flex-col h-screen bg-gray-50 text-gray-900 font-sans">
            <AppHeader />

            <div class="flex-1 flex flex-col md:flex-row overflow-hidden">
                <aside class="w-full md:w-96 bg-white border-b md:border-b-0 md:border-r border-gray-100 p-4 md:p-6 flex flex-col gap-6 overflow-y-auto max-h-[52vh] md:max-h-none">
                    <div class="flex items-center justify-between">
                        <h2 class="text-sm font-semibold text-gray-500 uppercase tracking-wider">
                            Trends Master
                        </h2>
                        <div class="flex items-center gap-3">
                            <button
                                type="button"
                                onClick={() => setIsHelpOpen(true)}
                                class="text-xs text-gray-600 hover:text-gray-800 flex items-center gap-1"
                                title="Ajuda"
                            >
                                <HelpCircle class="w-3.5 h-3.5" />
                                Ajuda
                            </button>

                            <button
                                type="button"
                                onClick={() => void handleLoadConfig()}
                                class="text-xs text-primary flex items-center gap-1"
                            >
                                <RefreshCcw class="w-3.5 h-3.5" />
                                Recarregar
                            </button>
                        </div>
                    </div>

                    <form onSubmit={handleRun} class="flex flex-col gap-4">
                        <div class="space-y-1">
                            <label class="text-sm font-medium text-gray-700">Setor</label>
                            <input
                                type="text"
                                value={config().sector}
                                onInput={(e) =>
                                    setConfig((prev) => ({
                                        ...prev,
                                        sector: (e.currentTarget as HTMLInputElement).value,
                                    }))
                                }
                                placeholder="ex: Tecnologia"
                                class="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary text-sm"
                            />
                        </div>

                        <div class="space-y-2">
                            <p class="text-sm font-medium text-gray-700">Períodos</p>
                            <div class="grid grid-cols-3 gap-2">
                                {PERIOD_OPTIONS.map((period) => (
                                    <button
                                        type="button"
                                        onClick={() => handleTogglePeriod(period.value)}
                                        class={clsx(
                                            "px-3 py-2 rounded-lg text-xs font-medium border transition-colors",
                                            config().periods.includes(period.value)
                                                ? "bg-orange-50 text-primary border-orange-200"
                                                : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50",
                                        )}
                                    >
                                        {period.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div class="grid grid-cols-3 gap-3">
                            <div class="space-y-1">
                                <label class="text-xs text-gray-600">Mais populares</label>
                                <input
                                    type="number"
                                    min={0}
                                    value={config().topN}
                                    onInput={(e) =>
                                        setConfig((prev) => ({
                                            ...prev,
                                            topN: Number(
                                                (e.currentTarget as HTMLInputElement).value,
                                            ),
                                        }))
                                    }
                                    class="w-full px-2 py-2 border border-gray-200 rounded-lg text-sm"
                                />
                            </div>
                            <div class="space-y-1">
                                <label class="text-xs text-gray-600">Em crescimento</label>
                                <input
                                    type="number"
                                    min={0}
                                    value={config().risingN}
                                    onInput={(e) =>
                                        setConfig((prev) => ({
                                            ...prev,
                                            risingN: Number(
                                                (e.currentTarget as HTMLInputElement).value,
                                            ),
                                        }))
                                    }
                                    class="w-full px-2 py-2 border border-gray-200 rounded-lg text-sm"
                                />
                            </div>
                            <div class="space-y-1">
                                <label class="text-xs text-gray-600">Artigos</label>
                                <input
                                    type="number"
                                    min={0}
                                    value={config().maxArticles}
                                    onInput={(e) =>
                                        setConfig((prev) => ({
                                            ...prev,
                                            maxArticles: Number(
                                                (e.currentTarget as HTMLInputElement).value,
                                            ),
                                        }))
                                    }
                                    class="w-full px-2 py-2 border border-gray-200 rounded-lg text-sm"
                                />
                            </div>
                        </div>

                        <div class="space-y-1">
                            <label class="text-sm font-medium text-gray-700 flex items-center gap-1">
                                <Tag class="w-4 h-4" />
                                Tópicos personalizados
                            </label>
                            <textarea
                                rows={4}
                                value={customTopicsText()}
                                onInput={(e) =>
                                    setConfig((prev) => ({
                                        ...prev,
                                        customTopics: (e.currentTarget as HTMLTextAreaElement).value
                                            .split("\n")
                                            .map((line) => line.trim())
                                            .filter(Boolean),
                                    }))
                                }
                                placeholder="um tópico por linha"
                                class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                            />
                        </div>

                        <div class="space-y-2">
                            <label class="text-sm font-medium text-gray-700 flex items-center gap-1">
                                <Mail class="w-4 h-4" />
                                Email
                            </label>
                            <div class="flex items-center gap-2">
                                <input
                                    id="emailEnabled"
                                    type="checkbox"
                                    checked={config().emailEnabled}
                                    onChange={(e) =>
                                        setConfig((prev) => ({
                                            ...prev,
                                            emailEnabled: (e.currentTarget as HTMLInputElement)
                                                .checked,
                                        }))
                                    }
                                    class="h-4 w-4"
                                />
                                <label for="emailEnabled" class="text-sm text-gray-600">
                                    Enviar relatório por email
                                </label>
                            </div>

                            <textarea
                                rows={3}
                                value={emailRecipientsText()}
                                onInput={(e) =>
                                    setConfig((prev) => ({
                                        ...prev,
                                        emailRecipients: (
                                            e.currentTarget as HTMLTextAreaElement
                                        ).value
                                            .split(/[\n,;]+/)
                                            .map((line) => line.trim())
                                            .filter(Boolean),
                                    }))
                                }
                                placeholder="emails (um por linha, virgula ou ponto e virgula)"
                                class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                            />

                            <input
                                type="text"
                                value={config().emailMode || "smtp"}
                                onInput={(e) =>
                                    setConfig((prev) => ({
                                        ...prev,
                                        emailMode: (e.currentTarget as HTMLInputElement).value,
                                    }))
                                }
                                placeholder="smtp"
                                class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                            />
                        </div>

                        <div class="grid grid-cols-2 gap-3 pt-2">
                            <button
                                type="button"
                                onClick={() => void handleSaveConfig()}
                                disabled={isSaving()}
                                class={clsx(
                                    "flex items-center justify-center gap-2 py-2.5 rounded-lg font-medium text-sm text-white",
                                    isSaving()
                                        ? "bg-gray-300 cursor-not-allowed"
                                        : "bg-gray-800 hover:bg-gray-900",
                                )}
                            >
                                {isSaving() ? (
                                    <Loader2 class="w-4 h-4 animate-spin" />
                                ) : (
                                    <Save class="w-4 h-4" />
                                )}
                                Salvar Config
                            </button>

                            <button
                                type="submit"
                                disabled={isLoading()}
                                class={clsx(
                                    "flex items-center justify-center gap-2 py-2.5 rounded-lg font-medium text-sm text-white",
                                    isLoading()
                                        ? "bg-gray-300 cursor-not-allowed"
                                        : "bg-primary hover:bg-orange-600",
                                )}
                            >
                                {isLoading() ? (
                                    <Loader2 class="w-4 h-4 animate-spin" />
                                ) : (
                                    <Play class="w-4 h-4" />
                                )}
                                Executar
                            </button>
                        </div>
                    </form>

                    <div class="mt-auto p-4 bg-orange-50 rounded-lg border border-orange-100 text-xs text-orange-700 leading-relaxed">
                        <p class="font-semibold text-orange-800 mb-1">Dica</p>
                        Use tópicos personalizados para forçar temas específicos e garantir
                        notícias relevantes.
                    </div>
                </aside>

                <main class="flex-1 overflow-y-auto p-4 md:p-8 space-y-6">
                    <div class="max-w-4xl mx-auto w-full">
                        <GenerationApprovalCard generationId={latestGenerationId()} />
                    </div>

                    {error() && (
                        <div class="max-w-4xl mx-auto w-full p-4 bg-red-50 border border-red-100 rounded-2xl flex items-center gap-3 text-red-800">
                            <AlertCircle class="w-5 h-5 flex-shrink-0" />
                            <p class="text-sm">{error()}</p>
                        </div>
                    )}

                    {!report() && !isLoading() && !error() && (
                        <div class="max-w-4xl mx-auto w-full bg-white rounded-2xl border border-gray-100 shadow-sm p-8 text-center">
                            <div class="w-16 h-16 bg-orange-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                                <BarChart3 class="w-8 h-8 text-primary/70" />
                            </div>
                            <h3 class="text-lg font-semibold text-gray-900 mb-2">
                                Pronto para gerar o relatório?
                            </h3>
                            <p class="text-gray-500">
                                Configure os parâmetros e clique em “Executar” para gerar as
                                tendências e notícias.
                            </p>
                        </div>
                    )}

                    {isLoading() && (
                        <div class="max-w-4xl mx-auto w-full bg-white rounded-2xl border border-gray-100 shadow-sm p-6 flex items-center gap-3">
                            <Loader2 class="w-5 h-5 animate-spin text-primary" />
                            <p class="text-sm text-gray-600">
                                Executando pipeline de trends...
                            </p>
                        </div>
                    )}

                    {report() && (
                        <div class="max-w-4xl mx-auto w-full space-y-6">
                            <div class="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
                                <h2 class="text-xl font-semibold text-gray-900 mb-2">
                                    {report()!.sector}
                                </h2>
                                <p class="text-sm text-gray-500">
                                    Gerado em: {String(report()!.generatedAt)}
                                </p>
                            </div>

                            <div class="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
                                <h3 class="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                                    <Sparkles class="w-5 h-5 text-primary" />
                                    Resumo
                                </h3>
                                <MarkdownContent
                                    className="prose prose-sm max-w-none prose-orange"
                                    markdown={report()!.summary}
                                />
                            </div>

                            <div class="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
                                <h3 class="text-lg font-semibold text-gray-900 mb-4">
                                    Relatório (Markdown)
                                </h3>
                                <MarkdownContent
                                    className="prose prose-sm max-w-none prose-orange"
                                    markdown={report()!.markdown}
                                />
                            </div>
                        </div>
                    )}

                    <HelpModal
                        open={isHelpOpen()}
                        title="Ajuda — Trends Master"
                        markdown={helpMarkdown()}
                        onClose={() => setIsHelpOpen(false)}
                    />
                </main>
            </div>
        </div>
    );
}
