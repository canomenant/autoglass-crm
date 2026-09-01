const XLSX = require("xlsx");

// Lee el Excel de statements de Mygrant. El formato lo fija ellos, así que este parser está
// escrito contra sus rarezas reales, no contra un ideal:
//
//   · Los bloques de compra empiezan con "INVOICE" y los de devolución con "CREDIT MEMO".
//     Tratar los segundos como parte del primero pega dos facturas en una y descuadra ambas.
//   · No todos los bloques traen encabezado: algunos empiezan directo en la fila de títulos.
//     Por eso es la fila "REQ. NO." la que abre bloque, y el encabezado solo lo bautiza.
//   · Parte del archivo usa guion tipográfico (‑ U+2011) en los números de requisición. Se ve
//     idéntico al normal y no lo es.
//   · Las fechas vienen como 5/3/26 y también como 05/03/2026.
//
// La prueba de que un bloque se leyó bien: sus renglones suman el subtotal impreso. Lo que no
// cuadre se devuelve marcado, nunca se descarta en silencio.

const CLASE_TITULO = /^REQ\.?\s*NO/i;
const CABECERA = /^(INVOICE|CREDIT MEMO)/i;
const REQ = /^[SZ]\d{8}-\d+$/i;
const CIERRE = /^(Subtotal|Sales Tax|Net Amount):?$/i;

