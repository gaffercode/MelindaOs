"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { flashChanged, MOTION, reducedMotion } from "../motion";

/**
 * A link whose text is a count and its label (`3 tugas terbuka`). When the count changes it counts from the number on screen
 * to the new one in the same text node, so the link keeps one accessible name and the markup of a plain link. A change that
 * arrives mid-count continues from the number shown. React renders the first value only; later values are written straight
 * to the text node, never through a re-render per frame.
 */
export function CountLink({ value, suffix = "", href, className, current }: { value: number; suffix?: string; href: string; className?: string; current?: boolean }) {
  const [first] = useState(value);
  const element = useRef<HTMLAnchorElement>(null);
  const shown = useRef(value);
  useEffect(() => {
    const from = shown.current;
    if (from === value) return;
    flashChanged(element.current);
    const write = (next: number) => {
      shown.current = next;
      if (element.current) element.current.textContent = Math.round(next) + suffix;
    };
    if (reducedMotion()) { write(value); return; }
    const start = performance.now();
    let frame = requestAnimationFrame(function step(now) {
      const progress = Math.min(1, (now - start) / (MOTION.count * 1000));
      write(from + (value - from) * (1 - (1 - progress) ** 4)); // decelerating, close to --ease-out-expo
      if (progress < 1) frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [value, suffix]);
  return <Link ref={element} href={href} prefetch={false} aria-current={current ? "true" : undefined} className={className}>{first + suffix}</Link>;
}
