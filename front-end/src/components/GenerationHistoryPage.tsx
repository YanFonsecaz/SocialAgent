import { createMemo, createSignal, onMount } from "solid-js";
import {
    approveLlmGeneration,
    listLlmGenerations,
    type LlmGeneration,
    type LlmGenerationStatus,
} from "../lib/api";
import { AppHeader } from "./AppHeader";

const PAGE_SIZE = 20;

const formatDateTime = (value: string): string =>
    new Date(value).toLocaleString("pt-BR");

const formatCost = (value?: string): string => {
    if (!value) return "-";
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue)) return value;
    return numberValue.toLocaleString("pt-BR", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 6,
    });
};

export function GenerationHistoryPage() {
    const [items, setItems] = createSignal<LlmGeneration[]>([]);
    const [loading, setLoading] = createSignal(false);
    const [approvingId, setApprovingId] = createSignal<string | null>(null);
    const [error, setError] = createSignal<string | null>(null);
    const [total, setTotal] = createSignal(0);
    const [page, setPage] = createSignal(1);

    const [tool, setTool] = createSignal("");
    const [status, setStatus] = createSignal<"" | LlmGenerationStatus>("");
    const [from, setFrom] = createSignal("");
    const [to, setTo] = createSignal("");

    const totalPages = createMemo(() => Math.max(1, Math.ceil(total() / PAGE_SIZE)));

    const loadHistory = async (
        nextPage = 1,
        overrides?: {
            tool?: string;
            status?: "" | LlmGenerationStatus;
            from?: string;
            to?: string;
        },
    ) => {
        setLoading(true);
        setError(null);

        const nextTool = overrides?.tool ?? tool();
        const nextStatus = overrides?.status ?? status();
        const nextFrom = overrides?.from ?? from();
        const nextTo = overrides?.to ?? to();

        try {
            const response = await listLlmGenerations({
                tool: nextTool || undefined,
                status: nextStatus || undefined,
                from: nextFrom || undefined,
                to: nextTo || undefined,
                page: nextPage,
                pageSize: PAGE_SIZE,
            });
            setItems(response.items);
            setTotal(response.total);
            setPage(response.page);
        } catch (err) {
            console.error(err);
            setError("Falha ao carregar histórico de gerações.");
        } finally {
            setLoading(false);
        }
    };

    const handleSearch = async (event: SubmitEvent) => {
        event.preventDefault();
        await loadHistory(1);
    };

    const handleApprove = async (generationId: string) => {
        setApprovingId(generationId);
        setError(null);

        try {
            await approveLlmGeneration(generationId);
            await loadHistory(page());
        } catch (err) {
            console.error(err);
            setError("Falha ao aprovar geração.");
        } finally {
            setApprovingId(null);
        }
    };

    onMount(() => {
        void loadHistory(1);
    });

    return (
        <div class="flex flex-col h-screen bg-gray-50 text-gray-900 font-sans">
            <AppHeader />

            <main class="flex-1 overflow-auto px-6 py-6">
                <section class="bg-white border border-gray-200 rounded-xl p-4 mb-4">
                    <h2 class="text-lg font-semibold text-gray-900 mb-4">
                        Histórico de Gerações
                    </h2>

                    <form onSubmit={handleSearch} class="grid grid-cols-1 md:grid-cols-6 gap-3">
                        <input
                            type="text"
                            placeholder="Ferramenta (ex: social-agent)"
                            value={tool()}
                            onInput={(event) =>
                                setTool((event.currentTarget as HTMLInputElement).value)
                            }
                            class="border border-gray-200 rounded-lg px-3 py-2 text-sm"
                        />
                        <select
                            value={status()}
                            onChange={(event) =>
                                setStatus(
                                    (event.currentTarget as HTMLSelectElement).value as
                                        | ""
                                        | LlmGenerationStatus,
                                )
                            }
                            class="border border-gray-200 rounded-lg px-3 py-2 text-sm"
                        >
                            <option value="">Status (todos)</option>
                            <option value="draft">Draft</option>
                            <option value="approved">Approved</option>
                        </select>
                        <input
                            type="date"
                            value={from()}
                            onInput={(event) =>
                                setFrom((event.currentTarget as HTMLInputElement).value)
                            }
                            class="border border-gray-200 rounded-lg px-3 py-2 text-sm"
                        />
                        <input
                            type="date"
                            value={to()}
                            onInput={(event) =>
                                setTo((event.currentTarget as HTMLInputElement).value)
                            }
                            class="border border-gray-200 rounded-lg px-3 py-2 text-sm"
                        />
                        <button
                            type="submit"
                            disabled={loading()}
                            class="bg-orange-500 text-white rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-60"
                        >
                            {loading() ? "Carregando..." : "Filtrar"}
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                setTool("");
                                setStatus("");
                                setFrom("");
                                setTo("");
                                void loadHistory(1, {
                                    tool: "",
                                    status: "",
                                    from: "",
                                    to: "",
                                });
                            }}
                            class="border border-gray-200 rounded-lg px-3 py-2 text-sm font-medium"
                        >
                            Limpar
                        </button>
                    </form>

                    {error() && <p class="text-sm text-red-600 mt-3">{error()}</p>}
                </section>

                <section class="bg-white border border-gray-200 rounded-xl overflow-hidden">
                    <div class="overflow-x-auto">
                        <table class="min-w-full text-sm">
                            <thead class="bg-gray-50 text-gray-600">
                                <tr>
                                    <th class="text-left px-4 py-3">Data</th>
                                    <th class="text-left px-4 py-3">Ferramenta</th>
                                    <th class="text-left px-4 py-3">Status</th>
                                    <th class="text-left px-4 py-3">Tokens</th>
                                    <th class="text-left px-4 py-3">Latência</th>
                                    <th class="text-left px-4 py-3">Custo</th>
                                    <th class="text-left px-4 py-3">Ação</th>
                                </tr>
                            </thead>
                            <tbody>
                                {items().length === 0 && (
                                    <tr>
                                        <td colSpan={7} class="px-4 py-8 text-center text-gray-500">
                                            Nenhuma geração encontrada para os filtros atuais.
                                        </td>
                                    </tr>
                                )}

                                {items().map((item) => (
                                    <tr class="border-t border-gray-100 align-top">
                                        <td class="px-4 py-3 whitespace-nowrap">
                                            {formatDateTime(item.createdAt)}
                                        </td>
                                        <td class="px-4 py-3">{item.tool}</td>
                                        <td class="px-4 py-3">
                                            <span
                                                class={
                                                    item.status === "approved"
                                                        ? "text-emerald-700 font-medium"
                                                        : "text-amber-700 font-medium"
                                                }
                                            >
                                                {item.status}
                                            </span>
                                        </td>
                                        <td class="px-4 py-3">
                                            {item.tokensIn ?? "-"} / {item.tokensOut ?? "-"}
                                        </td>
                                        <td class="px-4 py-3">
                                            {item.latencyMs ? `${item.latencyMs} ms` : "-"}
                                        </td>
                                        <td class="px-4 py-3">{formatCost(item.costUsd)}</td>
                                        <td class="px-4 py-3">
                                            {item.status === "draft" ? (
                                                <button
                                                    type="button"
                                                    disabled={approvingId() === item.id}
                                                    onClick={() => void handleApprove(item.id)}
                                                    class="bg-gray-900 text-white rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-60"
                                                >
                                                    {approvingId() === item.id
                                                        ? "Aprovando..."
                                                        : "Aprovar"}
                                                </button>
                                            ) : (
                                                <span class="text-gray-400 text-xs">-</span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <footer class="px-4 py-3 border-t border-gray-100 flex items-center justify-between">
                        <p class="text-sm text-gray-600">
                            Total: <strong>{total()}</strong>
                        </p>
                        <div class="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => void loadHistory(Math.max(1, page() - 1))}
                                disabled={page() <= 1 || loading()}
                                class="border border-gray-200 rounded-md px-3 py-1.5 text-sm disabled:opacity-50"
                            >
                                Anterior
                            </button>
                            <span class="text-sm text-gray-600">
                                Página {page()} de {totalPages()}
                            </span>
                            <button
                                type="button"
                                onClick={() =>
                                    void loadHistory(Math.min(totalPages(), page() + 1))
                                }
                                disabled={page() >= totalPages() || loading()}
                                class="border border-gray-200 rounded-md px-3 py-1.5 text-sm disabled:opacity-50"
                            >
                                Próxima
                            </button>
                        </div>
                    </footer>
                </section>
            </main>
        </div>
    );
}
