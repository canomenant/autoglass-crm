"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { getPayableParties, getPayablePending, getPayableNotes, createPayablePayout, getPaymentMethods } from "@/lib/api";
import { money } from "./OrderSummaryUI";

// Una sola vista para los tres tipos. El modelo lo permite porque payable es una sola tabla: la
// diferencia entre pagarle a un tecnico, a un agente o a un distribuidor es el `kind` y los tres
// terminos extra que solo aplican al tecnico.
//
// Deliberadamente NO reusa PaymentBatchWizard: aquel selecciona work orders, y la deuda es por
// orden Y por parte — 490 work orders tienen mas de una obligacion de distribuidor y 44 le deben
// a dos distribuidores distintos, algo que una lista de work orders no puede expresar.

const AJUSTES_TECNICO = [
  { key: "bonus", signo: +1 },
  { key: "deductions", signo: -1 },
  { key: "cashAdvance", signo: -1 },
  { key: "partsDeduction", signo: -1 },
  { key: "partsReturn", signo: +1 },
];

const BONUS_TYPES = ["CC_HANDLING", "SPIFF", "REVIEWS", "ITEMIZED_INVOICE", "ADMIN_FEE", "CALLING_SERVICE", "INSURANCE_PROCESSED", "TRIP_CANCELLED", "PRIOR_BALANCE", "SALARY", "WARRANTY", "OTHER"];

const inputClass =
  "w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow";

