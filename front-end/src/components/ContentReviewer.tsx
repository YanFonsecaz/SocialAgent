import { createMemo, createSignal } from "solid-js";
import {
    FileText,
    Upload,
    Download,
    CheckCircle2,
    XCircle,
    AlertCircle,
    Loader2,
} from "lucide-solid";
import clsx from "clsx";
import {
    runContentReviewerCsv,
    fetchContentReviewerTemplate,
    type ContentReviewerResponse,
} from "../lib/api";
import { AppHeader } from "./AppHeader";
import { GenerationApprovalCard } from "./GenerationApprovalCard";

export function ContentReviewer() {
    let fileInputRef: HTMLInputElement | undefined;

    const [csvFile, setCsvFile] = createSignal<File | null>(null);
    const [isLoading, setIsLoading] = createSignal(false);
    const [error, setError] = createSignal<string | null>(null);
    const [result, setResult] = createSignal<ContentReviewerResponse | null>(null);
    const [latestGenerationId, setLatestGenerationId] = createSignal<
        string | null
    >(null);

    const totals = createMemo(() => {
        const current = result();
        if (!current) return null;
        return {
            total: current.total ?? current.results.length,
            approved: current.approved ?? 0,
            rejected: current.rejected ?? 0,
            errors: current.errors ?? 0,
        };
    });

    const handleDownloadTemplate = async () => {
        setError(null);
        try {
            const csv = await fetchContentReviewerTemplate();
            const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = "content-reviewer-template.csv";
            link.click();
            URL.revokeObjectURL(url);
        } catch (err) {
            const message =
                err instanceof Error ? err.message : "Falha ao baixar template.";
            setError(message);
        }
    };

    const handleSubmitCsv = async () => {
        setError(null);
        setIsLoading(true);
        setResult(null);
        setLatestGenerationId(null);

        try {
            if (!csvFile()) {
                throw new Error("Selecione um arquivo CSV.");
            }
            const response = await runContentReviewerCsv(csvFile() as File);
            setResult(response);
            setLatestGenerationId(response.generationId ?? null);
        } catch (err) {
            const message =
                err instanceof Error ? err.message : "Falha ao enviar CSV.";
            setError(message);
        } finally {
            setIsLoading(false);
        }
    };

    const handleOpenFilePicker = () => {
        fileInputRef?.click();
    };

    return (
        <div class="flex flex-col h-screen bg-gray-50 text-gray-900 font-sans">
            <AppHeader />

            <main class="flex-1 overflow-y-auto">
                <div class="max-w-6xl mx-auto p-4 md:p-8 space-y-6">
                    <GenerationApprovalCard generationId={latestGenerationId()} />

                    <div class="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
                        <div class="flex items-start justify-between gap-4">
                            <div>
                                <h2 class="text-lg font-semibold text-gray-900">
                                    Revisor de Conteúdo
                                </h2>
                                <p class="text-sm text-gray-500 mt-1">
                                    Envie um CSV com os critérios por URL para
                                    aprovar ou reprovar conteúdos.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => void handleDownloadTemplate()}
                                class="inline-flex items-center gap-2 text-xs font-medium text-primary bg-orange-50 border border-orange-100 px-3 py-2 rounded-md hover:bg-orange-100"
                            >
                                <Download class="w-4 h-4" />
                                Baixar template CSV
                            </button>
                        </div>
                    </div>

                    <div class="bg-white rounded-xl border border-gray-100 shadow-sm p-5 space-y-4">
                        <button
                            type="button"
                            onClick={handleOpenFilePicker}
                            class="w-full border border-dashed border-gray-200 rounded-lg p-6 text-center hover:border-orange-300 hover:bg-orange-50/40 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/20"
                        >
                            <Upload class="w-6 h-6 text-gray-400 mx-auto mb-2" />
                            <p class="text-sm text-gray-600">
                                Clique aqui para selecionar um arquivo CSV com os
                                campos do template.
                            </p>
                            <p class="mt-2 text-xs text-gray-500">
                                {csvFile()
                                    ? `Arquivo selecionado: ${csvFile()!.name}`
                                    : "Nenhum arquivo selecionado"}
                            </p>
                            <span class="mt-3 inline-flex items-center justify-center px-3 py-1.5 rounded-md text-xs font-medium border border-gray-200 text-gray-600 bg-white">
                                Selecionar CSV
                            </span>
                        </button>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".csv,text/csv"
                            onChange={(event) =>
                                setCsvFile(
                                    (event.currentTarget as HTMLInputElement).files?.[0] ||
                                        null,
                                )
                            }
                            class="hidden"
                        />

                        <button
                            type="button"
                            onClick={() => void handleSubmitCsv()}
                            disabled={isLoading() || !csvFile()}
                            class={clsx(
                                "w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg font-medium text-white transition-all shadow-sm",
                                isLoading() || !csvFile()
                                    ? "bg-gray-300 cursor-not-allowed"
                                    : "bg-primary hover:bg-orange-600",
                            )}
                        >
                            {isLoading() ? (
                                <>
                                    <Loader2 class="w-4 h-4 animate-spin" />
                                    Enviando...
                                </>
                            ) : (
                                <>
                                    <FileText class="w-4 h-4" />
                                    Revisar CSV
                                </>
                            )}
                        </button>
                    </div>

                    {error() && (
                        <div class="bg-red-50 border border-red-100 rounded-xl p-4 text-red-800 flex items-start gap-2">
                            <AlertCircle class="w-4 h-4 mt-0.5" />
                            <p class="text-sm">{error()}</p>
                        </div>
                    )}

                    {result() && totals() && (
                        <div class="space-y-4">
                            <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
                                <div class="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
                                    <p class="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                                        Total
                                    </p>
                                    <p class="text-3xl font-bold text-gray-900 mt-1">
                                        {totals()!.total}
                                    </p>
                                </div>
                                <div class="bg-white rounded-xl border border-green-100 p-5 shadow-sm">
                                    <p class="text-xs font-semibold text-green-600 uppercase tracking-wider">
                                        Aprovados
                                    </p>
                                    <p class="text-3xl font-bold text-green-700 mt-1">
                                        {totals()!.approved}
                                    </p>
                                </div>
                                <div class="bg-white rounded-xl border border-red-100 p-5 shadow-sm">
                                    <p class="text-xs font-semibold text-red-600 uppercase tracking-wider">
                                        Reprovados
                                    </p>
                                    <p class="text-3xl font-bold text-red-700 mt-1">
                                        {totals()!.rejected}
                                    </p>
                                </div>
                                <div class="bg-white rounded-xl border border-amber-100 p-5 shadow-sm">
                                    <p class="text-xs font-semibold text-amber-600 uppercase tracking-wider">
                                        Erros Técnicos
                                    </p>
                                    <p class="text-3xl font-bold text-amber-700 mt-1">
                                        {totals()!.errors}
                                    </p>
                                </div>
                            </div>

                            <div class="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                                <div class="p-5 border-b border-gray-50">
                                    <h3 class="text-sm font-semibold text-gray-900">
                                        Resultado por URL
                                    </h3>
                                </div>
                                <div class="overflow-x-auto">
                                    <table class="w-full text-sm">
                                        <thead>
                                            <tr class="bg-gray-50 text-left">
                                                <th class="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                                                    URL
                                                </th>
                                                <th class="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                                                    Status
                                                </th>
                                                <th class="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                                                    Motivo
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody class="divide-y divide-gray-50">
                                            {result()!.results.map((item) => (
                                                <tr
                                                    class="hover:bg-gray-50/50 transition-colors"
                                                >
                                                    <td class="px-5 py-4 text-xs text-gray-600 break-all">
                                                        {item.url}
                                                    </td>
                                                    <td class="px-5 py-4">
                                                        <span
                                                            class={clsx(
                                                                "inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium",
                                                                item.status === "approved"
                                                                    ? "bg-green-50 text-green-700"
                                                                    : item.status === "rejected"
                                                                      ? "bg-red-50 text-red-700"
                                                                      : "bg-amber-50 text-amber-700",
                                                            )}
                                                        >
                                                            {item.status === "approved" ? (
                                                                <CheckCircle2 class="w-3 h-3" />
                                                            ) : item.status === "rejected" ? (
                                                                <XCircle class="w-3 h-3" />
                                                            ) : (
                                                                <AlertCircle class="w-3 h-3" />
                                                            )}
                                                            {item.status === "approved"
                                                                ? "Aprovado"
                                                                : item.status === "rejected"
                                                                  ? "Reprovado"
                                                                  : "Erro Técnico"}
                                                        </span>
                                                    </td>
                                                    <td class="px-5 py-4 text-xs text-gray-600">
                                                        {item.reason}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}
