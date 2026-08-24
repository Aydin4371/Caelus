"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { EngineDesign } from "@/lib/design-workspace";

type PartId = "all" | "plenum" | "injector" | "outer-jacket" | "cooling" | "hot-wall" | "annulus" | "centerbody" | "nozzle";
type ViewPreset = "isometric" | "side" | "head-end";

const PARTS: Array<{ id: Exclude<PartId, "all">; label: string; color: string; purpose: string }> = [
  { id: "plenum", label: "Feed plenum", color: "#8aa7aa", purpose: "Distributes the incoming propellants before injection." },
  { id: "injector", label: "Injector face", color: "#c84f58", purpose: "Meters and injects the fresh mixture into the annulus." },
  { id: "outer-jacket", label: "Outer jacket", color: "#b8c8c8", purpose: "Provides the outer pressure structure around the hot wall and cooling circuit." },
  { id: "cooling", label: "Cooling circuit", color: "#27a5c1", purpose: "Carries coolant through axial regenerative channels around the chamber." },
  { id: "hot-wall", label: "Hot-wall liner", color: "#b87333", purpose: "Separates the hot gas path from the regenerative cooling channels." },
  { id: "annulus", label: "Combustion annulus", color: "#efb552", purpose: "The narrow annular gas path in which the detonation wave travels circumferentially." },
  { id: "centerbody", label: "Centerbody", color: "#d9b57a", purpose: "Forms the inner annulus wall and guides the products toward the exhaust." },
  { id: "nozzle", label: "Nozzle / exhaust", color: "#687f86", purpose: "Expands and directs the combustion products downstream." },
];

const PART_LABELS = Object.fromEntries(PARTS.map((part) => [part.id, part.label])) as Record<Exclude<PartId, "all">, string>;

function entered(value: number, unit: string, digits = 1) {
  return Number.isFinite(value) ? `${value.toFixed(digits)} ${unit}` : "Not entered";
}

function partValue(design: EngineDesign, part: PartId) {
  const build = design.build;
  if (part === "plenum") return `${entered(design.plenumVolumeCm3, "cm³", 0)} · ${build?.feedSystem ?? "Feed system not defined"}`;
  if (part === "injector") return `${Number.isFinite(design.injectorCount) ? Math.round(design.injectorCount) : "Not entered"} injectors · ${design.injectorType}`;
  if (part === "outer-jacket") return build?.outerWallMaterial ?? "Material not defined";
  if (part === "cooling") return build?.coolingMethod === "Regenerative" ? `${build.coolingChannelCount} channels · ${entered(build.coolingChannelWidthMm, "mm", 2)} × ${entered(build.coolingChannelDepthMm, "mm", 2)} · ${build.coolant}` : `${build?.coolingMethod ?? "Not defined"} · no regenerative channel geometry`;
  if (part === "hot-wall") return build ? `${build.hotWallMaterial} · ${entered(build.wallThicknessMm, "mm", 2)} wall · ${build.hotWallCoating} coating` : "Material not defined";
  if (part === "annulus") return `${entered(0.5 * (design.annulusOuterDiameterMm - design.annulusInnerDiameterMm), "mm", 2)} radial gap · ${entered(design.chamberLengthMm, "mm", 0)} length`;
  if (part === "centerbody") return build?.centerbodyMaterial ?? "Material not defined";
  if (part === "nozzle") return `${build?.nozzleMaterial ?? "Material not defined"} · ${design.exhaustConfiguration}`;
  return "Click a component to inspect it.";
}

function makeMaterial(color: number, opacity = 1, metalness = 0.25, roughness = 0.55) {
  return new THREE.MeshStandardMaterial({ color, opacity, transparent: opacity < 1, metalness, roughness, side: THREE.DoubleSide, depthWrite: opacity >= 1 });
}

function tagMesh(mesh: THREE.Mesh, partId: Exclude<PartId, "all">) {
  mesh.userData.partId = partId;
  const material = mesh.material as THREE.MeshStandardMaterial;
  material.userData.baseOpacity = material.opacity;
  material.userData.baseColor = material.color.getHex();
  material.userData.baseDepthWrite = material.depthWrite;
  return mesh;
}

