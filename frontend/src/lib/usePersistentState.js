"use client";

import { useEffect, useState } from "react";

// Estado que sobrevive a salir y volver de la pantalla (localStorage). Nació para los filtros de
// los reportes de pagos: se filtraba, se entraba a un lote, y al volver el filtro estaba limpio
// (Antonio, 29-ago-2026: "que el filtro se quede activado hasta que le demos Clear Filter").
//
// El valor guardado se FUNDE sobre el inicial, campo por campo: si el shape del filtro cambia en
// un deploy, los campos nuevos toman su default y los guardados viejos que ya no existan se
// ignoran solos. Se carga en un efecto y no en el useState inicial porque en el primer render de
// Next no hay localStorage (SSR/hydration).
export default function usePersistentState(key, initial) {
  const [value, setValue] = useState(initial);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw != null) {
        const saved = JSON.parse(raw);
        if (saved && typeof saved === "object") setValue((prev) => ({ ...prev, ...saved }));
      }
    } catch {
      // Sin storage (privado, bloqueado) el filtro simplemente no persiste.
    }
    setLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (!loaded) return; // no pisar lo guardado con el default antes de haberlo leído
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  }, [key, value, loaded]);

  return [value, setValue];
}
