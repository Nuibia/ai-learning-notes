import assert from "node:assert/strict";

const scenarios = {
  normal: [
    'event: response.created\ndata: {}\n\n',
    'event: output_text.delta\ndata: {"text":"你"}\n\n',
    'event: output_text.delta\ndata: {"text":"好"}\n\n',
    'event: response.completed\ndata: {}\n\n'
  ],
  failed: [
    'event: response.created\ndata: {}\n\n',
    'event: output_text.delta\ndata: {"text":"部分"}\n\n',
    'event: response.failed\ndata: {"error":"上游超时"}\n\n'
  ],
  cancelled: [
    'event: response.created\ndata: {}\n\n',
    'event: output_text.delta\ndata: {"text":"已显示"}\n\n',
    'event: response.cancelled\ndata: {}\n\n'
  ]
};

function parseSseFrame(frame) {
  const lines = frame.trim().split("\n");
  const event = lines.find((line) => line.startsWith("event: "))?.slice(7);
  const data = lines.find((line) => line.startsWith("data: "))?.slice(6);
  assert(event, "SSE 帧缺少 event 字段");
  assert(data, "SSE 帧缺少 data 字段");
  return { type: event, ...JSON.parse(data) };
}

function createView() {
  return { text: "", terminal: null, error: null };
}

function consumeEvent(view, event) {
  switch (event.type) {
    case "response.created":
      assert.equal(view.terminal, null, "终态后不能继续开始同一条流");
      return;
    case "output_text.delta":
      assert.equal(view.terminal, null, "终态后不能继续渲染增量");
      view.text += event.text;
      return;
    case "response.completed":
    case "response.cancelled":
      view.terminal = event.type;
      return;
    case "response.failed":
      view.terminal = event.type;
      view.error = event.error;
      return;
    default:
      throw new Error(`不支持的事件类型：${event.type}`);
  }
}

function runScenario(name, frames) {
  const view = createView();
  for (const frame of frames) {
    const event = parseSseFrame(frame);
    consumeEvent(view, event);
    console.log(JSON.stringify({ scenario: name, event: event.type, view }));
  }
  return view;
}

function verify() {
  const normal = runScenario("normal", scenarios.normal);
  assert.deepEqual(normal, { text: "你好", terminal: "response.completed", error: null });

  const failed = runScenario("failed", scenarios.failed);
  assert.deepEqual(failed, { text: "部分", terminal: "response.failed", error: "上游超时" });

  const cancelled = runScenario("cancelled", scenarios.cancelled);
  assert.deepEqual(cancelled, { text: "已显示", terminal: "response.cancelled", error: null });

  console.log("通过：SSE 增量渲染与三类终态均已独立验证");
}

verify();
