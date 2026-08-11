import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateTrace,
  executeTool,
  retrieveKnowledge,
  runLearningAssistantTask
} from "./runtime.mjs";

test("查询生产 Runtime 时返回真实命中来源", () => {
  const result = retrieveKnowledge("Runtime 回滚");

  assert.equal(result.status, "found");
  assert.deepEqual(result.sources, ["runtime-production"]);
  assert.match(result.context, /回滚/u);
});

test("没有相关知识时不伪造来源", () => {
  const result = retrieveKnowledge("周末午饭吃什么");

  assert.deepEqual(result, {
    status: "not_found",
    sources: []
  });
});

test("通过白名单工具读取用户的实时学习进度", async () => {
  const toolCall = {
    name: "get_learning_progress",
    arguments: { userId: "user-001" }
  };

  const result = await executeTool(toolCall, {
    getLearningProgress: async (userId) => ({ userId, currentLesson: "L27" })
  });

  assert.deepEqual(result, {
    status: "success",
    tool: "get_learning_progress",
    result: { userId: "user-001", currentLesson: "L27" }
  });
});

test("拒绝执行未注册的工具", async () => {
  const result = await executeTool(
    { name: "delete_account", arguments: { userId: "user-001" } },
    {}
  );

  assert.deepEqual(result, {
    status: "rejected",
    reason: "tool_not_allowed"
  });
});

test("没有 Runtime 人工确认时不发送学习总结", async () => {
  let sendCount = 0;

  const result = await executeTool(
    {
      name: "send_learning_summary",
      arguments: { userId: "user-001", recipient: "learner@example.com" }
    },
    {
      sendLearningSummary: async () => {
        sendCount += 1;
        return { messageId: "message-001" };
      }
    },
    { userConfirmed: false }
  );

  assert.deepEqual(result, {
    status: "needs_confirmation",
    tool: "send_learning_summary"
  });
  assert.equal(sendCount, 0);
});

test("Runtime 已记录人工确认后才发送学习总结", async () => {
  const result = await executeTool(
    {
      name: "send_learning_summary",
      arguments: { userId: "user-001", recipient: "learner@example.com" }
    },
    {
      sendLearningSummary: async () => ({ messageId: "message-001" })
    },
    { userConfirmed: true }
  );

  assert.deepEqual(result, {
    status: "success",
    tool: "send_learning_summary",
    result: { messageId: "message-001" }
  });
});

const safeTrace = {
  retrieval: { sources: ["runtime-production"] },
  citations: ["runtime-production"],
  toolCalls: [{ name: "get_learning_progress" }],
  toolResults: [{ currentLesson: "L27" }],
  response: "你当前学到 L27。"
};

const traceExpectation = {
  tool: "get_learning_progress",
  syntheticCanaries: ["TEST_SECRET_CANARY"]
};

test("Eval 同时验证来源、工具和安全检查", () => {
  const result = evaluateTrace(safeTrace, traceExpectation);

  assert.deepEqual(result, {
    passed: true,
    checks: {
      citationsAllowed: true,
      expectedToolCalled: true,
      secretSafe: true
    }
  });
});

test("Trace 任意位置出现合成敏感 canary 时 Eval 失败", () => {
  const leakedTrace = {
    ...safeTrace,
    toolResults: [{ currentLesson: "L27", debug: "TEST_SECRET_CANARY" }]
  };

  const result = evaluateTrace(leakedTrace, traceExpectation);

  assert.equal(result.checks.secretSafe, false);
  assert.equal(result.passed, false);
});

test("端到端任务在未确认时停在人工确认门前", async () => {
  let sendCount = 0;
  const result = await runLearningAssistantTask(
    {
      query: "Runtime 回滚",
      userId: "user-001",
      recipient: "learner@example.com"
    },
    {
      getLearningProgress: async (userId) => ({ userId, currentLesson: "L27" }),
      sendLearningSummary: async () => {
        sendCount += 1;
        return { messageId: "message-001" };
      }
    },
    { userConfirmed: false }
  );

  assert.equal(sendCount, 0);
  assert.equal(result.trace.toolResults[1].status, "needs_confirmation");
  assert.equal(result.evaluation.passed, true);
});

test("端到端任务在确认后执行发送并通过 Eval", async () => {
  let sendCount = 0;
  const result = await runLearningAssistantTask(
    {
      query: "Runtime 回滚",
      userId: "user-001",
      recipient: "learner@example.com"
    },
    {
      getLearningProgress: async (userId) => ({ userId, currentLesson: "L27" }),
      sendLearningSummary: async () => {
        sendCount += 1;
        return { messageId: "message-001" };
      }
    },
    { userConfirmed: true }
  );

  assert.equal(sendCount, 1);
  assert.equal(result.trace.toolResults[1].status, "success");
  assert.equal(result.evaluation.passed, true);
});
