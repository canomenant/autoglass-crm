const { loadOrSeed, save, nextIdFrom } = require("../lib/persistence");

// Bitácora de mensajes mandados al CLIENTE desde el CRM (SMS por Twilio): link de pago, petición
// de tarjeta, recibo, factura. Aparte de workOrderNotifications, que es lo que se le manda al
// TÉCNICO y alimenta la columna "notificado" de la lista. Antonio, 19-sep-2026.
// OJO: clave nueva → hay que sembrar customerMessages.json en app_data (scripts/_sembrar-customer-messages.js).

const FILE = "customerMessages.json";
let messages = loadOrSeed(FILE, () => []);
let nextId = nextIdFrom(messages);

function create(data) {
  const m = {
    id: nextId,
    workOrderId: data.workOrderId ?? null,
    workOrderNo: data.workOrderNo || "",
    channel: data.channel || "sms",
    kind: data.kind || "custom",
    to: data.to || "",
    body: String(data.body || "").slice(0, 2000),
    status: data.status || "sent",
    providerId: data.providerId || null,
    error: data.error || null,
    sentBy: data.sentBy || "System",
    sentAt: new Date().toISOString(),
  };
  messages.push(m);
  if (messages.length > 5000) messages = messages.slice(-5000);
  nextId += 1;
  save(FILE, messages);
  return m;
}

function forWorkOrder(workOrderId) {
  return messages.filter((m) => String(m.workOrderId) === String(workOrderId)).sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt));
}

module.exports = { create, forWorkOrder };
