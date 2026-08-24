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
  type EngineBuildDefinition,
  type EngineDesign,
  type OperatingPoint,
  type PlannedOperatingPoint,
} from "@/lib/design-workspace";
import { RDE_MATERIALS, calculateRdeBuildScreening } from "@/lib/rde-build";

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

function compactPercentage(value: number, digits = 2) {
  return Number.isFinite(value) ? `${compactNumber(value, digits)}%` : "Not available";
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
  const [draft, setDraft] = useState(() => {
    const copy = cloneEngineDesign(initial);
    return { ...copy, build: copy.build ?? { ...EMPTY_ENGINE_DESIGN.build! } };
  });
  const [error, setError] = useState("");
  const setNumber = (key: keyof EngineDesign, value: string) => setDraft((current) => ({ ...current, [key]: value === "" ? Number.NaN : Number(value) }));
  const setText = (key: keyof EngineDesign, value: string) => setDraft((current) => ({ ...current, [key]: value }));
  const setBuild = <Key extends keyof EngineBuildDefinition>(key: Key, value: EngineBuildDefinition[Key]) => setDraft((current) => ({ ...current, build: { ...(current.build ?? EMPTY_ENGINE_DESIGN.build!), [key]: value } }));
  const setBuildNumber = (key: keyof EngineBuildDefinition, value: string) => setDraft((current) => ({ ...current, build: { ...(current.build ?? EMPTY_ENGINE_DESIGN.build!), [key]: value === "" ? Number.NaN : Number(value) } as EngineBuildDefinition }));
  const build = draft.build!;

  function submit() {
    const issues = validateEngineDesign(draft);
    if (issues.length) return setError(issues[0]);
    const id = draft.id || `design-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    onSave({ ...draft, id, source: "user" });
  }

  return <section className="design-editor" aria-label="Preliminary RDE build inputs">
    <div className="design-editor-heading"><div><span className="workspace-label">Preliminary RDE builder</span><h1>{draft.id ? "Refine the RDE build" : "Build an RDE concept"}</h1><p>Define the engine, hot-section materials, and cooling circuit in one traceable record. Kythros performs direct geometry and first-order screening calculations, not CFD, combustion prediction, stress analysis, or design certification.</p></div></div>

    <div className="design-form-section"><h2>Identity and propellants</h2><div className="design-form-grid four">
      <label><span>Design name</span><input value={draft.name} onChange={(event) => setText("name", event.target.value)} placeholder="Annular demonstrator A" /></label>
      <label><span>Application</span><select value={draft.application} onChange={(event) => setText("application", event.target.value)}><option>Rocket</option><option>Air-breathing</option></select></label>
      <label><span>Fuel</span><input value={draft.fuel} onChange={(event) => setText("fuel", event.target.value)} /></label>
      <label><span>Oxidizer</span><input value={draft.oxidizer} onChange={(event) => setText("oxidizer", event.target.value)} /></label>
      <label><span>Feed system</span><input value={build.feedSystem} onChange={(event) => setBuild("feedSystem", event.target.value)} placeholder="Pressure-fed" /></label>
      <label><span>Ignition system</span><input value={build.ignitionSystem} onChange={(event) => setBuild("ignitionSystem", event.target.value)} placeholder="Pre-detonator" /></label>
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

    <div className="design-form-section"><h2>Structure and materials</h2><p className="design-form-help">The material library contains nominal screening properties only. Select the actual material family for every major component; grades, heat treatment, joints, fatigue, oxidation, and certified allowables remain outside this calculation.</p><div className="design-form-grid three">
      {([
        ["hotWallMaterial", "Hot-wall liner"],
        ["outerWallMaterial", "Outer pressure jacket"],
        ["injectorMaterial", "Injector face"],
        ["centerbodyMaterial", "Centerbody"],
        ["nozzleMaterial", "Nozzle / exhaust"],
      ] as const).map(([key, label]) => <label key={key}><span>{label}</span><select value={build[key]} onChange={(event) => setBuild(key, event.target.value as EngineBuildDefinition[typeof key])}>{RDE_MATERIALS.map((item) => <option key={item.id} value={item.id}>{item.id}</option>)}</select></label>)}
      <label><span>Hot-wall coating</span><select value={build.hotWallCoating} onChange={(event) => setBuild("hotWallCoating", event.target.value as EngineBuildDefinition["hotWallCoating"])}><option>None</option><option>YSZ-class thermal-barrier coating</option></select></label>
      <label><span>Hot-wall thickness (mm)</span><input type="number" step="0.1" min="0" value={numberValue(build.wallThicknessMm)} onChange={(event) => setBuildNumber("wallThicknessMm", event.target.value)} /></label>
    </div></div>

    <div className="design-form-section"><h2>Thermal management</h2><p className="design-form-help">For regenerative cooling, enter the actual channel geometry, coolant state, and an assumed design heat flux. Kythros uses those inputs for a first-order thermal and hydraulic screen; it does not generate the heat flux.</p><div className="design-form-grid four">
      <label><span>Cooling method</span><select value={build.coolingMethod} onChange={(event) => setBuild("coolingMethod", event.target.value as EngineBuildDefinition["coolingMethod"])}><option>Regenerative</option><option>Film</option><option>Heat sink</option><option>Ablative</option><option>Not defined</option></select></label>
      <label><span>Cooled surfaces</span><select value={build.cooledSurfaces} onChange={(event) => setBuild("cooledSurfaces", event.target.value as EngineBuildDefinition["cooledSurfaces"])}><option>Outer wall</option><option>Inner and outer walls</option></select></label>
      <label><span>Coolant</span><input value={build.coolant} onChange={(event) => setBuild("coolant", event.target.value)} placeholder="Fuel" /></label>
      <label><span>Entered heat flux (MW/m²)</span><input type="number" step="0.1" min="0" value={numberValue(build.designHeatFluxMWM2)} onChange={(event) => setBuildNumber("designHeatFluxMWM2", event.target.value)} /></label>
    </div>{build.coolingMethod === "Regenerative" && <div className="design-form-grid four regenerative-inputs">
      <label><span>Channel count</span><input type="number" step="1" min="1" value={numberValue(build.coolingChannelCount)} onChange={(event) => setBuildNumber("coolingChannelCount", event.target.value)} /></label>
      <label><span>Channel width (mm)</span><input type="number" step="0.1" min="0" value={numberValue(build.coolingChannelWidthMm)} onChange={(event) => setBuildNumber("coolingChannelWidthMm", event.target.value)} /></label>
      <label><span>Channel depth (mm)</span><input type="number" step="0.1" min="0" value={numberValue(build.coolingChannelDepthMm)} onChange={(event) => setBuildNumber("coolingChannelDepthMm", event.target.value)} /></label>
      <label><span>Channel roughness (mm)</span><input type="number" step="0.001" min="0" value={numberValue(build.coolingChannelRoughnessMm)} onChange={(event) => setBuildNumber("coolingChannelRoughnessMm", event.target.value)} /></label>
      <label><span>Coolant mass flow (kg/s)</span><input type="number" step="0.01" min="0" value={numberValue(build.coolantMassFlowKgS)} onChange={(event) => setBuildNumber("coolantMassFlowKgS", event.target.value)} /></label>
      <label><span>Coolant inlet temperature (K)</span><input type="number" step="1" min="0" value={numberValue(build.coolantInletTemperatureK)} onChange={(event) => setBuildNumber("coolantInletTemperatureK", event.target.value)} /></label>
      <label><span>Coolant inlet pressure (bar)</span><input type="number" step="0.1" min="0" value={numberValue(build.coolantInletPressureBar)} onChange={(event) => setBuildNumber("coolantInletPressureBar", event.target.value)} /></label>
      <label><span>Density (kg/m³)</span><input type="number" step="1" min="0" value={numberValue(build.coolantDensityKgM3)} onChange={(event) => setBuildNumber("coolantDensityKgM3", event.target.value)} /></label>
      <label><span>Specific heat (J/kg/K)</span><input type="number" step="1" min="0" value={numberValue(build.coolantSpecificHeatJkgK)} onChange={(event) => setBuildNumber("coolantSpecificHeatJkgK", event.target.value)} /></label>
      <label><span>Dynamic viscosity (Pa·s)</span><input type="number" step="0.000001" min="0" value={numberValue(build.coolantViscosityPaS)} onChange={(event) => setBuildNumber("coolantViscosityPaS", event.target.value)} /></label>
      <label><span>Thermal conductivity (W/m/K)</span><input type="number" step="0.01" min="0" value={numberValue(build.coolantThermalConductivityWMK)} onChange={(event) => setBuildNumber("coolantThermalConductivityWMK", event.target.value)} /></label>
    </div>}</div>

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
    <div className="design-editor-actions"><button className="button secondary" onClick={onCancel}>Cancel</button><button className="button primary" onClick={submit}>Save preliminary build</button></div>
  </section>;
}

export function DesignPlanner({ designs, activeDesignId, operatingPoints, onSelectDesign, onSaveDesign, onAddOperatingPoint, onOpenEnvelope }: Props) {
  const activeDesign = designs.find((design) => design.id === activeDesignId) ?? designs[0] ?? null;
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const plan = useMemo(() => activeDesign && activeDesign.source !== "published" ? buildScreeningPlan(activeDesign, operatingPoints) : [], [activeDesign, operatingPoints]);
  const calculations = useMemo(() => activeDesign ? calculateDesign(activeDesign) : null, [activeDesign]);
  const buildScreening = useMemo(() => activeDesign ? calculateRdeBuildScreening(activeDesign) : null, [activeDesign]);
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
    <span className="workspace-label">Preliminary RDE builder</span>
    <h1>Build the engine before mapping it</h1>
    <p>Record one gas-fed annular RDE concept from geometry through component materials, feed and ignition, regenerative cooling, and the intended operating range. Kythros will calculate a traceable first-order screen and keep later evidence attached to the correct build.</p>
    <button className="button primary" onClick={() => setCreating(true)}>Build the first RDE</button>
    <div className="design-scope-note"><strong>Available now</strong><span>Preliminary build records, deterministic geometry, material assignments, entered-heat-load cooling screening, operating-point planning, observed mode maps, CFD comparison, and evidence reports.</span></div>
  </section>;

  function saveManifest() {
    const payload = {
      schema: "kythros-engine-screening-plan",
      version: 1,
      generatedAt: new Date().toISOString(),
      design: activeDesign,
      calculatedFromInputs: calculations,
      preliminaryBuildScreening: buildScreening,
      screeningPlan: plan,
      evidenceStatus: {
        measuredOperatingPoints: physicalPoints.length,
        syntheticOperatingPoints: demoPoints.length,
        plannedPointsMatched: matchedPlanCount,
        predictiveModel: "Not fitted",
        backflowModel: "Not available",
        performanceModel: "Not available",
      },
      limitation: "This manifest contains entered values, direct calculations, an assumption-driven thermal and hydraulic screen, and a coverage plan. It contains no CFD result, certified material allowable, stress analysis, manufacturability approval, or predicted RDE operability, performance, backflow, or heat flux.",
    };
    download(JSON.stringify(payload, null, 2), designFileName(activeDesign, "json"), "application/json");
  }

  function saveCsv() {
    const header = "point_id,role,equivalence_ratio,mass_flow_kg_s,inlet_pressure_bar,observed_operating_point_id";
    const rows = plan.map((point) => [point.id, point.role, point.equivalenceRatio, point.massFlowKgS, point.inletPressureBar, point.matchedOperatingPointId ?? ""].map((value) => `"${String(value).replaceAll("\"", "\"\"")}"`).join(","));
    download([header, ...rows].join("\n"), designFileName(activeDesign, "csv"), "text/csv");
  }

  return <section className="design-workspace" aria-label="Build an RDE workspace">
    <div className="design-heading"><div><span className="workspace-label">Build an RDE</span><h1>{activeDesign.name}</h1><p>{activeDesign.application} · {activeDesign.fuel} and {activeDesign.oxidizer} · annular configuration{activeDesign.source === "published" ? " · published source record" : ""}</p></div><div className="design-heading-actions"><label><span>RDE build</span><select value={activeDesign.id} onChange={(event) => onSelectDesign(event.target.value)}>{designs.map((design) => <option key={design.id} value={design.id}>{design.name}</option>)}</select></label>{activeDesign.source !== "published" && <button className="button secondary" onClick={() => setEditing(true)}>Refine build</button>}<button className="button secondary" onClick={() => setCreating(true)}>New build</button></div></div>

    {activeDesign.source === "published" && <section className="published-design-note"><strong>Source-backed example, not a completed design definition</strong><span>Reported geometry and operating conditions are shown as entered evidence. Injector orifice size, injection angle, plenum volume, and inlet/plenum pressure were not tabulated, so Kythros leaves those quantities unavailable and does not create a screening plan from them.</span></section>}

    <section className="capability-strip" aria-label="Current model capability">
      <article><span>Preliminary build</span><strong>{activeDesign.build ? "Defined" : "Geometry only"}</strong><small>{activeDesign.build ? "Geometry, components, materials, feed, ignition, and cooling inputs" : "Refine this record to add systems, materials, and cooling"}</small></article>
      <article><span>Cooling screen</span><strong>{buildScreening?.available ? "Calculated" : "Not available"}</strong><small>{buildScreening?.available ? "From entered heat flux, channel geometry, and coolant properties" : "Only regenerative cooling is currently calculated"}</small></article>
      <article><span>Observed operating points</span><strong>{physicalPoints.length}</strong><small>{publishedPoints.length ? `${publishedPoints.length} published summaries · ${rawSignalPoints.length} raw-signal uploads` : demoPoints.length ? `${demoPoints.length} synthetic point${demoPoints.length === 1 ? "" : "s"} excluded` : "User-provided measurements only"}</small></article>
      <article><span>Screening plan coverage</span><strong>{activeDesign.source === "published" ? "Not created" : `${matchedPlanCount} / ${plan.length}`}</strong><small>{activeDesign.source === "published" ? "The source does not report the full inlet-pressure design range needed for this plan" : "Measured conditions that match this design's planned conditions"}</small></article>
    </section>

    <div className="design-overview-grid">
      <section className="design-card design-geometry-card"><div className="card-heading"><div><span>Generated from the preliminary build</span><h2>RDE geometry and assembly</h2></div><small>Interactive schematic, not CAD or CFD</small></div><RdeGeometrySchematic design={activeDesign}/></section>
      <section className="design-card"><div className="card-heading"><div><span>Calculated from the design</span><h2>Geometry and flow quantities</h2></div><small>Not model predictions</small></div>{calculations && <dl className="design-calculations">
        <div><dt>Mean diameter</dt><dd>{compactNumber(calculations.meanDiameterMm, 2)} mm</dd></div>
        <div><dt>Annulus gap</dt><dd>{compactNumber(calculations.annulusGapMm, 2)} mm</dd></div>
        <div><dt>Annulus area</dt><dd>{compactNumber(calculations.annulusAreaMm2, 1)} mm²</dd></div>
        <div><dt>Chamber volume</dt><dd>{compactNumber(calculations.chamberVolumeCm3, 1)} cm³</dd></div>
        <div><dt>Total injector area</dt><dd>{compactNumber(calculations.injectorAreaMm2, 1)} mm²</dd></div>
        <div><dt>Injector-area ratio</dt><dd>{compactPercentage(calculations.injectorAreaRatioPct)}<small>Total injector-orifice area ÷ annulus flow area × 100</small></dd></div>
        <div><dt>Annulus mass flux range</dt><dd>{compactNumber(calculations.annulusMassFluxMinKgM2S, 0)} to {compactNumber(calculations.annulusMassFluxMaxKgM2S, 0)} kg/m²/s</dd></div>
        <div><dt>Inlet / back-pressure ratio</dt><dd>{compactNumber(calculations.minimumPressureRatio, 2)} to {compactNumber(calculations.maximumPressureRatio, 2)}</dd></div>
      </dl>}</section>

      <section className="design-card build-materials-card"><div className="card-heading"><div><span>Component definition</span><h2>Materials and subsystems</h2></div><small>Nominal families, not certified allowables</small></div>{activeDesign.build ? <div className="build-component-list">
        {([
          ["Hot-wall liner", activeDesign.build.hotWallMaterial],
          ["Outer pressure jacket", activeDesign.build.outerWallMaterial],
          ["Injector face", activeDesign.build.injectorMaterial],
          ["Centerbody", activeDesign.build.centerbodyMaterial],
          ["Nozzle / exhaust", activeDesign.build.nozzleMaterial],
        ] as const).map(([component, materialId]) => { const item = RDE_MATERIALS.find((candidate) => candidate.id === materialId); return <article key={component}><span>{component}</span><strong>{materialId}</strong><small>{item?.role ?? "No screening property available"}</small>{item?.sourceUrl && <small>{item.propertyBasis} · <a href={item.sourceUrl} target="_blank" rel="noreferrer">Reference</a></small>}</article>; })}
        <article><span>Hot-wall coating</span><strong>{activeDesign.build.hotWallCoating}</strong><small>Recorded selection only; no coating life model</small></article>
        <article><span>Feed system</span><strong>{activeDesign.build.feedSystem}</strong><small>Entered architecture</small></article>
        <article><span>Ignition</span><strong>{activeDesign.build.ignitionSystem}</strong><small>Entered architecture</small></article>
        <article><span>Wall definition</span><strong>{compactNumber(activeDesign.build.wallThicknessMm, 2)} mm</strong><small>Uniform thickness assumed in the simple screen</small></article>
      </div> : <div className="build-card-empty"><strong>No subsystem or material definition</strong><p>Refine this legacy geometry record to assign component materials, feed and ignition architecture, and thermal management.</p></div>}</section>

      <section className="design-card cooling-screen-card"><div className="card-heading"><div><span>Regenerative cooling</span><h2>Thermal and hydraulic screen</h2></div><small>Entered heat load, not a predicted heat flux</small></div>{activeDesign.build && buildScreening?.available ? <>
        <div className="cooling-circuit-summary"><span><b>{activeDesign.build.coolant}</b>Coolant</span><span><b>{activeDesign.build.coolingChannelCount}</b>Channels</span><span><b>{compactNumber(activeDesign.build.coolingChannelWidthMm, 2)} × {compactNumber(activeDesign.build.coolingChannelDepthMm, 2)} mm</b>Channel section</span><span><b>{activeDesign.build.cooledSurfaces}</b>Cooled surface</span></div>
        <dl className="design-calculations cooling-calculations">
          <div><dt>Entered heat load</dt><dd>{compactNumber(buildScreening.enteredHeatLoadKW ?? Number.NaN, 1)} kW<small>{compactNumber(activeDesign.build.designHeatFluxMWM2, 2)} MW/m² over {compactNumber(buildScreening.cooledAreaM2 ?? Number.NaN, 4)} m²</small></dd></div>
          <div><dt>Channel flow area</dt><dd>{compactNumber(buildScreening.channelFlowAreaMm2 ?? Number.NaN, 2)} mm²<small>Hydraulic diameter {compactNumber(buildScreening.hydraulicDiameterMm ?? Number.NaN, 3)} mm</small></dd></div>
          <div><dt>Coolant velocity</dt><dd>{compactNumber(buildScreening.coolantVelocityMS ?? Number.NaN, 2)} m/s<small>Re {compactNumber(buildScreening.reynoldsNumber ?? Number.NaN, 0)} · {buildScreening.flowRegime}</small></dd></div>
          <div><dt>Channel pressure drop</dt><dd>{compactNumber(buildScreening.pressureDropBar ?? Number.NaN, 3)} bar<small>Darcy-Weisbach first-order estimate</small></dd></div>
          <div><dt>Coolant temperature rise</dt><dd>{compactNumber(buildScreening.coolantTemperatureRiseK ?? Number.NaN, 1)} K<small>Uniform heat pickup assumed</small></dd></div>
          <div><dt>Screened hot-wall temperature</dt><dd>{compactNumber(buildScreening.estimatedHotWallTemperatureK ?? Number.NaN, 0)} K<small>Source-backed material reference {compactNumber(buildScreening.materialReferenceTemperatureK ?? Number.NaN, 0)} K</small></dd></div>
          <div><dt>Coolant-side coefficient</dt><dd>{compactNumber(buildScreening.coolantCoefficientWM2K ?? Number.NaN, 0)} W/m²/K<small>Rectangular-channel correlation</small></dd></div>
          <div><dt>Simple hoop stress</dt><dd>{compactNumber(buildScreening.simpleHoopStressMPa ?? Number.NaN, 1)} MPa<small>Thin-wall pressure screen only</small></dd></div>
        </dl>
        <div className="build-screen-messages">{buildScreening.messages.map((message) => <p key={message}>{message}</p>)}</div>
      </> : <div className="build-card-empty"><strong>{activeDesign.build?.coolingMethod ?? "Cooling not defined"}</strong><p>{buildScreening?.messages[0] ?? "Refine the build to run the regenerative-cooling screen."}</p></div>}</section>

      <section className="design-card next-point-card"><div className="card-heading"><div><span>{activeDesign.source === "published" ? "Published evidence loaded" : "Coverage-based next point"}</span><h2>{activeDesign.source === "published" ? "Inspect the real observed envelope" : nextPoint ? nextPoint.role === "Baseline" ? "Establish the centre condition" : `Add the ${nextPoint.role.toLowerCase()}` : "Screening plan covered"}</h2></div></div>{activeDesign.source === "published" ? <><p>The source provides enough information to test the operating-envelope hierarchy, plotting, provenance, and reported-mode display. It does not provide enough raw evidence to validate signal analysis or recommend a new test.</p><button className="button primary" onClick={() => onOpenEnvelope(activeDesign.id)}>Open Operating Envelope</button></> : nextPoint ? <><p>This point is selected from the entered design range because it is the planned condition farthest from the loaded measured observations. It is not an operability prediction.</p><div className="next-point-values"><span><b>φ {nextPoint.equivalenceRatio.toFixed(2)}</b>Equivalence ratio</span><span><b>{nextPoint.massFlowKgS.toFixed(3)} kg/s</b>Mass flow</span><span><b>{nextPoint.inletPressureBar.toFixed(2)} bar</b>Inlet pressure</span></div><button className="button primary" onClick={() => onAddOperatingPoint(activeDesign.id, nextPoint)}>Add this operating point</button></> : <><p>Every point in the current screening plan has a matched measured operating point. Open the Operating Envelope to inspect the observed modes.</p><button className="button primary" onClick={() => onOpenEnvelope(activeDesign.id)}>Open Operating Envelope</button></>}</section>
    </div>

    {activeDesign.source !== "published" && <section className="screening-plan-card"><div className="card-heading"><div><span>Initial screening plan</span><h2>Nine candidate conditions, not operating predictions</h2><p>Kythros creates these starting conditions only from the ranges you entered. A row does not mean the engine is stable, safe, or expected to perform successfully there.</p></div><div><button className="button secondary" onClick={saveCsv}>Download CSV</button><button className="button secondary" onClick={saveManifest}>Download manifest</button></div></div><div className="screening-table-wrap"><table><thead><tr><th>Why this candidate exists</th><th>Equivalence ratio</th><th>Mass flow</th><th>Inlet pressure</th><th>Measured evidence</th><th></th></tr></thead><tbody>{plan.map((point) => <tr key={point.id}><th>{point.role}</th><td>φ {point.equivalenceRatio.toFixed(2)}</td><td>{point.massFlowKgS.toFixed(3)} kg/s</td><td>{point.inletPressureBar.toFixed(2)} bar</td><td><span className={`plan-status ${point.matchedOperatingPointId ? "matched" : "planned"}`}>{point.matchedOperatingPointId ? "Measured point loaded" : "Candidate only; not tested"}</span></td><td>{!point.matchedOperatingPointId && <button onClick={() => onAddOperatingPoint(activeDesign.id, point)}>Add measured point</button>}</td></tr>)}</tbody></table></div></section>}

    {designs.length > 1 && <section className="screening-plan-card design-portfolio"><div className="card-heading"><div><span>Design comparison</span><h2>Entered designs and evidence coverage</h2><p>This compares entered geometry and loaded evidence only. It does not rank performance.</p></div></div><div className="screening-table-wrap"><table><thead><tr><th>Design</th><th>Propellants</th><th>Annulus gap</th><th>Injector-area ratio</th><th>Observed points</th><th></th></tr></thead><tbody>{designs.map((design) => { const result = calculateDesign(design); const pointCount = operatingPoints.filter((item) => item.designId === design.id && item.source !== "demo").length; return <tr key={design.id}><th>{design.name}</th><td>{design.fuel} / {design.oxidizer}</td><td>{compactNumber(result.annulusGapMm, 2)} mm</td><td>{compactPercentage(result.injectorAreaRatioPct)}</td><td>{pointCount}</td><td><button onClick={() => onSelectDesign(design.id)}>{design.id === activeDesign.id ? "Selected" : "Open"}</button></td></tr>; })}</tbody></table></div></section>}

    <section className="product-boundary-card"><div><span>What Kythros can do now</span><strong>Define a preliminary RDE build, map materials to components, screen an entered regenerative-cooling load, plan operating conditions, compare evidence, classify, and report.</strong></div><div><span>What still requires engineering analysis</span><strong>Combustion and heat-flux prediction, detailed manifolds and CAD, conjugate heat transfer, stress and life analysis, feed-system dynamics, seals and joints, manufacturability, and hardware certification.</strong></div></section>
  </section>;
}
