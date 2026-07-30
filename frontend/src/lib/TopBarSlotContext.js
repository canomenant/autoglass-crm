"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

const TopBarSlotContext = createContext(null);

export function TopBarSlotProvider({ children }) {
  const [content, setContent] = useState(null);
  // Memoized so the context value only changes when `content` actually does — otherwise every
  // Provider render (including ones triggered by its own children) hands consumers a new object,
  // which re-triggers their effects and can cascade into an infinite render loop.
  const value = useMemo(() => ({ content, setContent }), [content]);
  return <TopBarSlotContext.Provider value={value}>{children}</TopBarSlotContext.Provider>;
}

export function useTopBarSlot(node) {
  const ctx = useContext(TopBarSlotContext);
  useEffect(() => {
    if (!ctx) return;
    ctx.setContent(node);
    return () => ctx.setContent(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, node]);
}

export function useTopBarSlotContent() {
  const ctx = useContext(TopBarSlotContext);
  return ctx?.content ?? null;
}
