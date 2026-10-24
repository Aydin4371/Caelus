"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { EngineDesign } from "@/lib/design-workspace";
import type { FastRde2dResult } from "@/lib/fast-rde-2d";

export type ComputedFlowMetric = "pressure" | "temperature" | "reaction" | "velocity";
type ViewPreset = "isometric" | "side" | "head-end";

type DisplayResult = { field: Pick<FastRde2dResult["field"], "nx" | "ny" | "pressureBar" | "temperatureK" | "velocityMps" | "reactionProgress">; recording?: FastRde2dResult["recording"] };

type Props = {
  liveTimeMs?: number;
  design: EngineDesign;
  result: DisplayResult;
  metric: ComputedFlowMetric;
  onMetricChange: (metric: ComputedFlowMetric) => void;
};

const PALETTE = [
  new THREE.Color("#122d42"),
  new THREE.Color("#177691"),
  new THREE.Color("#3eb59c"),
  new THREE.Color("#f4cf60"),
  new THREE.Color("#da6935"),
  new THREE.Color("#7c232f"),
];

function fieldValues(result: DisplayResult, metric: ComputedFlowMetric) {
  if (metric === "pressure") return result.field.pressureBar;
  if (metric === "temperature") return result.field.temperatureK;
  if (metric === "reaction") return result.field.reactionProgress;
  return result.field.velocityMps;
}

function fieldUnit(metric: ComputedFlowMetric) {
  if (metric === "pressure") return "bar";
  if (metric === "temperature") return "K";
  if (metric === "reaction") return "burned";
  return "m/s";
}

function normalizedColor(value: number, minimum: number, maximum: number) {
  const normalized = Math.max(0, Math.min(1, (value - minimum) / Math.max(1e-12, maximum - minimum)));
  const scaled = normalized * (PALETTE.length - 1);
  const index = Math.min(PALETTE.length - 2, Math.floor(scaled));
  return PALETTE[index].clone().lerp(PALETTE[index + 1], scaled - index);
}

function finiteRange(values: number[]) {
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }
  return Number.isFinite(minimum) && Number.isFinite(maximum) ? [minimum, maximum] as const : [0, 1] as const;
}

function setCamera(view: ViewPreset, camera: THREE.PerspectiveCamera, controls: OrbitControls) {
  if (view === "side") camera.position.set(0.2, 1.1, 11.8);
  else if (view === "head-end") camera.position.set(-11.5, 0.2, 0.1);
  else camera.position.set(9.2, 6.7, 10.2);
  controls.target.set(0.25, 0, 0);
  camera.lookAt(controls.target);
  controls.update();
}

