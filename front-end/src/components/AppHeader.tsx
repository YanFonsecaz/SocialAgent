import { type Component } from "solid-js";
import { A, useLocation } from "@solidjs/router";
import { Sparkles, Link2, BarChart3, FileText, History } from "lucide-solid";
import clsx from "clsx";
import { logout } from "../lib/api";

const navItems: Array<{
    to: string;
    label: string;
    icon: Component<{ class?: string }>;
}> = [
    { to: "/", label: "Social Agent", icon: Sparkles },
    { to: "/strategist", label: "Strategist Inlinks", icon: Link2 },
    { to: "/content-reviewer", label: "Content Reviewer", icon: FileText },
    { to: "/trends-master", label: "Trends Master", icon: BarChart3 },
    { to: "/history", label: "Histórico", icon: History },
];

export function AppHeader() {
    const location = useLocation();

    const handleLogout = async () => {
        try {
            await logout();
        } catch (error) {
            console.error(error);
        } finally {
            window.location.href = "/login";
        }
    };

    const isActive = (to: string) => {
        if (to === "/") {
            return location.pathname === "/";
        }
        return location.pathname.startsWith(to);
    };

    return (
        <header class="bg-white border-b border-gray-100 px-4 md:px-6 py-3 sticky top-0 z-10 shadow-sm">
            <div class="flex flex-col gap-3">
                <div class="flex items-center justify-between gap-4">
                    <div class="flex items-center gap-2 text-primary min-w-0">
                        <Sparkles class="w-6 h-6 flex-shrink-0" />
                        <h1 class="text-lg md:text-xl font-semibold tracking-tight text-gray-900 truncate">
                            SocialAgent
                        </h1>
                    </div>
                    <button
                        type="button"
                        class="text-sm font-medium text-gray-600 hover:text-gray-800"
                        onClick={handleLogout}
                    >
                        Sair
                    </button>
                </div>

                <nav class="flex items-center gap-1 overflow-x-auto pb-1">
                    {navItems.map((item) => (
                        <A
                            href={item.to}
                            class={clsx(
                                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs md:text-sm font-medium transition-colors whitespace-nowrap",
                                isActive(item.to)
                                    ? "bg-orange-50 text-primary"
                                    : "text-gray-500 hover:text-gray-700 hover:bg-gray-50",
                            )}
                        >
                            <item.icon class="w-4 h-4" />
                            {item.label}
                        </A>
                    ))}
                </nav>
            </div>
        </header>
    );
}
