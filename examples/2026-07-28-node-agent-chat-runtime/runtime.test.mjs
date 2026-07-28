import test from "node:test";
import assert from "node:assert/strict";
import { AgentRuntime } from "./runtime.mjs";

test("确认前不执行工具，确认后按完整事件链执行", () => {
  const runtime = new AgentRuntime();
  const waiting = runtime.createRun("记录今天的学习");

  assert.equal(waiting.status, "waiting_confirmation");
  assert.equal(waiting.result, null);
  assert.equal(runtime.toolExecutionCount, 0);
  assert.deepEqual(
    waiting.events.map((event) => event.type),
    ["request.accepted", "model.tool_call", "confirmation.required"]
  );

  const completed = runtime.confirmRun(waiting.id, true);
  assert.equal(completed.status, "completed");
  assert.equal(completed.result.title, "学习记录");
  assert.deepEqual(
    completed.events.map((event) => event.type),
    [
      "request.accepted",
      "model.tool_call",
      "confirmation.required",
      "confirmation.accepted",
      "tool.started",
      "tool.completed",
      "response.output_text.delta",
      "response.completed"
    ]
  );
});

test("重复确认只返回已记录结果，不重复执行工具", () => {
  const runtime = new AgentRuntime();
  const waiting = runtime.createRun("记录幂等测试");

  const first = runtime.confirmRun(waiting.id, true);
  const second = runtime.confirmRun(waiting.id, true);

  assert.deepEqual(second.result, first.result);
  assert.equal(runtime.toolExecutionCount, 1);
  assert.equal(second.events.length, first.events.length);
});
