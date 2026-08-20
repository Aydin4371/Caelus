"use client";

import { ChangeEvent, useState } from "react";
import { mapWallFieldTable, parseSpatialTable, suggestWallFieldMapping, type SpatialTable, type WallFieldImport, type WallFieldMapping } from "@/lib/spatial-field";

const AXIAL_UNITS: WallFieldMapping["axialUnit"][] = ["mm", "cm", "m"];
const ANGLE_UNITS: WallFieldMapping["angleUnit"][] = ["deg", "rad"];
const HEAT_UNITS: WallFieldMapping["heatFluxUnit"][] = ["MW/m²", "kW/m²", "W/m²"];
const TEMPERATURE_UNITS: WallFieldMapping["temperatureUnit"][] = ["K", "°C"];

export function SpatialFieldMapper({ kind, currentFileName, onMapped }: {
  kind: "Experiment" | "CFD";
  currentFileName?: string;
  onMapped: (result: WallFieldImport | null) => void;
}) {
  const [table, setTable] = useState<SpatialTable | null>(null);
  const [mapping, setMapping] = useState<WallFieldMapping | null>(null);
  const [mapped, setMapped] = useState<WallFieldImport | null>(null);
  const [error, setError] = useState("");

  function invalidate(next: WallFieldMapping) { setMapping(next); setMapped(null); setError(""); onMapped(null); }
  async function readFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const next = parseSpatialTable(await file.text(), file.name);
      setTable(next); setMapping(suggestWallFieldMapping(next)); setMapped(null); setError(""); onMapped(null);
    } catch (reason) { setTable(null); setMapping(null); setMapped(null); onMapped(null); setError(reason instanceof Error ? reason.message : "Could not read this wall-field file."); }
  }
  function confirm() {
    if (!table || !mapping) return;
    try { const result = mapWallFieldTable(table, mapping); setMapped(result); setError(""); onMapped(result); }
    catch (reason) { setMapped(null); onMapped(null); setError(reason instanceof Error ? reason.message : "The wall-field columns could not be mapped."); }
  }
  const columns = (value: number, label: string) => <select value={value} onChange={(event) => invalidate({ ...mapping!, [label]: Number(event.target.value) })}><option value={-1}>Not mapped</option>{table!.headers.map((header, index) => <option key={index} value={index}>{header}</option>)}</select>;

  return <section className={`file-mapper spatial-field-mapper ${mapped ? "mapped" : ""}`}>
    <div className="file-mapper-heading"><div><span>{kind.toUpperCase()} WALL FIELD</span><strong>{mapped?.fileName ?? table?.fileName ?? currentFileName ?? "No file selected"}</strong></div><label className="file-picker">Choose CSV / TSV<input type="file" accept=".csv,.tsv,.txt" onChange={readFile} hidden /></label></div>
    {!table && <p className="mapper-empty">{currentFileName ? "The saved wall field will be kept unless you choose a replacement." : "Optional. Upload axial position and circumferential angle with wall heat flux, wall temperature, or both."}</p>}
    {table && mapping && <>
      <div className="mapper-source-summary"><span>{table.rows.length.toLocaleString()} source rows</span><span>{table.headers.length} columns</span></div>
      <div className="spatial-mapping-grid">
        <label><span>Axial position</span>{columns(mapping.axialColumnIndex, "axialColumnIndex")}</label><label><span>Position unit</span><select value={mapping.axialUnit} onChange={(event) => invalidate({ ...mapping, axialUnit: event.target.value as WallFieldMapping["axialUnit"] })}>{AXIAL_UNITS.map((unit) => <option key={unit}>{unit}</option>)}</select></label>
        <label><span>Circumferential angle</span>{columns(mapping.angleColumnIndex, "angleColumnIndex")}</label><label><span>Angle unit</span><select value={mapping.angleUnit} onChange={(event) => invalidate({ ...mapping, angleUnit: event.target.value as WallFieldMapping["angleUnit"] })}>{ANGLE_UNITS.map((unit) => <option key={unit}>{unit}</option>)}</select></label>
        <label><span>Wall heat flux · optional</span>{columns(mapping.heatFluxColumnIndex, "heatFluxColumnIndex")}</label><label><span>Heat-flux unit</span><select value={mapping.heatFluxUnit} onChange={(event) => invalidate({ ...mapping, heatFluxUnit: event.target.value as WallFieldMapping["heatFluxUnit"] })}>{HEAT_UNITS.map((unit) => <option key={unit}>{unit}</option>)}</select></label>
        <label><span>Wall temperature · optional</span>{columns(mapping.temperatureColumnIndex, "temperatureColumnIndex")}</label><label><span>Temperature unit</span><select value={mapping.temperatureUnit} onChange={(event) => invalidate({ ...mapping, temperatureUnit: event.target.value as WallFieldMapping["temperatureUnit"] })}>{TEMPERATURE_UNITS.map((unit) => <option key={unit}>{unit}</option>)}</select></label>
      </div>
      <button type="button" className="button secondary mapper-confirm" onClick={confirm}>Check spatial mapping</button>
    </>}
    {mapped && <div className="mapped-preview"><div className="preview-summary"><strong>Spatial wall field is ready</strong><span>{mapped.validRows.toLocaleString()} locations · {mapped.fields.map((field) => field.quantity === "wallHeatFluxMWm2" ? "heat flux" : "wall temperature").join(" + ")}</span></div>{mapped.droppedRows > 0 && <p>{mapped.droppedRows} incomplete row{mapped.droppedRows === 1 ? " was" : "s were"} omitted.</p>}</div>}
    {error && <p className="mapper-error">{error}</p>}
  </section>;
}
