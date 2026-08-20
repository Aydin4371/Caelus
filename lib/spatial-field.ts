export type WallFieldQuantity = "wallHeatFluxMWm2" | "wallTemperatureK";

export type WallFieldSample = {
  axialMm: number;
  angleDeg: number;
  value: number;
};

export type WallField = {
  quantity: WallFieldQuantity;
  samples: WallFieldSample[];
};

export type WallFieldImport = {
  fileName: string;
  sourceRows: number;
  validRows: number;
  droppedRows: number;
  axialColumn: string;
  angleColumn: string;
  heatFluxColumn: string | null;
  temperatureColumn: string | null;
  fields: WallField[];
};

export type WallFieldMapping = {
  axialColumnIndex: number;
  axialUnit: "m" | "cm" | "mm";
  angleColumnIndex: number;
  angleUnit: "deg" | "rad";
  heatFluxColumnIndex: number;
  heatFluxUnit: "W/m²" | "kW/m²" | "MW/m²";
  temperatureColumnIndex: number;
  temperatureUnit: "K" | "°C";
};

export type SpatialTable = {
  fileName: string;
  delimiter: "," | "\t" | ";";
  headers: string[];
  rows: string[][];
};

const AXIAL_FACTORS_MM = { m: 1000, cm: 10, mm: 1 } as const;
const HEAT_FACTORS_MW_M2 = { "W/m²": 1e-6, "kW/m²": 1e-3, "MW/m²": 1 } as const;

function splitLine(line: string, delimiter: string) {
  const cells: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') { value += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === delimiter && !quoted) { cells.push(value.trim()); value = ""; }
    else value += character;
  }
  cells.push(value.trim());
  return cells;
}

function normalized(header: string) {
  return header.toLowerCase().replace(/[\s\[\](){}]+/g, "_").replace(/_+/g, "_");
}

function findHeader(headers: string[], pattern: RegExp) {
  return headers.findIndex((header) => pattern.test(normalized(header)));
}

export function parseSpatialTable(text: string, fileName: string): SpatialTable {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 5) throw new Error("The wall-field file needs a header and at least four spatial samples.");
  const delimiter = ([",", "\t", ";"] as const)
    .map((candidate) => ({ candidate, count: splitLine(lines[0], candidate).length }))
    .sort((left, right) => right.count - left.count)[0].candidate;
  const headers = splitLine(lines[0], delimiter);
  if (headers.length < 3) throw new Error("The wall-field file needs axial position, circumferential angle, and at least one measured quantity.");
  return { fileName, delimiter, headers, rows: lines.slice(1).map((line) => splitLine(line, delimiter)) };
}

export function suggestWallFieldMapping(table: SpatialTable): WallFieldMapping {
  const axialColumnIndex = findHeader(table.headers, /(^|_)(axial|x|z|distance|position)($|_)/);
  const angleColumnIndex = findHeader(table.headers, /(^|_)(angle|theta|circumferential|azimuth)($|_)/);
  const heatFluxColumnIndex = findHeader(table.headers, /(heat.*flux|wall.*flux|(^|_)q($|_))/);
  const temperatureColumnIndex = findHeader(table.headers, /(wall.*temp|temperature|(^|_)temp($|_))/);
  const axialHeader = normalized(table.headers[axialColumnIndex] ?? "");
  const angleHeader = normalized(table.headers[angleColumnIndex] ?? "");
  const heatHeader = normalized(table.headers[heatFluxColumnIndex] ?? "");
  const temperatureHeader = normalized(table.headers[temperatureColumnIndex] ?? "");
  return {
    axialColumnIndex,
    axialUnit: /(^|_)cm($|_)/.test(axialHeader) ? "cm" : /(^|_)m($|_)/.test(axialHeader) && !/(^|_)mm($|_)/.test(axialHeader) ? "m" : "mm",
    angleColumnIndex,
    angleUnit: /rad/.test(angleHeader) ? "rad" : "deg",
    heatFluxColumnIndex,
    heatFluxUnit: /(^|_)kw/.test(heatHeader) ? "kW/m²" : /(^|_)w/.test(heatHeader) && !/(^|_)mw/.test(heatHeader) ? "W/m²" : "MW/m²",
    temperatureColumnIndex,
    temperatureUnit: /(^|_)(c|degc|celsius)($|_)/.test(temperatureHeader) ? "°C" : "K",
  };
}

