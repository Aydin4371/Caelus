"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { EngineDesign } from "@/lib/design-workspace";
import type { FastRde2dResult } from "@/lib/fast-rde-2d";

export type ComputedFlowMetric = "pressure" | "temperature" | "reaction" | "velocity";
type ViewPreset = "isometric" | "side" | "head-end";

type Props = {
  design: EngineDesign;
  result: FastRde2dResult;
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

function fieldValues(result: FastRde2dResult, metric: ComputedFlowMetric) {
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

export function RdeComputedFlow3d({ design, result, metric, onMetricChange }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(true);
  const [cutaway, setCutaway] = useState(true);
  const [tracers, setTracers] = useState(true);
  const [view, setView] = useState<ViewPreset>("isometric");
  const playingRef = useRef(playing);
  const values = useMemo(() => fieldValues(result, metric), [metric, result]);
  const [minimum, maximum] = useMemo(() => finiteRange(values), [values]);

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

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
    const orientAlongX = <T extends THREE.Object3D>(object: T) => { object.rotation.z = Math.PI / 2; return object; };
    const material = (color: number, opacity = 1, metalness = 0.1) => new THREE.MeshStandardMaterial({ color, transparent: opacity < 1, opacity, metalness, roughness: 0.48, side: THREE.DoubleSide, depthWrite: opacity > 0.45 });

    const centerbody = orientAlongX(new THREE.Mesh(new THREE.CylinderGeometry(innerRadius, innerRadius, chamberLength + 0.1, 64), material(0xb99768, 1, 0.24)));
    scene.add(centerbody);
    const centerCone = orientAlongX(new THREE.Mesh(new THREE.CylinderGeometry(0.08, innerRadius, 1.4, 64), material(0xb99768, 1, 0.24)));
    centerCone.position.x = outletX + 0.72;
    scene.add(centerCone);

    const shellStart = cutaway ? Math.PI * 0.19 : 0;
    const shellArc = cutaway ? Math.PI * 1.50 : Math.PI * 2;
    const shellOpacity = cutaway ? 0.42 : 0.16;
    const outerShell = orientAlongX(new THREE.Mesh(new THREE.CylinderGeometry(outerRadius + 0.18, outerRadius + 0.18, chamberLength + 0.18, 72, 1, true, shellStart, shellArc), material(0x789294, shellOpacity, 0.42)));
    scene.add(outerShell);
    const injector = new THREE.Mesh(new THREE.TorusGeometry(fieldRadius, Math.max(0.045, 0.22 * (outerRadius - innerRadius)), 12, 72), material(0xc9545c, 0.95, 0.14));
    injector.rotation.y = Math.PI / 2;
    injector.position.x = inletX;
    scene.add(injector);
    const nozzle = orientAlongX(new THREE.Mesh(new THREE.CylinderGeometry(outerRadius + 0.75, outerRadius + 0.2, 1.65, 64, 1, true, shellStart, shellArc), material(0x687f86, cutaway ? 0.54 : 0.18, 0.5)));
    nozzle.position.x = outletX + 0.82;
    scene.add(nozzle);

    const sourceNx = result.field.nx;
    const sourceNy = result.field.ny;
    const circumferentialSegments = Math.min(128, sourceNx);
    const axialSegments = Math.min(64, sourceNy);
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    for (let axial = 0; axial < axialSegments; axial += 1) {
      const sourceY = Math.min(sourceNy - 1, Math.round(axial / Math.max(1, axialSegments - 1) * (sourceNy - 1)));
      const x = inletX + axial / Math.max(1, axialSegments - 1) * chamberLength;
      for (let circumferential = 0; circumferential <= circumferentialSegments; circumferential += 1) {
        const wrapped = circumferential % circumferentialSegments;
        const sourceX = Math.min(sourceNx - 1, Math.floor(wrapped / circumferentialSegments * sourceNx));
        const theta = circumferential / circumferentialSegments * Math.PI * 2;
        positions.push(x, Math.cos(theta) * fieldRadius, Math.sin(theta) * fieldRadius);
        const displayColor = normalizedColor(values[sourceY * sourceNx + sourceX], minimum, maximum);
        colors.push(displayColor.r, displayColor.g, displayColor.b);
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
    const fieldSurface = new THREE.Mesh(fieldGeometry, new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.52, metalness: 0.02 }));
    scene.add(fieldSurface);

    const tracerCount = 220;
    const tracerPositions = new Float32Array(tracerCount * 3);
    const tracerPhase = new Float32Array(tracerCount);
    for (let index = 0; index < tracerCount; index += 1) {
      tracerPhase[index] = (Math.sin(index * 78.233) * 43758.5453) % 1;
      if (tracerPhase[index] < 0) tracerPhase[index] += 1;
    }
    const tracerGeometry = new THREE.BufferGeometry();
    tracerGeometry.setAttribute("position", new THREE.BufferAttribute(tracerPositions, 3));
    const tracerPoints = new THREE.Points(tracerGeometry, new THREE.PointsMaterial({ color: 0xeaf9ff, size: 0.055, sizeAttenuation: true, transparent: true, opacity: 0.8, depthWrite: false }));
    tracerPoints.visible = tracers;
    scene.add(tracerPoints);

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

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const circumferenceM = Math.PI * 0.5 * (design.annulusInnerDiameterMm + design.annulusOuterDiameterMm) * 1e-3;
    const waveRotationsPerSecond = result.screeningDiagnostics.estimatedWaveSpeedMps ? result.screeningDiagnostics.estimatedWaveSpeedMps / Math.max(0.01, circumferenceM) : 220;
    let playbackPhase = 0;
    let previousTime = performance.now();
    let frame = 0;
    const animate = (time = performance.now()) => {
      const elapsedSeconds = Math.min(0.05, Math.max(0, time - previousTime) / 1000);
      previousTime = time;
      if (playingRef.current && !reduceMotion) playbackPhase += elapsedSeconds * Math.min(2.4, Math.max(0.25, waveRotationsPerSecond / 800)) * Math.PI * 2;
      fieldSurface.rotation.x = playbackPhase;
      const positionsAttribute = tracerGeometry.getAttribute("position") as THREE.BufferAttribute;
      for (let index = 0; index < tracerCount; index += 1) {
        const axial = (tracerPhase[index] + time * 0.00008 * (playingRef.current ? 1 : 0)) % 1;
        const theta = index / tracerCount * Math.PI * 2 + playbackPhase * 0.45 + axial * 0.8;
        positionsAttribute.setXYZ(index, inletX + axial * (chamberLength + 1.5), Math.cos(theta) * fieldRadius, Math.sin(theta) * fieldRadius);
      }
      positionsAttribute.needsUpdate = true;
      controls.update();
      renderer.render(scene, camera);
      frame = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      controls.dispose();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((item) => item.dispose());
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [cutaway, design, maximum, metric, minimum, result, tracers, values, view]);

  return <section className="computed-flow-3d" aria-labelledby="computed-flow-title">
    <div className="computed-flow-heading">
      <div><span>3D FLOW VIEW</span><h3 id="computed-flow-title">Calculated flow through this engine</h3><p>The solved circumferential–axial field is wrapped onto the engine annulus so the wave and downstream flow can be inspected in physical context.</p></div>
      <label><span>Display field</span><select value={metric} onChange={(event) => onMetricChange(event.target.value as ComputedFlowMetric)}><option value="pressure">Pressure</option><option value="temperature">Temperature</option><option value="reaction">Reaction progress</option><option value="velocity">Velocity magnitude</option></select></label>
    </div>
    <div className="computed-flow-toolbar" aria-label="3D flow controls">
      <div><button className={playing ? "active" : ""} onClick={() => setPlaying((current) => !current)}>{playing ? "Pause" : "Play"}</button><button className={tracers ? "active" : ""} onClick={() => setTracers((current) => !current)}>Flow tracers</button><button className={cutaway ? "active" : ""} onClick={() => setCutaway((current) => !current)}>{cutaway ? "Cutaway" : "Full annulus"}</button></div>
      <div><button className={view === "isometric" ? "active" : ""} onClick={() => setView("isometric")}>Isometric</button><button className={view === "side" ? "active" : ""} onClick={() => setView("side")}>Side</button><button className={view === "head-end" ? "active" : ""} onClick={() => setView("head-end")}>Head-end</button></div>
    </div>
    <div className="computed-flow-stage">
      <div ref={hostRef} className="computed-flow-host" />
      <span className="computed-flow-inlet">INJECTOR</span><span className="computed-flow-outlet">EXHAUST</span>
    </div>
    <div className="computed-flow-legend"><span>{minimum.toFixed(metric === "reaction" ? 2 : 1)} {fieldUnit(metric)}</span><i/><span>{maximum.toFixed(metric === "reaction" ? 2 : 1)} {fieldUnit(metric)}</span></div>
    <p className="computed-flow-scope">3D visualization of the calculated periodic 2D solution. Radial structures, discrete injector jets, turbulence, and full three-dimensional modes require the Full 3D fidelity workflow.</p>
  </section>;
}
