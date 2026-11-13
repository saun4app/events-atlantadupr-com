import { execFileSync, spawnSync } from "node:child_process";

const generatedDirectories = [
  "lib/api-zod/src/generated",
  "lib/api-client-react/src/generated",
];

function reportDrift() {
  console.error(
    "::error::Generated API client drift detected. OpenAPI source: lib/api-spec/openapi.yaml",
  );
  console.error(
    "Affected generated-client directories: lib/api-zod/src/generated and lib/api-client-react/src/generated",
  );
  console.error(
    "Regenerate the clients from lib/api-spec/openapi.yaml and commit the generated files.",
  );
  spawnSync("git", ["diff", "--stat", "--", ...generatedDirectories], {
    stdio: "inherit",
  });
}

const codegen = spawnSync(
  "pnpm",
  ["--filter", "@workspace/api-spec", "run", "codegen"],
  { stdio: "inherit" },
);

if (codegen.status !== 0) {
  console.error(
    "::error::Failed to generate API clients from lib/api-spec/openapi.yaml.",
  );
  process.exit(codegen.status ?? 1);
}

const generatedDiff = spawnSync(
  "git",
  ["diff", "--quiet", "--", ...generatedDirectories],
  { stdio: "ignore" },
);

if (generatedDiff.status !== 0) {
  reportDrift();
  process.exit(1);
}

const untrackedGeneratedFiles = execFileSync(
  "git",
  ["ls-files", "--others", "--exclude-standard", "--", ...generatedDirectories],
  { encoding: "utf8" },
).trim();

if (untrackedGeneratedFiles) {
  console.error(
    "::error::Generated API client drift detected. OpenAPI source: lib/api-spec/openapi.yaml",
  );
  console.error(
    "Affected generated-client directories: lib/api-zod/src/generated and lib/api-client-react/src/generated",
  );
  console.error("Code generation created untracked client files:");
  console.error(untrackedGeneratedFiles);
  process.exit(1);
}