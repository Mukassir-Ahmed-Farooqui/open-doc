import { FolderOpen, Home, Moon, Plus, Search, Settings, Sun, LogOut } from "lucide-react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/ui/Button";
import { Kbd } from "@/components/ui/Kbd";
import { modKey } from "@/lib/platform";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/Menu";
import { cn } from "@/lib/cn";
import { useTheme } from "@/theme/ThemeProvider";
import { ConversationList } from "./ConversationList";
import { Logo } from "./Logo";

const nav = [
  { to: "/", label: "Home", icon: Home, end: true },
  { to: "/documents", label: "Library", icon: FolderOpen, end: false },
  { to: "/settings", label: "Settings", icon: Settings, end: false },
];

export function Sidebar({ onNavigate, onOpenPalette }: { onNavigate?: () => void; onOpenPalette: () => void }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { resolved, toggle } = useTheme();
  const initial = (user?.full_name || user?.email || "?").trim().charAt(0).toUpperCase();
  return (
    <div className="flex h-full flex-col bg-surface-2/70">
      <div className="flex h-14 items-center justify-between px-4">
        <Link to="/" onClick={onNavigate} aria-label="OpenDoc home">
          <Logo />
        </Link>
        <Button variant="ghost" size="icon-sm" onClick={toggle} aria-label={`Switch to ${resolved === "dark" ? "light" : "dark"} mode`}>
          {resolved === "dark" ? <Sun /> : <Moon />}
        </Button>
      </div>
      <div className="space-y-1 px-3 pb-3">
        <Link
          to="/chat"
          onClick={onNavigate}
          className="mb-2 flex h-8 w-full items-center justify-center gap-2 rounded-md bg-accent text-sm font-medium text-accent-fg shadow-xs transition-colors hover:bg-accent-hover"
        >
          <Plus className="size-4" aria-hidden /> New chat
        </Link>
        <button
          onClick={onOpenPalette}
          className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm text-fg-muted transition-colors hover:bg-surface-3/60 hover:text-fg"
        >
          <Search className="size-4" aria-hidden />
          <span className="flex-1 text-left">Search</span>
          <Kbd>{modKey}</Kbd>
          <Kbd>K</Kbd>
        </button>
        {nav.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                "flex h-8 items-center gap-2 rounded-md px-2 text-sm transition-colors",
                isActive ? "bg-surface-3 font-medium text-fg" : "text-fg-muted hover:bg-surface-3/60 hover:text-fg",
              )
            }
          >
            <Icon className="size-4" aria-hidden />
            {label}
          </NavLink>
        ))}
      </div>
      <div className="mx-3 mb-2 h-px bg-line" />
      <ConversationList onNavigate={onNavigate} />
      <div className="border-t border-line p-2">
        <Menu>
          <MenuTrigger asChild>
            <button className="flex w-full items-center gap-2.5 rounded-md p-2 text-left transition-colors hover:bg-surface-3/60">
              <span className="flex size-7 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent-soft-fg">
                {initial}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{user?.full_name || "Your account"}</span>
                <span className="block truncate text-xs text-fg-subtle">{user?.email ?? ""}</span>
              </span>
            </button>
          </MenuTrigger>
          <MenuContent align="start" className="w-56">
            <MenuItem
              icon={<Settings />}
              onSelect={() => {
                navigate("/settings");
                onNavigate?.();
              }}
            >
              Settings
            </MenuItem>
            <MenuSeparator />
            <MenuItem icon={<LogOut />} onSelect={logout}>
              Sign out
            </MenuItem>
          </MenuContent>
        </Menu>
      </div>
    </div>
  );
}
