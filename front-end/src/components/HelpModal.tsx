import { createEffect, onCleanup } from "solid-js";
import { X } from "lucide-solid";
import { MarkdownContent } from "./MarkdownContent";

export type HelpModalProps = {
    open: boolean;
    title: string;
    markdown: string;
    onClose: () => void;
};

export function HelpModal(props: HelpModalProps) {
    createEffect(() => {
        if (!props.open) return;

        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                props.onClose();
            }
        };

        window.addEventListener("keydown", onKeyDown);

        onCleanup(() => {
            window.removeEventListener("keydown", onKeyDown);
        });
    });

    if (!props.open) return null;

    return (
        <div class="fixed inset-0 z-50">
            <div
                class="absolute inset-0 bg-black/40"
                onClick={props.onClose}
                aria-hidden="true"
            />
            <div class="absolute inset-0 flex items-center justify-center p-4">
                <div class="w-full max-w-3xl bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">
                    <div class="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                        <h3 class="text-sm font-semibold text-gray-900">{props.title}</h3>
                        <button
                            type="button"
                            onClick={props.onClose}
                            class="text-gray-500 hover:text-gray-700"
                            aria-label="Fechar"
                        >
                            <X class="w-5 h-5" />
                        </button>
                    </div>

                    <div class="p-5 max-h-[75vh] overflow-y-auto">
                        <MarkdownContent
                            className="prose prose-sm max-w-none prose-orange"
                            markdown={props.markdown}
                        />
                    </div>

                    <div class="px-5 py-4 border-t border-gray-100 flex justify-end">
                        <button
                            type="button"
                            onClick={props.onClose}
                            class="px-4 py-2 rounded-lg bg-gray-900 text-white text-sm font-medium hover:bg-gray-800"
                        >
                            Fechar
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
