function Icon({ children, className = "w-5 h-5" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      {children}
    </svg>
  );
}

export function DashboardIcon(props) {
  return (
    <Icon {...props}>
      <rect x="3" y="3" width="8" height="9" rx="1.5" />
      <rect x="13" y="3" width="8" height="5" rx="1.5" />
      <rect x="13" y="12" width="8" height="9" rx="1.5" />
      <rect x="3" y="16" width="8" height="5" rx="1.5" />
    </Icon>
  );
}

export function QuotesIcon(props) {
  return (
    <Icon {...props}>
      <path d="M7 3h7l4 4v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
      <path d="M14 3v4h4" />
      <line x1="8.5" y1="12" x2="15.5" y2="12" />
      <line x1="8.5" y1="16" x2="13.5" y2="16" />
    </Icon>
  );
}

export function WorkOrdersIcon(props) {
  return (
    <Icon {...props}>
      <path d="M14.7 6.3a4 4 0 0 1-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 1 5.4-5.4L15 12l-3-3 2.7-2.7Z" />
    </Icon>
  );
}

export function CustomersIcon(props) {
  return (
    <Icon {...props}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 20a5.5 5.5 0 0 1 11 0" />
      <circle cx="17.5" cy="9" r="2.6" />
      <path d="M14.7 20a4.7 4.7 0 0 1 8-3.3" />
    </Icon>
  );
}

export function ExpensesIcon(props) {
  return (
    <Icon {...props}>
      <path d="M3 7h13a2 2 0 0 1 2 2v9H5a2 2 0 0 1-2-2V7Z" />
      <path d="M18 10h3v6h-3" />
      <circle cx="9.5" cy="12.5" r="2" />
    </Icon>
  );
}

export function PaymentsIcon(props) {
  return (
    <Icon {...props}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <line x1="6" y1="15" x2="10" y2="15" />
    </Icon>
  );
}

export function ReportsIcon(props) {
  return (
    <Icon {...props}>
      <line x1="5" y1="21" x2="5" y2="11" />
      <line x1="12" y1="21" x2="12" y2="6" />
      <line x1="19" y1="21" x2="19" y2="14" />
      <line x1="3" y1="21" x2="21" y2="21" />
    </Icon>
  );
}

export function UsersIcon(props) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </Icon>
  );
}

export function SettingsIcon(props) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 13a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.04 1.56V19.4a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.04-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.04H4.6a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 6.25 8.4a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H10.6A1.7 1.7 0 0 0 11.63 2.6V2.6a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.04 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V8.6a1.7 1.7 0 0 0 1.56 1.04h.09a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.56 1.04Z" />
    </Icon>
  );
}

export function ClockIcon(props) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </Icon>
  );
}

export function TrendingUpIcon(props) {
  return (
    <Icon {...props}>
      <polyline points="3,17 9,11 13,15 21,6" />
      <polyline points="15,6 21,6 21,12" />
    </Icon>
  );
}

export function DollarIcon(props) {
  return (
    <Icon {...props}>
      <line x1="12" y1="2" x2="12" y2="22" />
      <path d="M17 6.5C17 4.6 14.8 3 12 3s-5 1.6-5 3.5S9.2 10 12 10s5 1.6 5 3.5S14.8 17 12 17s-5-1.6-5-3.5" />
    </Icon>
  );
}

export function TeamIcon(props) {
  return (
    <Icon {...props}>
      <circle cx="8" cy="9" r="3" />
      <circle cx="16" cy="9" r="3" />
      <path d="M2.5 20a5.5 5.5 0 0 1 11 0" />
      <path d="M10.5 20a5.5 5.5 0 0 1 11 0" />
    </Icon>
  );
}

export function ActivityIcon(props) {
  return (
    <Icon {...props}>
      <polyline points="3,12 8,12 10,18 14,6 16,12 21,12" />
    </Icon>
  );
}

