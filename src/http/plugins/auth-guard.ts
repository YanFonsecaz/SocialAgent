import { auth, isAllowedNpEmail } from "../../auth/auth";
import { createApiErrorResponse } from "../error-response";

export type AppAuthenticatedContext = {
    userId: string;
    email: string;
    name?: string;
};

const PROTECTED_PREFIXES = [
    "/social-agent",
    "/strategist/inlinks",
    "/strategist/content-reviewer",
    "/api/trends-master",
    "/llm/generations",
];

export const isProtectedPath = (pathname: string): boolean =>
    PROTECTED_PREFIXES.some(
        (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    );

const requestAuthContextCache = new WeakMap<Request, AppAuthenticatedContext | null>();

export const getCachedAuthContext = (
    request: Request,
): AppAuthenticatedContext | null | undefined => {
    if (!requestAuthContextCache.has(request)) {
        return undefined;
    }
    return requestAuthContextCache.get(request) ?? null;
};

export const unauthorizedResponse = () =>
    createApiErrorResponse({
        status: 401,
        code: "UNAUTHORIZED",
        message: "Sessão inválida ou ausente.",
    });

export const forbiddenResponse = () =>
    createApiErrorResponse({
        status: 403,
        code: "FORBIDDEN",
        message: "Acesso não permitido.",
    });

export const resolveAuthContext = async (
    request: Request,
): Promise<AppAuthenticatedContext | null> => {
    if (requestAuthContextCache.has(request)) {
        return requestAuthContextCache.get(request) ?? null;
    }

    const session = await auth.api.getSession({
        headers: request.headers,
    });

    if (!session) {
        requestAuthContextCache.set(request, null);
        return null;
    }

    const email = session.user.email?.trim().toLowerCase() ?? "";
    if (!isAllowedNpEmail(email)) {
        await auth.api.signOut({
            headers: request.headers,
        });
        requestAuthContextCache.set(request, null);
        return null;
    }

    const authContext = {
        userId: session.user.id,
        email: session.user.email,
        name: session.user.name,
    };
    requestAuthContextCache.set(request, authContext);
    return authContext;
};
