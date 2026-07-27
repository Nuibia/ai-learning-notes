import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL(".", import.meta.url));
const eventSchema = JSON.parse(readFileSync(new URL("./events.schema.json", import.meta.url)));
const sessionSchema = JSON.parse(readFileSync(new URL("./session.schema.json", import.meta.url)));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function validateEvent(event) {
  assert(event && typeof event === "object", "事件必须是对象");
  assert(eventSchema.properties.type.enum.includes(event.type), `不支持的事件类型：${event.type}`);
  assert(Number.isInteger(event.sequence) && event.sequence > 0, "事件 sequence 必须是正整数");
  for (const key of Object.keys(event)) assert(key in eventSchema.properties, `事件含有未定义字段：${key}`);
  if (event.type === "output_text.delta") assert(typeof event.text === "string", "文本增量事件必须包含 text");
  if (event.type === "tool_call.delta") {
    assert(typeof event.toolName === "string", "工具增量事件必须包含 toolName");
    assert(typeof event.argumentsDelta === "string", "工具增量事件必须包含 argumentsDelta");
  }
  if (event.type === "response.failed") assert(typeof event.error === "string", "失败事件必须包含 error");
}

function validateSession(session) {
  assert(session && typeof session === "object", "会话必须是对象");
  for (const key of sessionSchema.required) assert(key in session, `缺少持久化会话字段：${key}`);
  assert(sessionSchema.properties.phase.enum.includes(session.phase), `无效会话阶段：${session.phase}`);
  assert(typeof session.sessionId === "string" && session.sessionId, "sessionId 不能为空");
  assert(typeof session.idempotencyKey === "string" && session.idempotencyKey, "idempotencyKey 不能为空");
}

function createRuntime() {
  return { text: "", toolArguments: "", terminal: null };
}

function applyEvent(runtime, event) {
  validateEvent(event);
  assert(runtime.terminal === null, "已收到终止事件，不能继续处理增量");
  switch (event.type) {
    case "output_text.delta":
      runtime.text += event.text;
      break;
    case "tool_call.delta":
      runtime.toolArguments += event.argumentsDelta;
      break;
    case "response.completed":
    case "response.cancelled":
    case "response.failed":
      runtime.terminal = event.type;
      break;
  }
  console.log(JSON.stringify({ event, view: { text: runtime.text, toolArguments: runtime.toolArguments, terminal: runtime.terminal } }));
}

function runStream(events) {
  const runtime = createRuntime();
  for (const event of events) applyEvent(runtime, event);
  return runtime;
}

function normalScenario() {
  const result = runStream([
    { type: "response.created", sequence: 1 },
    { type: "output_text.delta", sequence: 2, text: "准备" },
    { type: "tool_call.delta", sequence: 3, toolName: "write_note", argumentsDelta: "{\"title\":\"" },
    { type: "tool_call.delta", sequence: 4, toolName: "write_note", argumentsDelta: "学习记录\"}" },
    { type: "output_text.delta", sequence: 5, text: "写入" },
    { type: "response.completed", sequence: 6 }
  ]);
  assert(result.text === "准备写入", "正常路径必须按事件顺序拼接文本");
  assert(result.terminal === "response.completed", "正常流必须以 completed 结束");
}

function errorScenario() {
  const result = runStream([
    { type: "response.created", sequence: 1 },
    { type: "output_text.delta", sequence: 2, text: "部分结果" },
    { type: "response.failed", sequence: 3, error: "上游超时" }
  ]);
  assert(result.terminal === "response.failed", "错误流不能被标记为成功完成");
}

function cancelledScenario() {
  const result = runStream([
    { type: "response.created", sequence: 1 },
    { type: "output_text.delta", sequence: 2, text: "用户已看到" },
    { type: "response.cancelled", sequence: 3 }
  ]);
  assert(result.terminal === "response.cancelled", "取消事件必须是终止事件");
}

function recoveryScenario() {
  const persistedBeforeRestart = {
    sessionId: "demo-session-1",
    phase: "waiting_confirmation",
    pendingWrite: { tool: "write_note", payload: { title: "学习记录" } },
    idempotencyKey: "write-note-demo-session-1"
  };
  validateSession(persistedBeforeRestart);
  const durableRecord = JSON.stringify(persistedBeforeRestart); // 模拟数据库或文件存储
  const recovered = JSON.parse(durableRecord); // 模拟新进程读取持久化存储
  validateSession(recovered);
  assert(recovered.phase === "waiting_confirmation", "重启后必须保留确认门槛");
  console.log(JSON.stringify({ recovered, action: "ask_user_confirmation_again", actionText: "需要再次请求用户确认", writeExecuted: false }));
}

const scenario = process.argv[2] || "all";
const scenarios = { normal: normalScenario, error: errorScenario, cancel: cancelledScenario, recovery: recoveryScenario };

if (scenario === "all") {
  for (const run of Object.values(scenarios)) run();
  console.log("通过：正常、错误、取消和重启恢复四条路径均已验证");
} else {
  assert(scenario in scenarios, `用法：node ${dir}demo.mjs [all|normal|error|cancel|recovery]`);
  scenarios[scenario]();
  console.log(`通过：${scenario} 场景已验证`);
}
