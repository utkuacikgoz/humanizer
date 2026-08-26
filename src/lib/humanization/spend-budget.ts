// SEC-25. The thing that REFUSES when a metered provider is being outspent.
//
// `RewriteCostGuard` is an alarm: it observes, it logs, and the request it
// observed was already served. That is the whole finding — driven directly,
// fifty rewrites at fifty times the per-rewrite ceiling produced fifty alarms
// and zero refusals. `/api/humanize` takes no authentication, so on the day
// `HUMANIZATION_PROVIDER=claude` is set, an anonymous caller's only ceiling is
// a per-address rate limit, and an attacker with many addresses has many
// budgets. Nothing in the repository could say no.
//
// This is the no. A single shared budget, in dollars, for every rewrite that
// no word ledger is paying for, refreshed each window:
//
//   * ADMISSION reserves the per-rewrite ceiling BEFORE the provider is
//     called, atomically, so concurrent isolates cannot both squeeze past the
//     last dollar. A caller that is not admitted is refused; nothing is spent.
//   * SETTLEMENT replaces the reservation with what the rewrite actually cost
//     once the provider has reported it. A cheap rewrite gives most of its
//     reservation back; an expensive one consumes what it really consumed. So
//     the budget is spend, not a request count dressed up as spend.
//   * EXHAUSTION is how the cost guard's verdict finally governs something.
//     A sustained breach — the trend alarm that used to be logged and
//     discarded — burns the rest of the window, so admissions stop within the
//     minute rather than at the end of the month.
//
// Storage is the same D1 table the preview guard's fixed window already uses,
// under a reserved key, because the atomic conditional-increment this needs is
// the one that table was built for. No migration, and no second limiter to
// keep in step with the first.
//
// Nothing here sees customer text, an account, or an address. A row is a key,
// a window, and an integer number of micro-dollars.
//
// This module must stay free of `cloudflare:workers`, `next/headers` and
// `next/navigation`: `app/api/humanize/route.ts` imports it directly and
// `tests/*.test.mts` import that.

/**
 * Ceiling for one rewrite, and therefore what an admission reserves.
 *
 * The route caps input at 300 words, and docs/BENCHMARKS.md's model puts a
 * 250-word Opus rewrite between $0.011 and $0.086 depending entirely on how
 * many thinking tokens it burns. Ten cents is above the top of that range, so
 * a breach means something is genuinely running away — maximum-effort
 * thinking, a retry storm, or a router paying for both rungs on every
 * attempt — rather than a normal expensive document.
 *
 * It is not a pricing threshold. The pricing threshold is the per-word one,
 * derived from the plan catalogue in `app/api/humanize/humanization-runtime.ts`.
 */
export const MAX_COST_PER_REWRITE_USD = 0.1;

/**
 * The shared ceiling on un-ledgered spend, per window.
 *
 * **This is a safety ceiling, not a business decision.** It exists so that the
 * worst case is a bounded, recoverable bill instead of an unbounded one; it is
 * deliberately not tuned to a traffic forecast nobody has. At $0.50 a minute
 * the worst case is $30/hour across the entire customer base, against the
 * $8–$62/hour *per client key* that SEC-25 measured with no ceiling at all.
 * At the realistic per-rewrite cost that is roughly fifteen anonymous rewrites
 * a minute globally, which is a real product constraint and belongs to the
 * owner (docs/MONETIZATION.md), not to this file.
 *
 * The window is a minute rather than an hour for two reasons: a refusal has to
 * clear quickly enough that a legitimate visitor can retry inside one sitting,
 * and the preview guard's own cleanup sweeps `preview_guard_windows` rows
 * older than two of ITS minute-long windows — a longer window here would have
 * its counter deleted mid-flight and silently fail open.
 */
export const METERED_SPEND_BUDGET = {
  windowMs: 60_000,
  maxUsdPerWindow: 0.5,
} as const;

