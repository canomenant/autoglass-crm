const { loadOrSeed, save, nextIdFrom } = require("../lib/persistence");

const FILE = "attachments.json";
let attachments = loadOrSeed(FILE, () => []);
let nextId = nextIdFrom(attachments);

function persist() {
  save(FILE, attachments);
}

function list({ relatedType, relatedId } = {}) {
  return attachments.filter(
    (a) => (!relatedType || a.relatedType === relatedType) && (!relatedId || a.relatedId === Number(relatedId))
  );
}

function create(data) {
  const attachment = {
    id: nextId,
    relatedType: data.relatedType || "",
    relatedId: data.relatedId ?? null,
    fileName: data.fileName || "",
    url: data.url || "",
    uploadedAt: new Date().toISOString(),
  };
  attachments.push(attachment);
  nextId += 1;
  persist();
  return attachment;
}

function remove(id) {
  const index = attachments.findIndex((a) => a.id === Number(id));
  if (index === -1) return false;
  attachments.splice(index, 1);
  persist();
  return true;
}

module.exports = { list, create, remove };
