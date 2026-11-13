import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";

async function findAvailablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not reserve a local PostgreSQL port.");
  }
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return address.port;
}

const port = await findAvailablePort();
const directory = mkdtempSync(join(tmpdir(), "atl-e2e-tests-"));
const data = join(directory, "data");
const env = {
  ...process.env,
  NODE_ENV: "test",
  TEST_DATABASE_URL: `postgresql:///e2e_test?host=${encodeURIComponent(directory)}&port=${port}&user=e2e_runner`,
};
delete env.TEST_DATABASE_SCHEMA;

let started = false;
let exitCode = 1;

try {
  execFileSync("initdb", ["-D", data, "-A", "trust", "-U", "e2e_runner"], {
    stdio: "ignore",
  });
  execFileSync(
    "pg_ctl",
    [
      "-D",
      data,
      "-l",
      join(directory, "postgres.log"),
      "-o",
      `-h '' -k ${directory} -p ${port}`,
      "-w",
      "start",
    ],
    { stdio: "ignore" },
  );
  started = true;
  execFileSync(
    "createdb",
    ["-h", directory, "-p", String(port), "-U", "e2e_runner", "e2e_test"],
    { stdio: "ignore" },
  );

  const setup = spawnSync("pnpm", ["--filter", "@workspace/db", "run", "push-test"], {
    env,
    stdio: "inherit",
  });
  if (setup.error) throw setup.error;
  if (setup.status !== 0) {
    exitCode = setup.status ?? 1;
  } else {
    const playwrightArgs = process.argv.slice(2);
    if (playwrightArgs[0] === "--") playwrightArgs.shift();
    const tests = spawnSync("pnpm", ["test:e2e", ...playwrightArgs], {
      env,
      stdio: "inherit",
    });
    if (tests.error) throw tests.error;
    exitCode = tests.status ?? 1;
  }
} catch (error) {
  console.error(
    error instanceof Error
      ? `Could not run isolated browser tests: ${error.message}`
      : "Could not run isolated browser tests.",
  );
} finally {
  if (started) {
    try {
      execFileSync(
        "pg_ctl",
        ["-D", data, "-m", "immediate", "-w", "stop"],
        { stdio: "ignore" },
      );
    } catch {
      exitCode = 1;
    }
  }
  rmSync(directory, { recursive: true, force: true });
}

process.exitCode = exitCode;
