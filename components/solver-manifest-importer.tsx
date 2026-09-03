"use client";

import { ChangeEvent, useState } from "react";
import { buildCfdRunManifest, parseCfdRunManifest, parseOpenFoamCaseFiles, type CfdManifestImport } from "@/lib/cfd-run-manifest";
import type { CaseMetadata } from "@/lib/caevera-types";

export function SolverManifestImporter({ metadata, onApply }: { metadata: CaseMetadata; onApply: (values: Partial<CaseMetadata>) => void }) {
  const [result, setResult] = useState<CfdManifestImport | null>(null);
  const [error, setError] = useState("");

  async function readManifest(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setResult(parseCfdRunManifest(await file.text()));
      setError("");
    } catch (reason) {
      setResult(null);
      setError(reason instanceof Error ? reason.message : "Could not read the CFD manifest.");
    }
  }

  async function readOpenFoam(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    if (!files.length) return;
    try {
      const inspectable = files.filter((file) => {
        const path = (file.webkitRelativePath || file.name).replaceAll("\\", "/").toLowerCase();
        const base = path.split("/").at(-1) ?? path;
        return ["controldict", "fvschemes", "fvsolution", "momentumtransport", "turbulenceproperties", "combustionproperties", "chemistryproperties"].includes(base)
          || path.endsWith("/0/p")
          || base.includes("checkmesh") && (base.endsWith(".log") || base.endsWith(".txt"));
      });
      if (!inspectable.length) throw new Error("No supported OpenFOAM dictionaries, 0/p field, or checkMesh log were found in this selection.");
      setResult(parseOpenFoamCaseFiles(await Promise.all(inspectable.map(async (file) => ({ name: file.webkitRelativePath || file.name, text: await file.text() })))));
      setError("");
    } catch (reason) {
      setResult(null);
      setError(reason instanceof Error ? reason.message : "Could not inspect the OpenFOAM dictionaries.");
    }
  }

  function downloadTemplate() {
    const content = JSON.stringify(buildCfdRunManifest(metadata), null, 2);
    const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "kythros-cfd-run-manifest.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  return <section className="solver-manifest-importer">
    <div><span>CFD MODEL CARD</span><strong>Import solver settings</strong><p>Prefill recognized settings, then review every field before analysis.</p></div>
    <div className="solver-import-actions">
      <label className="button secondary">Import Kythros JSON<input type="file" accept=".json" onChange={readManifest} hidden /></label>
      <label className="button secondary">Inspect OpenFOAM files<input type="file" multiple onChange={readOpenFoam} hidden /></label>
      <label className="button secondary">Inspect OpenFOAM case folder<input type="file" multiple onChange={readOpenFoam} hidden {...({ webkitdirectory: "" } as Record<string, string>)} /></label>
      <button type="button" className="button secondary" onClick={downloadTemplate}>Download manifest template</button>
    </div>
    {result && <div className="solver-import-review"><strong>{result.detected.length} setting{result.detected.length === 1 ? "" : "s"} detected</strong><div>{result.detected.map((item) => <span key={item.field}><b>{item.field}</b>{String(item.value)}</span>)}</div>{result.warnings.map((warning) => <p key={warning}>{warning}</p>)}<button type="button" className="button primary" onClick={() => onApply(result.metadata)}>Apply detected settings</button></div>}
    {error && <p className="mapper-error">{error}</p>}
  </section>;
}
