// M3-05: the signed-in caller's own account — what deleting it would do, and
// deleting it.
//
// Both decisions live in src/lib/account-deletion.ts so they can be tested
// against a real database under plain Node; this route only supplies the
// Workers-runtime-bound dependencies. Neither handler reads a body, an id, or
// a query parameter: the account acted on is always the one the server-derived
// identity resolves to.
import { buildAccountDeleteResponse, buildAccountStatusResponse } from "@/src/lib/account-deletion";

async function loadDeps() {
  const [{ getDb }, billing, account] = await Promise.all([
    import("../../../db/index"),
    import("../../../db/billing-repository"),
    import("../../../db/account-deletion-repository"),
  ]);
  return { db: getDb(), billing, account };
}

export async function GET(request: Request) {
  return buildAccountStatusResponse(request, loadDeps);
}

export async function DELETE(request: Request) {
  return buildAccountDeleteResponse(request, loadDeps);
}
