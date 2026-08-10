import assert from "node:assert/strict";
import test from "node:test";

import { evaluateRelease, shouldRollback } from "./rollback.mjs";

const policy = { maxErrorRate: 0.05 };

test("健康且错误率达标时保留候选版本", () => {
  assert.equal(
    shouldRollback({ healthOk: true, errorRate: 0.02 }, policy),
    false
  );
});

test("健康检查失败时回滚到上一稳定版本", () => {
  const result = evaluateRelease({
    stableVersion: "v1",
    candidateVersion: "v2",
    signals: { healthOk: false, errorRate: 0.01 },
    policy
  });

  assert.equal(result.action, "rollback");
  assert.equal(result.activeVersion, "v1");
});

test("错误率超过阈值时回滚到上一稳定版本", () => {
  assert.equal(
    shouldRollback({ healthOk: true, errorRate: 0.12 }, policy),
    true
  );
});
