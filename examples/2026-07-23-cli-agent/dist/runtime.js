export function receive(decision) {
    if (decision.type === "tool_call" && decision.name === "list_projects") {
        return { event: "runtime.accepted_call", detail: decision };
    }
    return { event: "runtime.no_tool", detail: decision };
}
