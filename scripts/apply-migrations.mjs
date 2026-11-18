/** Aplica db/migrations/*.sql por ordem. Uso: node scripts/apply-migrations.mjs */
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { Pool } = require("pg");

const connectionString = process.env.DATABASE_URL;
if (!connectionString) { console.error("DATABASE_URL não definida."); process.exit(1); }

const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false }, options: "-c search_path=express,public" });
const dir = new URL("../db/migrations/", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

for (const file of files) {
  const sql = readFileSync(new URL(file, dir), "utf8");
  process.stdout.write(`→ ${file} … `);
  try { await pool.query(sql); console.log("ok"); }
  catch (error) { console.log("FALHOU"); console.error(error.message); process.exitCode = 1; break; }
}
await pool.end();
