import { AgentRuntime } from "./runtime.mjs";

console.log("术语标签：状态名和事件名均为 Demo 自定义；幂等键是通用工程概念。");

function printStep(step, run, runtime) {
  console.log(`\n${step}`);
  console.log(JSON.stringify({
    runStatus: run.status,
    pendingTool: run.pendingIntent?.name ?? null,
    hasToolResult: run.result !== null,
    toolExecutionCount: runtime.toolExecutionCount,
    events: run.events.map((event) => event.type)
  }, null, 2));
}

const runtime = new AgentRuntime();

console.log("0. 初始：没有 run，工具执行次数为 0");
console.log(JSON.stringify({ toolExecutionCount: runtime.toolExecutionCount }, null, 2));

const waiting = runtime.createRun("记录我理解了 Agent Runtime 的职责");
printStep(
  "1. createRun：模型给出 write_note 意图，Runtime 停在人工确认前",
  waiting,
  runtime
);

const firstConfirmation = runtime.confirmRun(waiting.id, true);
printStep(
  "2. 第一次 confirmRun(true)：结果表没有该幂等键，真正执行工具一次",
  firstConfirmation,
  runtime
);

const secondConfirmation = runtime.confirmRun(waiting.id, true);
printStep(
  "3. 第二次 confirmRun(true)：run 已是 completed，函数开头直接返回",
  secondConfirmation,
  runtime
);

console.log("\n结论：第一次确认后计数为 1；第二次确认后仍为 1。");
