# L14-L15：RAG 检索、Chunk 与索引 Runtime

这是一个无第三方依赖的可运行 Demo，用来观察 RAG 的核心数据流：

```text
源文档
  → Embedding 模型生成文档向量
  → 向量索引

用户问题
  → Runtime 生成查询向量
  → 关键词检索 + 向量检索
  → 合并候选
  → 截取最终片段
  → 用户问题 + 最终片段交给 LLM
```

## 运行

```bash
node demo.mjs
node --test runtime.test.mjs
```

## Demo 验证什么

- 工具名或功能名叫“文件搜索”，不代表它就是 RAG；
- 只展示检索结果是搜索，把片段交给 LLM 生成回答才进入 RAG；
- `candidateK` 控制每路检索器返回的候选数量；
- `finalK` 控制最终进入 LLM 上下文的片段数量；
- `distance` 通常越小越近，排序方向用反会造成召回失败；
- 切换 Embedding 模型后，旧索引不能直接与新查询向量混用；
- 精确错误码适合关键词检索，自然语言含义适合语义检索。
- Markdown 先按标题保留业务结构，再按完整句子组合 Chunk；
- 固定字符切分可能截断词语和错误码，只作为异常超长单元的兜底；
- Chunk 规则变化后，需要重新计算 Embedding 并建立新索引；
- 新索引先构建和验证，再切换 activeVersion，最后清理旧版本；
- `documentId`、`indexVersion`、`section` 等 metadata 支持追踪、过滤和清理。

## 为什么没有调用真实 Embedding 和 LLM

本章要验证的是 Runtime 的职责和失败边界，而不是比较模型效果。为了让结果可重复、无需 API Key，`EmbeddingStub` 用人工规则把少量近义词映射到相同维度，生成器 Stub 只打印真正会交给 LLM 的输入。

这意味着：

- Demo 展示的控制流、Top-K 和模型版本校验可以作为工程证据；
- Stub 的向量不能代表真实 Embedding 模型质量；
- 接入真实模型时，应替换 `EmbeddingStub`，并重新生成全部文档向量。

## 文件职责

- `runtime.mjs`：Embedding Stub、内存向量库、关键词检索、文档解析、Chunk 和 RAG Runtime；
- `demo.mjs`：打印文件搜索、RAG 输入、Top-K、文档切分、索引切换与清理结果；
- `runtime.test.mjs`：固定上述行为的机器证据。

## 证据边界

Demo 由 AI 生成，运行与测试结果属于工程证据，不会自动成为学习者的掌握证据。学习证据仍来自学习者对代码的预测、检查、修改和解释。
