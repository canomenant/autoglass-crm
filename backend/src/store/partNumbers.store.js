const { loadOrSeed, save, appendToAppDataArray } = require("../lib/persistence");

const FILE = "partNumbers.json";
let items = loadOrSeed(FILE, () => [
  { id: 1, partNumber: "WFS F2863", jobType: "Molding Replacement", nagsDescription: "Tira de relleno del parabrisas del Subaru Impreza 2008-2010" },
  { id: 2, partNumber: "DW02177 GTY", jobType: "Door Glass Replacement", nagsDescription: "Dodge Charger 2015-2023 | Chrysler 300 Sedán 4 puertas (Slr, Acstc Intriyr, LDWS, Rn/Humdty Snsr) **DW02235=Repuesto**" },
  { id: 3, partNumber: "FW05631 GTY", jobType: "Windshield Replacement", nagsDescription: "NULO" },
  { id: 4, partNumber: "FW04163 GBN", jobType: "Windshield Replacement", nagsDescription: "11-12 Hyundai Santa Fe 4D U (Slr, con Homelink, 3VF, HWP)" },
  { id: 5, partNumber: "PUSH24 EQL", jobType: "Supplies", nagsDescription: 'CUCHILLO DE EMPUJE DE 24"' },
  { id: 6, partNumber: "DW02275 GBY", jobType: "Door Glass Replacement", nagsDescription: "Chevrolet Suburban/Tahoe 2016-2020 | Cadillac Escalade/ESV 2016-2020 | GMC Yukon 2016-2019 (HUD, Slr, Acstc Intriyr, LDWS, Rn Snsr)" },
  { id: 7, partNumber: "FW04238 GTY", jobType: "Windshield Replacement", nagsDescription: "Honda Pilot 4D U 2016-2022 | Ridgeline 4D Crew Cab 2016-2021 (Slr, 3VF, Acstc Intriyr)" },
  { id: 8, partNumber: "FB27750 YPF", jobType: "Back Glass Replacement", nagsDescription: "19- Infiniti QX50 4D U (Htd, 1 Orificio, Slr)" },
  { id: 9, partNumber: "FB22496 YPN", jobType: "Back Glass Replacement", nagsDescription: "05-15 Nissan Xterra 4D U (Htd)" },
  { id: 10, partNumber: "DW01506 GTY", jobType: "Door Glass Replacement", nagsDescription: "03-11 Ford Crown Victoria | Mercury Grand Marquis 4D S (Slr, 3VF) **Puede utilizarse para DW01327/1202/1406**" },
  { id: 11, partNumber: "FB30248 YPN", jobType: "Back Glass Replacement", nagsDescription: "23- Nissan Ariya 4D U (Htd, 1 Orificio, Slr)" },
  { id: 12, partNumber: "FB24734 YPN", jobType: "Back Glass Replacement", nagsDescription: "Minivan Honda Odyssey 2011-2017 (calefactable, 1 orificio, SLR, con limpiaparabrisas)" },
  { id: 13, partNumber: "FW04240 GTY", jobType: "Windshield Replacement", nagsDescription: "Honda Passport 20-25 | Pilot 4D U 16-22 (Slr, 3VF, Acstc Intriyr, LDWS, FCA, Rn Snsr)" },
  { id: 14, partNumber: "DW02123 GTY", jobType: "Door Glass Replacement", nagsDescription: "Dodge Journey 4D U (3VF, sensor de humedad) 2014-2017" },
  { id: 15, partNumber: "DW01701 GBY", jobType: "Door Glass Replacement", nagsDescription: "Jeep Commander 4D U (Rn Snsr, 3VF) 06-10 **Reemplaza a DW01628**" },
  { id: 16, partNumber: "FD22402 GTY", jobType: "Door Glass Replacement", nagsDescription: "05-15 Toyota Tacoma PU 2D cabina externa F/L" },
  { id: 17, partNumber: "DW02285 GTY", jobType: "Door Glass Replacement", nagsDescription: "15-23 Chrysler 300 | Dodge Charger Sedán 4 puertas (Slr, Posventa) **DW02175=Acstc Intriyr**" },
  { id: 18, partNumber: "USM F3498", jobType: "Molding Replacement", nagsDescription: "Moldura inferior (superior) del parabrisas del Hyundai Volester 2012-2018" },
  { id: 19, partNumber: "FD29199 GTY", jobType: "Door Glass Replacement", nagsDescription: "22- Hyundai IONIQ 5 4D UF/L (Slr, LAMINADO, Acstc Intriyr)" },
  { id: 20, partNumber: "DW02021 GTN", jobType: "Door Glass Replacement", nagsDescription: "11-14 Chrysler 200 2D Convertible (3VF, Affrmrkt) **DW01711=Acstc Intriyr**" },
  { id: 21, partNumber: "W6100 CPI", jobType: "Calibration", nagsDescription: 'VER TAZA VERTICAL SL-600A DE 6" (VHC913) pieza de repuesto n.° 49416' },
  { id: 22, partNumber: "FW04567", jobType: "Windshield Replacement", nagsDescription: "Windshield Green Solar" },
]);
// Ids are assigned by Postgres inside the append statement, not counted here — a count kept in
// process memory hands out the same id twice the moment there is more than one instance.

