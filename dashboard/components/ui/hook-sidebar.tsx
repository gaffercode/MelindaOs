/**
 * Rare UI "hook-sidebar" (https://rareui.com/components/hooksidebar) by Swami Malode, ported from the Sentra sibling dashboard.
 * License: MIT + Commons Clause + Attribution (see components/ui/RARE-UI.md). Keep this notice.
 * Local edits: group heading stays outside the nav (sentence case, no all caps); the caller controls the active row (no router read);
 * a per-instance layoutId; Melinda accent for the line.
 */
"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import { MOTION } from "../motion";

const CORNER = 6;
const DASH =
  "repeating-linear-gradient(to top, transparent 0 2px, currentColor 2px 4px)";

export type HookSidebarItem =
  | string
  | { label: string; href?: string; icon?: ReactNode };

export type HookSidebarProps = Omit<ComponentProps<"nav">, "onChange"> & {
  items: HookSidebarItem[];
  label?: string;
  value?: number;
  defaultValue?: number;
  onChange?: (index: number) => void;
  color?: string;
  dashed?: boolean;
};

const hrefOf = (item: HookSidebarItem) =>
  typeof item === "string" ? undefined : item.href;

const labelOf = (item: HookSidebarItem) =>
  typeof item === "string" ? item : item.label;

const iconOf = (item: HookSidebarItem) =>
  typeof item === "string" ? undefined : item.icon;

const Rail = ({
  from = 0,
  y,
  visible,
  color,
  dashed,
  className,
}: {
  from?: number;
  y: number | null;
  visible: boolean;
  color?: string;
  dashed: boolean;
  className?: string;
}) => {
  const reduced = useReducedMotion();
  const travel = reduced
    ? { duration: 0 }
    : { type: "spring" as const, stiffness: 420, damping: 34, mass: 0.7 };

  return (
    <motion.span
      aria-hidden
      initial={false}
      style={{ color }}
      animate={{ opacity: visible && y !== null ? 1 : 0 }}
      transition={reduced ? { duration: 0 } : { duration: MOTION.normal }}
      className={cn("pointer-events-none absolute inset-0 z-20", className)}
    >
      <motion.span
        initial={false}
        animate={{ top: from, height: Math.max(0, (y ?? 0) - CORNER - from) }}
        transition={travel}
        style={
          dashed
            ? { backgroundImage: DASH }
            : { backgroundColor: "currentColor" }
        }
        className="absolute left-0.5 w-0.5"
      />
      <motion.svg
        initial={false}
        animate={{ top: (y ?? 0) - CORNER }}
        transition={travel}
        width="12"
        height="7"
        viewBox="0 0 12 7"
        fill="none"
        className="absolute left-0.5"
      >
        <path
          d="M1 0a6 6 0 0 0 6 6H12"
          stroke="currentColor"
          strokeWidth="2"
          strokeDasharray={dashed ? "2 2" : undefined}
        />
      </motion.svg>
    </motion.span>
  );
};

