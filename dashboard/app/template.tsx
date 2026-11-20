import type { ReactNode } from "react";
import { MotionProvider } from "@/components/motion";
import { Toaster } from "@/components/ui/toast";

/** Below the route-remount boundary on purpose: DecisionProvider in layout.tsx must stay the body's direct child. */
export default function Template({ children }: { children: ReactNode }) {
  return <MotionProvider>{children}<Toaster position="bottom-right" /></MotionProvider>;
}
