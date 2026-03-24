import nodemailer from "nodemailer";
import { envValid } from "../envSchema";

export type HttpEmailProvider = "postmark" | "resend" | "sendgrid";
export type EmailProvider = HttpEmailProvider | "gmail";

export type EmailEnv = {
    EMAIL_API_PROVIDER?: string;
    EMAIL_FROM?: string;
    EMAIL_PROVIDER_API_KEY?: string;
    GMAIL_CLIENT_ID?: string;
    GMAIL_CLIENT_SECRET?: string;
    GMAIL_REFRESH_TOKEN?: string;
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
    provider: HttpEmailProvider;
};

type GmailEmailConfig = {
    mode: "gmail";
    clientId: string;
    clientSecret: string;
    from: string;
    refreshToken: string;
};

export type EmailConfig = ApiEmailConfig | GmailEmailConfig | SmtpEmailConfig;

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

    if (
        value === "gmail" ||
        value === "postmark" ||
        value === "resend" ||
        value === "sendgrid"
    ) {
        return value;
    }

    throw new Error(
        `EMAIL_API_PROVIDER inválido: ${provider}. Use gmail, resend, sendgrid ou postmark.`,
    );
};

const normalizeRecipients = (to: string | string[]): string[] =>
    (Array.isArray(to) ? to : [to])
        .map((recipient) => recipient.trim())
        .filter(Boolean);

const resolveProviderApiKey = (
    provider: HttpEmailProvider,
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

const detectImplicitProvider = (env: EmailEnv): HttpEmailProvider | undefined => {
    const providers = [
        env.RESEND_API_KEY?.trim() ? "resend" : undefined,
        env.SENDGRID_API_KEY?.trim() ? "sendgrid" : undefined,
        env.POSTMARK_SERVER_TOKEN?.trim() ? "postmark" : undefined,
    ].filter((provider): provider is HttpEmailProvider => Boolean(provider));

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

    if (provider === "gmail") {
        const clientId = env.GMAIL_CLIENT_ID?.trim();
        const clientSecret = env.GMAIL_CLIENT_SECRET?.trim();
        const refreshToken = env.GMAIL_REFRESH_TOKEN?.trim();

        if (!from || !clientId || !clientSecret || !refreshToken) {
            throw new Error("Configuração de email Gmail incompleta.");
        }

        return {
            mode: "gmail",
            clientId,
            clientSecret,
            from,
            refreshToken,
        };
    }

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

const encodeBase64Url = (value: string): string =>
    Buffer.from(value, "utf8")
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");

const escapeMimeHeader = (value: string): string =>
    value.replace(/\r?\n/g, " ").trim();

const buildMimeMessage = (message: {
    from: string;
    html?: string;
    subject: string;
    text: string;
    to: string[];
}) => {
    const boundary = `socialagent-${crypto.randomUUID()}`;
    const headers = [
        `From: ${escapeMimeHeader(message.from)}`,
        `To: ${message.to.map(escapeMimeHeader).join(", ")}`,
        `Subject: ${escapeMimeHeader(message.subject)}`,
        "MIME-Version: 1.0",
    ];

    if (message.html) {
        return [
            ...headers,
            `Content-Type: multipart/alternative; boundary="${boundary}"`,
            "",
            `--${boundary}`,
            "Content-Type: text/plain; charset=UTF-8",
            "Content-Transfer-Encoding: 8bit",
            "",
            message.text,
            "",
            `--${boundary}`,
            "Content-Type: text/html; charset=UTF-8",
            "Content-Transfer-Encoding: 8bit",
            "",
            message.html,
            "",
            `--${boundary}--`,
            "",
        ].join("\r\n");
    }

    return [
        ...headers,
        "Content-Type: text/plain; charset=UTF-8",
        "Content-Transfer-Encoding: 8bit",
        "",
        message.text,
        "",
    ].join("\r\n");
};

const sendViaGmail = async (
    config: GmailEmailConfig,
    message: Required<Pick<SendEmailInput, "subject" | "text">> &
        Pick<SendEmailInput, "html"> & {
            from: string;
            to: string[];
        },
) => {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
            client_id: config.clientId,
            client_secret: config.clientSecret,
            grant_type: "refresh_token",
            refresh_token: config.refreshToken,
        }),
    });

    const tokenPayload = (await tokenResponse.json()) as {
        access_token?: string;
        error?: string;
        error_description?: string;
    };

    if (!tokenResponse.ok || !tokenPayload.access_token) {
        throw new Error(
            `[Email] Gmail token ${tokenResponse.status}: ${
                tokenPayload.error_description ??
                tokenPayload.error ??
                "Falha ao obter access token."
            }`,
        );
    }

    const raw = encodeBase64Url(buildMimeMessage(message));
    const sendResponse = await fetch(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
        {
            method: "POST",
            headers: {
                Authorization: `Bearer ${tokenPayload.access_token}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ raw }),
        },
    );

    if (!sendResponse.ok) {
        const details = await sendResponse.text();
        throw new Error(
            `[Email] Gmail send ${sendResponse.status}: ${details.slice(0, 500)}`,
        );
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
        `[Email] Usando transporte ${
            config.mode === "api"
                ? config.provider
                : config.mode === "gmail"
                  ? "gmail"
                  : "smtp"
        }.`,
    );

    if (config.mode === "api") {
        await sendViaApi(config, message);
        return;
    }

    if (config.mode === "gmail") {
        await sendViaGmail(config, message);
        return;
    }

    await sendViaSmtp(config, message);
};
