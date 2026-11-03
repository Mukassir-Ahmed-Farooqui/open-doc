import * as RD from "@radix-ui/react-dialog";
import { Menu as MenuIcon } from "lucide-react";
import { useState } from "react";
import { Outlet } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { focusPrimaryInput, useHotkeys } from "@/hooks/useHotkeys";
import { CommandPalette } from "./CommandPalette";
import { Logo } from "./Logo";
import { Sidebar } from "./Sidebar";

export function AppShell() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useHotkeys([
    { combo: "mod+k", handler: () => setPaletteOpen((o) => !o) },
    { combo: "mod+/", handler: () => focusPrimaryInput() },
  ]);

  return (
    <div className="flex h-dvh overflow-hidden bg-bg">
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
          <RD.Overlay className="fixed inset-0 z-40 bg-black/40 animate-fade-in md:hidden" />
          <RD.Content className="fixed inset-y-0 left-0 z-50 w-[min(18rem,85vw)] border-r border-line shadow-lg animate-slide-in-left focus:outline-none md:hidden">
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
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-surface/80 px-3 backdrop-blur md:hidden">
          <Button variant="ghost" size="icon" onClick={() => setDrawerOpen(true)} aria-label="Open navigation">
            <MenuIcon />
          </Button>
          <Logo className="text-base" />
        </header>
        <main id="main" className="min-h-0 flex-1 overflow-hidden" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}
