"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { EngineDesign } from "@/lib/design-workspace";

type PartId = "all" | "plenum" | "injector" | "outer-jacket" | "cooling" | "hot-wall" | "annulus" | "detonation" | "centerbody" | "nozzle";
type ViewPreset = "isometric" | "side" | "head-end";

const PARTS: Array<{ id: Exclude<PartId, "all">; label: string; color: string; purpose: string }> = [
  { id: "plenum", label: "Feed plenum", color: "#8aa7aa", purpose: "Distributes the incoming propellants before injection." },
  { id: "injector", label: "Injector face", color: "#c84f58", purpose: "Meters and injects the fresh mixture into the annulus." },
  { id: "outer-jacket", label: "Outer jacket", color: "#b8c8c8", purpose: "Provides the outer pressure structure around the hot wall and cooling circuit." },
  { id: "cooling", label: "Cooling circuit", color: "#27a5c1", purpose: "Carries coolant through axial regenerative channels around the chamber." },
  { id: "hot-wall", label: "Hot-wall liner", color: "#b87333", purpose: "Separates the hot gas path from the regenerative cooling channels." },
  { id: "annulus", label: "Combustion annulus", color: "#efb552", purpose: "The narrow annular gas path in which the detonation wave travels circumferentially." },
  { id: "detonation", label: "Rotating detonation front", color: "#e33f49", purpose: "A localized leading shock and reaction zone that spans the annular gap and sweeps circumferentially. A separate ignition system must establish it; its visible thickness and speed are exaggerated." },
  { id: "centerbody", label: "Centerbody", color: "#d9b57a", purpose: "Forms the inner annulus wall and guides the products toward the exhaust." },
  { id: "nozzle", label: "Nozzle / exhaust", color: "#687f86", purpose: "Expands and directs the combustion products downstream." },
];

const PART_LABELS = Object.fromEntries(PARTS.map((part) => [part.id, part.label])) as Record<Exclude<PartId, "all">, string>;

function entered(value: number, unit: string, digits = 1) {
  return Number.isFinite(value) ? `${value.toFixed(digits)} ${unit}` : "Not entered";
}

