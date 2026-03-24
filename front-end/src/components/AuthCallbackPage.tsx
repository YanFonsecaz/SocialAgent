import { createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { A, useNavigate, useSearchParams } from "@solidjs/router";
import { verifyMagicLink } from "../lib/api";

export function AuthCallbackPage() {
    const navigate = useNavigate();
    const [params] = useSearchParams();
    const [error, setError] = createSignal<string | null>(null);
    const [verifying, setVerifying] = createSignal(true);

    const token = createMemo(() => {
        const raw = params.token;
        if (Array.isArray(raw)) {
            return (raw[0] ?? "").trim();
        }
        return (raw ?? "").trim();
    });

    createEffect(() => {
        const currentToken = token();
        let cancelled = false;

        void (async () => {
            if (!currentToken) {
                setError("Token ausente no link de autenticação.");
                setVerifying(false);
                return;
            }

            try {
                await verifyMagicLink({ token: currentToken });
                if (!cancelled) {
                    navigate("/", { replace: true });
                }
            } catch (err) {
                console.error(err);
                if (!cancelled) {
                    setError("Não foi possível validar o link. Solicite um novo.");
                }
            } finally {
                if (!cancelled) {
                    setVerifying(false);
                }
            }
        })();

        onCleanup(() => {
            cancelled = true;
        });
    });

    return (
        <main class="min-h-screen flex items-center justify-center bg-slate-50 px-4">
            <section class="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                <h1 class="text-2xl font-semibold text-slate-900 mb-2">
                    Validando acesso
                </h1>
                {verifying() && (
                    <p class="text-sm text-slate-600">
                        Aguarde enquanto finalizamos seu login...
                    </p>
                )}
                {!verifying() && error() && (
                    <p class="text-sm text-red-600">
                        {error()} {" "}
                        <A class="text-orange-600 underline" href="/login">
                            Voltar ao login
                        </A>
                    </p>
                )}
            </section>
        </main>
    );
}
