import type { Signal } from "./rde-analysis.ts";

export type TimeUnit = "s" | "ms" | "us" | "ns";
export type PressureUnit = "Pa" | "kPa" | "MPa" | "bar" | "psi";

export type DelimitedTable = {
  fileName: string;
  delimiter: "," | "\t" | ";";
  headers: string[];
  rows: string[][];
  sourceRows: number;
};

export type ProbeColumnMapping = {
  label: string;
  columnIndex: number;
  unit: PressureUnit;
};

export type ImportMapping = {
  timeColumnIndex: number;
  timeUnit: TimeUnit;
  probes: ProbeColumnMapping[];
};

export type FileImportProvenance = {
  fileName: string;
  delimiter: "comma" | "tab" | "semicolon";
  timeColumn: string;
  timeUnit: TimeUnit;
  pressureColumns: Array<{ label: string; column: string; unit: PressureUnit }>;
  sourceRows: number;
  validRows: number;
  droppedRows: number;
};

export type ImportPreview = {
  headers: string[];
  rows: Array<{ timeMs: number; pressureMpa: number[] }>;
  durationMs: number;
  sampleRateKHz: number;
};

export type MappedProbeImport = {
  signals: Signal[];
  mapping: ImportMapping;
  provenance: FileImportProvenance;
  preview: ImportPreview;
  warnings: string[];
};

const TIME_FACTORS_MS: Record<TimeUnit, number> = { s: 1000, ms: 1, us: 0.001, ns: 0.000001 };
const PRESSURE_FACTORS_MPA: Record<PressureUnit, number> = {
  Pa: 0.000001,
  kPa: 0.001,
  MPa: 1,
  bar: 0.1,
  psi: 0.006894757293,
};

function splitDelimitedLine(line: string, delimiter: string) {
  const cells: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === delimiter && !quoted) {
      cells.push(value.trim());
      value = "";
    } else {
      value += character;
    }
  }
  cells.push(value.trim());
  return cells;
}

function delimiterFor(header: string): DelimitedTable["delimiter"] {
  const candidates = [",", "\t", ";"] as const;
  return candidates
    .map((delimiter) => ({ delimiter, count: splitDelimitedLine(header, delimiter).length }))
    .sort((left, right) => right.count - left.count)[0].delimiter;
}

function normalizedHeader(header: string) {
  return header.trim().toLowerCase().replace(/[\s\[\](){}]+/g, "_").replace(/_+/g, "_");
}

function guessedTimeUnit(header: string): TimeUnit {
  const value = normalizedHeader(header);
  if (/(^|_)ns($|_)/.test(value)) return "ns";
  if (/(^|_)(us|µs|microseconds?)($|_)/.test(value)) return "us";
  if (/(^|_)(ms|milliseconds?)($|_)/.test(value)) return "ms";
  return "s";
}

function guessedPressureUnit(header: string): PressureUnit {
  const value = normalizedHeader(header);
  if (/(^|_)mpa($|_)/.test(value)) return "MPa";
  if (/(^|_)kpa($|_)/.test(value)) return "kPa";
  if (/(^|_)bar($|_)/.test(value)) return "bar";
  if (/(^|_)psi($|_)/.test(value)) return "psi";
  return "Pa";
}

function isTimeHeader(header: string) {
  return /(^|_)(time|timestamp|t)($|_)/.test(normalizedHeader(header));
}

function isPressureHeader(header: string) {
  const value = normalizedHeader(header);
  return /(^|_)(p\d+|pt\d+|pressure|probe|sensor)($|_)/.test(value)
    || /(pressure|probe|sensor).*\d/.test(value);
}

export function parseDelimitedTable(text: string, fileName: string): DelimitedTable {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 33) throw new Error("The file needs a header and at least 32 data rows.");
  const delimiter = delimiterFor(lines[0]);
  const headers = splitDelimitedLine(lines[0], delimiter);
  if (headers.length < 4) throw new Error("The file needs one time column and at least three pressure columns.");
  if (headers.some((header) => !header.trim())) throw new Error("Every imported column needs a non-empty header.");
  return {
    fileName,
    delimiter,
    headers,
    rows: lines.slice(1).map((line) => splitDelimitedLine(line, delimiter)),
    sourceRows: lines.length - 1,
  };
}

