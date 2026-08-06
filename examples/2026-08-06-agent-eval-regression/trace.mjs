import assert from "node:assert/strict";

const trace = {
  traceId: "trace-email-001",
  requestId: "req-email-001",
  input: "请把周报发送给项目组",
  model: "demo-agent-model",
  spans: [
    {
      name: "model_decision",
      status: "ok",
      durationMs: 420,
      inputTokens: 620,
      outputTokens: 38,
      result: { tool: "send_email", args: { group: "project-team" } }
    },
    {
      name: "user_confirmation",
      status: "ok",
      durationMs: 1_850,
      result: { approved: true, tool: "send_email" }
    },
    {
      name: "tool_call",
      tool: "send_email",
      status: "error",
      durationMs: 110,
      idempotencyKey: "mail-weekly-2026-08-06",
      error: {
        code: "RATE_LIMITED",
        httpStatus: 429,
        retryAfterMs: 1_000,
        sideEffectCommitted: false
      }
    }
  ],
  totals: {
    durationMs: 2_380,
    inputTokens: 620,
    outputTokens: 38,
    estimatedCostUsd: 0.0019
  },
  finalStatus: "failed"
};

const unknownPaymentSpan = {
  name: "tool_call",
  tool: "send_payment",
  status: "error",
  error: {
    code: "TIMEOUT",
    sideEffectCommitted: "unknown"
  }
};

function canAutoRetry(span) {
  const retryableError = span.error?.httpStatus === 429;
  const noCommittedSideEffect = span.error?.sideEffectCommitted === false;
  const hasIdempotencyKey = Boolean(span.idempotencyKey);

  return retryableError && noCommittedSideEffect && hasIdempotencyKey;
}

assert.equal(trace.spans[0].status, "ok");
assert.equal(trace.spans[1].result.approved, true);
assert.equal(trace.spans[2].status, "error");
assert.equal(trace.spans[2].error.sideEffectCommitted, false);
assert.equal(canAutoRetry(trace.spans[2]), true, "429 且副作用未提交、有幂等键时应允许自动重试");
assert.equal(canAutoRetry(unknownPaymentSpan), false, "副作用未知且无幂等键时必须禁止自动重试");

console.log(JSON.stringify(trace, null, 2));
