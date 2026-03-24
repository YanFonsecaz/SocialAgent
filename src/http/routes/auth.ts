import { Elysia } from "elysia";
import { z } from "zod";
import { auth, isAllowedNpEmail } from "../../auth/auth";
import { forbiddenResponse } from "../plugins/auth-guard";
import { createApiErrorResponse } from "../error-response";
import { consumeRateLimit } from "../plugins/rate-limit";
import { getRequestId } from "../request-context";
import { logSecurityWarning } from "../structured-logger";

const jsonHeaders = {
    "Content-Type": "application/json",
};

const MAGIC_LINK_WINDOW_MS = 15 * 60 * 1000;
const MAGIC_LINK_MAX_PER_IP = 20;
const MAGIC_LINK_MAX_PER_EMAIL = 5;
const EMAIL_DELIVERY_ERROR_CODES = new Set([
    "EAUTH",
    "ECONNECTION",
    "ECONNREFUSED",
    "ESOCKET",
    "ETIMEDOUT",
]);

const isEmailDeliveryFailure = (error: unknown): boolean => {
    if (!error || typeof error !== "object") {
        return false;
    }

    const candidate = error as { code?: unknown; message?: unknown };
    const code =
        typeof candidate.code === "string"
            ? candidate.code.trim().toUpperCase()
            : "";
    if (EMAIL_DELIVERY_ERROR_CODES.has(code)) {
        return true;
    }

    const message =
        typeof candidate.message === "string"
            ? candidate.message.toLowerCase()
            : "";

    return (
        message.includes("configuração de email") ||
        message.includes("connection timeout") ||
        message.includes("timed out") ||
        message.includes("[email]")
    );
};

const resolveClientIp = (request: Request): string => {
    const forwardedFor = request.headers.get("x-forwarded-for");
    if (forwardedFor) {
        const first = forwardedFor
            .split(",")
            .map((entry) => entry.trim())
            .find(Boolean);
        if (first) {
            return first;
        }
    }

    const realIp = request.headers.get("x-real-ip")?.trim();
    if (realIp) {
        return realIp;
    }

    return "unknown";
};

