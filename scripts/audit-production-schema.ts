/**
 * Read-only pre-publish audit for the production users table.
 *
 * The expected shape mirrors lib/db/src/schema/users.ts and migration 0004,
 * which renamed `app_uses` to `app_users` and added the optional DUPR fields.
 *
 * Report findings without a non-zero exit code:
 *   pnpm run audit:production-schema
 *
 * Use the release check to block publishing on schema issues or rename risks:
 *   pnpm run check:production-schema
 *
 * Run this with DATABASE_URL pointed at the production database. All catalog,
 * count, and constraint queries execute inside a READ ONLY transaction. This
 * script contains no INSERT, UPDATE, DELETE, DDL, or other write operation.
 */

import { db, pool, sql } from "../lib/db/src/index.js";

type ExpectedColumn = {
  name: string;
  dataType: string;
  udtName: string;
  nullable: boolean;
  defaultDescription: string;
  matchesDefault?: (value: string | null) => boolean;
};

type ActualColumn = {
  column_name: string;
  data_type: string;
  udt_name: string;
  is_nullable: "YES" | "NO";
  column_default: string | null;
};

type ConstraintRecord = {
  constraint_name: string;
  constraint_type: string;
  definition: string;
  column_name: string;
};

const expectedColumns: ExpectedColumn[] = [
  {
    name: "id",
    dataType: "integer",
    udtName: "int4",
    nullable: false,
    defaultDescription: "a serial sequence default",
    matchesDefault: (value) => value !== null && value.startsWith("nextval("),
  },
  {
    name: "name",
    dataType: "text",
    udtName: "text",
    nullable: false,
    defaultDescription: "no default",
  },
  {
    name: "username",
    dataType: "text",
    udtName: "text",
    nullable: false,
    defaultDescription: "no default",
  },
  {
    name: "password_hash",
    dataType: "text",
    udtName: "text",
    nullable: false,
    defaultDescription: "no default",
  },
  {
    name: "role",
    dataType: "text",
    udtName: "text",
    nullable: false,
    defaultDescription: "the configured default role",
    matchesDefault: (value) =>
      value !== null && value.includes("'event_participant'"),
  },
  {
    name: "dupr_id",
    dataType: "text",
    udtName: "text",
    nullable: true,
    defaultDescription: "no default",
  },
  {
    name: "dupr_fullname",
    dataType: "text",
    udtName: "text",
    nullable: true,
    defaultDescription: "no default",
  },
  {
    name: "created_at",
    dataType: "timestamp without time zone",
    udtName: "timestamp",
    nullable: false,
    defaultDescription: "now()",
    matchesDefault: (value) => value !== null && value.includes("now()"),
  },
];

function usage(): never {
  console.error(
    "Usage: audit-production-schema [--check]\n" +
      "  --check  return non-zero when schema issues or rename-risk warnings are found",
  );
  process.exit(2);
}

function isExpectedDefault(column: ExpectedColumn, actual: ActualColumn) {
  if (column.matchesDefault)
    return column.matchesDefault(actual.column_default);
  return actual.column_default === null;
}

