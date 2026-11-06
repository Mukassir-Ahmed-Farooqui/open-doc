import { FolderOpen, Home, LogOut, Moon, Plus, Search, Settings, Sun } from "lucide-react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/ui/Button";
import { buttonClass } from "@/components/ui/buttonStyles";
import { Kbd } from "@/components/ui/Kbd";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/Menu";
import { cn } from "@/lib/cn";
import { modKey } from "@/lib/platform";
import { useTheme } from "@/theme/ThemeProvider";
import { ConversationList } from "./ConversationList";
import { Logo } from "./Logo";

const NAV = [
  { to: "/", label: "Home", icon: Home, end: true },
  { to: "/documents", label: "Library", icon: FolderOpen, end: false },
  { to: "/settings", label: "Settings", icon: Settings, end: false },
];

const navItem = (isActive: boolean) =>
  cn(
    "flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors pointer-coarse:h-11",
    isActive ? "bg-surface-3 font-medium text-fg" : "text-fg-muted hover:bg-surface-3/60 hover:text-fg",
  );

export function Sidebar({ onNavigate, onOpenPalette }: { onNavigate?: () => void; onOpenPalette: () => void }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { resolved, toggle } = useTheme();
  const initial = (user?.full_name || user?.email || "?").trim().charAt(0).toUpperCase();
  return (
    <div className="flex h-full flex-col bg-surface-2 pt-[env(safe-area-inset-top)]">
      <div className="flex h-14 items-center justify-between pr-2 pl-4">
        <Link to="/" onClick={onNavigate} aria-label="OpenDoc home" className="rounded-md">
          <Logo />
        </Link>
        <Button variant="ghost" size="icon-sm" onClick={toggle} aria-label={`Switch to ${resolved === "dark" ? "light" : "dark"} mode`}>
          {resolved === "dark" ? <Sun /> : <Moon />}
        </Button>
      </div>
      <div className="space-y-0.5 px-3 pb-3">
        <Link to="/chat" onClick={onNavigate} className={buttonClass("primary", "md", "mb-3 w-full")}>
          <Plus aria-hidden /> New question
        </Link>
        <button type="button" onClick={onOpenPalette} className={cn(navItem(false), "w-full")}>
          <Search className="size-4" aria-hidden />
          <span className="flex-1 text-left">Search</span>
          <span className="flex gap-0.5 pointer-coarse:hidden">
            <Kbd>{modKey}</Kbd>
            <Kbd>K</Kbd>
          </span>
        </button>
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} onClick={onNavigate} className={({ isActive }) => navItem(isActive)}>
            <Icon className="size-4" aria-hidden />
            {label}
          </NavLink>
        ))}
      </div>
      <ConversationList onNavigate={onNavigate} />
      <div className="border-t border-line p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <Menu>
          <MenuTrigger asChild>
            <button className="flex w-full items-center gap-2.5 rounded-md p-2 text-left transition-colors hover:bg-surface-3/60">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-soft font-serif text-sm font-semibold text-accent-soft-fg">
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