function partValue(design: EngineDesign, part: PartId) {
  const build = design.build;
  if (part === "plenum") return design.application === "Air-breathing" ? `${build?.airInletArchitecture ?? "Air inlet not defined"} · ${entered(design.plenumVolumeCm3, "cm³", 0)} entered manifold` : `${entered(design.plenumVolumeCm3, "cm³", 0)} · ${build?.feedSystem ?? "Feed system not defined"}`;
  if (part === "injector") return design.application === "Air-breathing" ? `${build?.airFuelPreparation ?? "Fuel-air preparation not defined"} · ${Number.isFinite(design.injectorCount) ? Math.round(design.injectorCount) : "Not entered"} fuel injection sites` : `${Number.isFinite(design.injectorCount) ? Math.round(design.injectorCount) : "Not entered"} injectors · ${design.injectorType}`;
  if (part === "outer-jacket") return build?.outerWallMaterial ?? "Material not defined";
  if (part === "cooling") {
    if (build?.coolingMethod === "Regenerative") return `${build.coolingChannelCount} channels · ${entered(build.coolingChannelWidthMm, "mm", 2)} × ${entered(build.coolingChannelDepthMm, "mm", 2)} · ${build.coolant}`;
    if (build?.coolingMethod === "Film") return `${build.filmCoolant || "Coolant not entered"} · ${entered(build.filmMassFlowKgS, "kg/s", 3)} · ${build.filmInjectionGeometry || "Delivery not entered"} at ${build.filmInjectionLocation || "location not entered"}`;
    if (build?.coolingMethod === "Heat sink") return `${entered(build.heatSinkMassKg, "kg", 2)} thermal mass · ${entered(build.heatSinkInitialTemperatureK, "K", 0)} to ${entered(build.heatSinkMaximumTemperatureK, "K", 0)}`;
    if (build?.coolingMethod === "Ablative") return `${build.ablativeMaterial || "Material not entered"} · ${entered(build.ablativeThicknessMm, "mm", 2)} liner`;
    return "Thermal-management hardware not defined";
  }
  if (part === "hot-wall") return build ? `${build.hotWallMaterial} · ${entered(build.wallThicknessMm, "mm", 2)} wall · ${build.hotWallCoating} coating` : "Material not defined";
  if (part === "annulus") return `${entered(0.5 * (design.annulusOuterDiameterMm - design.annulusInnerDiameterMm), "mm", 2)} radial gap · ${entered(design.chamberLengthMm, "mm", 0)} length`;
  if (part === "detonation") return `Conceptual single wave · startup by ${build?.ignitionSystem ?? "ignition system not defined"} · thickness and speed exaggerated`;
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

function RdeAssemblyCanvas({ design, selectedPart, viewPreset, viewRequest, animationPaused, onSelect, onHover }: {
  design: EngineDesign;
  selectedPart: PartId;
  viewPreset: ViewPreset;
  viewRequest: number;
  animationPaused: boolean;
  onSelect: (part: PartId) => void;
  onHover: (part: Exclude<PartId, "all"> | null) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const partGroupsRef = useRef(new Map<Exclude<PartId, "all">, THREE.Group>());
  const modelRef = useRef<THREE.Group | null>(null);
  const animationPausedRef = useRef(animationPaused);
  const isRegenerative = design.build?.coolingMethod === "Regenerative";
  const isAirBreathing = design.application === "Air-breathing";

  useEffect(() => { animationPausedRef.current = animationPaused; }, [animationPaused]);

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

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    } catch {
      sceneRef.current = null;
      cameraRef.current = null;
      partGroups.clear();
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.tabIndex = 0;
    renderer.domElement.setAttribute("role", "application");
    renderer.domElement.setAttribute("aria-label", "Interactive three-dimensional RDE assembly. Drag to rotate, use the wheel or pinch to zoom, click a component to inspect it, or use the component buttons beside the model.");
    host.appendChild(renderer.domElement);
    host.classList.add("webgl-ready");

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

    if (isAirBreathing) {
      const inletShell = orientAlongX(new THREE.Mesh(new THREE.CylinderGeometry(2.72, 2.72, 2.3, 64, 1, true, shellStart, shellArc), makeMaterial(0x7da9b2, 0.72, 0.32, 0.4)));
      inletShell.position.x = -4.26;
      const inletLip = new THREE.Mesh(new THREE.TorusGeometry(2.72, 0.11, 12, 64, shellArc), makeMaterial(0x4e7f8c, 0.95, 0.38, 0.34));
      inletLip.rotation.y = Math.PI / 2;
      inletLip.rotation.x = shellStart;
      inletLip.position.x = -5.4;
      const inletAnnulus = new THREE.Mesh(new THREE.RingGeometry(centerRadius + 0.04, 2.69, 64, 1, shellStart, shellArc), makeMaterial(0x9fd5df, 0.28, 0.05, 0.55));
      inletAnnulus.rotation.y = Math.PI / 2;
      inletAnnulus.position.x = -5.38;
      addPart("plenum", [inletShell, inletLip, inletAnnulus]);
    } else {
      const plenumShell = orientAlongX(new THREE.Mesh(new THREE.CylinderGeometry(2.72, 2.72, 0.92, 64, 1, false), makeMaterial(0x91aaad, 0.58, 0.45, 0.42)));
      plenumShell.position.x = -3.68;
      addPart("plenum", [plenumShell]);
    }

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

    const enteredAblativeThickness = Number.isFinite(design.build?.ablativeThicknessMm) ? design.build!.ablativeThicknessMm : 4;
    const ablativeVisualInset = Math.min(0.28, Math.max(0.08, enteredAblativeThickness / 45));
    const gasPathOuterRadius = design.build?.coolingMethod === "Ablative" ? outerRadius - ablativeVisualInset - 0.03 : outerRadius - 0.04;
    const waveStartAngle = shellStart + shellArc * 0.32;
    const leadingSheet = new THREE.Mesh(new THREE.RingGeometry(centerRadius + 0.035, gasPathOuterRadius, 48, 1, waveStartAngle, 0.105), makeMaterial(0xe33f49, 1, 0.04, 0.22));
    leadingSheet.rotation.y = Math.PI / 2;
    leadingSheet.position.x = -1.55;
    const reactionSheet = new THREE.Mesh(new THREE.RingGeometry(centerRadius + 0.055, gasPathOuterRadius - 0.02, 48, 1, waveStartAngle - 0.18, 0.22), makeMaterial(0xf08b37, 0.62, 0.02, 0.28));
    reactionSheet.rotation.y = Math.PI / 2;
    reactionSheet.position.x = -1.25;
    const detonationGroup = addPart("detonation", [reactionSheet, leadingSheet]);
    detonationGroup.rotation.x = 0.35;

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
    } else if (design.build?.coolingMethod === "Film") {
      const filmMeshes: THREE.Mesh[] = [];
      const filmLayer = orientAlongX(new THREE.Mesh(new THREE.CylinderGeometry(outerRadius - 0.075, outerRadius - 0.075, chamberLength - 0.3, 64, 1, true, shellStart, shellArc), makeMaterial(0x2588c7, 0.72, 0.04, 0.24)));
      filmLayer.position.x = 0.1;
      filmMeshes.push(filmLayer);
      const injectionX = design.build.filmInjectionLocation === "Mid-chamber" ? 0 : design.build.filmInjectionLocation === "Chamber inlet" ? -2.45 : -3.02;
      const filmRing = new THREE.Mesh(new THREE.TorusGeometry(outerRadius - 0.1, 0.075, 10, 64, shellArc), makeMaterial(0x187eac, 1, 0.05, 0.25));
      filmRing.rotation.y = Math.PI / 2;
      filmRing.rotation.x = shellStart;
      filmRing.position.x = injectionX;
      filmMeshes.push(filmRing);
      if (design.build.filmInjectionGeometry === "Discrete holes") {
        for (let index = 0; index < 20; index += 1) {
          const angle = index / 20 * shellArc + shellStart;
          const hole = new THREE.Mesh(new THREE.SphereGeometry(0.065, 10, 8), makeMaterial(0x76d7ef, 1, 0.02, 0.2));
          hole.position.set(injectionX, Math.cos(angle) * (outerRadius - 0.1), Math.sin(angle) * (outerRadius - 0.1));
          filmMeshes.push(hole);
        }
      }
      addPart("cooling", filmMeshes);
    } else if (design.build?.coolingMethod === "Heat sink") {
      const heatSinkShell = orientAlongX(new THREE.Mesh(new THREE.CylinderGeometry(2.62, 2.62, chamberLength - 0.18, 64, 1, true, shellStart, shellArc), makeMaterial(0xd78a2f, 0.9, 0.65, 0.32)));
      heatSinkShell.position.x = 0.02;
      const heatSinkBandInlet = new THREE.Mesh(new THREE.TorusGeometry(2.62, 0.12, 12, 64, shellArc), makeMaterial(0xb8681f, 1, 0.72, 0.28));
      heatSinkBandInlet.rotation.y = Math.PI / 2;
      heatSinkBandInlet.rotation.x = shellStart;
      heatSinkBandInlet.position.x = -2.9;
      const heatSinkBandExit = heatSinkBandInlet.clone();
      heatSinkBandExit.position.x = 2.95;
      addPart("cooling", [heatSinkShell, heatSinkBandInlet, heatSinkBandExit]);
    } else if (design.build?.coolingMethod === "Ablative") {
      const visualInset = ablativeVisualInset;
      const ablativeLiner = orientAlongX(new THREE.Mesh(new THREE.CylinderGeometry(outerRadius - visualInset, outerRadius - visualInset, chamberLength - 0.12, 64, 1, true, shellStart, shellArc), makeMaterial(0xa83e52, 0.96, 0.08, 0.72)));
      ablativeLiner.position.x = 0.02;
      const ablativeFaceInnerRadius = Math.min(centerRadius + 0.04, outerRadius - visualInset - 0.04);
      const ablativeFace = new THREE.Mesh(new THREE.RingGeometry(ablativeFaceInnerRadius, outerRadius - visualInset, 64, 1, shellStart, shellArc), makeMaterial(0xc75f70, 1, 0.08, 0.68));
      ablativeFace.rotation.y = Math.PI / 2;
      ablativeFace.position.x = -3.08;
      addPart("cooling", [ablativeLiner, ablativeFace]);
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

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let previousTime = performance.now();
    let frame = 0;
    const animate = (time = performance.now()) => {
      const elapsed = Math.min(50, Math.max(0, time - previousTime));
      previousTime = time;
      if (!animationPausedRef.current && !reduceMotion) detonationGroup.rotation.x += elapsed * 0.00038;
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
      host.classList.remove("webgl-ready");
      partGroups.clear();
      sceneRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
      modelRef.current = null;
    };
  }, [design.application, design.annulusInnerDiameterMm, design.annulusOuterDiameterMm, design.injectorCount, design.build, isAirBreathing, isRegenerative, onHover, onSelect]);

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

  return <div className="assembly-canvas-host" ref={hostRef}>
    <div className="assembly-webgl-fallback" role="status">
      <span>3D VIEW UNAVAILABLE</span>
      <strong>The interactive model could not start in this browser</strong>
      <p>The build definition, dimensions, materials, cooling method, and calculations remain available. Use the component inspector beside this panel or open Kythros in a WebGL-enabled browser to rotate the assembly.</p>
    </div>
  </div>;
}

