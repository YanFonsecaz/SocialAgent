import { useMemo, useState } from "react";
import {
    FileText,
    Upload,
    Download,
    CheckCircle2,
    XCircle,
    AlertCircle,
    Loader2,
} from "lucide-react";
import clsx from "clsx";
import {
    runContentReviewer,
    runContentReviewerCsv,
    fetchContentReviewerTemplate,
    type ContentReviewerResponse,
    type ContentReviewerRequest,
} from "../lib/api";
import { AppHeader } from "./AppHeader";

type Mode = "json" | "csv";

const sampleJson: ContentReviewerRequest = {
    items: [
        {
            url: "https://example.com",
            contentType: "blog",
            primaryKeyword: "marketing de conteúdo",
            supportingKeywords: ["funil", "seo"],
            expectedWordCount: 1200,
            outline: ["H2: Introdução", "H2: Estratégia", "H2: Conclusão"],
            cta: "Baixar ebook",
            personaPain: "falta de leads qualificados",
            internalLinksTarget: 3,
            maxInternalLinks: 12,
            titleTagExpected: "marketing de conteúdo para empresas",
        },
    ],
    guidelines: "Use um tom claro e objetivo.",
};

export function ContentReviewer() {
    const [mode, setMode] = useState<Mode>("csv");
    const [jsonText, setJsonText] = useState(JSON.stringify(sampleJson, null, 2));
    const [csvFile, setCsvFile] = useState<File | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<ContentReviewerResponse | null>(null);

    const totals = useMemo(() => {
        if (!result) return null;
        return {
            total: result.total ?? result.results.length,
            approved: result.approved ?? 0,
            rejected: result.rejected ?? 0,
            errors: result.errors ?? 0,
        };
    }, [result]);

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

    const handleSubmitJson = async () => {
        setError(null);
        setIsLoading(true);
        setResult(null);

        try {
            const parsed = JSON.parse(jsonText) as ContentReviewerRequest;
            const response = await runContentReviewer(parsed);
            setResult(response);
        } catch (err) {
            const message =
                err instanceof Error ? err.message : "Falha ao enviar JSON.";
            setError(message);
        } finally {
            setIsLoading(false);
        }
    };

    const handleSubmitCsv = async () => {
        setError(null);
        setIsLoading(true);
        setResult(null);

        try {
            if (!csvFile) {
                throw new Error("Selecione um arquivo CSV.");
            }
            const response = await runContentReviewerCsv(csvFile);
            setResult(response);
        } catch (err) {
            const message =
                err instanceof Error ? err.message : "Falha ao enviar CSV.";
            setError(message);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="flex flex-col h-screen bg-gray-50 text-gray-900 font-sans">
            <AppHeader />

            <main className="flex-1 overflow-y-auto">
                <div className="max-w-6xl mx-auto p-4 md:p-8 space-y-6">
                    <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <h2 className="text-lg font-semibold text-gray-900">
                                    Revisor de Conteúdo
                                </h2>
                                <p className="text-sm text-gray-500 mt-1">
                                    Envie um CSV ou JSON com os critérios por URL
                                    para aprovar ou reprovar conteúdos.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={handleDownloadTemplate}
                                className="inline-flex items-center gap-2 text-xs font-medium text-primary bg-orange-50 border border-orange-100 px-3 py-2 rounded-md hover:bg-orange-100"
                            >
                                <Download className="w-4 h-4" />
                                Baixar template CSV
                            </button>
                        </div>
                    </div>

                    <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                        <div className="flex border-b border-gray-100">
                            <button
                                type="button"
                                onClick={() => setMode("csv")}
                                className={clsx(
                                    "flex-1 px-4 py-3 text-sm font-medium",
                                    mode === "csv"
                                        ? "bg-orange-50 text-primary"
                                        : "text-gray-500 hover:text-gray-700",
                                )}
                            >
                                Upload CSV
                            </button>
                            <button
                                type="button"
                                onClick={() => setMode("json")}
                                className={clsx(
                                    "flex-1 px-4 py-3 text-sm font-medium",
                                    mode === "json"
                                        ? "bg-orange-50 text-primary"
                                        : "text-gray-500 hover:text-gray-700",
                                )}
                            >
                                Enviar JSON
                            </button>
                        </div>

                        {mode === "csv" ? (
                            <div className="p-5 space-y-4">
                                <div className="border border-dashed border-gray-200 rounded-lg p-6 text-center">
                                    <Upload className="w-6 h-6 text-gray-400 mx-auto mb-2" />
                                    <p className="text-sm text-gray-600">
                                        Selecione um arquivo CSV com os campos do
                                        template.
                                    </p>
                                    <input
                                        type="file"
                                        accept=".csv,text/csv"
                                        onChange={(e) =>
                                            setCsvFile(
                                                e.target.files?.[0] || null,
                                            )
                                        }
                                        className="mt-3 text-xs text-gray-500"
                                    />
                                    {csvFile && (
                                        <p className="mt-2 text-xs text-gray-500">
                                            Arquivo: {csvFile.name}
                                        </p>
                                    )}
                                </div>
                                <button
                                    type="button"
                                    onClick={handleSubmitCsv}
                                    disabled={isLoading || !csvFile}
                                    className={clsx(
                                        "w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg font-medium text-white transition-all shadow-sm",
                                        isLoading || !csvFile
                                            ? "bg-gray-300 cursor-not-allowed"
                                            : "bg-primary hover:bg-orange-600",
                                    )}
                                >
                                    {isLoading ? (
                                        <>
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                            Enviando...
                                        </>
                                    ) : (
                                        <>
                                            <FileText className="w-4 h-4" />
                                            Revisar CSV
                                        </>
                                    )}
                                </button>
                            </div>
                        ) : (
                            <div className="p-5 space-y-4">
                                <textarea
                                    value={jsonText}
                                    onChange={(e) => setJsonText(e.target.value)}
                                    rows={14}
                                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors text-xs font-mono leading-relaxed"
                                />
                                <button
                                    type="button"
                                    onClick={handleSubmitJson}
                                    disabled={isLoading}
                                    className={clsx(
                                        "w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg font-medium text-white transition-all shadow-sm",
                                        isLoading
                                            ? "bg-gray-300 cursor-not-allowed"
                                            : "bg-primary hover:bg-orange-600",
                                    )}
                                >
                                    {isLoading ? (
                                        <>
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                            Enviando...
                                        </>
                                    ) : (
                                        <>
                                            <FileText className="w-4 h-4" />
                                            Revisar JSON
                                        </>
                                    )}
                                </button>
                            </div>
                        )}
                    </div>

                    {error && (
                        <div className="bg-red-50 border border-red-100 rounded-xl p-4 text-red-800 flex items-start gap-2">
                            <AlertCircle className="w-4 h-4 mt-0.5" />
                            <p className="text-sm">{error}</p>
                        </div>
                    )}

                    {result && totals && (
                        <div className="space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                                <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
                                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                                        Total
                                    </p>
                                    <p className="text-3xl font-bold text-gray-900 mt-1">
                                        {totals.total}
                                    </p>
                                </div>
                                <div className="bg-white rounded-xl border border-green-100 p-5 shadow-sm">
                                    <p className="text-xs font-semibold text-green-600 uppercase tracking-wider">
                                        Aprovados
                                    </p>
                                    <p className="text-3xl font-bold text-green-700 mt-1">
                                        {totals.approved}
                                    </p>
                                </div>
                                <div className="bg-white rounded-xl border border-red-100 p-5 shadow-sm">
                                    <p className="text-xs font-semibold text-red-600 uppercase tracking-wider">
                                        Reprovados
                                    </p>
                                    <p className="text-3xl font-bold text-red-700 mt-1">
                                        {totals.rejected}
                                    </p>
                                </div>
                                <div className="bg-white rounded-xl border border-amber-100 p-5 shadow-sm">
                                    <p className="text-xs font-semibold text-amber-600 uppercase tracking-wider">
                                        Erros Técnicos
                                    </p>
                                    <p className="text-3xl font-bold text-amber-700 mt-1">
                                        {totals.errors}
                                    </p>
                                </div>
                            </div>

                            <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                                <div className="p-5 border-b border-gray-50">
                                    <h3 className="text-sm font-semibold text-gray-900">
                                        Resultado por URL
                                    </h3>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="bg-gray-50 text-left">
                                                <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                                                    URL
                                                </th>
                                                <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                                                    Status
                                                </th>
                                                <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                                                    Motivo
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-50">
                                            {result.results.map((item, idx) => (
                                                <tr
                                                    key={`${item.url}-${idx}`}
                                                    className="hover:bg-gray-50/50 transition-colors"
                                                >
                                                    <td className="px-5 py-4 text-xs text-gray-600 break-all">
                                                        {item.url}
                                                    </td>
                                                    <td className="px-5 py-4">
                                                        <span
                                                            className={clsx(
                                                                "inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium",
                                                                item.status ===
                                                                    "approved"
                                                                    ? "bg-green-50 text-green-700"
                                                                    : item.status ===
                                                                        "rejected"
                                                                      ? "bg-red-50 text-red-700"
                                                                      : "bg-amber-50 text-amber-700",
                                                            )}
                                                        >
                                                            {item.status ===
                                                            "approved" ? (
                                                                <CheckCircle2 className="w-3 h-3" />
                                                            ) : item.status ===
                                                              "rejected" ? (
                                                                <XCircle className="w-3 h-3" />
                                                            ) : (
                                                                <AlertCircle className="w-3 h-3" />
                                                            )}
                                                            {item.status ===
                                                            "approved"
                                                                ? "Aprovado"
                                                                : item.status ===
                                                                    "rejected"
                                                                  ? "Reprovado"
                                                                  : "Erro Técnico"}
                                                        </span>
                                                    </td>
                                                    <td className="px-5 py-4 text-xs text-gray-600">
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
