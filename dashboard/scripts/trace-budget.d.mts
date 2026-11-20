export type RouteTrace = { route: string; bytes: number; files: string[] };

export const MIB: number;
export const BUDGETS: { default: number; knowledge: number };
export const KNOWLEDGE_ROUTES: string[];
export const REQUIRED_FILES: Record<string, string[]>;
export function routeFromTracePath(tracePath: string): string;
export function readRouteTraces(dashboardDir: string): RouteTrace[];
export function evaluateTraces(input: { routes: RouteTrace[]; buildLog: string; required?: Record<string, string[]> }): string[];
