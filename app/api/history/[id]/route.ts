// M3-01: one owned history item — read it back, or delete it.
//
// Both decisions live in src/lib/history-access.ts. The `id` segment is the
// only client-supplied value either path accepts, and it is re-checked
// against the server-derived owner id before it selects anything.
import { buildHistoryDeleteResponse, buildHistoryDetailResponse } from "@/src/lib/history-access";

type RouteContext = { params: Promise<{ id: string }> };

async function loadDeps() {
  const [{ getDb }, billing, history] = await Promise.all([
    import("../../../../db/index"),
    import("../../../../db/billing-repository"),
    import("../../../../db/history-repository"),
  ]);
  return { db: getDb(), billing, history };
}

export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  return buildHistoryDetailResponse(request, id ?? "", loadDeps);
}

export async function DELETE(request: Request, context: RouteContext) {
  const { id } = await context.params;
  return buildHistoryDeleteResponse(request, id ?? "", loadDeps);
}
