import assert from "node:assert/strict";
import test from "node:test";

import {
  MaxRoundsExceededError,
  ToolNotAllowedError,
  TransientToolError,
  runAgent,
} from "./runtime.mjs";

test("Runtime returns the tool result to the model as a tool message", async () => {
  const observations = [];
  const actions = [
    {
      type: "tool_call",
      tool: "read_file",
      args: { path: "/knowledge/runtime.md" },
    },
    { type: "final", content: "这是 Runtime 文档的总结。" },
  ];

  const result = await runAgent({
    goal: "读取并总结 Runtime 文档",
    model: {
      async decide(messages) {
        observations.push(structuredClone(messages));
        return actions.shift();
      },
    },
    async readFile() {
      return "Runtime 负责校验并执行 Tool Call。";
    },
  });

  assert.equal(result, "这是 Runtime 文档的总结。");
  assert.deepEqual(observations[0], [
    { role: "user", content: "读取并总结 Runtime 文档" },
  ]);
  assert.deepEqual(observations[1], [
    { role: "user", content: "读取并总结 Runtime 文档" },
    {
      role: "assistant",
      content:
        '{"type":"tool_call","tool":"read_file","args":{"path":"/knowledge/runtime.md"}}',
    },
    { role: "tool", content: "Runtime 负责校验并执行 Tool Call。" },
  ]);
});

test("Runtime rejects a tool that is outside the allowlist before execution", async () => {
  await assert.rejects(
    runAgent({
      goal: "删除文件",
      model: { async decide() { return { type: "tool_call", tool: "delete_file", args: { path: "/knowledge/a.md" } }; } },
      async readFile() { throw new Error("should not run"); },
    }),
    (error) => error instanceof ToolNotAllowedError && error.message === "TOOL_NOT_ALLOWED",
  );
});

test("Runtime rejects paths and file types outside its hard boundary", async () => {
  for (const path of ["/secret/token.md", "/knowledge/notes.txt"]) {
    await assert.rejects(
      runAgent({
        goal: "读取文件",
        model: { async decide() { return { type: "tool_call", tool: "read_file", args: { path } }; } },
        async readFile() { throw new Error("should not run"); },
      }),
      ToolNotAllowedError,
    );
  }
});

test("Runtime retries only a transient tool error, up to the configured limit", async () => {
  let attempts = 0;

  const result = await runAgent({
    goal: "读取文件",
    model: {
      async decide() {
        return attempts === 0
          ? { type: "tool_call", tool: "read_file", args: { path: "/knowledge/a.md" } }
          : { type: "final", content: "完成" };
      },
    },
    async readFile() {
      attempts += 1;
      if (attempts < 3) throw new TransientToolError("NETWORK_TIMEOUT");
      return "文件内容";
    },
  });

  assert.equal(result, "完成");
  assert.equal(attempts, 3);
});

test("Runtime stops after the configured number of model decisions", async () => {
  await assert.rejects(
    runAgent({
      goal: "持续读取",
      model: {
        async decide() {
          return { type: "tool_call", tool: "read_file", args: { path: "/knowledge/a.md" } };
        },
      },
      async readFile() { return "内容"; },
      maxRounds: 3,
    }),
    MaxRoundsExceededError,
  );
});
