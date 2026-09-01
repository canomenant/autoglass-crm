"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { importStatements, parseStatementFile } from "@/lib/api";
import { money } from "./OrderSummaryUI";

// Subir el statement que acaba de llegar.
//
// Se lee primero y se guarda después, en dos pasos deliberados: el archivo lo arma Mygrant y su
// formato cambia sin avisar, así que antes de escribir nada hay que ver qué se entendió. La
// prueba de que un bloque se leyó bien es que sus renglones sumen el subtotal impreso — lo que
// no cuadre se muestra en rojo y se puede dejar fuera de la carga.

// Los índices que arrancan desmarcados: sin número no hay a qué llamarles, y los que no cuadran
// contra su subtotal impreso solo entran si Antonio lo decide.
const sinVerificar = (bloques) =>
  new Set(bloques.map((b, i) => (b.check === false || !b.invoiceNumber ? i : -1)).filter((i) => i >= 0));

export default function StatementImport({ onImported }) {
  const t = useTranslations("statements");
  const inputArchivo = useRef(null);
  const [abierto, setAbierto] = useState(false);
  const [pegado, setPegado] = useState("");
  const [previa, setPrevia] = useState(null);
  const [excluidos, setExcluidos] = useState(new Set());
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");
  const [listo, setListo] = useState("");

  function limpiar() {
    setPrevia(null);
    setExcluidos(new Set());
    setError("");
    setListo("");
    setPegado("");
    if (inputArchivo.current) inputArchivo.current.value = "";
  }

  async function leerArchivos(lista) {
    const archivos = [...(lista || [])];
    if (!archivos.length) return;
    setOcupado(true);
    setError("");
    setListo("");
    try {
      // FileReader y no arrayBuffer(): el resultado ya viene en base64, que es como viaja.
      // Se aceptan varios a la vez porque Mygrant manda cada factura en su propio PDF.
      const files = await Promise.all(
        archivos.map(
          (a) =>
            new Promise((resolve, reject) => {
              const fr = new FileReader();
              fr.onload = () => resolve({ base64: String(fr.result).split(",")[1], fileName: a.name });
              fr.onerror = () => reject(new Error(t("readError")));
              fr.readAsDataURL(a);
            })
        )
      );
      const r = await parseStatementFile({ files });
      setPrevia(r);
      // Lo que no cuadra arranca desmarcado: entra solo si Antonio decide que entre.
      setExcluidos(sinVerificar(r.blocks));
    } catch (e) {
      setError(e.message);
      setPrevia(null);
    } finally {
      setOcupado(false);
    }
  }

  async function leerPegado() {
    if (!pegado.trim()) return;
    setOcupado(true);
    setError("");
    try {
      const r = await parseStatementFile({ pasted: pegado });
      setPrevia(r);
      setExcluidos(sinVerificar(r.blocks));
    } catch (e) {
      setError(e.message);
      setPrevia(null);
    } finally {
      setOcupado(false);
    }
  }

  function alternar(i) {
    setExcluidos((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  }

  async function guardar() {
    if (!previa || ocupado) return;
    const aCargar = previa.blocks
      .map((b, i) => ({ b, i }))
      .filter(({ b, i }) => b.invoiceNumber && !excluidos.has(i))
      .map(({ b }) => ({
        invoiceNumber: b.invoiceNumber,
        distributor: b.distributor,
        branch: b.branch,
        kind: b.kind,
        issueDate: b.issueDate,
        amount: b.amount,
        source: `upload:${previa.fileName || "pegado"}`,
        notes: b.check === false ? t("importedUnverified", { difference: money(b.difference) }) : null,
        lines: b.lines.map((l) => ({
          reqNo: l.reqNo, date: l.date, qty: l.qty, partNumber: l.partNumber, amount: l.amount,
          customerName: l.customerName, workOrderNo: l.workOrderNo,
          classification: l.classification, matchSource: l.matchSource, relatedRef: l.relatedRef,
        })),
      }));
    if (!aCargar.length) return setError(t("nothingSelected"));
    setOcupado(true);
    setError("");
    try {
      const r = await importStatements(aCargar);
      setListo(t("importDone", { created: r.creados, updated: r.actualizados, lines: r.renglones }));
      setPrevia(null);
      setPegado("");
      if (inputArchivo.current) inputArchivo.current.value = "";
      onImported?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setOcupado(false);
    }
  }

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white transition-colors hover:bg-blue-700"
      >
        {t("addStatements")}
      </button>
    );
  }

  const s = previa?.summary;
  const aCargarCount = previa ? previa.blocks.filter((b, i) => b.invoiceNumber && !excluidos.has(i)).length : 0;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold dark:text-gray-100">{t("addStatements")}</h2>
        <button
          type="button"
          onClick={() => { setAbierto(false); limpiar(); }}
          className="text-xs text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
        >
          {t("close")}
        </button>
      </div>

      {!previa && (
        <>
          <p className="mb-3 text-sm text-gray-500 dark:text-gray-400">{t("uploadHint")}</p>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <input
              ref={inputArchivo}
              type="file"
              accept=".xlsx,.xls,.csv,.pdf"
              multiple
              onChange={(e) => leerArchivos(e.target.files)}
              disabled={ocupado}
              className="text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-gray-900 file:px-4 file:py-2 file:text-sm file:text-white dark:text-gray-300 dark:file:bg-blue-600"
            />
            {ocupado && <span className="text-sm text-gray-500">{t("reading")}</span>}
          </div>
          <details className="text-sm">
            <summary className="cursor-pointer text-gray-500 dark:text-gray-400">{t("orPaste")}</summary>
            <textarea
              value={pegado}
              onChange={(e) => setPegado(e.target.value)}
              rows={6}
              placeholder={t("pastePlaceholder")}
              className="mt-2 w-full rounded-lg border border-gray-200 p-2 font-mono text-xs dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
            />
            <button
              type="button"
              onClick={leerPegado}
              disabled={ocupado || !pegado.trim()}
              className="mt-2 rounded-lg border border-gray-300 px-3 py-1.5 text-sm disabled:opacity-40 dark:border-gray-600 dark:text-gray-200"
            >
              {t("readPasted")}
            </button>
          </details>
        </>
      )}

      {error && (
        <p className="mt-2 rounded-lg border border-red-200 bg-red-50 p-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}
      {listo && <p className="mt-2 text-sm text-green-600 dark:text-green-400">{listo}</p>}

      {previa && s && (
        <>
          <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              [t("preview.blocks"), s.withNumber, null],
              [t("preview.verified"), s.verified, "text-emerald-600 dark:text-emerald-400"],
              [t("preview.failed"), s.failed + s.unverifiable, s.failed ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400"],
              [t("preview.amount"), money(s.amount), null],
            ].map(([etiqueta, valor, color]) => (
              <div key={etiqueta} className="rounded-lg bg-gray-50 p-2.5 dark:bg-gray-900">
                <div className="text-xs text-gray-500 dark:text-gray-400">{etiqueta}</div>
                <div className={`text-lg font-semibold tabular-nums ${color || "dark:text-gray-100"}`}>{valor}</div>
              </div>
            ))}
          </div>

          <div className="mb-3 max-h-72 overflow-y-auto rounded-lg border dark:border-gray-700">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50 text-xs text-gray-500 dark:bg-gray-900 dark:text-gray-400">
                <tr>
                  <th className="w-8 p-2"></th>
                  <th className="p-2 text-left font-medium">{t("col.invoice")}</th>
                  <th className="p-2 text-left font-medium">{t("col.distributor")}</th>
                  <th className="p-2 text-left font-medium">{t("col.issued")}</th>
                  <th className="p-2 text-right font-medium">{t("col.amount")}</th>
                  <th className="p-2 text-left font-medium">{t("preview.match")}</th>
                </tr>
              </thead>
              <tbody className="divide-y dark:divide-gray-700">
                {previa.blocks.map((b, i) => {
                  const malo = b.check === false;
                  const sinNumero = !b.invoiceNumber;
                  return (
                    <tr key={`${b.invoiceNumber || "s/n"}-${i}`} className={malo ? "bg-red-50 dark:bg-red-950/30" : ""}>
                      <td className="p-2">
                        <input
                          type="checkbox"
                          className="h-4 w-4"
                          disabled={sinNumero}
                          checked={!sinNumero && !excluidos.has(i)}
                          onChange={() => alternar(i)}
                        />
                      </td>
                      <td className="p-2 font-mono text-xs dark:text-gray-200">
                        {b.invoiceNumber || <span className="text-gray-400">{t("preview.noNumber")}</span>}
                        {b.kind === "CREDIT_MEMO" && (
                          <span className="ml-2 rounded bg-emerald-100 px-1.5 text-[10px] uppercase text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300">
                            {t("creditMemo")}
                          </span>
                        )}
                      </td>
                      <td className="p-2 text-gray-600 dark:text-gray-300">{b.distributor}</td>
                      <td className="p-2 tabular-nums text-gray-500 dark:text-gray-400">{b.issueDate || "—"}</td>
                      <td className="p-2 text-right tabular-nums dark:text-gray-100">{money(b.amount)}</td>
                      <td className="p-2 text-xs">
                        {malo ? (
                          <span className="text-red-600 dark:text-red-400">
                            {t("preview.mismatch", { difference: money(b.difference) })}
                          </span>
                        ) : b.check === null ? (
                          <span className="text-amber-600 dark:text-amber-400">{t("preview.noSubtotal")}</span>
                        ) : (
                          <span className="text-gray-500 dark:text-gray-400">
                            {t("preview.matched", {
                              installed: b.match?.installed ?? 0,
                              returned: b.match?.returned ?? 0,
                              undecided: b.match?.undecided ?? 0,
                            })}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={guardar}
              disabled={ocupado || !aCargarCount}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white transition-colors hover:bg-blue-700 disabled:opacity-40"
            >
              {t("importCount", { count: aCargarCount })}
            </button>
            <button type="button" onClick={limpiar} className="text-sm text-gray-500 dark:text-gray-400">
              {t("startOver")}
            </button>
            {s.withoutNumber > 0 && (
              <span className="text-xs text-amber-600 dark:text-amber-400">
                {t("preview.skippedNoNumber", { count: s.withoutNumber })}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
