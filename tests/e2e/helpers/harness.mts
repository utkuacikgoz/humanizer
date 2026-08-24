// Shared browser harness for the Ownword E2E suite.
//
// Design constraints that shape everything in this file:
//
// 1. Playwright is installed system-wide, NOT as a project dependency, and
//    must stay that way (CI has no browser and `npm test` must not need one).
//    It is therefore resolved by absolute path at runtime, and every E2E file
//    skips itself with a clear message when the browser is unavailable rather
//    than failing a run that was never meant to include it.
// 2. The suite drives a dev server that is already running. It never starts
//    one, and it never mutates application state that another run could see.
// 3. `POST /api/humanize` is guarded per client IP (12 requests / 60s,
//    2 concurrent — src/lib/preview-request-guard.ts). Every context gets a
//    unique synthetic `cf-connecting-ip`, so tests are independent of each
//    other and of anything else hitting the same server.
import { createRequire } from "node:module";
import type { Browser, BrowserContext, Page, Response as PWResponse } from "playwright";

const PLAYWRIGHT_MODULE = "/opt/node22/lib/node_modules/playwright";
const CHROMIUM_EXECUTABLE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

export const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

let cachedBrowser: Browser | null = null;
let unavailableReason: string | null = null;

function loadPlaywright() {
  const require = createRequire(`${PLAYWRIGHT_MODULE}/`);
  return require(PLAYWRIGHT_MODULE) as typeof import("playwright");
}

/** Why the suite cannot run here, or `null` when it can. Never throws. */
export async function environmentBlocker(): Promise<string | null> {
  if (unavailableReason !== null) return unavailableReason || null;
  try {
    loadPlaywright();
  } catch {
    unavailableReason = `Playwright is not installed at ${PLAYWRIGHT_MODULE}`;
    return unavailableReason;
  }
  const { existsSync } = await import("node:fs");
  if (!existsSync(CHROMIUM_EXECUTABLE)) {
    unavailableReason = `Chromium is not installed at ${CHROMIUM_EXECUTABLE}`;
    return unavailableReason;
  }
  try {
    const response = await fetch(BASE_URL, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) {
      unavailableReason = `${BASE_URL} answered ${response.status}; start the dev server first`;
      return unavailableReason;
    }
    await response.arrayBuffer();
  } catch {
    unavailableReason = `No server is listening on ${BASE_URL}; run \`npm run dev\` first`;
    return unavailableReason;
  }
  unavailableReason = "";
  return null;
}

export async function getBrowser(): Promise<Browser> {
  if (cachedBrowser) return cachedBrowser;
  const { chromium } = loadPlaywright();
  cachedBrowser = await chromium.launch({ executablePath: CHROMIUM_EXECUTABLE });
  return cachedBrowser;
}

export async function closeBrowser(): Promise<void> {
  await cachedBrowser?.close();
  cachedBrowser = null;
}

let clientCounter = 0;
/**
 * A synthetic client IP unique to one context, so the shared per-client
 * preview guard can never make one test's rate-limit budget another test's
 * flake. Deliberately in TEST-NET-3 (203.0.113.0/24, RFC 5737).
 */
function nextClientIp(): string {
  clientCounter += 1;
  return `203.0.113.${clientCounter % 250}`;
}

export type Session = {
  context: BrowserContext;
  page: Page;
  /** Every same-origin response body seen by this page, newest last. */
  responses: Array<{ url: string; status: number; contentType: string; body: string }>;
  /** Uncaught page errors, which a passing journey should never produce. */
  pageErrors: string[];
  close(): Promise<void>;
};

