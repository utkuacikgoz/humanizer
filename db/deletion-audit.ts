// M3-05 deletion audit trail.
//
// The acceptance criterion is "auditable without retaining text", and those
// two halves fight each other: an audit record is useful exactly when it says
// what was removed, and a record that says it too precisely re-creates what
// the customer asked us to destroy. So the trail here records the *subject*
// (which account, which job), the *scope*, the *authority* (the server-derived
// user id the request was made under), the *time*, and per-processor
// propagation outcomes — and it is structurally unable to hold anything else.
//
// `detail` is not free-form JSON. sanitizeAuditDetail accepts numbers,
// booleans, and short self-generated codes matching CODE_PATTERN, and drops
// everything else on the floor. That deliberately excludes:
//
//   * source or result text, or any fragment of it;
//   * a hash or digest of it — for a short phrase ("Meet me at 6"), a hash is
//     a confirmation oracle for anyone who can guess it, which is precisely
//     the guarantee deletion is supposed to remove;
//   * driver/provider error objects. A D1 error can carry the bound
//     parameters of the failing statement, and in this application those
//     parameters are the customer's writing. Callers pass a code they wrote
//     themselves, never `String(error)`.
//
// Same driver-agnostic shape as the rest of db/: no `cloudflare:workers`,
// so tests/purge-worker.test.mts drives it against real SQLite.
import * as schema from "./schema";
import type { DeletionAuditEvent } from "./schema";
import type { AppDatabase } from "./repository";

const { deletionAuditEvents } = schema;

/**
 * Values an audit record may carry. Strings are restricted to the code shape
 * below; anything longer or with unexpected characters is dropped rather than
 * truncated, because a truncated draft is still a draft.
 */
export type AuditDetail = Record<string, number | boolean | string>;

/** Field names this module's own callers use: identifier-shaped, nothing else. */
const KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;

/**
 * Value shape for a code: one lowercase identifier, optionally namespaced
 * (`processor:flaky_store`). Prose does not match it — a sentence has spaces,
 * capitals and punctuation — and neither does a digest, both because of the
 * length bound and because of the explicit hex rejection below.
 */
const CODE_PATTERN = /^[a-z][a-z0-9_]{0,31}(:[a-z0-9_]{1,31})?$/;

/** A long run of hex is a hash however it got here, and a hash of short text is a confirmation oracle. */
const HEX_RUN = /^[0-9a-f]{16,}$/;

export function sanitizeAuditDetail(detail: AuditDetail | undefined): string {
  if (!detail) return "{}";
  const safe: Record<string, number | boolean | string> = {};
  for (const [key, value] of Object.entries(detail)) {
    if (!KEY_PATTERN.test(key)) continue;
    if (typeof value === "number") safe[key] = Number.isFinite(value) ? value : 0;
    else if (typeof value === "boolean") safe[key] = value;
    else if (typeof value === "string" && CODE_PATTERN.test(value) && !HEX_RUN.test(value)) safe[key] = value;
  }
  return JSON.stringify(safe);
}

export interface DeletionAuditInput {
  deletionJobId?: string | null;
  subjectType: "user" | "job";
  subjectId: string;
  scope: "history_item" | "full_account";
  /** Whose authority. Null only for work the scheduler drives on its own. */
  actorUserId?: string | null;
  event: DeletionAuditEvent;
  processor?: string | null;
  detail?: AuditDetail;
}

export async function recordDeletionAudit(
  db: AppDatabase,
  input: DeletionAuditInput,
  now = new Date(),
): Promise<void> {
  await db.insert(deletionAuditEvents).values({
    id: crypto.randomUUID(),
    deletionJobId: input.deletionJobId ?? null,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    scope: input.scope,
    actorUserId: input.actorUserId ?? null,
    event: input.event,
    processor: input.processor ?? null,
    detail: sanitizeAuditDetail(input.detail),
    occurredAt: now,
  });
}
