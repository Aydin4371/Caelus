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
  assert.match(html, /CAEVERA/);
  assert.match(html, /Welcome to Caevera/);
  assert.match(html, /recommends one CFD change/);
  assert.match(html, /No case has been added yet/);
  assert.match(html, /rel="manifest"/);
  assert.match(html, />Install Caevera</);
  assert.match(html, /Add first case/);
  assert.match(html, /Load synthetic case history/);
  assert.match(html, />Help</);
  assert.match(html, /Open workspace/);
  assert.match(html, /Open saved workspace/);
  assert.match(html, /Return to empty home workspace/);
  assert.doesNotMatch(html, /Synthetic baseline/);
  assert.doesNotMatch(html, /Signal evidence/);
  assert.doesNotMatch(html, /aligned samples/);
  assert.doesNotMatch(html, /\u2014/);
});

test("ships an installable Caevera app manifest and service worker", async () => {
  const { readFile } = await import("node:fs/promises");
  const manifest = JSON.parse(await readFile(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"));
  assert.equal(manifest.name, "Caevera by Caelus");
  assert.equal(manifest.display, "standalone");
  assert.ok(manifest.icons.some((icon) => icon.sizes === "192x192"));
  assert.ok(manifest.icons.some((icon) => icon.sizes === "512x512"));
  const serviceWorker = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
  assert.match(serviceWorker, /caevera-shell-v1/);
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
  assert.match(page, /What this case shows/);
  assert.match(page, /Next CFD run for this case family/);
  assert.match(page, /decision-conclusion-block/);
  assert.match(page, /decision-recommendation-block/);
  assert.ok(page.indexOf("What this rerun concluded") < page.indexOf("Next CFD run for this case family"));
  assert.doesNotMatch(page, /What this means:/);
  assert.match(page, /Do this next/);
  assert.match(page, /<strong>Change<\/strong>/);
  assert.match(page, /Keep unchanged/);
  assert.match(page, /<strong>Compare<\/strong>/);
  assert.match(page, /Independent evidence from other case families/);
  assert.match(page, /No comparable rerun from another case family has been analyzed/);
  assert.match(page, /selectIndependentPrecedents/);
  assert.match(page, /Research supporting this test/);
  assert.match(page, /researchClaims/);
  assert.match(page, /Caevera chose these decision limits; the cited papers did not/);
  assert.match(page, /No published paper is mapped to this specific recommendation/);
  assert.match(page, /Evidence readiness/);
  assert.match(page, /decisionQuality\.explanation/);
  assert.match(page, /Why is evidence readiness \{decisionQuality\.score\}\/\{decisionQuality\.maximumScore\}\?/);
  assert.match(page, /Starting point/);
  assert.match(page, /The selected change was rejected and is not carried forward/);
  assert.match(page, /This is the latest accepted setting in the case family/);
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
  assert.match(page, /How Caevera will classify the result/);
  assert.match(page, /still changes the result/);
  assert.match(page, /test the next \{testedVariable\} level before changing the physics/);
  assert.match(page, /Separate question:/);
  assert.match(page, /Does not support this explanation/);
  assert.match(page, /outcome-rules/);
  assert.doesNotMatch(page, /outcome-rules-four/);
  assert.doesNotMatch(page, /Caevera decides this when:/);
  assert.match(page, /reasoningLedger/);
  assert.match(page, /decisionPolicy/);
  assert.match(page, /selectPlanningEvidence/);
  assert.match(page, /Starting case/);
  assert.match(page, /chooseCaseFamily/);
  assert.match(page, /inheritStartingCase/);
  assert.match(page, /EXPERIMENT REUSED/);
  assert.match(page, /Upload and map only the new CFD result/);
  assert.match(page, /rerunFieldLocked/);
  assert.match(page, /chooseChangedVariable/);
  assert.match(page, /Review rerun →/);
  assert.match(page, /Review one-change rerun/);
  assert.match(page, /Comparison inputs are locked/);
  assert.match(page, /changedRerunFields\.map\(caseFieldLabel\)/);
  assert.match(page, /This relationship is locked because changing it would change the meaning/);
  assert.match(page, /Controlled-rerun definition locked/);
  assert.match(page, /effectiveRelationship = editingCase\?\.relationship \?\? draftRelationship/);
  assert.match(page, /disabled=\{Boolean\(editingCaseId\)\}/);
  assert.match(page, /relationshipIssues/);
  assert.match(page, /Caevera did not use this rerun to update the plan/);
  assert.match(page, /nextRun\.latestControlledResult\.status/);
  assert.match(page, /caseTabSummary\(item\)/);
  assert.match(page, /<EngineeringDecisionPanel summary=\{decisionSummary\}/);
  assert.doesNotMatch(page, /<AdaptivePlanPanel/);
  assert.doesNotMatch(page, /className="decision-card"/);
  assert.doesNotMatch(page, /<span>Recommended next CFD run:<\/span>/);
  assert.doesNotMatch(page, /Make one controlled change, or one technically linked set of changes/);
  assert.doesNotMatch(diagnostics, /Test the recorded inlet representation|Bracket the recorded wall treatment|Run one initialization-only mode test|Tighten only chemistry time integration/);
  assert.doesNotMatch(analysis, /recommendationFor/);
  assert.match(inputHelp, /not read from or calculated from either pressure CSV/i);
  assert.match(page, /A case family is one baseline plus reruns that reuse its experiment and physical operating point/i);
  assert.match(fileMapper, /The current mapped file will be kept unless you choose a replacement/);
  assert.match(caseHistory, /Caevera did not use this case to update the plan/);
  assert.match(decisionQuality, /No comparable rerun from another case family has been analyzed/);
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