export async function openSession(options: { viewport?: { width: number; height: number } } = {}): Promise<Session> {
  const browser = await getBrowser();
  const context = await browser.newContext({
    extraHTTPHeaders: { "cf-connecting-ip": nextClientIp() },
    viewport: options.viewport ?? { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  const responses: Session["responses"] = [];
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response: PWResponse) => {
    if (!response.url().startsWith(BASE_URL)) return;
    void response
      .text()
      .then((body) => {
        responses.push({
          url: response.url().slice(BASE_URL.length),
          status: response.status(),
          contentType: response.headers()["content-type"] ?? "",
          body,
        });
      })
      .catch(() => undefined);
  });
  return {
    context,
    page,
    responses,
    pageErrors,
    close: () => context.close(),
  };
}

/**
 * Loads a page and waits for React to hydrate.
 *
 * This matters: before hydration the textarea is an uncontrolled DOM node, so
 * text typed into it is discarded the moment React takes over and re-renders
 * from empty state, and clicks on the submit button do nothing. Waiting on
 * `networkidle` is not an option — the checkout page polls — and a fixed sleep
 * is a flake generator. The landing page fires an analytics beacon from a
 * client `useEffect`, which is a precise hydration signal; the checkout page
 * has none, so it falls back to waiting for a hydration-only DOM effect.
 */
export async function gotoHydrated(page: Page, path = "/"): Promise<void> {
  const hydrated = page
    .waitForResponse((response) => response.url().includes("/api/events"), { timeout: 30_000 })
    .catch(() => null);
  await page.goto(`${BASE_URL}${path}`, { waitUntil: "domcontentloaded" });
  await hydrated;
  // `motion-ready` is added by a client-only effect on every app page, so it
  // is a hydration signal even where no analytics beacon fires.
  await page.waitForFunction(() => document.documentElement.classList.contains("motion-ready"), null, { timeout: 30_000 });
}

// ---------------------------------------------------------------------------
// Semantic locators.
//
// The visual design of this product is actively changing, so nothing below
// keys off marketing copy or decorative classes. Each resolver states the
// stable property it relies on and falls back through alternatives, and they
// all live here so a structural change costs exactly one edit.
// ---------------------------------------------------------------------------

/** The one multi-line input on the workspace. */
export function draftInput(page: Page) {
  return page.locator("textarea").first();
}

/** The control that submits the draft: the only button that triggers POST /api/humanize. */
export function submitButton(page: Page) {
  return page.locator("button.humanize-button, [data-testid=humanize-submit]").first();
}

/** The section that carries the rewrite outcome, whichever outcome it is. */
export function resultRegion(page: Page) {
  return page.locator("#result, section.result").first();
}

/** The accessible heading of the result region — the element focus is routed to. */
export function resultHeading(page: Page) {
  return resultRegion(page).getByRole("heading").first();
}

/** The purchase control. Its presence — not its wording — is the paywall. */
export function unlockButton(page: Page) {
  return page.locator(".unlock-card button, [data-testid=unlock]").first();
}

/** The two comparison panels, source first. */
export function comparisonPanels(page: Page) {
  return page.locator(".comparison > article");
}

/** Any user-facing failure message, whatever element carries it. */
export function errorMessage(page: Page) {
  return page.locator("[role=alert], .error").first();
}

export function billingEntryPoint(page: Page) {
  return page.locator("#manage-billing").first();
}

/** Submits the current draft and resolves with the parsed API response. */
export async function submitDraft(page: Page, text: string): Promise<{ status: number; body: Record<string, unknown> }> {
  await draftInput(page).fill(text);
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/humanize"), { timeout: 30_000 }),
    submitButton(page).click(),
  ]);
  const status = response.status();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(await response.text()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  return { status, body };
}

/** Everything the browser can see, in one bag, for leak assertions. */
export async function clientVisibleSurface(session: Session): Promise<{
  innerText: string;
  html: string;
  storage: string;
  cookies: string;
  /** Every same-origin response body, including scripts and styles. */
  responseBodies: string;
  /** Only responses that could carry this visitor's content. */
  contentResponses: string;
  combined: string;
}> {
  const { page, context, responses } = session;
  const innerText = await page.evaluate(() => document.documentElement.innerText);
  const html = await page.content();
  // Evaluated from a source string on purpose: the TypeScript loader that runs
  // this suite rewrites named inner functions to reference an `__name` helper
  // that does not exist in the page, so any evaluate callback with a named
  // local throws ReferenceError inside the browser.
  const storage = (await page.evaluate(
    `(() => { try { const d = s => Object.entries(s).map(e => e[0] + "=" + e[1]).join("\\n"); return d(localStorage) + "\\n" + d(sessionStorage); } catch { return ""; } })()`,
  )) as string;
  const cookies = (await context.cookies()).map((c) => `${c.name}=${c.value}`).join("\n");
  const responseBodies = responses.map((r) => r.body).join("\n");
  // Responses that can carry *this visitor's content*: the document, the RSC
  // flight payload, and JSON API replies. Script and stylesheet bodies are
  // third-party build output; a leak would have to land in one of these.
  const isContentResponse = (contentType: string, url: string) =>
    /text\/html|application\/json|text\/x-component|text\/plain/.test(contentType) || url.startsWith("/api/");
  const contentResponses = responses
    .filter((r) => isContentResponse(r.contentType, r.url))
    .map((r) => r.body)
    .join("\n");
  return {
    innerText,
    html,
    storage,
    cookies,
    responseBodies,
    contentResponses,
    combined: [innerText, html, storage, cookies, responseBodies].join("\n"),
  };
}

/**
 * Contiguous word n-grams of `text`.
 *
 * Used to hunt for leaked content instead of testing bare words. A single
 * common English word ("complex", "changing") occurs inside third-party
 * bundles for reasons that have nothing to do with the visitor, so a bare-word
 * search over every JS module produces false alarms while a three-word
 * sequence lifted from a specific rewrite does not. This keeps the search over
 * *every* byte the browser received without the noise.
 */
export function wordNgrams(text: string, size: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const grams: string[] = [];
  for (let i = 0; i + size <= words.length; i += 1) grams.push(words.slice(i, i + size).join(" "));
  return grams;
}
