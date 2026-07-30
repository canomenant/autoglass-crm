const { loadOrSeed, save, nextIdFrom } = require("../lib/persistence");

const FILE = "tableViews.json";
let views = loadOrSeed(FILE, () => []);
let nextId = nextIdFrom(views);

function persist() {
  save(FILE, views);
}

function list(module, userName) {
  return views.filter(
    (v) => v.module === module && (v.scope === "Company" || v.userName === userName)
  );
}

function get(id) {
  return views.find((v) => v.id === Number(id));
}

function create(data, userName) {
  const scope = data.scope === "Company" ? "Company" : "Personal";
  const view = {
    id: nextId,
    module: data.module,
    scope,
    userName: scope === "Personal" ? userName : null,
    viewName: data.viewName || "Untitled View",
    columns: Array.isArray(data.columns) ? data.columns : [],
    isDefault: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  views.push(view);
  nextId += 1;
  persist();
  return view;
}

function update(id, data) {
  const view = get(id);
  if (!view) return null;
  Object.assign(view, {
    viewName: data.viewName ?? view.viewName,
    columns: Array.isArray(data.columns) ? data.columns : view.columns,
    updatedAt: new Date().toISOString(),
  });
  persist();
  return view;
}

function setDefault(id, userName) {
  const view = get(id);
  if (!view) return null;
  views
    .filter((v) => v.module === view.module && v.scope === view.scope && (v.scope === "Company" || v.userName === userName))
    .forEach((v) => {
      v.isDefault = v.id === view.id;
    });
  persist();
  return view;
}

function remove(id) {
  const index = views.findIndex((v) => v.id === Number(id));
  if (index === -1) return false;
  views.splice(index, 1);
  persist();
  return true;
}

module.exports = { list, get, create, update, setDefault, remove };