const limpiar = (v) => String(v ?? "").replace(/[‐-―−]/g, "-").trim();
const numero = (v) => {
  const n = Number(String(v ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};

function fechaISO(f) {
  const m = String(f || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  const anio = m[3].length === 2 ? `20${m[3]}` : m[3];
  const iso = `${anio}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return Number.isNaN(new Date(iso).getTime()) ? null : iso;
}

// "Irving, TX" es la sucursal de Mygrant; "Fresno" y "Newport Beach" son ubicaciones de Reyes,
// así que para esas manda la región de la hoja.
function sucursalMygrant(sucursal, hoja) {
  const t = String(sucursal || "").toLowerCase();
  if (t.includes("irving")) return "Mygrant Irving";
  if (t.includes("austin")) return "Mygrant Austin";
  if (t.includes("windcrest") || t.includes("san antonio")) return "Mygrant San Antonio";
  if (t.includes("houston")) return "Mygrant Houston";
  if (/TEXAS/i.test(hoja)) return "Mygrant San Antonio";
  if (/SOUTHER|SOUTHERN/i.test(hoja)) return "Mygrant Anaheim";
  return "Mygrant Hayward";
}

function leerHoja(filas, hoja) {
  const bloques = [];
  let actual = null;
  let cabecera = null;

  for (const fila of filas) {
    const c = fila.map(limpiar);
    if (!c.join("").trim()) continue;

    if (CABECERA.test(c[0])) {
      const m = c.join(" ").match(/(I\d{8}-\d)/);
      cabecera = {
        numero: m ? m[1] : null,
        tipo: /CREDIT/i.test(c[0]) ? "CREDIT_MEMO" : "INVOICE",
        fecha: c[1] || "",
        sucursal: c[3] || "",
      };
      continue;
    }

    if (CLASE_TITULO.test(c[0])) {
      if (actual) bloques.push(actual);
      // El propio título distingue el tipo cuando no hubo encabezado: "…APPLIED FROM" es memo.
      const porTitulo = /APPLIED\s+FROM/i.test(c.join(" ")) ? "CREDIT_MEMO" : "INVOICE";
      actual = {
        hoja,
        invoiceNumber: cabecera?.numero ?? null,
        kind: cabecera?.tipo ?? porTitulo,
        issueDate: fechaISO(cabecera?.fecha),
        branch: cabecera?.sucursal ?? "",
        distributor: sucursalMygrant(cabecera?.sucursal, hoja),
        lines: [],
        subtotal: null,
        tax: null,
        net: null,
      };
      cabecera = null;
      continue;
    }

    if (!actual) continue;

    const etiqueta = c.find((x) => CIERRE.test(x));
    if (etiqueta) {
      const valor = numero(c[c.indexOf(etiqueta) + 1]);
      if (/^Subtotal/i.test(etiqueta)) actual.subtotal = valor;
      else if (/^Sales/i.test(etiqueta)) actual.tax = valor;
      else actual.net = valor;
      continue;
    }

    if (REQ.test(c[0])) {
      actual.lines.push({
        reqNo: c[0],
        date: fechaISO(c[1]),
        qty: numero(c[2]) || 1,
        // Los memos escriben "FW04423 GTN FYG (Credit from S73924004-1)": la parte es lo de antes.
        partNumber: (c[3] || "").replace(/\s*\(Credit from.*$/i, "").trim(),
        amount: numero(c[4]),
        customerName: /CREDIT\s*APPLIED/i.test(c[5] || "") ? "" : c[5] || "",
        // En una compra es el crédito que la saldará; en un memo, la requisición que acredita.
        relatedRef: c[6] || "",
        relatedDate: fechaISO(c[7]),
        note: c[8] || "",
        returned: /^Z\d{8}-\d+$/i.test(c[6] || "") || /CREDIT\s*APPLIED/i.test(c[5] || ""),
      });
    }
  }
  if (actual) bloques.push(actual);
  return bloques;
}

// Devuelve los bloques con su verificación. `ok` es que los renglones sumen el subtotal impreso;
// sin subtotal impreso queda en null — no se puede afirmar ni negar.
function parseWorkbook(buffer) {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const bloques = [];
  for (const nombre of wb.SheetNames) {
    const filas = XLSX.utils.sheet_to_json(wb.Sheets[nombre], { header: 1, raw: false, defval: "" });
    if (!filas.length) continue;
    leerHoja(filas, nombre).forEach((b) => bloques.push(b));
  }

  for (const b of bloques) {
    const suma = Math.round(b.lines.reduce((s, l) => s + Number(l.amount || 0), 0) * 100) / 100;
    b.lineTotal = suma;
    b.check = b.subtotal == null ? null : Math.abs(suma - b.subtotal) < 0.02;
    b.difference = b.subtotal == null ? null : Math.round((suma - b.subtotal) * 100) / 100;
    // Si no hay subtotal impreso, el total del bloque es lo que sumen sus renglones.
    b.amount = b.subtotal != null ? b.subtotal : suma;
  }

  const conNumero = bloques.filter((b) => b.invoiceNumber);
  return {
    blocks: bloques,
    summary: {
      total: bloques.length,
      withNumber: conNumero.length,
      withoutNumber: bloques.length - conNumero.length,
      verified: bloques.filter((b) => b.check === true).length,
      failed: bloques.filter((b) => b.check === false).length,
      unverifiable: bloques.filter((b) => b.check === null).length,
      lines: bloques.reduce((s, b) => s + b.lines.length, 0),
      invoices: conNumero.filter((b) => b.kind === "INVOICE").length,
      creditMemos: conNumero.filter((b) => b.kind === "CREDIT_MEMO").length,
      amount: Math.round(conNumero.reduce((s, b) => s + Number(b.amount || 0), 0) * 100) / 100,
    },
  };
}

// Pegado directo desde Excel: mismas reglas, separado por tabuladores.
function parsePasted(texto) {
  const filas = String(texto || "").split(/\r?\n/).map((l) => l.split("\t"));
  const bloques = leerHoja(filas, "Pegado");
  for (const b of bloques) {
    const suma = Math.round(b.lines.reduce((s, l) => s + Number(l.amount || 0), 0) * 100) / 100;
    b.lineTotal = suma;
    b.check = b.subtotal == null ? null : Math.abs(suma - b.subtotal) < 0.02;
    b.difference = b.subtotal == null ? null : Math.round((suma - b.subtotal) * 100) / 100;
    b.amount = b.subtotal != null ? b.subtotal : suma;
  }
  return {
    blocks: bloques,
    summary: {
      total: bloques.length,
      withNumber: bloques.filter((b) => b.invoiceNumber).length,
      withoutNumber: bloques.filter((b) => !b.invoiceNumber).length,
      verified: bloques.filter((b) => b.check === true).length,
      failed: bloques.filter((b) => b.check === false).length,
      unverifiable: bloques.filter((b) => b.check === null).length,
      lines: bloques.reduce((s, b) => s + b.lines.length, 0),
      invoices: bloques.filter((b) => b.kind === "INVOICE").length,
      creditMemos: bloques.filter((b) => b.kind === "CREDIT_MEMO").length,
      amount: Math.round(bloques.reduce((s, b) => s + Number(b.amount || 0), 0) * 100) / 100,
    },
  };
}

module.exports = { parseWorkbook, parsePasted, sucursalMygrant, fechaISO };