export function TagIcon(props) {
  return (
    <Icon {...props}>
      <path d="M20.6 12.6 12.7 20.5a2 2 0 0 1-2.8 0l-6.4-6.4a2 2 0 0 1 0-2.8L11.4 3.4A2 2 0 0 1 12.8 3H19a2 2 0 0 1 2 2v6.2a2 2 0 0 1-.4 1.4Z" />
      <circle cx="15.5" cy="7.5" r="1.2" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function CloseIcon(props) {
  return (
    <Icon {...props}>
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </Icon>
  );
}

export function PlusIcon(props) {
  return (
    <Icon {...props}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </Icon>
  );
}

export function DownloadIcon(props) {
  return (
    <Icon {...props}>
      <path d="M12 3v12" />
      <polyline points="7,10 12,15 17,10" />
      <path d="M4 19h16" />
    </Icon>
  );
}

export function CheckIcon(props) {
  return (
    <Icon {...props}>
      <polyline points="5,13 10,18 19,7" />
    </Icon>
  );
}

export function CreditCardIcon(props) {
  return (
    <Icon {...props}>
      <rect x="2" y="5" width="20" height="15" rx="2" />
      <line x1="2" y1="10" x2="22" y2="10" />
      <line x1="6" y1="15" x2="10" y2="15" />
    </Icon>
  );
}

export function SearchIcon(props) {
  return (
    <Icon {...props}>
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </Icon>
  );
}

export function RefreshIcon(props) {
  return (
    <Icon {...props}>
      <path d="M3 12a9 9 0 0 1 15.3-6.4L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15.3 6.4L3 16" />
      <path d="M3 21v-5h5" />
    </Icon>
  );
}

export function BookmarkIcon(props) {
  return (
    <Icon {...props}>
      <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1Z" />
    </Icon>
  );
}

export function ChevronUpIcon(props) {
  return (
    <Icon {...props}>
      <polyline points="6,15 12,9 18,15" />
    </Icon>
  );
}

export function ChevronDownIcon(props) {
  return (
    <Icon {...props}>
      <polyline points="6,9 12,15 18,9" />
    </Icon>
  );
}

export function ColumnsIcon(props) {
  return (
    <Icon {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <line x1="9" y1="4" x2="9" y2="20" />
      <line x1="15" y1="4" x2="15" y2="20" />
    </Icon>
  );
}

export function GripIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={props.className || "w-3.5 h-3.5"}>
      <circle cx="8" cy="6" r="1.4" /><circle cx="16" cy="6" r="1.4" />
      <circle cx="8" cy="12" r="1.4" /><circle cx="16" cy="12" r="1.4" />
      <circle cx="8" cy="18" r="1.4" /><circle cx="16" cy="18" r="1.4" />
    </svg>
  );
}

export function CarIcon(props) {
  return (
    <Icon {...props}>
      <path d="M5 11 6.5 6a2 2 0 0 1 1.9-1.4h7.2A2 2 0 0 1 17.5 6L19 11" />
      <path d="M3.5 11h17a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H19a1 1 0 0 1-1-1v-1H6v1a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1Z" />
      <circle cx="7.5" cy="15" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="16.5" cy="15" r="1.2" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function ShieldIcon(props) {
  return (
    <Icon {...props}>
      <path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6l-7-3Z" />
    </Icon>
  );
}

export function CalendarIcon(props) {
  return (
    <Icon {...props}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <line x1="8" y1="3" x2="8" y2="7" />
      <line x1="16" y1="3" x2="16" y2="7" />
    </Icon>
  );
}

export function TruckIcon(props) {
  return (
    <Icon {...props}>
      <rect x="1" y="7" width="13" height="10" rx="1" />
      <path d="M14 10h4l3 3v4h-7z" />
      <circle cx="6" cy="19" r="1.6" />
      <circle cx="16.5" cy="19" r="1.6" />
    </Icon>
  );
}

export function FolderIcon(props) {
  return (
    <Icon {...props}>
      <path d="M3 6a1 1 0 0 1 1-1h4.5l2 2H20a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6Z" />
    </Icon>
  );
}

export function EyeIcon(props) {
  return (
    <Icon {...props}>
      <path d="M1.5 12S5 5 12 5s10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </Icon>
  );
}

export function EyeOffIcon(props) {
  return (
    <Icon {...props}>
      <path d="M3 3l18 18" />
      <path d="M10.6 5.1A10.7 10.7 0 0 1 12 5c7 0 10.5 7 10.5 7a13.5 13.5 0 0 1-3.1 4.1M6.6 6.6C3.6 8.4 1.5 12 1.5 12S5 19 12 19a10.3 10.3 0 0 0 4.2-.9" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </Icon>
  );
}

export function ClipboardIcon(props) {
  return (
    <Icon {...props}>
      <rect x="6" y="4" width="12" height="17" rx="1.5" />
      <path d="M9 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1" />
    </Icon>
  );
}
