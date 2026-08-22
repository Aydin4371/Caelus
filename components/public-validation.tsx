"use client";

import { useMemo, useState } from "react";
import { GE_2022_ROWS, GE_2022_SOURCE } from "@/lib/published-envelope-data";
import { classifyPublishedPropagationMode } from "@/lib/published-mode-classification";
import { PUBLISHED_VALIDATION_SOURCES, PUBLISHED_WAVE_SPEED_BENCHMARKS, RAW_DATASET_VALIDATION_CASES, waveSpeedFromPassageFrequency } from "@/lib/published-benchmarks";
import { PUBLIC_DATA_DOWNLOADS, PUBLIC_THERMAL_EVIDENCE } from "@/lib/public-test-data";
import { evaluatePublicPressureFixture, type PublicPressureCheck, type PublicPressureFixture } from "@/lib/public-pressure-validation";

type PressureRunState = { status: "idle" | "running" | "complete" | "error"; results: PublicPressureCheck[]; message: string };

function evidenceLabel(level: string) {
  return level === "campaign-range" ? "Published campaign range" : "Published spatial description";
}

export function PublicValidation({ onLoadPublished }: { onLoadPublished: () => void }) {
  const [pressureRun, setPressureRun] = useState<PressureRunState>({ status: "idle", results: [], message: "" });
  const waveResults = useMemo(() => PUBLISHED_WAVE_SPEED_BENCHMARKS.map((item) => {
    const calculated = waveSpeedFromPassageFrequency(item.passageFrequencyKHz, item.annulusMeanDiameterMm, item.waveCount);
    const residual = calculated - item.reportedWaveSpeedMps;
    return { ...item, calculated, residual, passed: Math.abs(residual) <= item.toleranceMps };
  }), []);
  const geGroups = useMemo(() => GE_2022_ROWS.reduce<Record<"Stable" | "Transitional" | "Unstable", number>>((counts, row) => {
    counts[classifyPublishedPropagationMode(row.reportedMode)] += 1;
    return counts;
  }, { Stable: 0, Transitional: 0, Unstable: 0 }), []);

  async function runPressureFixtures() {
    setPressureRun({ status: "running", results: [], message: "Loading public pressure arrays and running the production analyzer…" });
    try {
      const results = await Promise.all(RAW_DATASET_VALIDATION_CASES.map(async (item) => {
        const response = await fetch(`/data/zenodo-${item.id.toLowerCase()}.json`);
        if (!response.ok) throw new Error(`${item.id} could not be loaded (${response.status}).`);
        return evaluatePublicPressureFixture(await response.json() as PublicPressureFixture);
      }));
      setPressureRun({ status: "complete", results, message: `${results.filter((item) => item.passed).length} of ${results.length} public pressure checks passed from the loaded arrays.` });
    } catch (reason) {
      setPressureRun({ status: "error", results: [], message: reason instanceof Error ? reason.message : "The public pressure checks could not be run." });
    }
  }

  return <section className="public-validation-workspace" aria-label="Public validation data">
    <header className="public-validation-hero">
      <div><span className="workspace-label">Public validation data</span><h1>Evidence Kythros can actually recompute</h1><p>Source labels stay on the reference side. Kythros outputs are generated only after the numerical arrays or tabulated values are loaded; published prose and campaign ranges never become model predictions.</p></div>
      <div className="public-validation-count"><strong>{GE_2022_ROWS.length + PUBLISHED_WAVE_SPEED_BENCHMARKS.length + RAW_DATASET_VALIDATION_CASES.length + PUBLIC_THERMAL_EVIDENCE.length}</strong><span>traceable records and benchmark cases</span></div>
    </header>

    <section className="validation-boundary"><strong>No prerecorded Kythros conclusions</strong><span>The app stores source observations, validation tolerances and provenance. It recalculates wave-response groupings, wave speed, raw-pressure diagnostics and pass/fail results at runtime. Thermal ranges remain ranges until pointwise samples exist.</span></section>

    <section className="validation-section pressure-validation-section">
      <div className="validation-section-heading"><div><span>RAW PUBLIC ARRAYS</span><h2>Run the pressure analyzer against published records</h2><p>Each fixture contains 4,096 time samples per pressure channel from the Oexle–Bohon Zenodo archive. This check is deliberately difficult: the expected behavior is to withhold a simple single-mode answer when the data contain counter-rotating or multiple components.</p></div><button className="button primary" onClick={runPressureFixtures} disabled={pressureRun.status === "running"}>{pressureRun.status === "running" ? "Analyzing…" : "Run public pressure checks"}</button></div>
      {pressureRun.status === "idle" ? <div className="validation-empty">No result is shown until the public JSON arrays are loaded and analyzed in this browser.</div> : <div className={`validation-run-status validation-${pressureRun.status}`}><strong>{pressureRun.message}</strong></div>}
      {!!pressureRun.results.length && <div className="pressure-check-grid">{pressureRun.results.map((result) => <article key={result.caseId} className={result.passed ? "check-passed" : "check-failed"}><header><div><span>{result.caseId}</span><strong>{result.sourceMode}</strong></div><b>{result.passed ? "Calculated pass" : "Calculated review"}</b></header><dl><div><dt>Dominant frequency</dt><dd>{result.dominantFrequencyKHz.toFixed(3)} kHz</dd></div><div><dt>Analyzer result</dt><dd>{result.identifiability}</dd></div><div><dt>Analyzed probes</dt><dd>{result.analyzedProbeCount}</dd></div></dl><ul>{result.checks.map((check) => <li key={check.label} className={check.passed ? "passed" : "failed"}><i>{check.passed ? "✓" : "!"}</i><span><b>{check.label}</b><small>{check.value}</small></span></li>)}</ul></article>)}</div>}
      <p className="validation-limitation">Passing these cases validates conservative behavior for three public pressure records. It does not validate Kythros accuracy over other engines, a CFD diagnosis, or a next-test recommendation.</p>
    </section>

    <section className="validation-section">
      <div className="validation-section-heading"><div><span>TABULATED CALCULATION</span><h2>Wave-speed reproduction</h2><p>Kythros recalculates circumferential speed from the published passage frequency, mean annulus diameter and wave count. The residual below is calculated, not stored.</p></div><a href={PUBLISHED_VALIDATION_SOURCES["xue-et-al-2023"].url} className="button secondary" target="_blank" rel="noreferrer">Open source</a></div>
      <div className="validation-table-wrap"><table><thead><tr><th>Configuration</th><th>Frequency</th><th>Waves</th><th>Reported speed</th><th>Calculated speed</th><th>Residual</th></tr></thead><tbody>{waveResults.map((row) => <tr key={row.id}><th>{row.configuration}</th><td>{row.passageFrequencyKHz.toFixed(5)} kHz</td><td>{row.waveCount}</td><td>{row.reportedWaveSpeedMps.toFixed(2)} m/s</td><td>{row.calculated.toFixed(2)} m/s</td><td className={row.passed ? "value-pass" : "value-review"}>{row.residual >= 0 ? "+" : ""}{row.residual.toFixed(2)} m/s</td></tr>)}</tbody></table></div>
    </section>

    <section className="validation-section">
      <div className="validation-section-heading"><div><span>PUBLISHED OPERATING MATRIX</span><h2>Observed gasoline–air propagation modes</h2><p>The authors reported each mode. Kythros derives only the three display-group counts from those source strings; it does not claim to have rediscovered them without raw signals.</p></div><button className="button secondary" onClick={onLoadPublished}>Load into Operating Envelope</button></div>
      <div className="ge-validation-summary"><article><strong>{geGroups.Stable}</strong><span>single-wave records</span></article><article><strong>{geGroups.Transitional}</strong><span>mixed / intermittent records</span></article><article><strong>{geGroups.Unstable}</strong><span>failure records</span></article><article><strong>{GE_2022_ROWS.length}</strong><span>unique conditions</span></article></div>
      <p className="validation-limitation">Source: <a href={GE_2022_SOURCE.url} target="_blank" rel="noreferrer">{GE_2022_SOURCE.title}</a>, {GE_2022_SOURCE.locator}. This matrix tests transcription, slicing and provenance—not the raw-signal classifier or prediction model.</p>
    </section>

    <section className="validation-section thermal-evidence-section">
      <div className="validation-section-heading"><div><span>THERMAL EVIDENCE</span><h2>What the public heat data can and cannot show</h2><p>These records provide real scale, sensor coverage and reported trends. No wall map is generated from a campaign minimum/maximum or from figure colors.</p></div></div>
      <div className="thermal-evidence-grid">{PUBLIC_THERMAL_EVIDENCE.map((item) => <article key={item.id}><header><span>{evidenceLabel(item.evidenceLevel)}</span><strong>{item.heatFluxRangeMWm2 ? `${item.heatFluxRangeMWm2[0]}–${item.heatFluxRangeMWm2[1]} MW/m²` : "No numerical array released"}</strong></header><h3>{item.sourceTitle}</h3><p>{item.propellants} · {item.configuration}</p><dl><div><dt>Coverage</dt><dd>{item.reportedCoverage}</dd></div><div><dt>Locations</dt><dd>{item.measurementLocations ?? "Not tabulated"}</dd></div><div><dt>Map eligible</dt><dd>No — source array unavailable</dd></div></dl><small>{item.limitation}</small><a href={item.sourceUrl} target="_blank" rel="noreferrer">Open primary source</a></article>)}</div>
    </section>

    <section className="validation-section data-download-section"><div className="validation-section-heading"><div><span>DOWNLOADABLE EVIDENCE</span><h2>Inspect the exact inputs</h2><p>Every downloadable file keeps its evidence level explicit so published summaries cannot silently enter raw-data model gates.</p></div></div><div className="download-evidence-grid">{PUBLIC_DATA_DOWNLOADS.map((item) => <a key={item.href} href={item.href} download><strong>{item.label}</strong><span>{item.evidence}</span></a>)}</div></section>
  </section>;
}
