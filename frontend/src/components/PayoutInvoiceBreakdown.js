"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { attachPayoutInvoices, getPayoutInvoiceBreakdown, parsePayoutInvoiceFiles } from "@/lib/api";

const money = (v) => `${Number(v) < 0 ? "-" : ""}$${Math.abs(Number(v || 0)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Qué significa cada renglón de la factura PARA ESTE PAGO. El orden es el de la cuenta: primero lo
// que el pago ya explica, al final lo que falta.
const ESTADOS = ["here", "note", "returned", "credit", "otherPayout", "pending", "extra", "noObligation", "undecided"];
const COLOR = {
  here: "text-green-700 dark:text-green-400",
  note: "text-purple-700 dark:text-purple-300",
  returned: "text-gray-500 dark:text-gray-400",
  credit: "text-gray-500 dark:text-gray-400",
  otherPayout: "text-amber-600 dark:text-amber-400",
  pending: "text-amber-600 dark:text-amber-400",
  extra: "text-amber-600 dark:text-amber-400",
  noObligation: "text-red-600 dark:text-red-400",
  undecided: "text-red-600 dark:text-red-400",
};
// Lo que todavía hay que resolver para que la factura quede explicada por este pago.
const POR_RESOLVER = ["otherPayout", "pending", "extra", "noObligation", "undecided"];

// El desglose de las facturas del pago, renglón por renglón: el mismo detalle de Distributor
// Statements, leído desde el pago (Antonio, 17-sep-2026). Solo lectura: lo que se corrige en
// Statements o en las órdenes se refleja aquí al recargar.
export default function PayoutInvoiceBreakdown({ payoutId, version, canEdit, onSaved }) {
  const t = useTranslations("payments.invoiceBreakdown");
  const [data, setData] = useState(null);
  const [abiertas, setAbiertas] = useState(new Set());
  // Subir los PDFs de las facturas aquí mismo. Se lee primero y se guarda después, igual que en
  // Distributor Statements: el formato es de Mygrant y hay que ver qué se entendió antes de escribir.
  const inputPdf = useRef(null);
  const [previa, setPrevia] = useState(null);      // bloques leídos, con su PDF
  const [fuera, setFuera] = useState(new Set());   // índices que NO se guardan
  const [reemplazar, setReemplazar] = useState(new Set());
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");

  const cargar = () => getPayoutInvoiceBreakdown(payoutId).then(setData).catch(() => setData({ invoices: [] }));
  useEffect(() => { cargar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [payoutId, version]);

  async function leerPdfs(lista) {
    const archivos = [...(lista || [])];
    if (!archivos.length) return;
    setOcupado(true); setError(""); setAviso("");
    try {
      const files = await Promise.all(archivos.map((a) => new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve({ base64: String(fr.result).split(",")[1], url: String(fr.result), fileName: a.name });
        fr.onerror = () => reject(new Error(t("readError")));
        fr.readAsDataURL(a);
      })));
      const r = await parsePayoutInvoiceFiles(payoutId, files.map(({ base64, fileName }) => ({ base64, fileName })));
      // Cada PDF de Mygrant trae UNA factura: el bloque se queda con su archivo por nombre.
      const bloques = r.blocks.map((b) => ({ ...b, file: files.find((x) => x.fileName === b.hoja) || null }));
      setPrevia(bloques);
      // Arrancan fuera las que no conviene guardar sin mirar: sin número, las que no cuadran contra
      // su subtotal impreso y las que ya están en otro pago.
      setFuera(new Set(bloques.map((b, i) => (!b.invoiceNumber || b.check === false || b.existing?.otherPayout ? i : -1)).filter((i) => i >= 0)));
      setReemplazar(new Set());
    } catch (e) {
      setError(e.message); setPrevia(null);
    } finally {
      setOcupado(false);
      if (inputPdf.current) inputPdf.current.value = "";
    }
  }

  const alternarEn = (set, i) => set((prev) => { const n = new Set(prev); if (n.has(i)) n.delete(i); else n.add(i); return n; });

  async function guardarPdfs() {
    const invoices = previa.map((b, i) => ({ b, i })).filter(({ b, i }) => b.invoiceNumber && !fuera.has(i) && !b.existing?.otherPayout).map(({ b, i }) => ({
      invoiceNumber: b.invoiceNumber, distributor: b.distributor, branch: b.branch, kind: b.kind,
      issueDate: b.issueDate, amount: b.amount, replaceLines: reemplazar.has(i),
      attachment: b.file ? { name: b.file.fileName, url: b.file.url } : null,
      lines: b.lines.map((l) => ({
        reqNo: l.reqNo, date: l.date, qty: l.qty, partNumber: l.partNumber, amount: l.amount,
        customerName: l.customerName, workOrderNo: l.workOrderNo,
        classification: l.classification, matchSource: l.matchSource, relatedRef: l.relatedRef,
      })),
    }));
    if (!invoices.length) return setError(t("nothingToSave"));
    setOcupado(true); setError("");
    try {
      const r = await attachPayoutInvoices(payoutId, invoices);
      setAviso(t("saved", { count: r.saved.length, total: money(r.invoiceTotal || 0) }) +
        (r.skipped.length ? " · " + r.skipped.map((x) => `${x.invoiceNumber}: ${x.reason}`).join("; ") : ""));
      setPrevia(null);
      await cargar();
      onSaved?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setOcupado(false);
    }
  }

  if (!data || (!data.invoices.length && !canEdit)) return null;
  const alternar = (k) => setAbiertas((prev) => { const s = new Set(prev); if (s.has(k)) s.delete(k); else s.add(k); return s; });
  const totales = data.totals || { byState: {}, invoiced: 0, notOnInvoices: 0 };
  const porResolver = POR_RESOLVER.reduce((a, k) => a + Math.abs(Number(totales.byState[k] || 0)), 0) + Number(totales.notOnInvoices || 0);

  return (
    <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4 mb-6">
      <div className="flex items-center justify-between mb-1">
        <h2 className="font-semibold">{t("title")}</h2>
        {canEdit && (
          <label className={`text-sm text-blue-600 dark:text-blue-400 hover:underline cursor-pointer ${ocupado ? "opacity-40 pointer-events-none" : ""}`}>
            + {t("uploadPdfs")}
            <input ref={inputPdf} type="file" accept="application/pdf,.xlsx,.xls" multiple className="hidden" onChange={(e) => leerPdfs(e.target.files)} />
          </label>
        )}
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">{t("hint")}</p>
      {ocupado && !previa && <p className="text-sm text-gray-500 mb-3">{t("reading")}</p>}
      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
      {aviso && <p className="text-sm text-green-700 dark:text-green-400 mb-3">✓ {aviso}</p>}

      {previa && (
        <div className="border border-blue-200 dark:border-blue-900 bg-blue-50/50 dark:bg-blue-950/30 rounded-lg p-3 mb-4">
          <div className="text-sm font-medium mb-2">{t("previewTitle", { count: previa.length })}</div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left border-b dark:border-gray-800 text-gray-400 uppercase">
                  <th className="p-1.5 w-8"></th>
                  <th className="p-1.5">{t("invoice")}</th>
                  <th className="p-1.5">{t("date")}</th>
                  <th className="p-1.5 text-right">{t("amount")}</th>
                  <th className="p-1.5">{t("linesCol")}</th>
                  <th className="p-1.5">{t("statusCol")}</th>
                </tr>
              </thead>
              <tbody>
                {previa.map((b, i) => {
                  const bloqueada = !b.invoiceNumber || !!b.existing?.otherPayout;
                  const conOrden = b.lines.filter((l) => l.workOrderNo).length;
                  return (
                    <tr key={i} className="border-b last:border-0 dark:border-gray-800 align-top">
                      <td className="p-1.5"><input type="checkbox" className="w-4 h-4" disabled={bloqueada} checked={!bloqueada && !fuera.has(i)} onChange={() => alternarEn(setFuera, i)} /></td>
                      <td className="p-1.5">
                        <span className="font-mono">{b.invoiceNumber || t("noNumber")}</span>
                        <span className="block text-gray-500 dark:text-gray-400">{[b.kind === "CREDIT_MEMO" ? t("creditMemo") : t("invoice"), b.distributor, b.hoja].filter(Boolean).join(" · ")}</span>
                      </td>
                      <td className="p-1.5 tabular-nums">{b.issueDate || "—"}</td>
                      <td className="p-1.5 text-right tabular-nums">{money(b.amount)}</td>
                      <td className="p-1.5">{t("linesMatched", { lines: b.lines.length, matched: conOrden })}</td>
                      <td className="p-1.5">
                        {b.existing?.otherPayout ? <span className="text-red-600">{t("inOtherPayout", { payout: b.existing.otherPayout })}</span>
                          : b.check === false ? <span className="text-red-600">{t("doesNotAddUp", { difference: money(b.difference) })}</span>
                          : <span className="text-green-700 dark:text-green-400">✓ {t("linesAddUp")}</span>}
                        {b.listedInPayout && <span className="block text-gray-500 dark:text-gray-400">{t("alreadyListed")}</span>}
                        {b.existing && Math.abs(Number(b.existing.amount) - Number(b.amount)) > 0.004 && (
                          <span className="block text-amber-600 dark:text-amber-400">{t("amountWas", { amount: money(b.existing.amount) })}</span>
                        )}
                        {b.existing?.lines > 0 && !b.existing.otherPayout && (
                          <label className="flex items-center gap-1 text-amber-700 dark:text-amber-400 mt-0.5">
                            <input type="checkbox" checked={reemplazar.has(i)} onChange={() => alternarEn(setReemplazar, i)} />
                            {t("replaceLines", { count: b.existing.lines })}
                          </label>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex gap-2 mt-3">
            <button type="button" onClick={guardarPdfs} disabled={ocupado} className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 py-2 text-sm disabled:opacity-40">{t("saveInvoices")}</button>
            <button type="button" onClick={() => { setPrevia(null); setError(""); }} className="border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-2 text-sm dark:text-gray-200">{t("cancel")}</button>
          </div>
        </div>
      )}
      {data.invoices.length === 0 && !previa && <p className="text-sm text-gray-500 dark:text-gray-400">{t("empty")}</p>}

      {data.invoices.map((f) => {
        const k = f.invoiceNumber;
        const abierta = abiertas.has(k);
        const pendiente = POR_RESOLVER.reduce((a, e) => a + Math.abs(Number(f.byState[e] || 0)), 0);
        return (
          <div key={k} className="border border-gray-200 dark:border-gray-800 rounded-lg mb-2">
            <button type="button" onClick={() => alternar(k)}
              className="w-full flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-800/60 rounded-lg">
              <span className="font-mono text-xs w-3">{abierta ? "▾" : "▸"}</span>
              <span className="font-mono font-medium">{f.invoiceNumber}</span>
              <span className="text-xs text-gray-500 dark:text-gray-400">{[f.kind === "CREDIT_MEMO" ? t("creditMemo") : t("invoice"), f.distributor, f.issueDate].filter(Boolean).join(" · ")}</span>
              <span className="ml-auto tabular-nums font-medium">{money(f.amount)}</span>
              <span className="w-full sm:w-auto text-xs">
                {f.missing || !f.lines.length
                  ? <span className="text-gray-400">{t("noLines")}</span>
                  : pendiente > 0.004
                    ? <span className="text-amber-600 dark:text-amber-400">{t("toResolve", { amount: money(pendiente) })}</span>
                    : <span className="text-green-700 dark:text-green-400">✓ {t("explained")}</span>}
              </span>
            </button>

            {abierta && f.lines.length > 0 && (
              <div className="px-3 pb-3 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left border-b dark:border-gray-800 text-gray-400 uppercase">
                      <th className="p-1.5">{t("reqNo")}</th>
                      <th className="p-1.5">{t("date")}</th>
                      <th className="p-1.5">{t("part")}</th>
                      <th className="p-1.5">{t("customer")}</th>
                      <th className="p-1.5 text-right">{t("amount")}</th>
                      <th className="p-1.5">{t("outcome")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {f.lines.map((l) => (
                      <tr key={l.id} className="border-b last:border-0 dark:border-gray-800">
                        <td className="p-1.5 font-mono">{l.reqNo}</td>
                        <td className="p-1.5 tabular-nums">{l.date || "—"}</td>
                        <td className="p-1.5 font-mono">{l.partNumber}</td>
                        <td className="p-1.5 text-gray-500 dark:text-gray-400">{l.customerName || "—"}</td>
                        <td className="p-1.5 text-right tabular-nums">{money(l.amount)}</td>
                        <td className={`p-1.5 ${COLOR[l.state] || ""}`}>
                          {t(`state.${l.state}`)}
                          {l.workOrderNo && (
                            <> · {l.workOrderId
                              ? <Link href={`/dashboard/workorders/${l.workOrderId}`} target="_blank" className="text-blue-600 dark:text-blue-400 hover:underline">{l.workOrderNo}</Link>
                              : l.workOrderNo}</>
                          )}
                          {l.otherPayout && <> · {l.otherPayout}</>}
                          {l.noteNumber && <> · {l.noteNumber}{l.notePayout ? ` (${l.notePayout})` : ""}</>}
                          {l.state === "returned" && l.creditedIn && <> · {l.creditedIn}</>}
                          {l.matchedByPart && <span className="text-gray-400"> · {t("matchedByPart")}</span>}
                          {l.includedInObligation && <span className="text-gray-400"> · {t("includedInObligation")}</span>}
                          {/* La obligación vale distinto que el renglón: uno de los dos está mal. Salvo
                              cuando la diferencia son los recargos de la misma orden, ya sumados. */}
                          {l.state === "here" && !l.obligationIncludesExtras && l.obligationAmount != null && Math.abs(l.obligationAmount - l.amount) > 0.004 && (
                            <span className="block text-amber-600 dark:text-amber-400">{t("amountDiffers", { obligation: money(l.obligationAmount) })}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  {ESTADOS.filter((e) => Math.abs(Number(f.byState[e] || 0)) > 0.004).map((e) => (
                    <span key={e} className={COLOR[e]}>{t(`state.${e}`)}: <span className="tabular-nums">{money(f.byState[e])}</span></span>
                  ))}
                  {!f.linesMatch && <span className="text-red-600">{t("linesMismatch", { lines: money(f.linesTotal), invoice: money(f.amount) })}</span>}
                </div>
              </div>
            )}
          </div>
        );
      })}

      {data.invoices.length > 0 && (<>
      {/* El cuadre de todas las facturas juntas: un crédito suele venir en un memo aparte de la
          factura donde se compró la pieza, así que por factura sola no cierra. */}
      <div className="mt-3 text-sm max-w-md">
        {ESTADOS.filter((e) => Math.abs(Number(totales.byState[e] || 0)) > 0.004).map((e) => (
          <div key={e} className="flex justify-between py-1 border-b dark:border-gray-800">
            <span className={COLOR[e]}>{t(`state.${e}`)}</span>
            <span className="tabular-nums">{money(totales.byState[e])}</span>
          </div>
        ))}
        <div className="flex justify-between pt-2 font-semibold border-t-2 border-gray-900 dark:border-gray-200 mt-1">
          <span>{t("invoicedTotal")}</span>
          <span className="tabular-nums">{money(totales.invoiced)}</span>
        </div>
      </div>

      {data.notOnInvoices?.length > 0 && (
        <div className="mt-3 text-xs text-amber-700 dark:text-amber-400">
          <div className="font-medium mb-1">{t("notOnInvoices", { count: data.notOnInvoices.length, amount: money(totales.notOnInvoices) })}</div>
          {data.notOnInvoices.map((y) => (
            <div key={y.id}>
              {y.workOrderId
                ? <Link href={`/dashboard/workorders/${y.workOrderId}`} target="_blank" className="text-blue-600 dark:text-blue-400 hover:underline">{y.workOrderNo}</Link>
                : y.workOrderNo} · {y.customerName || "—"} · <span className="font-mono">{y.partNumber || "—"}</span> · {money(y.amount)}
            </div>
          ))}
        </div>
      )}

      <p className={`mt-3 text-sm font-medium ${porResolver > 0.004 ? "text-amber-600 dark:text-amber-400" : "text-green-700 dark:text-green-400"}`}>
        {porResolver > 0.004 ? t("totalToResolve", { amount: money(porResolver) }) : `✓ ${t("allExplained")}`}
      </p>
      </>)}
    </section>
  );
}