function normalizedAngle(value: number) {
  return ((value % 360) + 360) % 360;
}

export function mapWallFieldTable(table: SpatialTable, mapping: WallFieldMapping): WallFieldImport {
  if (!table.headers[mapping.axialColumnIndex]) throw new Error("Choose the axial-position column.");
  if (!table.headers[mapping.angleColumnIndex]) throw new Error("Choose the circumferential-angle column.");
  if (mapping.axialColumnIndex === mapping.angleColumnIndex) throw new Error("Axial position and angle must use different columns.");
  const quantities = [
    { quantity: "wallHeatFluxMWm2" as const, index: mapping.heatFluxColumnIndex },
    { quantity: "wallTemperatureK" as const, index: mapping.temperatureColumnIndex },
  ].filter((item) => table.headers[item.index]);
  if (!quantities.length) throw new Error("Choose a wall-heat-flux or wall-temperature column.");
  const duplicate = quantities.some((item) => item.index === mapping.axialColumnIndex || item.index === mapping.angleColumnIndex)
    || quantities.length === 2 && quantities[0].index === quantities[1].index;
  if (duplicate) throw new Error("Each mapped coordinate and quantity must use a different column.");

  const samples = new Map<WallFieldQuantity, WallFieldSample[]>();
  quantities.forEach((item) => samples.set(item.quantity, []));
  let validRows = 0;
  for (const row of table.rows) {
    const axial = Number(row[mapping.axialColumnIndex]);
    const angle = Number(row[mapping.angleColumnIndex]);
    const rawValues = quantities.map((item) => Number(row[item.index]));
    if (!Number.isFinite(axial) || !Number.isFinite(angle) || rawValues.some((value) => !Number.isFinite(value))) continue;
    validRows += 1;
    quantities.forEach((item, index) => {
      const raw = rawValues[index];
      const value = item.quantity === "wallHeatFluxMWm2"
        ? raw * HEAT_FACTORS_MW_M2[mapping.heatFluxUnit]
        : mapping.temperatureUnit === "°C" ? raw + 273.15 : raw;
      samples.get(item.quantity)!.push({
        axialMm: axial * AXIAL_FACTORS_MM[mapping.axialUnit],
        angleDeg: normalizedAngle(mapping.angleUnit === "rad" ? angle * 180 / Math.PI : angle),
        value,
      });
    });
  }
  if (validRows < 4) throw new Error("Fewer than four complete spatial samples remain after mapping.");
  return {
    fileName: table.fileName,
    sourceRows: table.rows.length,
    validRows,
    droppedRows: table.rows.length - validRows,
    axialColumn: table.headers[mapping.axialColumnIndex],
    angleColumn: table.headers[mapping.angleColumnIndex],
    heatFluxColumn: table.headers[mapping.heatFluxColumnIndex] ?? null,
    temperatureColumn: table.headers[mapping.temperatureColumnIndex] ?? null,
    fields: quantities.map((item) => ({ quantity: item.quantity, samples: samples.get(item.quantity)! })),
  };
}

export function wallField(imported: WallFieldImport | null | undefined, quantity: WallFieldQuantity) {
  return imported?.fields.find((field) => field.quantity === quantity) ?? null;
}

export function wallFieldImportIsValid(value: unknown): value is WallFieldImport {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<WallFieldImport>;
  if (typeof item.fileName !== "string" || !item.fileName || !Array.isArray(item.fields) || !item.fields.length) return false;
  return item.fields.every((field) => field && (field.quantity === "wallHeatFluxMWm2" || field.quantity === "wallTemperatureK")
    && Array.isArray(field.samples) && field.samples.length >= 4
    && field.samples.every((sample) => Number.isFinite(sample?.axialMm) && Number.isFinite(sample?.angleDeg) && Number.isFinite(sample?.value)));
}
