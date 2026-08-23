import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import * as schema from "../../db/schema";
import type { AppDatabase } from "../../db/repository";

/**
 * Applies the real generated migration(s) against an in-memory SQLite
 * database so tests exercise the actual CHECK/UNIQUE constraints shipped
 * to D1, not a hand-rolled approximation of the schema.
 */
export async function createTestDatabase(): Promise<AppDatabase> {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON;");

  const migrationsDir = new URL("../../drizzle/", import.meta.url);
  const files = (await readdir(migrationsDir)).filter((name) => name.endsWith(".sql")).sort();
  for (const file of files) {
    const contents = await readFile(new URL(file, migrationsDir), "utf8");
    for (const statement of contents.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed) sqlite.exec(trimmed);
    }
  }

  return drizzle(async (sql, params, method) => {
    const stmt = sqlite.prepare(sql);
    if (method === "run") {
      const info = stmt.run(...params);
      // Shaped to mirror D1Result's `.meta.changes` (Cloudflare D1's real
      // API), not the SqliteRemoteResult type sqlite-proxy declares, so
      // db/billing-repository.ts's rows-affected check reads identically
      // against this test harness and the real D1 driver.
      return { rows: [], meta: { changes: Number(info.changes) } };
    }
    const rows = method === "get" ? [stmt.get(...params)].filter(Boolean) : stmt.all(...params);
    // drizzle-orm's sqlite-proxy session expects rows as arrays of
    // positional column values (see mapResultRow in drizzle-orm/utils.js);
    // node:sqlite always returns keyed objects, so convert.
    return { rows: rows.map((row) => Object.values(row as Record<string, unknown>)) };
  }, { schema }) as unknown as AppDatabase;
}
