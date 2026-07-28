import { randomUUID } from "node:crypto";

/**
 * 术语标签：
 * - streaming / waiting_confirmation / executing / completed：Demo 自定义状态；
 * - request.accepted / confirmation.required 等：Demo 自定义事件；
 * - pendingIntent：Demo 自定义字段；
 * - 幂等键：通用工程概念，但 idempotencyKey 字段名由本 Demo 自定义。
 *
 * 本文件使用 Fake Model，不调用 DeepSeek，也不实现任何社区 Agent 标准协议。
 */

function clone(value) {
  return structuredClone(value);
}

export class AgentRuntime {
  #runs = new Map();
  #listeners = new Map();
  #toolResults = new Map();
  #toolExecutionCount = 0;

  get toolExecutionCount() {
    return this.#toolExecutionCount;
  }

  createRun(userMessage) {
    const run = {
      id: randomUUID(),
      status: "streaming",
      userMessage,
      pendingIntent: null,
      idempotencyKey: null,
      result: null,
      events: []
    };
    this.#runs.set(run.id, run);

    this.#emit(run, "request.accepted", { userMessage });
    const modelOutput = this.#fakeModel(userMessage);
    this.#emit(run, "model.tool_call", { intent: modelOutput });

    // Runtime 在通知 UI 前，先把确认所需事实写入当前进程的状态。
    run.status = "waiting_confirmation";
    run.pendingIntent = modelOutput;
    run.idempotencyKey = `${run.id}:${modelOutput.name}`;
    this.#emit(run, "confirmation.required", {
      tool: modelOutput.name,
      arguments: modelOutput.arguments
    });

    return this.getRun(run.id);
  }

  confirmRun(runId, approved) {
    const run = this.#mustGetRun(runId);

    // 网络重试命中终态时直接返回已记录结果，不重复执行工具。
    if (run.status === "completed") return this.getRun(runId);

    if (run.status !== "waiting_confirmation") {
      throw new Error(`当前状态 ${run.status} 不能处理确认`);
    }

    if (!approved) {
      run.status = "cancelled";
      this.#emit(run, "confirmation.rejected", {});
      this.#emit(run, "response.cancelled", {});
      return this.getRun(runId);
    }

    this.#emit(run, "confirmation.accepted", {});
    run.status = "executing";
    this.#emit(run, "tool.started", { tool: run.pendingIntent.name });

    let result = this.#toolResults.get(run.idempotencyKey);
    if (!result) {
      result = this.#executeTool(run.pendingIntent);
      this.#toolResults.set(run.idempotencyKey, result);
    }

    // 先把工具结果和终态写入当前进程的状态，再向 UI 广播完成事件。
    run.result = result;
    run.status = "completed";
    this.#emit(run, "tool.completed", { result });
    this.#emit(run, "response.output_text.delta", {
      text: `已记录：${result.title}`
    });
    this.#emit(run, "response.completed", {});
    return this.getRun(runId);
  }

  getRun(runId) {
    return clone(this.#mustGetRun(runId));
  }

  subscribe(runId, listener, fromIndex = 0) {
    const run = this.#mustGetRun(runId);
    for (const event of run.events.slice(fromIndex)) listener(clone(event));

    const listeners = this.#listeners.get(runId) ?? new Set();
    listeners.add(listener);
    this.#listeners.set(runId, listeners);
    return () => listeners.delete(listener);
  }

  #fakeModel(userMessage) {
    return {
      name: "write_note",
      arguments: {
        title: "学习记录",
        content: userMessage
      }
    };
  }

  #executeTool(intent) {
    this.#toolExecutionCount += 1;
    return {
      noteId: `note-${this.#toolExecutionCount}`,
      ...intent.arguments
    };
  }

  #mustGetRun(runId) {
    const run = this.#runs.get(runId);
    if (!run) throw new Error(`找不到 run：${runId}`);
    return run;
  }

  #emit(run, type, data) {
    const event = {
      id: run.events.length,
      type,
      data,
      runStatus: run.status
    };
    run.events.push(event);
    for (const listener of this.#listeners.get(run.id) ?? []) {
      listener(clone(event));
    }
  }
}
