import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  cleanupHostedRepository,
  HostedCleanupError,
  pollUntilRepositoryGone,
} from "./verify-hosted-cleanup.mjs";

function fakeClient({ responses, deleteResponses, onDelete } = {}) {
  const queue = [...(responses ?? [{ status: 404 }])];
  const deleteQueue = [...(deleteResponses ?? [])];
  const calls = [];
  return {
    calls,
    rest: {
      repos: {
        async delete(params) {
          calls.push({ operation: "delete", params });
          await onDelete?.();
          const response = deleteQueue.shift() ?? { status: 204 };
          if (response instanceof Error) throw response;
          if (response.error) throw response.error;
          return response;
        },
        async get(params) {
          calls.push({ operation: "get", params });
          const response = queue.shift() ?? { status: 404 };
          if (response instanceof Error) throw response;
          if (response.error) throw response.error;
          return response;
        },
      },
    },
  };
}

async function evidenceIn(directory) {
  return JSON.parse(
    await readFile(join(directory, "hosted-verification.json"), "utf8"),
  );
}

test("records run URLs before deletion and proves the repository returns 404", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hosted-cleanup-"));
  let evidenceExistsWhenDeleted = false;
  const client = fakeClient({
    responses: [{ status: 200 }, { status: 404 }],
    onDelete: async () => {
      await readFile(join(directory, "hosted-verification.json"), "utf8");
      evidenceExistsWhenDeleted = true;
    },
  });

  const result = await cleanupHostedRepository({
    client,
    owner: "example-owner",
    repo: "disposable-fork",
    runUrls: [
      "https://github.com/example-owner/project/actions/runs/123",
      "https://github.com/example-owner/project/actions/runs/123",
    ],
    evidencePath: join(directory, "hosted-verification.json"),
    intervalMs: 0,
  });

  assert.equal(evidenceExistsWhenDeleted, true);
  assert.equal(result.verification.status, "deleted");
  assert.deepEqual(
    client.calls.map((call) => call.operation),
    ["delete", "get", "get"],
  );
  const evidence = await evidenceIn(directory);
  assert.deepEqual(evidence.run_urls, [
    "https://github.com/example-owner/project/actions/runs/123",
  ]);
  assert.equal(evidence.cleanup.verification.status, "deleted");
});

test("reports an owner handoff for a 403 and preserves the run evidence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hosted-cleanup-"));
  const client = fakeClient({
    responses: [
      { error: Object.assign(new Error("forbidden"), { status: 403 }) },
    ],
  });

  await assert.rejects(
    cleanupHostedRepository({
      client,
      owner: "example-owner",
      repo: "disposable-fork",
      runUrls: ["https://github.com/example-owner/project/actions/runs/456"],
      evidencePath: join(directory, "hosted-verification.json"),
      intervalMs: 0,
    }),
    (error) => {
      assert(error instanceof HostedCleanupError);
      assert.equal(error.code, "OWNER_HANDOFF_REQUIRED");
      assert.equal(error.handoffRequired, true);
      assert.match(error.message, /owner handoff is required/);
      return true;
    },
  );

  const evidence = await evidenceIn(directory);
  assert.deepEqual(evidence.run_urls, [
    "https://github.com/example-owner/project/actions/runs/456",
  ]);
  assert.equal(evidence.cleanup, undefined);
  assert.equal(
    client.calls.filter((call) => call.operation === "delete").length,
    1,
  );
});

test("reports a retryable DELETE failure and preserves the run evidence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hosted-cleanup-"));
  const client = fakeClient({
    onDelete: async () => {
      throw Object.assign(new Error("GitHub is temporarily unavailable"), {
        status: 503,
      });
    },
  });

  await assert.rejects(
    cleanupHostedRepository({
      client,
      owner: "example-owner",
      repo: "disposable-fork",
      runUrls: ["https://github.com/example-owner/project/actions/runs/512"],
      evidencePath: join(directory, "hosted-verification.json"),
      deleteRetryDelayMs: 0,
      sleep: async () => {},
    }),
    (error) => {
      assert(error instanceof HostedCleanupError);
      assert.equal(error.code, "DELETE_REQUEST_FAILED");
      assert.equal(error.status, 503);
      assert.equal(error.retryable, true);
      assert.equal(error.handoffRequired, false);
      assert.equal(error.observations.length, 3);
      assert.deepEqual(
        error.observations.map(({ attempt, status }) => ({ attempt, status })),
        [
          { attempt: 1, status: 503 },
          { attempt: 2, status: 503 },
          { attempt: 3, status: 503 },
        ],
      );
      assert.match(error.message, /retryable API failure/);
      assert.doesNotMatch(error.message, /owner handoff is required/);
      return true;
    },
  );

  const evidence = await evidenceIn(directory);
  assert.deepEqual(evidence.run_urls, [
    "https://github.com/example-owner/project/actions/runs/512",
  ]);
  assert.equal(evidence.cleanup, undefined);
});

