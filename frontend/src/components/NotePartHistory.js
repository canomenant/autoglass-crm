"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

// La historia de la parte: el ciclo completo que una nota cuenta a medias. Comprada (factura del
// distribuidor, en que pago se descontó) → qué pasó con ella (cobrada al técnico / devuelta /
// instalada / pérdida) → si se devolvió, el crédito que la cerró y dónde se aplicó. Los datos
// vienen del SELECT enriquecido del store (relatedPaymentNumber, chargePaymentNumber, resolvedBy,
// fromDebit); aquí solo se pintan como línea de tiempo. Pasos grises punteados = lo que falta.

function money(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

function Chip({ href, tone, children }) {
  const tones = {
    blue: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/10 dark:text-blue-300 dark:border-blue-500/30",
    green: "bg-green-50 text-green-700 border-green-200 dark:bg-green-500/10 dark:text-green-300 dark:border-green-500/30",
    purple: "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-500/10 dark:text-purple-300 dark:border-purple-500/30",
    amber: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30",
    gray: "bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700",
  };
  const cls = `inline-flex items-center gap-1 text-xs font-medium border rounded-full px-2 py-0.5 ${tones[tone] || tones.gray}`;
  if (href) return <Link href={href} className={`${cls} hover:underline`}>{children}</Link>;
  return <span className={cls}>{children}</span>;
}

function Step({ state, title, children, last }) {
  // state: done (ya pasó), pending (falta), current (el eslabón que es esta nota)
  const dot =
    state === "pending"
      ? "border-2 border-dashed border-gray-300 dark:border-gray-600 bg-transparent"
      : state === "current"
        ? "bg-blue-600 ring-4 ring-blue-100 dark:ring-blue-500/20"
        : "bg-green-500";
  return (
    <li className="relative pl-6 pb-4 last:pb-0">
      {!last && <span className="absolute left-[5px] top-4 bottom-0 w-px bg-gray-200 dark:bg-gray-700" aria-hidden />}
      <span className={`absolute left-0 top-1 w-3 h-3 rounded-full ${dot}`} aria-hidden />
      <div className={`text-sm font-medium ${state === "pending" ? "text-gray-400 dark:text-gray-500" : "dark:text-gray-100"}`}>{title}</div>
      {children && <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">{children}</div>}
    </li>
  );
}

export default function NotePartHistory({ note, noteType }) {
  const t = useTranslations("notes");
  if (!note) return null;

  const steps = [];

  if (noteType === "DEBIT") {
    // 1. Comprada: la factura del distribuidor y el pago donde se descontó.
    steps.push(
      <Step key="buy" state="done" title={t("historyPurchased")}>
        {note.partNumber && <span className="font-mono">{note.partNumber}</span>}
        {note.invoiceNumber && <span>{t("historyInvoice")} {note.invoiceNumber}</span>}
        {note.issueDate && <span>{note.issueDate}</span>}
        <span>{money(note.amount)}</span>
        {note.relatedPaymentNumber ? (
          <Chip tone="blue" href={`/dashboard/payments/${note.relatedPaymentId}`}>{note.relatedPaymentNumber}</Chip>
        ) : (
          <span className="italic">{t("historyPendingApply")}</span>
        )}
      </Step>
    );

    if (note.resolution === "TECH") {
      steps.push(
        <Step key="tech" state={note.chargePayoutId ? "done" : "pending"} title={t("historyChargedTech")} last>
          {note.technician && <span>{note.technician}</span>}
          {note.chargePayoutId ? (
            <Chip tone="purple" href={`/dashboard/payments/${note.chargePayoutId}`}>{note.chargePaymentNumber || `#${note.chargePayoutId}`}</Chip>
          ) : (
            <span className="italic">{t("historyPendingCharge")}</span>
          )}
        </Step>
      );
    } else if (note.resolution === "RETURNED") {
      steps.push(<Step key="ret" state="done" title={t("historyReturned")} />);
      if (note.resolvedBy) {
        steps.push(
          <Step key="cred" state="done" title={t("historyCredited")}>
            <Chip tone="green" href={`/dashboard/payments/credit-notes/${note.resolvedBy.id}`}>{note.resolvedBy.noteNumber}</Chip>
            {note.resolvedBy.invoiceNumber && <span>{t("historyInvoice")} {note.resolvedBy.invoiceNumber}</span>}
            {note.resolvedBy.issueDate && <span>{note.resolvedBy.issueDate}</span>}
          </Step>,
          <Step key="app" state={note.resolvedBy.paymentNumber ? "done" : "pending"} title={t("historyApplied")} last>
            {note.resolvedBy.paymentNumber ? (
              <Chip tone="blue" href={`/dashboard/payments/${note.resolvedBy.paymentId}`}>{note.resolvedBy.paymentNumber}</Chip>
            ) : (
              <span className="italic">{t("historyPendingApply")}</span>
            )}
          </Step>
        );
      } else {
        steps.push(<Step key="cred" state="pending" title={t("historyCredited")} last>{t("historyPendingCredit")}</Step>);
      }
    } else if (note.resolution === "INSTALLED") {
      steps.push(
        <Step key="inst" state="done" title={t("historyInstalled")} last>
          {note.resolutionWorkOrderNo && <Chip tone="blue">{note.resolutionWorkOrderNo}</Chip>}
        </Step>
      );
    } else if (note.resolution === "LOSS") {
      steps.push(<Step key="loss" state="done" title={t("historyLoss")} last />);
    } else {
      steps.push(<Step key="open" state="pending" title={t("historyOpenStep")} last />);
    }
  } else {
    // CREDITO: si viene de una parte devuelta, contamos el ciclo completo desde la compra.
    if (note.fromDebit) {
      steps.push(
        <Step key="buy" state="done" title={t("historyPurchased")}>
          {note.fromDebit.partNumber && <span className="font-mono">{note.fromDebit.partNumber}</span>}
          {note.fromDebit.invoiceNumber && <span>{t("historyInvoice")} {note.fromDebit.invoiceNumber}</span>}
          {note.fromDebit.issueDate && <span>{note.fromDebit.issueDate}</span>}
          <span>{money(note.fromDebit.amount)}</span>
          {note.fromDebit.paymentNumber && (
            <Chip tone="blue" href={`/dashboard/payments/${note.fromDebit.paymentId}`}>{note.fromDebit.paymentNumber}</Chip>
          )}
        </Step>,
        <Step key="ret" state="done" title={t("historyReturned")}>
          <Chip tone="amber" href={`/dashboard/payments/debit-notes/${note.fromDebit.id}`}>{note.fromDebit.noteNumber}</Chip>
        </Step>
      );
    }
    steps.push(
      <Step key="cred" state="current" title={t("historyCredited")}>
        {note.invoiceNumber && <span>{t("historyInvoice")} {note.invoiceNumber}</span>}
        {note.issueDate && <span>{note.issueDate}</span>}
        <span>{money(note.amount)}</span>
      </Step>,
      <Step key="app" state={note.relatedPaymentNumber ? "done" : "pending"} title={t("historyApplied")} last>
        {note.relatedPaymentNumber ? (
          <Chip tone="blue" href={`/dashboard/payments/${note.relatedPaymentId}`}>{note.relatedPaymentNumber}</Chip>
        ) : (
          <span className="italic">{t("historyPendingApply")}</span>
        )}
      </Step>
    );
  }

  return (
    <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4 mb-6">
      <h2 className="font-semibold mb-1 dark:text-gray-100">{t("historyTitle")}</h2>
      {noteType === "CREDIT" && !note.fromDebit && (
        <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">{t("historyNoLink")}</p>
      )}
      <ol className="mt-3">{steps}</ol>
    </section>
  );
}
