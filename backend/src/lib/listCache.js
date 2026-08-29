// Caché en memoria de las listas grandes (quotes, work_orders). La base está en Railway, al otro
// lado de internet: cada list() son ~4.600 filas viajando por la red, y las pantallas la piden en
// cada clic (paginar, filtrar, entrar al dashboard). Un solo proceso escribe en esas tablas —este
// mismo servidor—, así que invalidar en cada escritura del store mantiene la lectura al día: el
// usuario ve su propio guardado al instante. El TTL es la red de seguridad para lo que escribe
// fuera del proceso (scripts one-off contra la base): acota esa desincronización a medio minuto.
//
// Se cachea la PROMESA, no el resultado: si el dashboard, el header y una tabla piden la lista a
// la vez durante la carga de una página, las tres esperan la misma consulta en vez de disparar
// tres viajes idénticos a Railway.
const TTL_MS = 30_000;
const entries = new Map(); // key -> { promise, at }

function get(key, loader) {
  const hit = entries.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.promise;
  const promise = loader().catch((err) => {
    // Un fallo no se cachea: la siguiente petición reintenta la consulta.
    entries.delete(key);
    throw err;
  });
  entries.set(key, { promise, at: Date.now() });
  return promise;
}

function invalidate(...keys) {
  for (const key of keys) entries.delete(key);
}

module.exports = { get, invalidate };
