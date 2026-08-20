"use client";

import { useMemo, useState } from "react";
import { RdeGeometrySchematic } from "@/components/rde-physics-visual";
import {
  EMPTY_ENGINE_DESIGN,
  buildScreeningPlan,
  calculateDesign,
  cloneEngineDesign,
  designFileName,
  selectCoverageNextPoint,
  validateEngineDesign,
  type EngineDesign,
  type OperatingPoint,
  type PlannedOperatingPoint,
} from "@/lib/design-workspace";

type Props = {
  designs: EngineDesign[];
  activeDesignId: string | null;
  operatingPoints: OperatingPoint[];
  onSelectDesign: (id: string) => void;
  onSaveDesign: (design: EngineDesign) => void;
  onAddOperatingPoint: (designId: string, point?: PlannedOperatingPoint) => void;
  onOpenEnvelope: (designId: string) => void;
};

function numberValue(value: number) {
  return Number.isFinite(value) ? value : "";
}

function compactNumber(value: number, digits = 1) {
  return Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: digits }) : "Not available";
}

function download(content: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function DesignEditor({ initial, onCancel, onSave }: { initial: EngineDesign; onCancel: () => void; onSave: (design: EngineDesign) => void }) {
  const [draft, setDraft] = useState(() => cloneEngineDesign(initial));
  const [error, setError] = useState("");
  const setNumber = (key: keyof EngineDesign, value: string) => setDraft((current) => ({ ...current, [key]: value === "" ? Number.NaN : Number(value) }));
  const setText = (key: keyof EngineDesign, value: string) => setDraft((current) => ({ ...current, [key]: value }));

  function submit() {
    const issues = validateEngineDesign(draft);
    if (issues.length) return setError(issues[0]);
    const id = draft.id || `design-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    onSave({ ...draft, id, source: "user" });
  }

  return <section className="design-editor" aria-label="Engine design inputs">
    <div className="design-editor-heading"><div><span className="workspace-label">Engine definition</span><h1>{draft.id ? "Edit engine design" : "Create an engine design"}</h1><p>These values define which operating points may be compared on one map. Kythros calculates geometry and coverage from them, but does not predict combustion or performance.</p></div></div>

    <div className="design-form-section"><h2>Identity and propellants</h2><div className="design-form-grid four">
      <label><span>Design name</span><input value={draft.name} onChange={(event) => setText("name", event.target.value)} placeholder="Annular demonstrator A" /></label>
      <label><span>Application</span><select value={draft.application} onChange={(event) => setText("application", event.target.value)}><option>Rocket</option><option>Air-breathing</option></select></label>
      <label><span>Fuel</span><input value={draft.fuel} onChange={(event) => setText("fuel", event.target.value)} /></label>
      <label><span>Oxidizer</span><input value={draft.oxidizer} onChange={(event) => setText("oxidizer", event.target.value)} /></label>
    </div></div>

    <div className="design-form-section"><h2>Annulus and injector</h2><div className="design-form-grid four">
      <label><span>Inner diameter (mm)</span><input type="number" value={numberValue(draft.annulusInnerDiameterMm)} onChange={(event) => setNumber("annulusInnerDiameterMm", event.target.value)} /></label>
      <label><span>Outer diameter (mm)</span><input type="number" value={numberValue(draft.annulusOuterDiameterMm)} onChange={(event) => setNumber("annulusOuterDiameterMm", event.target.value)} /></label>
      <label><span>Chamber length (mm)</span><input type="number" value={numberValue(draft.chamberLengthMm)} onChange={(event) => setNumber("chamberLengthMm", event.target.value)} /></label>
      <label><span>Injector type</span><input value={draft.injectorType} onChange={(event) => setText("injectorType", event.target.value)} /></label>
      <label><span>Injector count</span><input type="number" step="1" value={numberValue(draft.injectorCount)} onChange={(event) => setNumber("injectorCount", event.target.value)} /></label>
      <label><span>Orifice diameter (mm)</span><input type="number" step="0.01" value={numberValue(draft.injectorDiameterMm)} onChange={(event) => setNumber("injectorDiameterMm", event.target.value)} /></label>
      <label><span>Injection angle (deg)</span><input type="number" min="0" max="90" value={numberValue(draft.injectorAngleDeg)} onChange={(event) => setNumber("injectorAngleDeg", event.target.value)} /></label>
      <label><span>Plenum volume (cm³)</span><input type="number" value={numberValue(draft.plenumVolumeCm3)} onChange={(event) => setNumber("plenumVolumeCm3", event.target.value)} /></label>
      <label><span>Wall condition</span><input value={draft.wallCondition} onChange={(event) => setText("wallCondition", event.target.value)} /></label>
      <label><span>Exhaust configuration</span><input value={draft.exhaustConfiguration} onChange={(event) => setText("exhaustConfiguration", event.target.value)} /></label>
    </div></div>

    <div className="design-form-section"><h2>Operating range</h2><div className="design-form-grid four">
      <label><span>Minimum equivalence ratio</span><input type="number" step="0.01" value={numberValue(draft.equivalenceRatioMin)} onChange={(event) => setNumber("equivalenceRatioMin", event.target.value)} /></label>
      <label><span>Maximum equivalence ratio</span><input type="number" step="0.01" value={numberValue(draft.equivalenceRatioMax)} onChange={(event) => setNumber("equivalenceRatioMax", event.target.value)} /></label>
      <label><span>Minimum mass flow (kg/s)</span><input type="number" step="0.01" value={numberValue(draft.massFlowKgSMin)} onChange={(event) => setNumber("massFlowKgSMin", event.target.value)} /></label>
      <label><span>Maximum mass flow (kg/s)</span><input type="number" step="0.01" value={numberValue(draft.massFlowKgSMax)} onChange={(event) => setNumber("massFlowKgSMax", event.target.value)} /></label>
      <label><span>Minimum inlet pressure (bar)</span><input type="number" step="0.1" value={numberValue(draft.inletPressureBarMin)} onChange={(event) => setNumber("inletPressureBarMin", event.target.value)} /></label>
      <label><span>Maximum inlet pressure (bar)</span><input type="number" step="0.1" value={numberValue(draft.inletPressureBarMax)} onChange={(event) => setNumber("inletPressureBarMax", event.target.value)} /></label>
      <label><span>Inlet temperature (K)</span><input type="number" value={numberValue(draft.inletTemperatureK)} onChange={(event) => setNumber("inletTemperatureK", event.target.value)} /></label>
      <label><span>Back pressure (bar)</span><input type="number" step="0.1" value={numberValue(draft.backPressureBar)} onChange={(event) => setNumber("backPressureBar", event.target.value)} /></label>
    </div></div>

    {error && <p className="error-message" role="alert">{error}</p>}
    <div className="design-editor-actions"><button className="button secondary" onClick={onCancel}>Cancel</button><button className="button primary" onClick={submit}>Save engine design</button></div>
  </section>;
}

export function DesignPlanner({ designs, activeDesignId, operatingPoints, onSelectDesign, onSaveDesign, onAddOperatingPoint, onOpenEnvelope }: Props) {
  const activeDesign = designs.find((design) => design.id === activeDesignId) ?? designs[0] ?? null;
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const plan = useMemo(() => activeDesign && activeDesign.source !== "published" ? buildScreeningPlan(activeDesign, operatingPoints) : [], [activeDesign, operatingPoints]);
  const calculations = useMemo(() => activeDesign ? calculateDesign(activeDesign) : null, [activeDesign]);
  const nextPoint = useMemo(() => selectCoverageNextPoint(plan), [plan]);
  const physicalPoints = activeDesign ? operatingPoints.filter((item) => item.designId === activeDesign.id && item.source !== "demo") : [];
  const rawSignalPoints = physicalPoints.filter((item) => item.source === "uploaded");
  const publishedPoints = physicalPoints.filter((item) => item.source === "published");
  const demoPoints = activeDesign ? operatingPoints.filter((item) => item.designId === activeDesign.id && item.source === "demo") : [];
  const matchedPlanCount = plan.filter((point) => point.matchedOperatingPointId).length;

  if (creating || editing && activeDesign) return <DesignEditor
    initial={creating ? cloneEngineDesign(EMPTY_ENGINE_DESIGN) : activeDesign!}
    onCancel={() => { setCreating(false); setEditing(false); }}
    onSave={(design) => { onSaveDesign(design); setCreating(false); setEditing(false); }}
  />;

  if (!activeDesign) return <section className="design-empty">
    <span className="workspace-label">Design and screening workspace</span>
    <h1>Define the engine before mapping it</h1>
    <p>Record one gas-fed annular RDE geometry and its intended operating range. Kythros will calculate the geometry, create a traceable screening plan, and keep later observations attached to the correct design.</p>
    <button className="button primary" onClick={() => setCreating(true)}>Create first engine design</button>
    <div className="design-scope-note"><strong>Available now</strong><span>Design records, deterministic geometry calculations, operating-point planning, observed mode maps, CFD comparison, and evidence reports.</span></div>
  </section>;

  function saveManifest() {
    const payload = {
      schema: "kythros-engine-screening-plan",
      version: 1,
      generatedAt: new Date().toISOString(),
      design: activeDesign,
      calculatedFromInputs: calculations,
      screeningPlan: plan,
      evidenceStatus: {
        measuredOperatingPoints: physicalPoints.length,
        syntheticOperatingPoints: demoPoints.length,
        plannedPointsMatched: matchedPlanCount,
        predictiveModel: "Not fitted",
        backflowModel: "Not available",
        performanceModel: "Not available",
      },
      limitation: "This manifest contains entered values, direct calculations, and a coverage plan. It contains no predicted RDE operability, performance, backflow, or thermal result.",
    };
    download(JSON.stringify(payload, null, 2), designFileName(activeDesign, "json"), "application/json");
  }

  function saveCsv() {
    const header = "point_id,role,equivalence_ratio,mass_flow_kg_s,inlet_pressure_bar,observed_operating_point_id";
    const rows = plan.map((point) => [point.id, point.role, point.equivalenceRatio, point.massFlowKgS, point.inletPressureBar, point.matchedOperatingPointId ?? ""].map((value) => `"${String(value).replaceAll("\"", "\"\"")}"`).join(","));
    download([header, ...rows].join("\n"), designFileName(activeDesign, "csv"), "text/csv");
  }

  return <section className="design-workspace" aria-label="Design and screening workspace">
    <div className="design-heading"><div><span className="workspace-label">Design and screening workspace</span><h1>{activeDesign.name}</h1><p>{activeDesign.application} · {activeDesign.fuel} and {activeDesign.oxidizer} · annular configuration{activeDesign.source === "published" ? " · published source record" : ""}</p></div><div className="design-heading-actions"><label><span>Engine design</span><select value={activeDesign.id} onChange={(event) => onSelectDesign(event.target.value)}>{designs.map((design) => <option key={design.id} value={design.id}>{design.name}</option>)}</select></label>{activeDesign.source !== "published" && <button className="button secondary" onClick={() => setEditing(true)}>Edit design</button>}<button className="button secondary" onClick={() => setCreating(true)}>New design</button></div></div>

    {activeDesign.source === "published" && <section className="published-design-note"><strong>Source-backed example, not a completed design definition</strong><span>Reported geometry and operating conditions are shown as entered evidence. Injector orifice size, injection angle, plenum volume, and inlet/plenum pressure were not tabulated, so Kythros leaves those quantities unavailable and does not create a screening plan from them.</span></section>}

    <section className="capability-strip" aria-label="Current model capability">
      <article><span>Design screening</span><strong>Available</strong><small>Direct calculations from entered geometry and operating limits</small></article>
      <article><span>Observed operating points</span><strong>{physicalPoints.length}</strong><small>{publishedPoints.length ? `${publishedPoints.length} published summaries · ${rawSignalPoints.length} raw-signal uploads` : demoPoints.length ? `${demoPoints.length} synthetic point${demoPoints.length === 1 ? "" : "s"} excluded` : "User-provided measurements only"}</small></article>
      <article><span>Screening plan coverage</span><strong>{activeDesign.source === "published" ? "Not created" : `${matchedPlanCount} / ${plan.length}`}</strong><small>{activeDesign.source === "published" ? "The source does not report the full inlet-pressure design range needed for this plan" : "Measured conditions that match this design's planned conditions"}</small></article>
      <article className="capability-unavailable"><span>Predictive RDE model</span><strong>Not fitted</strong><small>No interpolation, performance, backflow, or thermal prediction</small></article>
    </section>

    <div className="design-overview-grid">
      <section className="design-card design-geometry-card"><div className="card-heading"><div><span>Generated from entered dimensions</span><h2>RDE geometry</h2></div><small>Schematic, not a CFD field</small></div><RdeGeometrySchematic design={activeDesign}/></section>
      <section className="design-card"><div className="card-heading"><div><span>Calculated from the design</span><h2>Geometry and flow quantities</h2></div><small>Not model predictions</small></div>{calculations && <dl className="design-calculations">
        <div><dt>Mean diameter</dt><dd>{compactNumber(calculations.meanDiameterMm, 2)} mm</dd></div>
        <div><dt>Annulus gap</dt><dd>{compactNumber(calculations.annulusGapMm, 2)} mm</dd></div>
        <div><dt>Annulus area</dt><dd>{compactNumber(calculations.annulusAreaMm2, 1)} mm²</dd></div>
        <div><dt>Chamber volume</dt><dd>{compactNumber(calculations.chamberVolumeCm3, 1)} cm³</dd></div>
        <div><dt>Total injector area</dt><dd>{compactNumber(calculations.injectorAreaMm2, 1)} mm²</dd></div>
        <div><dt>Injector / annulus area</dt><dd>{compactNumber(calculations.injectorAreaRatioPct, 2)}%</dd></div>
        <div><dt>Annulus mass flux range</dt><dd>{compactNumber(calculations.annulusMassFluxMinKgM2S, 0)} to {compactNumber(calculations.annulusMassFluxMaxKgM2S, 0)} kg/m²/s</dd></div>
        <div><dt>Inlet / back-pressure ratio</dt><dd>{compactNumber(calculations.minimumPressureRatio, 2)} to {compactNumber(calculations.maximumPressureRatio, 2)}</dd></div>
      </dl>}</section>

      <section className="design-card next-point-card"><div className="card-heading"><div><span>{activeDesign.source === "published" ? "Published evidence loaded" : "Coverage-based next point"}</span><h2>{activeDesign.source === "published" ? "Inspect the real observed envelope" : nextPoint ? nextPoint.role === "Baseline" ? "Establish the centre condition" : `Add the ${nextPoint.role.toLowerCase()}` : "Screening plan covered"}</h2></div></div>{activeDesign.source === "published" ? <><p>The source provides enough information to test the operating-envelope hierarchy, plotting, provenance, and reported-mode display. It does not provide enough raw evidence to validate signal analysis or recommend a new test.</p><button className="button primary" onClick={() => onOpenEnvelope(activeDesign.id)}>Open Operating Envelope</button></> : nextPoint ? <><p>This point is selected from the entered design range because it is the planned condition farthest from the loaded measured observations. It is not an operability prediction.</p><div className="next-point-values"><span><b>φ {nextPoint.equivalenceRatio.toFixed(2)}</b>Equivalence ratio</span><span><b>{nextPoint.massFlowKgS.toFixed(3)} kg/s</b>Mass flow</span><span><b>{nextPoint.inletPressureBar.toFixed(2)} bar</b>Inlet pressure</span></div><button className="button primary" onClick={() => onAddOperatingPoint(activeDesign.id, nextPoint)}>Add this operating point</button></> : <><p>Every point in the current screening plan has a matched measured operating point. Open the Operating Envelope to inspect the observed modes.</p><button className="button primary" onClick={() => onOpenEnvelope(activeDesign.id)}>Open Operating Envelope</button></>}</section>
    </div>

    {activeDesign.source !== "published" && <section className="screening-plan-card"><div className="card-heading"><div><span>Screening sequence</span><h2>Nine traceable operating points</h2><p>The centre condition is followed by one-variable brackets, coupled boundaries, and pressure brackets.</p></div><div><button className="button secondary" onClick={saveCsv}>Download CSV</button><button className="button secondary" onClick={saveManifest}>Download manifest</button></div></div><div className="screening-table-wrap"><table><thead><tr><th>Purpose</th><th>Equivalence ratio</th><th>Mass flow</th><th>Inlet pressure</th><th>Measured evidence</th><th></th></tr></thead><tbody>{plan.map((point) => <tr key={point.id}><th>{point.role}</th><td>φ {point.equivalenceRatio.toFixed(2)}</td><td>{point.massFlowKgS.toFixed(3)} kg/s</td><td>{point.inletPressureBar.toFixed(2)} bar</td><td><span className={`plan-status ${point.matchedOperatingPointId ? "matched" : "planned"}`}>{point.matchedOperatingPointId ? "Measured point loaded" : "Not yet tested"}</span></td><td>{!point.matchedOperatingPointId && <button onClick={() => onAddOperatingPoint(activeDesign.id, point)}>Add point</button>}</td></tr>)}</tbody></table></div></section>}

    {designs.length > 1 && <section className="screening-plan-card design-portfolio"><div className="card-heading"><div><span>Design comparison</span><h2>Entered designs and evidence coverage</h2><p>This compares entered geometry and loaded evidence only. It does not rank performance.</p></div></div><div className="screening-table-wrap"><table><thead><tr><th>Design</th><th>Propellants</th><th>Annulus gap</th><th>Injector / annulus area</th><th>Observed points</th><th></th></tr></thead><tbody>{designs.map((design) => { const result = calculateDesign(design); const pointCount = operatingPoints.filter((item) => item.designId === design.id && item.source !== "demo").length; return <tr key={design.id}><th>{design.name}</th><td>{design.fuel} / {design.oxidizer}</td><td>{compactNumber(result.annulusGapMm, 2)} mm</td><td>{compactNumber(result.injectorAreaRatioPct, 2)}%</td><td>{pointCount}</td><td><button onClick={() => onSelectDesign(design.id)}>{design.id === activeDesign.id ? "Selected" : "Open"}</button></td></tr>; })}</tbody></table></div></section>}

    <section className="product-boundary-card"><div><span>What Kythros can do now</span><strong>Define, calculate, plan, compare, classify, and report.</strong></div><div><span>What still requires a validated model</span><strong>Predict stability, backflow, pressure gain, thrust, heat flux, or untested operating regions.</strong></div></section>
  </section>;
}
