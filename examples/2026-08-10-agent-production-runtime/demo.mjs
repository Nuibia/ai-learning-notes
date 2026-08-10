import { pathToFileURL } from "node:url";

function callEmailProvider({ authorization, message }) {
  return {
    accepted: authorization.startsWith("Bearer "),
    messageId: `demo-${message.length}`
  };
}

export function runAgent({ input = "发送周报", env = process.env } = {}) {
  const modelContext = {
    input,
    availableTools: ["send_email"]
  };

  const token = env.DEMO_EMAIL_TOKEN;
  if (!token) {
    return {
      status: "configuration_error",
      modelContext,
      publicTrace: {
        stage: "runtime_secret_lookup",
        secretSource: "environment",
        secretValue: "[REDACTED]"
      }
    };
  }

  const toolResult = callEmailProvider({
    authorization: `Bearer ${token}`,
    message: input
  });

  return {
    status: "completed",
    modelContext,
    toolResult,
    publicTrace: {
      stage: "tool_transport",
      secretSource: "environment",
      secretInjectedBy: "runtime",
      secretValue: "[REDACTED]"
    }
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(runAgent(), null, 2));
}
