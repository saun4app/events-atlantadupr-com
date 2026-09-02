import { Octokit } from "@octokit/rest";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const DEFAULT_POLL_TIMEOUT_MS = 120_000;
const DEFAULT_POLL_INTERVAL_MS = 2_000;

export class HostedCleanupError extends Error {
  constructor(
    message,
    {
      code,
      status,
      handoffRequired = false,
      retryable = false,
      evidencePath,
      observations,
    } = {},
  ) {
    super(message);
    this.name = "HostedCleanupError";
    this.code = code;
    this.status = status;
    this.handoffRequired = handoffRequired;
    this.retryable = retryable;
    this.evidencePath = evidencePath;
    this.observations = observations;
  }
}

function responseStatus(errorOrResponse) {
  return errorOrResponse?.status ?? errorOrResponse?.response?.status;
}

function isRetryableApiStatus(status) {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

function repositoryLabel(owner, repo) {
  return `${owner}/${repo}`;
}

export function normalizeRunUrls(runUrls) {
  if (!Array.isArray(runUrls)) {
    throw new TypeError("runUrls must be an array");
  }

  const normalized = [];
  const seen = new Set();
  for (const value of runUrls) {
    const url = typeof value === "string" ? value.trim() : value?.html_url;
    if (!url) {
      throw new TypeError("Each hosted verification run must include a URL");
    }

    try {
      const parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        throw new Error("unsupported protocol");
      }
    } catch {
      throw new TypeError(`Invalid hosted verification run URL: ${url}`);
    }

    if (!seen.has(url)) {
      seen.add(url);
      normalized.push(url);
    }
  }

  if (normalized.length === 0) {
    throw new TypeError(
      "At least one hosted verification run URL must be recorded before teardown",
    );
  }

  return normalized;
}

export function createVerificationEvidence({
  owner,
  repo,
  runUrls,
  recordedAt = new Date().toISOString(),
}) {
  if (!owner || !repo) {
    throw new TypeError("owner and repo are required");
  }

  return {
    recorded_at: recordedAt,
    repository: repositoryLabel(owner, repo),
    run_urls: normalizeRunUrls(runUrls),
  };
}

async function writeJsonAtomically(path, value, { overwrite = true } = {}) {
  const target = resolve(path);
  await mkdir(dirname(target), { recursive: true });
  const contents = `${JSON.stringify(value, null, 2)}\n`;
  if (!overwrite) {
    await writeFile(target, contents, { encoding: "utf8", flag: "wx" });
    return;
  }

  const temporaryPath = `${target}.tmp-${process.pid}`;
  await writeFile(temporaryPath, contents, "utf8");
  await rename(temporaryPath, target);
}

export async function pollUntilRepositoryGone({
  getRepository,
  owner,
  repo,
  timeoutMs = DEFAULT_POLL_TIMEOUT_MS,
  intervalMs = DEFAULT_POLL_INTERVAL_MS,
  now = () => Date.now(),
  sleep = (delayMs) =>
    new Promise((resolvePromise) => setTimeout(resolvePromise, delayMs)),
}) {
  if (
    !Number.isFinite(timeoutMs) ||
    !Number.isFinite(intervalMs) ||
    timeoutMs < 0 ||
    intervalMs < 0
  ) {
    throw new TypeError(
      "timeoutMs and intervalMs must be finite, non-negative numbers",
    );
  }

  const startedAt = now();
  const deadline = startedAt + timeoutMs;
  const observations = [];

  while (true) {
    let status;
    let observation;
    try {
      const response = await getRepository({ owner, repo });
      status = responseStatus(response) ?? 200;
      observation = { status };
    } catch (error) {
      status = responseStatus(error);
      if (status === undefined) {
        status = "network-error";
        observation = { status, message: error?.message ?? String(error) };
      } else {
        observation = { status };
      }
    }

    observations.push(observation);
    if (status === 404) {
      return {
        status: "deleted",
        attempts: observations.length,
        observations,
      };
    }

    if (status === 403) {
      throw new HostedCleanupError(
        `Repository ${repositoryLabel(owner, repo)} returned 403 while verifying deletion; owner handoff is required.`,
        {
          code: "OWNER_HANDOFF_REQUIRED",
          status,
          handoffRequired: true,
          observations,
        },
      );
    }

    const remainingMs = deadline - now();
    if (remainingMs <= 0) {
      const retryableFailure =
        status === "network-error" || isRetryableApiStatus(status);
      if (retryableFailure) {
        throw new HostedCleanupError(
          `Repository ${repositoryLabel(owner, repo)} could not be verified because the GitHub API returned a retryable API failure (last response: ${status}); retry cleanup verification. Owner handoff is not required for this transient failure.`,
          {
            code: "RETRYABLE_API_FAILURE",
            status,
            retryable: true,
            observations,
          },
        );
      }

      throw new HostedCleanupError(
        `Repository ${repositoryLabel(owner, repo)} did not return 404 before the ${timeoutMs}ms cleanup verification timeout (last response: ${status ?? "unknown"}); cleanup is unresolved and owner handoff is required.`,
        {
          code: "CLEANUP_VERIFICATION_TIMEOUT",
          status,
          handoffRequired: true,
          observations,
        },
      );
    }

    await sleep(Math.min(intervalMs, remainingMs));
  }
}

