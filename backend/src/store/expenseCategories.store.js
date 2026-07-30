const { loadOrSeed, save, nextIdFrom } = require("../lib/persistence");

const FILE = "expenseCategories.json";
let items = loadOrSeed(FILE, () => [
  { id: 1, name: "Intereses pagados" },
  { id: 2, name: "Combustible para vehículos" },
  { id: 3, name: "Software" },
  { id: 4, name: "Licencias comerciales y permisos" },
  { id: 5, name: "Servicio subcontratado" },
  { id: 6, name: "Comidas" },
  { id: 7, name: "Material de oficina" },
  { id: 8, name: "Servicio de vehículos" },
  { id: 9, name: "Internet" },
  { id: 10, name: "Teléfono" },
  { id: 11, name: "Honorarios de contabilidad" },
  { id: 12, name: "Servicios públicos" },
  { id: 13, name: "Publicidad" },
  { id: 14, name: "Comisiones de cuenta comercial" },
  { id: 15, name: "Salario del empleador" },
  { id: 16, name: "Pago con tarjeta de crédito" },
  { id: 17, name: "Servicio informático" },
  { id: 18, name: "Comisiones bancarias" },
  { id: 19, name: "Piezas y materiales" },
  { id: 20, name: "Herramientas y equipos" },
  { id: 21, name: "Seguro" },
]);
let nextId = nextIdFrom(items);

function persist() {
  save(FILE, items);
}

function list() {
  return items;
}

function get(id) {
  return items.find((i) => i.id === Number(id));
}

function create(data) {
  const item = { id: nextId, name: data.name || "" };
  items.push(item);
  nextId += 1;
  persist();
  return item;
}

function update(id, data) {
  const item = get(id);
  if (!item) return null;
  Object.assign(item, { name: data.name ?? item.name });
  persist();
  return item;
}

function remove(id) {
  const index = items.findIndex((i) => i.id === Number(id));
  if (index === -1) return false;
  items.splice(index, 1);
  persist();
  return true;
}

module.exports = { list, get, create, update, remove };
