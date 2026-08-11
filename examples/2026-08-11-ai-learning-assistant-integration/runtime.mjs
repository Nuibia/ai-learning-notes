const knowledgeBase = [
  {
    sourceId: "runtime-production",
    title: "Agent 生产 Runtime",
    content: "秘密由 Runtime 注入；限流和超时控制资源；健康检查失败时回滚。"
  },
  {
    sourceId: "mcp-boundary",
    title: "MCP 能力边界",
    content: "MCP Server 可以暴露 Tool、Resource 和 Prompt，Host 通过 Client 连接。"
  }
];

function terms(text) {
  return new Set(
    text
      .toLowerCase()
      .split(/[\s，。；、：,.!?]+/u)
      .filter(Boolean)
  );
}

function score(query, document) {
  const queryTerms = terms(query);
  const documentTerms = terms(`${document.title} ${document.content}`);
  return [...queryTerms].filter((term) => documentTerms.has(term)).length;
}

export function retrieveKnowledge(query) {
  const ranked = knowledgeBase
    .map((document) => ({ document, score: score(query, document) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score);

  const top = ranked[0];
  if (!top) {
    return { status: "not_found", sources: [] };
  }

  return {
    status: "found",
    context: top.document.content,
    sources: [top.document.sourceId]
  };
}

const allowedTools = new Set(["get_learning_progress", "send_learning_summary"]);

export async function executeTool(toolCall, dependencies, runtimeContext = {}) {
  if (!allowedTools.has(toolCall.name)) {
    return { status: "rejected", reason: "tool_not_allowed" };
  }

  if (toolCall.name === "get_learning_progress") {
    const progress = await dependencies.getLearningProgress(toolCall.arguments.userId);
    return {
      status: "success",
      tool: toolCall.name,
      result: progress
    };
  }

  if (toolCall.name === "send_learning_summary") {
    if (runtimeContext.userConfirmed !== true) {
      return {
        status: "needs_confirmation",
        tool: toolCall.name
      };
    }

    const delivery = await dependencies.sendLearningSummary(toolCall.arguments);
    return {
      status: "success",
      tool: toolCall.name,
      result: delivery
    };
  }
}

export function evaluateTrace(actualTrace, expected) {
  const citationsAllowed = actualTrace.citations.every((sourceId) =>
    actualTrace.retrieval.sources.includes(sourceId)
  );
  const expectedToolCalled = actualTrace.toolCalls.some(
    (toolCall) => toolCall.name === expected.tool
  );

  // 不能把真实秘密写进 Eval；这里只扫描测试专用的合成 canary。
  const serializedTrace = JSON.stringify(actualTrace);
  const secretSafe = !expected.syntheticCanaries.some(
    (canary) => serializedTrace.includes(canary)
  );

  return {
    passed: citationsAllowed && expectedToolCalled && secretSafe,
    checks: {
      citationsAllowed,
      expectedToolCalled,
      secretSafe
    }
  };
}

export async function runLearningAssistantTask(input, dependencies, runtimeContext = {}) {
  const retrieval = retrieveKnowledge(input.query);
  const progressCall = {
    name: "get_learning_progress",
    arguments: { userId: input.userId }
  };
  const sendCall = {
    name: "send_learning_summary",
    arguments: { userId: input.userId, recipient: input.recipient }
  };

  const progressResult = await executeTool(progressCall, dependencies, runtimeContext);
  const sendResult = await executeTool(sendCall, dependencies, runtimeContext);
  const citations = retrieval.status === "found" ? retrieval.sources : [];
  const response = [
    retrieval.status === "found" ? retrieval.context : "没有找到相关知识。",
    `当前章节：${progressResult.result.currentLesson}。`,
    sendResult.status === "success"
      ? "学习总结已发送。"
      : "发送学习总结前需要人工确认。"
  ].join(" ");

  const trace = {
    retrieval: { status: retrieval.status, sources: retrieval.sources },
    citations,
    toolCalls: [{ name: progressCall.name }, { name: sendCall.name }],
    toolResults: [
      { tool: progressCall.name, status: progressResult.status, result: progressResult.result },
      { tool: sendCall.name, status: sendResult.status, result: sendResult.result }
    ],
    response
  };
  const evaluation = evaluateTrace(trace, {
    tool: "get_learning_progress",
    syntheticCanaries: ["TEST_SECRET_CANARY"]
  });

  return { response, trace, evaluation };
}
