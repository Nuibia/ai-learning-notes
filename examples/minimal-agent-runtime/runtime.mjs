/**
 * A deliberately small, runnable Agent Runtime.
 *
 * It does not call a real LLM or filesystem. `model.decide()` and `readFile()`
 * are injected so the control loop can be observed and tested deterministically.
 */

export class InvalidModelActionError extends Error {}
export class ToolNotAllowedError extends Error {}
export class TransientToolError extends Error {}
export class MaxRoundsExceededError extends Error {}

/**
 * Validate untrusted model output before the Runtime acts on it.
 */
export function parseModelAction(raw) {
  if (!raw || typeof raw !== "object") {
    throw new InvalidModelActionError("MODEL_ACTION_MUST_BE_AN_OBJECT");
  }

  if (raw.type === "final" && typeof raw.content === "string") {
    return { type: "final", content: raw.content };
  }

  if (
    raw.type === "tool_call" &&
    typeof raw.tool === "string" &&
    raw.args &&
    typeof raw.args === "object" &&
    typeof raw.args.path === "string"
  ) {
    return {
      type: "tool_call",
      tool: raw.tool,
      args: { path: raw.args.path },
    };
  }

  throw new InvalidModelActionError("MODEL_ACTION_HAS_INVALID_SHAPE");
}

/**
 * Hard Runtime guardrails: the model cannot choose a different tool, directory,
 * or file type merely by returning a plausible JSON object.
 */
export function validateReadFileCall(action) {
  if (action.type !== "tool_call" || action.tool !== "read_file") {
    throw new ToolNotAllowedError("TOOL_NOT_ALLOWED");
  }

  const { path } = action.args;
  if (!path.startsWith("/knowledge/")) {
    throw new ToolNotAllowedError("PATH_NOT_ALLOWED");
  }

  if (!path.endsWith(".md")) {
    throw new ToolNotAllowedError("FILE_TYPE_NOT_ALLOWED");
  }
}

async function executeWithRetry(readFile, path, maxToolRetries) {
  for (let retry = 0; retry <= maxToolRetries; retry += 1) {
    try {
      return await readFile(path);
    } catch (error) {
      const canRetry = error instanceof TransientToolError;
      const hasRetriesLeft = retry < maxToolRetries;

      if (!canRetry || !hasRetriesLeft) {
        throw error;
      }
    }
  }

  // The loop either returns or throws. This is unreachable, but keeps the
  // function's contract explicit if the loop changes later.
  throw new Error("UNREACHABLE");
}

/**
 * @param {{
 *   goal: string,
 *   model: { decide(messages: Array<{role: string, content: string}>): Promise<unknown> },
 *   readFile(path: string): Promise<string>,
 *   maxRounds?: number,
 *   maxToolRetries?: number,
 * }} options
 */
export async function runAgent({
  goal,
  model,
  readFile,
  maxRounds = 3,
  maxToolRetries = 2,
}) {
  const messages = [{ role: "user", content: goal }];

  for (let round = 0; round < maxRounds; round += 1) {
    // The model sees only the messages that the Runtime sends here.
    const rawAction = await model.decide(messages);
    const action = parseModelAction(rawAction);

    if (action.type === "final") {
      return action.content;
    }

    validateReadFileCall(action);
    const toolResult = await executeWithRetry(
      readFile,
      action.args.path,
      maxToolRetries,
    );

    // Preserve both cause (assistant Tool Call) and effect (tool result).
    messages.push({ role: "assistant", content: JSON.stringify(action) });
    messages.push({ role: "tool", content: toolResult });
  }

  throw new MaxRoundsExceededError("MAX_ROUNDS_EXCEEDED");
}
