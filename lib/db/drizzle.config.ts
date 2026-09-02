import { defineConfig } from "drizzle-kit";
import path from "path";

const isTestEnvironment = process.env.NODE_ENV === "test";
const databaseUrl = isTestEnvironment
  ? process.env.TEST_DATABASE_URL
  : process.env.DATABASE_URL;

function databaseTarget(url: string) {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parsed.port || "5432",
    database: decodeURIComponent(parsed.pathname.slice(1)),
  };
}

if (!databaseUrl) {
  if (isTestEnvironment) {
    throw new Error(
      "TEST_DATABASE_URL must be set when initializing the test database.",
    );
  }
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

if (isTestEnvironment && process.env.DATABASE_URL) {
  const testTarget = databaseTarget(databaseUrl);
  const developmentTarget = databaseTarget(process.env.DATABASE_URL);
  const sameDatabase =
    testTarget.host === developmentTarget.host &&
    testTarget.port === developmentTarget.port &&
    testTarget.database === developmentTarget.database;

  if (sameDatabase) {
    throw new Error(
      "TEST_DATABASE_URL points to the development database. Use an isolated test database before initializing its schema.",
    );
  }
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
});
