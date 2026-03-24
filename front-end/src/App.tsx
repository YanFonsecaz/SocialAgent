import { Show, createEffect, createSignal, on, type JSX } from "solid-js";
import { Navigate, Route, Router, useLocation } from "@solidjs/router";
import { ChatInterface } from "./components/ChatInterface";
import { StrategistInlinks } from "./components/StrategistInlinks";
import { TrendsMaster } from "./components/TrendsMaster";
import { ContentReviewer } from "./components/ContentReviewer";
import { AuthCallbackPage } from "./components/AuthCallbackPage";
import { LoginPage } from "./components/LoginPage";
import { getAuthSession, UnauthorizedError } from "./lib/api";
import { GenerationHistoryPage } from "./components/GenerationHistoryPage";

function RequireAuth(props: { children: JSX.Element }) {
    const location = useLocation();
    const [loading, setLoading] = createSignal(true);
    const [authenticated, setAuthenticated] = createSignal(false);

    createEffect(
        on(
            () => location.pathname,
            async () => {
                setLoading(true);

                try {
                    await getAuthSession();
                    setAuthenticated(true);
                } catch (error) {
                    setAuthenticated(false);

                    if (!(error instanceof UnauthorizedError)) {
                        console.error(error);
                    }
                } finally {
                    setLoading(false);
                }
            },
            { defer: false },
        ),
    );

    return (
        <Show
            when={!loading()}
            fallback={
                <main class="min-h-screen flex items-center justify-center bg-slate-50">
                    <p class="text-sm text-slate-600">Carregando sessão...</p>
                </main>
            }
        >
            <Show when={authenticated()} fallback={<Navigate href="/login" />}>
                {props.children}
            </Show>
        </Show>
    );
}

const ProtectedHome = () => (
    <RequireAuth>
        <ChatInterface />
    </RequireAuth>
);

const ProtectedStrategist = () => (
    <RequireAuth>
        <StrategistInlinks />
    </RequireAuth>
);

const ProtectedContentReviewer = () => (
    <RequireAuth>
        <ContentReviewer />
    </RequireAuth>
);

const ProtectedTrends = () => (
    <RequireAuth>
        <TrendsMaster />
    </RequireAuth>
);

const ProtectedHistory = () => (
    <RequireAuth>
        <GenerationHistoryPage />
    </RequireAuth>
);

function App() {
    return (
        <Router>
            <Route path="/login" component={LoginPage} />
            <Route path="/auth/callback" component={AuthCallbackPage} />
            <Route path="/" component={ProtectedHome} />
            <Route path="/strategist" component={ProtectedStrategist} />
            <Route
                path="/content-reviewer"
                component={ProtectedContentReviewer}
            />
            <Route path="/trends-master" component={ProtectedTrends} />
            <Route path="/history" component={ProtectedHistory} />
            <Route path="*" component={() => <Navigate href="/" />} />
        </Router>
    );
}

export default App;
