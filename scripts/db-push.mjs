/**
 * Applies the schema in supabase/migrations as a single SQL call.
 *
 * Requires a direct Postgres connection string, which is separate from the
 * REST API keys:
 *
 *   Supabase dashboard -> Project Settings -> Database -> Connection string
 *
 * Set it as SUPABASE_DB_URL in .env.local, then run: npm run db:push
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ quiet: true });

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "supabase", "migrations");

const url = process.env.SUPABASE_DB_URL;
if (!url) {
  console.error(
    "\nSUPABASE_DB_URL is not set.\n\n" +
      "Find it in the Supabase dashboard under:\n" +
      "  Project Settings -> Database -> Connection string -> URI\n\n" +
      "Then add it to .env.local, for example:\n" +
      "  SUPABASE_DB_URL=postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres\n\n" +
      "Alternatively, paste supabase/migrations/0001_init.sql into the SQL Editor.\n",
  );
  process.exit(1);
}

const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
if (files.length === 0) {
  console.error("No .sql files found in supabase/migrations");
  process.exit(1);
}

const sql = files
  .map((f) => readFileSync(join(dir, f), "utf8").trimEnd())
  .join("\n\n");

const client = new pg.Client({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
  // A cold Supabase project can take a moment to accept the first connection.
  connectionTimeoutMillis: 30000,
  statement_timeout: 120000,
});

try {
  await client.connect();
  const { rows } = await client.query("select current_database() db, version() v");
  console.log(`Connected to ${rows[0].db}`);
  console.log(`Applying schema (${files.join(", ")}) in one call ...`);
  await client.query(sql);
  console.log("ok");

  const { rows: tables } = await client.query(
    `select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
      order by table_name`,
  );
  console.log(`\nPublic tables (${tables.length}):`);
  console.log("  " + tables.map((t) => t.table_name).join(", "));

  const { rows: rls } = await client.query(
    `select relname from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
      order by relname`,
  );
  console.log(`RLS enabled on ${rls.length} table(s).`);
  console.log("\nSchema is up to date.");
} catch (err) {
  console.error("\nMigration failed:", err.message);
  if (err.position) console.error("  at character position", err.position);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
