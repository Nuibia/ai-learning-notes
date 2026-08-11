import { runLearningAssistantTask } from "./runtime.mjs";

let simulatedSendCount = 0;
const dependencies = {
  getLearningProgress: async (userId) => ({ userId, currentLesson: "L27" }),
  sendLearningSummary: async () => {
    simulatedSendCount += 1;
    return { messageId: `simulated-message-${simulatedSendCount}` };
  }
};
const input = {
  query: "Runtime 回滚",
  userId: "user-001",
  recipient: "learner@example.com"
};

const beforeConfirmation = await runLearningAssistantTask(input, dependencies, {
  userConfirmed: false
});
const afterConfirmation = await runLearningAssistantTask(input, dependencies, {
  userConfirmed: true
});

console.log(JSON.stringify({
  note: "sendLearningSummary 是本地模拟函数，不会发送真实邮件",
  beforeConfirmation,
  afterConfirmation,
  simulatedSendCount
}, null, 2));
