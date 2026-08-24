import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("keeps the RDE animation controllable, accessible, and explicitly schematic", async () => {
  const component = await readFile(new URL("../components/rde-physics-visual.tsx", import.meta.url), "utf8");
  const assembly = await readFile(new URL("../components/rde-assembly-3d.tsx", import.meta.url), "utf8");
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
  assert.match(component, /<RdeAssembly3D design=\{design\}/);
  assert.match(assembly, /WebGLRenderer/);
  assert.match(assembly, /OrbitControls/);
  assert.match(assembly, /Drag to rotate/);
  assert.match(assembly, /wheel or pinch to zoom/);
  assert.match(assembly, /COMPONENT INSPECTOR/);
  assert.match(assembly, /Cooling circuit/);
  assert.match(assembly, /Combustion annulus/);
  assert.match(assembly, /pointerup/);
  assert.match(assembly, /aria-label", "Interactive three-dimensional RDE assembly/);
  assert.match(styles, /@keyframes rotate-wave/);
  assert.match(styles, /animation-play-state: paused/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});