async function main() {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  if (args.some((arg) => arg !== "--check")) usage();
  const check = args.includes("--check");

  const issues: string[] = [];
  const warnings: string[] = [];

  console.log("Production schema audit (read-only)");
  console.log(
    "Target: DATABASE_URL supplied to this process; no production data will be changed.",
  );

  await db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION READ ONLY`);

    const tableResult = await tx.execute(sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('app_users', 'app_uses')
    `);
    const presentTables = new Set(
      (tableResult.rows as Array<{ table_name: string }>).map(
        ({ table_name }) => table_name,
      ),
    );
    const hasUsersTable = presentTables.has("app_users");
    const hasLegacyTable = presentTables.has("app_uses");

    console.log(
      `Tables: app_users=${hasUsersTable ? "present" : "MISSING"}, ` +
        `legacy app_uses=${hasLegacyTable ? "present" : "absent"}`,
    );

    if (!hasUsersTable) {
      issues.push("Missing expected table public.app_users.");
    }

    if (!hasUsersTable && hasLegacyTable) {
      warnings.push(
        "WARNING: public.app_users is missing while legacy public.app_uses exists. " +
          "A publish may be interpreted as a destructive drop-and-create instead of " +
          "the 0004 rename, risking the existing users.",
      );
    } else if (hasUsersTable && hasLegacyTable) {
      warnings.push(
        "WARNING: both public.app_users and legacy public.app_uses exist. " +
          "A publish may drop the legacy table; verify that the rename was completed " +
          "and that both row counts are understood.",
      );
    } else if (!hasUsersTable && !hasLegacyTable) {
      warnings.push(
        "WARNING: neither public.app_users nor legacy public.app_uses exists. " +
          "A publish could create an empty users table with no preserved source.",
      );
    }

    const columnResult = await tx.execute(sql`
      SELECT column_name, data_type, udt_name, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'app_users'
      ORDER BY ordinal_position
    `);
    const actualColumns = new Map(
      (columnResult.rows as ActualColumn[]).map((column) => [
        column.column_name,
        column,
      ]),
    );

    for (const expected of expectedColumns) {
      const actual = actualColumns.get(expected.name);
      if (!actual) {
        issues.push(`Missing column public.app_users.${expected.name}.`);
        continue;
      }

      if (
        actual.data_type !== expected.dataType ||
        actual.udt_name !== expected.udtName
      ) {
        issues.push(
          `Column public.app_users.${expected.name} has type ` +
            `${actual.data_type} (${actual.udt_name}); expected ` +
            `${expected.dataType} (${expected.udtName}).`,
        );
      }

      const actualNullable = actual.is_nullable === "YES";
      if (actualNullable !== expected.nullable) {
        issues.push(
          `Column public.app_users.${expected.name} is ` +
            `${actualNullable ? "nullable" : "not nullable"}; expected it to be ` +
            `${expected.nullable ? "nullable" : "not nullable"}.`,
        );
      }

      if (!isExpectedDefault(expected, actual)) {
        issues.push(
          `Column public.app_users.${expected.name} has an unexpected default ` +
            `${JSON.stringify(actual.column_default)}; expected ${expected.defaultDescription}.`,
        );
      }
    }

    const constraintResult = await tx.execute(sql`
      SELECT
        con.conname AS constraint_name,
        CASE con.contype
          WHEN 'p' THEN 'PRIMARY KEY'
          WHEN 'u' THEN 'UNIQUE'
          WHEN 'f' THEN 'FOREIGN KEY'
          WHEN 'c' THEN 'CHECK'
          WHEN 'x' THEN 'EXCLUSION'
          ELSE con.contype::text
        END AS constraint_type,
        pg_get_constraintdef(con.oid) AS definition,
        attr.attname AS column_name
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
      JOIN LATERAL unnest(con.conkey) AS key(attnum) ON true
      JOIN pg_attribute attr
        ON attr.attrelid = rel.oid
       AND attr.attnum = key.attnum
      WHERE nsp.nspname = 'public'
        AND rel.relname = 'app_users'
        AND attr.attname IN ('dupr_id', 'dupr_fullname')
      ORDER BY attr.attname, con.conname
    `);
    const unexpectedConstraints = constraintResult.rows as ConstraintRecord[];

    if (unexpectedConstraints.length > 0) {
      for (const constraint of unexpectedConstraints) {
        issues.push(
          `Unexpected ${constraint.constraint_type} constraint ` +
            `${constraint.constraint_name} on public.app_users.${constraint.column_name}: ` +
            `${constraint.definition}.`,
        );
      }
    }

    const countTable = async (table: "app_users" | "app_uses") => {
      if (!presentTables.has(table)) return null;
      const result =
        table === "app_users"
          ? await tx.execute(
              sql`SELECT COUNT(*)::int AS user_count FROM app_users`,
            )
          : await tx.execute(
              sql`SELECT COUNT(*)::int AS user_count FROM app_uses`,
            );
      return Number((result.rows[0] as { user_count: number }).user_count);
    };

    const currentUserCount = await countTable("app_users");
    const legacyUserCount = await countTable("app_uses");

    if (currentUserCount !== null) {
      console.log(
        `Preserved user count: ${currentUserCount} row(s) in public.app_users.`,
      );
    } else if (legacyUserCount !== null) {
      console.log(
        `Preserved user count: ${legacyUserCount} row(s) currently in ` +
          "legacy public.app_uses; app_users has not been created or renamed.",
      );
    } else {
      console.log("Preserved user count: unavailable; no users table exists.");
    }

    if (
      currentUserCount !== null &&
      legacyUserCount !== null &&
      currentUserCount !== legacyUserCount
    ) {
      warnings.push(
        `WARNING: app_users contains ${currentUserCount} row(s), while legacy ` +
          `app_uses contains ${legacyUserCount}; investigate before publishing.`,
      );
    }

    if (issues.length > 0) {
      console.error("\nSchema issues:");
      for (const issue of issues) console.error(`- ${issue}`);
    }

    if (warnings.length > 0) {
      console.error("\nWarnings:");
      for (const warning of warnings) console.error(`- ${warning}`);
    }
  });

  if (issues.length === 0 && warnings.length === 0) {
    console.log("\nProduction schema check passed.");
  } else if (!check) {
    console.log(
      "\nAudit completed with findings. Re-run with --check to fail the release gate.",
    );
  } else {
    console.error(
      "\nProduction schema check failed; resolve the findings before publishing.",
    );
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error("Production schema audit failed:", error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
