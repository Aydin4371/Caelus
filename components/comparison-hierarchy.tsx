"use client";

import type { AnalysisCase } from "@/lib/caevera-types";
import { operatingPointLabel, type EngineDesign, type OperatingPoint } from "@/lib/design-workspace";

type Props = {
  designs: EngineDesign[];
  operatingPoints: OperatingPoint[];
  runs: AnalysisCase[];
  activeDesignId: string | null;
  activeOperatingPointId: string | null;
  activeRunId: string | null;
  onSelectDesign: (id: string) => void;
  onSelectOperatingPoint: (id: string) => void;
  onSelectRun: (id: string) => void;
  onAddOperatingPoint: () => void;
  onAddRun: () => void;
  onViewHistory: () => void;
  onSaveWorkspace: () => void;
};

export function ComparisonHierarchy({ designs, operatingPoints, runs, activeDesignId, activeOperatingPointId, activeRunId, onSelectDesign, onSelectOperatingPoint, onSelectRun, onAddOperatingPoint, onAddRun, onViewHistory, onSaveWorkspace }: Props) {
  const designPoints = operatingPoints.filter((point) => point.designId === activeDesignId);
  const pointRuns = runs.filter((run) => run.operatingPointId === activeOperatingPointId);
  return <section className="comparison-hierarchy" aria-label="Engine, operating point, and run selection">
    <div className="hierarchy-path"><span>Engine / design</span><i>→</i><span>Operating point</span><i>→</i><span>Runs</span></div>
    <div className="hierarchy-controls">
      <label><span>Engine / design</span><select value={activeDesignId ?? ""} onChange={(event) => onSelectDesign(event.target.value)}><option value="" disabled>Select engine</option>{designs.map((design) => <option key={design.id} value={design.id}>{design.name}</option>)}</select><small>Fixed geometry, injector, propellants, and walls</small></label>
      <label><span>Operating point</span><select value={activeOperatingPointId ?? ""} onChange={(event) => onSelectOperatingPoint(event.target.value)}><option value="" disabled>Select operating point</option>{designPoints.map((point) => <option key={point.id} value={point.id}>{point.name}</option>)}</select><small>{designPoints.find((point) => point.id === activeOperatingPointId) ? operatingPointLabel(designPoints.find((point) => point.id === activeOperatingPointId)!) : "Pressure, flow, φ, temperature, and back pressure"}</small></label>
      <label><span>Run</span><select value={activeRunId ?? ""} onChange={(event) => onSelectRun(event.target.value)}><option value="" disabled>Select run</option>{pointRuns.map((run, index) => <option key={run.id} value={run.id}>{index === 0 && !run.relationship ? `Baseline CFD: ${run.metadata.name}` : `CFD rerun: ${run.metadata.name}`}</option>)}</select><small>Each CFD run is compared with the experiment stored on this operating point · {pointRuns.length} completed</small></label>
    </div>
    <div className="hierarchy-actions"><button className="button secondary" onClick={onViewHistory} disabled={pointRuns.length < 2}>Run history</button><button className="button secondary" onClick={onSaveWorkspace}>Save workspace</button><button className="button secondary" onClick={onAddRun} disabled={!activeOperatingPointId}>{pointRuns.length ? "+ CFD rerun" : "+ Baseline CFD comparison"}</button><button className="button primary" onClick={onAddOperatingPoint} disabled={!activeDesignId}>+ Measured operating point</button></div>
  </section>;
}
