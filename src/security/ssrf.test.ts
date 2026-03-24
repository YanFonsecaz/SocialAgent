import { expect, test } from "bun:test";
import { UnsafeUrlError, assertSafeExternalUrl, isPrivateIpAddress } from "./ssrf";

test("isPrivateIpAddress: identifica faixas privadas IPv4", () => {
    expect(isPrivateIpAddress("127.0.0.1")).toBe(true);
    expect(isPrivateIpAddress("10.1.2.3")).toBe(true);
    expect(isPrivateIpAddress("192.168.10.20")).toBe(true);
    expect(isPrivateIpAddress("172.20.8.9")).toBe(true);
    expect(isPrivateIpAddress("8.8.8.8")).toBe(false);
});

test("isPrivateIpAddress: identifica faixas privadas IPv6", () => {
    expect(isPrivateIpAddress("::1")).toBe(true);
    expect(isPrivateIpAddress("fc00::1")).toBe(true);
    expect(isPrivateIpAddress("fe80::1")).toBe(true);
    expect(isPrivateIpAddress("2606:4700:4700::1111")).toBe(false);
});

test("assertSafeExternalUrl: bloqueia localhost e IP privado", async () => {
    await expect(assertSafeExternalUrl("http://localhost:3000")).rejects.toBeInstanceOf(
        UnsafeUrlError,
    );
    await expect(assertSafeExternalUrl("http://127.0.0.1:8080")).rejects.toBeInstanceOf(
        UnsafeUrlError,
    );
});

test("assertSafeExternalUrl: bloqueia protocolo não-http", async () => {
    await expect(assertSafeExternalUrl("ftp://example.com")).rejects.toBeInstanceOf(
        UnsafeUrlError,
    );
});

test("assertSafeExternalUrl: aceita URL pública com IPv4 literal", async () => {
    const url = await assertSafeExternalUrl("https://8.8.8.8/path");
    expect(url.toString()).toBe("https://8.8.8.8/path");
});