function RdeAssemblyCanvas({ design, selectedPart, viewPreset, viewRequest, onSelect, onHover }: {
  design: EngineDesign;
  selectedPart: PartId;
  viewPreset: ViewPreset;
  viewRequest: number;
  onSelect: (part: PartId) => void;
  onHover: (part: Exclude<PartId, "all"> | null) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const partGroupsRef = useRef(new Map<Exclude<PartId, "all">, THREE.Group>());
  const modelRef = useRef<THREE.Group | null>(null);
  const isRegenerative = design.build?.coolingMethod === "Regenerative";

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const partGroups = partGroupsRef.current;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf8fbf8);
    scene.fog = new THREE.Fog(0xf8fbf8, 22, 36);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    camera.position.set(10.5, 7.5, 11.5);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.tabIndex = 0;
    renderer.domElement.setAttribute("role", "application");
    renderer.domElement.setAttribute("aria-label", "Interactive three-dimensional RDE assembly. Drag to rotate, use the wheel or pinch to zoom, click a component to inspect it, or use the component buttons beside the model.");
    host.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 7;
    controls.maxDistance = 30;
    controls.target.set(0.25, 0, 0);
    controlsRef.current = controls;

    scene.add(new THREE.HemisphereLight(0xffffff, 0x52666c, 2.2));
    const keyLight = new THREE.DirectionalLight(0xffffff, 3.2);
    keyLight.position.set(-6, 10, 9);
    keyLight.castShadow = true;
    scene.add(keyLight);
    const rimLight = new THREE.DirectionalLight(0x8edced, 2.2);
    rimLight.position.set(9, 2, -8);
    scene.add(rimLight);

    const floor = new THREE.GridHelper(24, 24, 0x9eb5b7, 0xd8e5e4);
    floor.position.y = -3.25;
    (floor.material as THREE.Material).opacity = 0.42;
    (floor.material as THREE.Material).transparent = true;
    scene.add(floor);

    const model = new THREE.Group();
    model.rotation.x = -0.04;
    scene.add(model);
    modelRef.current = model;

    const addPart = (partId: Exclude<PartId, "all">, meshes: THREE.Mesh[]) => {
      const group = new THREE.Group();
      group.name = partId;
      for (const mesh of meshes) group.add(tagMesh(mesh, partId));
      model.add(group);
      partGroups.set(partId, group);
      return group;
    };

    const outerRadius = 2.46;
    const exactRatio = Number.isFinite(design.annulusInnerDiameterMm) && Number.isFinite(design.annulusOuterDiameterMm) && design.annulusOuterDiameterMm > 0
      ? design.annulusInnerDiameterMm / design.annulusOuterDiameterMm
      : 0.84;
    const centerRadius = Math.min(2.18, Math.max(1.55, outerRadius * exactRatio));
    const chamberLength = 6.4;
    const shellStart = Math.PI * 0.18;
    const shellArc = Math.PI * 1.55;
    const orientAlongX = (mesh: THREE.Mesh) => { mesh.rotation.z = -Math.PI / 2; return mesh; };

    const plenumShell = orientAlongX(new THREE.Mesh(new THREE.CylinderGeometry(2.72, 2.72, 0.92, 64, 1, false), makeMaterial(0x91aaad, 0.58, 0.45, 0.42)));
    plenumShell.position.x = -3.68;
    addPart("plenum", [plenumShell]);

    const injectorRing = new THREE.Mesh(new THREE.RingGeometry(centerRadius + 0.04, outerRadius - 0.03, 64), makeMaterial(0xb9434e, 1, 0.42, 0.38));
    injectorRing.rotation.y = Math.PI / 2;
    injectorRing.position.x = -3.18;
    const injectorMeshes: THREE.Mesh[] = [injectorRing];
    const visibleInjectors = Math.max(12, Math.min(32, Number.isFinite(design.injectorCount) ? Math.round(design.injectorCount / 4) : 20));
    for (let index = 0; index < visibleInjectors; index += 1) {
      const angle = index / visibleInjectors * Math.PI * 2;
      const radius = 0.5 * (centerRadius + outerRadius);
      const orifice = new THREE.Mesh(new THREE.SphereGeometry(0.065, 10, 8), makeMaterial(0xf0a13f, 1, 0.15, 0.45));
      orifice.position.set(-3.13, Math.cos(angle) * radius, Math.sin(angle) * radius);
      injectorMeshes.push(orifice);
    }
    addPart("injector", injectorMeshes);

    const outerShell = orientAlongX(new THREE.Mesh(new THREE.CylinderGeometry(2.82, 2.82, chamberLength, 64, 1, true, shellStart, shellArc), makeMaterial(0xb8c8c8, 0.62, 0.72, 0.3)));
    outerShell.position.x = 0.02;
    addPart("outer-jacket", [outerShell]);

    const hotWall = orientAlongX(new THREE.Mesh(new THREE.CylinderGeometry(outerRadius, outerRadius, chamberLength, 64, 1, true, shellStart, shellArc), makeMaterial(0xb87333, 1, 0.58, 0.33)));
    hotWall.position.x = 0.02;
    addPart("hot-wall", [hotWall]);

    const annulus = orientAlongX(new THREE.Mesh(new THREE.CylinderGeometry(0.5 * (outerRadius + centerRadius), 0.5 * (outerRadius + centerRadius), chamberLength - 0.12, 64, 1, true, shellStart, shellArc), makeMaterial(0xefb552, 0.3, 0.05, 0.78)));
    annulus.position.x = 0.02;
    addPart("annulus", [annulus]);

    const centerCylinder = orientAlongX(new THREE.Mesh(new THREE.CylinderGeometry(centerRadius, centerRadius, chamberLength - 0.15, 64, 1, false), makeMaterial(0xd9b57a, 1, 0.28, 0.5)));
    centerCylinder.position.x = -0.04;
    const centerCone = orientAlongX(new THREE.Mesh(new THREE.CylinderGeometry(0.08, centerRadius, 1.65, 64, 1, false), makeMaterial(0xd9b57a, 1, 0.28, 0.5)));
    centerCone.position.x = 3.92;
    addPart("centerbody", [centerCylinder, centerCone]);

    const nozzle = orientAlongX(new THREE.Mesh(new THREE.CylinderGeometry(3.35, 2.65, 2.0, 64, 1, true, shellStart, shellArc), makeMaterial(0x687f86, 0.9, 0.7, 0.28)));
    nozzle.position.x = 4.18;
    addPart("nozzle", [nozzle]);

    if (isRegenerative) {
      const coolingMeshes: THREE.Mesh[] = [];
      const channelRadius = 2.64;
      const channelCount = Math.max(12, Math.min(28, design.build?.coolingChannelCount ?? 18));
      for (let index = 0; index < channelCount; index += 1) {
        const angle = index / channelCount * shellArc + shellStart;
        const channel = orientAlongX(new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, chamberLength - 0.24, 8), makeMaterial(0x27a5c1, 1, 0.08, 0.32)));
        channel.position.set(0.02, Math.cos(angle) * channelRadius, Math.sin(angle) * channelRadius);
        coolingMeshes.push(channel);
      }
      for (const x of [-3.04, 3.08]) {
        const manifold = new THREE.Mesh(new THREE.TorusGeometry(channelRadius, 0.075, 10, 64, shellArc), makeMaterial(0x27a5c1, 1, 0.08, 0.32));
        manifold.rotation.y = Math.PI / 2;
        manifold.rotation.x = shellStart;
        manifold.position.x = x;
        coolingMeshes.push(manifold);
      }
      addPart("cooling", coolingMeshes);
    }

    const flowArrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(-4.7, -2.85, 0), 10.2, 0x2588a2, 0.34, 0.18);
    scene.add(flowArrow);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let pointerDown = { x: 0, y: 0 };
    const hitPart = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = (event.clientX - rect.left) / rect.width * 2 - 1;
      pointer.y = -(event.clientY - rect.top) / rect.height * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects([...partGroups.values()], true).find((item) => item.object.userData.partId);
      return (hit?.object.userData.partId as Exclude<PartId, "all"> | undefined) ?? null;
    };
    const pointerMove = (event: PointerEvent) => {
      const part = hitPart(event);
      renderer.domElement.style.cursor = part ? "pointer" : "grab";
      onHover(part);
    };
    const pointerLeave = () => { renderer.domElement.style.cursor = "grab"; onHover(null); };
    const pointerDownHandler = (event: PointerEvent) => { pointerDown = { x: event.clientX, y: event.clientY }; };
    const pointerUp = (event: PointerEvent) => {
      if (Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > 5) return;
      onSelect(hitPart(event) ?? "all");
    };
    const keyDown = (event: KeyboardEvent) => {
      const axes: Record<string, [THREE.Vector3, number]> = {
        ArrowLeft: [new THREE.Vector3(0, 1, 0), 0.14],
        ArrowRight: [new THREE.Vector3(0, 1, 0), -0.14],
        ArrowUp: [new THREE.Vector3(1, 0, 0), 0.1],
        ArrowDown: [new THREE.Vector3(1, 0, 0), -0.1],
      };
      const action = axes[event.key];
      if (!action) return;
      event.preventDefault();
      camera.position.applyAxisAngle(action[0], action[1]);
      controls.update();
    };
    renderer.domElement.addEventListener("pointermove", pointerMove);
    renderer.domElement.addEventListener("pointerleave", pointerLeave);
    renderer.domElement.addEventListener("pointerdown", pointerDownHandler);
    renderer.domElement.addEventListener("pointerup", pointerUp);
    renderer.domElement.addEventListener("keydown", keyDown);

    const resize = () => {
      const width = Math.max(320, host.clientWidth);
      const height = Math.max(420, host.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);
    resize();

    let frame = 0;
    const animate = () => {
      controls.update();
      renderer.render(scene, camera);
      frame = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener("pointermove", pointerMove);
      renderer.domElement.removeEventListener("pointerleave", pointerLeave);
      renderer.domElement.removeEventListener("pointerdown", pointerDownHandler);
      renderer.domElement.removeEventListener("pointerup", pointerUp);
      renderer.domElement.removeEventListener("keydown", keyDown);
      scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => material.dispose());
      });
      renderer.dispose();
      renderer.domElement.remove();
      partGroups.clear();
      sceneRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
      modelRef.current = null;
    };
  }, [design.annulusInnerDiameterMm, design.annulusOuterDiameterMm, design.injectorCount, design.build?.coolingChannelCount, isRegenerative, onHover, onSelect]);

  useEffect(() => {
    const effectiveSelection = selectedPart !== "all" && partGroupsRef.current.has(selectedPart) ? selectedPart : "all";
    for (const [partId, group] of partGroupsRef.current) {
      group.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const material = object.material as THREE.MeshStandardMaterial;
        const baseOpacity = Number(material.userData.baseOpacity ?? 1);
        const isSelected = effectiveSelection === "all" || effectiveSelection === partId;
        material.opacity = isSelected ? baseOpacity : Math.min(0.08, baseOpacity);
        material.transparent = material.opacity < 1;
        material.depthWrite = isSelected ? Boolean(material.userData.baseDepthWrite) : false;
        material.color.setHex(Number(material.userData.baseColor));
        material.emissive.setHex(effectiveSelection === partId ? 0x184854 : 0x000000);
        material.emissiveIntensity = effectiveSelection === partId ? 0.32 : 0;
        material.needsUpdate = true;
      });
    }
  }, [selectedPart]);

  useEffect(() => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    if (viewPreset === "side") camera.position.set(0.6, 2.2, 15.8);
    else if (viewPreset === "head-end") camera.position.set(-15.8, 0.7, 0.4);
    else camera.position.set(10.5, 7.5, 11.5);
    controls.target.set(0.25, 0, 0);
    controls.update();
  }, [viewPreset, viewRequest]);

  return <div className="assembly-canvas-host" ref={hostRef}/>;
}

