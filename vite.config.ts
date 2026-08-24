import vinext from "vinext";
import { defineConfig } from "vite";
import hostingConfig from "./.openai/hosting.json" with { type: "json" };
import { sites } from "./build/sites-vite-plugin.ts";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

// Local/dev builds use the placeholder (Miniflare emulates it locally).
// Production builds (CD) pass the real D1 database_id via env so it never
// needs to be hardcoded in source.
//
// Fail closed rather than silently falling back: a set-but-unusable value
// (whitespace, a copy-paste of the placeholder, a malformed id) previously
// trimmed away to the placeholder and shipped a production build bound to a
// database that does not exist — live traffic against an empty schema, with
// no error surfaced anywhere (SEC finding). CD's non-empty secret check
// cannot catch that on its own, so the build itself has to.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function resolveDatabaseId() {
  const configured = process.env.D1_DATABASE_ID;
  if (configured === undefined) return SITE_CREATOR_PLACEHOLDER_DATABASE_ID;

  const trimmed = configured.trim();
  if (!trimmed) {
    throw new Error("D1_DATABASE_ID is set but empty. Unset it for a local build, or give it the real D1 database id.");
  }
  if (!UUID_PATTERN.test(trimmed)) {
    throw new Error(`D1_DATABASE_ID is not a valid UUID: ${JSON.stringify(trimmed)}.`);
  }
  if (trimmed === SITE_CREATOR_PLACEHOLDER_DATABASE_ID) {
    throw new Error("D1_DATABASE_ID is the scaffold placeholder, not a real database. Deploying this would bind production to a database that does not exist.");
  }
  return trimmed;
}

const databaseId = resolveDatabaseId();

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: "site-creator-d1",
          database_id: databaseId,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
};

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: localBindingConfig,
      }),
    ],
  };
});
