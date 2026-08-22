import assert from "node:assert/strict";
import test from "node:test";

const developmentPreviewMeta =
  /<meta(?=[^>]*\bname=["']codex-preview["'])(?=[^>]*\bcontent=["']development["'])[^>]*>/i;

test("renders development preview metadata", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  const html = await response.text();
  assert.match(html, developmentPreviewMeta);
  assert.match(html, /KYTHROS/);
  assert.match(html, />Home</);
  assert.match(html, /From engine definition to the next CFD run/);
  assert.match(html, /Nine candidate conditions, not operating predictions/);
  assert.match(html, /Coverage candidates only/);
  assert.match(html, /Diagnosis and next-run recommendation/);
  assert.doesNotMatch(html, /Published checks/);
  assert.doesNotMatch(html, /What Kythros has actually reproduced/);
  assert.doesNotMatch(html, /Download audit values/);
  assert.match(html, /Design &amp; plan/);
  assert.match(html, />Comparison</);
  assert.match(html, /Operating Envelope/);
  assert.match(html, /rel="manifest"/);
  assert.match(html, />Install Kythros</);
  assert.match(html, />Help</);
  assert.match(html, /Open workspace/);
  assert.match(html, /Go to Kythros home/);
  assert.doesNotMatch(html, /Create first engine design/);
  assert.doesNotMatch(html, /Synthetic baseline/);
  assert.doesNotMatch(html, /Signal evidence/);
  assert.doesNotMatch(html, /aligned samples/);
  assert.doesNotMatch(html, /\u2014/);
});

test("keeps design planning, operating envelopes, and run comparison separate", async () => {
  const { readFile } = await import("node:fs/promises");
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const envelope = await readFile(new URL("../components/operating-envelope.tsx", import.meta.url), "utf8");
  const design = await readFile(new URL("../components/design-planner.tsx", import.meta.url), "utf8");
  const physicsVisual = await readFile(new URL("../components/rde-physics-visual.tsx", import.meta.url), "utf8");
  const logic = await readFile(new URL("../lib/operating-envelope.ts", import.meta.url), "utf8");
  assert.match(page, /productView/);
  assert.match(page, /useState<"home" \| "design" \| "envelope" \| "comparison">\("home"\)/);
  assert.match(page, /Nine candidate conditions, not operating predictions/);
  assert.match(page, /Define the engine/);
  assert.match(page, /Load the experiment/);
  assert.match(page, /Add matched CFD/);
  assert.match(page, /recommends one specific CFD change to run next/);
  assert.match(page, /BEFORE EVIDENCE/);
  assert.match(page, /AFTER EXPERIMENT \+ MATCHED CFD/);
  assert.match(page, /<DesignPlanner designs=\{designs\}/);
  assert.match(page, /<OperatingEnvelope designs=\{designs\}/);
  assert.doesNotMatch(page, /Validation data/);
  assert.doesNotMatch(page, /<PublicValidation/);
  assert.doesNotMatch(page, /Load thermal comparison example/);
  assert.match(envelope, /Observed propagation mode by operating point/);
  assert.match(envelope, /Predictive layer/);
  assert.match(envelope, /raw-data and validation gates pass/);
  assert.match(envelope, /Observed, not predicted/);
  assert.match(envelope, /Held fixed for this 2D slice/);
  assert.match(envelope, /Two intersecting published sweeps/);
  assert.match(envelope, /Evidence layers at this point/);
  assert.match(envelope, /performance, feed-system, thermal, and repeatability evidence/);
  assert.match(envelope, /Next-test recommendation/);
  assert.match(envelope, /Open comparison/);
  assert.match(design, /Nine candidate conditions, not operating predictions/);
  assert.doesNotMatch(design, /Intended Kythros workflow/);
  assert.match(design, /Total injector-orifice area ÷ annulus flow area × 100/);
  assert.doesNotMatch(design, /Not available%/);
  assert.match(design, /It is not an operability prediction/);
  assert.match(design, /No interpolation, performance, backflow, or thermal prediction/);
  assert.match(logic, /allRuns\.filter\(\(run\) => run\.operatingPointId === operatingPoint\.id\)/);
  assert.match(logic, /evidenceType: baseline \? "Experiment \+ CFD" : "Experiment only"/);
  assert.match(page, /No CFD setup or result is required here/);
  assert.match(page, /Optional engine-physics comparison/);
  assert.match(page, /Optional spatial wall evidence/);
  assert.match(page, /<RdePhysicsVisual/);
  assert.match(page, /Kythros reports CFD minus experiment only when both values exist/);
  assert.match(page, /experimentNetThrustN/);
  assert.match(page, /cfdWallHeatFluxMWm2/);
  assert.match(page, /!measuredPointDraft && <div className="form-section"><h3>Solver \+ numerical schemes/);
  assert.match(logic, /stablePointCount/);
  assert.match(envelope, /How a recommendation earns evidence/);
  assert.match(envelope, /not accepted RDE standards/);
  assert.match(design, /RDE geometry/);
  assert.match(design, /<RdeGeometrySchematic design=\{activeDesign\}/);
  assert.doesNotMatch(physicsVisual, /<RdeGeometrySchematic design=\{design\}/);
  assert.match(physicsVisual, /schematic-view head-end-panel/);
  assert.match(physicsVisual, /schematic-view axial-panel/);
  assert.match(physicsVisual, /WAVE ROTATES AROUND ANNULUS/);
  assert.match(physicsVisual, /OUTER Ø/);
  assert.match(physicsVisual, /INNER Ø/);
  assert.match(physicsVisual, /RADIAL GAP/);
  assert.match(physicsVisual, /CHAMBER LENGTH/);
  assert.match(physicsVisual, /How to read the cutaway/);
  assert.match(physicsVisual, /PHYSICAL ANNULUS WALL/);
  assert.match(physicsVisual, /Show exact coordinate plots/);
  assert.match(physicsVisual, /circumferentially averaged bands/);
  assert.match(physicsVisual, /full engine definition stays in Design &amp; Plan/);
  assert.doesNotMatch(physicsVisual, /Synthetic visualization inputs/);
});

test("ships an installable Kythros app manifest and service worker", async () => {
  const { readFile } = await import("node:fs/promises");
  const manifest = JSON.parse(await readFile(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"));
  assert.equal(manifest.name, "Kythros by Caelus");
  assert.equal(manifest.display, "standalone");
  assert.ok(manifest.icons.some((icon) => icon.sizes === "192x192"));
  assert.ok(manifest.icons.some((icon) => icon.sizes === "512x512"));
  const serviceWorker = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
  assert.match(serviceWorker, /kythros-shell-v1/);
  assert.match(serviceWorker, /request\.mode === "navigate"/);
});

test("separates the case conclusion from the next-run recommendation", async () => {
  const { readFile } = await import("node:fs/promises");
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const diagnostics = await readFile(new URL("../lib/diagnostics.ts", import.meta.url), "utf8");
  const analysis = await readFile(new URL("../lib/rde-analysis.ts", import.meta.url), "utf8");
  const decisionQuality = await readFile(new URL("../lib/decision-quality.ts", import.meta.url), "utf8");
  const caseHistory = await readFile(new URL("../lib/case-history.ts", import.meta.url), "utf8");
  const inputHelp = await readFile(new URL("../lib/case-input-help.ts", import.meta.url), "utf8");
  const fileMapper = await readFile(new URL("../components/pressure-file-mapper.tsx", import.meta.url), "utf8");
  assert.match(css, /\.engineering-decision-card[^}]*border[^}]*border-radius: 14px/s);
  assert.match(css, /\.decision-block[^}]*border[^}]*border-radius: 9px/s);
  assert.match(page, /Engineering decision/);
  assert.match(page, /Likely issue:/);
  assert.match(page, /Result of this rerun/);
  assert.match(page, /What this rerun concluded/);
  assert.match(page, /What this operating point shows/);
  assert.match(page, /Next CFD run at this operating point/);
  assert.match(page, /decision-conclusion-block/);
  assert.match(page, /decision-recommendation-block/);
  assert.ok(page.indexOf("What this rerun concluded") < page.indexOf("Next CFD run at this operating point"));
  assert.doesNotMatch(page, /What this means:/);
  assert.match(page, /Do this next/);
  assert.match(page, /<strong>Change<\/strong>/);
  assert.match(page, /Keep unchanged/);
  assert.match(page, /<strong>Compare<\/strong>/);
  assert.match(page, /Independent evidence from other operating points/);
  assert.match(page, /No comparable rerun from another operating point has been analyzed/);
  assert.match(page, /selectIndependentPrecedents/);
  assert.match(page, /Research supporting this test/);
  assert.match(page, /researchClaims/);
  assert.match(page, /Kythros chose these decision limits; the cited papers did not/);
  assert.match(page, /No published paper is mapped to this specific recommendation/);
  assert.match(page, /Recommendation evidence/);
  assert.match(page, /decisionQuality\.explanation/);
  assert.match(page, /What is this recommendation status based on\?/);
  assert.match(page, /Published papers and public benchmarks do not raise it/);
  assert.match(decisionQuality, /Signal data/);
  assert.match(decisionQuality, /Experiment-CFD pairing/);
  assert.match(decisionQuality, /Controlled rerun/);
  assert.match(decisionQuality, /Independent confirmation/);
  assert.doesNotMatch(page, /decisionQuality\.score|decisionQuality\.maximumScore/);
  assert.match(page, /Starting point/);
  assert.match(page, /The selected change was rejected and is not carried forward/);
  assert.match(page, /This is the latest accepted setting at this operating point/);
  assert.match(page, /Plan reference:/);
  assert.match(page, /publicAnalyzerValidation/);
  assert.match(page, /Public benchmark cases test the analyzer/);
  assert.match(page, /decisionQuality/);
  assert.match(page, /recommendationScope/);
  assert.match(page, /comparable controlled rerun/);
  assert.doesNotMatch(page, /What comparable cases show/);
  assert.doesNotMatch(page, /92%/);
  assert.doesNotMatch(page, /★/);
  assert.match(page, /Question being tested/);
  assert.match(page, /nextRun\.question/);
  assert.match(page, /They are not columns or labels in the CSV files/);
  assert.match(page, /title="Findings that support this explanation"/);
  assert.match(page, /title="Findings that contradict this explanation"/);
  assert.match(page, /title="Evidence still needed"/);
  assert.match(page, /No finding in the analyzed cases contradicts this explanation/);
  assert.match(page, /Why this is the next test/);
  assert.match(page, /How Kythros will classify the result/);
  assert.match(page, /still changes the result/);
  assert.match(page, /test the next \{testedVariable\} level before changing the physics/);
  assert.match(page, /Separate question:/);
  assert.match(page, /Does not support this explanation/);
  assert.match(page, /outcome-rules/);
  assert.doesNotMatch(page, /outcome-rules-four/);
  assert.doesNotMatch(page, /Kythros decides this when:/);
  assert.match(page, /reasoningLedger/);
  assert.match(page, /decisionPolicy/);
  assert.match(page, /selectPlanningEvidence/);
  assert.match(page, /Starting run/);
  assert.match(page, /chooseCaseFamily/);
  assert.match(page, /inheritStartingCase/);
  assert.match(page, /EXPERIMENT REUSED/);
  assert.match(page, /Upload and map the CFD result for this comparison/);
  assert.match(page, /rerunFieldLocked/);
  assert.match(page, /chooseChangedVariable/);
  assert.match(page, /Review rerun →/);
  assert.match(page, /Review one-change rerun/);
  assert.match(page, /Operating point and experiment are locked/);
  assert.match(page, /changedRerunFields\.map\(caseFieldLabel\)/);
  assert.match(page, /This relationship is locked because changing it would change the meaning/);
  assert.match(page, /Controlled-rerun definition locked/);
  assert.match(page, /effectiveRelationship = editingCase\?\.relationship \?\? draftRelationship/);
  assert.match(page, /Boolean\(editingCaseId\)/);
  assert.match(page, /relationshipIssues/);
  assert.match(page, /Kythros did not use this rerun to update the plan/);
  assert.match(page, /nextRun\.latestControlledResult\.status/);
  assert.match(page, /ComparisonHierarchy/);
  assert.match(page, /<EngineeringDecisionPanel summary=\{decisionSummary\}/);
  assert.doesNotMatch(page, /<AdaptivePlanPanel/);
  assert.doesNotMatch(page, /className="decision-card"/);
  assert.doesNotMatch(page, /<span>Recommended next CFD run:<\/span>/);
  assert.doesNotMatch(page, /Make one controlled change, or one technically linked set of changes/);
  assert.doesNotMatch(diagnostics, /Test the recorded inlet representation|Bracket the recorded wall treatment|Run one initialization-only mode test|Tighten only chemistry time integration/);
  assert.doesNotMatch(analysis, /recommendationFor/);
  assert.match(inputHelp, /not read from or calculated from either pressure CSV/i);
  assert.match(page, /One operating point contains its experiment, baseline CFD, and qualifying one-change CFD reruns/i);
  assert.match(fileMapper, /The current mapped file will be kept unless you choose a replacement/);
  assert.match(caseHistory, /Kythros did not use this case to update the plan/);
  assert.match(decisionQuality, /No comparable user-provided rerun from another operating point has confirmed this decision/);
  const claritySurface = `${page}\n${diagnostics}\n${decisionQuality}\n${caseHistory}\n${inputHelp}\n${fileMapper}`;
  assert.doesNotMatch(claritySurface, /None loaded|No cases loaded|No unresolved evidence item|Shared next run|Evidence for it|Evidence against it|Still unknown|How this run will be judged|Cannot judge|\bUnclear\b/);
});

test("uses clear graph labels and a shared legend for every case", async () => {
  const { readFile } = await import("node:fs/promises");
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /<strong>Measured experiment<\/strong><small>Solid teal line<\/small>/);
  assert.match(page, /<strong>CFD simulation<\/strong><small>Dashed blue line<\/small>/);
  assert.match(page, /Measured experiment minus CFD simulation/);
  assert.match(page, /TIME \(ms\)/);
  assert.match(page, /FREQUENCY \(kHz\)/);
  assert.match(page, /PROBE POSITION \(deg\)/);
  assert.match(css, /\.series-cfd[^}]*stroke-dasharray: 7 5/);
});
