import assert from "node:assert/strict";
import test from "node:test";

import { createAppServer } from "./server.mjs";

async function withServer(env, callback) {
  const server = createAppServer({ env });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  try {
    await callback(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

test("健康检查暴露当前部署版本", async () => {
  await withServer({ RELEASE_VERSION: "v2" }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      status: "ok",
      releaseVersion: "v2"
    });
  });
});

test("缺少秘密时就绪检查失败但不泄漏值", async () => {
  await withServer({}, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/ready`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      status: "configuration_error",
      secretConfigured: false
    });
  });
});

test("HTTP 故障演练返回上一稳定版本", async () => {
  await withServer({ RELEASE_VERSION: "v2" }, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/drill?healthOk=false&errorRate=0.01`
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      action: "rollback",
      activeVersion: "v1",
      rejectedVersion: "v2"
    });
  });
});
