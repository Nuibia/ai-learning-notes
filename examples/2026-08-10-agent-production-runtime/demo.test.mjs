import assert from "node:assert/strict";
import test from "node:test";

import { runAgent } from "./demo.mjs";

test("缺少 Runtime secret 时明确失败", () => {
  const result = runAgent({ env: {}, input: "发送周报" });

  assert.equal(result.status, "configuration_error");
  assert.equal(result.publicTrace.secretValue, "[REDACTED]");
});

test("secret 只在工具边界注入且不进入公开结果", () => {
  const secret = "local-demo-secret";
  const result = runAgent({
    env: { DEMO_EMAIL_TOKEN: secret },
    input: "发送周报"
  });
  const serialized = JSON.stringify(result);

  assert.equal(result.status, "completed");
  assert.equal(result.toolResult.accepted, true);
  assert.equal(result.publicTrace.secretInjectedBy, "runtime");
  assert.equal(serialized.includes(secret), false);
  assert.equal("token" in result.modelContext, false);
});
