import { expect, test } from "bun:test";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { createE2eAuthSession } from "./e2e-auth-session";

const BASE_URL =
    process.env.SOCIAL_AGENT_E2E_BASE_URL?.trim() || "http://localhost:3333";

const VIEWPORTS = [
    { width: 375, height: 812 },
    { width: 390, height: 844 },
] as const;

const assertPresent = async (page: Page, selector: string) => {
    const locator = page.locator(selector).first();
    try {
        await locator.waitFor({ state: "attached", timeout: 20_000 });
    } catch (error) {
        const currentUrl = page.url();
        const bodyText = (await page.textContent("body")) ?? "";
        throw new Error(
            `Selector não encontrado (${selector}) em ${currentUrl}. Body(head): ${bodyText.slice(
                0,
                240,
            )}`,
            { cause: error as Error },
        );
    }
    const count = await page.locator(selector).count();
    expect(count > 0).toBe(true);
};

const cookieValueFromHeader = (cookieHeader: string): string => {
    const [first] = cookieHeader.split(";");
    if (!first) {
        throw new Error("Cookie header inválido para sessão E2E.");
    }

    const eqIndex = first.indexOf("=");
    if (eqIndex < 0) {
        throw new Error("Cookie de sessão inválido.");
    }

    return first.slice(eqIndex + 1);
};

const openAuthenticatedContext = async (
    viewport: { width: number; height: number },
): Promise<{ browser: Browser; context: BrowserContext; page: Page }> => {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        viewport,
        baseURL: BASE_URL,
    });

    const session = await createE2eAuthSession();
    const value = cookieValueFromHeader(session.cookieHeader);

    await context.addCookies([
        {
            name: "better-auth.session_token",
            value,
            domain: new URL(BASE_URL).hostname,
            path: "/",
            secure: false,
            httpOnly: false,
            sameSite: "Lax",
        },
    ]);

    const page = await context.newPage();
    page.on("pageerror", (error) => {
        console.error("[mobile-pageerror]", error.message);
    });
    page.on("console", (message) => {
        if (message.type() === "error") {
            console.error("[mobile-console-error]", message.text());
        }
    });
    return { browser, context, page };
};

for (const viewport of VIEWPORTS) {
    test(
        `E2E mobile ${viewport.width}x${viewport.height}: login + 4 ferramentas protegidas`,
        async () => {
            const browser = await chromium.launch({ headless: true });
            const publicContext = await browser.newContext({
                viewport,
                baseURL: BASE_URL,
            });

            const loginPage = await publicContext.newPage();
            await loginPage.goto("/login");
            await assertPresent(loginPage, 'input[type="email"]');
            await assertPresent(loginPage, 'button[type="submit"]');
            await publicContext.close();
            await browser.close();

            const { browser: authBrowser, context, page } =
                await openAuthenticatedContext(viewport);
            try {
                await page.goto("/");
                await page.waitForLoadState("networkidle");
                await assertPresent(page, "input[type='url']");
                await assertPresent(page, "header nav a[href='/']");

                await page.goto("/strategist");
                await page.waitForLoadState("networkidle");
                await assertPresent(page, "#principal-url");
                await assertPresent(page, "#analysis-urls");

                await page.goto("/content-reviewer");
                await page.waitForLoadState("networkidle");
                await assertPresent(page, "h2");
                await assertPresent(page, "button");

                await page.goto("/trends-master");
                await page.waitForLoadState("networkidle");
                await assertPresent(page, "input[type='text']");
                await assertPresent(page, "button[type='submit']");
            } finally {
                await context.close();
                await authBrowser.close();
            }
        },
        60_000,
    );
}
