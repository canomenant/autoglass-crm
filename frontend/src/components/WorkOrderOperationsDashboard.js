"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { getAgent, getStatementLinesForWorkOrder } from "@/lib/api";
import { WORK_ORDER_FLOW_STATUSES } from "@/lib/workOrderStatuses";
import { STATUS_COLORS } from "@/lib/workOrderStatusColors";
import { Badge, Row, money } from "./OrderSummaryUI";

const STEPS = ["Approved", ...WORK_ORDER_FLOW_STATUSES];

function StatusTracker({ wo }) {
  const tq = useTranslations("quotes");
  const tw = useTranslations("workOrders");
  const to = useTranslations("operationsDashboard");

  function labelFor(step) {
    return step === "Approved" ? tq("statuses.Approved") : tw(`statuses.${step}`);
  }

  if (wo.status === "Cancelled") {
    return (
      <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-4">{to("statusTracker")}</h2>
        <div className="flex items-center gap-3 rounded-lg p-3" style={{ backgroundColor: `${STATUS_COLORS.Cancelled}1a` }}>
          <span className="w-4 h-4 rounded-full flex-shrink-0" style={{ backgroundColor: STATUS_COLORS.Cancelled }} />
          <div>
            <div className="font-semibold" style={{ color: STATUS_COLORS.Cancelled }}>{tw("statuses.Cancelled")}</div>
            {wo.cancellationReason && (
              <div className="text-xs text-gray-500 dark:text-gray-400">
                {tw(`cancellationReasons.${wo.cancellationReason}`)}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  const currentIndex = 1 + Math.max(0, WORK_ORDER_FLOW_STATUSES.indexOf(wo.status));

  return (
    <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4 overflow-x-auto">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-4">{to("statusTracker")}</h2>
      <div className="flex items-center min-w-[640px]">
        {STEPS.map((step, i) => {
          const reached = i <= currentIndex;
          const color = reached ? STATUS_COLORS[step] : "#d1d5db";
          return (
            <div key={step} className="flex items-center flex-1 last:flex-none">
              <div className="flex flex-col items-center gap-1.5 flex-shrink-0">
                <span className="w-4 h-4 rounded-full" style={{ backgroundColor: color }} />
                <span className={`text-[11px] whitespace-nowrap ${reached ? "font-semibold" : "text-gray-400 dark:text-gray-500"}`} style={reached ? { color } : undefined}>
                  {labelFor(step)}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div className="flex-1 h-0.5 mx-1" style={{ backgroundColor: i < currentIndex ? STATUS_COLORS[STEPS[i + 1]] : "#e5e7eb" }} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Card({ title, children }) {
  return (
    <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">{title}</h3>
      <div className="space-y-1.5 text-sm">{children}</div>
    </div>
  );
}

function PaymentPanel({ wo, t }) {
  const totalSale = Number(wo.totalSale || 0);
  const paidAmount = Number(wo.payment?.amount || 0);
  // Never negative. Paying more than the total is either an upsell (the norm — recorded on the
  // quote's final sale price, which raises totalSale so there's no gap at all) or cash handed
  // back, which is tracked explicitly in payment.cashComeback. A negative "balance due" was
  // neither, just a subtraction leaking into the UI.
  const balanceDue = Math.max(0, totalSale - paidAmount);
  const changeDue = Number(wo.payment?.cashComeback || 0);
  const paid = !!wo.payment?.paid;
  const status = paid ? t("paidInFull") : paidAmount > 0 ? t("partial") : t("unpaid");
  const tone = paid ? "paid" : paidAmount > 0 ? "pending" : "outstanding";

  return (
    <Card title={t("paymentPanel")}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-2xl font-bold dark:text-gray-100">{money(totalSale)}</span>
        <Badge tone={tone}>{status}</Badge>
      </div>
      <Row label={t("amountPaid")} value={money(paidAmount)} />
      <Row label={t("balanceDue")} value={money(balanceDue)} emphasis tone={balanceDue > 0 ? "outstanding" : "paid"} />
      {changeDue > 0 && <Row label={t("changeDue")} value={money(changeDue)} emphasis tone="pending" />}
    </Card>
  );
}

function TechnicianPanel({ wo, quote, t, tw, payStatus }) {
  // Labor Hours y Labor Rate se quitaron: no cumplían función aquí (al técnico se le paga por
  // monto, no por horas × tarifa). La tarifa por defecto sigue en Settings → Técnicos.
  return (
    <Card title={t("technicianPanel")}>
      <Row label={t("assignedTechnician")} value={wo.tech || tw("unassigned")} emphasis />
      <Row label={t("appointmentDate")} value={wo.appointmentDate || tw("notScheduled")} />
      {/* Un importe siempre se muestra como importe. "Not tracked yet" en un campo de dinero se
          lee como si el dato faltara, cuando cero es un dato: a este tecnico no se le paga labor. */}
      <Row label={t("technicianPay")} value={money(wo.laborCost)} />
      {/* Antes mostraba el estado de la ORDEN (Paid/etc.). Ahora muestra si al técnico ya se le
          pagó su labor o está pendiente — que es lo que este panel debe decir. */}
      <PaymentStatusRow label={t("paymentStatus")} st={payStatus} amount={wo.laborCost} t={t} />
    </Card>
  );
}

function AgentPanel({ wo, quote, agent, t, payStatus }) {
  if (!quote?.agentName) {
    return (
      <Card title={t("agentPanel")}>
        <p className="text-gray-400 dark:text-gray-500 text-sm">{t("noReferralAgent")}</p>
      </Card>
    );
  }
  return (
    <Card title={t("agentPanel")}>
      <Row label={t("referralAgent")} value={quote.agentName} emphasis />
      <Row label={t("commissionType")} value={agent ? t(`commissionTypes.${agent.commissionType}`) : t("notTracked")} />
      <Row label={t("commissionAmount")} value={money(wo.commission)} />
      {/* Antes decía "Eligible at Completion" fijo. Ahora dice si la comisión ya se pagó o está
          pendiente, igual que el panel del técnico. */}
      <PaymentStatusRow label={t("paymentStatus")} st={payStatus} amount={wo.commission} t={t} />
    </Card>
  );
}

function DistributorPanel({ wo, quote, t, payStatus }) {
  const lineas = quote?.lineItems || [];
  const unicos = (campo) => [...new Set(lineas.map((li) => li[campo]).filter(Boolean))].join(", ");
  const distributorName = wo.distributor || unicos("distributor");
  // El numero con el que el distribuidor factura la parte. Estaba en la linea del presupuesto desde
  // siempre; el panel decia "Not tracked yet" sin haberlo buscado.
  const invoiceNumber = unicos("orderNumber");

  // Y del otro lado: en qué factura de Mygrant llegó cada parte, y si esa factura ya se pagó.
  // El puente es la requisición (orderNumber en la línea = req_no en el renglón del statement).
  const [statementLines, setStatementLines] = useState([]);
  useEffect(() => {
    if (!wo?.workOrderNo) return;
    let vivo = true;
    getStatementLinesForWorkOrder(wo.workOrderNo)
      .then((r) => vivo && setStatementLines(r.lines || []))
      .catch(() => vivo && setStatementLines([]));
    return () => { vivo = false; };
  }, [wo?.workOrderNo]);

  if (!distributorName) {
    return (
      <Card title={t("distributorPanel")}>
        <p className="text-gray-400 dark:text-gray-500 text-sm">{t("noDistributor")}</p>
      </Card>
    );
  }
  return (
    <Card title={t("distributorPanel")}>
      <Row label={t("distributor")} value={distributorName} emphasis />
      <Row label={t("partCost")} value={money(wo.glassCost)} />
      <Row label={t("invoiceNumber")} value={invoiceNumber || t("notTracked")} />
      {/* Estado de pago real al distribuidor, igual que técnico y agente. */}
      <PaymentStatusRow label={t("paymentStatus")} st={payStatus} amount={wo.glassCost} t={t} />

      {/* Las facturas del distribuidor donde de verdad llegaron estas partes, con lo que costó
          cada una y si esa factura ya se saldó. Cierra el círculo: desde la orden se ve qué
          statement pagó su vidrio, sin ir a buscarlo. */}
      {statementLines.length > 0 && (
        <div className="mt-3 border-t border-gray-100 pt-2.5 dark:border-gray-800">
          <div className="mb-1.5 text-[11px] uppercase tracking-wide text-gray-400">{t("billedOn")}</div>
          {statementLines.map((l, i) => (
            <div key={`${l.reqNo}-${i}`} className="flex items-baseline justify-between gap-2 py-0.5 text-xs">
              <span className="min-w-0">
                <span className="font-mono dark:text-gray-200">{l.invoiceNumber}</span>
                {l.partNumber && <span className="ml-1.5 text-gray-400">{l.partNumber}</span>}
              </span>
              <span className="whitespace-nowrap">
                <span className="tabular-nums dark:text-gray-200">{money(l.amount)}</span>
                <span className={`ml-1.5 ${l.paymentNumber ? "text-green-700 dark:text-green-400" : "text-amber-600 dark:text-amber-400"}`}>
                  {l.paymentNumber || t("statementUnpaid")}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/* Campo de dinero: se ve como importe (0.00) y se edita como numero.
 *
 * Un <input type="number"> no sirve aqui. No conserva los decimales al mostrar -un 120 guardado se
 * ve "120" y no "120.00"-, y el cero inicial no se reemplaza al escribir encima, sino que se le
 * antepone: tecleando 120 sobre un cero queda "0120". Mientras el campo tiene el foco se muestra
 * el texto crudo para poder escribir sin estorbos; al salir se vuelve a formatear. */
function MoneyInput({ label, value, onChange }) {
  const [editando, setEditando] = useState(null);
  const numero = Number(value || 0);

  return (
    <label className="flex items-center justify-between gap-3">
      <span className="text-gray-500 dark:text-gray-400">{label}</span>
      <span className="relative">
        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 pointer-events-none text-sm">$</span>
        <input
          type="text"
          inputMode="decimal"
          value={editando ?? numero.toFixed(2)}
          onFocus={() => setEditando(numero === 0 ? "" : String(numero))}
          onChange={(e) => {
            const v = e.target.value;
            if (!/^\d*\.?\d{0,2}$/.test(v)) return; // ignora la tecla, no borra lo escrito
            setEditando(v);
            onChange(Number(v || 0));
          }}
          onBlur={() => setEditando(null)}
          className="w-28 text-right tabular-nums border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg pl-6 pr-2 py-1 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
        />
      </span>
    </label>
  );
}

function AdminPanel({ wo, quote, t, onChange }) {
  const revenue = Number(wo.totalSale || 0);
  const partCost = Number(wo.glassCost || 0);
  const commission = Number(wo.commission || 0);
  const laborCost = Number(wo.laborCost || 0);
  // All three costs now subtract. Previously only partCost did — and since nothing ever wrote
  // glassCost/commission/laborCost for in-app orders, gross profit read 100% on every new job.
  // These are the same three columns the P&L report totals as its cost side.
  const grossProfit = revenue - partCost - commission - laborCost;
  const margin = revenue ? (grossProfit / revenue) * 100 : 0;

  return (
    <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">{t("adminPanel")}</h3>
        <Badge tone="info">{t("adminOnly")}</Badge>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1.5 text-sm">
        <Row label={t("revenue")} value={money(revenue)} />
        <Row label={t("partCost")} value={money(partCost)} />
        <Row label={t("grossProfit")} value={money(grossProfit)} emphasis tone={grossProfit >= 0 ? "paid" : "outstanding"} />
        <Row label={t("profitMargin")} value={`${margin.toFixed(1)}%`} emphasis />
      </div>
      {/* Editables aqui y no en los detalles de la orden: son costos, solo los ve el admin, y este
          es el unico lugar donde se leen contra el ingreso y el margen que mueven. Escriben en el
          mismo estado que el resto de la pagina, asi que se guardan con su boton y su aviso de
          cambios sin guardar — no hay un segundo camino de guardado. */}
      <div className="border-t dark:border-gray-800 mt-3 pt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 text-sm">
        {onChange ? (
          <>
            <MoneyInput label={t("agentCommission")} value={commission} onChange={(v) => onChange(["commission"], v)} />
            <MoneyInput label={t("technicianLabor")} value={laborCost} onChange={(v) => onChange(["laborCost"], v)} />
          </>
        ) : (
          <>
            <Row label={t("agentCommission")} value={money(commission)} />
            <Row label={t("technicianLabor")} value={money(laborCost)} />
          </>
        )}
      </div>
    </div>
  );
}

// Estado de pago (Pagado / Pendiente de pagar / —) para técnico, agente o distribuidor.
// `st` es la entrada de payableStatus para ese tipo: { exists, amount, paid }. `amount` de reserva
// para cuando el estado aún no cargó pero la orden ya tiene un monto (se muestra Pendiente).
// Y EN QUÉ lote se pagó (pedido de Antonio, 4-sep-2026): el número del pago va como enlace al
// lote, para llegar desde la orden sin buscarlo. Una orden puede estar en varios lotes (el vidrio
// en uno y un clip en otro), por eso se listan todos; y si una parte sigue pendiente se dice
// "parcial" en vez de fingir que está saldada.
function PaymentStatusRow({ label, st, amount, t }) {
  const monto = st ? st.amount : Number(amount || 0);
  let value = "—";
  let tone;
  if (st ? st.exists || st.amount > 0 : monto > 0) {
    if (st && st.paid) {
      value = t("paidStatus");
      tone = "paid";
    } else if (st && st.partial) {
      value = t("partialStatus");
      tone = "pending";
    } else {
      value = t("pendingStatus");
      tone = "outstanding";
    }
  }
  const lotes = st?.payouts || [];
  const texto = lotes.length ? (
    <>
      {value}
      <span className="block text-xs font-normal">
        {lotes.map((p, i) => (
          <span key={p.id}>
            {i > 0 && <span className="text-gray-400">, </span>}
            <Link href={`/dashboard/payments/${p.id}`} className="text-blue-600 hover:underline dark:text-blue-400">
              {p.paymentNumber || `#${p.id}`}
            </Link>
            {lotes.length > 1 && <span className="ml-1 text-gray-400">{money(p.amount)}</span>}
          </span>
        ))}
      </span>
    </>
  ) : value;
  return <Row label={label} value={texto} tone={tone} emphasis={value !== "—"} />;
}

export default function WorkOrderOperationsDashboard({ wo, quote, role, onChange, payableStatus }) {
  const t = useTranslations("operationsDashboard");
  const tw = useTranslations("workOrders");
  const isAdmin = role === "ADMIN";
  const [agent, setAgent] = useState(null);

  useEffect(() => {
    if (isAdmin && quote?.agentId) {
      getAgent(quote.agentId).then(setAgent).catch(() => setAgent(null));
    } else {
      setAgent(null);
    }
  }, [isAdmin, quote?.agentId]);

  return (
    <div className="space-y-6">
      <StatusTracker wo={wo} />

      <PaymentPanel wo={wo} t={t} />

      {isAdmin && (
        <>
          <AdminPanel wo={wo} quote={quote} t={t} onChange={onChange} />

          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">{t("adminOperations")}</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <TechnicianPanel wo={wo} quote={quote} t={t} tw={tw} payStatus={payableStatus?.TECH} />
              <AgentPanel wo={wo} quote={quote} agent={agent} t={t} payStatus={payableStatus?.AGENT} />
              <DistributorPanel wo={wo} quote={quote} t={t} payStatus={payableStatus?.DISTRIBUTOR} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
