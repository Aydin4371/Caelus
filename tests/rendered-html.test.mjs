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

test("separates each rerun outcome from a clear next-run plan", async () => {
  const { readFile } = await import("node:fs/promises");
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(css, /\.decision-card \.decision-line > span[^}]*clamp\(23px, 2\.2vw, 30px\)/s);
  assert.match(css, /\.decision-card h2[^}]*clamp\(21px, 1\.9vw, 27px\)/s);
  assert.match(page, /<span>Likely issue:<\/span> \{likelyHypothesis/);
  assert.match(page, /Result of this rerun/);
  assert.match(page, /What this means:/);
  assert.match(page, /Run this next/);
  assert.match(page, /Change only this/);
  assert.match(page, /Keep fixed/);
  assert.match(page, /Success looks like/);
  assert.match(page, /What prior cases tell you/);
  assert.match(page, /Conclusion/);
  assert.match(page, /Observed result:/);
  assert.match(page, /Calculated from data:/);
  assert.match(page, /Current analysis source:/);
  assert.match(page, /comparable controlled rerun/);
  assert.match(page, /generated demo inputs, not uploaded program evidence/);
  assert.match(page, /No result or recommendation is stored as a preset/);
  assert.doesNotMatch(page, /What comparable cases show/);
  assert.match(page, /fastest discriminating run/);
  assert.match(page, /What happens after you upload the result/);
  assert.match(page, /nextRun\.latestControlledResult\.status/);
  assert.match(page, /caseTabSummary\(item\)/);
  assert.match(page, /<AdaptivePlanPanel nextRun=\{planAssessment\.nextRun\} showLatestResult=\{!activeCaseEvidence\} analysisInput=\{planningInput\} \/>/);
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
