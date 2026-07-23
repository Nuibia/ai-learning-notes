function decide(userInput) {
    if (userInput === "list projects") {
        return { type: "tool_call", callId: "call-1", name: "list_projects" };
    }
    if (userInput === "get missing") {
        return { type: "tool_call", callId: "call-2", name: "get_project", id: "missing" };
    }
    if (userInput === "create demo") {
        return { type: "tool_call", callId: "call-3", name: "create_project", projectName: "demo" };
    }
    return { type: "final", text: "我目前只会列出项目。" };
}
function listProjects() {
    return ["agent-lab", "docs"];
}
function createProject(projectName) {
    return projectName;
}
function getProject(id) {
    return listProjects().find((project) => project === id);
}
function continueAfterTool(result) {
    const text = result.kind === "projects"
        ? `找到 ${result.projects.length} 个项目：${result.projects.join("、")}。`
        : `已创建项目：${result.projectName}。`;
    return {
        event: "model.final",
        detail: { type: "final", text }
    };
}
function receive(decision, confirmed, role) {
    if (decision.type === "tool_call" && decision.name === "list_projects") {
        return {
            event: "tool.result",
            detail: { callId: decision.callId, kind: "projects", projects: listProjects() }
        };
    }
    if (decision.type === "tool_call" && decision.name === "get_project") {
        const project = getProject(decision.id);
        if (!project) {
            return { event: "tool.error", detail: { callId: decision.callId, code: "PROJECT_NOT_FOUND" } };
        }
        return { event: "tool.result", detail: { callId: decision.callId, kind: "projects", projects: [project] } };
    }
    if (decision.type === "tool_call" && decision.name === "create_project") {
        if (confirmed) {
            if (role !== "editor") {
                return { event: "tool.refused", detail: { callId: decision.callId, code: "ROLE_VIEWER" } };
            }
            return {
                event: "tool.result",
                detail: { callId: decision.callId, kind: "created", projectName: createProject(decision.projectName) }
            };
        }
        return {
            event: "runtime.confirmation_required",
            detail: { callId: decision.callId, operation: "create_project" }
        };
    }
    return { event: "runtime.no_tool", detail: decision };
}
const confirmed = process.argv.includes("--confirm");
const role = process.argv.find((argument) => argument.startsWith("--role="))?.replace("--role=", "") ?? "editor";
const userInput = process.argv
    .slice(2)
    .filter((argument) => argument !== "--confirm" && !argument.startsWith("--role="))
    .join(" ");
if (!userInput) {
    console.error('Usage: npm run demo -- "list projects"');
    process.exitCode = 1;
}
else {
    const output = receive(decide(userInput), confirmed, role);
    console.log(JSON.stringify(output));
    if (output.event === "tool.result") {
        const finalOutput = continueAfterTool(output.detail);
        console.log(JSON.stringify(finalOutput));
        console.log(JSON.stringify({ event: "runtime.completed", detail: finalOutput.detail }));
    }
    if (output.event === "tool.error") {
        console.log(JSON.stringify({ event: "runtime.terminal", detail: output.detail }));
    }
    if (output.event === "tool.refused") {
        console.log(JSON.stringify({ event: "runtime.terminal", detail: output.detail }));
    }
    if (output.event === "runtime.confirmation_required") {
        console.log(JSON.stringify({ event: "runtime.terminal", detail: { ...output.detail, code: "AWAITING_USER_CONFIRMATION" } }));
    }
}
export {};
