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
  assert.match(html, /recommends the next CFD run/);
  assert.match(html, /rel="manifest"/);
  assert.match(html, />Install Caevera</);
  assert.match(html, /Add first case/);
  assert.match(html, /Load synthetic case history/);
  assert.match(html, />Help</);
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
