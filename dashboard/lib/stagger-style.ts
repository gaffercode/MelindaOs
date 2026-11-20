import type { CSSProperties } from "react";

/** An inline style plus the `--i` index that CSS turns into a staggered animation delay. Typed here so no call site needs a cast. */
export function staggerStyle(style: CSSProperties, index: number): CSSProperties & { "--i": number } {
  return { ...style, "--i": index };
}
