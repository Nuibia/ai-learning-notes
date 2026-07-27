import assert from "node:assert/strict";

const restoredSession = {
  sessionId: "demo-session-1",
  phase: "waiting_confirmation",
  pendingAction: { tool: "write_note", payload: { title: "学习记录" } },
  idempotency: { key: "write-note-demo-session-1", previousResult: "not_executed" }
};

const candidateContext = [
  { id: "system-policy", kind: "constraint", tokenWeight: 18, text: "本次 Demo 不得调用外部 API。" },
  { id: "old-chat-1", kind: "chat", tokenWeight: 34, text: "上周聊过电影推荐。" },
  { id: "old-chat-2", kind: "chat", tokenWeight: 29, text: "还讨论过午饭吃什么。" },
  { id: "current-goal", kind: "goal", tokenWeight: 21, text: "恢复本地写入型 Agent 会话。" },
  { id: "waiting-confirmation", kind: "state", tokenWeight: 26, text: "上一次调用停在 waiting_confirmation；尚未获得用户写入确认。" },
  { id: "pending-intent", kind: "intent", tokenWeight: 24, text: "待执行意图：write_note，标题为“学习记录”。" },
  { id: "execution-status", kind: "state", tokenWeight: 16, text: "该待执行意图尚未执行，不能因重启而重复或越权写入。" }
];

function selectModelContext(messages) {
  const effectiveKinds = new Set(["constraint", "goal", "state", "intent"]);
  return messages.filter((message) => effectiveKinds.has(message.kind));
}

function tokenWeight(messages) {
  return messages.reduce((total, message) => total + message.tokenWeight, 0);
}

function runtimeRecoveryState(session) {
  return {
    sessionId: session.sessionId,
    phase: session.phase,
    pendingAction: session.pendingAction,
    idempotencyKey: session.idempotency.key,
    previousResult: session.idempotency.previousResult
  };
}

function verify() {
  const selected = selectModelContext(candidateContext);
  const selectedIds = selected.map((message) => message.id);
  const runtimeState = runtimeRecoveryState(restoredSession);

  assert.deepEqual(selectedIds, ["system-policy", "current-goal", "waiting-confirmation", "pending-intent", "execution-status"]);
  assert.equal(selected.some((message) => message.kind === "chat"), false);
  assert.equal(selected.some((message) => message.id === "waiting-confirmation"), true);
  assert.equal(selected.some((message) => message.id === "pending-intent"), true);
  assert.equal(selected.some((message) => message.id === "execution-status"), true);
  assert.equal(tokenWeight(selected) < tokenWeight(candidateContext), true);
  assert.equal(runtimeState.idempotencyKey, "write-note-demo-session-1");
  assert.equal(runtimeState.previousResult, "not_executed");

  console.log(JSON.stringify({
    fullCandidateContext: { tokenWeight: tokenWeight(candidateContext), ids: candidateContext.map((message) => message.id) },
    modelContext: { tokenWeight: tokenWeight(selected), ids: selectedIds },
    runtimeRecoveryState: runtimeState,
    conclusion: "Runtime 恢复完整会话状态；LLM 接收其中影响下一步判断的语义信息。原始幂等键用于 Runtime，待执行/未执行的事实可成为 LLM 上下文。"
  }, null, 2));
  console.log("通过：重启确认前区分 Runtime 恢复状态与 LLM 有效上下文");
}

verify();
