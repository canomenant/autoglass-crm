/**
 * Cierra la brecha entre los tecnicos de AppSheet (BD_TEAM.csv, TYPE_TEAM='Tech') y los que
 * existen en la app.
 *
 * Hace tres cosas, todas idempotentes:
 *
 *   1. Normaliza el nombre de las fichas existentes (colapsa espacios repetidos). "Antonio  Cano"
 *      tenia dos espacios, y por eso ninguna de sus 789 ordenes engancho con su ficha: la unica
 *      llave que hubo siempre fue el texto de work_orders.tech comparado contra technicians.name.
 *
 *   2. Crea los tecnicos que nunca se importaron. La siembra original tomo el COMPANY_LABEL de
 *      AppSheet, asi que los tecnicos que trabajan a nombre propio -sin compania- se quedaron
 *      fuera: son 11, con 1,065 ordenes y $118,413.94 de labor a su nombre.
 *
 *   3. Enlaza work_orders.technician_id. La ficha puede llamarse como la compania (Osman Neri
 *      Armira factura como "Jeff Auto Glass") mientras la orden guarda el nombre de la persona,
 *      asi que el enlace se resuelve contra el CSV -que tiene las dos caras- y no por texto.
 *
 * Sin --apply solo reporta.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
require("dotenv").config();
const pool = require("../src/config/db");

/**
 * Tecnicos que AppSheet tiene partidos en varias filas y en realidad son una sola persona.
 *
 * Luis: tres filas creadas con 67 segundos de diferencia el 2026-01-20 —alguien tecleando el mismo
 * nombre tres veces—, "Luis", "Luis ." y "Luis ?". La tercera trae de compania "Tech Part" y de
 * telefono "545454", y de esa compania inventada salio la ficha "Tech Part" que hoy aparece en
 * Settings con cero trabajos: no es un tecnico, es Luis. Se reusa esa ficha en vez de crear otra,
 * porque no tiene nada enganchado y asi el nombre falso desaparece de la lista.
 */
const ALIAS = [
  { canonico: "Luis Almanza", reusarFicha: "Tech Part", nombres: ["Luis", "Luis .", "Luis ?"] },
];
const canonicoDe = (nombre) => {
  const n = (nombre || "").replace(/\s+/g, " ").trim().toLowerCase();
  return ALIAS.find((a) => a.nombres.some((x) => x.toLowerCase() === n))?.canonico || null;
};

const APLICAR = process.argv.includes("--apply");
const CSV_DIR =
  process.argv.find((a) => a.startsWith("--csv="))?.slice(6) ||
  "C:/Users/Antonio Cano/Downloads/Reyes Auto Glass/Reyes Auto Glass/csv";

function parseCsv(texto) {
  const filas = [];
  let campo = "";
  let fila = [];
  let comillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (comillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i++; } else comillas = false;
      } else campo += c;
    } else if (c === '"') comillas = true;
    else if (c === ",") { fila.push(campo); campo = ""; }
    else if (c === "\r") { /* ignora */ }
    else if (c === "\n") { fila.push(campo); filas.push(fila); fila = []; campo = ""; }
    else campo += c;
  }
  if (campo !== "" || fila.length) { fila.push(campo); filas.push(fila); }
  return filas;
}

function leer(archivo) {
  const filas = parseCsv(fs.readFileSync(path.join(CSV_DIR, archivo), "utf8"));
  const cab = filas[0];
  return filas.slice(1).filter((f) => f.length > 2).map((f) => Object.fromEntries(cab.map((h, i) => [h, f[i]])));
}

const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const limpia = (s) => (s || "").replace(/\s+/g, " ").trim();

// AppSheet tiene tres tecnicos distintos llamados "Luis", "Luis ." y "Luis ?" — norm() los colapsa
// en el mismo "luis" y el ultimo se comeria las ordenes de los otros dos. Para la llave persona ->
// ficha se compara sin distinguir mayusculas pero conservando la puntuacion, que aqui es lo unico
// que los separa. norm() se sigue usando para la compania, donde no hay choques.
const llave = (s) => limpia(s).toLowerCase();

// El correo lo genera la app con el mismo patron que ya usan las 15 fichas existentes.
function correoDe(nombre) {
  const base = limpia(nombre).toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/ /g, ".");
  return `${base}@reyesautoglass.com`;
}

