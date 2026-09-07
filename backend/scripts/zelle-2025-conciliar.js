require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
// Cruce del Zelle 2025 de US Bank (Downloads/ZELLE 2025 US BANK.csv) contra los pagos de técnicos.
const fs = require("fs");
const pool = require("../src/config/db");
const money = (n) => Math.round(Number(n || 0) * 100) / 100;
const lines = fs.readFileSync("C:/Users/Antonio Cano/Downloads/ZELLE 2025 US BANK.csv", "utf8").split(/\r?\n/).filter(Boolean);
const zelle = lines.map((l, i) => {
  const m = l.match(/^(\d+\/\d+\/\d+),DEBIT,ZELLE (?:INSTANT|STANDARD) PMT TO (.+?)\s*(?:\d{17,}\S*|USB\S+),.*,(-?[\d.]+)$/);
  if (!m) return null;
  const [mm, dd, yy] = m[1].split("/");
  return { i: i + 1, date: `${yy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`, name: m[2].trim(), amount: money(-Number(m[3])) };
}).filter(Boolean);
console.log("renglones Zelle:", zelle.length, "de", lines.length, "| total $" + money(zelle.reduce((s, z) => s + z.amount, 0)));
// nombre Zelle -> técnico del CRM (patrón sobre technicians.name)
const MAPA = [
  [/daniel garcia/i, /daniel garcia/i], [/^daniella/i, /777 auto glass|daniela tino/i], [/danilo/i, /danilo/i], [/dung nguyen/i, /dung nguyen/i],
  [/edwin ronaldo/i, /edwin ronaldo/i], [/eloy perez/i, /eloy perez/i], [/erik aguilar/i, /erik aguilar/i], [/henry glass/i, /enrique f orellana|henry/i],
  [/joel lopez/i, /joel alexander lopez/i], [/nelson houston/i, /nelson/i], [/nelson ruiz/i, /nelson/i], [/^osmar/i, /osman neri/i],
  [/ricardo armando ruelas/i, /ricardo santos/i], [/shine city/i, /shine city/i], [/dallas tech flores/i, /luis dallas/i], [/aaron arellano/i, /arellano/i],
  [/^carlos/i, /^carlos/i], [/kent maddy/i, null], [/tex rite/i, null],
];
(async () => {
  const techs = (await pool.query("SELECT DISTINCT t.name FROM (SELECT (jsonb_array_elements(value)->>'name') name FROM app_data WHERE key='technicians.json') t")).rows.map((r) => r.name);
  const pagos = (await pool.query(`SELECT o.id, o.payment_number pn, o.payment_date::date::text d, o.total_amount::float t, o.payment_method pm, o.status, o.notes,
      COALESCE((SELECT q.party FROM payable q WHERE q.payout_id=o.id AND q.kind='TECH' GROUP BY q.party ORDER BY count(*) DESC LIMIT 1), '') tech
    FROM payouts o WHERE o.type='TECHNICIAN' AND o.active<>false AND o.status<>'Cancelled' AND o.payment_date>='2025-01-01' AND o.payment_date<'2026-01-01' ORDER BY o.payment_date`)).rows;
  console.log("pagos técnicos 2025:", pagos.length, "| Zelle:", pagos.filter((p) => /zelle/i.test(p.pm || "")).length, "| total $" + money(pagos.reduce((s, p) => s + p.t, 0)));
  const usados = new Set(); const res = [];
  for (const z of zelle) {
    const mapa = MAPA.find(([re]) => re.test(z.name));
    const techRe = mapa ? mapa[1] : null;
    if (!techRe) { res.push({ z, tipo: "NO ES TÉCNICO" }); continue; }
    const cand = pagos.filter((p) => !usados.has(p.id) && techRe.test(p.tech) && Math.abs(p.t - z.amount) < 0.01);
    const cerca = cand.filter((p) => Math.abs((new Date(p.d) - new Date(z.date)) / 864e5) <= 10);
    const pick = (cerca[0] || cand[0]);
    if (pick) { usados.add(pick.id); res.push({ z, tipo: cerca[0] ? "OK" : "OK (fecha lejana)", p: pick }); continue; }
    // sin monto exacto: ¿suma de dos pagos del mismo técnico cerca de la fecha?
    const mismos = pagos.filter((p) => !usados.has(p.id) && techRe.test(p.tech) && Math.abs((new Date(p.d) - new Date(z.date)) / 864e5) <= 15);
    let par = null;
    for (let a = 0; a < mismos.length && !par; a++) for (let b = a + 1; b < mismos.length; b++) if (Math.abs(mismos[a].t + mismos[b].t - z.amount) < 0.01) { par = [mismos[a], mismos[b]]; break; }
    if (par) { par.forEach((p) => usados.add(p.id)); res.push({ z, tipo: "OK (2 lotes)", p: par }); continue; }
    res.push({ z, tipo: "SIN PAGO", cercanos: mismos.slice(0, 4) });
  }
  const g = {}; for (const r of res) g[r.tipo] = (g[r.tipo] || 0) + 1; console.log(JSON.stringify(g));
  const out = [];
  out.push("== Zelle que NO cuadra con ningún pago de técnico ==");
  for (const r of res.filter((r) => r.tipo === "SIN PAGO")) out.push(`  ${r.z.date} ${r.z.name.padEnd(32)} $${r.z.amount}  | pagos cercanos del técnico: ${r.cercanos.map((p) => `${p.pn} ${p.d} $${p.t} ${p.pm || ""}`).join("; ") || "ninguno"}`);
  out.push("\n== Zelle que no es a un técnico ==");
  for (const r of res.filter((r) => r.tipo === "NO ES TÉCNICO")) out.push(`  ${r.z.date} ${r.z.name.padEnd(32)} $${r.z.amount}`);
  out.push("\n== Zelle cuadrado con fecha lejana (>10 días) ==");
  for (const r of res.filter((r) => r.tipo === "OK (fecha lejana)")) out.push(`  ${r.z.date} ${r.z.name.padEnd(32)} $${r.z.amount} -> ${r.p.pn} ${r.p.d} ${r.p.tech} ${r.p.pm || ""}`);
  out.push("\n== Zelle cuadrado con 2 lotes ==");
  for (const r of res.filter((r) => r.tipo === "OK (2 lotes)")) out.push(`  ${r.z.date} ${r.z.name.padEnd(32)} $${r.z.amount} -> ${r.p.map((p) => `${p.pn} ${p.d} $${p.t}`).join(" + ")}`);
  out.push("\n== Pagos de técnico 2025 marcados Zelle SIN transacción en el archivo ==");
  const sinZ = pagos.filter((p) => !usados.has(p.id) && /zelle/i.test(p.pm || ""));
  for (const p of sinZ) out.push(`  ${p.pn} ${p.d} ${p.tech.padEnd(30)} $${p.t}`);
  out.push(`\n== Pagos de técnico 2025 con otro método (o sin método) que SÍ salieron por Zelle ==`);
  for (const r of res.filter((r) => r.p)) for (const p of [].concat(r.p)) if (!/zelle/i.test(p.pm || "")) out.push(`  ${p.pn} ${p.d} ${p.tech.padEnd(30)} $${p.t} método "${p.pm || ""}" <- Zelle ${r.z.date} ${r.z.name}`);
  const restantes = pagos.filter((p) => !usados.has(p.id) && !/zelle/i.test(p.pm || ""));
  const pmc = {}; for (const p of restantes) pmc[p.pm || "(sin)"] = (pmc[p.pm || "(sin)"] || 0) + 1;
  out.push(`\nPagos 2025 no cuadrados por Zelle, por método: ${JSON.stringify(pmc)}`);
  if (process.argv.includes("--apply")) {
    // Antonio (7-sep-2026): los 128 que coinciden toman la fecha en que salió el Zelle.
    const ok = res.filter((r) => r.tipo === "OK" || r.tipo === "OK (fecha lejana)");
    fs.writeFileSync("backups/zelle-2025-fechas-respaldo-2026-09-07.json", JSON.stringify(ok.map((r) => ({ id: r.p.id, pn: r.p.pn, payment_date: r.p.d, payment_method: r.p.pm })), null, 1));
    let n = 0, cambiaFecha = 0;
    for (const r of ok) {
      const audit = { user: "Antonio Cano", action: "Zelle conciliado", oldValue: { paymentDate: r.p.d, paymentMethod: r.p.pm }, newValue: { paymentDate: r.z.date, paymentMethod: "Zelle", zelle: `${r.z.date} ${r.z.name} $${r.z.amount}` }, timestamp: new Date().toISOString() };
      await pool.query(`UPDATE payouts SET payment_date=$2, payment_method='Zelle', reconciled_at=now(), reconciled_by='Antonio Cano',
          notes = CASE WHEN COALESCE(notes,'') ~ 'Zelle US Bank' THEN notes ELSE trim(both ' | ' from COALESCE(notes,'') || ' | Zelle US Bank ' || $3) END,
          transactions = (SELECT COALESCE(jsonb_agg(CASE WHEN (t->>'date') = $4 THEN jsonb_set(t, '{date}', to_jsonb($2::text)) ELSE t END), '[]'::jsonb) FROM jsonb_array_elements(COALESCE(transactions,'[]'::jsonb)) t),
          audit_log = COALESCE(audit_log,'[]'::jsonb) || $5::jsonb, updated_at=now(), updated_by='Zelle 2025 conciliado (2026-09-07)' WHERE id=$1`,
        [r.p.id, r.z.date, `${r.z.date} ${r.z.name} $${r.z.amount}`, r.p.d, JSON.stringify(audit)]);
      n++; if (r.z.date !== r.p.d) cambiaFecha++;
    }
    out.push(`\nAPLICADO: ${n} pagos conciliados con Zelle; ${cambiaFecha} cambiaron de fecha.`);
  }
  const txt = out.join("\n"); console.log(txt);
  fs.writeFileSync("backups/zelle-2025-cruce-2026-09-07.txt", `renglones Zelle: ${zelle.length} | ${JSON.stringify(g)}\n` + txt);
  await pool.end();
})().catch((e) => { console.error(e.stack); process.exit(1); });
