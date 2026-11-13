import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A private, disposable PostgreSQL cluster: no development or production data.
// Requires PostgreSQL tools on PATH (already supplied by this workspace).
const directory = mkdtempSync(join(tmpdir(), "atl-api-tests-"));
const data = join(directory, "data");
const env = {
  ...process.env,
  NODE_ENV: "test",
  TEST_DATABASE_URL: `postgresql:///api_test?host=${encodeURIComponent(directory)}&port=5544&user=test_runner`,
};
delete env.TEST_DATABASE_SCHEMA;
let started = false;
try {
  execFileSync("initdb", ["-D", data, "-A", "trust", "-U", "test_runner"], { stdio: "ignore" });
  execFileSync("pg_ctl", ["-D", data, "-l", join(directory, "postgres.log"), "-o", `-h '' -k ${directory} -p 5544`, "-w", "start"], { stdio: "ignore" });
  started = true;
  execFileSync("createdb", ["-h", directory, "-p", "5544", "-U", "test_runner", "api_test"], { stdio: "ignore" });
  for (const command of ["test:api:setup", "test:api"]) {
    const result = spawnSync("pnpm", ["run", command], { env, stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      process.exitCode = result.status ?? 1;
      break;
    }
  }
} finally {
  if (started) {
    try { execFileSync("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"], { stdio: "ignore" }); }
    catch { process.exitCode = 1; }
  }
  rmSync(directory, { recursive: true, force: true });
}
