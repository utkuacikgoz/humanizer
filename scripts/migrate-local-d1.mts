// Applies drizzle/*.sql to the local D1 database that `npm run dev`
// (Miniflare, via @cloudflare/vite-plugin) creates under .wrangler/state.
//
// The starter's own examples/d1/app/api/notes/route.ts documents the
// production path — "generate the migration locally, then deploy so the
// platform can apply the generated SQL to the real D1 database" — but
// that leaves local dev/test with a D1 binding that resolves fine and has
// no tables. Miniflare also creates the binding's storage file lazily, on
// its first query attempt rather than on dev-server startup — so run this
// once after `npm run dev` is running AND at least one request has hit a
// route that calls getDb() (e.g. POST /api/humanize once). Re-run any
// time drizzle/ changes; safe to run repeatedly, since statements that
// fail because the object already exists are treated as already-applied.
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const d1Dir = path.join(root, ".wrangler/state/v3/d1/miniflare-D1DatabaseObject");
const migrationsDir = path.join(root, "drizzle");

async function findLocalD1Files(): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(d1Dir);
  } catch {
    throw new Error(
      `No local D1 storage found at ${d1Dir}.\n` +
        "Run `npm run dev` once (it creates the binding's local storage on startup), then re-run this script.",
    );
  }
  // Miniflare keeps a fixed-name `metadata.sqlite` catalog alongside one
  // hash-named `.sqlite` file per D1 binding, which holds the actual
  // table data — only that one should receive the app's migrations.
  const files = entries.filter((name) => /^[0-9a-f]{32,}\.sqlite$/.test(name)).map((name) => path.join(d1Dir, name));
  if (!files.length) {
    throw new Error(`No D1 content file found under ${d1Dir}. Run \`npm run dev\` once first.`);
  }
  return files;
}

async function applyMigrations(databasePath: string) {
  const db = new DatabaseSync(databasePath);
  const migrationFiles = (await readdir(migrationsDir)).filter((name) => name.endsWith(".sql")).sort();

  let applied = 0;
  let skipped = 0;
  for (const file of migrationFiles) {
    const contents = await readFile(path.join(migrationsDir, file), "utf8");
    for (const statement of contents.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (!trimmed) continue;
      try {
        db.exec(trimmed);
        applied += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/already exists|duplicate column name/i.test(message)) {
          skipped += 1;
          continue;
        }
        db.close();
        throw error;
      }
    }
  }
  db.close();
  console.log(`${path.basename(databasePath)}: applied ${applied} statement(s), skipped ${skipped} already-applied.`);
}

const files = await findLocalD1Files();
for (const file of files) await applyMigrations(file);
