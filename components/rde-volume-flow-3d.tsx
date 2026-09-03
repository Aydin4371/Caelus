"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { EngineDesign } from "@/lib/design-workspace";
import type { Rde3dFieldName, Rde3dVolumeResult } from "@/lib/local-cfd";

type Props = {
  design: EngineDesign;
  result: Rde3dVolumeResult;
  field: Rde3dFieldName;
  onFieldChange: (field: Rde3dFieldName) => void;
};

type ViewPreset = "isometric" | "side" | "head-end";

const COLORS = ["#112e43", "#16758e", "#38b29b", "#f0d268", "#e36d37", "#7d2331"].map((value) => new THREE.Color(value));

function range(values: number[]) {
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }
  return Number.isFinite(minimum) && Number.isFinite(maximum) ? [minimum, maximum] as const : [0, 1] as const;
}

function colorFor(value: number, minimum: number, maximum: number) {
  const fraction = Math.max(0, Math.min(1, (value - minimum) / Math.max(1e-12, maximum - minimum)));
  const scaled = fraction * (COLORS.length - 1);
  const index = Math.min(COLORS.length - 2, Math.floor(scaled));
  return COLORS[index].clone().lerp(COLORS[index + 1], scaled - index);
}

function displayValues(result: Rde3dVolumeResult, field: Rde3dFieldName) {
  if (field === "pressure") return result.fields.pressurePa.map((value) => value / 100_000);
  if (field === "temperature") return result.fields.temperatureK;
  if (field === "reaction") return result.fields.reactionProgress;
  return result.fields.velocityAxialMps.map((value, index) => Math.hypot(value, result.fields.velocityRadialMps[index], result.fields.velocityCircumferentialMps[index]));
}

function fieldUnit(field: Rde3dFieldName) {
  if (field === "pressure") return "bar";
  if (field === "temperature") return "K";
  if (field === "reaction") return "burned";
  return "m/s";
}

function setCamera(view: ViewPreset, camera: THREE.PerspectiveCamera, controls: OrbitControls, length: number, radius: number) {
  const scale = Math.max(length, radius * 2);
  if (view === "side") camera.position.set(length * 0.5, 0, scale * 1.7);
  else if (view === "head-end") camera.position.set(-scale * 1.8, 0, 0);
  else camera.position.set(length * 1.25, scale * 0.9, scale * 1.25);
  controls.target.set(length * 0.46, 0, 0);
  camera.lookAt(controls.target);
  controls.update();
}