export async function cleanupHostedRepository({
  client,
  owner,
  repo,
  runUrls,
  evidencePath,
  recordedAt,
  timeoutMs = DEFAULT_POLL_TIMEOUT_MS,
  intervalMs = DEFAULT_POLL_INTERVAL_MS,
  now,
  sleep,
}) {
  if (!client?.rest?.repos?.delete || !client?.rest?.repos?.get) {
    throw new TypeError(
      "client must provide rest.repos.delete and rest.repos.get",
    );
  }
  if (!evidencePath) {
    throw new TypeError("evidencePath is required");
  }

  const evidence = createVerificationEvidence({
    owner,
    repo,
    runUrls,
    recordedAt,
  });

  // This is intentionally the first filesystem side effect. If deletion or
  // polling fails, the run URLs remain available for diagnosis and handoff.
  const targetEvidencePath = resolve(evidencePath);
  try {
    await writeJsonAtomically(targetEvidencePath, evidence, {
      overwrite: false,
    });
  } catch (error) {
    throw new HostedCleanupError(
      `Could not create verification evidence at ${targetEvidencePath}; existing evidence was left untouched.`,
      {
        code: "EVIDENCE_FILE_EXISTS_OR_UNWRITABLE",
        evidencePath: targetEvidencePath,
      },
    );
  }

  let deleteResponse;
  try {
    deleteResponse = await client.rest.repos.delete({ owner, repo });
  } catch (error) {
    const status = responseStatus(error);
    const ownerHandoffRequired = status === 403;
    const retryableFailure =
      !ownerHandoffRequired &&
      (status === undefined || isRetryableApiStatus(status));
    const failureMessage = ownerHandoffRequired
      ? `Repository deletion request for ${repositoryLabel(owner, repo)} failed with 403; owner handoff is required.`
      : retryableFailure
        ? `Repository deletion request for ${repositoryLabel(owner, repo)} failed with ${status ?? "an unknown error"}; this is a retryable API failure. Retry cleanup; owner handoff is not required for this failure.`
        : `Repository deletion request for ${repositoryLabel(owner, repo)} failed with ${status ?? "an unknown error"}; owner handoff is not required for this failure.`;
    throw new HostedCleanupError(
      failureMessage,
      {
        code: ownerHandoffRequired
          ? "OWNER_HANDOFF_REQUIRED"
          : "DELETE_REQUEST_FAILED",
        status,
        handoffRequired: ownerHandoffRequired,
        retryable: retryableFailure,
        evidencePath: targetEvidencePath,
      },
    );
  }

  let verification;
  try {
    verification = await pollUntilRepositoryGone({
      getRepository: (params) => client.rest.repos.get(params),
      owner,
      repo,
      timeoutMs,
      intervalMs,
      now,
      sleep,
    });
  } catch (error) {
    if (error instanceof HostedCleanupError) {
      error.evidencePath = targetEvidencePath;
    }
    throw error;
  }

  await writeJsonAtomically(targetEvidencePath, {
    ...evidence,
    cleanup: {
      delete_status: responseStatus(deleteResponse) ?? 204,
      verified_at: new Date().toISOString(),
      verification,
    },
  });

  return {
    evidencePath: targetEvidencePath,
    verification,
  };
}

function parseArguments(argv) {
  const args = {
    runUrls: [],
    timeoutMs: DEFAULT_POLL_TIMEOUT_MS,
    intervalMs: DEFAULT_POLL_INTERVAL_MS,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      args.help = true;
      continue;
    }

    const value = argv[index + 1];
    if (argument === "--owner") args.owner = value;
    else if (argument === "--repo") args.repo = value;
    else if (argument === "--run-url") args.runUrls.push(value);
    else if (argument === "--evidence-file") args.evidencePath = value;
    else if (argument === "--poll-timeout-ms") args.timeoutMs = Number(value);
    else if (argument === "--poll-interval-ms") args.intervalMs = Number(value);
    else throw new Error(`Unknown argument: ${argument}`);
    index += 1;
  }

  return args;
}

function printUsage() {
  console.log(`Usage:
  GITHUB_TOKEN=... node scripts/verify-hosted-cleanup.mjs \\
    --owner OWNER \\
    --repo DISPOSABLE_REPO \\
    --run-url https://github.com/OWNER/REPO/actions/runs/123 \\
    --evidence-file test-results/hosted-verification.json

The run URL option may be repeated. The evidence file is written before the
repository is deleted and is preserved if deletion or 404 verification fails.
`);
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  for (const required of ["owner", "repo", "evidencePath"]) {
    if (!args[required]) {
      const argumentName = {
        owner: "--owner",
        repo: "--repo",
        evidencePath: "--evidence-file",
      }[required];
      throw new Error(`Missing required argument: ${argumentName}`);
    }
  }

  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (!token) {
    throw new Error(
      "GITHUB_TOKEN (or GH_TOKEN) is required; provide it through the environment, not command arguments",
    );
  }

  const result = await cleanupHostedRepository({
    client: new Octokit({ auth: token }),
    ...args,
  });
  console.log(
    `Repository ${args.owner}/${args.repo} returned 404 after deletion (${result.verification.attempts} poll(s)).`,
  );
  console.log(`Saved hosted verification evidence to ${result.evidencePath}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    await main();
  } catch (error) {
    console.error(
      `::error::${error instanceof Error ? error.message : String(error)}`,
    );
    if (error?.handoffRequired) {
      console.error(
        "Owner handoff: the repository owner must complete deletion and rerun the 404 verification.",
      );
    }
    if (error?.evidencePath) {
      console.error(`Verification evidence preserved at ${error.evidencePath}`);
    }
    process.exitCode = 1;
  }
}