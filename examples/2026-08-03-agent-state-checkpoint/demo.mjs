import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DEMO_DIR = dirname(fileURLToPath(import.meta.url));
const CHECKPOINT_PATH = join(DEMO_DIR, "checkpoint.json");
const externalReimbursementRecords = new Map();
let shouldLoseFirstResponse = true;

const ALLOWED_STATUSES = new Set([
  "received",
  "waiting_confirmation",
  "waiting_human_review",
  "executing",
  "completed",
  "cancelled",
  "failed"
]);

export function validateRunState(state) {
  if (!ALLOWED_STATUSES.has(state.status)) {
    throw new Error(`未知状态：${state.status}`);
  }

  if (state.status === "waiting_confirmation" && !state.pendingAction) {
    throw new Error("等待确认时必须保存 pendingAction");
  }

  if (state.status === "waiting_human_review" && !state.humanReview) {
    throw new Error("等待人工处理时必须保存原因和允许动作");
  }

  if (state.status !== "waiting_human_review" && state.humanReview != null) {
    throw new Error("只有 waiting_human_review 状态可以保存 humanReview");
  }

  if (state.status !== "completed" && state.result !== null) {
    throw new Error("只有 completed 状态可以保存最终结果");
  }

  if (state.status !== "failed" && state.error !== null) {
    throw new Error("只有 failed 状态可以保存错误");
  }

  return state;
}

export async function saveCheckpoint(state) {
  const validState = validateRunState(state);
  const temporaryPath = `${CHECKPOINT_PATH}.tmp`;

  await writeFile(temporaryPath, JSON.stringify(validState, null, 2));
  await rename(temporaryPath, CHECKPOINT_PATH);
}

export async function loadCheckpoint() {
  const savedState = JSON.parse(await readFile(CHECKPOINT_PATH, "utf8"));
  return validateRunState(savedState);
}

async function createReimbursementRecord(action, input) {
  const existingResult = externalReimbursementRecords.get(action.idempotencyKey);
  if (existingResult) return existingResult;

  const result = {
    recordId: `reimbursement-${externalReimbursementRecords.size + 1}`,
    amount: input.amount
  };
  externalReimbursementRecords.set(action.idempotencyKey, result);

  if (shouldLoseFirstResponse) {
    shouldLoseFirstResponse = false;
    throw new Error("服务端已创建记录，但响应在返回途中超时");
  }

  return result;
}

function applyHumanDecision(state, decision) {
  if (state.status !== "waiting_human_review") {
    throw new Error("当前状态不接受人工处理");
  }

  if (!state.humanReview.allowedActions.includes(decision)) {
    throw new Error(`不允许的人工操作：${decision}`);
  }

  if (decision === "cancel") {
    return validateRunState({
      ...state,
      status: "cancelled",
      pendingAction: null,
      humanReview: null,
      error: null
    });
  }

  return validateRunState({
    ...state,
    status: "executing",
    humanReview: null,
    error: null
  });
}

const runState = validateRunState({
  runId: "run-demo-001",
  status: "waiting_confirmation",
  input: {
    text: "报销客户现场打车费 6000 元",
    amount: 6000
  },
  intent: {
    type: "submit_reimbursement",
    reimbursementType: "transport"
  },
  pendingAction: {
    type: "create_reimbursement_record",
    requiresConfirmation: true,
    idempotencyKey: "run-demo-001:create_reimbursement_record"
  },
  humanReview: null,
  result: null,
  error: null
});

await saveCheckpoint(runState);
console.log("1. Runtime 已先保存检查点，再通知 UI 需要用户确认。");

const restoredState = await loadCheckpoint();
console.log("2. 模拟 Runtime 重启后恢复：");
console.log(JSON.stringify(restoredState, null, 2));

const executingState = validateRunState({
  ...restoredState,
  status: "executing"
});
await saveCheckpoint(executingState);

try {
  await createReimbursementRecord(executingState.pendingAction, executingState.input);
} catch (error) {
  await saveCheckpoint(validateRunState({
    ...executingState,
    status: "failed",
    error: {
      code: "TOOL_RESPONSE_TIMEOUT",
      message: error.message
    }
  }));
  console.log("3. 工具响应超时，Runtime 保存失败检查点。");
}

const failedState = await loadCheckpoint();
const humanReviewState = validateRunState({
  ...failedState,
  status: "waiting_human_review",
  humanReview: {
    reason: "资金操作的外部结果不明确，自动重试策略要求人工确认",
    allowedActions: ["retry_same_action", "cancel"]
  },
  error: null
});
await saveCheckpoint(humanReviewState);
console.log("4. Runtime 保存人工处理点，UI 只负责展示允许的操作。");

const restoredHumanReviewState = await loadCheckpoint();
const resumedExecutingState = applyHumanDecision(
  restoredHumanReviewState,
  "retry_same_action"
);
await saveCheckpoint(resumedExecutingState);

const recoveredResult = await createReimbursementRecord(
  resumedExecutingState.pendingAction,
  resumedExecutingState.input
);
const completedState = validateRunState({
  ...resumedExecutingState,
  status: "completed",
  pendingAction: null,
  result: recoveredResult,
  error: null
});
await saveCheckpoint(completedState);

console.log("5. 人工批准后，Runtime 使用同一个幂等键恢复：");
console.log(JSON.stringify(completedState, null, 2));
console.log(`服务端报销记录数：${externalReimbursementRecords.size}`);

try {
  applyHumanDecision(completedState, "cancel");
} catch (error) {
  console.log(`6. Runtime 拒绝另一个旧页面迟到的取消操作：${error.message}`);
}
