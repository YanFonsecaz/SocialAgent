import { describe, expect, test } from "bun:test";
import { resolveEmailConfig } from "./delivery";

describe("resolveEmailConfig", () => {
    test("prefers API provider when configured", () => {
        const config = resolveEmailConfig({
            EMAIL_API_PROVIDER: "Resend",
            EMAIL_FROM: "no-reply@example.com",
            EMAIL_PROVIDER_API_KEY: "re_test_123",
            SMTP_HOST: "smtp.example.com",
            SMTP_PASSWORD: "secret",
            SMTP_PORT: "587",
            SMTP_USER: "smtp-user",
        });

        expect(config).toEqual({
            mode: "api",
            provider: "resend",
            apiKey: "re_test_123",
            from: "no-reply@example.com",
        });
    });

    test("falls back to SMTP when API provider is absent", () => {
        const config = resolveEmailConfig({
            EMAIL_FROM: "no-reply@example.com",
            SMTP_HOST: "smtp.example.com",
            SMTP_PASSWORD: "secret",
            SMTP_PORT: "2525",
            SMTP_USER: "smtp-user",
        });

        expect(config).toEqual({
            mode: "smtp",
            host: "smtp.example.com",
            password: "secret",
            port: 2525,
            user: "smtp-user",
            from: "no-reply@example.com",
        });
    });

    test("rejects unsupported API provider names", () => {
        expect(() =>
            resolveEmailConfig({
                EMAIL_API_PROVIDER: "ses",
                EMAIL_FROM: "no-reply@example.com",
                EMAIL_PROVIDER_API_KEY: "key",
            }),
        ).toThrow(
            "EMAIL_API_PROVIDER inválido: ses. Use resend, sendgrid ou postmark.",
        );
    });

    test("requires a complete email configuration", () => {
        expect(() =>
            resolveEmailConfig({
                EMAIL_FROM: "no-reply@example.com",
                SMTP_HOST: "smtp.example.com",
            }),
        ).toThrow(
            "Configuração de email incompleta. Defina um provider por API ou SMTP.",
        );
    });
});
