"use client";

import { useState } from "react";
import Sidebar from "@/components/Sidebar";
import Header from "@/components/Header";
import QuickViewSelector from "@/components/QuickViewSelector";
import AccessGuard from "@/components/AccessGuard";
import { TopBarSlotProvider, useTopBarSlotContent } from "@/lib/TopBarSlotContext";

function TopBarSlotOutlet() {
  const content = useTopBarSlotContent();
  return <div className="flex-1 min-w-0">{content}</div>;
}

export default function DashboardLayout({ children }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50 dark:bg-gray-950">
      <Sidebar mobileOpen={mobileOpen} onCloseMobile={() => setMobileOpen(false)} />
      <div className="flex flex-col flex-1 min-w-0">
        <Header onToggleSidebar={() => setMobileOpen((v) => !v)} />
        <main className="flex-1 overflow-y-auto p-6">
          <TopBarSlotProvider>
            <div className="flex items-center justify-end gap-3 mb-4">
              <TopBarSlotOutlet />
              <QuickViewSelector />
            </div>
            <AccessGuard>{children}</AccessGuard>
          </TopBarSlotProvider>
        </main>
      </div>
    </div>
  );
}
