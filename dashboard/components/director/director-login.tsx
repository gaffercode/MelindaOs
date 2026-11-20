"use client";
import { EntranceSequence } from "@/components/entrance/entrance-sequence";

/** Director sign-in: the cinematic entrance (components/entrance) on a white stage. Replaced the video hero on
 * 2026-11-08; the page and route tests keep this name and prop shape. */
export function DirectorLogin({ available, returnTo }: { available: boolean; returnTo: string }) {
  return <EntranceSequence available={available} returnTo={returnTo} />;
}
