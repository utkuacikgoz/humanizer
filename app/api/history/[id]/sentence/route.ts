// M3-03: regenerate or restore one sentence of a rewrite the caller owns.
//
// The whole decision lives in src/lib/sentence-operations.ts. This file exists
// only to bind the route to the Workers-only `db/index` binding, which is why
// every import below is lazy: `cloudflare:workers` does not resolve under
// plain Node, and a static import here would crash the test suite at import
// time for every module that reaches this route.
import { buildSentenceOperationResponse } from "@/src/lib/sentence-operations";

type RouteContext = { params: Promise<{ id: string }> };

async function loadDeps() {
  const [{ getDb }, billing, history, revisions, auth] = await Promise.all([
    import("../../../../../db/index"),
    import("../../../../../db/billing-repository"),
    import("../../../../../db/history-repository"),
    import("../../../../../db/revision-repository"),
    import("../../../../../db/auth-repository"),
  ]);
  return { db: getDb(), billing, history, revisions, auth };
}

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  return buildSentenceOperationResponse(request, id ?? "", loadDeps);
}
