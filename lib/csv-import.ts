import type { Signal } from "./rde-analysis.ts";

export type TimeUnit = "s" | "ms" | "us" | "ns";
export type PressureUnit = "Pa" | "kPa" | "MPa" | "bar" | "psi";

export type DelimitedTable = {
  name: string;
  delimiter: "," | ";" | "\t";
  headers: string[];
  rows: string[][];
  sourceRows: number;
  numericColumns: number[];
};

export type ProbeColumnMapping = {
  timeColumn: number;
  timeUnit: TimeUnit;
  pressureColumns: number[];
  pressureUnit: PressureUnit;
};

export type CsvImportSession = {
  table: DelimitedTable;
  mapping: ProbeColumnMapping;
  signals: Signal[];
  confirmed: boolean;
  warnings: string[];
};

const TIME_FACTOR_TO_MS: Record<TimeUnit, number> = { s: 1000, ms: 1, us: 0.001, ns: 0.000001 };
const PRESSURE_FACTOR_TO_MPA: Record<PressureUnit, number> = {
  Pa: 0.000001,
  kPa: 0.001,
  MPa: 1,
  bar: 0.1,
  psi: 0.006894757293168,
};

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/[\s()[\]{}-]+/g, "_").replace(/_+/g, "_");
}

function parseDelimitedLine(line: string, delimiter: string) {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === delimiter && !quoted) {
      cells.push(current.trim());
      current = "";
    } else {
      current += character;
    }
  }
  cells.push(current.trim());
  return cells;
}

function detectDelimiter(header: string): DelimitedTable["delimiter"] {
  const candidates = [",", "\t", ";"] as const;
  return candidates
    .map((delimiter) => ({ delimiter, count: parseDelimitedLine(header, delimiter).length }))
    .sort((left, right) => right.count - left.count)[0].delimiter;
}

function inferredTimeUnit(header: string): TimeUnit | null {
  const normalized = normalizeHeader(header);
  if (/(^|_)ns($|_)/.test(normalized)) return "ns";
  if (/(^|_)(us|µs)($|_)/.test(normalized)) return "us";
  if (/(^|_)ms($|_)/.test(normalized)) return "ms";
  if (/(^|_)(s|sec|seconds?)($|_)/.test(normalized)) return "s";
  return null;
}

function inferredPressureUnit(header: string): PressureUnit | null {
  const normalized = normalizeHeader(header);
  if (/(^|_)mpa($|_)/.test(normalized)) return "MPa";
  if (/(^|_)kpa($|_)/.test(normalized)) return "kPa";
  if (/(^|_)pa($|_)/.test(normalized)) return "Pa";
  if (/(^|_)bar($|_)/.test(normalized)) return "bar";
  if (/(^|_)psi($|_)/.test(normalized)) return "psi";
  return null;
}

export function inspectDelimitedText(text: string, name: string): DelimitedTable {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 33) throw new Error("The file needs one header row and at least 32 data rows.");
  const delimiter = detectDelimiter(lines[0]);
  const headers = parseDelimitedLine(lines[0], delimiter);
  if (headers.length < 2) throw new Error("The file must contain at least two columns.");
  const rows = lines.slice(1).map((line) => parseDelimitedLine(line, delimiter));
  const sample = rows.slice(0, 250);
  const numericColumns = headers.flatMap((_, column) => {
    const present = sample.filter((row) => row[column] !== undefined && row[column] !== "");
    const numeric = present.filter((row) => Number.isFinite(Number(row[column])));
    return present.length && numeric.length / present.length >= 0.9 ? [column] : [];
  });
  if (numericColumns.length < 2) throw new Error("Kythros could not find at least two mostly numeric columns.");
  return { name, delimiter, headers, rows, sourceRows: rows.length, numericColumns };
}

