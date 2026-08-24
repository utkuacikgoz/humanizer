import vinext from "vinext";
import { defineConfig } from "vite";
import hostingConfig from "./.openai/hosting.json" with { type: "json" };
import { productConfig } from "./src/config/product";
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

// SEC-01 (docs/SECURITY.md, 2026-08-24): this app has no middleware and
// resolves identity purely from `oai-authenticated-user-*` request headers,
// which are trustworthy ONLY because the hosting boundary injects them and
// strips any client-supplied copy. A `*.workers.dev` origin bypasses that
// boundary entirely, so on such an origin the app has no authentication at
// all — anyone could forge those headers and read another customer's paid
// result or open their billing portal.
//
// Disabling the workers.dev origin removes that unauthenticated path. This
// is containment, not a fix: the header-trust model itself still needs to be
// replaced with something that verifies provenance (see SEC-01's
// remediation). Do not re-enable workers_dev while that remains true.
// With workers_dev disabled the Worker has no origin at all until a route
// binds one, so a production deploy without this is live and unreachable.
// The apex and www are bound as custom domains, which also makes the Host
// gate in src/lib/chatgpt-identity.ts meaningful: identity is honored only
// on these hostnames.
//
// Prerequisite: ownword.pro must exist as a zone in the same Cloudflare
// account the deploy authenticates to. If it does not, `wrangler deploy`
// fails naming the missing zone rather than silently publishing nothing.
// Local builds get no routes, so `npm run dev` is unaffected.
function productionRoutes() {
  const domain = productConfig.domain.trim().toLowerCase();
  if (!domain) return [];
  return [
    { pattern: domain, custom_domain: true },
    { pattern: `www.${domain}`, custom_domain: true },
  ];
}

function workerBindingConfig(environment: "local" | "production") {
  return {
    main: "./worker/index.ts",
    compatibility_flags: ["nodejs_compat"],
    workers_dev: false,
    ...(environment === "production" ? { routes: productionRoutes() } : {}),
    // The route allows isolate-memory abuse protection only when this value is
    // explicitly non-production. Only Vite's development server is marked
    // local; every build artifact fails closed unless D1 and its guard secret
    // are present, even if someone accidentally built with the placeholder ID.
    vars: { ENVIRONMENT: environment },
    d1_databases: d1
      ? [
          {
            binding: d1,
            database_name: "site-creator-d1",
            database_id: databaseId,
            // SEC-07: the generated default pointed at ../../migrations, a
            // directory that does not exist — drizzle-kit writes to drizzle/.
            // `wrangler d1 migrations apply` silently had nothing to apply, so
            // a fresh production database would have no tables and no customer
            // could complete a purchase. vinext re-relativizes this against
            // dist/server/ (where it emits wrangler.json), so pass the bare
            // repo-root directory name and let it prepend the ../../ itself.
            migrations_dir: "drizzle",
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
}

export default defineConfig(async ({ command }) => {
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
        config: workerBindingConfig(command === "serve" ? "local" : "production"),
      }),
    ],
  };
});
