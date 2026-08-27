import type { EngineDesign, EngineRevision } from "./design-workspace.ts";

export const ENGINE_MANIFEST_SCHEMA = "kythros-engine-manifest";
export const ENGINE_MANIFEST_VERSION = 2;

function stableToken(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).padStart(7, "0");
}

function manifestInputs(design: EngineDesign) {
  const definition = { ...design };
  delete definition.revision;
  return definition;
}

export function engineManifestFingerprint(design: EngineDesign) {
  return `eng-${stableToken(JSON.stringify(manifestInputs(design)))}`;
}

export function normalizedEngineRevision(design: EngineDesign): EngineRevision {
  const fingerprint = engineManifestFingerprint(design);
  return {
    number: design.revision?.number && design.revision.number > 0 ? Math.floor(design.revision.number) : 1,
    createdAt: design.revision?.createdAt || "Legacy import",
    supersedesDesignId: design.revision?.supersedesDesignId ?? null,
    fingerprint,
  };
}

export function normalizeEngineDesign(design: EngineDesign): EngineDesign {
  return { ...design, build: design.build ? { ...design.build } : undefined, revision: normalizedEngineRevision(design) };
}

export function createEngineRevision(draft: EngineDesign, previous?: EngineDesign | null, createdAt = new Date().toISOString()): EngineDesign {
  if (!previous) {
    const initial = { ...draft, revision: { number: 1, createdAt, supersedesDesignId: null, fingerprint: "" } };
    return { ...initial, revision: { ...initial.revision!, fingerprint: engineManifestFingerprint(initial) } };
  }
  const previousRevision = normalizedEngineRevision(previous);
  const id = `${previous.id}-r${previousRevision.number + 1}-${stableToken(createdAt).slice(0, 4)}`;
  const next: EngineDesign = {
    ...draft,
    id,
    revision: {
      number: previousRevision.number + 1,
      createdAt,
      supersedesDesignId: previous.id,
      fingerprint: "",
    },
  };
  return { ...next, revision: { ...next.revision!, fingerprint: engineManifestFingerprint(next) } };
}

export function engineRevisionLabel(design: EngineDesign) {
  return `${design.name} · rev ${normalizedEngineRevision(design).number}`;
}

export function buildEngineManifest(design: EngineDesign, calculations: unknown, screening: unknown, operatingPointIds: string[]) {
  const normalized = normalizeEngineDesign(design);
  return {
    schema: ENGINE_MANIFEST_SCHEMA,
    formatVersion: ENGINE_MANIFEST_VERSION,
    exportedAt: new Date().toISOString(),
    engineRevision: {
      designId: normalized.id,
      ...normalized.revision,
    },
    definition: manifestInputs(normalized),
    calculatedFromInputs: calculations,
    preliminaryBuildScreening: screening,
    linkedOperatingPointIds: [...operatingPointIds],
    evidenceBoundary: "This immutable engine revision identifies the geometry, materials, cooling, feed, and operating range used by linked evidence. It is a preliminary definition, not manufacturing CAD, CFD, certification, or a validated operability prediction.",
  };
}