/**
 * Dollars are stored as integer micro-dollars.
 *
 * `preview_guard_windows.request_count` is an INTEGER with a `>= 0` check
 * constraint. Floats in a counter that is incremented by concurrent writers
 * accumulate error; micro-dollars are exact and a rewrite's cost is never
 * finer-grained than that.
 */
const MICRO_USD = 1_000_000;

/**
 * The reserved row this budget lives in.
 *
 * Every other `client_key` in that table is a base64url HMAC
 * (`previewGuardClientKey`), whose alphabet is `A-Za-z0-9-_`. The colon here
 * cannot appear in one, so this key can never collide with a real client's
 * window — and it says in the table what it is, so nobody reads
 * `request_count` on this row as a request count.
 */
const BUDGET_CLIENT_KEY = "budget:metered-humanization-microusd";

export type SpendReservation = {
  windowStart: number;
  reservedMicroUsd: number;
};

export type SpendAdmission =
  | { admitted: true; reservation: SpendReservation }
  | { admitted: false; retryAfterSeconds: number };

export interface SpendBudget {
  /**
   * Reserves `reserveUsd` against this window, or refuses.
   *
   * Refusal is the ONLY safe answer when the store cannot be reached: an
   * unreachable counter is an unmetered provider.
   */
  admit(reserveUsd: number): Promise<SpendAdmission>;
  /**
   * Replaces a reservation with what the rewrite actually cost.
   *
   * `exhaust` burns the remainder of the window instead, for a verdict that
   * says the whole regime is wrong rather than that one rewrite was.
   */
  settle(reservation: SpendReservation, actualUsd: number, options?: { exhaust?: boolean }): Promise<void>;
}

function toMicro(usd: number) {
  return Math.max(0, Math.round((Number.isFinite(usd) ? usd : 0) * MICRO_USD));
}

function windowStartFor(now: number, windowMs: number) {
  return Math.floor(now / windowMs) * windowMs;
}

function retryAfterSeconds(now: number, windowStart: number, windowMs: number) {
  return Math.max(1, Math.ceil((windowStart + windowMs - now) / 1_000));
}

type BudgetOptions = {
  windowMs: number;
  maxUsdPerWindow: number;
  now: () => number;
};

/**
 * The production budget: one row in D1, shared by every isolate.
 */
export class DistributedMeteredSpendBudget implements SpendBudget {
  private readonly options: BudgetOptions;

  constructor(private readonly db: D1Database, options: Partial<BudgetOptions> = {}) {
    this.options = {
      windowMs: METERED_SPEND_BUDGET.windowMs,
      maxUsdPerWindow: METERED_SPEND_BUDGET.maxUsdPerWindow,
      now: Date.now,
      ...options,
    };
  }

  async admit(reserveUsd: number): Promise<SpendAdmission> {
    const now = this.options.now();
    const windowStart = windowStartFor(now, this.options.windowMs);
    const budgetMicroUsd = toMicro(this.options.maxUsdPerWindow);
    const reservedMicroUsd = toMicro(reserveUsd);

    // A reservation larger than the whole window's budget could never be
    // admitted, and admitting it once on the empty-window INSERT path would be
    // the one case that escapes the ceiling. Refuse it explicitly.
    if (reservedMicroUsd > budgetMicroUsd) {
      return { admitted: false, retryAfterSeconds: retryAfterSeconds(now, windowStart, this.options.windowMs) };
    }

    try {
      // One statement, so two isolates racing for the last cent cannot both
      // read "there is room" and both spend it. Admission is the row having
      // changed, via `meta.changes` — never a read followed by a write.
      const result = await this.db.prepare(
        `INSERT INTO preview_guard_windows (client_key, window_start, request_count, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(client_key, window_start) DO UPDATE SET
           request_count = preview_guard_windows.request_count + excluded.request_count,
           updated_at = excluded.updated_at
         WHERE preview_guard_windows.request_count + excluded.request_count <= ?`,
      ).bind(BUDGET_CLIENT_KEY, windowStart, reservedMicroUsd, now, budgetMicroUsd).run();

      if (Number(result.meta.changes ?? 0) !== 1) {
        return { admitted: false, retryAfterSeconds: retryAfterSeconds(now, windowStart, this.options.windowMs) };
      }
      return { admitted: true, reservation: { windowStart, reservedMicroUsd } };
    } catch {
      // Never log this: a D1 error object can carry bound statement parameters
      // in its cause chain (docs/SECURITY.md's no-sensitive-logging control).
      // A counter that cannot be reached is a provider that is not metered, so
      // the answer is no.
      return { admitted: false, retryAfterSeconds: retryAfterSeconds(now, windowStart, this.options.windowMs) };
    }
  }

