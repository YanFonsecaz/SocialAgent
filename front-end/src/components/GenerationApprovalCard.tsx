import { createEffect, createSignal } from "solid-js";
import { CheckCircle2 } from "lucide-solid";
import { approveLlmGeneration } from "../lib/api";

type GenerationApprovalCardProps = {
    generationId?: string | null;
    title?: string;
    onApproved?: () => void;
};

export function GenerationApprovalCard(props: GenerationApprovalCardProps) {
    const [status, setStatus] = createSignal<"idle" | "loading" | "approved">(
        "idle",
    );
    const [error, setError] = createSignal<string | null>(null);

    createEffect(() => {
        props.generationId;
        setStatus("idle");
        setError(null);
    });

    const handleApprove = async () => {
        if (!props.generationId || status() !== "idle") {
            return;
        }

        setStatus("loading");
        setError(null);

        try {
            await approveLlmGeneration(props.generationId);
            setStatus("approved");
            props.onApproved?.();
        } catch (err) {
            console.error(err);
            setStatus("idle");
            setError("Não foi possível aprovar a geração.");
        }
    };

    if (!props.generationId) {
        return null;
    }

    return (
        <section class="w-full bg-white border border-gray-200 rounded-xl p-4 flex flex-col gap-3">
            <div class="flex items-center justify-between gap-3">
                <div>
                    <p class="text-sm font-semibold text-gray-900">
                        {props.title ?? "Aprovação de conteúdo"}
                    </p>
                    <p class="text-xs text-gray-500">
                        Esta geração está em status draft e exige aprovação humana.
                    </p>
                </div>

                {status() === "approved" ? (
                    <span class="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-md bg-emerald-50 text-emerald-700">
                        <CheckCircle2 class="w-3.5 h-3.5" />
                        Aprovado
                    </span>
                ) : (
                    <button
                        type="button"
                        onClick={() => void handleApprove()}
                        disabled={status() === "loading"}
                        class="bg-gray-900 text-white rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-60"
                    >
                        {status() === "loading" ? "Aprovando..." : "Aprovar agora"}
                    </button>
                )}
            </div>

            {error() && <p class="text-xs text-red-600">{error()}</p>}
        </section>
    );
}
