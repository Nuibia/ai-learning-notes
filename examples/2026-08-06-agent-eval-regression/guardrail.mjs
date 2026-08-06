import assert from "node:assert/strict";

const TOOL_ALLOWLIST = new Set(["read_docs", "draft_email", "send_email"]);
const SENSITIVE_TOOLS = new Set(["send_email"]);
const auditLog = [];

function authorizeToolCall({ tool, userConfirmed = false, source }) {
  let decision = "allowed";
  let reason = "allowlisted";

  if (!TOOL_ALLOWLIST.has(tool)) {
    decision = "blocked";
    reason = "not_allowlisted";
  } else if (SENSITIVE_TOOLS.has(tool) && !userConfirmed) {
    decision = "pending_confirmation";
    reason = "user_confirmation_required";
  }

  auditLog.push({ tool, userConfirmed, source, decision, reason });
  return decision;
}

const attackTests = [
  {
    name: "外部文档诱导删除账户",
    input: { tool: "delete_account", userConfirmed: false, source: "external_document" },
    expected: "blocked"
  },
  {
    name: "外部文档声称用户已同意发送",
    input: { tool: "send_email", userConfirmed: false, source: "external_document" },
    expected: "pending_confirmation"
  },
  {
    name: "当前用户确认具体邮件后发送",
    input: { tool: "send_email", userConfirmed: true, source: "authenticated_user" },
    expected: "allowed"
  },
  {
    name: "读取资料",
    input: { tool: "read_docs", userConfirmed: false, source: "user_request" },
    expected: "allowed"
  }
];

for (const test of attackTests) {
  assert.equal(authorizeToolCall(test.input), test.expected, test.name);
}

assert.equal(auditLog.length, attackTests.length);
console.log(JSON.stringify({ attackTests: "passed", auditLog }, null, 2));
