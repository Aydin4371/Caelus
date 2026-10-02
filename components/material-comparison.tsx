"use client";

import { useState } from "react";
import type { EngineDesign, RdeMaterialId } from "@/lib/design-workspace";
import { compareMaterials, MATERIAL_COMPONENTS, type MaterialComponent } from "@/lib/material-comparison";

const value = (number: number | null, unit: string) => number === null ? "Not calculated" : `${number.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${unit}`;

export function MaterialComparison({ design, onSelect }: { design: EngineDesign; onSelect: (component: MaterialComponent, material: RdeMaterialId) => void }) {
  const [component, setComponent] = useState<MaterialComponent>("hotWallMaterial");
  const candidates = compareMaterials(design, component);
  const label = MATERIAL_COMPONENTS.find(([key]) => key === component)![1];
  return <section className="material-comparison" aria-label="Compare component materials">
    <header><div><h3>Choose for the component</h3><p>Compare the same geometry and cooling assumptions.</p></div><label>Component<select value={component} onChange={(event) => setComponent(event.target.value as MaterialComponent)}>{MATERIAL_COMPONENTS.map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label></header>
    <div className="material-candidates">{candidates.map(({ material, selected, wallTemperatureK, conductionRiseK, massPerCm3G, aboveReference }) => <article key={material.id} className={selected ? "is-selected" : ""}>
      <span className="material-family">{material.family}</span><h4>{material.id}</h4>
      <dl><div><dt>Heat conductivity</dt><dd>{value(material.thermalConductivityWMK, "W/(m·K)")}</dd></div><div><dt>Mass per cm³</dt><dd>{value(massPerCm3G, "g")}</dd></div>{component === "hotWallMaterial" && <><div><dt>Through-wall rise · q″t/k</dt><dd>{value(conductionRiseK, "K")}</dd></div><div><dt>Regenerative wall screen</dt><dd>{value(wallTemperatureK, "K")}</dd></div></>}</dl>
      {aboveReference && <p className="material-review-note">Above this material’s screening reference. Review thermal assumptions.</p>}
      <p><strong>Benefit</strong>{material.advantages[0]}</p><p><strong>Tradeoff</strong>{material.tradeoffs[0]}</p>
      <details><summary>Properties and source</summary><p>{material.propertyBasis}. These reference temperatures describe different source conditions and are not comparable safe operating limits.</p><ul>{material.advantages.slice(1).concat(material.tradeoffs.slice(1)).map((text) => <li key={text}>{text}</li>)}</ul><a href={material.sourceUrl} target="_blank" rel="noreferrer">Open property source ↗</a></details>
      <button type="button" className={`button ${selected ? "secondary" : "primary"}`} aria-pressed={selected} onClick={() => onSelect(component, material.id)}>{selected ? `Selected for ${label.toLowerCase()}` : `Use for ${label.toLowerCase()}`}</button>
    </article>)}</div>
    <p className="material-comparison-note">Only the hot-wall selection changes the regenerative temperature screen. Other assignments are recorded for engineering review. Strength, life, coating effects, and prices are not calculated. Film, heat-sink, and ablative screens do not predict wall temperature.</p>
  </section>;
}
