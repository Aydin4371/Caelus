"use client";

import { ChangeEvent, useEffect, useState } from "react";
import {
  mapProbeTable,
  parseDelimitedTable,
  suggestImportMapping,
  type DelimitedTable,
  type ImportMapping,
  type MappedProbeImport,
  type PressureUnit,
  type TimeUnit,
} from "@/lib/data-import";

const TIME_UNITS: TimeUnit[] = ["s", "ms", "us", "ns"];
const PRESSURE_UNITS: PressureUnit[] = ["Pa", "kPa", "MPa", "bar", "psi"];

export function PressureFileMapper({
  kind,
  expectedProbeCount,
  currentFileName,
  onMapped,
}: {
  kind: "Experiment" | "CFD";
  expectedProbeCount: number;
  currentFileName?: string;
  onMapped: (result: MappedProbeImport | null) => void;
}) {
  const [table, setTable] = useState<DelimitedTable | null>(null);
  const [mapping, setMapping] = useState<ImportMapping | null>(null);
  const [mapped, setMapped] = useState<MappedProbeImport | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!table) return;
    setMapping((current) => current?.probes.length === expectedProbeCount ? current : suggestImportMapping(table, expectedProbeCount));
    setMapped(null);
    onMapped(null);
  }, [expectedProbeCount, table, onMapped]);

  function invalidate(next: ImportMapping) {
    setMapping(next);
    setMapped(null);
    setError("");
    onMapped(null);
  }

  async function readFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const nextTable = parseDelimitedTable(await file.text(), file.name);
      setTable(nextTable);
      setMapping(suggestImportMapping(nextTable, expectedProbeCount));
      setMapped(null);
      setError("");
      onMapped(null);
    } catch (reason) {
      setTable(null);
      setMapping(null);
      setMapped(null);
      onMapped(null);
      setError(reason instanceof Error ? reason.message : "Could not read this file.");
    }
  }

  function confirmMapping() {
    if (!table || !mapping) return;
    try {
      const result = mapProbeTable(table, mapping);
      setMapped(result);
      setError("");
      onMapped(result);
    } catch (reason) {
      setMapped(null);
      onMapped(null);
      setError(reason instanceof Error ? reason.message : "The selected columns could not be mapped.");
    }
  }

  return <section className={`file-mapper ${mapped ? "mapped" : ""}`}>
    <div className="file-mapper-heading">
      <div><span>{kind.toUpperCase()}</span><strong>{mapped?.provenance.fileName ?? table?.fileName ?? currentFileName ?? "No file selected"}</strong></div>
      <label className="file-picker">Choose CSV / TSV<input type="file" accept=".csv,.tsv,.txt" onChange={readFile} hidden /></label>
    </div>

    {!table && <p className="mapper-empty">{currentFileName ? "Choose a file only if you want to replace the current mapped data." : "Upload an ordinary delimited export, then identify the time and pressure columns."}</p>}

    {table && mapping && <>
      <div className="mapper-source-summary"><span>{table.sourceRows.toLocaleString()} source rows</span><span>{table.headers.length} columns</span><span>{table.delimiter === "\t" ? "tab" : table.delimiter === "," ? "comma" : "semicolon"} delimited</span></div>
      <div className="mapping-grid time-mapping">
        <label><span>Acquisition time column</span><select value={mapping.timeColumnIndex} onChange={(event) => invalidate({ ...mapping, timeColumnIndex: Number(event.target.value) })}>{table.headers.map((header, index) => <option key={index} value={index}>{header}</option>)}</select></label>
        <label><span>Time unit in file</span><select value={mapping.timeUnit} onChange={(event) => invalidate({ ...mapping, timeUnit: event.target.value as TimeUnit })}>{TIME_UNITS.map((unit) => <option key={unit}>{unit}</option>)}</select></label>
      </div>
      <div className="probe-mapping-list">
        {mapping.probes.map((probe, index) => <div key={probe.label} className="mapping-grid">
          <strong>{probe.label}</strong>
          <label><span>Pressure column</span><select value={probe.columnIndex} onChange={(event) => invalidate({ ...mapping, probes: mapping.probes.map((item, itemIndex) => itemIndex === index ? { ...item, columnIndex: Number(event.target.value) } : item) })}><option value={-1}>Select column</option>{table.headers.map((header, columnIndex) => <option key={columnIndex} value={columnIndex}>{header}</option>)}</select></label>
          <label><span>Pressure unit in file</span><select value={probe.unit} onChange={(event) => invalidate({ ...mapping, probes: mapping.probes.map((item, itemIndex) => itemIndex === index ? { ...item, unit: event.target.value as PressureUnit } : item) })}>{PRESSURE_UNITS.map((unit) => <option key={unit}>{unit}</option>)}</select></label>
        </div>)}
      </div>
      <button type="button" className="button secondary mapper-confirm" onClick={confirmMapping}>Apply mapping and preview</button>
    </>}

    {mapped && <div className="mapped-preview">
      <div className="preview-summary"><strong>Mapped successfully</strong><span>{mapped.provenance.validRows.toLocaleString()} usable rows · {mapped.preview.sampleRateKHz.toFixed(2)} kHz · {mapped.preview.durationMs.toFixed(3)} ms</span></div>
      <div className="preview-table-wrap"><table><thead><tr>{mapped.preview.headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{mapped.preview.rows.map((row, index) => <tr key={index}><td>{row.timeMs.toPrecision(6)}</td>{row.pressureMpa.map((value, probe) => <td key={probe}>{value.toPrecision(6)}</td>)}</tr>)}</tbody></table></div>
      <ul>{mapped.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
    </div>}
    {error && <p className="mapper-error">{error}</p>}
  </section>;
}
