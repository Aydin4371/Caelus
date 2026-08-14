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
  assert.match(html, /recommends the next CFD run|recommends the next controlled CFD run/);
  assert.match(html, /No cases loaded/);
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
  assert.match(css, /\.engineering-decision-card[^}]*border[^}]*border-radius: 14px/s);
  assert.match(css, /\.decision-block[^}]*border[^}]*border-radius: 9px/s);
  assert.match(page, /Engineering decision/);
  assert.match(page, /Likely issue:/);
  assert.match(page, /Result of this rerun/);
  assert.match(page, /What this rerun concluded/);
  assert.match(page, /What this case shows/);
  assert.match(page, /Shared next run for this case family/);
  assert.match(page, /decision-conclusion-block/);
  assert.match(page, /decision-recommendation-block/);
  assert.ok(page.indexOf("What this rerun concluded") < page.indexOf("Shared next run for this case family"));
  assert.doesNotMatch(page, /What this means:/);
  assert.match(page, /Do this next/);
  assert.match(page, /Change only this/);
  assert.match(page, /Keep fixed/);
  assert.match(page, /Success looks like/);
  assert.match(page, /What prior cases tell you/);
  assert.match(page, /Decision quality/);
  assert.match(page, /Generated data; not real-engine evidence/);
  assert.match(page, /Why \{decisionQuality\.score\}\/\{decisionQuality\.maximumScore\}\?/);
  assert.match(page, /Starting point/);
  assert.match(page, /The selected change was rejected and is not carried forward/);
  assert.match(page, /This is the latest accepted setting in the case family/);
  assert.match(page, /Plan reference:/);
  assert.match(page, /publicAnalyzerValidation/);
  assert.match(page, /Public cases do not count as company precedent/);
  assert.match(page, /decisionQuality/);
  assert.match(page, /recommendationScope/);
  assert.match(page, /comparable controlled rerun/);
  assert.doesNotMatch(page, /What comparable cases show/);
  assert.doesNotMatch(page, /92%/);
  assert.doesNotMatch(page, /★/);
  assert.match(page, /Question being tested/);
  assert.match(page, /nextRun\.question/);
  assert.match(page, /title="Evidence for it"/);
  assert.match(page, /title="Evidence against it"/);
  assert.match(page, /title="Still unknown"/);
  assert.match(page, /Why it comes first/);
  assert.match(page, /How this run will be judged/);
  assert.match(page, /still matters/);
  assert.match(page, /Keep the new setting; run the next/);
  assert.match(page, /Reported separately:/);
  assert.match(page, /Does not support it/);
  assert.match(page, /outcome-rules/);
  assert.doesNotMatch(page, /outcome-rules-four/);
  assert.doesNotMatch(page, /Caevera decides this when:/);
  assert.match(page, /reasoningLedger/);
  assert.match(page, /decisionPolicy/);
  assert.match(page, /selectPlanningEvidence/);
  assert.match(page, /Starting settings/);
  assert.match(page, /nextRun\.latestControlledResult\.status/);
  assert.match(page, /caseTabSummary\(item\)/);
  assert.match(page, /<EngineeringDecisionPanel summary=\{decisionSummary\}/);
  assert.doesNotMatch(page, /<AdaptivePlanPanel/);
  assert.doesNotMatch(page, /className="decision-card"/);
  assert.doesNotMatch(page, /<span>Recommended next CFD run:<\/span>/);
  assert.doesNotMatch(page, /Make one controlled change, or one technically linked set of changes/);
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
