import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

const isTestEnvironment = process.env.NODE_ENV === "test";
const databaseUrl = isTestEnvironment
  ? process.env.TEST_DATABASE_URL
  : process.env.DATABASE_URL;
const testDatabaseSchema = process.env.TEST_DATABASE_SCHEMA;

if (!databaseUrl) {
  if (isTestEnvironment) {
    throw new Error(
      "TEST_DATABASE_URL must be set for API integration tests. Refusing to use the development DATABASE_URL.",
    );
  }
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

if (
  isTestEnvironment &&
  testDatabaseSchema &&
  (testDatabaseSchema === "public" ||
    !/^[a-z_][a-z0-9_]*$/.test(testDatabaseSchema))
) {
  throw new Error(
    `TEST_DATABASE_SCHEMA must be a simple non-public PostgreSQL identifier: "${testDatabaseSchema}"`,
  );
}

function databaseTarget(url: string) {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parsed.port || "5432",
    database: decodeURIComponent(parsed.pathname.slice(1)),
  };
}

if (isTestEnvironment && process.env.DATABASE_URL) {
  const testTarget = databaseTarget(databaseUrl);
  const developmentTarget = databaseTarget(process.env.DATABASE_URL);
  const sameDatabase =
    testTarget.host === developmentTarget.host &&
    testTarget.port === developmentTarget.port &&
    testTarget.database === developmentTarget.database;

  if (sameDatabase && !testDatabaseSchema) {
    throw new Error(
      "TEST_DATABASE_URL points to the development database. Use an isolated test database or set TEST_DATABASE_SCHEMA to a non-public schema.",
    );
  }
}

export const pool = new Pool({
  connectionString: databaseUrl,
  ...(isTestEnvironment && testDatabaseSchema
    ? { options: `-c search_path=${testDatabaseSchema}` }
    : {}),
});
export const db = drizzle(pool, { schema });

export { sql };
export * from "./schema";
export {
  defaultUserRole,
  userRoleIdMap,
  userRoleIds,
  userRolesConfig,
} from "./user-roles";

/**
 * Test cleanup must only run after this check succeeds. TEST_DATABASE_URL
 * selects a separate database, or TEST_DATABASE_SCHEMA selects a dedicated
 * non-public schema in the same PostgreSQL database. The live connection is
 * checked as well, so a misconfigured URL cannot silently target development
 * data.
 */
export async function assertTestDatabase(): Promise<void> {
  if (!isTestEnvironment || !process.env.TEST_DATABASE_URL) {
    throw new Error(
      "Destructive test cleanup requires NODE_ENV=test and TEST_DATABASE_URL.",
    );
  }

  const result = await db.execute(
    sql`select current_database() as database, current_schema() as schema`,
  );
  const connection = result.rows[0] as unknown as
    | { database: string; schema: string }
    | undefined;
  const expectedTarget = databaseTarget(process.env.TEST_DATABASE_URL);

  if (connection?.database !== expectedTarget.database) {
    throw new Error(
      `Test cleanup refused: connected to database "${connection?.database ?? "unknown"}", expected "${expectedTarget.database}".`,
    );
  }

  if (testDatabaseSchema && connection.schema !== testDatabaseSchema) {
    throw new Error(
      `Test cleanup refused: connected to schema "${connection.schema}", expected "${testDatabaseSchema}".`,
    );
  }

  if (!testDatabaseSchema && process.env.DATABASE_URL) {
    const developmentTarget = databaseTarget(process.env.DATABASE_URL);
    if (
      expectedTarget.host === developmentTarget.host &&
      expectedTarget.port === developmentTarget.port &&
      expectedTarget.database === developmentTarget.database
    ) {
      throw new Error(
        "Test cleanup refused: the configured test database is the development database.",
      );
    }
  }
}
