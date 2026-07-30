const { loadOrSeed, save, nextIdFrom } = require("../lib/persistence");

const FILE = "workOrderNotifications.json";
let notifications = loadOrSeed(FILE, () => []);
let nextId = nextIdFrom(notifications);

function persist() {
  save(FILE, notifications);
}

const STATUSES = ["Pending", "Sent", "Delivered", "Failed"];

function list(workOrderId) {
  return notifications
    .filter((n) => n.workOrderId === Number(workOrderId))
    .sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt));
}

function latestForWorkOrder(workOrderId) {
  return list(workOrderId)[0] || null;
}

function create(data) {
  const notification = {
    id: nextId,
    workOrderId: Number(data.workOrderId),
    technicianId: data.technicianId ?? null,
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

function latestByWorkOrderIds(workOrderIds) {
  const map = {};
  workOrderIds.forEach((id) => {
    map[id] = latestForWorkOrder(id);
  });
  return map;
}

module.exports = { STATUSES, list, latestForWorkOrder, create, latestByWorkOrderIds };
