import { FolderOpen, Home, MessageSquareText, Settings } from "lucide-react";
import { NavLink } from "react-router-dom";
import { cn } from "@/lib/cn";

const ITEMS = [
  { to: "/", label: "Home", icon: Home, end: true },
  { to: "/documents", label: "Library", icon: FolderOpen, end: true },
  { to: "/chat", label: "Ask", icon: MessageSquareText, end: false },
  { to: "/settings", label: "Settings", icon: Settings, end: false },
];

/** Mobile primary navigation. 56 px tall plus the home-indicator inset; every target is >= 44 px. */
export function BottomNav() {
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] safe-x md:hidden"
    >
      <ul className="mx-auto grid h-14 max-w-md grid-cols-4">
        {ITEMS.map(({ to, label, icon: Icon, end }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  "flex h-full flex-col items-center justify-center gap-0.5 text-2xs font-medium transition-colors",
                  isActive ? "text-accent-soft-fg" : "text-fg-muted hover:text-fg",
                )
              }
            >
              <Icon className="size-5" aria-hidden />
              {label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
