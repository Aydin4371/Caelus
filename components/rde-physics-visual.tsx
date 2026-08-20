"use client";

import { useId } from "react";
import type { PhysicsComparisonRow } from "@/lib/physics-evidence";
import type { EngineDesign } from "@/lib/design-workspace";
import { wallField, type WallField, type WallFieldImport, type WallFieldQuantity } from "@/lib/spatial-field";

function finite(value: number) { return Number.isFinite(value); }
function format(value: number, digits = 1) { return finite(value) ? value.toFixed(digits) : "Not entered"; }

export function RdeGeometrySchematic({ design, compact = false }: { design: EngineDesign; compact?: boolean }) {
  const waveMarkerId = useId().replaceAll(":", "-");
  const flowMarkerId = `${waveMarkerId}-flow`;
  const inner = design.annulusInnerDiameterMm;
  const outer = design.annulusOuterDiameterMm;
  const drawable = finite(inner) && finite(outer) && outer > inner && finite(design.chamberLengthMm);
  const injectorCount = finite(design.injectorCount) ? Math.max(0, Math.min(48, Math.round(design.injectorCount))) : 0;
  if (!drawable) return <div className="schematic-unavailable"><strong>Geometry drawing unavailable</strong><span>Enter inner diameter, outer diameter, and chamber length.</span></div>;
  const innerRadius = 54 * inner / outer;
  const gap = (outer - inner) / 2;
  return <div className={`rde-schematic ${compact ? "compact" : ""}`}>
    <svg viewBox="0 0 720 330" role="img" aria-label="Front view and labelled axial cutaway of the entered rotating detonation engine geometry">
      <defs><marker id={waveMarkerId} markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path className="schematic-wave-marker" d="M0,0 L0,6 L7,3 z" /></marker><marker id={flowMarkerId} markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path className="schematic-flow-marker" d="M0,0 L0,6 L7,3 z" /></marker><linearGradient id={`${waveMarkerId}-annulus`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#bfe8f0"/><stop offset="1" stopColor="#e5f5f7"/></linearGradient></defs>
      <text x="145" y="24" textAnchor="middle" className="schematic-view-title">HEAD-END VIEW</text>
      <g transform="translate(145 166)">
        <circle r="91" className="schematic-wall"/><circle r={innerRadius} className="schematic-core"/><circle r={(91 + innerRadius) / 2} className="schematic-annulus"/>
        {Array.from({ length: injectorCount }, (_, index) => { const angle = index / Math.max(injectorCount, 1) * Math.PI * 2; const radius = (91 + innerRadius) / 2; return <circle key={index} cx={Math.cos(angle) * radius} cy={Math.sin(angle) * radius} r="2.3" className="schematic-injector"/>; })}
        <path d="M -60 -57 A 82 82 0 0 1 63 -54" className="schematic-wave" markerEnd={`url(#${waveMarkerId})`}/><text x="0" y="-108" textAnchor="middle">Rotating detonation direction</text><text x="0" y="5" textAnchor="middle" className="schematic-core-label">centrebody</text>
        <path d="M-84 75 L-120 102" className="schematic-leader"/><text x="-126" y="112" textAnchor="start">outer annulus wall</text>
        <path d={`M${innerRadius * .72} ${innerRadius * .72} L100 106`} className="schematic-leader"/><text x="104" y="116" textAnchor="start">inner annulus wall</text>
      </g>
      <text x="505" y="24" textAnchor="middle" className="schematic-view-title">AXIAL CUTAWAY</text>
      <g transform="translate(315 44)">
        <path d="M12 42 H230 L292 82 V218 L230 258 H12 Z" className="schematic-section-shell"/>
        <rect x="12" y="68" width="52" height="164" rx="4" className="schematic-plenum"/>
        <path d="M64 108 H220 L264 138 L220 168 H64 Z" className="schematic-section-core"/>
        <path d="M64 82 H220 L264 116 L220 108 H64 Z" fill={`url(#${waveMarkerId}-annulus)`} className="schematic-section-annulus"/>
        <path d="M64 168 H220 L264 160 L220 194 H64 Z" fill={`url(#${waveMarkerId}-annulus)`} className="schematic-section-annulus"/>
        <line x1="64" x2="64" y1="82" y2="194" className="schematic-injector-face"/>
        {[94, 182].map((y) => <g key={y}><circle cx="64" cy={y} r="3" className="schematic-injector"/><path d={`M76 ${y} H119`} className="schematic-flow" markerEnd={`url(#${flowMarkerId})`}/></g>)}
        <line x1="64" x2="220" y1="280" y2="280" className="schematic-dimension"/><line x1="64" x2="64" y1="273" y2="287" className="schematic-dimension"/><line x1="220" x2="220" y1="273" y2="287" className="schematic-dimension"/><text x="142" y="303" textAnchor="middle">chamber length {format(design.chamberLengthMm, 0)} mm</text>
        <line x1="64" x2="100" y1="70" y2="70" className="schematic-dimension"/><text x="82" y="61" textAnchor="middle">gap {format(gap, 2)} mm</text>
        <text x="38" y="252" textAnchor="middle">plenum</text><text x="64" y="32" textAnchor="middle">injector face</text><text x="145" y="74" textAnchor="middle">annular chamber</text><text x="142" y="142" textAnchor="middle" className="schematic-core-label">centrebody</text><text x="260" y="238" textAnchor="middle">exhaust / nozzle</text>
      </g>
    </svg>
    <div className="schematic-legend"><span className="legend-injector">{finite(design.injectorCount) ? `${Math.round(design.injectorCount)} injectors` : "Injector count not entered"}</span><span className="legend-flow">Propellant flow through both annular passages</span><span>{format(inner, 1)} / {format(outer, 1)} mm inner / outer diameters</span></div>
  </div>;
}

function extent(values: number[], fallback: readonly [number, number]): readonly [number, number] {
  const usable = values.filter(Number.isFinite);
  if (!usable.length) return fallback;
  const low = Math.min(...usable); const high = Math.max(...usable);
  return low === high ? [low - 0.5, high + 0.5] : [low, high];
}
function color(value: number, limits: readonly [number, number]) {
  const fraction = Math.max(0, Math.min(1, (value - limits[0]) / Math.max(limits[1] - limits[0], 1e-12)));
  return `hsl(${205 - 200 * fraction} 72% ${48 + 7 * fraction}%)`;
}
function unit(quantity: WallFieldQuantity) { return quantity === "wallHeatFluxMWm2" ? "MW/m²" : "K"; }
function title(quantity: WallFieldQuantity) { return quantity === "wallHeatFluxMWm2" ? "Wall heat flux" : "Wall temperature"; }

function PhysicalWallMap({ field, source, sharedLimits, chamberLengthMm }: { field: WallField | null; source: "Experiment" | "CFD"; sharedLimits: readonly [number, number]; chamberLengthMm: number }) {
  const fieldId = useId().replaceAll(":", "-");
  const dataLimits = extent(field?.samples.map((sample) => sample.axialMm) ?? [], [0, finite(chamberLengthMm) && chamberLengthMm > 0 ? chamberLengthMm : 1]);
  const axialLimits: readonly [number, number] = finite(chamberLengthMm) && chamberLengthMm > 0 ? [0, chamberLengthMm] : dataLimits;
  const projected = (field?.samples ?? []).map((sample) => {
    const angle = sample.angleDeg * Math.PI / 180;
    const depth = Math.cos(angle);
    const axialFraction = Math.max(0, Math.min(1, (sample.axialMm - axialLimits[0]) / Math.max(axialLimits[1] - axialLimits[0], 1e-12)));
    return { sample, depth, x: 120 + axialFraction * 368 + depth * 14, y: 135 + Math.sin(angle) * 67 };
  }).sort((left, right) => left.depth - right.depth);
  return <article className="physical-wall-map"><div className="physical-wall-heading"><strong>{source}</strong><span>{field ? `${field.samples.length.toLocaleString()} mapped location${field.samples.length === 1 ? "" : "s"}` : "No spatial field loaded"}</span></div><svg viewBox="0 0 620 275" role="img" aria-label={`${source} ${field ? title(field.quantity) : "thermal data"} mapped onto the physical annular chamber wall`}>
    <defs><linearGradient id={`${fieldId}-shell`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#eaf4f3"/><stop offset=".5" stopColor="#cfe4e4"/><stop offset="1" stopColor="#f8fbf8"/></linearGradient></defs>
    <path d="M62 73 H107 V198 H62 Z" className="physical-plenum"/><line x1="107" x2="107" y1="66" y2="205" className="physical-injector-face"/>
    <rect x="107" y="66" width="395" height="139" rx="3" fill={`url(#${fieldId}-shell)`} className="physical-cylinder-body"/><ellipse cx="107" cy="135" rx="29" ry="69" className="physical-cylinder-end"/><ellipse cx="502" cy="135" rx="29" ry="69" className="physical-cylinder-end"/><path d="M502 75 L582 102 V168 L502 195 Z" className="physical-nozzle"/>
    {projected.map(({ sample, depth, x, y }, index) => source === "Experiment"
      ? <circle key={index} cx={x} cy={y} r={depth >= 0 ? 7 : 5} fill={color(sample.value, sharedLimits)} opacity={depth >= 0 ? .98 : .42} className="physical-experiment-point"><title>{sample.axialMm.toFixed(2)} mm axial · {sample.angleDeg.toFixed(1)}° · {sample.value.toFixed(3)} {unit(field!.quantity)}{depth < 0 ? " · far side" : " · near side"}</title></circle>
      : <rect key={index} x={x - (depth >= 0 ? 6 : 4)} y={y - (depth >= 0 ? 6 : 4)} width={depth >= 0 ? 12 : 8} height={depth >= 0 ? 12 : 8} rx="3" fill={color(sample.value, sharedLimits)} opacity={depth >= 0 ? .86 : .34}><title>{sample.axialMm.toFixed(2)} mm axial · {sample.angleDeg.toFixed(1)}° · {sample.value.toFixed(3)} {unit(field!.quantity)}{depth < 0 ? " · far side" : " · near side"}</title></rect>)}
    {!field && <g className="physical-map-empty-label"><text x="305" y="127" textAnchor="middle">No {source.toLowerCase()} wall field</text><text x="305" y="147" textAnchor="middle">Upload axial position + angle + thermal value</text></g>}
    <path d="M126 225 H471" className="physical-axial-arrow"/><path d="M471 225 l-10 -5 v10 z" className="physical-axial-arrow-head"/><text x="299" y="246" textAnchor="middle" className="physical-axis-label">Axial position: injector face → chamber exit</text>
    <text x="84" y="43" textAnchor="middle" className="physical-part-label">injector face</text><text x="304" y="43" textAnchor="middle" className="physical-part-label">annular chamber wall</text><text x="548" y="43" textAnchor="middle" className="physical-part-label">exhaust</text>
  </svg><div className="physical-wall-note"><span>Near-side wall</span><span className="far-side">Far-side samples are translucent</span></div></article>;
}

function SpatialMap({ field, source, sharedLimits }: { field: WallField | null; source: "Experiment" | "CFD"; sharedLimits: readonly [number, number] }) {
  if (!field) return <div className="wall-map-empty"><div className="empty-grid"/><strong>{source}: no spatial field loaded</strong><span>A scalar peak value cannot create a wall map.</span></div>;
  const xLimits = extent(field.samples.map((sample) => sample.axialMm), [0, 1]);
  const uniqueX = [...new Set(field.samples.map((sample) => sample.axialMm))].sort((a, b) => a - b);
  const uniqueY = [...new Set(field.samples.map((sample) => sample.angleDeg))].sort((a, b) => a - b);
  const dx = uniqueX.length > 1 ? Math.min(...uniqueX.slice(1).map((value, index) => value - uniqueX[index])) : xLimits[1] - xLimits[0];
  const dy = uniqueY.length > 1 ? Math.min(...uniqueY.slice(1).map((value, index) => value - uniqueY[index])) : 20;
  const sx = (value: number) => 58 + (value - xLimits[0]) / Math.max(xLimits[1] - xLimits[0], 1e-12) * 528;
  const sy = (value: number) => 232 - value / 360 * 202;
  const cellWidth = Math.max(3, Math.min(40, dx / Math.max(xLimits[1] - xLimits[0], 1e-12) * 528));
  const cellHeight = Math.max(3, Math.min(24, dy / 360 * 202));
  return <div className="wall-map"><div className="wall-map-heading"><strong>{source}</strong><span>{field.samples.length.toLocaleString()} mapped locations</span></div><svg viewBox="0 0 620 270" role="img" aria-label={`${source} ${title(field.quantity)} over the unwrapped annulus wall`}>
    {[0, 90, 180, 270, 360].map((angle) => <g key={angle}><line x1="58" x2="586" y1={sy(angle)} y2={sy(angle)} className="wall-map-grid"/><text x="48" y={sy(angle) + 4} textAnchor="end">{angle}°</text></g>)}
    {[0, 0.25, 0.5, 0.75, 1].map((fraction) => { const value = xLimits[0] + fraction * (xLimits[1] - xLimits[0]); return <g key={fraction}><line x1={sx(value)} x2={sx(value)} y1="30" y2="232" className="wall-map-grid"/><text x={sx(value)} y="253" textAnchor="middle">{value.toFixed(0)}</text></g>; })}
    {field.samples.map((sample, index) => source === "CFD"
      ? <rect key={index} x={sx(sample.axialMm) - cellWidth / 2} y={sy(sample.angleDeg) - cellHeight / 2} width={cellWidth + 0.5} height={cellHeight + 0.5} fill={color(sample.value, sharedLimits)}><title>{sample.axialMm.toFixed(2)} mm · {sample.angleDeg.toFixed(1)}° · {sample.value.toFixed(3)} {unit(field.quantity)}</title></rect>
      : <circle key={index} cx={sx(sample.axialMm)} cy={sy(sample.angleDeg)} r="5" fill={color(sample.value, sharedLimits)} className="experiment-field-point"><title>{sample.axialMm.toFixed(2)} mm · {sample.angleDeg.toFixed(1)}° · {sample.value.toFixed(3)} {unit(field.quantity)}</title></circle>)}
    <text x="322" y="268" textAnchor="middle" className="wall-map-axis">Axial position (mm)</text><text x="13" y="132" textAnchor="middle" transform="rotate(-90 13 132)" className="wall-map-axis">Circumferential angle</text>
  </svg></div>;
}

function FieldComparison({ quantity, experiment, cfd, chamberLengthMm }: { quantity: WallFieldQuantity; experiment: WallFieldImport | null | undefined; cfd: WallFieldImport | null | undefined; chamberLengthMm: number }) {
  const experimentField = wallField(experiment, quantity); const cfdField = wallField(cfd, quantity);
  const values = [...(experimentField?.samples ?? []), ...(cfdField?.samples ?? [])].map((sample) => sample.value);
  const limits = extent(values, [0, 1]);
  return <section className="field-comparison"><div className="field-comparison-heading"><div><span>PHYSICAL ANNULUS WALL</span><h3>{title(quantity)}</h3><p>Colors are projected onto the entered chamber length. Hover a mapped location for its exact axial position, angle and value.</p></div><div className="field-scale"><i style={{ background: "linear-gradient(90deg,hsl(205 72% 48%),hsl(5 72% 55%))" }}/><span>{values.length ? `${limits[0].toFixed(2)}–${limits[1].toFixed(2)} ${unit(quantity)}` : "No mapped values"}</span></div></div><div className="physical-wall-grid"><PhysicalWallMap field={experimentField} source="Experiment" sharedLimits={limits} chamberLengthMm={chamberLengthMm}/><PhysicalWallMap field={cfdField} source="CFD" sharedLimits={limits} chamberLengthMm={chamberLengthMm}/></div><details className="unwrapped-wall-details"><summary>Show exact circumferential angle × axial position maps</summary><p>The physical projection makes location intuitive. This unwrapped view preserves the exact uploaded coordinates without hiding the far side of the annulus.</p><div className="wall-map-grid-layout"><SpatialMap field={experimentField} source="Experiment" sharedLimits={limits}/><SpatialMap field={cfdField} source="CFD" sharedLimits={limits}/></div></details></section>;
}

function metricRow(rows: PhysicsComparisonRow[], key: PhysicsComparisonRow["key"]) { return rows.find((row) => row.key === key)!; }
function valueText(row: PhysicsComparisonRow) { return row.experiment === null && row.cfd === null ? "Not provided" : `${row.experiment === null ? "Experiment —" : `Exp ${row.experiment.toFixed(2)}`} · ${row.cfd === null ? "CFD —" : `CFD ${row.cfd.toFixed(2)}`} ${row.unit}`; }

export function RdePhysicsVisual({ design, rows, experimentWallField, cfdWallField, onEdit }: { design: EngineDesign | null; rows: PhysicsComparisonRow[]; experimentWallField?: WallFieldImport | null; cfdWallField?: WallFieldImport | null; onEdit: () => void }) {
  if (!design) return null;
  const feed = [metricRow(rows, "injectorPressureRatio"), metricRow(rows, "backflowFractionPct")];
  const performance = [metricRow(rows, "netThrustN"), metricRow(rows, "specificImpulseS"), metricRow(rows, "pressureGainPct")];
  return <section className="physics-visual-workspace" aria-label="RDE physics evidence viewer">
    <div className="evidence-heading"><div><span className="calculated-label">OPERATING-POINT PHYSICS COMPARISON</span><h2>Where experiment and CFD differ</h2><p>The full engine definition stays in Design &amp; Plan. This view shows only measured-versus-CFD evidence for the selected operating point.</p></div><button className="button secondary" onClick={onEdit}>Add physics evidence</button></div>
    <div className="system-evidence-strip"><article className="system-evidence-card"><div><span>Feed system</span><strong>Injector response</strong>{feed.map((row) => <small key={row.key}>{row.label}: {valueText(row)}</small>)}</div></article><article className="system-evidence-card"><div><span>Performance</span><strong>Measured versus CFD</strong>{performance.map((row) => <small key={row.key}>{row.label}: {valueText(row)}</small>)}</div></article></div>
    <FieldComparison quantity="wallHeatFluxMWm2" experiment={experimentWallField} cfd={cfdWallField} chamberLengthMm={design.chamberLengthMm}/>
    <FieldComparison quantity="wallTemperatureK" experiment={experimentWallField} cfd={cfdWallField} chamberLengthMm={design.chamberLengthMm}/>
  </section>;
}
