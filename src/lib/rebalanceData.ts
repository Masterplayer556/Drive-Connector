// Lädt alles, was Planer und Regal-Ansicht brauchen, und erstellt den aktuellen Vorschlag.
import { fetchGroupFolder, fetchLocks, fetchMinPlanGb, fetchPlans, fetchUnits, type PlanRow } from "./db";
import { GB, MIN_PLAN, planRebalance, type AccountCap, type Plan, type Unit } from "./rebalance";
import type { Account } from "./types";

export interface RebalanceState {
  units: Unit[];
  locks: Set<string>;
  groupFolder: string | null;
  /** Vorschlag erst, wenn er mehr als so viele GB frei macht */
  minPlanGb: number;
  plans: PlanRow[];
  plan: Plan;
  /** Plan, der gerade ausgeführt wird (oder in der Warteschlange steht) */
  active: PlanRow | null;
  /** Der aktuelle Vorschlag wurde schon einmal abgelehnt */
  rejected: boolean;
}

export const toCaps = (accounts: Account[]): AccountCap[] =>
  accounts
    .filter((a) => a.status === "active" && a.quota_limit)
    .map((a) => ({ id: a.id, email: a.email, limit: Number(a.quota_limit), usage: Number(a.quota_usage ?? 0), role: a.role }));

export async function loadRebalance(accounts: Account[]): Promise<RebalanceState> {
  const [units, locks, groupFolder, plans, min] = await Promise.all([
    fetchUnits(),
    fetchLocks(),
    fetchGroupFolder(),
    fetchPlans(),
    fetchMinPlanGb().catch(() => null), // Spalte fehlt noch o. ä. → Standard
  ]);
  const minPlanGb = min ?? MIN_PLAN / GB;
  const plan = planRebalance({ accounts: toCaps(accounts), units, locks, groupFolder, minBytes: minPlanGb * GB });
  const active = plans.find((p) => p.status === "queued" || p.status === "running") ?? null;
  const rejected = plans.some((p) => p.status === "rejected" && p.signature === plan.signature);
  return { units, locks, groupFolder, minPlanGb, plans, plan, active, rejected };
}
