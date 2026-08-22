"use client";

import { useId, useState } from "react";
import type { PhysicsComparisonRow } from "@/lib/physics-evidence";
import type { EngineDesign } from "@/lib/design-workspace";
import { wallField, type WallField, type WallFieldImport, type WallFieldQuantity } from "@/lib/spatial-field";
import animationStyles from "./rde-geometry-animation.module.css";

function finite(value: number) { return Number.isFinite(value); }
function format(value: number, digits = 1) { return finite(value) ? value.toFixed(digits) : "Not entered"; }

export function RdeGeometrySchematic({ design, compact = false }: { design: EngineDesign; compact?: boolean }) {
  const [animationPaused, setAnimationPaused] = useState(false);
  const waveMarkerId = useId().replaceAll(":", "-");
  const flowMarkerId = `${waveMarkerId}-flow`;
  const productMarkerId = `${waveMarkerId}-product`;
  const inner = design.annulusInnerDiameterMm;
  const outer = design.annulusOuterDiameterMm;
  const drawable = finite(inner) && finite(outer) && outer > inner && finite(design.chamberLengthMm);
  const injectorCount = finite(design.injectorCount) ? Math.max(0, Math.min(48, Math.round(design.injectorCount))) : 0;
  if (!drawable) return <div className="schematic-unavailable"><strong>Geometry drawing unavailable</strong><span>Enter inner diameter, outer diameter, and chamber length.</span></div>;
  const innerRadius = 54 * inner / outer;
  const gap = (outer - inner) / 2;
  return <div className={`rde-schematic ${compact ? "compact" : ""} ${animationPaused ? animationStyles.paused : ""}`}>
    <div className={animationStyles.animationToolbar}>
      <div>
        <strong>Conceptual flow animation</strong>
        <span className={animationStyles.motionEnabledLabel}>Slowed for explanation; it is not time-accurate and is not a CFD result.</span>
        <span className={animationStyles.reducedMotionLabel}>Motion is disabled by your reduced-motion setting. This remains a schematic, not a CFD result.</span>
      </div>
      <button
        type="button"
        className={animationStyles.animationButton}
        aria-pressed={animationPaused}
        onClick={() => setAnimationPaused((paused) => !paused)}
      >
        {animationPaused ? "Play animation" : "Pause animation"}
      </button>
    </div>
    <div className="schematic-views">
      <figure className="schematic-view head-end-panel">
        <figcaption><span>01</span><div><strong>Head-end view</strong><small>Looking downstream through the injector face</small></div></figcaption>
        <svg viewBox="0 0 380 330" role="img" aria-label="Head-end view showing the annulus, injector ring, centrebody, circumferential detonation-wave direction, and entered diameters">
          <defs><marker id={waveMarkerId} markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path className="schematic-wave-marker" d="M0,0 L0,6 L7,3 z" /></marker></defs>
          <g transform="translate(190 157)">
            <circle r="102" className="schematic-wall"/><circle r={innerRadius} className="schematic-core"/><circle r={(102 + innerRadius) / 2} className="schematic-annulus"/>
            {Array.from({ length: injectorCount }, (_, index) => { const angle = index / Math.max(injectorCount, 1) * Math.PI * 2; const radius = (102 + innerRadius) / 2; return <circle key={index} cx={Math.cos(angle) * radius} cy={Math.sin(angle) * radius} r="2.5" className="schematic-injector"/>; })}
            <g className={animationStyles.rotatingWave}>
              <circle r="102" className={animationStyles.waveOrbitAnchor}/>
              <path d="M -70 -66 A 96 96 0 0 1 73 -62" className="schematic-wave" markerEnd={`url(#${waveMarkerId})`}/>
            </g>
            <text x="0" y="5" textAnchor="middle" className="schematic-part-name">CENTREBODY</text>
            <text x="0" y="-116" textAnchor="middle" className="schematic-action-label">WAVE ROTATES AROUND ANNULUS</text>
            <text x="0" y="88" textAnchor="middle" className="schematic-part-name inverse">ANNULAR CHANNEL</text>

            <line x1="-126" x2="-126" y1="-102" y2="102" className="schematic-dimension solid"/>
            <line x1="-132" x2="-102" y1="-102" y2="-102" className="schematic-dimension solid"/>
            <line x1="-132" x2="-102" y1="102" y2="102" className="schematic-dimension solid"/>
            <text x="-142" y="0" textAnchor="middle" transform="rotate(-90 -142 0)" className="schematic-dimension-label halo">OUTER Ø {format(outer, 1)} mm</text>

            <line x1="126" x2="126" y1={-innerRadius} y2={innerRadius} className="schematic-dimension solid"/>
            <line x1={innerRadius} x2="132" y1={-innerRadius} y2={-innerRadius} className="schematic-dimension solid"/>
            <line x1={innerRadius} x2="132" y1={innerRadius} y2={innerRadius} className="schematic-dimension solid"/>
            <text x="142" y="0" textAnchor="middle" transform="rotate(90 142 0)" className="schematic-dimension-label halo">INNER Ø {format(inner, 1)} mm</text>

            <line x1={innerRadius} x2="102" y1="0" y2="0" className="schematic-dimension solid on-geometry"/>
            <line x1={innerRadius} x2={innerRadius} y1="-6" y2="6" className="schematic-dimension solid on-geometry"/>
            <line x1="102" x2="102" y1="-6" y2="6" className="schematic-dimension solid on-geometry"/>
            <text x={(innerRadius + 102) / 2} y="-12" textAnchor="middle" className="schematic-dimension-label halo">GAP {format(gap, 2)} mm</text>
          </g>
        </svg>
      </figure>

      <figure className="schematic-view axial-panel">
        <figcaption><span>02</span><div><strong>Axial cutaway</strong><small>Section through the centreline, from feed system to exhaust</small></div></figcaption>
        <svg viewBox="0 0 620 330" role="img" aria-label="Axial cutaway showing propellant entering the plenum and injectors, refilling the annulus behind the rotating detonation, hot products exhausting through the nozzle, and entered chamber dimensions">
          <defs>
            <marker id={flowMarkerId} markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path className="schematic-flow-marker" d="M0,0 L0,6 L7,3 z" /></marker>
            <marker id={productMarkerId} markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path className="schematic-product-marker" d="M0,0 L0,6 L7,3 z" /></marker>
            <linearGradient id={`${waveMarkerId}-fresh`} x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#bfe8f0"/><stop offset="1" stopColor="#dff3f5"/></linearGradient>
            <linearGradient id={`${waveMarkerId}-products`} x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#f4c979"/><stop offset=".58" stopColor="#f5ddb3"/><stop offset="1" stopColor="#f7efe1"/></linearGradient>
          </defs>
          <path d="M36 58 H484 L574 113 V197 L484 252 H36 Z" className="schematic-section-shell"/>
          <rect x="36" y="83" width="92" height="144" rx="6" className="schematic-plenum"/>
          <line x1="128" x2="128" y1="72" y2="238" className="schematic-injector-face"/>

          <path d="M128 90 H486 L546 119 V142 L486 128 H128 Z" className="schematic-products" fill={`url(#${waveMarkerId}-products)`}/>
          <path d="M128 182 H486 L546 168 V191 L486 220 H128 Z" className="schematic-products" fill={`url(#${waveMarkerId}-products)`}/>
          <path d="M128 128 H466 L526 150 L466 182 H128 Z" className="schematic-section-core"/>
          <path d="M128 90 H205 V128 H128 Z" className="schematic-fresh-zone" fill={`url(#${waveMarkerId}-fresh)`}/>
          <path d="M128 182 H205 V220 H128 Z" className="schematic-fresh-zone" fill={`url(#${waveMarkerId}-fresh)`}/>
          <line x1="205" x2="205" y1="90" y2="128" className={`schematic-detonation-front ${animationStyles.frontPulse}`}/>
          <line x1="205" x2="205" y1="182" y2="220" className={`schematic-detonation-front ${animationStyles.frontPulse}`}/>

          {[103, 207].map((y) => <g key={y}>
            <circle cx="128" cy={y} r="4" className="schematic-injector"/>
            <path d={`M72 ${y} H174`} className="schematic-flow" markerEnd={`url(#${flowMarkerId})`}/>
            <path d={`M72 ${y} H174`} className={animationStyles.mixtureStream}/>
          </g>)}
          {[112, 199].map((y) => <g key={y}>
            <path d={`M242 ${y} H433`} className="schematic-product-flow" markerEnd={`url(#${productMarkerId})`}/>
            <path d={`M242 ${y} H433`} className={animationStyles.productStream}/>
          </g>)}

          <g className="schematic-number"><circle cx="75" cy="154" r="12"/><text x="75" y="158" textAnchor="middle">1</text></g>
          <g className="schematic-number"><circle cx="128" cy="66" r="12"/><text x="128" y="70" textAnchor="middle">2</text></g>
          <g className="schematic-number hot"><circle cx="205" cy="80" r="12"/><text x="205" y="84" textAnchor="middle">3</text></g>
          <g className="schematic-number"><circle cx="422" cy="154" r="12"/><text x="422" y="158" textAnchor="middle">4</text></g>
          <g className="schematic-number"><circle cx="540" cy="96" r="12"/><text x="540" y="100" textAnchor="middle">5</text></g>

          <text x="166" y="122" textAnchor="middle" className="schematic-zone-label halo">FRESH MIXTURE</text>
          <text x="365" y="101" textAnchor="middle" className="schematic-zone-label hot halo">HOT PRODUCTS</text>
          <text x="300" y="159" textAnchor="middle" className="schematic-core-label">CENTREBODY</text>
          <text x="76" y="246" textAnchor="middle" className="schematic-part-name">PLENUM</text>
          <text x="128" y="46" textAnchor="middle" className="schematic-part-name">INJECTOR FACE</text>
          <text x="535" y="266" textAnchor="middle" className="schematic-part-name">NOZZLE / EXHAUST</text>

          <line x1="128" x2="486" y1="282" y2="282" className="schematic-dimension solid"/>
          <line x1="128" x2="128" y1="272" y2="292" className="schematic-dimension solid"/>
          <line x1="486" x2="486" y1="272" y2="292" className="schematic-dimension solid"/>
          <text x="307" y="308" textAnchor="middle" className="schematic-dimension-label halo">CHAMBER LENGTH {format(design.chamberLengthMm, 0)} mm</text>

          <line x1="230" x2="230" y1="90" y2="128" className="schematic-dimension solid on-geometry"/>
          <line x1="222" x2="238" y1="90" y2="90" className="schematic-dimension solid on-geometry"/>
          <line x1="222" x2="238" y1="128" y2="128" className="schematic-dimension solid on-geometry"/>
          <text x="246" y="82" textAnchor="start" className="schematic-dimension-label halo">RADIAL GAP {format(gap, 2)} mm</text>
        </svg>
        <ol className={`cutaway-steps ${animationStyles.processSteps}`}>
          <li><b>1</b><span><strong>Feed</strong>Propellant enters the plenum.</span></li>
          <li><b>2</b><span><strong>Inject</strong>Jets refill the annular gap.</span></li>
          <li><b>3</b><span><strong>Detonate</strong>The wave rotates around the annulus.</span></li>
          <li><b>4</b><span><strong>Expand</strong>Hot products move downstream.</span></li>
          <li><b>5</b><span><strong>Exhaust</strong>The nozzle converts pressure to thrust.</span></li>
        </ol>
      </figure>
    </div>
    <p className="cutaway-clarifier"><strong>How to read the cutaway:</strong> the detonation wave travels circumferentially around the engine, so the red front shows where that rotating wave intersects this axial section. The bulk exhaust flow moves left to right.</p>
    <div className="schematic-legend"><span className="legend-injector">{finite(design.injectorCount) ? `${Math.round(design.injectorCount)} injectors` : "Injector count not entered"}</span><span className="legend-flow">Fresh propellant</span><span className="legend-detonation">Rotating detonation front</span><span className="legend-products">Hot combustion products</span></div>
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

function PhysicalWallMap({ field, source, dataName, sharedLimits, chamberLengthMm }: { field: WallField | null; source: "Experiment" | "CFD"; dataName?: string; sharedLimits: readonly [number, number]; chamberLengthMm: number }) {
  const fieldId = useId().replaceAll(":", "-");
  const axialProfile = field?.coverage === "axial-profile" || !!field && field.samples.every((sample) => sample.angleDeg === null);
  const dataLimits = extent(field?.samples.map((sample) => sample.axialMm) ?? [], [0, finite(chamberLengthMm) && chamberLengthMm > 0 ? chamberLengthMm : 1]);
  const axialLimits: readonly [number, number] = finite(chamberLengthMm) && chamberLengthMm > 0 ? [0, chamberLengthMm] : dataLimits;
  const projected = (field?.samples ?? []).filter((sample) => sample.angleDeg !== null).map((sample) => {
    const angle = sample.angleDeg! * Math.PI / 180;
    const depth = Math.cos(angle);
    const axialFraction = Math.max(0, Math.min(1, (sample.axialMm - axialLimits[0]) / Math.max(axialLimits[1] - axialLimits[0], 1e-12)));
    return { sample, depth, x: 120 + axialFraction * 368 + depth * 14, y: 135 + Math.sin(angle) * 67 };
  }).sort((left, right) => left.depth - right.depth);
  const profileX = (value: number) => 107 + Math.max(0, Math.min(1, (value - axialLimits[0]) / Math.max(axialLimits[1] - axialLimits[0], 1e-12))) * 395;
  const profileXs = [...new Set((field?.samples ?? []).map((sample) => sample.axialMm))].sort((left, right) => left - right);
  const profileWidth = profileXs.length > 1 ? Math.max(5, Math.min(58, Math.min(...profileXs.slice(1).map((value, index) => value - profileXs[index])) / Math.max(axialLimits[1] - axialLimits[0], 1e-12) * 395)) : 16;
  return <article className="physical-wall-map"><div className="physical-wall-heading"><strong>{source}</strong><span>{field ? `${field.samples.length.toLocaleString()} ${axialProfile ? "axial" : "mapped"} location${field.samples.length === 1 ? "" : "s"}${dataName ? ` · ${dataName}` : ""}` : "No thermal field loaded"}</span></div><svg viewBox="0 0 620 275" role="img" aria-label={`${source} ${field ? title(field.quantity) : "thermal data"} mapped onto the physical annular chamber wall`}>
    <defs><linearGradient id={`${fieldId}-shell`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#eaf4f3"/><stop offset=".5" stopColor="#cfe4e4"/><stop offset="1" stopColor="#f8fbf8"/></linearGradient></defs>
    <path d="M62 73 H107 V198 H62 Z" className="physical-plenum"/><line x1="107" x2="107" y1="66" y2="205" className="physical-injector-face"/>
    <rect x="107" y="66" width="395" height="139" rx="3" fill={`url(#${fieldId}-shell)`} className="physical-cylinder-body"/><ellipse cx="107" cy="135" rx="29" ry="69" className="physical-cylinder-end"/><ellipse cx="502" cy="135" rx="29" ry="69" className="physical-cylinder-end"/><path d="M502 75 L582 102 V168 L502 195 Z" className="physical-nozzle"/>
    {axialProfile && field?.samples.map((sample, index) => <rect key={`profile-${index}`} x={profileX(sample.axialMm) - profileWidth / 2} y="67" width={profileWidth} height="137" fill={color(sample.value, sharedLimits)} opacity=".72"><title>{sample.axialMm.toFixed(2)} mm axial · circumferentially averaged profile · {sample.value.toFixed(3)} {unit(field.quantity)}</title></rect>)}
    {projected.map(({ sample, depth, x, y }, index) => source === "Experiment"
      ? <circle key={index} cx={x} cy={y} r={depth >= 0 ? 7 : 5} fill={color(sample.value, sharedLimits)} opacity={depth >= 0 ? .98 : .42} className="physical-experiment-point"><title>{sample.axialMm.toFixed(2)} mm axial · {sample.angleDeg!.toFixed(1)}° · {sample.value.toFixed(3)} {unit(field!.quantity)}{depth < 0 ? " · far side" : " · near side"}</title></circle>
      : <rect key={index} x={x - (depth >= 0 ? 6 : 4)} y={y - (depth >= 0 ? 6 : 4)} width={depth >= 0 ? 12 : 8} height={depth >= 0 ? 12 : 8} rx="3" fill={color(sample.value, sharedLimits)} opacity={depth >= 0 ? .86 : .34}><title>{sample.axialMm.toFixed(2)} mm axial · {sample.angleDeg!.toFixed(1)}° · {sample.value.toFixed(3)} {unit(field!.quantity)}{depth < 0 ? " · far side" : " · near side"}</title></rect>)}
    {!field && <g className="physical-map-empty-label"><text x="305" y="127" textAnchor="middle">No {source.toLowerCase()} thermal field</text><text x="305" y="147" textAnchor="middle">Upload axial profile or axial + angle samples</text></g>}
    <path d="M126 225 H471" className="physical-axial-arrow"/><path d="M471 225 l-10 -5 v10 z" className="physical-axial-arrow-head"/><text x="299" y="246" textAnchor="middle" className="physical-axis-label">Axial position: injector face → chamber exit</text>
    <text x="84" y="43" textAnchor="middle" className="physical-part-label">injector face</text><text x="304" y="43" textAnchor="middle" className="physical-part-label">annular chamber wall</text><text x="548" y="43" textAnchor="middle" className="physical-part-label">exhaust</text>
  </svg><div className="physical-wall-note"><span>{axialProfile ? "Circumferentially averaged axial bands" : "Near-side wall"}</span><span className="far-side">{axialProfile ? "No angular variation claimed" : "Far-side samples are translucent"}</span></div></article>;
}

function SpatialMap({ field, source, sharedLimits }: { field: WallField | null; source: "Experiment" | "CFD"; sharedLimits: readonly [number, number] }) {
  if (!field) return <div className="wall-map-empty"><div className="empty-grid"/><strong>{source}: no spatial field loaded</strong><span>A scalar peak value cannot create a wall map.</span></div>;
  const xLimits = extent(field.samples.map((sample) => sample.axialMm), [0, 1]);
  if (field.coverage === "axial-profile" || field.samples.every((sample) => sample.angleDeg === null)) {
    const yLimits = extent(field.samples.map((sample) => sample.value), sharedLimits);
    const sx = (value: number) => 62 + (value - xLimits[0]) / Math.max(xLimits[1] - xLimits[0], 1e-12) * 520;
    const sy = (value: number) => 218 - (value - yLimits[0]) / Math.max(yLimits[1] - yLimits[0], 1e-12) * 174;
    const ordered = [...field.samples].sort((left, right) => left.axialMm - right.axialMm);
    return <div className="wall-map axial-profile-map"><div className="wall-map-heading"><strong>{source}</strong><span>{field.samples.length.toLocaleString()} axial locations · no angle column</span></div><svg viewBox="0 0 620 270" role="img" aria-label={`${source} ${title(field.quantity)} axial profile`}>
      {[0, .25, .5, .75, 1].map((fraction) => { const xValue = xLimits[0] + fraction * (xLimits[1] - xLimits[0]); const yValue = yLimits[0] + fraction * (yLimits[1] - yLimits[0]); return <g key={fraction}><line x1={sx(xValue)} x2={sx(xValue)} y1="44" y2="218" className="wall-map-grid"/><text x={sx(xValue)} y="244" textAnchor="middle">{xValue.toFixed(0)}</text><line x1="62" x2="582" y1={sy(yValue)} y2={sy(yValue)} className="wall-map-grid"/><text x="52" y={sy(yValue) + 4} textAnchor="end">{yValue.toFixed(1)}</text></g>; })}
      <polyline points={ordered.map((sample) => `${sx(sample.axialMm)},${sy(sample.value)}`).join(" ")} fill="none" className="axial-profile-line"/>
      {ordered.map((sample, index) => <circle key={index} cx={sx(sample.axialMm)} cy={sy(sample.value)} r="5" fill={color(sample.value, sharedLimits)}><title>{sample.axialMm.toFixed(2)} mm · {sample.value.toFixed(3)} {unit(field.quantity)}</title></circle>)}
      <text x="322" y="266" textAnchor="middle" className="wall-map-axis">Axial position (mm)</text><text x="13" y="132" textAnchor="middle" transform="rotate(-90 13 132)" className="wall-map-axis">{title(field.quantity)} ({unit(field.quantity)})</text>
    </svg></div>;
  }
  const uniqueX = [...new Set(field.samples.map((sample) => sample.axialMm))].sort((a, b) => a - b);
  const uniqueY = [...new Set(field.samples.map((sample) => sample.angleDeg).filter((value): value is number => value !== null))].sort((a, b) => a - b);
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
      ? <rect key={index} x={sx(sample.axialMm) - cellWidth / 2} y={sy(sample.angleDeg!) - cellHeight / 2} width={cellWidth + 0.5} height={cellHeight + 0.5} fill={color(sample.value, sharedLimits)}><title>{sample.axialMm.toFixed(2)} mm · {sample.angleDeg!.toFixed(1)}° · {sample.value.toFixed(3)} {unit(field.quantity)}</title></rect>
      : <circle key={index} cx={sx(sample.axialMm)} cy={sy(sample.angleDeg!)} r="5" fill={color(sample.value, sharedLimits)} className="experiment-field-point"><title>{sample.axialMm.toFixed(2)} mm · {sample.angleDeg!.toFixed(1)}° · {sample.value.toFixed(3)} {unit(field.quantity)}</title></circle>)}
    <text x="322" y="268" textAnchor="middle" className="wall-map-axis">Axial position (mm)</text><text x="13" y="132" textAnchor="middle" transform="rotate(-90 13 132)" className="wall-map-axis">Circumferential angle</text>
  </svg></div>;
}