export function RdeComputedFlow3d({ design, result, metric, onMetricChange, liveTimeMs }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [cutaway, setCutaway] = useState(true);
  const [view, setView] = useState<ViewPreset>("isometric");
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const frames = result.recording?.frames;
  const frameField = metric === "pressure" ? "pressureBar" : metric === "temperature" ? "temperatureK" : metric === "velocity" ? "velocityMps" : null;
  const playback = !!frameField && !!frames?.length && frames.every((frame) => frame[frameField]?.length === result.field.nx * result.field.ny);
  const currentFrame = frames?.[Math.min(frameIndex, frames.length - 1)];
  const values = playback && currentFrame ? currentFrame[frameField!]! : fieldValues(result, metric);
  const valuesRef = useRef(values);
  const rangeRef = useRef<readonly number[]>([0, 1]);
  const sourceNx = result.field.nx;
  const sourceNy = result.field.ny;
  const colorUpdater = useRef<(() => void) | null>(null);
  const [minimum, maximum] = useMemo(() => {
    if (!playback || !frameField || !result.recording?.frames.length) return finiteRange(fieldValues(result, metric));
    let low = Infinity, high = -Infinity;
    for (const frame of result.recording.frames) {
      const range = finiteRange(frame[frameField]!);
      low = Math.min(low, range[0]); high = Math.max(high, range[1]);
    }
    return [low, high];
  }, [metric, result, playback, frameField]);
  useEffect(() => { valuesRef.current = values; rangeRef.current = [minimum, maximum]; colorUpdater.current?.(); }, [values, minimum, maximum]);
  useEffect(() => {
    if (!playing || !playback || !frames || frameIndex >= frames.length - 1) return;
    const duration = Math.max(1e-9, frames[frames.length - 1].timeMs - frames[0].timeMs);
    const delay = (frames[frameIndex + 1].timeMs - frames[frameIndex].timeMs) / duration * 8000 / speed;
    const timer = window.setTimeout(() => {
      setFrameIndex(frameIndex + 1);
      if (frameIndex + 1 === frames.length - 1) setPlaying(false);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [playing, playback, frames, frameIndex, speed]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.replaceChildren();
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    } catch {
      const fallback = document.createElement("div");
      fallback.className = "computed-flow-fallback";
      fallback.innerHTML = "<strong>3D view unavailable</strong><p>The calculated result is still available in the 2D field view below.</p>";
      host.appendChild(fallback);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0xf2f7f5, 1);
    renderer.domElement.tabIndex = 0;
    renderer.domElement.setAttribute("aria-label", `Interactive three-dimensional ${metric} field mapped around the RDE annulus`);
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 6;
    controls.maxDistance = 24;
    setCamera(view, camera, controls);
    scene.add(new THREE.HemisphereLight(0xf7ffff, 0x8c7866, 2.4));
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(-4, 8, 9);
    scene.add(key);

    const meanRadius = 2.15;
    const enteredMeanRadius = Math.max(1, 0.25 * (design.annulusInnerDiameterMm + design.annulusOuterDiameterMm));
    const gapRatio = Math.max(0.035, Math.min(0.24, (design.annulusOuterDiameterMm - design.annulusInnerDiameterMm) / (2 * enteredMeanRadius)));
    const innerRadius = meanRadius * (1 - gapRatio);
    const outerRadius = meanRadius * (1 + gapRatio);
    const fieldRadius = 0.5 * (innerRadius + outerRadius);
    const chamberLength = 6.4;
    const inletX = -0.5 * chamberLength;
    const outletX = 0.5 * chamberLength;
    const orientAlongX = <T extends THREE.Object3D>(object: T) => { object.rotation.z = -Math.PI / 2; return object; };
    const material = (color: number, opacity = 1, metalness = 0.1, roughness = 0.48) => new THREE.MeshStandardMaterial({
      color,
      transparent: opacity < 1,
      opacity,
      metalness,
      roughness,
      side: THREE.DoubleSide,
      depthWrite: opacity > 0.45,
    });

    const shellStart = cutaway ? Math.PI * 0.18 : 0;
    const shellArc = cutaway ? Math.PI * 1.48 : Math.PI * 2;
    const shellOpacity = cutaway ? 0.34 : 0.14;

    // Feed plenum and injector face make the head end read as an RDRE rather than a generic tube.
    const plenum = orientAlongX(new THREE.Mesh(
      new THREE.CylinderGeometry(outerRadius + 0.42, outerRadius + 0.42, 0.76, 72),
      material(0x668187, 0.82, 0.62, 0.32),
    ));
    plenum.position.x = inletX - 0.42;
    scene.add(plenum);

    const injectorFace = new THREE.Mesh(
      new THREE.RingGeometry(innerRadius + 0.025, outerRadius - 0.025, 72),
      material(0xb9434e, 1, 0.42, 0.34),
    );
    injectorFace.rotation.y = Math.PI / 2;
    injectorFace.position.x = inletX + 0.015;
    scene.add(injectorFace);
    const injectorCount = Math.max(16, Math.min(32, Math.round(design.injectorCount / 4) || 24));
    for (let index = 0; index < injectorCount; index += 1) {
      const angle = index / injectorCount * Math.PI * 2;
      const orifice = new THREE.Mesh(
        new THREE.SphereGeometry(0.052, 9, 7),
        material(0xf1b24b, 1, 0.06, 0.3),
      );
      orifice.position.set(inletX + 0.04, Math.cos(angle) * fieldRadius, Math.sin(angle) * fieldRadius);
      scene.add(orifice);
    }

    // The centerbody forms the inner wall of the annular combustor and tapers downstream.
    const centerbody = orientAlongX(new THREE.Mesh(
      new THREE.CylinderGeometry(innerRadius, innerRadius, chamberLength + 0.04, 72),
      material(0x88989b, 1, 0.56, 0.3),
    ));
    scene.add(centerbody);
    const centerCone = orientAlongX(new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, innerRadius, 1.62, 72),
      material(0x88989b, 1, 0.56, 0.3),
    ));
    centerCone.position.x = outletX + 0.8;
    scene.add(centerCone);

    const hotWall = orientAlongX(new THREE.Mesh(
      new THREE.CylinderGeometry(outerRadius + 0.025, outerRadius + 0.025, chamberLength + 0.08, 72, 1, true, shellStart, shellArc),
      material(0xb87333, cutaway ? 0.78 : 0.24, 0.48, 0.35),
    ));
    scene.add(hotWall);
    const outerShell = orientAlongX(new THREE.Mesh(
      new THREE.CylinderGeometry(outerRadius + 0.22, outerRadius + 0.22, chamberLength + 0.22, 72, 1, true, shellStart, shellArc),
      material(0xaebfc1, shellOpacity, 0.68, 0.25),
    ));
    scene.add(outerShell);

    // Expanding exhaust shroud and tapered centerbody are both on the downstream end.
    const nozzle = orientAlongX(new THREE.Mesh(
      new THREE.CylinderGeometry(outerRadius + 0.88, outerRadius + 0.2, 1.72, 72, 1, true, shellStart, shellArc),
      material(0x586c73, cutaway ? 0.62 : 0.18, 0.72, 0.24),
    ));
    nozzle.position.x = outletX + 0.84;
    scene.add(nozzle);
    const nozzleLip = new THREE.Mesh(
      new THREE.TorusGeometry(outerRadius + 0.86, 0.075, 10, 72, shellArc),
      material(0x40575f, 0.9, 0.76, 0.2),
    );
    nozzleLip.rotation.y = Math.PI / 2;
    nozzleLip.rotation.x = shellStart;
    nozzleLip.position.x = outletX + 1.69;
    scene.add(nozzleLip);

    const circumferentialSegments = Math.min(128, sourceNx);
    const axialSegments = Math.min(64, sourceNy);
    const visibleFieldStart = cutaway ? shellStart : 0;
    const visibleFieldArc = cutaway ? shellArc : Math.PI * 2;
    const positions: number[] = [];
    const colors: number[] = [];
    const sourceIndices: number[] = [];
    const indices: number[] = [];
    for (let axial = 0; axial < axialSegments; axial += 1) {
      const sourceY = Math.min(sourceNy - 1, Math.round(axial / Math.max(1, axialSegments - 1) * (sourceNy - 1)));
      const x = inletX + axial / Math.max(1, axialSegments - 1) * chamberLength;
      for (let circumferential = 0; circumferential <= circumferentialSegments; circumferential += 1) {
        const theta = visibleFieldStart + circumferential / circumferentialSegments * visibleFieldArc;
        const normalizedTheta = ((theta % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        const sourceX = Math.min(sourceNx - 1, Math.floor(normalizedTheta / (Math.PI * 2) * sourceNx));
        positions.push(x, Math.cos(theta) * fieldRadius, Math.sin(theta) * fieldRadius);
        const displayColor = normalizedColor(valuesRef.current[sourceY * sourceNx + sourceX], rangeRef.current[0], rangeRef.current[1]);
        colors.push(displayColor.r, displayColor.g, displayColor.b);
        sourceIndices.push(sourceY * sourceNx + sourceX);
      }
    }
    for (let axial = 0; axial < axialSegments - 1; axial += 1) {
      for (let circumferential = 0; circumferential < circumferentialSegments; circumferential += 1) {
        const row = circumferentialSegments + 1;
        const a = axial * row + circumferential;
        const b = a + 1;
        const c = a + row;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
    const fieldGeometry = new THREE.BufferGeometry();
    fieldGeometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    fieldGeometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    fieldGeometry.setIndex(indices);
    fieldGeometry.computeVertexNormals();
    const fieldSurface = new THREE.Mesh(fieldGeometry, new THREE.MeshStandardMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      roughness: 0.48,
      metalness: 0.01,
      transparent: true,
      opacity: cutaway ? 0.86 : 0.72,
    }));
    scene.add(fieldSurface);
    colorUpdater.current = () => {
      const attribute = fieldGeometry.getAttribute("color") as THREE.BufferAttribute;
      sourceIndices.forEach((sourceIndex, index) => {
        const color = normalizedColor(valuesRef.current[sourceIndex], rangeRef.current[0], rangeRef.current[1]);
        attribute.setXYZ(index, color.r, color.g, color.b);
      });
      attribute.needsUpdate = true;
    };

    const floor = new THREE.GridHelper(18, 18, 0xa9bfc0, 0xd9e4e2);
    floor.position.y = -3.2;
    scene.add(floor);

    const resize = () => {
      const width = Math.max(320, host.clientWidth);
      const height = Math.max(360, host.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);
    resize();

    // Display the computed snapshot without invented wave or particle motion.
    let frame = 0;
    const animate = () => {
      controls.update();
      renderer.render(scene, camera);
      frame = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      colorUpdater.current = null;
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      controls.dispose();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Points || object instanceof THREE.Line) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((item) => item.dispose());
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [cutaway, design, metric, sourceNx, sourceNy, view]);

  return <section className="computed-flow-3d" aria-labelledby="computed-flow-title">
    <div className="computed-flow-heading">
      <div><span>OUTPUT</span><h3 id="computed-flow-title">2D flow on your engine</h3><p>Drag to rotate. {liveTimeMs !== undefined ? "Live preview shows calculated states as the solver runs." : "Playback shows saved 2D timesteps wrapped around the chamber."}</p></div>
      <label><span>Display field</span><select value={metric} onChange={(event) => { setPlaying(false); onMetricChange(event.target.value as ComputedFlowMetric); }}><option value="pressure">Pressure</option><option value="temperature">Temperature</option><option value="reaction">Reaction progress</option><option value="velocity">Velocity magnitude</option></select></label>
    </div>
    <div className="computed-flow-toolbar" aria-label="3D flow controls">
      <div><button className={cutaway ? "active" : ""} onClick={() => setCutaway((current) => !current)}>{cutaway ? "Cutaway" : "Full annulus"}</button></div>
      <div><button className={view === "isometric" ? "active" : ""} onClick={() => setView("isometric")}>Isometric</button><button className={view === "side" ? "active" : ""} onClick={() => setView("side")}>Side</button><button className={view === "head-end" ? "active" : ""} onClick={() => setView("head-end")}>Head-end</button></div>
    </div>
    <div className="computed-flow-stage">
      <div ref={hostRef} className="computed-flow-host" />
      <span className="computed-flow-wave-label"><strong>{liveTimeMs !== undefined ? "LIVE · CALCULATED 2D" : playback ? "2D TIMESTEP" : "FINAL SNAPSHOT"}</strong><small>{liveTimeMs !== undefined ? `${liveTimeMs.toFixed(4)} ms simulated` : playback ? `${currentFrame!.timeMs.toFixed(4)} ms` : "No recorded history for this field"}</small></span>
      <span className="computed-flow-inlet">PROPELLANT INJECTION</span><span className="computed-flow-outlet">NOZZLE / EXHAUST</span>
    </div>
    <div className="computed-flow-legend"><span>{minimum.toFixed(metric === "reaction" ? 2 : 1)} {fieldUnit(metric)}</span><i/><span>{maximum.toFixed(metric === "reaction" ? 2 : 1)} {fieldUnit(metric)}</span></div>
    {playback && frames && <div className="computed-flow-toolbar" aria-label="2D timestep playback">
      <button onClick={() => { if (frameIndex >= frames.length - 1) setFrameIndex(0); setPlaying(!playing); }}>{playing ? "Pause" : frameIndex >= frames.length - 1 ? "Replay" : "Play"}</button>
      <input style={{ flex: 1, minWidth: 100 }} aria-label="Simulation timestep" type="range" min={0} max={frames.length - 1} value={frameIndex} onChange={(event) => { setPlaying(false); setFrameIndex(Number(event.target.value)); }} />
      <output>{currentFrame!.timeMs.toFixed(4)} ms · frame {frameIndex + 1}/{frames.length}</output>
      <select aria-label="Playback speed" value={speed} onChange={(event) => setSpeed(Number(event.target.value))}><option value={0.5}>0.5× playback</option><option value={1}>1× playback</option><option value={2}>2× playback</option></select>
    </div>}
    <p className="computed-flow-scope">Screening CFD shown inside the entered annular engine geometry. {liveTimeMs !== undefined ? "Preview updates at recorded simulation times; it is not real-time physical motion. The colour scale updates with each live field. Replay uses a fixed scale after completion." : playback ? "Saved pressure, temperature and velocity timesteps, slowed for viewing. Each field has a fixed scale across the run. Reaction progress is a final snapshot." : "This field has no saved playback; showing the final snapshot. Run a new 2D simulation to record pressure, temperature and velocity timesteps."} Wrapping does not add radial flow or establish physical accuracy.</p>
  </section>;
}