export function HookSidebar({
  items,
  label,
  value,
  defaultValue = 0,
  onChange,
  color = "var(--color-accent)",
  dashed = true,
  className,
  ...props
}: HookSidebarProps) {
  const pillId = `hook-pill-${useId()}`;
  const reduced = useReducedMotion();
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLElement | null)[]>([]);
  const [centers, setCenters] = useState<number[]>([]);
  const [internalValue, setInternalValue] = useState(defaultValue);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [pointerInside, setPointerInside] = useState(false);
  const [focusInside, setFocusInside] = useState(false);

  const activeIndex = value ?? internalValue;

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;

    const measure = () =>
      setCenters(
        itemRefs.current.map((el) =>
          el ? el.offsetTop + el.offsetHeight / 2 : 0,
        ),
      );

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, [items.length]);

  const activeY = activeIndex < 0 ? null : (centers[activeIndex] ?? null);
  const hoverY = hoverIndex === null ? null : (centers[hoverIndex] ?? null);

  // above the active row the accent line already covers the span, so draw only the corner
  const hoverFrom =
    activeY !== null && hoverY !== null && hoverY <= activeY
      ? Math.max(0, hoverY - CORNER)
      : (activeY ?? 0);

  const select = (index: number) => {
    if (value === undefined) setInternalValue(index);
    onChange?.(index);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>, index: number) => {
    const count = items.length;
    if (!count) return;
    let nextIndex: number | null = null;
    if (event.key === "ArrowDown") {
      nextIndex = (index + 1) % count;
    } else if (event.key === "ArrowUp") {
      nextIndex = (index - 1 + count) % count;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = count - 1;
    }
    if (nextIndex !== null) {
      event.preventDefault();
      itemRefs.current[nextIndex]?.focus();
    }
  };

  return (
    <nav
      data-slot="hook-sidebar"
      aria-label={label}
      className={cn("flex flex-col", className)}
      {...props}
    >

      <div
        ref={listRef}
        onMouseLeave={() => setPointerInside(false)}
        className="relative flex flex-col gap-0.5"
      >
        <Rail
          from={hoverFrom}
          y={hoverY}
          visible={(pointerInside || focusInside) && hoverIndex !== activeIndex}
          dashed={dashed}
          color="color-mix(in srgb, var(--color-text-primary) 45%, transparent)"
        />
        <Rail
          y={activeY}
          visible={activeY !== null}
          color={color}
          dashed={dashed}
        />

        {items.map((item, index) => {
          const text = labelOf(item);
          const href = hrefOf(item);
          const icon = iconOf(item);
          const isActive = index === activeIndex;
          const isHovered = (pointerInside || focusInside) && hoverIndex === index;
          const setRef = (el: HTMLElement | null) => {
            itemRefs.current[index] = el;
          };
          const rowProps = {
            "data-slot": "hook-sidebar-item",
            "data-active": isActive,
            onMouseEnter: () => {
              setHoverIndex(index);
              setPointerInside(true);
            },
            onFocus: () => {
              setHoverIndex(index);
              setFocusInside(true);
            },
            onBlur: () => setFocusInside(false),
            onClick: () => select(index),
            onKeyDown: (e: ReactKeyboardEvent<HTMLElement>) => handleKeyDown(e, index),
            className: cn(
              "group relative isolate rounded-[2px] py-2 pl-4 pr-2 text-left text-sm transition-colors duration-[var(--motion-micro)] motion-reduce:transition-none flex items-center gap-2 focus-visible:outline-2 focus-visible:outline-[var(--color-focus-ring)] focus-visible:outline-offset-1",
              isActive
                ? "text-[var(--color-text-primary)] font-semibold bg-[var(--color-background-surface)]"
                : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-background-surface)]/75",
            ),
          };

          const seq = (
            <span
              className={cn(
                "seq relative z-10 text-[10px] tabular-nums transition-colors duration-[var(--motion-micro)]",
                isActive
                  ? "text-[var(--color-accent-text)] font-semibold"
                  : "text-[var(--color-text-muted)] group-hover:text-[var(--color-text-secondary)]",
              )}
            >
              {String(index + 1).padStart(2, "0")}
            </span>
          );

          const activeBackground = isActive ? (
            <motion.span
              layoutId={pillId}
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 -z-10 rounded-[2px] border-r-2 border-[var(--color-accent)] bg-[var(--color-background-surface)]"
              transition={reduced ? { duration: 0 } : { type: "spring" as const, stiffness: 520, damping: 42 }}
            />
          ) : null;

          const innerContent = (
            <>
              {activeBackground}
              {seq}
              {icon && (
                <span
                  className={cn(
                    "relative z-10 inline-flex shrink-0 transition-all duration-[var(--motion-micro)] motion-reduce:transition-none",
                    isActive
                      ? "text-[var(--color-accent-text)] opacity-100"
                      : isHovered
                        ? "text-[var(--color-text-primary)] opacity-95"
                        : "opacity-75",
                  )}
                >
                  {icon}
                </span>
              )}
              <span
                className={cn(
                  "relative z-10 transition-transform duration-[var(--motion-micro)] motion-reduce:transition-none",
                  isHovered && !isActive ? "translate-x-[1.5px]" : "translate-x-0",
                )}
              >
                {text}
              </span>
            </>
          );

          return href ? (
            <Link
              key={`${index}-${text}`}
              {...rowProps}
              ref={setRef}
              href={href}
              prefetch={true}
              aria-current={isActive ? "page" : undefined}
            >
              {innerContent}
            </Link>
          ) : (
            <button
              key={`${index}-${text}`}
              {...rowProps}
              ref={setRef}
              type="button"
              aria-current={isActive ? "true" : undefined}
            >
              {innerContent}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