function FieldComparison({ quantity, experiment, cfd, chamberLengthMm }: { quantity: WallFieldQuantity; experiment: WallFieldImport | null | undefined; cfd: WallFieldImport | null | undefined; chamberLengthMm: number }) {
  const experimentField = wallField(experiment, quantity); const cfdField = wallField(cfd, quantity);
  const values = [...(experimentField?.samples ?? []), ...(cfdField?.samples ?? [])].map((sample) => sample.value);
  const limits = extent(values, [0, 1]);
  return <section className="field-comparison"><div className="field-comparison-heading"><div><span>PHYSICAL ANNULUS WALL</span><h3>{title(quantity)}</h3><p>Surface samples are projected at their axial and angular coordinates. Axial-only profiles appear as circumferentially averaged bands and never imply angular resolution.</p></div><div className="field-scale"><i style={{ background: "linear-gradient(90deg,hsl(205 72% 48%),hsl(5 72% 55%))" }}/><span>{values.length ? `${limits[0].toFixed(2)}–${limits[1].toFixed(2)} ${unit(quantity)}` : "No mapped values"}</span></div></div><div className="physical-wall-grid"><PhysicalWallMap field={experimentField} source="Experiment" dataName={experiment?.fileName} sharedLimits={limits} chamberLengthMm={chamberLengthMm}/><PhysicalWallMap field={cfdField} source="CFD" dataName={cfd?.fileName} sharedLimits={limits} chamberLengthMm={chamberLengthMm}/></div><details className="unwrapped-wall-details"><summary>Show exact coordinate plots</summary><p>The physical projection makes location intuitive. The expanded plot preserves the exact uploaded coordinates; axial-only data remain a one-dimensional profile.</p><div className="wall-map-grid-layout"><SpatialMap field={experimentField} source="Experiment" sharedLimits={limits}/><SpatialMap field={cfdField} source="CFD" sharedLimits={limits}/></div></details></section>;
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
