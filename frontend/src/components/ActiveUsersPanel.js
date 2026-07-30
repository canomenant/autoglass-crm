"use client";

import { useEffect, useState } from "react";
import { getActiveUsers } from "@/lib/api";
import { UsersIcon } from "@/components/Icons";

function initials(name) {
  return (name || "?")
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function timeAgo(iso) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ago`;
}

export default function ActiveUsersPanel({ open, onCountChange }) {
  const [users, setUsers] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    function load() {
      getActiveUsers()
        .then((data) => {
          setUsers(data);
          onCountChange?.(data.length);
        })
        .catch((e) => setError(e.message));
    }
    load();
    const interval = setInterval(load, 10000);
    return () => clearInterval(interval);
  }, [onCountChange]);

  if (!open) return null;

  return (
    <div className="absolute right-0 mt-2 w-96 bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-xl border border-slate-100 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100 dark:border-gray-800 bg-slate-50 dark:bg-gray-800/40">
        <UsersIcon className="w-4 h-4 text-blue-600 dark:text-blue-400" />
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-gray-400">Active Users</span>
        <span className="ml-auto text-xs font-medium bg-blue-600 text-white rounded-full px-2 py-0.5">{users.length}</span>
      </div>

      <div className="max-h-96 overflow-y-auto p-3">
        {error && <p className="text-red-600 dark:text-red-400 text-xs px-1 pb-2">{error}</p>}

        {users.length === 0 && !error && (
          <p className="text-sm text-slate-400 dark:text-gray-500 text-center py-6">No active users right now.</p>
        )}

        <div className="grid grid-cols-2 gap-2">
          {users.map((u) => (
            <div key={u.id} className="border border-slate-100 dark:border-gray-800 rounded-lg p-3 flex items-center gap-3">
              <div className="relative flex-shrink-0">
                <div className="w-9 h-9 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-semibold">
                  {initials(u.name)}
                </div>
                <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-500 border-2 border-white dark:border-gray-900" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium text-slate-700 dark:text-gray-200 truncate">{u.name}</div>
                <div className="text-xs text-slate-400 dark:text-gray-500 truncate">{u.role}</div>
                <div className="text-[10px] text-slate-300 dark:text-gray-600">{timeAgo(u.last_active_at)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
