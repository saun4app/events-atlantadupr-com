import { test } from "node:test";

test("controlled hosted CI failure for publication verification", () => {
  throw new Error("CONTROLLED_HOSTED_CI_FAILURE");
});
