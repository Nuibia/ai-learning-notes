# Agent 生产 Runtime

L26「部署与生产化」的当天教学 Demo。它会从一个最小 Runtime 逐步增加秘密管理、限流与超时、队列与告警、数据隔离、回滚演练和可访问环境部署。

当前积木包含两层生产保护：

1. 秘密管理：模型上下文只看到任务和允许工具；Runtime 从环境变量读取凭证，并只在真正调用工具时注入。返回结果和公开 Trace 不包含凭证明文。
2. 限流与超时：请求超过本实例的容量上限时，在调用外部工具前拒绝；已经开始但超过执行时限的工具调用会被终止等待并标记为超时。
3. 队列与告警：入口先把任务登记为 `queued`，worker 按自身吞吐逐个处理；连续失败达到阈值时，由确定性的 Runtime 指标产生告警。
4. 数据隔离：会话 ID 不能单独作为数据边界；Runtime 的所有读写都必须同时携带租户身份，并以“租户 + 会话”组成隔离键。
5. 回滚与故障演练：保留上一稳定版本，对候选版本执行健康检查和错误率检查。回滚条件已由学习者补全，并通过定向故障演练。
6. 可访问部署：`server.mjs` 把健康检查、就绪检查和回滚演练暴露为 HTTP 端点。它用于本机可访问部署，不等同于公网生产发布。

```bash
DEMO_EMAIL_TOKEN=local-demo-secret node demo.mjs
node --test
DEMO_EMAIL_TOKEN=local-demo-secret RELEASE_VERSION=v2 PORT=4173 node server.mjs
```

服务启动后可访问：

```text
http://127.0.0.1:4173/health
http://127.0.0.1:4173/ready
http://127.0.0.1:4173/drill?healthOk=false&errorRate=0.01
```

环境变量中的值仅为本地演示字符串，不要放入真实凭证。