export function RdeAssembly3D({ design, animationPaused = false }: { design: EngineDesign; animationPaused?: boolean }) {
  const [selectedPart, setSelectedPart] = useState<PartId>("all");
  const [hoveredPart, setHoveredPart] = useState<Exclude<PartId, "all"> | null>(null);
  const [viewPreset, setViewPreset] = useState<ViewPreset>("isometric");
  const [viewRequest, setViewRequest] = useState(0);
  const thermalMethod = design.build?.coolingMethod ?? "Not defined";
  const isRegenerative = thermalMethod === "Regenerative";
  const isAirBreathing = design.application === "Air-breathing";
  const thermalPresentation = useMemo(() => {
    if (thermalMethod === "Film") return { label: "Film cooling layer", color: "#2588c7", purpose: "Shows the entered film injection feature and the protective wall layer. Effectiveness is still an entered assumption." };
    if (thermalMethod === "Heat sink") return { label: "Heat-sink thermal mass", color: "#d78a2f", purpose: "Shows the entered thermal-mass shell that absorbs sensible heat during a limited exposure." };
    if (thermalMethod === "Ablative") return { label: "Ablative liner", color: "#a83e52", purpose: "Shows the entered sacrificial liner on the hot-gas side. It does not predict recession or bond-line temperature." };
    if (thermalMethod === "Not defined") return { label: "Thermal management", color: "#98a8aa", purpose: "No thermal-management hardware is defined for this saved build." };
    return { label: "Regenerative channels", color: "#27a5c1", purpose: "Carries coolant through the entered axial channels and manifolds around the chamber." };
  }, [thermalMethod]);
  const displayedParts = useMemo(() => PARTS.map((part) => {
    if (part.id === "cooling") return { ...part, ...thermalPresentation };
    if (isAirBreathing && part.id === "plenum") return { ...part, label: "Air inlet / annular feed", purpose: "Delivers air from the selected upstream architecture to the annular combustor. The external inlet or compressor is not modeled." };
    if (isAirBreathing && part.id === "injector") return { ...part, label: "Fuel injection / mixing", purpose: design.build?.airFuelPreparation === "Premixed upstream" ? "Represents the entered upstream premixing architecture and the annular chamber inlet." : "Introduces fuel into the air stream through the entered injection architecture." };
    return part;
  }), [design.build?.airFuelPreparation, isAirBreathing, thermalPresentation]);
  const selectedDefinition = useMemo(() => displayedParts.find((part) => part.id === selectedPart) ?? null, [displayedParts, selectedPart]);

  function chooseView(view: ViewPreset) {
    setViewPreset(view);
    setViewRequest((current) => current + 1);
  }

  return <div className="interactive-assembly">
    <div className="assembly-view-toolbar">
      <div><strong>Explore the {isAirBreathing ? "air-breathing RDE" : "rocket RDRE"} assembly</strong><span>Drag to rotate · wheel or pinch to zoom · click a colored component to identify it</span></div>
      <div aria-label="3D camera views">{(["isometric", "side", "head-end"] as const).map((view) => <button type="button" key={view} aria-pressed={viewPreset === view} onClick={() => chooseView(view)}>{view === "head-end" ? "Head-end" : view[0].toUpperCase() + view.slice(1)}</button>)}</div>
    </div>
    <div className="assembly-interactive-layout">
      <div className="assembly-viewport">
        <RdeAssemblyCanvas design={design} selectedPart={selectedPart} viewPreset={viewPreset} viewRequest={viewRequest} animationPaused={animationPaused} onSelect={setSelectedPart} onHover={setHoveredPart}/>
        <div className="assembly-orientation"><span>{isAirBreathing ? "AIR INLET" : "INJECTOR"}</span><i><span>FLOW DIRECTION</span></i><span>EXHAUST</span></div>
        {hoveredPart && <div className="assembly-hover-label">Click to inspect · {displayedParts.find((part) => part.id === hoveredPart)?.label ?? PART_LABELS[hoveredPart]}</div>}
        <div className="assembly-wave-note"><strong>Red wedge: rotating detonation front</strong><span>Localized single-wave schematic · visible thickness and speed exaggerated</span></div>
        {!isRegenerative && <div className={`assembly-thermal-note method-${thermalMethod.toLowerCase().replace(" ", "-")}`}><strong>{thermalPresentation.label}</strong><span>{thermalMethod === "Film" ? "Blue wall film and entered injection feature" : thermalMethod === "Heat sink" ? "Amber thermal-mass shell" : thermalMethod === "Ablative" ? "Magenta sacrificial hot-side liner" : "No cooling hardware defined"}</span></div>}
        <div className="assembly-axis-key" role="img" aria-label="Model orientation axes: X, Y, and Z"><svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="25" cy="38" r="2.5"/><path className="axis-x" d="M25 38 L47 30 M47 30 L40 29 M47 30 L42 35"/><path className="axis-z" d="M25 38 L25 14 M25 14 L21 20 M25 14 L29 20"/><path className="axis-y" d="M25 38 L43 51 M43 51 L36 50 M43 51 L40 44"/><text className="axis-x" x="51" y="31">X</text><text className="axis-z" x="22" y="11">Z</text><text className="axis-y" x="47" y="57">Y</text></svg></div>
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
