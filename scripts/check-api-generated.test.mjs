import { execFileSync, spawnSync } from "node:child_process";
import { strict as assert } from "node:assert";
import { mkdtemp, readFile, rm, writeFile, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, describe, it } from "node:test";

const repositoryRoot = resolve(import.meta.dirname, "..");
const openApiPath = join(repositoryRoot, "lib/api-spec/openapi.yaml");
const generatedDirectories = [
  "lib/api-zod/src/generated",
  "lib/api-client-react/src/generated",
];
const fixturePath = "/__generated_client_drift_fixture";
const fixture = `
  ${fixturePath}:
    get:
      operationId: generatedClientDriftFixture
      tags: [health]
      summary: Generated client drift fixture
      responses:
        "200":
          description: Fixture response
          content:
            application/json:
              schema:
                type: string
`;

let originalSpec;
let originalStatus;
let backupDirectory;

function gitStatus() {
  return execFileSync(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all"],
    { cwd: repositoryRoot, encoding: "utf8" },
  );
}

async function snapshotGeneratedDirectories() {
  backupDirectory = await mkdtemp(join(tmpdir(), "api-generated-check-"));
  for (const directory of generatedDirectories) {
    const source = join(repositoryRoot, directory);
    const backup = join(backupDirectory, directory);
    await cp(source, backup, { recursive: true });
  }
}

async function restoreWorkingTree() {
  await writeFile(openApiPath, originalSpec);
  for (const directory of generatedDirectories) {
    const source = join(repositoryRoot, directory);
    const backup = join(backupDirectory, directory);
    await rm(source, { recursive: true, force: true });
    await cp(backup, source, { recursive: true });
  }
}

describe("check:api-generated", () => {
  before(async () => {
    originalSpec = await readFile(openApiPath, "utf8");
    originalStatus = gitStatus();
    await snapshotGeneratedDirectories();

    const componentsMarker = "\ncomponents:\n";
    assert.equal(
      originalSpec.includes(componentsMarker),
      true,
      "OpenAPI fixture insertion point is missing",
    );
    await writeFile(
      openApiPath,
      originalSpec.replace(
        componentsMarker,
        `${fixture}${componentsMarker}`,
      ),
    );
  });

  after(async () => {
    await restoreWorkingTree();
    await rm(backupDirectory, { recursive: true, force: true });
    assert.equal(
      gitStatus(),
      originalStatus,
      "generated-client check changed the working tree",
    );
  });

  it("fails with a generation error that names the OpenAPI source", async () => {
    const currentSpec = await readFile(openApiPath, "utf8");

    try {
      await writeFile(openApiPath, "openapi: [\n");

      const result = spawnSync("pnpm", ["run", "check:api-generated"], {
        cwd: repositoryRoot,
        encoding: "utf8",
      });
      const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

      assert.notEqual(result.status, 0, "invalid OpenAPI should fail the check");
      assert.match(
        output,
        /Failed to generate API clients from lib\/api-spec\/openapi\.yaml/,
      );
    } finally {
      await writeFile(openApiPath, currentSpec);
    }
  });

  it("fails with the OpenAPI source and both generated-client directories", () => {
    const result = spawnSync("pnpm", ["run", "check:api-generated"], {
      cwd: repositoryRoot,
      encoding: "utf8",
    });
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

    assert.notEqual(result.status, 0, "stale generated clients should fail the check");
    assert.match(output, /Generated API client drift detected/);
    assert.match(output, /lib\/api-spec\/openapi\.yaml/);
    assert.match(output, /lib\/api-zod\/src\/generated/);
    assert.match(output, /lib\/api-client-react\/src\/generated/);
  });
});