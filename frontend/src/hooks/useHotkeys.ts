import { useEffect, useRef } from "react";

export interface Hotkey {
  /** e.g. "mod+k", "mod+/", "mod+shift+o", "escape" */
  combo: string;
  handler: (e: KeyboardEvent) => void;
  /** Fire even while typing in an input (default true for mod combos). */
  allowInInputs?: boolean;
}

export function matchesCombo(e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">, combo: string): boolean {
  const parts = combo.toLowerCase().split("+");
  const key = parts[parts.length - 1];
  const wantMod = parts.includes("mod");
  const wantShift = parts.includes("shift");
  const wantAlt = parts.includes("alt");
  const mod = e.metaKey || e.ctrlKey;
  if (wantMod !== mod || wantShift !== e.shiftKey || wantAlt !== e.altKey) return false;
  return e.key.toLowerCase() === key;
}

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

export function useHotkeys(hotkeys: Hotkey[]) {
  const ref = useRef(hotkeys);
  useEffect(() => {
    ref.current = hotkeys;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      for (const hk of ref.current) {
        if (!matchesCombo(e, hk.combo)) continue;
        const allow = hk.allowInInputs ?? hk.combo.includes("mod");
        if (!allow && isTyping(e.target)) continue;
        e.preventDefault();
        hk.handler(e);
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/** Focus the page's primary input (chat composer, library search…), marked with data-primary-input. */
export function focusPrimaryInput(): boolean {
  const els = Array.from(document.querySelectorAll<HTMLElement>("[data-primary-input]"));
  const visible = els.find((el) => el.offsetParent !== null || el === document.activeElement);
  const target = visible ?? els[0];
  if (target) {
    target.focus();
    return true;
  }
  return false;
}
