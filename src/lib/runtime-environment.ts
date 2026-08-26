// Which deployment this Worker isolate is, as a value the pure modules can
// read without importing `cloudflare:workers`.
//
// SEC-22. `src/lib/identity.ts` must stay free of `cloudflare:workers`,
// `next/headers` and `next/navigation` — that constraint is what makes the
// whole authentication path testable under plain Node — so it cannot read the
// `ENVIRONMENT` binding itself. This is the one-line seam: the Worker entry
// point holds `env` and records it once per isolate, and identity reads it
// through a pure function.
//
// Deliberately NOT fail-closed-by-default. An unset value means "nobody told
// us", which is the state under `npm run dev`, under plain-Node tests, and in
// any context with no Worker env at all; treating that as production would
// make local development and the test suite behave differently from the code
// they are testing, which is its own class of bug. What matters is the other
// direction: a PRODUCTION build always declares the binding
// (`vars: { ENVIRONMENT: environment }` in vite.config.ts), so in production
// this is never unset, and the plain-http cookie fallback is closed in code
// rather than only by routing.

let recorded: string | null = null;

/** Called once per isolate from worker/index.ts, which is the only place `env` is in scope. */
export function recordRuntimeEnvironment(value: string | undefined): void {
  const normalized = value?.trim().toLowerCase();
  recorded = normalized ? normalized : null;
}

/** True only when the runtime explicitly said it is production. */
export function isProductionEnvironment(): boolean {
  return recorded === "production";
}

/** Test seam. Never called from application code. */
export function resetRuntimeEnvironmentForTests(): void {
  recorded = null;
}
