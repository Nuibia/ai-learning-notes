import {
  END,
  MemorySaver,
  ReducedValue,
  START,
  StateGraph,
  StateSchema
} from "@langchain/langgraph";
import * as z from "zod";

const RunState = new StateSchema({
  runId: z.string(),
  status: z.enum(["waiting_confirmation", "executing", "completed"]),
  amount: z.number(),
  approved: z.boolean(),
  idempotencyKey: z.string(),
  result: z.object({ recordId: z.string(), amount: z.number() }).nullable(),
  trace: new ReducedValue(
    z.array(z.string()).default(() => []),
    {
      inputSchema: z.array(z.string()),
      reducer: (history, updates) => history.concat(updates)
    }
  )
});

function validateApproval(state) {
  if (!state.approved) {
    throw new Error("用户尚未批准，不能执行工具");
  }

  return {
    status: "executing",
    trace: ["validate_approval: waiting_confirmation -> executing"]
  };
}

function executeTool(state) {
  return {
    result: {
      recordId: `reimbursement:${state.idempotencyKey}`,
      amount: state.amount
    },
    trace: ["execute_tool: 使用 Runtime 提供的幂等键调用工具"]
  };
}

function completeRun() {
  return {
    status: "completed",
    trace: ["complete_run: executing -> completed"]
  };
}

const checkpointer = new MemorySaver();
const graph = new StateGraph(RunState)
  .addNode("validate_approval", validateApproval)
  .addNode("execute_tool", executeTool)
  .addNode("complete_run", completeRun)
  .addEdge(START, "validate_approval")
  .addEdge("validate_approval", "execute_tool")
  .addEdge("execute_tool", "complete_run")
  .addEdge("complete_run", END)
  .compile({ checkpointer });

const config = {
  configurable: {
    thread_id: "run-demo-001"
  }
};

const result = await graph.invoke({
  runId: "run-demo-001",
  status: "waiting_confirmation",
  amount: 6000,
  approved: true,
  idempotencyKey: "run-demo-001:create_reimbursement_record",
  result: null,
  trace: []
}, config);

const latestCheckpoint = await graph.getState(config);
const checkpointHistory = [];
for await (const snapshot of graph.getStateHistory(config)) {
  checkpointHistory.push({
    step: snapshot.metadata?.step,
    source: snapshot.metadata?.source,
    status: snapshot.values.status,
    next: snapshot.next
  });
}

console.log("LangGraph 最终状态：");
console.log(JSON.stringify(result, null, 2));
console.log("\n框架保存的最新检查点：");
console.log(JSON.stringify({
  values: latestCheckpoint.values,
  next: latestCheckpoint.next
}, null, 2));
console.log("\nLangGraph 自动保存的检查点历史（从新到旧）：");
console.log(JSON.stringify(checkpointHistory, null, 2));
console.log("\n注意：MemorySaver 只适合本地演示，进程重启后不会保留数据。");