  async settle(reservation: SpendReservation, actualUsd: number, options: { exhaust?: boolean } = {}): Promise<void> {
    const now = this.options.now();
    const budgetMicroUsd = toMicro(this.options.maxUsdPerWindow);
    const delta = options.exhaust
      ? budgetMicroUsd
      : toMicro(actualUsd) - reservation.reservedMicroUsd;
    if (!options.exhaust && delta === 0) return;

    try {
      await this.db.prepare(
        // MAX(0, …) keeps the `request_count >= 0` check constraint, which a
        // refund larger than the counter would otherwise violate and roll back.
        `UPDATE preview_guard_windows
         SET request_count = MAX(0, MIN(?, request_count + ?)), updated_at = ?
         WHERE client_key = ? AND window_start = ?`,
      ).bind(budgetMicroUsd, delta, now, BUDGET_CLIENT_KEY, reservation.windowStart).run();
    } catch {
      // Best effort, and safe to lose: the reservation already stands as the
      // conservative bound, so a failed settlement can only leave the budget
      // tighter than the truth, never looser. Never log the error object.
    }
  }
}

/**
 * Isolate-local fallback, for plain-Node tests and explicitly non-production
 * development only — the same shape, and the same reason, as
 * `PreviewRequestGuard` next to `DistributedPreviewRequestGuard`.
 *
 * A production runtime never gets this: `app/api/humanize/route.ts` refuses
 * the request outright when a production-like Worker has no shared store.
 */
export class LocalMeteredSpendBudget implements SpendBudget {
  private readonly options: BudgetOptions;
  private windowStart = -1;
  private spentMicroUsd = 0;

  constructor(options: Partial<BudgetOptions> = {}) {
    this.options = {
      windowMs: METERED_SPEND_BUDGET.windowMs,
      maxUsdPerWindow: METERED_SPEND_BUDGET.maxUsdPerWindow,
      now: Date.now,
      ...options,
    };
  }

  async admit(reserveUsd: number): Promise<SpendAdmission> {
    const now = this.options.now();
    const windowStart = windowStartFor(now, this.options.windowMs);
    if (windowStart !== this.windowStart) {
      this.windowStart = windowStart;
      this.spentMicroUsd = 0;
    }
    const budgetMicroUsd = toMicro(this.options.maxUsdPerWindow);
    const reservedMicroUsd = toMicro(reserveUsd);
    if (reservedMicroUsd > budgetMicroUsd || this.spentMicroUsd + reservedMicroUsd > budgetMicroUsd) {
      return { admitted: false, retryAfterSeconds: retryAfterSeconds(now, windowStart, this.options.windowMs) };
    }
    this.spentMicroUsd += reservedMicroUsd;
    return { admitted: true, reservation: { windowStart, reservedMicroUsd } };
  }

  async settle(reservation: SpendReservation, actualUsd: number, options: { exhaust?: boolean } = {}): Promise<void> {
    if (reservation.windowStart !== this.windowStart) return;
    const budgetMicroUsd = toMicro(this.options.maxUsdPerWindow);
    const delta = options.exhaust ? budgetMicroUsd : toMicro(actualUsd) - reservation.reservedMicroUsd;
    this.spentMicroUsd = Math.max(0, Math.min(budgetMicroUsd, this.spentMicroUsd + delta));
  }
}
