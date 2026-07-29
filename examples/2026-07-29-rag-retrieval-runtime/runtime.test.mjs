import test from "node:test";
import assert from "node:assert/strict";

import {
  EmbeddingStub,
  InMemoryVectorStore,
  RagRuntime,
  chunkMarkdownBySection,
  chunkMarkdownForIndex,
  parseMarkdown,
  selectByDistance
} from "./runtime.mjs";

const documents = [
  { id: "refund-general", text: "普通商品退款期限为付款后 30 天。" },
  { id: "refund-custom", text: "定制商品不支持退款。" },
  {
    id: "auth-403",
    text: "ERR_AUTH_403 表示当前用户没有访问权限，需要检查授权配置。"
  },
  { id: "streaming", text: "SSE 流式输出可以降低用户看到首字的延迟。" }
];

test("candidateK 控制候选数，finalK 控制进入 LLM 的片段数", () => {
  const runtime = new RagRuntime({ documents });
  const result = runtime.retrieve("如何排查权限问题？", {
    candidateK: 3,
    finalK: 2
  });

  assert.equal(result.semanticHits.length, 3);
  assert.equal(result.finalChunks.length, 2);
});

test("关键词精确命中错误码，Embedding 匹配自然语言含义", () => {
  const runtime = new RagRuntime({ documents });
  const result = runtime.retrieve(
    "接口提示 ERR_AUTH_403，应该怎么排查授权？",
    { candidateK: 3, finalK: 2 }
  );

  assert.equal(result.keywordHits[0].id, "auth-403");
  assert.equal(result.semanticHits[0].id, "auth-403");
  assert.equal(result.finalChunks[0].id, "auth-403");
});

test("文件搜索只返回片段，RAG 还会把问题和片段交给生成器", () => {
  const calls = [];
  const runtime = new RagRuntime({
    documents,
    generate(payload) {
      calls.push(payload);
      return "已生成";
    }
  });

  const fileResults = runtime.fileSearch("定做商品能退钱吗？");
  assert.equal(calls.length, 0);
  assert.equal(fileResults[0].id, "refund-custom");

  const ragResult = runtime.answer("定做商品能退钱吗？");
  assert.equal(calls.length, 1);
  assert.equal(ragResult.generated, "已生成");
  assert.equal(calls[0].question, "定做商品能退钱吗？");
  assert.match(calls[0].context[0], /定制商品/);
});

test("distance 应从小到大排序，方向用反会选中更远片段", () => {
  const hits = [
    { id: "A", distance: 0.12 },
    { id: "B", distance: 0.78 }
  ];

  assert.equal(selectByDistance(hits, 1, "nearest")[0].id, "A");
  assert.equal(selectByDistance(hits, 1, "farthest")[0].id, "B");
});

test("查询模型与索引模型不一致时阻断检索", () => {
  const store = new InMemoryVectorStore();
  const modelA = new EmbeddingStub("embedding-a");
  const modelB = new EmbeddingStub("embedding-b");
  store.addDocuments(documents, modelA);

  assert.throws(
    () =>
      store.search({
        queryVector: modelB.embed("权限错误"),
        queryEmbeddingModel: modelB.modelId,
        limit: 2
      }),
    /Embedding 模型不一致/
  );
});

test("Markdown 按标题切成独立 Chunk，并保留来源、章节和序号", () => {
  const parsed = parseMarkdown({
    source: "refund-policy.md",
    text: `# 退款规则

## 普通商品
普通商品退款期限为付款后 30 天。

## 定制商品
定制商品不支持退款。`
  });
  const chunks = chunkMarkdownBySection(parsed);

  assert.equal(chunks.length, 2);
  assert.deepEqual(chunks[1].metadata, {
    source: "refund-policy.md",
    documentTitle: "退款规则",
    section: "定制商品",
    chunkIndex: 1
  });

  const runtime = new RagRuntime({ documents: chunks });
  const [hit] = runtime.fileSearch("定做商品能退钱吗？", { finalK: 1 });
  assert.equal(hit.metadata.section, "定制商品");
  assert.match(hit.text, /不支持退款/);
});

test("优先按完整句子切分，子 Chunk 继承章节和版本元数据", () => {
  const parsed = parseMarkdown({
    source: "refund-policy.md",
    text: `# 退款规则

## 普通商品
普通商品退款期限为付款后 30 天。

## 售后细则
规则一：退款申请需要提交订单号和付款凭证。规则二：审核通过后，退款将在五个工作日内原路返回。规则三：商品已经使用或损坏时，需要人工复核责任。`
  });
  const chunks = chunkMarkdownForIndex(parsed, {
    documentId: "doc-17",
    indexVersion: "v2",
    maxChars: 55,
    overlapChars: 10
  });
  const ordinaryChunks = chunks.filter(
    (chunk) => chunk.metadata.section === "普通商品"
  );
  const detailChunks = chunks.filter(
    (chunk) => chunk.metadata.section === "售后细则"
  );

  assert.equal(ordinaryChunks.length, 1);
  assert.ok(detailChunks.length > 1);
  assert.ok(detailChunks.every((chunk) => chunk.metadata.indexVersion === "v2"));
  assert.ok(
    detailChunks.every(
      (chunk) => chunk.metadata.parentChunkId === "doc-17:1"
    )
  );
  assert.ok(detailChunks.every((chunk) => /。$/.test(chunk.text)));
  assert.match(detailChunks.map((chunk) => chunk.text).join(""), /使用或损坏时/);
});

test("自然边界切分不会拆断普通长度的错误码", () => {
  const parsed = parseMarkdown({
    source: "errors.md",
    text: `# 错误处理

## 权限错误
遇到系统异常时，请完整保留 ERR_AUTH_403 错误信息。重新登录后仍失败，再联系管理员。`
  });
  const chunks = chunkMarkdownForIndex(parsed, {
    documentId: "doc-errors",
    indexVersion: "v2",
    maxChars: 42,
    overlapChars: 8
  });

  assert.ok(
    chunks.some((chunk) => chunk.text.includes("ERR_AUTH_403")),
    "完整错误码应该留在同一个 Chunk 中"
  );
  assert.ok(chunks.every((chunk) => !/\nE$|^RR_AUTH_403/.test(chunk.text)));
});

test("新版本验证后只检索 v2，并可按文档和版本清理 v1", () => {
  const parsed = parseMarkdown({
    source: "refund-policy.md",
    text: `# 退款规则

## 定制商品
定制商品不支持退款。`
  });
  const v1 = chunkMarkdownForIndex(parsed, {
    documentId: "doc-17",
    indexVersion: "v1"
  });
  const v2 = chunkMarkdownForIndex(parsed, {
    documentId: "doc-17",
    indexVersion: "v2"
  });
  const store = new InMemoryVectorStore();
  const model = new EmbeddingStub();
  store.addDocuments(v1, model);
  store.addDocuments(v2, model);

  store.setActiveIndexVersion("v2");
  const hits = store.search({
    queryVector: model.embed("定做商品能退钱吗？"),
    queryEmbeddingModel: model.modelId,
    limit: 2
  });
  assert.ok(hits.every((hit) => hit.metadata.indexVersion === "v2"));

  assert.equal(
    store.deleteDocumentVersion({
      documentId: "doc-17",
      indexVersion: "v1"
    }),
    1
  );
  assert.equal(
    store.countDocumentVersion({
      documentId: "doc-17",
      indexVersion: "v1"
    }),
    0
  );
  assert.equal(
    store.countDocumentVersion({
      documentId: "doc-17",
      indexVersion: "v2"
    }),
    1
  );
});