export function RdeVolumeFlow3d({ design, result, field, onFieldChange }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<ViewPreset>("isometric");
  const [streamlines, setStreamlines] = useState(true);
  const [playing, setPlaying] = useState(true);
  const playingRef = useRef(playing);
  const values = useMemo(() => displayValues(result, field), [field, result]);
  const [minimum, maximum] = useMemo(() => range(values), [values]);

  useEffect(() => { playingRef.current = playing; }, [playing]);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    element.replaceChildren();
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    } catch {
      const fallback = document.createElement("div");
      fallback.className = "computed-flow-fallback";
      fallback.innerHTML = "<strong>3D graphics unavailable</strong><p>The computed volume remains saved and can be opened on a computer with WebGL.</p>";
      element.appendChild(fallback);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.65));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0xf3f8f7, 1);
    renderer.domElement.setAttribute("aria-label", `True volumetric Full 3D RDRE ${field} result with integrated streamlines`);
    element.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.001, 100);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    const length = result.grid.axialLengthM;
    const inner = result.grid.innerRadiusM;
    const outer = result.grid.outerRadiusM;
    const radius = 0.5 * (inner + outer);
    controls.minDistance = Math.max(length, outer * 2) * 0.75;
    controls.maxDistance = Math.max(length, outer * 2) * 8;
    setCamera(view, camera, controls, length, outer);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8d796b, 2.35));
    const key = new THREE.DirectionalLight(0xffffff, 2.1);
    key.position.set(length, outer * 3, outer * 4);
    scene.add(key);

    const orient = <T extends THREE.Object3D>(object: T) => { object.rotation.z = -Math.PI / 2; return object; };
    const shell = new THREE.MeshStandardMaterial({ color: 0x9db0b2, transparent: true, opacity: 0.16, metalness: 0.55, roughness: 0.3, side: THREE.DoubleSide, depthWrite: false });
    const outerWall = orient(new THREE.Mesh(new THREE.CylinderGeometry(outer, outer, length, 96, 1, true), shell));
    outerWall.position.x = length * 0.5;
    scene.add(outerWall);
    const innerWall = orient(new THREE.Mesh(new THREE.CylinderGeometry(inner, inner, length, 96, 1, true), new THREE.MeshStandardMaterial({ color: 0x718487, metalness: 0.62, roughness: 0.3, side: THREE.DoubleSide })));
    innerWall.position.x = length * 0.5;
    scene.add(innerWall);
    const injector = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 96), new THREE.MeshStandardMaterial({ color: 0xb7424d, metalness: 0.42, roughness: 0.34, side: THREE.DoubleSide }));
    injector.rotation.y = Math.PI / 2;
    injector.position.x = 0;
    scene.add(injector);
    const exit = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.035 * (outer - inner), 8, 96), new THREE.MeshStandardMaterial({ color: 0x315d68, metalness: 0.6, roughness: 0.3 }));
    exit.rotation.y = Math.PI / 2;
    exit.position.x = length;
    scene.add(exit);

    const { radialCells: nr, circumferentialCells: nt, axialCells: nx } = result.grid;
    const indexOf = (ir: number, it: number, ix: number) => (ix * nt + ((it % nt) + nt) % nt) * nr + ir;
    const maximumPoints = 46_000;
    const stride = Math.max(1, Math.ceil(Math.cbrt((nr * nt * nx) / maximumPoints)));
    const positions: number[] = [];
    const pointColors: number[] = [];
    for (let ix = 0; ix < nx; ix += stride) {
      const x = length * (ix + 0.5) / nx;
      for (let it = 0; it < nt; it += stride) {
        const theta = Math.PI * 2 * (it + 0.5) / nt;
        for (let ir = 0; ir < nr; ir += stride) {
          const r = inner + (outer - inner) * (ir + 0.5) / nr;
          positions.push(x, Math.cos(theta) * r, Math.sin(theta) * r);
          const displayColor = colorFor(values[indexOf(ir, it, ix)], minimum, maximum);
          pointColors.push(displayColor.r, displayColor.g, displayColor.b);
        }
      }
    }
    const pointGeometry = new THREE.BufferGeometry();
    pointGeometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    pointGeometry.setAttribute("color", new THREE.Float32BufferAttribute(pointColors, 3));
    const cloud = new THREE.Points(pointGeometry, new THREE.PointsMaterial({ size: Math.max(outer - inner, length / nx) * 0.42, vertexColors: true, transparent: true, opacity: 0.58, depthWrite: false }));
    scene.add(cloud);

    const nearestVelocity = (r: number, theta: number, x: number) => {
      const ir = Math.max(0, Math.min(nr - 1, Math.floor((r - inner) / Math.max(1e-12, outer - inner) * nr)));
      const wrappedTheta = ((theta % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      const it = Math.max(0, Math.min(nt - 1, Math.floor(wrappedTheta / (Math.PI * 2) * nt)));
      const ix = Math.max(0, Math.min(nx - 1, Math.floor(x / Math.max(1e-12, length) * nx)));
      const index = indexOf(ir, it, ix);
      return [result.fields.velocityRadialMps[index], result.fields.velocityCircumferentialMps[index], result.fields.velocityAxialMps[index]] as const;
    };
    let maximumVelocity = 1;
    for (let index = 0; index < result.fields.velocityAxialMps.length; index += 1) maximumVelocity = Math.max(maximumVelocity, Math.hypot(result.fields.velocityAxialMps[index], result.fields.velocityRadialMps[index], result.fields.velocityCircumferentialMps[index]));
    const dt = 0.32 * Math.min(length / nx, (outer - inner) / nr, Math.PI * 2 * radius / nt) / maximumVelocity;
    const streamlineGroup = new THREE.Group();
    for (let seed = 0; seed < 20; seed += 1) {
      let r = inner + (outer - inner) * (0.2 + 0.6 * ((seed % 4) / 3));
      let theta = Math.PI * 2 * seed / 20;
      let x = length * 0.012;
      const points: THREE.Vector3[] = [];
      for (let step = 0; step < 360; step += 1) {
        points.push(new THREE.Vector3(x, Math.cos(theta) * r, Math.sin(theta) * r));
        const [radial, circumferential, axial] = nearestVelocity(r, theta, x);
        x += axial * dt;
        r = Math.max(inner + 1e-6, Math.min(outer - 1e-6, r + radial * dt));
        theta += circumferential / Math.max(r, 1e-6) * dt;
        if (x < 0 || x > length) break;
      }
      if (points.length < 2) continue;
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const streamColor = colorFor(values[indexOf(Math.floor(nr / 2), Math.floor(nt * seed / 20), 0)], minimum, maximum);
      streamlineGroup.add(new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: streamColor, transparent: true, opacity: 0.9 })));
    }
    streamlineGroup.visible = streamlines;
    scene.add(streamlineGroup);

    const tracerGeometry = new THREE.SphereGeometry(Math.max(outer - inner, length / nx) * 0.1, 7, 5);
    const tracers = Array.from({ length: 20 }, (_, index) => {
      const tracer = new THREE.Mesh(tracerGeometry, new THREE.MeshBasicMaterial({ color: 0xffffff }));
      scene.add(tracer);
      return { mesh: tracer, theta: Math.PI * 2 * index / 20, r: inner + (outer - inner) * (0.25 + 0.5 * ((index % 4) / 3)), x: length * ((index * 0.047) % 1) };
    });

    const resize = () => {
      const width = Math.max(320, element.clientWidth);
      const height = Math.max(430, Math.min(680, width * 0.52));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    let animation = 0;
    const render = () => {
      if (playingRef.current && streamlines) {
        for (const tracer of tracers) {
          const [radial, circumferential, axial] = nearestVelocity(tracer.r, tracer.theta, tracer.x);
          tracer.x += axial * dt * 2.5;
          tracer.r = Math.max(inner + 1e-6, Math.min(outer - 1e-6, tracer.r + radial * dt * 2.5));
          tracer.theta += circumferential / Math.max(tracer.r, 1e-6) * dt * 2.5;
          if (tracer.x > length || tracer.x < 0) tracer.x = length * 0.01;
          tracer.mesh.position.set(tracer.x, Math.cos(tracer.theta) * tracer.r, Math.sin(tracer.theta) * tracer.r);
          tracer.mesh.visible = true;
        }
      } else tracers.forEach((tracer) => { tracer.mesh.visible = streamlines; });
      controls.update();
      renderer.render(scene, camera);
      animation = requestAnimationFrame(render);
    };
    render();
    return () => {
      cancelAnimationFrame(animation);
      observer.disconnect();
      controls.dispose();
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        mesh.geometry?.dispose?.();
        const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
        materials.forEach((material) => material.dispose());
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [design, field, maximum, minimum, result, streamlines, values, view]);

  return <section className="volume-flow-panel">
    <header><div><span>FULL 3D VOLUME · {result.grid.radialCells} × {result.grid.circumferentialCells} × {result.grid.axialCells}</span><h3>Calculated flow through the annular chamber</h3><p>Every color sample and streamline is read from the radial, circumferential, and axial solver fields.</p></div><label><span>Display field</span><select value={field} onChange={(event) => onFieldChange(event.target.value as Rde3dFieldName)}><option value="pressure">Pressure</option><option value="temperature">Temperature</option><option value="velocity">Velocity magnitude</option><option value="reaction">Reaction progress</option></select></label></header>
    <div className="volume-flow-controls"><button onClick={() => setPlaying((value) => !value)}>{playing ? "Pause" : "Play"}</button><button className={streamlines ? "active" : ""} onClick={() => setStreamlines((value) => !value)}>Streamlines</button><div><button className={view === "isometric" ? "active" : ""} onClick={() => setView("isometric")}>Isometric</button><button className={view === "side" ? "active" : ""} onClick={() => setView("side")}>Side</button><button className={view === "head-end" ? "active" : ""} onClick={() => setView("head-end")}>Head-end</button></div></div>
    <div ref={host} className="volume-flow-canvas" />
    <div className="volume-flow-legend"><span>Injector</span><div><small>{minimum.toFixed(field === "reaction" ? 2 : 1)} {fieldUnit(field)}</small><i/><small>{maximum.toFixed(field === "reaction" ? 2 : 1)} {fieldUnit(field)}</small></div><span>Exhaust</span></div>
    <footer><span><b>{result.solver.name}</b>{result.solver.version}</span><span><b>Provenance</b>{result.provenance.host.replace("-", " ")}</span><span><b>Validation</b>{result.provenance.validationStatus.replaceAll("-", " ")}</span></footer>
  </section>;
}