async function main() {
  const equipo = leer("BD_TEAM.csv").filter((t) => t.TYPE_TEAM === "Tech");
  const fichas = (await pool.query("SELECT id, name, company_name FROM technicians WHERE active <> false")).rows;

  console.log(`AppSheet: ${equipo.length} tecnicos   |   app: ${fichas.length} fichas\n`);

  // --- 1. nombres con espacios repetidos -------------------------------------------------------
  const sucios = fichas.filter((f) => f.name !== limpia(f.name));
  console.log(`1. NOMBRES A NORMALIZAR: ${sucios.length}`);
  for (const f of sucios) {
    const ordenes = await pool.query(
      "SELECT count(*)::int n FROM work_orders WHERE btrim(tech) = $1 AND technician_id IS NULL",
      [limpia(f.name)]
    );
    console.log(`   "${f.name}" -> "${limpia(f.name)}"   (destraba ${ordenes.rows[0].n} ordenes)`);
    if (APLICAR) await pool.query("UPDATE technicians SET name = $2 WHERE id = $1", [f.id, limpia(f.name)]);
    f.name = limpia(f.name);
  }

  // --- 1b. fichas duplicadas que son una sola persona ------------------------------------------
  console.log(`\n1b. ALIAS A CONSOLIDAR: ${ALIAS.length}`);
  for (const a of ALIAS) {
    const f = fichas.find((x) => llave(x.name) === llave(a.reusarFicha));
    if (!f) { console.log(`   ficha "${a.reusarFicha}" no existe — se creara "${a.canonico}" de cero`); continue; }
    const oblig = await pool.query(
      `SELECT count(*)::int n, coalesce(sum(amount), 0) m FROM payable WHERE kind = 'TECH' AND btrim(party) = ANY($1)`,
      [a.nombres]
    );
    console.log(
      `   "${a.reusarFicha}" -> "${a.canonico}"   absorbe ${a.nombres.join(" / ")}   ` +
      `(${oblig.rows[0].n} obligaciones, $${Number(oblig.rows[0].m).toFixed(2)})`
    );
    if (APLICAR) {
      await pool.query(
        "UPDATE technicians SET name = $2, company_name = '', phone = '', email = $3 WHERE id = $1",
        [f.id, a.canonico, correoDe(a.canonico)]
      );
      // El lote de pago no guarda el nombre: lo lee de sus obligaciones. Renombrar aqui hace que
      // Tech-0257 y Tech-0258 pasen a mostrar "Luis Almanza" sin tocar el importe ni el enlace.
      await pool.query(
        "UPDATE payable SET party = $1, updated_at = now() WHERE kind = 'TECH' AND btrim(party) = ANY($2)",
        [a.canonico, a.nombres]
      );
    }
    f.name = a.canonico;
  }

  // --- 2. tecnicos que faltan ------------------------------------------------------------------
  const trabajos = {};
  for (const w of leer("BD_TECHWO.csv")) {
    const k = w.ID_TEAM;
    if (!trabajos[k]) trabajos[k] = { jobs: 0, labor: 0 };
    trabajos[k].jobs++;
    trabajos[k].labor += Number(String(w.LABOR || "0").replace(/[^0-9.-]/g, "")) || 0;
  }

  const fichaDe = (t) => {
    const persona = limpia(`${t.FIRST_NAME || ""} ${t.LAST_NAME || ""}`);
    const compania = limpia(t.COMPANY_LABEL);
    const alias = canonicoDe(persona);
    return fichas.find(
      (f) =>
        llave(f.name) === llave(persona) ||
        (alias && llave(f.name) === llave(alias)) ||
        (compania && !alias && (norm(f.name) === norm(compania) || norm(f.company_name) === norm(compania)))
    );
  };

  const faltantes = equipo.filter((t) => !fichaDe(t));
  const totalLabor = faltantes.reduce((s, t) => s + (trabajos[t.ID_TEAM]?.labor || 0), 0);
  const totalJobs = faltantes.reduce((s, t) => s + (trabajos[t.ID_TEAM]?.jobs || 0), 0);
  console.log(`\n2. FICHAS A CREAR: ${faltantes.length}   (${totalJobs} trabajos, $${totalLabor.toFixed(2)} de labor)`);

  for (const t of faltantes) {
    const persona = limpia(`${t.FIRST_NAME || ""} ${t.LAST_NAME || ""}`);
    const a = trabajos[t.ID_TEAM] || { jobs: 0, labor: 0 };
    // La tarifa por defecto sale de lo que se le pago en promedio, que es mas util que un cero.
    const tarifa = a.jobs ? Math.round((a.labor / a.jobs) * 100) / 100 : Number(t.LABOR_TECH || 0) || 0;
    console.log(
      `   ${persona.padEnd(26)} tel ${(t.PHONE || "—").padEnd(12)} ${String(a.jobs).padStart(4)} trabajos  ` +
      `$${a.labor.toFixed(2).padStart(10)}  tarifa $${tarifa}`
    );
    if (!APLICAR) continue;
    await pool.query(
      `INSERT INTO technicians (id, name, company_name, phone, mobile, email, password, must_change_password,
         address, city, state, zip_code, status, default_labor_rate, default_commission, active)
       VALUES ($1,$2,$3,$4,$5,$6,'',false,'','','','','Active',$7,0,true)`,
      [crypto.randomUUID(), persona, limpia(t.COMPANY_LABEL), limpia(t.PHONE), limpia(t.ALTERNATIVE_PHONE),
       limpia(t.EMAIL) || correoDe(persona), tarifa]
    );
  }

  // --- 3. enlace de ordenes --------------------------------------------------------------------
  // Se relee para incluir las recien creadas.
  const fichasFinal = APLICAR
    ? (await pool.query("SELECT id, name, company_name FROM technicians WHERE active <> false")).rows
    : fichas;

  const porPersona = new Map();
  for (const t of equipo) {
    const persona = limpia(`${t.FIRST_NAME || ""} ${t.LAST_NAME || ""}`);
    const compania = limpia(t.COMPANY_LABEL);
    const alias = canonicoDe(persona);
    const f =
      (alias && fichasFinal.find((x) => llave(x.name) === llave(alias))) ||
      fichasFinal.find((x) => llave(x.name) === llave(persona)) ||
      // La compania solo sirve de llave cuando la persona no es un alias: "Luis ?" traia de
      // compania "Tech Part", que es justo la ficha falsa que 1b acaba de renombrar.
      (compania && !alias && fichasFinal.find((x) => norm(x.name) === norm(compania) || norm(x.company_name) === norm(compania)));
    if (f) porPersona.set(llave(persona), f);
  }

  const sueltas = await pool.query(
    `SELECT btrim(tech) tech, count(*)::int n FROM work_orders
     WHERE technician_id IS NULL AND coalesce(btrim(tech), '') <> ''
     GROUP BY 1 ORDER BY 2 DESC`
  );

  console.log(`\n3. ORDENES A ENLAZAR:`);
  let enlazadas = 0;
  const sinResolver = [];
  for (const r of sueltas.rows) {
    const f = porPersona.get(llave(r.tech)) || fichasFinal.find((x) => llave(x.name) === llave(r.tech));
    if (!f) { sinResolver.push(r); continue; }
    console.log(`   ${r.tech.padEnd(30)} -> ${f.name.padEnd(30)} ${String(r.n).padStart(4)} ordenes`);
    enlazadas += r.n;
    if (APLICAR) {
      await pool.query("UPDATE work_orders SET technician_id = $1 WHERE btrim(tech) = $2 AND technician_id IS NULL", [f.id, r.tech]);
    }
  }
  console.log(`   ---- ${enlazadas} ordenes enlazadas`);

  if (sinResolver.length) {
    console.log(`\n   SIN RESOLVER (${sinResolver.reduce((s, r) => s + r.n, 0)} ordenes):`);
    sinResolver.forEach((r) => console.log(`     ${r.tech.padEnd(30)} ${String(r.n).padStart(4)}`));
  }

  const vacias = await pool.query(
    "SELECT count(*)::int n FROM work_orders WHERE coalesce(btrim(tech), '') = ''"
  );
  console.log(`\n   (${vacias.rows[0].n} ordenes no tienen tecnico anotado — no hay a que enlazarlas)`);

  console.log(APLICAR ? "\nAPLICADO." : "\nSimulacion. Corre con --apply para escribir.");
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
