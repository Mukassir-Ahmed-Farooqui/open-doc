import { useEffect, useState, type RefObject } from "react";
import { useMediaQuery } from "@/hooks/useMediaQuery";

export function usePrefersReducedMotion(): boolean {
  return useMediaQuery("(prefers-reduced-motion: reduce)");
}

/**
 * Scroll reveals: marks the root `is-ready`, then adds `is-in` to each `[data-reveal]` as it enters
 * the viewport. Without IntersectionObserver everything is shown at once. CSS only hides elements
 * when motion is allowed, so reduced-motion users never see a blank section.
 */
export function useScrollReveal(rootRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const items = Array.from(root.querySelectorAll<HTMLElement>("[data-reveal]"));
    if (typeof IntersectionObserver === "undefined") {
      items.forEach((el) => el.classList.add("is-in"));
      return;
    }
    root.classList.add("is-ready");
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("is-in");
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.12 },
    );
    items.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [rootRef]);
}

/** Subtle parallax: writes the scroll offset to a CSS variable on the target (transform-only consumers). */
export function useParallax(targetRef: RefObject<HTMLElement | null>, reduced: boolean) {
  useEffect(() => {
    const el = targetRef.current;
    if (!el || reduced) return;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const y = Math.min(window.scrollY, 900);
        el.style.transform = `translate3d(0, ${y * 0.25}px, 0)`;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [targetRef, reduced]);
}

/** True once the page has scrolled past `offset` px (for the nav's elevated state). */
export function useScrolled(offset = 8): boolean {
  const [scrolled, setScrolled] = useState(() => typeof window !== "undefined" && window.scrollY > offset);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > offset);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [offset]);
  return scrolled;
}

/** Cycles 0..count-1 every `ms` while `enabled`; returns [index, setIndex]. */
export function useAutoCycle(count: number, ms: number, enabled: boolean) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => setIndex((i) => (i + 1) % count), ms);
    return () => window.clearInterval(id);
  }, [count, ms, enabled]);
  return [index, setIndex] as const;
}
