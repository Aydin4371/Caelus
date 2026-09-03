"use client";

import type { AnalysisCase } from "@/lib/caevera-types";
import { parameterLabel } from "@/lib/controlled-parameters";
import type { FrozenRunPlan } from "@/lib/next-run-work-order";

export function ProspectiveValidationLedger({
  plans,
  cases,
  activeOperatingPointId,
  onResume,
  onDownload,
}: {
  plans: FrozenRunPlan[];
  cases: AnalysisCase[];
  activeOperatingPointId: string | null;
  onResume: (plan: FrozenRunPlan) => void;
  onDownload: (plan: FrozenRunPlan) => void;
}) {
  const relevant = plans.filter((plan) => plan.workOrder.operatingPointId === activeOperatingPointId);
  if (!relevant.length) return null;
  return <section className="prospective-ledger" aria-label="Prospective CFD validation ledger">
    <div className="prospective-ledger-heading"><div><span>FROZEN BEFORE RESULTS</span><h2>Prospective CFD run ledger</h2></div><p>A plan enters this ledger before its CFD result is loaded. Completed rows retain the original recommendation, policy, and starting run.</p></div>
    <div className="prospective-ledger-list">{relevant.map((plan) => {
      const result = plan.resultCaseId ? cases.find((item) => item.id === plan.resultCaseId) : null;
      return <article key={plan.workOrder.id} className={plan.status}>
        <div><span>{plan.status === "pending" ? "AWAITING RESULT" : "RESULT RECORDED"}</span><strong>{parameterLabel(plan.workOrder.change.parameter)}</strong><small>{plan.workOrder.id} · frozen {new Date(plan.workOrder.frozenAt).toLocaleString()}</small></div>
        <dl><div><dt>Starting run</dt><dd>{plan.workOrder.startingCase.name}</dd></div><div><dt>One allowed change</dt><dd>{String(plan.workOrder.change.currentValue)} → {plan.workOrder.change.suggestedTargetValue === null ? "engineer-selected target" : String(plan.workOrder.change.suggestedTargetValue)}</dd></div><div><dt>Outcome</dt><dd>{result?.metadata.name ?? "Not uploaded"}</dd></div></dl>
        <div className="prospective-ledger-actions"><button className="button secondary" onClick={() => onDownload(plan)}>Download frozen spec</button>{plan.status === "pending" && <button className="button primary" onClick={() => onResume(plan)}>Load CFD result</button>}</div>
      </article>;
    })}</div>
  </section>;
}
