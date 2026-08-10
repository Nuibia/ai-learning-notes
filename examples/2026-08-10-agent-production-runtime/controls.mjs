import { setTimeout as delay } from "node:timers/promises";

export function createRuntimeControls({ requestLimit = 2, timeoutMs = 25 } = {}) {
  let acceptedRequests = 0;

  return async function invokeTool({ providerDelayMs = 0 } = {}) {
    if (acceptedRequests >= requestLimit) {
      return {
        status: "rate_limited",
        stage: "before_tool_call",
        retryAfterMs: 1_000
      };
    }

    acceptedRequests += 1;

    try {
      await delay(providerDelayMs, undefined, {
        signal: AbortSignal.timeout(timeoutMs)
      });
      return { status: "completed" };
    } catch (error) {
      if (error.name === "AbortError") {
        return {
          status: "timed_out",
          stage: "during_tool_call",
          timeoutMs
        };
      }
      throw error;
    }
  };
}
