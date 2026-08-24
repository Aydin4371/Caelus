import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("keeps the RDE animation controllable, accessible, and explicitly schematic", async () => {
  const component = await readFile(new URL("../components/rde-physics-visual.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../components/rde-geometry-animation.module.css", import.meta.url), "utf8");

  assert.match(component, /Conceptual flow animation/);
  assert.match(component, /not time-accurate and is not a CFD result/);
  assert.match(component, /aria-pressed=\{animationPaused\}/);
  assert.match(component, /Pause animation/);
  assert.match(component, /Play animation/);
  assert.match(component, /rotatingWave/);
  assert.match(component, /mixtureStream/);
  assert.match(component, /productStream/);
  assert.match(component, /3D assembly/);
  assert.match(component, /Cooling channels/);
  assert.match(component, /Material map/);
  assert.match(component, /REGENERATIVE CHANNELS/);
  assert.match(component, /design\.build\?\.hotWallMaterial/);
  assert.match(component, /aria-pressed=\{assemblyLayer === value\}/);
  assert.match(styles, /@keyframes rotate-wave/);
  assert.match(styles, /animation-play-state: paused/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});
