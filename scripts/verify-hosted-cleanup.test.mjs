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

function fakeClient({ responses, onDelete } = {}) {
  const queue = [...(responses ?? [{ status: 404 }])];
  const calls = [];
  return {
    calls,
    rest: {
      repos: {
        async delete(params) {
          calls.push({ operation: "delete", params });
          await onDelete?.();
          return { status: 204 };
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
  return JSON.parse(await readFile(join(directory, "hosted-verification.json"), "utf8"));
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
    responses: [{ error: Object.assign(new Error("forbidden"), { status: 403 }) }],
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
      assert.match(error.message, /did not return 404.*owner handoff is required/);
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
  const existingEvidence = '{"run_urls":["https://github.com/example-owner/project/actions/runs/789"]}\n';
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