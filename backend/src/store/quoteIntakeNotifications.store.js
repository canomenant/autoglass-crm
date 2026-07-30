const { loadOrSeed, save, nextIdFrom } = require("../lib/persistence");

const FILE = "quoteIntakeNotifications.json";
let notifications = loadOrSeed(FILE, () => []);
let nextId = nextIdFrom(notifications);

function persist() {
  save(FILE, notifications);
}

function list(quoteId) {
  return notifications
    .filter((n) => n.quoteId === Number(quoteId))
    .sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt));
}

function create(data) {
  const notification = {
    id: nextId,
    quoteId: Number(data.quoteId),
    method: data.method || "SMS",
    recipient: data.recipient || "",
    message: data.message || "",
    sentAt: new Date().toISOString(),
    status: "Sent",
  };
  notifications.push(notification);
  nextId += 1;
  persist();
  return notification;
}

module.exports = { list, create };
