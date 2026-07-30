const paths = {
  target: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1" />
    </>
  ),
  "credit-card": (
    <>
      <rect x="2.5" y="5.5" width="19" height="14" rx="2" />
      <line x1="2.5" y1="10" x2="21.5" y2="10" />
    </>
  ),
  receipt: (
    <>
      <path d="M5 3.5h14v17l-2.5-1.5L14 20.5l-2-1.5-2 1.5-2.5-1.5L5 20.5V3.5Z" />
      <line x1="8" y1="8" x2="16" y2="8" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </>
  ),
  barcode: (
    <>
      <line x1="4" y1="4" x2="4" y2="20" />
      <line x1="8" y1="4" x2="8" y2="20" />
      <line x1="11" y1="4" x2="11" y2="20" />
      <line x1="14" y1="4" x2="14" y2="20" />
      <line x1="17" y1="4" x2="17" y2="20" />
      <line x1="20" y1="4" x2="20" y2="20" />
    </>
  ),
  layers: (
    <>
      <polygon points="12,3 21,8 12,13 3,8" />
      <polyline points="3,13 12,18 21,13" />
    </>
  ),
  shapes: (
    <>
      <polygon points="9,3 15,3 12,9" />
      <circle cx="17" cy="16" r="4" />
      <rect x="3" y="13" width="7" height="7" rx="1" />
    </>
  ),
  car: (
    <>
      <path d="M4 16V11l2-5h12l2 5v5" />
      <path d="M2.5 16h19v3h-3v-1.5h-13V19h-3v-3Z" />
      <circle cx="7" cy="17.5" r="1.5" />
      <circle cx="17" cy="17.5" r="1.5" />
    </>
  ),
  building: (
    <>
      <rect x="5" y="3" width="10" height="18" />
      <rect x="15" y="9" width="5" height="12" />
      <line x1="8" y1="7" x2="8" y2="7" />
      <line x1="8" y1="7" x2="8.01" y2="7" />
      <line x1="7.5" y1="7" x2="8.5" y2="7" />
      <line x1="7.5" y1="11" x2="8.5" y2="11" />
      <line x1="11.5" y1="7" x2="12.5" y2="7" />
      <line x1="11.5" y1="11" x2="12.5" y2="11" />
      <line x1="7.5" y1="15" x2="8.5" y2="15" />
      <line x1="11.5" y1="15" x2="12.5" y2="15" />
    </>
  ),
  briefcase: (
    <>
      <rect x="2.5" y="7.5" width="19" height="12" rx="2" />
      <path d="M8 7.5V5.5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="2.5" y1="12.5" x2="21.5" y2="12.5" />
    </>
  ),
  "map-pin": (
    <>
      <path d="M12 21s7-6.5 7-12a7 7 0 1 0-14 0c0 5.5 7 12 7 12Z" />
      <circle cx="12" cy="9" r="2.5" />
    </>
  ),
  tag: (
    <>
      <path d="M3 11.5 11.5 3H19a2 2 0 0 1 2 2v7.5L12.5 21 3 11.5Z" />
      <circle cx="15" cy="8" r="1.2" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3 5 6v5c0 5 3 8 7 10 4-2 7-5 7-10V6Z" />
      <polyline points="9,12 11,14 15,10" />
    </>
  ),
  wrench: (
    <>
      <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2-2Z" />
    </>
  ),
  handshake: (
    <>
      <path d="m11 17 2 2a2 2 0 1 0 3-3" />
      <path d="m14 14 3 3a2 2 0 1 0 3-3l-3.5-3.5" />
      <path d="m11 17-3.5-3.5a2 2 0 0 1 0-2.83l1.5-1.5a2 2 0 0 1 2.83 0L14 12" />
      <path d="M3 10.5 8 5l3.5 3.5" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5" />
      <path d="M16.5 5.5a3.5 3.5 0 0 1 0 6.9" />
      <path d="M20 20c0-2.9-1.9-5.3-4.5-6.2" />
    </>
  ),
  lock: (
    <>
      <rect x="4.5" y="11" width="15" height="10" rx="2" />
      <path d="M7.5 11V7.5a4.5 4.5 0 0 1 9 0V11" />
    </>
  ),
  sliders: (
    <>
      <line x1="4" y1="6" x2="20" y2="6" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="18" x2="20" y2="18" />
      <circle cx="9" cy="6" r="2" />
      <circle cx="16" cy="12" r="2" />
      <circle cx="10" cy="18" r="2" />
    </>
  ),
  bell: (
    <>
      <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </>
  ),
  plug: (
    <>
      <path d="M9 3v6M15 3v6" />
      <path d="M6.5 9h11v3.5a5.5 5.5 0 0 1-11 0V9Z" />
      <path d="M12 16.5V21" />
    </>
  ),
  cog: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 3.5v2.4M12 18.1v2.4M20.5 12h-2.4M5.9 12H3.5M17.7 6.3l-1.7 1.7M8 16l-1.7 1.7M17.7 17.7 16 16M8 8 6.3 6.3" />
    </>
  ),
};

export default function SettingsIcon({ name, className = "w-6 h-6" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {paths[name] || <circle cx="12" cy="12" r="9" />}
    </svg>
  );
}
