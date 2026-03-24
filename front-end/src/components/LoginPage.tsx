import { createMemo, createSignal } from "solid-js";
import { requestMagicLink } from "../lib/api";

export function LoginPage() {
    const [email, setEmail] = createSignal("");
    const [loading, setLoading] = createSignal(false);
    const [error, setError] = createSignal<string | null>(null);
    const [success, setSuccess] = createSignal<string | null>(null);

    const normalizedEmail = createMemo(() => email().trim().toLowerCase());

    const handleSubmit = async (event: SubmitEvent) => {
        event.preventDefault();
        setError(null);
        setSuccess(null);

        if (!normalizedEmail().endsWith("@npbrasil.com")) {
            setError("Use um e-mail corporativo @npbrasil.com.");
            return;
        }

        try {
            setLoading(true);
            await requestMagicLink({ email: normalizedEmail() });
            setSuccess("Se o e-mail for válido, você receberá um link de acesso.");
        } catch (err) {
            console.error(err);
            setError(
                err instanceof Error && err.message.trim().length > 0
                    ? err.message
                    : "Não foi possível enviar o link. Tente novamente.",
            );
        } finally {
            setLoading(false);
        }
    };

    return (
        <main class="min-h-screen flex items-center justify-center bg-slate-50 px-4">
            <section class="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                <h1 class="text-2xl font-semibold text-slate-900 mb-2">
                    Login SocialAgent
                </h1>
                <p class="text-sm text-slate-600 mb-6">
                    Entre com seu e-mail corporativo da NP Brasil.
                </p>

                <form class="space-y-4" onSubmit={handleSubmit}>
                    <input
                        type="email"
                        required
                        placeholder="nome@npbrasil.com"
                        class="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-orange-500"
                        value={email()}
                        onInput={(event) =>
                            setEmail((event.currentTarget as HTMLInputElement).value)
                        }
                    />

                    <button
                        type="submit"
                        disabled={loading()}
                        class="w-full rounded-lg bg-orange-500 px-4 py-2 text-white font-medium disabled:opacity-60"
                    >
                        {loading() ? "Enviando..." : "Enviar magic link"}
                    </button>
                </form>

                {error() && <p class="mt-4 text-sm text-red-600">{error()}</p>}
                {success() && (
                    <p class="mt-4 text-sm text-emerald-700">{success()}</p>
                )}
            </section>
        </main>
    );
}