export default function PayableBalances({ kind, onChanged, historicalCount = 0, creditedCount = 0, creditedAmount = 0 }) {
  const t = useTranslations("payable");
  const tc = useTranslations("common");
  const tp = useTranslations("payments");

  const [parties, setParties] = useState([]);
  const [party, setParty] = useState(null);
  const [obligations, setObligations] = useState([]);
  const [selected, setSelected] = useState(new Set());
  // Distribuidores marcados en la lista para pagarlos en UN solo lote (Dist-0244 pagó a Mygrant
  // Austin, Carrolton e Irving juntos — el modelo siempre lo permitió, la vista no).
  const [marcadas, setMarcadas] = useState(new Set());
  // Notas de esa parte todavia sin netear. Un credito baja lo que se paga y un debito lo sube.
  const [notes, setNotes] = useState([]);
  const [selectedNotes, setSelectedNotes] = useState(new Set());
  const [bonos, setBonos] = useState([]);
  const [nuevoBono, setNuevoBono] = useState({ bonusType: "", amount: "", note: "" });
  const [ajustes, setAjustes] = useState({ bonus: 0, deductions: 0, cashAdvance: 0, partsDeduction: 0, partsReturn: 0 });
  const [paymentMethod, setPaymentMethod] = useState("");
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [methods, setMethods] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  const esTecnico = kind === "TECH";
  // Solo el lote de distribuidor cubre varias partes a la vez: el de técnico es de una persona
  // por regla del negocio, y el de agente ya agrupa por compañía.
  const multiSel = kind === "DISTRIBUTOR";

  const loadParties = useCallback(() => {
    getPayableParties(kind).then((r) => setParties(r.parties || [])).catch((e) => setError(e.message));
  }, [kind]);

  useEffect(() => { loadParties(); }, [loadParties]);
  useEffect(() => { getPaymentMethods().then(setMethods).catch(() => {}); }, []);

  // Las obligaciones y notas de la vista abierta. `p.multi` trae los nombres cuando el lote
  // cubre varios distribuidores; con uno solo es la lista de siempre.
  function cargarPendientes(p) {
    const nombres = p.multi || [p.party];
    Promise.all(nombres.map((n) => getPayablePending(kind, n).then((r) => r.obligations || [])))
      .then((r) => setObligations(r.flat()))
      .catch((e) => setError(e.message));
    Promise.all(nombres.map((n) => getPayableNotes(kind, n).then((r) => r.notes || []).catch(() => [])))
      .then((r) => setNotes(r.flat()))
      .catch(() => setNotes([]));
  }

  function abrir(p) {
    setParty(p);
    setSelected(new Set());
    setSelectedNotes(new Set());
    // Los bonos capturados son de la parte que se estaba viendo: cambiar de parte y arrastrarlos
    // le daria a otro un bono que no le corresponde.
    setBonos([]);
    setNuevoBono({ bonusType: "", amount: "", note: "" });
    setError("");
    setDone("");
    setAjustes({ bonus: 0, deductions: 0, cashAdvance: 0, partsDeduction: 0, partsReturn: 0 });
    cargarPendientes(p);
  }

  // Un solo lote para todos los distribuidores marcados: se abren juntos y la tabla dice de
  // quién es cada obligación.
  function abrirMarcadas() {
    const list = parties.filter((p) => marcadas.has(p.party));
    if (!list.length) return;
    abrir({
      party: list.map((p) => p.party).join(", "),
      pendingAmount: list.reduce((a, p) => a + Number(p.pendingAmount || 0), 0),
      pendingCount: list.reduce((a, p) => a + Number(p.pendingCount || 0), 0),
      multi: list.map((p) => p.party),
    });
  }

  function marcar(nombre) {
    setMarcadas((prev) => {
      const next = new Set(prev);
      next.has(nombre) ? next.delete(nombre) : next.add(nombre);
      return next;
    });
  }

  const subtotal = useMemo(
    () => obligations.filter((o) => selected.has(o.id)).reduce((a, o) => a + Number(o.amount || 0), 0),
    [obligations, selected]
  );
  // Mismo signo que recomputeAmount() en el backend: debito suma, credito resta.
  const notasNeto = useMemo(
    () => notes.filter((n) => selectedNotes.has(n.id))
      .reduce((a, n) => a + (n.noteType === "DEBIT" ? 1 : -1) * Number(n.amount || 0), 0),
    [notes, selectedNotes]
  );
  // El bono del lote es la suma de sus renglones, igual que despues de creado. Se captura aqui
  // porque es cuando se sabe por que se da: "consiguio la tarjeta", "reseñas", "spiff".
  // Cuando la parte agrupa a varias personas — una compania de agentes — hace falta decir de quien
  // es cada renglon. Con una sola persona la columna seria el mismo nombre repetido.
  const hayVarios = useMemo(() => new Set(obligations.map((o) => o.party).filter(Boolean)).size > 1, [obligations]);

  const bono = useMemo(() => bonos.reduce((a, b) => a + Number(b.amount || 0), 0), [bonos]);

  const total = useMemo(() => {
    const conAjustes = esTecnico
      ? AJUSTES_TECNICO.reduce((a, x) => a + x.signo * Number(ajustes[x.key] || 0), subtotal)
      : subtotal - Number(ajustes.deductions || 0);
    return conAjustes + bono + notasNeto;
  }, [subtotal, ajustes, esTecnico, notasNeto, bono]);

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleNote(id) {
    setSelectedNotes((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function crearLote() {
    if (!selected.size || saving) return;
    setSaving(true);
    setError("");
    try {
      const payout = await createPayablePayout(kind, {
        payableIds: [...selected],
        noteIds: [...selectedNotes],
        paymentMethod,
        paymentDate,
        ...(esTecnico ? ajustes : { deductions: Number(ajustes.deductions || 0) }),
        bonusItems: bonos,
      });
      setDone(t("batchCreated", { number: payout.paymentNumber || payout.id, amount: money(total) }));
      // Recargar: las obligaciones incluidas ya no estan pendientes, y las notas quedaron neteadas.
      setSelected(new Set());
      setSelectedNotes(new Set());
      setMarcadas(new Set());
      loadParties();
      onChanged?.();
      cargarPendientes(party);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  const totalPendiente = parties.reduce((a, p) => a + p.pendingAmount, 0);

  if (!party) {
    return (
      <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-sm font-semibold dark:text-gray-100">{t(`title.${kind}`)}</h2>
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {t("totalPending", { amount: money(totalPendiente), count: parties.reduce((a, p) => a + p.pendingCount, 0) })}
          </span>
        </div>
        {error && <p className="text-sm text-red-600 dark:text-red-400 mb-2">{error}</p>}
        {parties.length === 0 && <p className="text-sm text-gray-400">{t("noBalances")}</p>}
        {historicalCount > 0 && (
          /* Una obligacion de $0 es registro historico, no deuda: se conserva pero no se cobra. */
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">{t("historicalNote", { count: historicalCount })}</p>
        )}
        {creditedCount > 0 && (
          /* Vidrio roto que el distribuidor abono con nota de credito: ya no se le debe. Se
             enuncia igual que las de $0 para que el saldo no baje sin razon visible. */
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">
            {t("creditedNote", { count: creditedCount, amount: money(creditedAmount) })}
          </p>
        )}
        <div className="divide-y dark:divide-gray-800">
          {parties.map((p) => (
            <div key={p.party} className="flex items-center gap-2 hover:bg-gray-50 dark:hover:bg-gray-800 px-2 rounded">
              {/* Marcar varios distribuidores y pagarlos en UN lote (una tarjeta cubre varias
                  sucursales). El clic en el renglon sigue abriendo ese solo, como siempre. */}
              {multiSel && (
                <input
                  type="checkbox"
                  className="w-4 h-4"
                  checked={marcadas.has(p.party)}
                  onChange={() => marcar(p.party)}
                />
              )}
              <button
                type="button"
                onClick={() => abrir(p)}
                className="flex-1 flex items-center justify-between py-2 text-left"
              >
                <span className="text-sm dark:text-gray-100">
                  {p.party}
                  {/* Avisa que ese renglon paga a varias personas a la vez: Digiclique cubre a David
                      Cruz, Ashley Diaz y Kayla Lopez en un solo lote. */}
                  {p.memberCount > 1 && (
                    <span className="text-xs text-gray-400 ml-2">{t("membersInside", { count: p.memberCount })}</span>
                  )}
                </span>
                <span className="flex items-center gap-4">
                  <span className="text-xs text-gray-400">{t("obligations", { count: p.pendingCount })}</span>
                  <span className="text-sm font-medium tabular-nums dark:text-gray-100">{money(p.pendingAmount)}</span>
                </span>
              </button>
            </div>
          ))}
        </div>
        {multiSel && marcadas.size > 0 && (
          <div className="flex items-center justify-between border-t dark:border-gray-800 mt-3 pt-3">
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {t("partiesMarked", { count: marcadas.size })} ·{" "}
              <span className="font-medium tabular-nums dark:text-gray-100">
                {money(parties.filter((p) => marcadas.has(p.party)).reduce((a, p) => a + Number(p.pendingAmount || 0), 0))}
              </span>
            </span>
            <button
              type="button"
              onClick={abrirMarcadas}
              className="bg-gray-900 hover:bg-gray-800 dark:bg-blue-600 dark:hover:bg-blue-700 text-white rounded-lg px-4 py-2 text-sm"
            >
              {t("paySelected", { count: marcadas.size })}
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <button type="button" onClick={() => setParty(null)} className="text-xs text-blue-600 dark:text-blue-400 mb-1">
            ← {t("backToList")}
          </button>
          <h2 className="text-sm font-semibold dark:text-gray-100">{party.party}</h2>
        </div>
        <span className="text-sm text-gray-500 dark:text-gray-400">{money(party.pendingAmount)}</span>
      </div>

      {done && <p className="text-sm text-green-600 dark:text-green-400 mb-2">{done}</p>}
      {error && <p className="text-sm text-red-600 dark:text-red-400 mb-2">{error}</p>}

      <div className="max-h-72 overflow-y-auto border dark:border-gray-800 rounded-lg mb-3">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-800 text-xs text-gray-500 dark:text-gray-400 sticky top-0">
            <tr>
              <th className="w-8 p-2">
                {/* Marcar/desmarcar todas: al pagar varios distribuidores lo normal es llevarse
                    todo lo pendiente, y clicar una por una entre cientos no es un plan. */}
                <input
                  type="checkbox"
                  className="w-4 h-4"
                  checked={obligations.length > 0 && selected.size === obligations.length}
                  onChange={() =>
                    setSelected(selected.size === obligations.length ? new Set() : new Set(obligations.map((o) => o.id)))
                  }
                />
              </th>
              <th className="text-left p-2 font-medium">{t("workOrder")}</th>
              {hayVarios && (
                <th className="text-left p-2 font-medium">{kind === "AGENT" ? t("whoseCommission") : t("whoseParty")}</th>
              )}
              <th className="text-left p-2 font-medium">{tc("date")}</th>
              <th className="text-left p-2 font-medium">{t("customer")}</th>
              <th className="text-right p-2 font-medium">{tc("amount")}</th>
              <th className="w-20 p-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y dark:divide-gray-800">
            {obligations.map((o) => (
              <tr key={o.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/60">
                <td className="p-2">
                  <input type="checkbox" checked={selected.has(o.id)} onChange={() => toggle(o.id)} className="w-4 h-4" />
                </td>
                <td className="p-2 dark:text-gray-100">{o.workOrderNo || "—"}</td>
                {/* De quien es la comision. Dentro de una compania con varios agentes, sin esto la
                    lista no diria a quien pertenece cada trabajo. */}
                {hayVarios && <td className="p-2 text-gray-500 dark:text-gray-400">{o.party || "—"}</td>}
                <td className="p-2 text-gray-500 dark:text-gray-400">{o.workDate ? String(o.workDate).slice(0, 10) : "—"}</td>
                <td className="p-2 text-gray-500 dark:text-gray-400 truncate max-w-[16rem]">{o.customerName}</td>
                {/* Las de $0 no son deuda: son la constancia de que la asignación existió. Se
                    muestran (antes se ocultaban y parecía que faltaban órdenes) pero atenuadas,
                    para que no se confundan con dinero pendiente. */}
                <td className={`p-2 text-right tabular-nums ${o.amount > 0 ? "dark:text-gray-100" : "text-gray-400 dark:text-gray-500"}`}>
                  {money(o.amount)}
                </td>
                <td className="p-2 text-right">
                  {/* Abrir la orden sin perder la selección de este lote: se va en pestaña nueva.
                      Sin id no hay enlace — hay obligaciones del histórico cuyo número ya no
                      corresponde a ninguna orden activa, y un enlace roto es peor que ninguno. */}
                  {o.workOrderId ? (
                    <Link
                      href={`/dashboard/workorders/${o.workOrderId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap"
                    >
                      {tc("viewEdit")}
                    </Link>
                  ) : (
                    <span className="text-xs text-gray-300 dark:text-gray-600">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{t("paymentMethod")}</label>
          <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className={inputClass}>
            <option value="">{t("selectMethod")}</option>
            {methods.map((m) => <option key={m.id} value={m.name}>{m.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{t("paymentDate")}</label>
          <input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} className={inputClass} />
        </div>
      </div>

      {/* Efectivo y partes solo existen en el lote de tecnico; el descuento existe en los tres. */}
      {esTecnico ? (
        <div className="grid grid-cols-4 gap-2 mb-3">
          {AJUSTES_TECNICO.filter((x) => x.key !== "bonus").map(({ key, signo }) => (
            <div key={key}>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                {signo > 0 ? "+ " : "− "}{t(`adjust.${key}`)}
              </label>
              <input
                type="number" step="0.01" value={ajustes[key]}
                onChange={(e) => setAjustes((a) => ({ ...a, [key]: Number(e.target.value) }))}
                className={inputClass}
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="mb-3 max-w-[200px]">
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">− {t("adjust.deductions")}</label>
          <input type="number" step="0.01" value={ajustes.deductions}
            onChange={(e) => setAjustes((a) => ({ ...a, deductions: Number(e.target.value) }))}
            className={inputClass} />
        </div>
      )}

      {/* El bono se captura por renglon, con su tipo, porque es aqui donde se sabe por que se da.
          Un solo campo obligaria a elegir un tipo cuando el bono suele ser varios: los $161.00 de
          Agent-0234 son cinco. La suma de los renglones ES el bono del lote. */}
      <div className="mb-3 border-t dark:border-gray-800 pt-3">
        <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">
          {t("bonusItemsTitle")}{bono !== 0 && <span className="ml-2 font-medium">{money(bono)}</span>}
        </div>
        {bonos.map((b, i) => (
          <div key={i} className="flex items-center gap-2 mb-1 text-sm">
            <span className="flex-1">{b.bonusType ? tp(`bonusTypes.${b.bonusType}`) : t("bonusNoType")}</span>
            <span className="text-gray-500 text-xs flex-1">{b.note}</span>
            <span className="tabular-nums">{money(b.amount)}</span>
            <button type="button" onClick={() => setBonos((v) => v.filter((_, j) => j !== i))} className="text-red-500 text-xs px-1">✕</button>
          </div>
        ))}
        <div className="flex flex-wrap gap-2 items-end mt-2">
          <select value={nuevoBono.bonusType} onChange={(e) => setNuevoBono((b) => ({ ...b, bonusType: e.target.value }))} className={`${inputClass} w-auto`}>
            <option value="">{t("bonusNoType")}</option>
            {BONUS_TYPES.map((x) => <option key={x} value={x}>{tp(`bonusTypes.${x}`)}</option>)}
          </select>
          <input type="number" step="0.01" placeholder="0.00" value={nuevoBono.amount}
            onChange={(e) => setNuevoBono((b) => ({ ...b, amount: e.target.value }))}
            className={`${inputClass} w-24`} />
          <input placeholder={tc("notes")} value={nuevoBono.note}
            onChange={(e) => setNuevoBono((b) => ({ ...b, note: e.target.value }))}
            className={`${inputClass} flex-1 min-w-[140px]`} />
          <button type="button" disabled={!Number(nuevoBono.amount)}
            onClick={() => { setBonos((v) => [...v, { ...nuevoBono, amount: Number(nuevoBono.amount) }]); setNuevoBono({ bonusType: "", amount: "", note: "" }); }}
            className="border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm dark:text-gray-200 disabled:opacity-40">
            {t("addBonus")}
          </button>
        </div>
      </div>

      {/* Notas todavia sin netear de esta parte. Este es el flujo real y el que faltaba: la nota
          nace cuando se rompe el vidrio y se aplica al pago siguiente. Hasta ahora solo se podia
          crear la nota con el lote ya cargado, que exige saber de antemano en cual va a caer. */}
      {notes.length > 0 && (
        <div className="mb-3 border-t dark:border-gray-800 pt-3">
          <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">{t("outstandingNotes", { count: notes.length })}</div>
          <div className="divide-y dark:divide-gray-800">
            {notes.map((n) => (
              <label key={n.id} className="flex items-center gap-3 py-1.5 text-sm cursor-pointer">
                <input type="checkbox" checked={selectedNotes.has(n.id)} onChange={() => toggleNote(n.id)} />
                <span className={n.noteType === "DEBIT" ? "text-red-700 dark:text-red-400" : "text-green-700 dark:text-green-400"}>
                  {n.noteType === "DEBIT" ? "+" : "−"} {money(n.amount)}
                </span>
                <span className="text-gray-600 dark:text-gray-300">{n.noteNumber}</span>
                {n.partNumber && <span className="text-gray-400 text-xs">{n.partNumber}</span>}
                {n.issueDate && <span className="text-gray-400 text-xs ml-auto">{n.issueDate}</span>}
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between border-t dark:border-gray-800 pt-3">
        <div className="text-sm text-gray-500 dark:text-gray-400">
          {t("selectedCount", { count: selected.size })} · {t("subtotal")} {money(subtotal)}
          {notasNeto !== 0 && <> · {t("notesNet")} {money(notasNeto)}</>}
          {total !== subtotal && <> · <span className="font-medium dark:text-gray-100">{t("total")} {money(total)}</span></>}
        </div>
        <button
          type="button" onClick={crearLote} disabled={!selected.size || saving}
          className="bg-gray-900 hover:bg-gray-800 dark:bg-blue-600 dark:hover:bg-blue-700 text-white rounded-lg px-4 py-2 text-sm disabled:opacity-40"
        >
          {saving ? t("creating") : t("createBatch", { amount: money(total) })}
        </button>
      </div>
    </div>
  );
}
