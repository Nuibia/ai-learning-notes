import assert from "node:assert/strict";
import test from "node:test";

import {
  InvalidRetryPolicyError,
  MaxRoundsExceededError,
  ToolNotAllowedError,
  TransientToolError,
  runAgent,
} from "./runtime.mjs";
import {
  ToolAuthorizationError,
  UnknownProviderError,
  createReadFileAdapter,
  normalizeHttpProviderError,
} from "./provider-error-adapter.mjs";

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
      model: {
        async decide() {
          return {
            type: "tool_call",
            tool: "delete_file",
            args: { path: "/knowledge/a.md" },
          };
        },
      },
      async readFile() {
        throw new Error("should not run");
      },
    }),
    (error) =>
      error instanceof ToolNotAllowedError &&
      error.message === "TOOL_NOT_ALLOWED",
  );
});

test("Runtime rejects paths and file types outside its hard boundary", async () => {
  for (const path of ["/secret/token.md", "/knowledge/notes.txt"]) {
    await assert.rejects(
      runAgent({
        goal: "读取文件",
        model: {
          async decide() {
            return {
              type: "tool_call",
              tool: "read_file",
              args: { path },
            };
          },
        },
        async readFile() {
          throw new Error("should not run");
        },
      }),
      ToolNotAllowedError,
    );
  }
});

test("Runtime counts the initial call in maxToolAttempts", async () => {
  let attempts = 0;

  const result = await runAgent({
    goal: "读取文件",
    model: {
      async decide() {
        return attempts === 0
          ? {
              type: "tool_call",
              tool: "read_file",
              args: { path: "/knowledge/a.md" },
            }
          : { type: "final", content: "完成" };
      },
    },
    async readFile() {
      attempts += 1;
      if (attempts < 2) throw new TransientToolError("NETWORK_TIMEOUT");
      return "文件内容";
    },
    maxToolAttempts: 2,
  });

  assert.equal(result, "完成");
  assert.equal(attempts, 2);
});

test("Runtime stops after maxToolAttempts transient failures", async () => {
  let attempts = 0;

  await assert.rejects(
    runAgent({
      goal: "读取文件",
      model: {
        async decide() {
          return {
            type: "tool_call",
            tool: "read_file",
            args: { path: "/knowledge/a.md" },
          };
        },
      },
      async readFile() {
        attempts += 1;
        throw new TransientToolError("NETWORK_TIMEOUT");
      },
      maxToolAttempts: 2,
    }),
    TransientToolError,
  );

  assert.equal(attempts, 2);
});

test("Runtime rejects an invalid maxToolAttempts before any model or tool call", async () => {
  for (const maxToolAttempts of [0, -1, 1.5, Number.NaN]) {
    let modelCalls = 0;
    let toolCalls = 0;

    await assert.rejects(
      runAgent({
        goal: "读取文件",
        model: {
          async decide() {
            modelCalls += 1;
            return {
              type: "tool_call",
              tool: "read_file",
              args: { path: "/knowledge/a.md" },
            };
          },
        },
        async readFile() {
          toolCalls += 1;
          return "文件内容";
        },
        maxToolAttempts,
      }),
      (error) =>
        error instanceof InvalidRetryPolicyError &&
        error.message === "MAX_TOOL_ATTEMPTS_MUST_BE_A_POSITIVE_INTEGER",
    );

    assert.equal(modelCalls, 0);
    assert.equal(toolCalls, 0);
  }
});

test("Provider adapter maps HTTP 429 to one bounded transient retry", async () => {
  let providerCalls = 0;

  const result = await runAgent({
    goal: "读取文件",
    model: {
      async decide(messages) {
        return messages.some((message) => message.role === "tool")
          ? { type: "final", content: "完成" }
          : {
              type: "tool_call",
              tool: "read_file",
              args: { path: "/knowledge/a.md" },
            };
      },
    },
    readFile: createReadFileAdapter({
      async providerReadFile() {
        providerCalls += 1;
        if (providerCalls === 1) {
          throw Object.assign(new Error("provider-specific rate limit"), {
            status: 429,
          });
        }
        return "文件内容";
      },
      normalizeError: normalizeHttpProviderError,
    }),
    maxToolAttempts: 2,
  });

  assert.equal(result, "完成");
  assert.equal(providerCalls, 2);
});

test("Provider adapter maps HTTP 403 to a non-retryable authorization error", async () => {
  let providerCalls = 0;

  await assert.rejects(
    runAgent({
      goal: "读取文件",
      model: {
        async decide() {
          return {
            type: "tool_call",
            tool: "read_file",
            args: { path: "/knowledge/a.md" },
          };
        },
      },
      readFile: createReadFileAdapter({
        async providerReadFile() {
          providerCalls += 1;
          throw Object.assign(new Error("provider-specific forbidden"), {
            status: 403,
          });
        },
        normalizeError: normalizeHttpProviderError,
      }),
      maxToolAttempts: 3,
    }),
    ToolAuthorizationError,
  );

  assert.equal(providerCalls, 1);
});

test("Provider adapter keeps an unfamiliar error non-retryable", async () => {
  let providerCalls = 0;

  await assert.rejects(
    runAgent({
      goal: "读取文件",
      model: {
        async decide() {
          return {
            type: "tool_call",
            tool: "read_file",
            args: { path: "/knowledge/a.md" },
          };
        },
      },
      readFile: createReadFileAdapter({
        async providerReadFile() {
          providerCalls += 1;
          throw Object.assign(new Error("new provider failure"), {
            status: 599,
          });
        },
        normalizeError: normalizeHttpProviderError,
      }),
      maxToolAttempts: 3,
    }),
    UnknownProviderError,
  );

  assert.equal(providerCalls, 1);
});

test("Runtime stops after the configured number of model decisions", async () => {
  await assert.rejects(
    runAgent({
      goal: "持续读取",
      model: {
        async decide() {
          return {
            type: "tool_call",
            tool: "read_file",
            args: { path: "/knowledge/a.md" },
          };
        },
      },
      async readFile() {
        return "内容";
      },
      maxRounds: 3,
    }),
    MaxRoundsExceededError,
  );
});