export function suggestProbeMapping(table: DelimitedTable, probeCount: number): ProbeColumnMapping {
  const normalized = table.headers.map(normalizeHeader);
  const namedTime = normalized.findIndex((header) => /(^|_)(time|timestamp|t)($|_)/.test(header));
  const timeColumn = namedTime >= 0 && table.numericColumns.includes(namedTime) ? namedTime : table.numericColumns[0];
  const pressureCandidates = table.numericColumns.filter((column) => column !== timeColumn).sort((left, right) => {
    const leftHeader = normalized[left];
    const rightHeader = normalized[right];
    const leftNumber = Number(leftHeader.match(/(?:p|probe|sensor|pressure)_?(\d+)/)?.[1] ?? Number.MAX_SAFE_INTEGER);
    const rightNumber = Number(rightHeader.match(/(?:p|probe|sensor|pressure)_?(\d+)/)?.[1] ?? Number.MAX_SAFE_INTEGER);
    return leftNumber - rightNumber || left - right;
  });
  if (pressureCandidates.length < probeCount) {
    throw new Error(`The file has ${pressureCandidates.length} usable pressure columns, but ${probeCount} probe locations are defined.`);
  }
  const pressureColumns = pressureCandidates.slice(0, probeCount);
  const pressureUnits = pressureColumns.map((column) => inferredPressureUnit(table.headers[column])).filter(Boolean) as PressureUnit[];
  return {
    timeColumn,
    timeUnit: inferredTimeUnit(table.headers[timeColumn]) ?? "ms",
    pressureColumns,
    pressureUnit: pressureUnits[0] ?? "MPa",
  };
}

export function mapTableToSignals(table: DelimitedTable, mapping: ProbeColumnMapping): { signals: Signal[]; warnings: string[] } {
  if (!table.numericColumns.includes(mapping.timeColumn)) throw new Error("The selected time column is not numeric.");
  if (mapping.pressureColumns.length < 3) throw new Error("Map at least three pressure probes.");
  if (new Set(mapping.pressureColumns).size !== mapping.pressureColumns.length) throw new Error("Each probe must map to a different pressure column.");
  if (mapping.pressureColumns.includes(mapping.timeColumn)) throw new Error("The time column cannot also be used as pressure.");
  const timeFactor = TIME_FACTOR_TO_MS[mapping.timeUnit];
  const pressureFactor = PRESSURE_FACTOR_TO_MPA[mapping.pressureUnit];
  const parsed = table.rows.flatMap((row, sourceIndex) => {
    const time = Number(row[mapping.timeColumn]);
    const pressure = mapping.pressureColumns.map((column) => Number(row[column]));
    return Number.isFinite(time) && pressure.every(Number.isFinite)
      ? [{ time: time * timeFactor, pressure: pressure.map((value) => value * pressureFactor), sourceIndex }]
      : [];
  }).sort((left, right) => left.time - right.time);
  if (parsed.length < 32) throw new Error("Fewer than 32 complete numeric rows remain after applying the column mapping.");
  const warnings: string[] = [];
  const dropped = table.sourceRows - parsed.length;
  if (dropped) warnings.push(`${dropped} incomplete or non-numeric row${dropped === 1 ? " was" : "s were"} excluded.`);
  const duplicateTimes = parsed.slice(1).filter((row, index) => row.time === parsed[index].time).length;
  if (duplicateTimes) throw new Error(`${duplicateTimes} duplicate timestamp${duplicateTimes === 1 ? " was" : "s were"} found after unit conversion.`);
  const signals = mapping.pressureColumns.map((column, probe) => ({
    name: `${table.name} · P${probe + 1} (${table.headers[column]})`,
    time: parsed.map((row) => row.time),
    pressure: parsed.map((row) => row.pressure[probe]),
    sourceRows: table.sourceRows,
    droppedRows: dropped,
  }));
  return { signals, warnings };
}

export function createImportSession(text: string, name: string, probeCount: number): CsvImportSession {
  const table = inspectDelimitedText(text, name);
  const mapping = suggestProbeMapping(table, probeCount);
  const { signals, warnings } = mapTableToSignals(table, mapping);
  const explicitTimeUnit = inferredTimeUnit(table.headers[mapping.timeColumn]);
  const explicitPressureUnits = mapping.pressureColumns.map((column) => inferredPressureUnit(table.headers[column]));
  if (!explicitTimeUnit) warnings.push("Time units were not present in the header; confirm the selected unit before analysis.");
  if (explicitPressureUnits.some((unit) => !unit)) warnings.push("Pressure units were not present in every mapped header; confirm the selected unit before analysis.");
  if (new Set(explicitPressureUnits.filter(Boolean)).size > 1) warnings.push("Mapped pressure headers contain mixed units; choose one unit only if the exported numeric values actually share it.");
  return { table, mapping, signals, confirmed: false, warnings };
}

export function updateImportMapping(session: CsvImportSession, mapping: ProbeColumnMapping): CsvImportSession {
  const { signals, warnings } = mapTableToSignals(session.table, mapping);
  return { ...session, mapping, signals, warnings, confirmed: false };
}

export function confirmImportMapping(session: CsvImportSession): CsvImportSession {
  const { signals, warnings } = mapTableToSignals(session.table, session.mapping);
  return { ...session, signals, warnings, confirmed: true };
}

