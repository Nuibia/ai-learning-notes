# L09：无框架 CLI Agent

这是同一个项目的第 5 块积木，所有代码暂时放在 `src/cli.ts`：模型把用户输入变成 `final` 或 `tool_call`，Runtime 接收并白名单校验 `list_projects`，调用只读工具，再把带 `callId` 的结果交回模型；模型据此生成 `final`，Runtime 结束本次 CLI 请求。

```sh
npm run build
npm run demo -- "list projects"
npm run demo -- "get missing"
npm run demo -- "create demo"
npm run demo -- "create demo" --confirm
npm run demo -- "create demo" --confirm --role=viewer
```

`list projects` 输出依次是 `tool.result`、`model.final`、`runtime.completed`，即完整正常路径。

`get missing` 是新增的失败路径：`getProject()` 返回空值，Runtime 输出 `tool.error` 和 `runtime.terminal`；它不会伪造 `model.final`。

`create demo` 是确认路径：模型提出写入意图后，Runtime 输出 `runtime.confirmation_required` 并终止在 `AWAITING_USER_CONFIRMATION`。虽然代码已有 `createProject()`，但 Runtime 没有独立确认信号时不会调用它，因此没有写入发生。

`create demo --confirm` 把独立确认信号交给 Runtime（不属于模型的 `tool_call` JSON）。Runtime 才调用 `createProject()`，将结果回填给模型，并完成正常结束。

`create demo --confirm --role=viewer` 是拒绝路径：即使用户已确认，Runtime 仍会让工具返回 `ROLE_VIEWER`，然后终止；确认不等于拥有写入权限。
