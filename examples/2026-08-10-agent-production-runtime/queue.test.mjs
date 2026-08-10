import assert from "node:assert/strict";
import test from "node:test";

import { createJobQueue } from "./queue.mjs";

test("入口先排队，worker 再按吞吐处理", async () => {
  const queue = createJobQueue();
  queue.enqueue("生成报告 A");
  queue.enqueue("生成报告 B");

  assert.equal(queue.snapshot().pendingCount, 2);

  await queue.processNext(async (task) => `${task}：完成`);
  assert.equal(queue.snapshot().pendingCount, 1);
  assert.equal(queue.snapshot().jobs[0].status, "completed");
});

test("连续失败达到阈值时产生确定性告警", async () => {
  const queue = createJobQueue({ alertAfterFailures: 2 });
  queue.enqueue("任务 A");
  queue.enqueue("任务 B");
  const failingWorker = async () => {
    throw new Error("provider unavailable");
  };

  await queue.processNext(failingWorker);
  assert.equal(queue.snapshot().alerts.length, 0);

  await queue.processNext(failingWorker);
  assert.equal(queue.snapshot().alerts.length, 1);
  assert.equal(queue.snapshot().alerts[0].type, "consecutive_worker_failures");
});
