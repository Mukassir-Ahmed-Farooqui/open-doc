import * as DM from "@radix-ui/react-dropdown-menu";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export const Menu = DM.Root;
export const MenuTrigger = DM.Trigger;

export function MenuContent({ children, align = "end", className }: { children: ReactNode; align?: "start" | "end" | "center"; className?: string }) {
  return (
    <DM.Portal>
      <DM.Content
        align={align}
        sideOffset={4}
        className={cn(
          "z-50 min-w-40 rounded-lg border border-line bg-surface p-1 shadow-lg animate-pop-in focus:outline-none",
          className,
        )}
      >
        {children}
      </DM.Content>
    </DM.Portal>
  );
}

export function MenuItem({
  children,
  onSelect,
  destructive,
  icon,
}: {
  children: ReactNode;
  onSelect: () => void;
  destructive?: boolean;
  icon?: ReactNode;
}) {
  return (
    <DM.Item
      onSelect={onSelect}
      className={cn(
        "flex h-9 cursor-default items-center gap-2.5 rounded-md px-2.5 text-sm outline-none select-none data-[highlighted]:bg-surface-2 pointer-coarse:h-11 [&_svg]:size-4 [&_svg]:text-fg-subtle",
        destructive ? "text-danger [&_svg]:text-danger" : "text-fg",
      )}
    >
      {icon}
      {children}
    </DM.Item>
  );
}

export const MenuSeparator = () => <DM.Separator className="my-1 h-px bg-line" />;
