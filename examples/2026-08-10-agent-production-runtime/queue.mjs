export function createJobQueue({ alertAfterFailures = 2 } = {}) {
  const pending = [];
  const jobs = new Map();
  const alerts = [];
  let nextJobId = 1;
  let consecutiveFailures = 0;

  function enqueue(task) {
    const job = {
      id: `job-${nextJobId++}`,
      task,
      status: "queued"
    };
    pending.push(job.id);
    jobs.set(job.id, job);
    return { jobId: job.id, status: job.status };
  }

  async function processNext(worker) {
    const jobId = pending.shift();
    if (!jobId) return null;

    const job = jobs.get(jobId);
    job.status = "running";

    try {
      job.result = await worker(job.task);
      job.status = "completed";
      consecutiveFailures = 0;
    } catch (error) {
      job.status = "failed";
      job.error = error.message;
      consecutiveFailures += 1;

      if (consecutiveFailures >= alertAfterFailures) {
        alerts.push({
          type: "consecutive_worker_failures",
          count: consecutiveFailures,
          lastJobId: job.id
        });
      }
    }

    return { ...job };
  }

  function snapshot() {
    return {
      pendingCount: pending.length,
      jobs: [...jobs.values()].map((job) => ({ ...job })),
      alerts: alerts.map((alert) => ({ ...alert }))
    };
  }

  return { enqueue, processNext, snapshot };
}