test("retries a transient DELETE response and then verifies deletion", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hosted-cleanup-"));
  const client = fakeClient({
    deleteResponses: [
      { status: 503 },
      { status: 204 },
    ],
  });
  const delays = [];

  const result = await cleanupHostedRepository({
    client,
    owner: "example-owner",
    repo: "disposable-fork",
    runUrls: ["https://github.com/example-owner/project/actions/runs/514"],
    evidencePath: join(directory, "hosted-verification.json"),
    deleteRetryDelayMs: 25,
    sleep: async (delayMs) => {
      delays.push(delayMs);
    },
    intervalMs: 0,
  });

  assert.equal(result.verification.status, "deleted");
  assert.deepEqual(
    client.calls.map((call) => call.operation),
    ["delete", "delete", "get"],
  );
  assert.deepEqual(delays, [25]);
  const evidence = await evidenceIn(directory);
  assert.equal(evidence.cleanup.delete_status, 204);
});

test("uses a valid Retry-After header for a transient DELETE response", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hosted-cleanup-"));
  const client = fakeClient({
    deleteResponses: [
      { status: 429, headers: { "retry-after": "3" } },
      { status: 204 },
    ],
  });
  const delays = [];

  await cleanupHostedRepository({
    client,
    owner: "example-owner",
    repo: "disposable-fork",
    runUrls: ["https://github.com/example-owner/project/actions/runs/516"],
    evidencePath: join(directory, "hosted-verification.json"),
    deleteRetryDelayMs: 25,
    sleep: async (delayMs) => {
      delays.push(delayMs);
    },
    intervalMs: 0,
  });

  assert.deepEqual(delays, [3_000]);
});

test("uses a valid rate-limit reset header for a transient DELETE error", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hosted-cleanup-"));
  let currentTime = 100_000;
  const client = fakeClient({
    deleteResponses: [
      {
        error: Object.assign(new Error("rate limited"), {
          status: 429,
          response: {
            status: 429,
            headers: { "x-ratelimit-reset": "103" },
          },
        }),
      },
      { status: 204 },
    ],
  });
  const delays = [];

  await cleanupHostedRepository({
    client,
    owner: "example-owner",
    repo: "disposable-fork",
    runUrls: ["https://github.com/example-owner/project/actions/runs/517"],
    evidencePath: join(directory, "hosted-verification.json"),
    deleteRetryDelayMs: 25,
    now: () => currentTime,
    sleep: async (delayMs) => {
      delays.push(delayMs);
      currentTime += delayMs;
    },
    intervalMs: 0,
  });

  assert.deepEqual(delays, [3_000]);
});

test("uses exponential backoff when retry timing is missing", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hosted-cleanup-"));
  const client = fakeClient({
    deleteResponses: [{ status: 503 }, { status: 204 }],
  });
  const delays = [];

  await cleanupHostedRepository({
    client,
    owner: "example-owner",
    repo: "disposable-fork",
    runUrls: ["https://github.com/example-owner/project/actions/runs/518"],
    evidencePath: join(directory, "hosted-verification.json"),
    deleteRetryDelayMs: 25,
    sleep: async (delayMs) => {
      delays.push(delayMs);
    },
    intervalMs: 0,
  });

  assert.deepEqual(delays, [25]);
});

test("ignores invalid retry timing and keeps the configured maximum backoff", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hosted-cleanup-"));
  const client = fakeClient({
    deleteResponses: [
      {
        status: 503,
        headers: {
          "retry-after": "not-a-delay",
          "x-ratelimit-reset": "not-a-timestamp",
        },
      },
      { status: 204 },
    ],
  });
  const delays = [];

  await cleanupHostedRepository({
    client,
    owner: "example-owner",
    repo: "disposable-fork",
    runUrls: ["https://github.com/example-owner/project/actions/runs/519"],
    evidencePath: join(directory, "hosted-verification.json"),
    deleteRetryDelayMs: 20_000,
    sleep: async (delayMs) => {
      delays.push(delayMs);
    },
    intervalMs: 0,
  });

  assert.deepEqual(delays, [10_000]);
});

test("caps an excessive valid GitHub retry delay at the configured maximum", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hosted-cleanup-"));
  const client = fakeClient({
    deleteResponses: [
      { status: 429, headers: { "retry-after": "30" } },
      { status: 204 },
    ],
  });
  const delays = [];

  await cleanupHostedRepository({
    client,
    owner: "example-owner",
    repo: "disposable-fork",
    runUrls: ["https://github.com/example-owner/project/actions/runs/520"],
    evidencePath: join(directory, "hosted-verification.json"),
    sleep: async (delayMs) => {
      delays.push(delayMs);
    },
    intervalMs: 0,
  });

  assert.deepEqual(delays, [10_000]);
});

