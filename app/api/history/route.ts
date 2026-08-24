// M3-01: the signed-in caller's own rewrite history, metadata only.
//
// The access decision lives in src/lib/history-access.ts so it can be tested
// against a real database under plain Node; this route only supplies the
// Workers-runtime-bound dependencies.
import { buildHistoryListResponse } from "@/src/lib/history-access";

export async function GET(request: Request) {
  return buildHistoryListResponse(request, async () => {
    const [{ getDb }, billing, history] = await Promise.all([
      import("../../../db/index"),
      import("../../../db/billing-repository"),
      import("../../../db/history-repository"),
    ]);
    return { db: getDb(), billing, history };
  });
}
