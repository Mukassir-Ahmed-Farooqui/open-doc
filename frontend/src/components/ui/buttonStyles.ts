import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "outline";
export type ButtonSize = "sm" | "md" | "lg" | "icon" | "icon-sm";

/*
  One button recipe for the whole product (app and landing). Heights: 32 / 36 / 44 px, and every
  size grows to 44 px on coarse pointers (touch) so targets meet the 44 px rule without bloating
  the desktop UI.
*/
export const buttonVariants: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-fg hover:bg-accent-hover",
  secondary: "bg-surface-2 text-fg hover:bg-surface-3",
  outline: "border border-line-strong bg-surface text-fg hover:bg-surface-2",
  ghost: "text-fg-muted hover:bg-surface-2 hover:text-fg",
  danger: "bg-danger text-white hover:brightness-95 dark:text-[oklch(0.17_0.02_25)]",
};
export const buttonSizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-sm gap-1.5 rounded-md pointer-coarse:h-11",
  md: "h-9 px-3.5 text-sm gap-2 rounded-md pointer-coarse:h-11",
  lg: "h-11 px-5 text-base gap-2 rounded-lg",
  icon: "size-9 rounded-md pointer-coarse:size-11",
  "icon-sm": "size-8 rounded-md pointer-coarse:size-11",
};
export const buttonBase =
  "inline-flex shrink-0 select-none items-center justify-center font-medium whitespace-nowrap transition-[background-color,color,filter,transform] duration-150 ease-out active:translate-y-px disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-4 [&_svg]:shrink-0";

/** Class string for links that should look like buttons (react-router <Link>, <a>). */
export function buttonClass(variant: ButtonVariant = "secondary", size: ButtonSize = "md", className?: string) {
  return cn(buttonBase, buttonVariants[variant], buttonSizes[size], className);
}