test("retries a network DELETE failure within the bounded attempt budget", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hosted-cleanup-"));
  const client = fakeClient({
    deleteResponses: [
      new Error("socket hang up"),
      { status: 204 },
    ],
  });
  const delays = [];

  await cleanupHostedRepository({
    client,
    owner: "example-owner",
    repo: "disposable-fork",
    runUrls: ["https://github.com/example-owner/project/actions/runs/515"],
    evidencePath: join(directory, "hosted-verification.json"),
    deleteAttempts: 2,
    deleteRetryDelayMs: 100,
    sleep: async (delayMs) => {
      delays.push(delayMs);
    },
    intervalMs: 0,
  });

  assert.equal(
    client.calls.filter((call) => call.operation === "delete").length,
    2,
  );
  assert.deepEqual(delays, [100]);
});

test("reports a retryable GET network failure and preserves the run evidence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hosted-cleanup-"));
  let currentTime = 0;
  const client = fakeClient({
    responses: [new Error("socket hang up"), new Error("socket hang up")],
  });

  await assert.rejects(
    cleanupHostedRepository({
      client,
      owner: "example-owner",
      repo: "disposable-fork",
      runUrls: ["https://github.com/example-owner/project/actions/runs/513"],
      evidencePath: join(directory, "hosted-verification.json"),
      timeoutMs: 5,
      intervalMs: 5,
      now: () => currentTime,
      sleep: async (delayMs) => {
        currentTime += delayMs;
      },
    }),
    (error) => {
      assert(error instanceof HostedCleanupError);
      assert.equal(error.code, "RETRYABLE_API_FAILURE");
      assert.equal(error.status, "network-error");
      assert.equal(error.retryable, true);
      assert.equal(error.handoffRequired, false);
      assert.match(error.message, /retryable API failure/);
      assert.doesNotMatch(error.message, /owner handoff is required/);
      assert.equal(error.observations[0].message, "socket hang up");
      return true;
    },
  );

  const evidence = await evidenceIn(directory);
  assert.deepEqual(evidence.run_urls, [
    "https://github.com/example-owner/project/actions/runs/513",
  ]);
  assert.equal(evidence.cleanup, undefined);
});

test("fails on timeout after repeated non-404 responses", async () => {
  let currentTime = 0;
  const statuses = [];

  await assert.rejects(
    pollUntilRepositoryGone({
      owner: "example-owner",
      repo: "disposable-fork",
      getRepository: async () => {
        statuses.push(200);
        return { status: 200 };
      },
      timeoutMs: 10,
      intervalMs: 5,
      now: () => currentTime,
      sleep: async (delayMs) => {
        currentTime += delayMs;
      },
    }),
    (error) => {
      assert(error instanceof HostedCleanupError);
      assert.equal(error.code, "CLEANUP_VERIFICATION_TIMEOUT");
      assert.equal(error.handoffRequired, true);
      assert.match(
        error.message,
        /did not return 404.*owner handoff is required/,
      );
      return true;
    },
  );

  assert.deepEqual(statuses, [200, 200, 200]);
});

test("preserves run evidence when 404 verification times out", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hosted-cleanup-"));
  let currentTime = 0;
  const client = fakeClient({ responses: [{ status: 200 }, { status: 200 }] });

  await assert.rejects(
    cleanupHostedRepository({
      client,
      owner: "example-owner",
      repo: "disposable-fork",
      runUrls: ["https://github.com/example-owner/project/actions/runs/654"],
      evidencePath: join(directory, "hosted-verification.json"),
      timeoutMs: 5,
      intervalMs: 5,
      now: () => currentTime,
      sleep: async (delayMs) => {
        currentTime += delayMs;
      },
    }),
    (error) => {
      assert.equal(error.code, "CLEANUP_VERIFICATION_TIMEOUT");
      assert.equal(error.handoffRequired, true);
      return true;
    },
  );

  const evidence = await evidenceIn(directory);
  assert.deepEqual(evidence.run_urls, [
    "https://github.com/example-owner/project/actions/runs/654",
  ]);
  assert.equal(evidence.cleanup, undefined);
});

test("does not delete an existing evidence file when a new cleanup cannot start", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hosted-cleanup-"));
  const evidencePath = join(directory, "hosted-verification.json");
  const existingEvidence =
    '{"run_urls":["https://github.com/example-owner/project/actions/runs/789"]}\n';
  await writeFile(evidencePath, existingEvidence);

  await assert.rejects(
    cleanupHostedRepository({
      client: fakeClient(),
      owner: "example-owner",
      repo: "disposable-fork",
      runUrls: ["https://github.com/example-owner/project/actions/runs/999"],
      evidencePath,
    }),
  );

  assert.equal(await readFile(evidencePath, "utf8"), existingEvidence);
});