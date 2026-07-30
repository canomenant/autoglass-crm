const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const UPLOADS_ROOT = path.join(__dirname, "..", "..", "..", "public", "uploads");

const DATA_URI_RE = /^data:image\/([a-zA-Z0-9.+-]+);base64,(.+)$/;

// Decodes a base64 data URI and writes it to backend/public/uploads/<entity>/<id>/<field>/<uuid>.<ext>.
// Returns the relative /uploads path. Non-data-URI strings (already a real URL, or empty) pass through unchanged.
function extract(dataUri, entity, id, field) {
  if (!dataUri || typeof dataUri !== "string") return dataUri;
  const match = dataUri.match(DATA_URI_RE);
  if (!match) return dataUri;

  const [, subtype, base64Data] = match;
  const ext = subtype === "jpeg" ? "jpg" : subtype.split("+")[0];
  const dir = path.join(UPLOADS_ROOT, String(entity), String(id), String(field));
  fs.mkdirSync(dir, { recursive: true });

  const fileName = `${crypto.randomUUID()}.${ext}`;
  fs.writeFileSync(path.join(dir, fileName), Buffer.from(base64Data, "base64"));

  return `/uploads/${entity}/${id}/${field}/${fileName}`;
}

// Applies extract() to every {name, url} entry in an array, returning a new array with url rewritten.
function extractArray(items, entity, id, field) {
  if (!Array.isArray(items)) return items;
  return items.map((item) => ({ ...item, url: extract(item?.url, entity, id, field) }));
}

module.exports = { extract, extractArray };
