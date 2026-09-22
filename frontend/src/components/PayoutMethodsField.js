"use client";

import { useTranslations } from "next-intl";
import PhoneInput from "./PhoneInput";
import { PAYOUT_METHODS, NO_HANDLE, HANDLE_HINT, emptyPayoutMethod } from "@/lib/payoutMethods";

// Las formas en que se le manda el pago a un técnico o a un agente: Zelle al (469) 610-6271 a
// nombre de Efficiency Auto Glass, un cheque a otro nombre… (Antonio, 21-sep-2026). Acepta
// varias porque un técnico suele dar dos opciones, y una va marcada como la preferida: es la que
// sale en el lote y en el correo al socio.
//
// Mismo componente en la ficha del técnico y en la del agente para que el dato se capture igual
// en los dos lados.
const INPUT =
  "w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow";

export default function PayoutMethodsField({ value, onChange }) {
  const t = useTranslations("payout");
  const list = Array.isArray(value) ? value : [];

  function set(i, campo, v) {
    onChange(list.map((m, j) => (j === i ? { ...m, [campo]: v } : m)));
  }

  // Sólo una preferida: marcar una desmarca la anterior, así nunca hay dos "por aquí págale".
  function setPreferred(i) {
    onChange(list.map((m, j) => ({ ...m, preferred: j === i })));
  }

  function add() {
    onChange([...list, { ...emptyPayoutMethod(), preferred: list.length === 0 }]);
  }

  function remove(i) {
    const rest = list.filter((_, j) => j !== i);
    // Si se borró la preferida, la primera que quede toma el relevo.
    if (rest.length && !rest.some((m) => m.preferred)) rest[0] = { ...rest[0], preferred: true };
    onChange(rest);
  }

  return (
    <div>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">{t("hint")}</p>

      {list.length === 0 && <p className="text-sm text-gray-400 dark:text-gray-500 mb-3">{t("empty")}</p>}

      <div className="space-y-3">
        {list.map((m, i) => {
          const pideDestino = !NO_HANDLE.has(m.method);
          const hint = HANDLE_HINT[m.method];
          // Zelle acepta teléfono o correo, así que no se puede forzar la máscara de teléfono:
          // se usa sólo cuando lo que hay escrito son puros dígitos.
          const soloDigitos = /^[\d()\s.+-]*$/.test(m.handle || "");
          return (
            <div key={i} className="border border-gray-200 dark:border-gray-800 rounded-lg p-3">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{t("method")}</label>
                  <select value={m.method} onChange={(e) => set(i, "method", e.target.value)} className={INPUT}>
                    {PAYOUT_METHODS.map((x) => (
                      <option key={x} value={x}>{x}</option>
                    ))}
                  </select>
                </div>

                {pideDestino && (
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{t(hint?.key || "handle")}</label>
                    {m.method === "Zelle" && soloDigitos ? (
                      <PhoneInput value={m.handle} onChange={(v) => set(i, "handle", v)} className={INPUT} />
                    ) : (
                      <input value={m.handle} onChange={(e) => set(i, "handle", e.target.value)} placeholder={hint?.placeholder || ""} className={INPUT} />
                    )}
                  </div>
                )}

                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{t("holderName")}</label>
                  <input value={m.holderName} onChange={(e) => set(i, "holderName", e.target.value)} placeholder={t("holderNamePlaceholder")} className={INPUT} />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 mt-3 items-end">
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{t("notes")}</label>
                  <input value={m.notes} onChange={(e) => set(i, "notes", e.target.value)} placeholder={t("notesPlaceholder")} className={INPUT} />
                </div>
                <div className="flex items-center gap-4 pb-1">
                  <label className="flex items-center gap-2 text-sm whitespace-nowrap">
                    <input type="radio" name="payout-preferred" checked={!!m.preferred} onChange={() => setPreferred(i)} />
                    {t("preferred")}
                  </label>
                  <button type="button" onClick={() => remove(i)} className="text-red-600 text-sm hover:underline">
                    {t("remove")}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <button type="button" onClick={add} className="mt-3 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm text-blue-600 dark:text-blue-400">
        + {t("add")}
      </button>
    </div>
  );
}
