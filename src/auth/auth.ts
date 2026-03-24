import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { magicLink } from "better-auth/plugins/magic-link";
import { db } from "../db/connection";
import {
    authAccounts,
    authSessions,
    authUsers,
    authVerifications,
} from "../db/schema/auth";
import { envValid } from "../envSchema";
import { sendEmail } from "../email/delivery";

const NP_DOMAIN = "@npbrasil.com";

const normalizeEmail = (email: string): string => email.trim().toLowerCase();

export const isAllowedNpEmail = (email: string): boolean =>
    normalizeEmail(email).endsWith(NP_DOMAIN);

const sendMagicLinkEmail = async (email: string, url: string) => {
    await sendEmail({
        to: email,
        subject: "Acesso SocialAgent",
        text: `Seu link de acesso: ${url}`,
        html: `<p>Seu link de acesso ao SocialAgent:</p><p><a href="${url}">${url}</a></p>`,
    });
};

export const auth = betterAuth({
    appName: "SocialAgent",
    baseURL: envValid.APP_BASE_URL,
    basePath: "/api/auth",
    secret: envValid.BETTER_AUTH_SECRET,
    trustedOrigins: [
        envValid.APP_BASE_URL,
        envValid.CORS_ORIGIN,
        "http://localhost:5173",
        "http://localhost:5174",
    ].filter((value): value is string => Boolean(value)),
    database: drizzleAdapter(db, {
        provider: "pg",
        schema: {
            user: authUsers,
            session: authSessions,
            account: authAccounts,
            verification: authVerifications,
        },
    }),
    session: {
        expiresIn: 60 * 60 * 8,
    },
    hooks: {
        before: createAuthMiddleware(async (ctx) => {
            if (ctx.path !== "/sign-in/magic-link") {
                return;
            }

            const email = normalizeEmail(String(ctx.body?.email ?? ""));
            if (!isAllowedNpEmail(email)) {
                throw new APIError("FORBIDDEN", {
                    message: "Acesso permitido apenas para @npbrasil.com",
                });
            }
        }),
    },
    plugins: [
        magicLink({
            expiresIn: 60 * 15,
            allowedAttempts: 1,
            storeToken: "hashed",
            sendMagicLink: async ({ email, token }) => {
                const callback = new URL("/auth/callback", envValid.APP_BASE_URL);
                callback.searchParams.set("token", token);
                await sendMagicLinkEmail(email, callback.toString());
            },
        }),
    ],
});

export type AuthSession = Awaited<ReturnType<typeof auth.api.getSession>>;
