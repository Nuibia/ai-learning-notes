# Workflow、Router 与 Agent 的选择

这是 2026-08-01 的 L18 学习 Demo。每天维护独立目录，不修改以前日期的案例。

当前完成五块：

1. 当 `kind` 已经是固定枚举时，由 Runtime 的确定性代码选择处理器；
2. 只有自然语言问题时，由语义分类器生成 `kind`，再由 Runtime 校验并选择处理器。
3. Runtime 固定执行“路由 → 加载规则 → 生成回答”的 Workflow；分类和生成步骤可以使用 LLM，但步骤顺序不能由模型改变。
4. Agent Loop 中，模型根据目标与观察结果决定下一工具和结束时机；Runtime 只执行白名单工具并限制最大步数。
5. 根据用户的自然语言流程设计实现报销 Workflow：Runtime 校验 LLM 分类，并在资料缺失或等待确认时阻止创建记录，只有固定条件全部满足才写入。

```bash
node demo.mjs
```

最后一块运行非法类型、资料缺失、等待确认和成功创建四条路径，用 `trace` 与创建次数核验固定 Workflow 的控制权。

## 名词边界

- `Routing`、`Workflow` 与 Agent Loop 是常见架构概念，但不同框架的名称和接口并不统一；这里的 `Router` 只是对路由逻辑的简称，不代表统一标准组件。
- `kind`、`missing_fields`、`waiting_confirmation`、`completed`、`UNKNOWN_REIMBURSEMENT_KIND` 和 `createRecordCalls` 都是本 Demo 自定义的字段、状态值、错误码或变量名，不是模型厂商或社区框架规定的关键词。
- 示例只验证进入 `waiting_confirmation` 时不会创建记录，尚未实现该状态的持久化与恢复。
