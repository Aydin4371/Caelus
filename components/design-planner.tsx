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
import { MaterialComparison } from "@/components/material-comparison";
import { RDE_MATERIALS, calculateRdeBuildScreening } from "@/lib/rde-build";
import { buildEngineManifest, engineRevisionLabel, normalizedEngineRevision } from "@/lib/engine-manifest";

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

function thermalMethodExplanation(method: EngineBuildDefinition["coolingMethod"]) {
  if (method === "Regenerative") return "A channel circuit will be drawn and screened from the entered coolant and geometry.";
  if (method === "Film") return "A wall film and injection feature will be drawn. The direct screen reports coolant allocation and applies your entered effectiveness assumption.";
  if (method === "Heat sink") return "A thermal-mass shell will be drawn. The direct screen reports sensible-energy capacity and an idealized exposure duration.";
  if (method === "Ablative") return "A sacrificial liner will be drawn. The direct screen reports material inventory and an idealized energy-equivalent duration, not recession.";
  return "Saved without a thermal-management definition. No cooling hardware or thermal screen will be shown.";
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
    return { ...copy, build: { ...EMPTY_ENGINE_DESIGN.build!, ...(copy.build ?? {}) } };
  });
  const [error, setError] = useState("");
  const setNumber = (key: keyof EngineDesign, value: string) => setDraft((current) => ({ ...current, [key]: value === "" ? Number.NaN : Number(value) }));
  const setText = (key: keyof EngineDesign, value: string) => setDraft((current) => ({ ...current, [key]: value }));
  const setBuild = <Key extends keyof EngineBuildDefinition>(key: Key, value: EngineBuildDefinition[Key]) => setDraft((current) => ({ ...current, build: { ...(current.build ?? EMPTY_ENGINE_DESIGN.build!), [key]: value } }));
  const setBuildNumber = (key: keyof EngineBuildDefinition, value: string) => setDraft((current) => ({ ...current, build: { ...(current.build ?? EMPTY_ENGINE_DESIGN.build!), [key]: value === "" ? Number.NaN : Number(value) } as EngineBuildDefinition }));
  const build = draft.build!;
  const [step, setStep] = useState(0);

  function submit() {
    const issues = validateEngineDesign(draft);
    if (issues.length) { setStep(3); return setError(issues[0]); }
    const id = draft.id || `design-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    onSave({ ...draft, id, source: "user" });
  }

  return <section className="design-editor" aria-label="Preliminary RDE build inputs">
    <div className="design-editor-heading"><div><span className="workspace-label">Preliminary RDE builder</span><h1>{draft.id ? "Refine the RDE build" : "Build an RDE concept"}</h1><p>Define the engine, hot-section materials, and cooling circuit in one traceable record. Kythros performs direct geometry and first-order screening calculations, not CFD, combustion prediction, stress analysis, or design certification.</p></div></div>

    <nav className="design-stepper" aria-label="Design steps">{["Geometry", "Materials & cooling", "Operating range", "Review"].map((label, index) => <button key={label} type="button" aria-current={step === index ? "step" : undefined} onClick={() => setStep(index)}><span>{index + 1}</span>{label}</button>)}</nav>
    <div hidden={step !== 0}>
    <div className="design-form-section"><h2>Identity and propellants</h2><div className={`application-definition ${draft.application === "Air-breathing" ? "air-breathing" : "rocket"}`}><strong>{draft.application} RDE variant</strong><span>{draft.application === "Air-breathing" ? "Air is supplied by the selected upstream inlet architecture. This preliminary build defines the annular combustor and fuel delivery, not the external inlet or compressor." : "Fuel and oxidizer are supplied through the entered onboard feed system and injector face."}</span></div><div className="design-form-grid four">
      <label><span>Design name</span><input value={draft.name} onChange={(event) => setText("name", event.target.value)} placeholder="Annular demonstrator A" /></label>
      <label><span>Application</span><select value={draft.application} onChange={(event) => setText("application", event.target.value)}><option>Rocket</option><option>Air-breathing</option></select></label>
      <label><span>Fuel</span><input value={draft.fuel} onChange={(event) => setText("fuel", event.target.value)} /></label>
      <label><span>{draft.application === "Air-breathing" ? "Oxidizer / working air" : "Oxidizer"}</span><input value={draft.oxidizer} onChange={(event) => setText("oxidizer", event.target.value)} /></label>
      <label><span>{draft.application === "Air-breathing" ? "Fuel delivery system" : "Propellant feed system"}</span><input value={build.feedSystem} onChange={(event) => setBuild("feedSystem", event.target.value)} placeholder={draft.application === "Air-breathing" ? "Fuel pump / pressure-fed" : "Pressure-fed"} /></label>
      <label><span>Ignition system</span><input value={build.ignitionSystem} onChange={(event) => setBuild("ignitionSystem", event.target.value)} placeholder="Pre-detonator" /></label>
      {draft.application === "Air-breathing" && <><label><span>Air inlet architecture</span><select value={build.airInletArchitecture ?? "Not defined"} onChange={(event) => setBuild("airInletArchitecture", event.target.value as EngineBuildDefinition["airInletArchitecture"])}><option>Ram-fed</option><option>Compressor-fed</option><option>Direct-connect test rig</option><option>Not defined</option></select></label><label><span>Fuel-air preparation</span><select value={build.airFuelPreparation ?? "Separate fuel injection"} onChange={(event) => setBuild("airFuelPreparation", event.target.value as EngineBuildDefinition["airFuelPreparation"])}><option>Separate fuel injection</option><option>Premixed upstream</option></select></label></>}
    </div></div>

    <div className="design-form-section"><h2>Annulus and injector</h2><div className="design-form-grid four">
      <label><span>Inner diameter (mm)</span><input type="number" value={numberValue(draft.annulusInnerDiameterMm)} onChange={(event) => setNumber("annulusInnerDiameterMm", event.target.value)} /></label>
      <label><span>Outer diameter (mm)</span><input type="number" value={numberValue(draft.annulusOuterDiameterMm)} onChange={(event) => setNumber("annulusOuterDiameterMm", event.target.value)} /></label>
      <label><span>Chamber length (mm)</span><input type="number" value={numberValue(draft.chamberLengthMm)} onChange={(event) => setNumber("chamberLengthMm", event.target.value)} /></label>
      <label><span>Injector type</span><input value={draft.injectorType} onChange={(event) => setText("injectorType", event.target.value)} /></label>
      <label><span>Injector count</span><input type="number" step="1" value={numberValue(draft.injectorCount)} onChange={(event) => setNumber("injectorCount", event.target.value)} /></label>
      <label><span>Orifice diameter (mm)</span><input type="number" step="0.01" value={numberValue(draft.injectorDiameterMm)} onChange={(event) => setNumber("injectorDiameterMm", event.target.value)} /></label>
      <label><span>Injection angle (deg)</span><input type="number" min="0" max="90" value={numberValue(draft.injectorAngleDeg)} onChange={(event) => setNumber("injectorAngleDeg", event.target.value)} /></label>
      <label><span>{draft.application === "Air-breathing" ? "Inlet / manifold volume (cm³)" : "Plenum volume (cm³)"}</span><input type="number" value={numberValue(draft.plenumVolumeCm3)} onChange={(event) => setNumber("plenumVolumeCm3", event.target.value)} /></label>
      <label><span>Wall condition</span><input value={draft.wallCondition} onChange={(event) => setText("wallCondition", event.target.value)} /></label>
      <label><span>Exhaust configuration</span><input value={draft.exhaustConfiguration} onChange={(event) => setText("exhaustConfiguration", event.target.value)} /></label>
    </div></div>

    </div>
    <div hidden={step !== 1}>
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
    </div><MaterialComparison design={draft} onSelect={(key, material) => setBuild(key, material)} /></div>

    <div className="design-form-section"><h2>Thermal management</h2><p className="design-form-help">Choose the actual method. Each defined method saves its own hardware inputs, appears differently in the 3D assembly, and receives a transparent direct screen from your assumptions.</p><div className="design-form-grid four">
      <label><span>Cooling method</span><select value={build.coolingMethod} onChange={(event) => setBuild("coolingMethod", event.target.value as EngineBuildDefinition["coolingMethod"])}><option>Regenerative</option><option>Film</option><option>Heat sink</option><option>Ablative</option><option>Not defined</option></select></label>
    </div>
    <div className={`thermal-method-confirmation ${build.coolingMethod === "Regenerative" ? "regenerative" : ""}`}><strong>{build.coolingMethod} selected</strong><span>{thermalMethodExplanation(build.coolingMethod)}</span></div>
    {build.coolingMethod !== "Not defined" && <div className="design-form-grid four thermal-common-inputs">
      <label><span>Cooled surfaces</span><select value={build.cooledSurfaces} onChange={(event) => setBuild("cooledSurfaces", event.target.value as EngineBuildDefinition["cooledSurfaces"])}><option>Outer wall</option><option>Inner and outer walls</option></select></label>
      <label><span>Entered heat flux (MW/m²)</span><input type="number" step="0.1" min="0" value={numberValue(build.designHeatFluxMWM2)} onChange={(event) => setBuildNumber("designHeatFluxMWM2", event.target.value)} /></label>
    </div>}
    {build.coolingMethod === "Regenerative" && <div className="design-form-grid four regenerative-inputs">
      <label><span>Coolant</span><input value={build.coolant} onChange={(event) => setBuild("coolant", event.target.value)} placeholder="Fuel" /></label>
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
    </div>}
    {build.coolingMethod === "Film" && <div className="design-form-grid four method-specific-inputs film-inputs">
      <label><span>Film coolant</span><input value={build.filmCoolant ?? ""} onChange={(event) => setBuild("filmCoolant", event.target.value)} placeholder="Fuel" /></label>
      <label><span>Film mass flow (kg/s)</span><input type="number" step="0.01" min="0" value={numberValue(build.filmMassFlowKgS)} onChange={(event) => setBuildNumber("filmMassFlowKgS", event.target.value)} /></label>
      <label><span>Injection geometry</span><select value={build.filmInjectionGeometry ?? "Annular slot"} onChange={(event) => setBuild("filmInjectionGeometry", event.target.value as EngineBuildDefinition["filmInjectionGeometry"])}><option>Annular slot</option><option>Discrete holes</option></select></label>
      <label><span>Injection location</span><select value={build.filmInjectionLocation ?? "Injector face"} onChange={(event) => setBuild("filmInjectionLocation", event.target.value as EngineBuildDefinition["filmInjectionLocation"])}><option>Injector face</option><option>Chamber inlet</option><option>Mid-chamber</option></select></label>
      <label><span>Injection angle (deg)</span><input type="number" step="1" min="0" max="90" value={numberValue(build.filmInjectionAngleDeg)} onChange={(event) => setBuildNumber("filmInjectionAngleDeg", event.target.value)} /></label>
      <label><span>Entered effectiveness (%)</span><input type="number" step="1" min="0" max="100" value={numberValue(build.filmEffectivenessPct)} onChange={(event) => setBuildNumber("filmEffectivenessPct", event.target.value)} /></label>
    </div>}
    {build.coolingMethod === "Heat sink" && <div className="design-form-grid four method-specific-inputs heat-sink-inputs">
      <label><span>Thermal mass (kg)</span><input type="number" step="0.1" min="0" value={numberValue(build.heatSinkMassKg)} onChange={(event) => setBuildNumber("heatSinkMassKg", event.target.value)} /></label>
      <label><span>Specific heat (J/kg/K)</span><input type="number" step="1" min="0" value={numberValue(build.heatSinkSpecificHeatJkgK)} onChange={(event) => setBuildNumber("heatSinkSpecificHeatJkgK", event.target.value)} /></label>
      <label><span>Initial temperature (K)</span><input type="number" step="1" min="0" value={numberValue(build.heatSinkInitialTemperatureK)} onChange={(event) => setBuildNumber("heatSinkInitialTemperatureK", event.target.value)} /></label>
      <label><span>Maximum entered temperature (K)</span><input type="number" step="1" min="0" value={numberValue(build.heatSinkMaximumTemperatureK)} onChange={(event) => setBuildNumber("heatSinkMaximumTemperatureK", event.target.value)} /></label>
    </div>}
    {build.coolingMethod === "Ablative" && <div className="design-form-grid four method-specific-inputs ablative-inputs">
      <label><span>Ablative liner material</span><input value={build.ablativeMaterial ?? ""} onChange={(event) => setBuild("ablativeMaterial", event.target.value)} placeholder="Silica-phenolic composite" /></label>
      <label><span>Liner thickness (mm)</span><input type="number" step="0.1" min="0" value={numberValue(build.ablativeThicknessMm)} onChange={(event) => setBuildNumber("ablativeThicknessMm", event.target.value)} /></label>
      <label><span>Entered density (kg/m³)</span><input type="number" step="1" min="0" value={numberValue(build.ablativeDensityKgM3)} onChange={(event) => setBuildNumber("ablativeDensityKgM3", event.target.value)} /></label>
      <label><span>Effective heat absorption (MJ/kg)</span><input type="number" step="0.1" min="0" value={numberValue(build.ablativeEffectiveHeatMJkg)} onChange={(event) => setBuildNumber("ablativeEffectiveHeatMJkg", event.target.value)} /></label>
    </div>}
    </div>

    </div>
    <div hidden={step !== 2}>
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

    </div>
    {step === 3 && <div className="design-review"><h2>Review your concept</h2><p>{draft.name || "Untitled engine"} · {draft.fuel} / {draft.oxidizer}</p><dl><div><dt>Annulus</dt><dd>{compactNumber(draft.annulusInnerDiameterMm)}–{compactNumber(draft.annulusOuterDiameterMm)} mm · {compactNumber(draft.chamberLengthMm)} mm long</dd></div><div><dt>Hot wall</dt><dd>{build.hotWallMaterial}</dd></div><div><dt>Cooling</dt><dd>{build.coolingMethod}</dd></div></dl>{validateEngineDesign(draft).length ? <><h3>Complete before saving</h3><ul>{validateEngineDesign(draft).map((issue) => <li key={issue}>{issue}</li>)}</ul></> : <p>Inputs are complete. Save this revision to use it in simulation.</p>}<p>Material screening uses entered heat loads. The local Full 3D solver does not model solid walls or cooling circuits.</p></div>}
    {error && <p className="error-message" role="alert">{error}</p>}
    <div className="design-editor-actions"><button className="button secondary" onClick={onCancel}>Cancel</button>{step > 0 && <button className="button secondary" onClick={() => setStep(step - 1)}>Back</button>}{step < 3 ? <button className="button primary" onClick={() => setStep(step + 1)}>Continue →</button> : <button className="button primary" onClick={submit}>Save preliminary build</button>}</div>
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
  const thermalMethod = activeDesign?.build?.coolingMethod ?? "Not defined";

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
      ...buildEngineManifest(activeDesign, calculations, buildScreening, physicalPoints.map((point) => point.id)),
      screeningPlan: plan,
      evidenceStatus: {
        measuredOperatingPoints: physicalPoints.length,
        syntheticOperatingPoints: demoPoints.length,
        plannedPointsMatched: matchedPlanCount,
        predictiveModel: "Not fitted",
        backflowModel: "Not available",
        performanceModel: "Not available",
      },
    };
    download(JSON.stringify(payload, null, 2), designFileName(activeDesign, "json"), "application/json");
  }

  function saveCsv() {
    const header = "point_id,role,equivalence_ratio,mass_flow_kg_s,inlet_pressure_bar,observed_operating_point_id";
    const rows = plan.map((point) => [point.id, point.role, point.equivalenceRatio, point.massFlowKgS, point.inletPressureBar, point.matchedOperatingPointId ?? ""].map((value) => `"${String(value).replaceAll("\"", "\"\"")}"`).join(","));
    download([header, ...rows].join("\n"), designFileName(activeDesign, "csv"), "text/csv");
  }

  return <section className="design-workspace" aria-label="Build an RDE workspace">
    <div className="design-heading"><div><span className="workspace-label">Build an RDE</span><h1>{activeDesign.name}</h1><p>{activeDesign.application} · {activeDesign.fuel} and {activeDesign.oxidizer} · annular configuration{activeDesign.source === "published" ? " · published source record" : ""}</p><div className="engine-revision-line"><strong>Revision {normalizedEngineRevision(activeDesign).number}</strong><span>{normalizedEngineRevision(activeDesign).fingerprint}</span><small>Immutable evidence identity</small></div></div><div className="design-heading-actions"><label><span>RDE build revision</span><select value={activeDesign.id} onChange={(event) => onSelectDesign(event.target.value)}>{designs.map((design) => <option key={design.id} value={design.id}>{engineRevisionLabel(design)}</option>)}</select></label>{activeDesign.source !== "published" && <button className="button secondary" onClick={() => setEditing(true)}>Create revised build</button>}<button className="button secondary" onClick={() => setCreating(true)}>New build</button></div></div>

    {activeDesign.revision?.supersedesDesignId && <section className="revision-trace-note"><strong>This is a new immutable engine revision.</strong><span>Earlier operating points and CFD runs remain attached to {activeDesign.revision.supersedesDesignId}; they were not silently rewritten.</span></section>}

    {activeDesign.source === "published" && <section className="published-design-note"><strong>Source-backed example, not a completed design definition</strong><span>Reported geometry and operating conditions are shown as entered evidence. Injector orifice size, injection angle, plenum volume, and inlet/plenum pressure were not tabulated, so Kythros leaves those quantities unavailable and does not create a screening plan from them.</span></section>}

    <section className="capability-strip" aria-label="Current model capability">
      <article><span>Preliminary build</span><strong>{activeDesign.build ? "Defined" : "Geometry only"}</strong><small>{activeDesign.build ? "Geometry, components, materials, feed, ignition, and cooling inputs" : "Refine this record to add systems, materials, and cooling"}</small></article>
      <article><span>Thermal management</span><strong>{buildScreening?.available ? `${thermalMethod} direct screen` : `${thermalMethod} recorded`}</strong><small>{buildScreening?.available ? "Calculated from saved method inputs and entered heat-load assumptions" : thermalMethodExplanation(thermalMethod)}</small></article>
      <article><span>Observed operating points</span><strong>{physicalPoints.length}</strong><small>{publishedPoints.length ? `${publishedPoints.length} published summaries · ${rawSignalPoints.length} raw-signal uploads` : demoPoints.length ? `${demoPoints.length} synthetic point${demoPoints.length === 1 ? "" : "s"} excluded` : "User-provided measurements only"}</small></article>
      <article><span>Screening plan coverage</span><strong>{activeDesign.source === "published" ? "Not created" : `${matchedPlanCount} / ${plan.length}`}</strong><small>{activeDesign.source === "published" ? "The source does not report the full inlet-pressure design range needed for this plan" : "Measured conditions that match this design's planned conditions"}</small></article>
    </section>

    <div className="design-overview-grid">
      <section className="design-card design-geometry-card"><div className="card-heading"><div><span>Generated from the preliminary build</span><h2>RDE geometry and assembly</h2></div><small>Interactive schematic, not CAD or CFD</small></div><RdeGeometrySchematic design={activeDesign}/></section>
      <section className="design-card geometry-quantities-card"><div className="card-heading"><div><span>Calculated from the design</span><h2>Geometry and flow quantities</h2></div><small>Not model predictions</small></div>{calculations && <dl className="design-calculations">
        <div><dt>Mean diameter</dt><dd>{compactNumber(calculations.meanDiameterMm, 2)} mm</dd></div>
        <div><dt>Annulus gap</dt><dd>{compactNumber(calculations.annulusGapMm, 2)} mm</dd></div>
        <div><dt>Annulus area</dt><dd>{compactNumber(calculations.annulusAreaMm2, 1)} mm²</dd></div>
        <div><dt>Chamber volume</dt><dd>{compactNumber(calculations.chamberVolumeCm3, 1)} cm³</dd></div>
        <div><dt>Total injector area</dt><dd>{compactNumber(calculations.injectorAreaMm2, 1)} mm²</dd></div>
        <div><dt>Injector-area ratio</dt><dd>{compactPercentage(calculations.injectorAreaRatioPct)}<small>Total injector-orifice area ÷ annulus flow area × 100</small></dd></div>
        <div><dt>Annulus mass flux range</dt><dd>{compactNumber(calculations.annulusMassFluxMinKgM2S, 0)} to {compactNumber(calculations.annulusMassFluxMaxKgM2S, 0)} kg/m²/s</dd></div>
        <div><dt>Inlet / back-pressure ratio</dt><dd>{compactNumber(calculations.minimumPressureRatio, 2)} to {compactNumber(calculations.maximumPressureRatio, 2)}</dd></div>
      </dl>}</section>

      <section className="design-card build-materials-card"><div className="card-heading"><div><span>Component definition</span><h2>Materials and subsystems</h2></div><small>Nominal families, not certified allowables</small></div>{activeDesign.build ? <div className="build-material-layout"><div className="material-component-rows">
        {([
          ["Hot-wall liner", activeDesign.build.hotWallMaterial],
          ["Outer pressure jacket", activeDesign.build.outerWallMaterial],
          ["Injector face", activeDesign.build.injectorMaterial],
          ["Centerbody", activeDesign.build.centerbodyMaterial],
          ["Nozzle / exhaust", activeDesign.build.nozzleMaterial],
        ] as const).map(([component, materialId]) => { const item = RDE_MATERIALS.find((candidate) => candidate.id === materialId); return <article key={component}><header><div><span>{component}</span><strong>{materialId}</strong></div><p>{item?.role ?? "No screening property available"}</p></header><div className="material-guidance-columns"><section className="material-guidance-pro"><b>WHY IT FITS</b><p>{item?.advantages[0] ?? "No guidance available"}</p></section><section className="material-guidance-watch"><b>WATCH</b><p>{item?.tradeoffs[0] ?? "No guidance available"}</p></section><section className="material-guidance-reference"><b>REFERENCE BASIS</b><p>{item?.propertyBasis ?? "No screening properties"}{item?.sourceUrl && <> · <a href={item.sourceUrl} target="_blank" rel="noreferrer">Open source</a></>}</p></section></div></article>; })}
        </div><div className="subsystem-definition-grid">
          <article><span>Hot-wall coating</span><strong>{activeDesign.build.hotWallCoating}</strong><small>Recorded selection only; no coating-life model</small></article>
          <article><span>{activeDesign.application === "Air-breathing" ? "Fuel delivery" : "Propellant feed"}</span><strong>{activeDesign.build.feedSystem}</strong><small>Entered architecture</small></article>
          {activeDesign.application === "Air-breathing" && <><article><span>Upstream air inlet</span><strong>{activeDesign.build.airInletArchitecture ?? "Not defined"}</strong><small>The external inlet or compressor is outside this model</small></article><article><span>Fuel-air preparation</span><strong>{activeDesign.build.airFuelPreparation ?? "Not defined"}</strong><small>Entered mixing architecture</small></article></>}
          <article><span>Ignition</span><strong>{activeDesign.build.ignitionSystem}</strong><small>Entered architecture</small></article>
          <article><span>Wall definition</span><strong>{compactNumber(activeDesign.build.wallThicknessMm, 2)} mm</strong><small>Uniform thickness assumed in the direct screen</small></article>
        </div></div> : <div className="build-card-empty"><strong>No subsystem or material definition</strong><p>Refine this legacy geometry record to assign component materials, feed and ignition architecture, and thermal management.</p></div>}</section>

      <section className="design-card cooling-screen-card"><div className="card-heading"><div><span>Thermal management</span><h2>{thermalMethod === "Not defined" ? "No method defined" : thermalMethod === "Regenerative" ? "Regenerative thermal and hydraulic screen" : `${thermalMethod} direct screen`}</h2></div><small>Entered assumptions, not predicted performance or life</small></div>{activeDesign.build && buildScreening?.available ? <>
        <div className={`cooling-circuit-summary method-${thermalMethod.toLowerCase().replace(" ", "-")}`}>
          {thermalMethod === "Regenerative" && <><span><b>{activeDesign.build.coolant}</b>Coolant</span><span><b>{activeDesign.build.coolingChannelCount}</b>Channels</span><span><b>{compactNumber(activeDesign.build.coolingChannelWidthMm, 2)} × {compactNumber(activeDesign.build.coolingChannelDepthMm, 2)} mm</b>Channel section</span><span><b>{activeDesign.build.cooledSurfaces}</b>Cooled surface</span></>}
          {thermalMethod === "Film" && <><span><b>{activeDesign.build.filmCoolant}</b>Film coolant</span><span><b>{activeDesign.build.filmInjectionGeometry}</b>Delivery</span><span><b>{activeDesign.build.filmInjectionLocation} · {compactNumber(activeDesign.build.filmInjectionAngleDeg, 0)}°</b>Injection</span><span><b>{activeDesign.build.cooledSurfaces}</b>Protected surface</span></>}
          {thermalMethod === "Heat sink" && <><span><b>{compactNumber(activeDesign.build.heatSinkMassKg, 2)} kg</b>Thermal mass</span><span><b>{compactNumber(activeDesign.build.heatSinkSpecificHeatJkgK, 0)} J/kg/K</b>Specific heat</span><span><b>{compactNumber(activeDesign.build.heatSinkInitialTemperatureK, 0)} to {compactNumber(activeDesign.build.heatSinkMaximumTemperatureK, 0)} K</b>Entered window</span><span><b>{activeDesign.build.cooledSurfaces}</b>Protected surface</span></>}
          {thermalMethod === "Ablative" && <><span><b>{activeDesign.build.ablativeMaterial}</b>Liner material</span><span><b>{compactNumber(activeDesign.build.ablativeThicknessMm, 2)} mm</b>Thickness</span><span><b>{compactNumber(activeDesign.build.ablativeDensityKgM3, 0)} kg/m³</b>Entered density</span><span><b>{activeDesign.build.cooledSurfaces}</b>Protected surface</span></>}
        </div>
        {thermalMethod === "Regenerative" && <dl className="design-calculations cooling-calculations">
          <div><dt>Entered heat load</dt><dd>{compactNumber(buildScreening.enteredHeatLoadKW ?? Number.NaN, 1)} kW<small>{compactNumber(activeDesign.build.designHeatFluxMWM2, 2)} MW/m² over {compactNumber(buildScreening.cooledAreaM2 ?? Number.NaN, 4)} m²</small></dd></div>
          <div><dt>Channel flow area</dt><dd>{compactNumber(buildScreening.channelFlowAreaMm2 ?? Number.NaN, 2)} mm²<small>Hydraulic diameter {compactNumber(buildScreening.hydraulicDiameterMm ?? Number.NaN, 3)} mm</small></dd></div>
          <div><dt>Coolant velocity</dt><dd>{compactNumber(buildScreening.coolantVelocityMS ?? Number.NaN, 2)} m/s<small>Re {compactNumber(buildScreening.reynoldsNumber ?? Number.NaN, 0)} · {buildScreening.flowRegime}</small></dd></div>
          <div><dt>Channel pressure drop</dt><dd>{compactNumber(buildScreening.pressureDropBar ?? Number.NaN, 3)} bar<small>Darcy-Weisbach first-order estimate</small></dd></div>
          <div><dt>Coolant temperature rise</dt><dd>{compactNumber(buildScreening.coolantTemperatureRiseK ?? Number.NaN, 1)} K<small>Uniform heat pickup assumed</small></dd></div>
          <div><dt>Screened hot-wall temperature</dt><dd>{compactNumber(buildScreening.estimatedHotWallTemperatureK ?? Number.NaN, 0)} K<small>Source-backed material reference {compactNumber(buildScreening.materialReferenceTemperatureK ?? Number.NaN, 0)} K</small></dd></div>
          <div><dt>Coolant-side coefficient</dt><dd>{compactNumber(buildScreening.coolantCoefficientWM2K ?? Number.NaN, 0)} W/m²/K<small>Rectangular-channel correlation</small></dd></div>
          <div><dt>Simple hoop stress</dt><dd>{compactNumber(buildScreening.simpleHoopStressMPa ?? Number.NaN, 1)} MPa<small>Thin-wall pressure screen only</small></dd></div>
        </dl>}
        {thermalMethod === "Film" && <dl className="design-calculations cooling-calculations">
          <div><dt>Entered heat load</dt><dd>{compactNumber(buildScreening.enteredHeatLoadKW ?? Number.NaN, 1)} kW<small>{compactNumber(activeDesign.build.designHeatFluxMWM2, 2)} MW/m² over {compactNumber(buildScreening.cooledAreaM2 ?? Number.NaN, 4)} m²</small></dd></div>
          <div><dt>Film-flow allocation</dt><dd>{compactPercentage(buildScreening.filmCoolantFractionPct ?? Number.NaN, 2)}<small>{compactNumber(activeDesign.build.filmMassFlowKgS, 3)} kg/s ÷ midpoint main flow</small></dd></div>
          <div><dt>Entered effectiveness</dt><dd>{compactPercentage(buildScreening.enteredFilmEffectivenessPct ?? Number.NaN, 1)}<small>User assumption, not calculated film effectiveness</small></dd></div>
          <div><dt>Residual entered heat flux</dt><dd>{compactNumber(buildScreening.screenedResidualHeatFluxMWM2 ?? Number.NaN, 2)} MW/m²<small>Entered heat flux × (1 − entered effectiveness)</small></dd></div>
          <div><dt>Heat-load offset</dt><dd>{compactNumber(buildScreening.filmProtectedHeatLoadKW ?? Number.NaN, 1)} kW<small>Bookkeeping result, not wall-temperature prediction</small></dd></div>
        </dl>}
        {thermalMethod === "Heat sink" && <dl className="design-calculations cooling-calculations">
          <div><dt>Entered heat load</dt><dd>{compactNumber(buildScreening.enteredHeatLoadKW ?? Number.NaN, 1)} kW<small>{compactNumber(activeDesign.build.designHeatFluxMWM2, 2)} MW/m² over {compactNumber(buildScreening.cooledAreaM2 ?? Number.NaN, 4)} m²</small></dd></div>
          <div><dt>Sensible-energy capacity</dt><dd>{compactNumber(buildScreening.heatSinkEnergyCapacityKJ ?? Number.NaN, 1)} kJ<small>Mass × specific heat × entered temperature rise</small></dd></div>
          <div><dt>Idealized exposure duration</dt><dd>{compactNumber(buildScreening.idealizedHeatSinkDurationS ?? Number.NaN, 2)} s<small>Energy capacity ÷ entered heat load</small></dd></div>
        </dl>}
        {thermalMethod === "Ablative" && <dl className="design-calculations cooling-calculations">
          <div><dt>Entered heat load</dt><dd>{compactNumber(buildScreening.enteredHeatLoadKW ?? Number.NaN, 1)} kW<small>{compactNumber(activeDesign.build.designHeatFluxMWM2, 2)} MW/m² over {compactNumber(buildScreening.cooledAreaM2 ?? Number.NaN, 4)} m²</small></dd></div>
          <div><dt>Ablative inventory</dt><dd>{compactNumber(buildScreening.ablativeVolumeCm3 ?? Number.NaN, 1)} cm³<small>{compactNumber(buildScreening.ablativeMassKg ?? Number.NaN, 3)} kg from entered density</small></dd></div>
          <div><dt>Idealized energy-equivalent duration</dt><dd>{compactNumber(buildScreening.idealizedAblativeDurationS ?? Number.NaN, 2)} s<small>{compactNumber(activeDesign.build.ablativeEffectiveHeatMJkg, 2)} MJ/kg entered effective absorption</small></dd></div>
        </dl>}
        <div className="build-screen-messages">{buildScreening.messages.map((message) => <p key={message}>{message}</p>)}</div>
      </> : <div className="build-card-empty"><strong>{thermalMethod === "Not defined" ? "Choose a thermal-management method" : `${thermalMethod} needs method inputs`}</strong><p>{thermalMethodExplanation(thermalMethod)}</p>{buildScreening?.messages.map((message) => <small key={message}>{message}</small>)}</div>}</section>

      <section className="design-card next-point-card"><div className="card-heading"><div><span>{activeDesign.source === "published" ? "Published evidence loaded" : "Coverage-based next point"}</span><h2>{activeDesign.source === "published" ? "Inspect the real observed envelope" : nextPoint ? nextPoint.role === "Baseline" ? "Establish the centre condition" : `Add the ${nextPoint.role.toLowerCase()}` : "Screening plan covered"}</h2></div></div>{activeDesign.source === "published" ? <><p>The source provides enough information to test the operating-envelope hierarchy, plotting, provenance, and reported-mode display. It does not provide enough raw evidence to validate signal analysis or recommend a new test.</p><button className="button primary" onClick={() => onOpenEnvelope(activeDesign.id)}>Open Operating Envelope</button></> : nextPoint ? <><p>This point is selected from the entered design range because it is the planned condition farthest from the loaded measured observations. It is not an operability prediction.</p><div className="next-point-values"><span><b>φ {nextPoint.equivalenceRatio.toFixed(2)}</b>Equivalence ratio</span><span><b>{nextPoint.massFlowKgS.toFixed(3)} kg/s</b>Mass flow</span><span><b>{nextPoint.inletPressureBar.toFixed(2)} bar</b>Inlet pressure</span></div><button className="button primary" onClick={() => onAddOperatingPoint(activeDesign.id, nextPoint)}>Add this operating point</button></> : <><p>Every point in the current screening plan has a matched measured operating point. Open the Operating Envelope to inspect the observed modes.</p><button className="button primary" onClick={() => onOpenEnvelope(activeDesign.id)}>Open Operating Envelope</button></>}</section>
    </div>

    {activeDesign.source !== "published" && <section className="screening-plan-card"><div className="card-heading"><div><span>Initial screening plan</span><h2>Nine candidate conditions, not operating predictions</h2><p>Kythros creates these starting conditions only from the ranges you entered. A row does not mean the engine is stable, safe, or expected to perform successfully there.</p></div><div><button className="button secondary" onClick={saveCsv}>Download CSV</button><button className="button secondary" onClick={saveManifest}>Download manifest</button></div></div><div className="screening-table-wrap"><table><thead><tr><th>Why this candidate exists</th><th>Equivalence ratio</th><th>Mass flow</th><th>Inlet pressure</th><th>Measured evidence</th><th></th></tr></thead><tbody>{plan.map((point) => <tr key={point.id}><th>{point.role}</th><td>φ {point.equivalenceRatio.toFixed(2)}</td><td>{point.massFlowKgS.toFixed(3)} kg/s</td><td>{point.inletPressureBar.toFixed(2)} bar</td><td><span className={`plan-status ${point.matchedOperatingPointId ? "matched" : "planned"}`}>{point.matchedOperatingPointId ? "Measured point loaded" : "Candidate only; not tested"}</span></td><td>{!point.matchedOperatingPointId && <button onClick={() => onAddOperatingPoint(activeDesign.id, point)}>Add measured point</button>}</td></tr>)}</tbody></table></div></section>}

    {designs.length > 1 && <section className="screening-plan-card design-portfolio"><div className="card-heading"><div><span>Design comparison</span><h2>Entered designs and evidence coverage</h2><p>This compares entered geometry and loaded evidence only. It does not rank performance.</p></div></div><div className="screening-table-wrap"><table><thead><tr><th>Design</th><th>Propellants</th><th>Annulus gap</th><th>Injector-area ratio</th><th>Observed points</th><th></th></tr></thead><tbody>{designs.map((design) => { const result = calculateDesign(design); const pointCount = operatingPoints.filter((item) => item.designId === design.id && item.source !== "demo").length; return <tr key={design.id}><th>{design.name}</th><td>{design.fuel} / {design.oxidizer}</td><td>{compactNumber(result.annulusGapMm, 2)} mm</td><td>{compactPercentage(result.injectorAreaRatioPct)}</td><td>{pointCount}</td><td><button onClick={() => onSelectDesign(design.id)}>{design.id === activeDesign.id ? "Selected" : "Open"}</button></td></tr>; })}</tbody></table></div></section>}

    <section className="product-boundary-card"><div><span>What Kythros can do now</span><strong>Define a preliminary RDE build, map materials to components, represent regenerative, film, heat-sink, or ablative hardware, run transparent assumption-driven screens, plan operating conditions, compare evidence, classify, and report.</strong></div><div><span>What still requires engineering analysis</span><strong>Combustion and heat-flux prediction, detailed manifolds and CAD, conjugate heat transfer, stress and life analysis, film effectiveness, ablative recession, feed-system dynamics, seals and joints, manufacturability, and hardware certification.</strong></div></section>
  </section>;
}