function persist() {
  save(FILE, items);
}

// Decides whether a part number already exists. Case, whitespace and the separators people vary
// on are all squashed out, so "FW02500 GBN", "fw02500 gbn", "  FW02500   GBN " and "fw-02500.gbn"
// are the same part — which is what the catalog means by a duplicate.
//
// The character set here must stay identical to the one the SQL guard squashes in
// persistence.js#appendToAppDataArray; if they drift, one side offers to add what the other
// refuses. scripts/verify-add-part-number.js asserts the two agree against the real catalog.
function normalizePartNumber(value) {
  return String(value || "").toLowerCase().replace(/[ \t\r\n\-._/]+/g, "");
}

function list() {
  return items;
}

function findByPartNumber(partNumber) {
  const target = normalizePartNumber(partNumber);
  if (!target) return null;
  return items.find((i) => normalizePartNumber(i.partNumber) === target) || null;
}

function get(id) {
  return items.find((i) => i.id === Number(id));
}

// Returns { created } on success, or { duplicate } when the part number is already in the
// catalog — the caller turns that into a 409 so the quote form can offer the existing entry
// instead. Never throws for the duplicate case: it is an expected outcome, not a failure.
//
// Appends atomically rather than going through persist(), which rewrites all 11k entries and
// silently drops one of two simultaneous adds. The guard lives in the same statement, so the
// check and the write cannot be separated by another writer.
async function create(data, actor) {
  const partNumber = String(data.partNumber || "").trim();
  if (!partNumber) throw new Error("Part Number is required.");

  const entry = await appendToAppDataArray(
    FILE,
    {
      partNumber,
      // Both optional by design — a part number is worth recording on its own, and the
      // description usually arrives later from the distributor.
      nagsDescription: String(data.nagsDescription || "").trim(),
      notes: String(data.notes || "").trim(),
      jobType: String(data.jobType || "").trim(),
      addedBy: actor || "",
    },
    { uniqueField: "partNumber", timestampField: "addedAt" }
  );

  // appendToAppDataArray already pushed the entry into the shared cache array, which is the very
  // array `items` points at, so the store needs no push of its own.
  if (!entry) return { duplicate: findByPartNumber(partNumber) };
  return { created: entry };
}

function update(id, data) {
  const item = get(id);
  if (!item) return null;
  // notes was silently dropped here and in create(), so anything typed into it was accepted by
  // the API and then thrown away. addedBy/addedAt are deliberately not assignable: they record who
  // actually created the entry and must not be editable after the fact.
  Object.assign(item, {
    partNumber: data.partNumber ?? item.partNumber,
    jobType: data.jobType ?? item.jobType,
    nagsDescription: data.nagsDescription ?? item.nagsDescription,
    notes: data.notes ?? item.notes ?? "",
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

module.exports = { list, get, create, update, remove, findByPartNumber, normalizePartNumber };