export function RdeAssembly3D({ design }: { design: EngineDesign }) {
  const [selectedPart, setSelectedPart] = useState<PartId>("all");
  const [hoveredPart, setHoveredPart] = useState<Exclude<PartId, "all"> | null>(null);
  const [viewPreset, setViewPreset] = useState<ViewPreset>("isometric");
  const [viewRequest, setViewRequest] = useState(0);
  const isRegenerative = design.build?.coolingMethod === "Regenerative";
  const displayedParts = useMemo(() => PARTS.map((part) => part.id === "cooling" && !isRegenerative ? {
    ...part,
    label: "Thermal management",
    color: "#98a8aa",
    purpose: `${design.build?.coolingMethod ?? "No method"} is recorded. No regenerative channels are drawn because this build does not use them.`,
  } : part), [design.build?.coolingMethod, isRegenerative]);
  const selectedDefinition = useMemo(() => displayedParts.find((part) => part.id === selectedPart) ?? null, [displayedParts, selectedPart]);

  function chooseView(view: ViewPreset) {
    setViewPreset(view);
    setViewRequest((current) => current + 1);
  }

  return <div className="interactive-assembly">
    <div className="assembly-view-toolbar">
      <div><strong>Explore the actual assembly</strong><span>Drag to rotate · wheel or pinch to zoom · click a colored component to identify it</span></div>
      <div aria-label="3D camera views">{(["isometric", "side", "head-end"] as const).map((view) => <button type="button" key={view} aria-pressed={viewPreset === view} onClick={() => chooseView(view)}>{view === "head-end" ? "Head-end" : view[0].toUpperCase() + view.slice(1)}</button>)}</div>
    </div>
    <div className="assembly-interactive-layout">
      <div className="assembly-viewport">
        <RdeAssemblyCanvas design={design} selectedPart={selectedPart} viewPreset={viewPreset} viewRequest={viewRequest} onSelect={setSelectedPart} onHover={setHoveredPart}/>
        <div className="assembly-orientation"><span>INJECTOR</span><i>Flow direction →</i><span>EXHAUST</span></div>
        {hoveredPart && <div className="assembly-hover-label">Click to inspect · {PART_LABELS[hoveredPart]}</div>}
        {!isRegenerative && <div className="assembly-thermal-note"><strong>{design.build?.coolingMethod ?? "Thermal management not defined"}</strong><span>No regenerative channels in this saved build</span></div>}
        <div className="assembly-axis-key"><span className="axis-x">X</span><span className="axis-y">Y</span><span className="axis-z">Z</span></div>
      </div>
      <aside className="assembly-inspector" aria-label="RDE component inspector">
        <div className="assembly-inspector-heading"><div><span>COMPONENT INSPECTOR</span><strong>{selectedDefinition?.label ?? "Complete assembly"}</strong></div>{selectedPart !== "all" && <button type="button" onClick={() => setSelectedPart("all")}>Show all</button>}</div>
        <p>{selectedDefinition?.purpose ?? "Select a component below or click the model. The selected part stays bright while the rest of the engine becomes transparent."}</p>
        <div className="assembly-part-buttons">
          {displayedParts.map((part) => <button type="button" key={part.id} className={selectedPart === part.id ? "selected" : ""} aria-pressed={selectedPart === part.id} onClick={() => setSelectedPart(part.id)}><i style={{ background: part.color }}/><span><strong>{part.label}</strong><small>{partValue(design, part.id)}</small></span></button>)}
        </div>
        <div className="assembly-selected-value"><span>ENTERED DEFINITION</span><strong>{partValue(design, selectedPart)}</strong></div>
      </aside>
    </div>
    <p className="assembly-boundary">Interactive geometry for understanding and preliminary design review. It is not production CAD and does not define tolerances, joints, manifolds, fasteners, seals, manufacturability, or structural life.</p>
  </div>;
}
