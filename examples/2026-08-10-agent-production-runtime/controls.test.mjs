import assert from "node:assert/strict";
import test from "node:test";

import { createRuntimeControls } from "./controls.mjs";

test("超过容量上限的请求在工具调用前被限流", async () => {
  const invokeTool = createRuntimeControls({ requestLimit: 1, timeoutMs: 50 });

  assert.equal((await invokeTool()).status, "completed");

  const rejected = await invokeTool();
  assert.equal(rejected.status, "rate_limited");
  assert.equal(rejected.stage, "before_tool_call");
});

test("已经开始但运行过久的工具调用被标记为超时", async () => {
  const invokeTool = createRuntimeControls({ requestLimit: 2, timeoutMs: 10 });

  const result = await invokeTool({ providerDelayMs: 30 });
  assert.equal(result.status, "timed_out");
  assert.equal(result.stage, "during_tool_call");
});