export function suggestImportMapping(table: DelimitedTable, expectedProbeCount?: number): ImportMapping {
  const timeColumnIndex = Math.max(0, table.headers.findIndex(isTimeHeader));
  const candidates = table.headers
    .map((header, columnIndex) => ({ header, columnIndex }))
    .filter((item) => item.columnIndex !== timeColumnIndex && isPressureHeader(item.header));
  const count = Math.max(3, expectedProbeCount ?? candidates.length);
  const probes = Array.from({ length: count }, (_, index) => {
    const candidate = candidates[index];
    return {
      label: `P${index + 1}`,
      columnIndex: candidate?.columnIndex ?? -1,
      unit: guessedPressureUnit(candidate?.header ?? ""),
    };
  });
  return {
    timeColumnIndex,
    timeUnit: guessedTimeUnit(table.headers[timeColumnIndex] ?? ""),
    probes,
  };
}

function median(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function delimiterName(delimiter: DelimitedTable["delimiter"]): FileImportProvenance["delimiter"] {
  return delimiter === "," ? "comma" : delimiter === "\t" ? "tab" : "semicolon";
}

export function mapProbeTable(table: DelimitedTable, mapping: ImportMapping): MappedProbeImport {
  if (!Number.isInteger(mapping.timeColumnIndex) || !table.headers[mapping.timeColumnIndex]) {
    throw new Error("Choose the column containing acquisition time.");
  }
  if (mapping.probes.length < 3) throw new Error("Map at least three synchronized pressure probes.");
  const pressureIndices = mapping.probes.map((probe) => probe.columnIndex);
  if (pressureIndices.some((index) => !Number.isInteger(index) || !table.headers[index])) {
    throw new Error("Choose one source column for every pressure probe.");
  }
  if (pressureIndices.includes(mapping.timeColumnIndex)) throw new Error("The time column cannot also be used as a pressure probe.");
  if (new Set(pressureIndices).size !== pressureIndices.length) throw new Error("Each pressure probe must use a different source column.");

  const converted = table.rows.flatMap((row) => {
    const time = Number(row[mapping.timeColumnIndex]);
    const pressure = mapping.probes.map((probe) => Number(row[probe.columnIndex]));
    if (!Number.isFinite(time) || pressure.some((value) => !Number.isFinite(value))) return [];
    return [{
      timeMs: time * TIME_FACTORS_MS[mapping.timeUnit],
      pressureMpa: pressure.map((value, index) => value * PRESSURE_FACTORS_MPA[mapping.probes[index].unit]),
    }];
  }).sort((left, right) => left.timeMs - right.timeMs);

  if (converted.length < 32) throw new Error("Fewer than 32 rows remain after removing rows with missing or non-numeric mapped values.");
  for (let index = 1; index < converted.length; index += 1) {
    if (converted[index].timeMs <= converted[index - 1].timeMs) {
      throw new Error("Mapped time values must increase without duplicates.");
    }
  }

  const droppedRows = table.sourceRows - converted.length;
  const time = converted.map((row) => row.timeMs);
  const signals = mapping.probes.map((probe, probeIndex): Signal => ({
    name: `${table.fileName} · ${probe.label}`,
    time: [...time],
    pressure: converted.map((row) => row.pressureMpa[probeIndex]),
    sourceRows: table.sourceRows,
    droppedRows,
  }));
  const intervals = time.slice(1).map((value, index) => value - time[index]);
  const dtMs = median(intervals);
  const warnings: string[] = [];
  if (droppedRows) warnings.push(`${droppedRows} source row${droppedRows === 1 ? " was" : "s were"} omitted because at least one mapped value was missing or non-numeric.`);
  if (table.rows.some((row) => row.length !== table.headers.length)) warnings.push("At least one source row has a different number of fields than the header.");
  if (!warnings.length) warnings.push("All source rows contain finite values in the mapped columns.");

  return {
    signals,
    mapping,
    provenance: {
      fileName: table.fileName,
      delimiter: delimiterName(table.delimiter),
      timeColumn: table.headers[mapping.timeColumnIndex],
      timeUnit: mapping.timeUnit,
      pressureColumns: mapping.probes.map((probe) => ({
        label: probe.label,
        column: table.headers[probe.columnIndex],
        unit: probe.unit,
      })),
      sourceRows: table.sourceRows,
      validRows: converted.length,
      droppedRows,
    },
    preview: {
      headers: ["time (ms)", ...mapping.probes.map((probe) => `${probe.label} (MPa)`)],
      rows: converted.slice(0, 6),
      durationMs: time.at(-1)! - time[0],
      sampleRateKHz: 1 / Math.max(dtMs, 1e-12),
    },
    warnings,
  };
}
