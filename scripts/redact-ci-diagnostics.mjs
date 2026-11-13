import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const SENSITIVE_PATTERNS = [
  {
    name: "database URL",
    pattern:
      /(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s<>"']+/gi,
    replacement: "[REDACTED_DATABASE_URL]",
  },
  {
    name: "authorization header",
    pattern:
      /(authorization["']?\s*:\s*(["']?)(?:bearer|basic)\s+)[^\s<>"']+\2/gi,
    replacement: "$1[REDACTED]$2",
  },
  {
    name: "credential field",
    pattern:
      /((?:password|secret|token|api[_-]?key)["']?\s*[=:]\s*)(["']?)[^\s,}"'<]+\2/gi,
    replacement: "$1$2[REDACTED]$2",
  },
];

export function redactSensitiveValues(content) {
  return SENSITIVE_PATTERNS.reduce(
    (redacted, { pattern, replacement }) =>
      redacted.replace(pattern, replacement),
    content,
  );
}

export function findSensitiveValues(content) {
  return SENSITIVE_PATTERNS.flatMap(({ name, pattern, replacement }) =>
    content.replace(pattern, replacement) !== content ? [name] : [],
  );
}

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const path = resolve(directory, entry.name);
      return entry.isDirectory() ? listFiles(path) : [path];
    }),
  );
  return files.flat();
}

export async function redactDiagnostics(directory) {
  const leakedFiles = [];

  for (const file of await listFiles(directory)) {
    const content = await readFile(file, "utf8");
    const redacted = redactSensitiveValues(content);
    await writeFile(file, redacted);

    const leakedKinds = findSensitiveValues(redacted);
    if (leakedKinds.length > 0) {
      leakedFiles.push({ file, leakedKinds });
    }
  }

  if (leakedFiles.length > 0) {
    const details = leakedFiles
      .map(({ file, leakedKinds }) => `${file}: ${leakedKinds.join(", ")}`)
      .join("\n");
    throw new Error(`Sensitive values remain in CI diagnostics:\n${details}`);
  }
}

async function main() {
  const directory = resolve(process.argv[2] ?? "test-results");
  await redactDiagnostics(directory);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
