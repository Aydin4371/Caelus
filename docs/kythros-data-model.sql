-- Kythros durable-storage target schema (SQLite / Cloudflare D1 compatible).
-- The browser workspace uses the same identifiers and parent relationships.

PRAGMA foreign_keys = ON;

CREATE TABLE engine_design (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('user', 'demo')),
  definition_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE operating_point (
  id TEXT PRIMARY KEY,
  engine_design_id TEXT NOT NULL REFERENCES engine_design(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('uploaded', 'demo')),
  inlet_pressure_bar REAL NOT NULL CHECK (inlet_pressure_bar > 0),
  mass_flow_kg_s REAL NOT NULL CHECK (mass_flow_kg_s > 0),
  equivalence_ratio REAL NOT NULL CHECK (equivalence_ratio > 0),
  back_pressure_bar REAL NOT NULL CHECK (back_pressure_bar > 0),
  inlet_temperature_k REAL NOT NULL CHECK (inlet_temperature_k > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (inlet_pressure_bar > back_pressure_bar)
);

CREATE TABLE analysis_run (
  id TEXT PRIMARY KEY,
  operating_point_id TEXT NOT NULL REFERENCES operating_point(id) ON DELETE CASCADE,
  baseline_run_id TEXT REFERENCES analysis_run(id) ON DELETE RESTRICT,
  reference_run_id TEXT REFERENCES analysis_run(id) ON DELETE RESTRICT,
  source TEXT NOT NULL CHECK (source IN ('uploaded', 'demo')),
  changed_variable TEXT CHECK (changed_variable IN ('mesh', 'time-step', 'chemistry', 'inlet', 'wall', 'initialization', 'unsteadiness', 'other')),
  change_description TEXT,
  metadata_json TEXT NOT NULL,
  experiment_signals_json TEXT NOT NULL,
  cfd_signals_json TEXT NOT NULL,
  import_provenance_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (baseline_run_id IS NULL AND reference_run_id IS NULL AND changed_variable IS NULL)
    OR
    (baseline_run_id IS NOT NULL AND reference_run_id IS NOT NULL AND changed_variable IS NOT NULL)
  )
);

CREATE INDEX operating_point_engine_idx ON operating_point(engine_design_id);
CREATE INDEX analysis_run_operating_point_idx ON analysis_run(operating_point_id);
CREATE INDEX analysis_run_baseline_idx ON analysis_run(baseline_run_id);

-- A service-layer transaction must additionally verify that baseline_run_id
-- and reference_run_id belong to the same operating_point_id as the new run.
-- This cross-row rule is already enforced by the current workspace validator.
