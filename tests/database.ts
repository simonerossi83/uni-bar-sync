import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readFile, readdir } from "node:fs/promises";

export async function createTestDatabase() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA extensions; CREATE SCHEMA cron;
    GRANT USAGE ON SCHEMA public, extensions TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
    CREATE FUNCTION cron.schedule(text, text, text) RETURNS bigint LANGUAGE sql AS 'SELECT 1::bigint';
  `);
  const directory = new URL("../supabase/migrations/", import.meta.url);
  for (const name of (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort()) {
    const sql = (await readFile(new URL(name, directory), "utf8"))
      // PGlite has no background scheduler/replication server. Business SQL,
      // roles, ACLs, RLS, constraints and pgcrypto run unchanged from migrations.
      .replace(/^CREATE EXTENSION IF NOT EXISTS pg_cron;\s*$/gm, "")
      .replace(/^ALTER PUBLICATION supabase_realtime ADD TABLE [^;]+;\s*$/gm, "");
    await db.exec(sql);
  }
  return db;
}

// Small PostgREST adapter for exercising real server handlers against isolated
// PostgreSQL. This is test-only, not a replacement backend or a load benchmark.
export function databaseClient(db: PGlite) {
  return {
    rpc: async (name: string, args: Record<string, unknown> = {}) => {
      const parameters = Object.keys(args);
      try {
        const result = await db.query(
          `SELECT * FROM public.${identifier(name)}(${parameters.map((key, i) => `${identifier(key)} => $${i + 1}`).join(",")})`,
          Object.values(args).map((value) =>
            typeof value === "object" && value !== null ? JSON.stringify(value) : value,
          ),
        );
        return { data: JSON.parse(JSON.stringify(result.rows)), error: null };
      } catch (error) {
        return { data: null, error };
      }
    },
    from(table: string) {
      const conditions: string[] = [];
      const values: unknown[] = [];
      let selection = "*",
        count = false,
        head = false,
        start = 0,
        end: number | undefined;
      let order = "",
        single = false,
        update: Record<string, unknown> | undefined,
        insert: Record<string, unknown> | undefined;
      const filter = (column: string, value: unknown, operator: string) => {
        if (operator === "IS") conditions.push(`o.${identifier(column)} IS NULL`);
        else {
          values.push(value);
          conditions.push(`o.${identifier(column)} ${operator} $${values.length}`);
        }
        return builder;
      };
      const builder = {
        select(columns: string, options: { count?: string; head?: boolean } = {}) {
          selection = columns;
          count = Boolean(options.count);
          head = Boolean(options.head);
          return builder;
        },
        eq(column: string, value: unknown) {
          return filter(column, value, "=");
        },
        gt(column: string, value: unknown) {
          return filter(column, value, ">");
        },
        is(column: string, value: unknown) {
          return filter(column, value, "IS");
        },
        order(column: string, options: { ascending: boolean }) {
          order = ` ORDER BY o.${identifier(column)} ${options.ascending ? "ASC" : "DESC"}`;
          return builder;
        },
        range(from: number, to: number) {
          start = from;
          end = to;
          return builder;
        },
        maybeSingle() {
          single = true;
          return builder;
        },
        update(data: Record<string, unknown>) {
          update = data;
          return builder;
        },
        insert(data: Record<string, unknown>) {
          insert = data;
          return builder;
        },
        then(resolve: (result: unknown) => unknown, reject: (error: unknown) => unknown) {
          return execute().then(resolve, reject);
        },
      };
      async function execute() {
        try {
          const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
          let total: number | null = null;
          if (count)
            total = (
              await db.query<{ n: number }>(
                `SELECT count(*)::int AS n FROM public.${identifier(table)} o${where}`,
                values,
              )
            ).rows[0]!.n;
          if (head) return { data: null, error: null, count: total };
          const columns = selection
            .replace(/order_items\([^)]*\)/, "__items__")
            .split(",")
            .map((column) => {
              const field = column.trim();
              if (field === "__items__")
                return `(SELECT coalesce(json_agg(json_build_object('id', i.id, 'order_id', i.order_id, 'name', i.name, 'unit_price', i.unit_price, 'quantity', i.quantity)), '[]'::json) FROM public.order_items i WHERE i.order_id = o.id) AS order_items`;
              return field === "*" ? "o.*" : `o.${identifier(field)}`;
            })
            .join(",");
          let sql: string;
          if (insert) {
            const keys = Object.keys(insert);
            const placeholders = Object.values(insert).map((value) => {
              values.push(value);
              return `$${values.length}`;
            });
            sql = `INSERT INTO public.${identifier(table)} AS o (${keys.map(identifier).join(",")}) VALUES (${placeholders.join(",")}) RETURNING ${columns}`;
          } else if (update) {
            const sets = Object.entries(update).map(([key, value]) => {
              values.push(value);
              return `${identifier(key)} = $${values.length}`;
            });
            sql = `UPDATE public.${identifier(table)} o SET ${sets.join(",")}${where} RETURNING ${columns}`;
          } else {
            sql = `SELECT ${columns} FROM public.${identifier(table)} o${where}${order}${end === undefined ? "" : ` LIMIT ${end - start + 1} OFFSET ${start}`}`;
          }
          const result = await db.query(sql, values);
          return {
            data: JSON.parse(JSON.stringify(single ? (result.rows[0] ?? null) : result.rows)),
            error: null,
            count: total,
          };
        } catch (error) {
          return { data: null, error, count: null };
        }
      }
      return builder;
    },
  };
}

function identifier(name: string) {
  if (!/^[a-z_]+$/.test(name)) throw new Error(`Unexpected test SQL identifier: ${name}`);
  return `"${name}"`;
}
