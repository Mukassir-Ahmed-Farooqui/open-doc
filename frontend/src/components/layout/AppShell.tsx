import * as RD from "@radix-ui/react-dialog";
import { History } from "lucide-react";
import { useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { focusPrimaryInput, useHotkeys } from "@/hooks/useHotkeys";
import { BottomNav } from "./BottomNav";
import { CommandPalette } from "./CommandPalette";
import { Logo } from "./Logo";
import { Sidebar } from "./Sidebar";

/** Routes with their own bottom controls (composer, page nav) hide the mobile bottom nav. */
const FOCUSED = [/^\/chat(\/|$)/, /^\/documents\/[^/]+/];

export function AppShell() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { pathname } = useLocation();
  const focused = FOCUSED.some((re) => re.test(pathname));

  useHotkeys([
    { combo: "mod+k", handler: () => setPaletteOpen((o) => !o) },
    { combo: "mod+/", handler: () => focusPrimaryInput() },
  ]);

  return (
    <div className="flex h-dvh overflow-hidden bg-bg safe-x">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:shadow-lg"
      >
        Skip to content
      </a>
      <aside className="hidden w-64 shrink-0 border-r border-line md:block" aria-label="Sidebar">
        <Sidebar onOpenPalette={() => setPaletteOpen(true)} />
      </aside>

      <RD.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
        <RD.Portal>
          <RD.Overlay className="fixed inset-0 z-40 bg-[oklch(0.15_0.02_275/0.45)] animate-fade-in md:hidden" />
          <RD.Content className="fixed inset-y-0 left-0 z-50 w-[min(19rem,86vw)] border-r border-line shadow-lg animate-slide-in-left focus:outline-none md:hidden">
            <RD.Title className="sr-only">Navigation</RD.Title>
            <RD.Description className="sr-only">Main navigation and conversation history</RD.Description>
            <Sidebar
              onNavigate={() => setDrawerOpen(false)}
              onOpenPalette={() => {
                setDrawerOpen(false);
                setPaletteOpen(true);
              }}
            />
          </RD.Content>
        </RD.Portal>
      </RD.Root>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center gap-1 border-b border-line bg-surface pt-[env(safe-area-inset-top)] pr-2 pl-3 md:hidden">
          <Link to="/" aria-label="OpenDoc home" className="flex h-14 flex-1 items-center">
            <Logo className="text-base" />
          </Link>
          <Button variant="ghost" size="icon" onClick={() => setDrawerOpen(true)} aria-label="Open navigation and history">
            <History />
          </Button>
        </header>
        <main id="main" className="min-h-0 flex-1 overflow-hidden" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
      {!focused && <BottomNav />}
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}
