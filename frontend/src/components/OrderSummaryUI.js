"use client";

export function money(n) {
  return `$${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Shared 4-color legend used across Quote/Work Order summary panels:
// info = neutral data, paid = fully settled, pending = awaiting action, outstanding = balance owed.
const TONES = {
  info: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
  paid: "bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300",
  pending: "bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300",
  outstanding: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
};

export function Badge({ tone = "info", children }) {
  return <span className={`inline-flex items-center whitespace-nowrap text-xs font-medium rounded-full px-2.5 py-1 ${TONES[tone]}`}>{children}</span>;
}

const TOTAL_CARD_TONES = {
  info: "from-blue-600 to-blue-500",
  paid: "from-green-600 to-green-500",
  pending: "from-orange-500 to-amber-500",
  outstanding: "from-red-600 to-red-500",
};

export function TotalCard({ label, amount, tone = "info", sublabel }) {
  return (
    <div className={`rounded-xl bg-gradient-to-br ${TOTAL_CARD_TONES[tone]} text-white p-5 shadow-sm`}>
      <div className="text-xs font-semibold uppercase tracking-wider text-white/80">{label}</div>
      <div className="text-4xl font-bold mt-1 tabular-nums">{money(amount)}</div>
      {sublabel && <div className="text-xs text-white/85 mt-1.5">{sublabel}</div>}
    </div>
  );
}

export function Section({ title, action, children }) {
  return (
    <div className="border-t first:border-t-0 dark:border-gray-800 pt-4 first:pt-0 mt-4 first:mt-0">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-400">{title}</h4>
        {action}
      </div>
      <div className="space-y-1.5 text-sm">{children}</div>
    </div>
  );
}

export function Row({ label, value, emphasis, tone }) {
  const toneClass = tone === "outstanding" ? "text-red-600 dark:text-red-400" : tone === "paid" ? "text-green-600 dark:text-green-400" : tone === "pending" ? "text-amber-600 dark:text-amber-400" : "";
  return (
    <div className="flex justify-between items-baseline gap-3">
      <span className="text-gray-500 dark:text-gray-400">{label}</span>
      <span className={`text-right tabular-nums ${emphasis ? "font-semibold" : ""} ${toneClass}`}>{value}</span>
    </div>
  );
}

export function Empty({ children }) {
  return <p className="text-gray-400 dark:text-gray-500 text-sm">{children}</p>;
}
