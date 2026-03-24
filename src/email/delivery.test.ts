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

    test("accepts provider-specific env vars without EMAIL_PROVIDER_API_KEY", () => {
        const config = resolveEmailConfig({
            EMAIL_API_PROVIDER: "sendgrid",
            EMAIL_FROM: "no-reply@example.com",
            SENDGRID_API_KEY: "sg_test_123",
        });

        expect(config).toEqual({
            mode: "api",
            provider: "sendgrid",
            apiKey: "sg_test_123",
            from: "no-reply@example.com",
        });
    });

    test("auto-detects provider from a single provider-specific key", () => {
        const config = resolveEmailConfig({
            EMAIL_FROM: "no-reply@example.com",
            RESEND_API_KEY: "re_test_123",
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

    test("requires explicit provider when multiple provider-specific keys are set", () => {
        expect(() =>
            resolveEmailConfig({
                EMAIL_FROM: "no-reply@example.com",
                RESEND_API_KEY: "re_test_123",
                SENDGRID_API_KEY: "sg_test_123",
            }),
        ).toThrow(
            "Múltiplos providers de email configurados. Defina EMAIL_API_PROVIDER explicitamente.",
        );
    });
});
