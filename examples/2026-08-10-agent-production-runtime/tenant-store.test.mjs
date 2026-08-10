import assert from "node:assert/strict";
import test from "node:test";

import { createTenantStore } from "./tenant-store.mjs";

test("相同会话 ID 在不同租户下不会互相覆盖", () => {
  const store = createTenantStore();
  store.write({
    tenantId: "company-a",
    conversationId: "conversation-1",
    value: { summary: "A 公司的内部计划" }
  });
  store.write({
    tenantId: "company-b",
    conversationId: "conversation-1",
    value: { summary: "B 公司的内部计划" }
  });

  assert.deepEqual(
    store.read({ tenantId: "company-a", conversationId: "conversation-1" }),
    { summary: "A 公司的内部计划" }
  );
  assert.deepEqual(
    store.read({ tenantId: "company-b", conversationId: "conversation-1" }),
    { summary: "B 公司的内部计划" }
  );
});

test("缺少租户身份时拒绝读写", () => {
  const store = createTenantStore();

  assert.throws(
    () => store.read({ conversationId: "conversation-1" }),
    /tenantId and conversationId are required/
  );
});