export const authRoutes = new Elysia()
    .post(
        "/auth/magic-link/request",
        async ({ body, request }) => {
            const requestId = getRequestId(request);
            const email = body.email.trim().toLowerCase();

            if (!isAllowedNpEmail(email)) {
                return forbiddenResponse();
            }

            const clientIp = resolveClientIp(request);
            const ipRateLimit = consumeRateLimit({
                key: `magic-link:ip:${clientIp}`,
                limit: MAGIC_LINK_MAX_PER_IP,
                windowMs: MAGIC_LINK_WINDOW_MS,
            });
            if (!ipRateLimit.allowed) {
                logSecurityWarning({
                    requestId,
                    event: "auth_magic_link_rate_limited",
                    message: "Magic link bloqueado por limite de IP.",
                    metadata: {
                        ip: clientIp,
                        email,
                        scope: "ip",
                    },
                });

                return createApiErrorResponse({
                    status: 429,
                    code: "RATE_LIMITED",
                    message:
                        "Muitas tentativas de login. Aguarde alguns minutos e tente novamente.",
                    requestId,
                    headers: {
                        "Retry-After": String(ipRateLimit.retryAfterSec),
                    },
                });
            }

            const emailRateLimit = consumeRateLimit({
                key: `magic-link:email:${email}`,
                limit: MAGIC_LINK_MAX_PER_EMAIL,
                windowMs: MAGIC_LINK_WINDOW_MS,
            });
            if (!emailRateLimit.allowed) {
                logSecurityWarning({
                    requestId,
                    event: "auth_magic_link_rate_limited",
                    message: "Magic link bloqueado por limite de e-mail.",
                    metadata: {
                        ip: clientIp,
                        email,
                        scope: "email",
                    },
                });

                return createApiErrorResponse({
                    status: 429,
                    code: "RATE_LIMITED",
                    message:
                        "Muitas tentativas de login. Aguarde alguns minutos e tente novamente.",
                    requestId,
                    headers: {
                        "Retry-After": String(emailRateLimit.retryAfterSec),
                    },
                });
            }

            try {
                await auth.api.signInMagicLink({
                    body: {
                        email,
                    },
                    headers: request.headers,
                });
            } catch (error) {
                console.error("[Auth] Falha ao solicitar magic link:", error);
                if (isEmailDeliveryFailure(error)) {
                    return createApiErrorResponse({
                        status: 503,
                        code: "EMAIL_DELIVERY_FAILED",
                        message:
                            "O servico de e-mail esta indisponivel no momento. Tente novamente mais tarde.",
                        requestId,
                        details: error,
                    });
                }

                return createApiErrorResponse({
                    status: 500,
                    code: "AUTH_REQUEST_FAILED",
                    message: "Não foi possível solicitar o magic link.",
                    requestId,
                    details: error,
                });
            }

            return new Response(
                JSON.stringify({
                    success: true,
                    message:
                        "Se o e-mail for válido, um link de acesso será enviado.",
                }),
                { status: 202, headers: jsonHeaders },
            );
        },
        {
            body: z.object({
                email: z.string().email(),
            }),
        },
    )
    .post(
        "/auth/magic-link/verify",
        async ({ body, request }) => {
            const requestId = getRequestId(request);
            let verifyResponse: Response;
            try {
                verifyResponse = await auth.api.magicLinkVerify({
                    query: {
                        token: body.token,
                    },
                    headers: request.headers,
                    asResponse: true,
                });
            } catch (error) {
                console.error("[Auth] Falha ao verificar magic link:", error);
                return createApiErrorResponse({
                    status: 401,
                    code: "UNAUTHORIZED",
                    message: "Token inválido, expirado ou já utilizado.",
                    requestId,
                });
            }

            if (!verifyResponse.ok) {
                return createApiErrorResponse({
                    status: 401,
                    code: "UNAUTHORIZED",
                    message: "Token inválido, expirado ou já utilizado.",
                    requestId,
                });
            }

            const payload = (await verifyResponse.json()) as {
                user?: { id: string; email: string; name?: string };
            };

            const headers = new Headers(verifyResponse.headers);
            headers.set("Content-Type", "application/json");

            return new Response(
                JSON.stringify({
                    authenticated: true,
                    user: payload.user
                        ? {
                              id: payload.user.id,
                              email: payload.user.email,
                              name: payload.user.name,
                          }
                        : undefined,
                }),
                {
                    status: 200,
                    headers,
                },
            );
        },
        {
            body: z.object({
                token: z.string().min(1),
                callbackURL: z.string().optional(),
            }),
        },
    )
    .get("/auth/session", async ({ request }) => {
        const requestId = getRequestId(request);
        const session = await auth.api.getSession({
            headers: request.headers,
        });

        if (!session) {
            return createApiErrorResponse({
                status: 401,
                code: "UNAUTHORIZED",
                message: "Sessão inválida ou ausente.",
                requestId,
            });
        }

        if (!isAllowedNpEmail(session.user.email)) {
            return createApiErrorResponse({
                status: 403,
                code: "FORBIDDEN",
                message: "Acesso não permitido.",
                requestId,
            });
        }

        return {
            authenticated: true,
            user: {
                id: session.user.id,
                email: session.user.email,
                name: session.user.name,
            },
        };
    })
    .post("/auth/logout", async ({ request }) => {
        const signOutResponse = await auth.api.signOut({
            headers: request.headers,
            asResponse: true,
        });

        const headers = new Headers(signOutResponse.headers);
        headers.set("Content-Type", "application/json");

        return new Response(JSON.stringify({ success: true }), {
            status: signOutResponse.status || 200,
            headers,
        });
    });
