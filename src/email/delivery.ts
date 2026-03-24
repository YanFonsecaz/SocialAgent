import nodemailer from "nodemailer";
import { envValid } from "../envSchema";

export type EmailProvider = "postmark" | "resend" | "sendgrid";

export type EmailEnv = {
    EMAIL_API_PROVIDER?: string;
    EMAIL_FROM?: string;
    EMAIL_PROVIDER_API_KEY?: string;
    POSTMARK_SERVER_TOKEN?: string;
    RESEND_API_KEY?: string;
    SENDGRID_API_KEY?: string;
    SMTP_HOST?: string;
    SMTP_PASSWORD?: string;
    SMTP_PORT?: string;
    SMTP_USER?: string;
};

type SmtpEmailConfig = {
    mode: "smtp";
    from: string;
    host: string;
    password: string;
    port: number;
    user: string;
};

type ApiEmailConfig = {
    mode: "api";
    apiKey: string;
    from: string;
    provider: EmailProvider;
};

export type EmailConfig = ApiEmailConfig | SmtpEmailConfig;

export type SendEmailInput = {
    to: string | string[];
    subject: string;
    text: string;
    html?: string;
    from?: string;
};

const SMTP_CONNECTION_TIMEOUT_MS = 10_000;
const SMTP_GREETING_TIMEOUT_MS = 10_000;
const SMTP_SOCKET_TIMEOUT_MS = 15_000;

const normalizeProvider = (provider?: string): EmailProvider | undefined => {
    const value = provider?.trim().toLowerCase();
    if (!value) {
        return undefined;
    }

    if (value === "postmark" || value === "resend" || value === "sendgrid") {
        return value;
    }

    throw new Error(
        `EMAIL_API_PROVIDER inválido: ${provider}. Use resend, sendgrid ou postmark.`,
    );
};

const normalizeRecipients = (to: string | string[]): string[] =>
    (Array.isArray(to) ? to : [to])
        .map((recipient) => recipient.trim())
        .filter(Boolean);

const resolveProviderApiKey = (
    provider: EmailProvider,
    env: EmailEnv,
): string | undefined => {
    const genericKey = env.EMAIL_PROVIDER_API_KEY?.trim();
    if (genericKey) {
        return genericKey;
    }

    switch (provider) {
        case "resend":
            return env.RESEND_API_KEY?.trim();
        case "sendgrid":
            return env.SENDGRID_API_KEY?.trim();
        case "postmark":
            return env.POSTMARK_SERVER_TOKEN?.trim();
        default: {
            const neverProvider: never = provider;
            throw new Error(`Provider de email não suportado: ${neverProvider}`);
        }
    }
};

const detectImplicitProvider = (env: EmailEnv): EmailProvider | undefined => {
    const providers = [
        env.RESEND_API_KEY?.trim() ? "resend" : undefined,
        env.SENDGRID_API_KEY?.trim() ? "sendgrid" : undefined,
        env.POSTMARK_SERVER_TOKEN?.trim() ? "postmark" : undefined,
    ].filter((provider): provider is EmailProvider => Boolean(provider));

    if (providers.length === 0) {
        return undefined;
    }

    if (providers.length > 1) {
        throw new Error(
            "Múltiplos providers de email configurados. Defina EMAIL_API_PROVIDER explicitamente.",
        );
    }

    return providers[0];
};

export const resolveEmailConfig = (env: EmailEnv = envValid): EmailConfig => {
    const provider =
        normalizeProvider(env.EMAIL_API_PROVIDER) ?? detectImplicitProvider(env);
    const from = env.EMAIL_FROM?.trim();

    if (provider) {
        const apiKey = resolveProviderApiKey(provider, env);
        if (!from || !apiKey) {
            throw new Error(
                `Configuração de email por API incompleta para ${provider}.`,
            );
        }

        return {
            mode: "api",
            provider,
            apiKey,
            from,
        };
    }

    const host = env.SMTP_HOST?.trim();
    const user = env.SMTP_USER?.trim();
    const password = env.SMTP_PASSWORD?.trim();
    const portRaw = env.SMTP_PORT?.trim();
    const port = portRaw ? Number(portRaw) : 587;

    if (!host || !user || !password || !from) {
        throw new Error(
            "Configuração de email incompleta. Defina um provider por API ou SMTP.",
        );
    }

    return {
        mode: "smtp",
        host,
        user,
        password,
        from,
        port: Number.isFinite(port) ? port : 587,
    };
};

