import nodemailer from "nodemailer";
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

const NP_DOMAIN = "@npbrasil.com";

const normalizeEmail = (email: string): string => email.trim().toLowerCase();

export const isAllowedNpEmail = (email: string): boolean =>
    normalizeEmail(email).endsWith(NP_DOMAIN);

const getSmtpConfig = () => {
    const host = envValid.SMTP_HOST;
    const user = envValid.SMTP_USER;
    const password = envValid.SMTP_PASSWORD;
    const from = envValid.EMAIL_FROM;
    const portRaw = envValid.SMTP_PORT;
    const port = portRaw ? Number(portRaw) : 587;

    if (!host || !user || !password || !from) {
        throw new Error(
            "Configuração SMTP incompleta para envio de magic link.",
        );
    }

    return {
        host,
        user,
        password,
        from,
        port: Number.isFinite(port) ? port : 587,
    };
};

const sendMagicLinkEmail = async (email: string, url: string) => {
    const smtp = getSmtpConfig();
    const transporter = nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.port === 465,
        auth: {
            user: smtp.user,
            pass: smtp.password,
        },
    });

    await transporter.sendMail({
        from: smtp.from,
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
