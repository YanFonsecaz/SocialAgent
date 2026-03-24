import { beforeEach, expect, test } from "bun:test";
import { clearRateLimitStore, consumeRateLimit } from "./rate-limit";

beforeEach(() => {
    clearRateLimitStore();
});

test("consumeRateLimit: permite até o limite e bloqueia excedente", () => {
    const nowMs = 1_000;

    const first = consumeRateLimit({
        key: "email:test@npbrasil.com",
        limit: 2,
        windowMs: 60_000,
        nowMs,
    });
    const second = consumeRateLimit({
        key: "email:test@npbrasil.com",
        limit: 2,
        windowMs: 60_000,
        nowMs,
    });
    const third = consumeRateLimit({
        key: "email:test@npbrasil.com",
        limit: 2,
        windowMs: 60_000,
        nowMs,
    });

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(third.allowed).toBe(false);
    expect(third.remaining).toBe(0);
});

test("consumeRateLimit: reinicia janela após expiração", () => {
    const first = consumeRateLimit({
        key: "ip:1.2.3.4",
        limit: 1,
        windowMs: 1_000,
        nowMs: 10_000,
    });
    const blocked = consumeRateLimit({
        key: "ip:1.2.3.4",
        limit: 1,
        windowMs: 1_000,
        nowMs: 10_500,
    });
    const afterWindow = consumeRateLimit({
        key: "ip:1.2.3.4",
        limit: 1,
        windowMs: 1_000,
        nowMs: 11_100,
    });

    expect(first.allowed).toBe(true);
    expect(blocked.allowed).toBe(false);
    expect(afterWindow.allowed).toBe(true);
});
