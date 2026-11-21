"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { decisionReducer, initialDecisionState, type DecisionAction, type DecisionState } from "@/lib/decision/decision-state";
import { readDecisionState, STORAGE_KEY } from "@/lib/decision/decision-storage";

interface DecisionSession {
  state: DecisionState;
  ready: boolean;
  error: string;
  dispatch: (action: DecisionAction) => void;
}

const DecisionContext = createContext<DecisionSession | null>(null);

export function DecisionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(initialDecisionState);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const writable = useRef(false);

  useEffect(() => {
    const bootstrap = window.setTimeout(() => {
      try {
        const saved = readDecisionState(window.localStorage, initialDecisionState);
        writable.current = saved.writable;
        setState(saved.state);
        setError(saved.error);
      } catch {
        setState(initialDecisionState);
        setError("Penyimpanan browser tidak dapat dibaca. Perubahan berlaku pada sesi ini saja.");
      } finally {
        setReady(true);
      }
    }, 0);
    return () => window.clearTimeout(bootstrap);
  }, []);

  useEffect(() => {
    if (!ready || !writable.current) return;
    const persist = window.setTimeout(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        setError("");
      } catch {
        setError("Perubahan tersimpan di memori sesi saja dan tidak akan bertahan setelah reload.");
      }
    }, 0);
    return () => window.clearTimeout(persist);
  }, [state, ready]);

  const dispatch = useCallback((action: DecisionAction) => {
    if (action.type === "purge") writable.current = true;
    setState((current) => decisionReducer(current, action));
  }, []);

  const value = useMemo(() => ({ state, ready, error, dispatch }), [state, ready, error, dispatch]);
  return <DecisionContext value={value}>{children}</DecisionContext>;
}

export function useDecisionSession(): DecisionSession {
  const session = useContext(DecisionContext);
  if (!session) throw new Error("DashboardApp requires DecisionProvider.");
  return session;
}

