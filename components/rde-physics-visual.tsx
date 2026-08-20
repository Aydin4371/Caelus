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
    <svg viewBox="0 0 620 290" role="img" aria-label="Entered rotating detonation engine geometry">
      <defs><marker id={waveMarkerId} markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path className="schematic-wave-marker" d="M0,0 L0,6 L7,3 z" /></marker><marker id={flowMarkerId} markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path className="schematic-flow-marker" d="M0,0 L0,6 L7,3 z" /></marker><linearGradient id={`${waveMarkerId}-annulus`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#bfe8f0"/><stop offset="1" stopColor="#e5f5f7"/></linearGradient></defs>
      <g transform="translate(145 142)">
        <circle r="91" className="schematic-wall"/><circle r={innerRadius} className="schematic-core"/><circle r={(91 + innerRadius) / 2} className="schematic-annulus"/>
        {Array.from({ length: injectorCount }, (_, index) => { const angle = index / Math.max(injectorCount, 1) * Math.PI * 2; const radius = (91 + innerRadius) / 2; return <circle key={index} cx={Math.cos(angle) * radius} cy={Math.sin(angle) * radius} r="2.3" className="schematic-injector"/>; })}
        <path d="M -60 -57 A 82 82 0 0 1 63 -54" className="schematic-wave" markerEnd={`url(#${waveMarkerId})`}/><text x="0" y="-105" textAnchor="middle">Rotating wave direction</text><text x="0" y="5" textAnchor="middle" className="schematic-core-label">centrebody</text>
      </g>
      <g transform="translate(304 47)">
        <rect x="0" y="0" width="260" height="190" rx="7" className="schematic-section-shell"/><rect x="34" y="0" width="76" height="190" className="schematic-section-core"/><rect x="110" y="0" width="48" height="190" fill={`url(#${waveMarkerId}-annulus)`} className="schematic-section-annulus"/><path d="M158 0 L242 30 L242 160 L158 190 Z" className="schematic-exhaust"/>
        <path d="M123 177 L123 125" className="schematic-flow" markerEnd={`url(#${flowMarkerId})`}/><path d="M144 177 L144 125" className="schematic-flow" markerEnd={`url(#${flowMarkerId})`}/>
        <line x1="110" x2="158" y1="60" y2="60" className="schematic-dimension"/><text x="134" y="52" textAnchor="middle">gap {format(gap, 2)} mm</text>
        <line x1="110" x2="110" y1="0" y2="190" className="schematic-hot-wall"/><line x1="158" x2="158" y1="0" y2="190" className="schematic-hot-wall"/>
        <text x="134" y="211" textAnchor="middle">annulus</text><text x="205" y="211" textAnchor="middle">exhaust</text><text x="134" y="-13" textAnchor="middle">{format(design.chamberLengthMm, 0)} mm chamber</text>
      </g>
    </svg>
    <div className="schematic-legend"><span className="legend-injector">{finite(design.injectorCount) ? `${Math.round(design.injectorCount)} injectors` : "Injector count not entered"}</span><span className="legend-thermal">Inner and outer annulus walls</span><span>{format(inner, 1)} / {format(outer, 1)} mm diameters</span></div>
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

function FieldComparison({ quantity, experiment, cfd }: { quantity: WallFieldQuantity; experiment: WallFieldImport | null | undefined; cfd: WallFieldImport | null | undefined }) {
  const experimentField = wallField(experiment, quantity); const cfdField = wallField(cfd, quantity);
  const values = [...(experimentField?.samples ?? []), ...(cfdField?.samples ?? [])].map((sample) => sample.value);
  const limits = extent(values, [0, 1]);
  return <section className="field-comparison"><div className="field-comparison-heading"><div><span>UNWRAPPED ANNULUS WALL</span><h3>{title(quantity)}</h3></div><div className="field-scale"><i style={{ background: "linear-gradient(90deg,hsl(205 72% 48%),hsl(5 72% 55%))" }}/><span>{values.length ? `${limits[0].toFixed(2)}–${limits[1].toFixed(2)} ${unit(quantity)}` : "No mapped values"}</span></div></div><div className="wall-map-grid-layout"><SpatialMap field={experimentField} source="Experiment" sharedLimits={limits}/><SpatialMap field={cfdField} source="CFD" sharedLimits={limits}/></div></section>;
}

function metricRow(rows: PhysicsComparisonRow[], key: PhysicsComparisonRow["key"]) { return rows.find((row) => row.key === key)!; }
function valueText(row: PhysicsComparisonRow) { return row.experiment === null && row.cfd === null ? "Not provided" : `${row.experiment === null ? "Experiment —" : `Exp ${row.experiment.toFixed(2)}`} · ${row.cfd === null ? "CFD —" : `CFD ${row.cfd.toFixed(2)}`} ${row.unit}`; }

export function RdePhysicsVisual({ design, rows, experimentWallField, cfdWallField, onEdit }: { design: EngineDesign | null; rows: PhysicsComparisonRow[]; experimentWallField?: WallFieldImport | null; cfdWallField?: WallFieldImport | null; onEdit: () => void }) {
  if (!design) return null;
  const feed = [metricRow(rows, "injectorPressureRatio"), metricRow(rows, "backflowFractionPct")];
  const performance = [metricRow(rows, "netThrustN"), metricRow(rows, "specificImpulseS"), metricRow(rows, "pressureGainPct")];
  return <section className="physics-visual-workspace" aria-label="RDE physics evidence viewer">
    <div className="evidence-heading"><div><span className="calculated-label">SPATIAL AND SYSTEM EVIDENCE</span><h2>RDE physics view</h2><p>The drawing uses entered geometry. Thermal maps use only uploaded spatial samples; blank maps mean no spatial evidence was supplied.</p></div><button className="button secondary" onClick={onEdit}>Add spatial fields</button></div>
    <div className="physics-system-grid"><article className="geometry-visual-card"><h3>Entered engine geometry</h3><RdeGeometrySchematic design={design}/></article><article className="system-evidence-card"><div><span>Feed system</span><strong>Injector response</strong>{feed.map((row) => <small key={row.key}>{row.label}: {valueText(row)}</small>)}</div><div><span>Performance</span><strong>Measured versus CFD</strong>{performance.map((row) => <small key={row.key}>{row.label}: {valueText(row)}</small>)}</div><p>These values describe one operating point. They are not predicted elsewhere in the envelope.</p></article></div>
    <FieldComparison quantity="wallHeatFluxMWm2" experiment={experimentWallField} cfd={cfdWallField}/>
    <FieldComparison quantity="wallTemperatureK" experiment={experimentWallField} cfd={cfdWallField}/>
  </section>;
}
