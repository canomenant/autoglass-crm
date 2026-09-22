const { loadOrSeed, save, nextIdFrom } = require("../lib/persistence");

// Para qué sirve cada método: "in" el cliente nos paga, "out" nosotros pagamos (técnicos,
// distribuidores, gastos), "both" las dos cosas.
//
// El desplegable de cobro de la orden traía las CUENTAS DE LA EMPRESA —Capital One ****4360,
// Chase, las dos Business Card— que sólo sirven para pagar hacia afuera; ningún cliente ha pagado
// nunca con ellas (Antonio, 21-sep-2026). Con esto cada pantalla ofrece sólo lo suyo.
const DIRECTIONS = ["in", "out", "both"];

// El reparto de lo que ya existía, por nombre. Lo que no esté aquí queda en "both", que no
// esconde nada: sólo lo marcado explícitamente sale de una lista.
const DIRECCION_POR_NOMBRE = {
  "Credit Card": "in",
  "Debit Card": "in",
  "Apple Pay": "in",
  "Google Pay": "in",
  "Tap To Pay": "in",
  "We Have CC In File": "in",
  Insurance: "in",
  "Capital One ****4360": "out",
  Chase: "out",
  "Business Card ****5442": "out",
  "Business Card ****0533": "out",
};

function direccionDe(item) {
  if (DIRECTIONS.includes(item?.direction)) return item.direction;
  return DIRECCION_POR_NOMBRE[item?.name] || "both";
}

const FILE = "paymentMethods.json";
let items = loadOrSeed(FILE, () => [
  { id: 1, name: "Cash" },
  { id: 2, name: "Zelle" },
  { id: 3, name: "PayPal" },
  { id: 4, name: "Venmo" },
  { id: 5, name: "Cash App" },
  { id: 6, name: "Check" },
  { id: 7, name: "ACH Transfer" },
  { id: 8, name: "Bank Transfer" },
  { id: 9, name: "Wire Transfer" },
  { id: 10, name: "Credit Card" },
  { id: 11, name: "Debit Card" },
  { id: 12, name: "Apple Pay" },
  { id: 13, name: "Google Pay" },
  { id: 14, name: "Tap To Pay" },
  { id: 15, name: "Capital One ****4360" },
  { id: 16, name: "Chase" },
  { id: 17, name: "Business Card ****5442" },
  { id: 18, name: "Business Card ****0533" },
]);
let nextId = nextIdFrom(items);

function persist() {
  save(FILE, items);
}

// Siempre con direction resuelta, aunque el registro guardado sea anterior al campo.
function list() {
  return items.map((i) => ({ ...i, direction: direccionDe(i) }));
}

function get(id) {
  const item = items.find((i) => i.id === Number(id));
  return item ? { ...item, direction: direccionDe(item) } : item;
}

function create(data) {
  const item = { id: nextId, name: data.name || "", direction: DIRECTIONS.includes(data.direction) ? data.direction : "both" };
  items.push(item);
  nextId += 1;
  persist();
  return item;
}

function update(id, data) {
  // El registro REAL del arreglo, no la copia que devuelve get(): sobre la copia el cambio se
  // perdía al guardar, y la respuesta salía correcta aunque nada se hubiera escrito.
  const item = items.find((i) => i.id === Number(id));
  if (!item) return null;
  Object.assign(item, {
    name: data.name ?? item.name,
    direction: DIRECTIONS.includes(data.direction) ? data.direction : direccionDe(item),
  });
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

module.exports = { list, get, create, update, remove, DIRECTIONS };