const sendViaResend = async (
    config: ApiEmailConfig,
    message: Required<Pick<SendEmailInput, "subject" | "text">> &
        Pick<SendEmailInput, "html"> & {
            from: string;
            to: string[];
        },
) => {
    const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            from: message.from,
            to: message.to,
            subject: message.subject,
            text: message.text,
            html: message.html,
        }),
    });

    if (!response.ok) {
        const details = await response.text();
        throw new Error(
            `[Email] Resend ${response.status}: ${details.slice(0, 500)}`,
        );
    }
};

const sendViaSendGrid = async (
    config: ApiEmailConfig,
    message: Required<Pick<SendEmailInput, "subject" | "text">> &
        Pick<SendEmailInput, "html"> & {
            from: string;
            to: string[];
        },
) => {
    const content = [
        {
            type: "text/plain",
            value: message.text,
        },
    ];

    if (message.html) {
        content.push({
            type: "text/html",
            value: message.html,
        });
    }

    const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            personalizations: [
                {
                    to: message.to.map((email) => ({ email })),
                },
            ],
            from: {
                email: message.from,
            },
            subject: message.subject,
            content,
        }),
    });

    if (!response.ok) {
        const details = await response.text();
        throw new Error(
            `[Email] SendGrid ${response.status}: ${details.slice(0, 500)}`,
        );
    }
};

const sendViaPostmark = async (
    config: ApiEmailConfig,
    message: Required<Pick<SendEmailInput, "subject" | "text">> &
        Pick<SendEmailInput, "html"> & {
            from: string;
            to: string[];
        },
) => {
    const response = await fetch("https://api.postmarkapp.com/email", {
        method: "POST",
        headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "X-Postmark-Server-Token": config.apiKey,
        },
        body: JSON.stringify({
            From: message.from,
            To: message.to.join(", "),
            Subject: message.subject,
            TextBody: message.text,
            HtmlBody: message.html,
        }),
    });

    if (!response.ok) {
        const details = await response.text();
        throw new Error(
            `[Email] Postmark ${response.status}: ${details.slice(0, 500)}`,
        );
    }
};

const sendViaApi = async (
    config: ApiEmailConfig,
    message: Required<Pick<SendEmailInput, "subject" | "text">> &
        Pick<SendEmailInput, "html"> & {
            from: string;
            to: string[];
        },
) => {
    switch (config.provider) {
        case "resend":
            await sendViaResend(config, message);
            return;
        case "sendgrid":
            await sendViaSendGrid(config, message);
            return;
        case "postmark":
            await sendViaPostmark(config, message);
            return;
        default: {
            const neverProvider: never = config.provider;
            throw new Error(`Provider de email não suportado: ${neverProvider}`);
        }
    }
};

const sendViaSmtp = async (
    config: SmtpEmailConfig,
    message: Required<Pick<SendEmailInput, "subject" | "text">> &
        Pick<SendEmailInput, "html"> & {
            from: string;
            to: string[];
        },
) => {
    const transporter = nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.port === 465,
        auth: {
            user: config.user,
            pass: config.password,
        },
        connectionTimeout: SMTP_CONNECTION_TIMEOUT_MS,
        greetingTimeout: SMTP_GREETING_TIMEOUT_MS,
        socketTimeout: SMTP_SOCKET_TIMEOUT_MS,
        tls: {
            rejectUnauthorized: false,
        },
    });

    await transporter.sendMail({
        from: message.from,
        to: message.to.join(", "),
        subject: message.subject,
        text: message.text,
        html: message.html,
    });
};

export const sendEmail = async (
    input: SendEmailInput,
    env: EmailEnv = envValid,
) => {
    const config = resolveEmailConfig(env);
    const recipients = normalizeRecipients(input.to);
    if (recipients.length === 0) {
        throw new Error("Nenhum destinatário de email válido informado.");
    }

    const from = input.from?.trim() || config.from;
    const message = {
        from,
        to: recipients,
        subject: input.subject,
        text: input.text,
        html: input.html,
    };

    console.info(
        `[Email] Usando transporte ${config.mode === "api" ? config.provider : "smtp"}.`,
    );

    if (config.mode === "api") {
        await sendViaApi(config, message);
        return;
    }

    await sendViaSmtp(config, message);
};
