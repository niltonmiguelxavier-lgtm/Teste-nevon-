import { Pool, type PoolClient, type QueryResultRow } from "pg";

/**
 * Acesso à base de dados (PostgreSQL / Supabase).
 *
 * A aplicação usa um role dedicado (`express_app`) e o schema `express`, para
 * não interferir com as tabelas de outras aplicações que partilham o projecto.
 * A connection string é sempre lida no servidor: `DATABASE_URL`.
 */

declare global {
  // eslint-disable-next-line no-var
  var __expressPool: Pool | undefined;
}

export function hasDatabaseUrl() {
  return Boolean(process.env.DATABASE_URL?.trim());
}

/**
 * Opções de ligação SSL.
 *
 * O Supabase apresenta um certificado assinado por uma CA própria: com a
 * validação completa (`verify-full`) é necessário fornecer a CA. Se
 * `DATABASE_SSL_CA` existir, validamos o certificado; caso contrário usamos TLS
 * sem validação de CA (o tráfego continua encriptado), tal como documentado nos
 * exemplos oficiais do Supabase.
 */
function connectionOptions(connectionString: string) {
  if (connectionString.includes("sslmode=disable")) {
    return { connectionString, ssl: false as const };
  }
  const ca = process.env.DATABASE_SSL_CA?.replace(/\\n/g, "\n");
  return {
    connectionString,
    ssl: ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false },
  };
}

function pool(): Pool {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL não está definida. Configure a ligação ao PostgreSQL (Supabase) nas variáveis de ambiente."
    );
  }

  if (!global.__expressPool) {
    global.__expressPool = new Pool({
      ...connectionOptions(connectionString),
      // Em serverless (Vercel) cada instância abre o seu próprio pool; o pooler
      // do Supabase em modo "transaction" multiplexa as ligações. Mantemos o
      // pool pequeno e as ligações ociosas de vida curta para não esgotar o
      // limite do pooler quando há muitas funções concorrentes.
      max: Number(process.env.DATABASE_POOL_MAX || 3),
      idleTimeoutMillis: 5_000,
      connectionTimeoutMillis: 15_000,
      allowExitOnIdle: true,
      options: "-c search_path=express,public",
    });

    global.__expressPool.on("error", (error) => {
      console.error("[db] erro inesperado no pool:", error.message);
    });
  }

  return global.__expressPool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  const result = await pool().query<T>(text, params);
  return result.rows;
}

export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

/** Executa várias instruções numa transacção. */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignora falha de rollback */
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function databaseHealth() {
  try {
    const row = await queryOne<{ now: Date; current_user: string; schema: string }>(
      "SELECT now() AS now, current_user AS current_user, current_schema() AS schema"
    );
    const tables = await queryOne<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM information_schema.tables
        WHERE table_schema = 'express'`
    );
    return {
      ok: true,
      server_time: row?.now ?? null,
      current_user: row?.current_user ?? null,
      schema: row?.schema ?? null,
      tables: Number(tables?.count ?? 0),
    };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "erro desconhecido" };
  }
}
