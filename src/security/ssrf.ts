import net from "node:net";
import { lookup } from "node:dns/promises";

export class UnsafeUrlError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "UnsafeUrlError";
    }
}

const BLOCKED_HOSTNAMES = new Set([
    "localhost",
    "localhost.localdomain",
    "local",
    "0.0.0.0",
    "127.0.0.1",
    "::1",
    "::",
]);

const isPrivateIpv4 = (address: string): boolean => {
    const parts = address.split(".").map((part) => Number(part));
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
        return true;
    }

    const a = parts[0] ?? -1;
    const b = parts[1] ?? -1;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    if (a >= 224) return true;
    return false;
};

const normalizeIpv6 = (address: string): string => {
    const lower = address.trim().toLowerCase();
    const zoneSplit = lower.split("%");
    const withoutZone = zoneSplit[0] ?? lower;
    return withoutZone;
};

const isPrivateIpv6 = (address: string): boolean => {
    const normalized = normalizeIpv6(address);
    if (normalized === "::1" || normalized === "::") {
        return true;
    }

    if (normalized.startsWith("fc") || normalized.startsWith("fd")) {
        return true;
    }

    if (
        normalized.startsWith("fe8") ||
        normalized.startsWith("fe9") ||
        normalized.startsWith("fea") ||
        normalized.startsWith("feb")
    ) {
        return true;
    }

    if (normalized.startsWith("ff")) {
        return true;
    }

    if (normalized.startsWith("2001:db8")) {
        return true;
    }

    if (normalized.startsWith("::ffff:")) {
        const mapped = normalized.replace(/^::ffff:/, "");
        if (net.isIP(mapped) === 4) {
            return isPrivateIpv4(mapped);
        }
    }

    return false;
};

export const isPrivateIpAddress = (address: string): boolean => {
    const type = net.isIP(address);
    if (type === 4) {
        return isPrivateIpv4(address);
    }
    if (type === 6) {
        return isPrivateIpv6(address);
    }
    return true;
};

const assertAllowedHostname = (hostname: string): void => {
    const normalized = hostname.trim().toLowerCase();
    if (!normalized) {
        throw new UnsafeUrlError("Hostname inválido.");
    }

    if (BLOCKED_HOSTNAMES.has(normalized)) {
        throw new UnsafeUrlError("Hostname não permitido.");
    }

    if (normalized.endsWith(".local") || normalized.endsWith(".internal")) {
        throw new UnsafeUrlError("Hostname não permitido.");
    }
};

const assertResolvedAddressesArePublic = async (hostname: string): Promise<void> => {
    let addresses: Array<{ address: string }> = [];
    try {
        addresses = await lookup(hostname, { all: true, verbatim: true });
    } catch {
        throw new UnsafeUrlError("Falha ao resolver hostname.");
    }

    if (addresses.length === 0) {
        throw new UnsafeUrlError("Hostname sem resolução de endereço.");
    }

    for (const resolved of addresses) {
        if (isPrivateIpAddress(resolved.address)) {
            throw new UnsafeUrlError("Hostname resolve para IP privado.");
        }
    }
};

export const assertSafeExternalUrl = async (rawUrl: string): Promise<URL> => {
    let parsed: URL;
    try {
        parsed = new URL(rawUrl);
    } catch {
        throw new UnsafeUrlError("URL inválida.");
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new UnsafeUrlError("Apenas URLs HTTP/HTTPS são permitidas.");
    }

    assertAllowedHostname(parsed.hostname);

    if (net.isIP(parsed.hostname)) {
        if (isPrivateIpAddress(parsed.hostname)) {
            throw new UnsafeUrlError("IP de destino não permitido.");
        }
        return parsed;
    }

    await assertResolvedAddressesArePublic(parsed.hostname);
    return parsed;
};
