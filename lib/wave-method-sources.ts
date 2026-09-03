export type WaveMethodSource = {
  id: string;
  title: string;
  authors: string;
  year: number;
  doi: string;
  url: string;
  supports: string;
  limitation: string;
};

/** Reviewed primary sources that justify the pressure/wave analysis methods. */
export const WAVE_METHOD_SOURCES: WaveMethodSource[] = [
  {
    id: "bohon-et-al-2019",
    title: "Measuring Rotating Detonation Combustion Using Cross-Correlation",
    authors: "Myles D. Bohon; Richard Bluemner; C. Oliver Paschereit; Ephraim J. Gutmark",
    year: 2019,
    doi: "10.1007/s10494-019-00017-z",
    url: "https://doi.org/10.1007/s10494-019-00017-z",
    supports: "Windowed cross-correlation of circumferential pressure signals can estimate rotating-wave speed and direction, with explicit attention to ambiguous operating modes.",
    limitation: "The paper warns that sensor placement and complex co-/counter-rotating modes can produce deceptive correlation results; correlation alone is not unique mode proof.",
  },
  {
    id: "durkee-et-al-2026",
    title: "On the Determination of Rotating Detonation Engine Wave Modes Using Limited Point Measurements",
    authors: "Kaito J. Durkee; Angelo Panettieri; Garrett R. Cobb; John W. Bennewitz",
    year: 2026,
    doi: "10.2514/6.2026-2036",
    url: "https://doi.org/10.2514/6.2026-2036",
    supports: "Limited synchronized point measurements can identify average wave count and operating frequency when temporal/spatial Fourier structure and deliberate sensor placement are used.",
    limitation: "The reported placement study uses its own 2D-DFT method and tested mode set; Kythros uses a separate sparse phase-candidate fit and therefore cites the paper for identifiability and placement constraints, not algorithm equivalence.",
  },
  {
    id: "pritschau-et-al-2025",
    title: "Characterizing Acoustic Modes in a Hollow Rotating Detonation Combustor",
    authors: "Tyler Pritschau; Aatresh Karnam; Ephraim J. Gutmark",
    year: 2025,
    doi: "10.1016/j.combustflame.2025.114057",
    url: "https://doi.org/10.1016/j.combustflame.2025.114057",
    supports: "Cross-spectral phase from azimuthally spaced high-frequency pressure transducers can reveal the spatial structure of rotating combustor modes.",
    limitation: "The study concerns acoustic-mode structure in a hollow combustor; a fitted pressure phase mode must not automatically be labeled a detonation front.",
  },
  {
    id: "tobias-et-al-2022",
    title: "Experimental and Computational Analysis of a Rotating Detonation Combustor",
    authors: "James R. Tobias; Ajay K. Agrawal; Daniel E. Paxson",
    year: 2022,
    doi: "10.2514/6.2022-1879",
    url: "https://doi.org/10.2514/6.2022-1879",
    supports: "RDC validation can compare measured and simulated dynamic pressure together with wave-speed and static-pressure observables rather than relying on one scalar metric.",
    limitation: "Agreement in one combustor and operating range does not define universal acceptance limits for another RDE geometry, propellant, solver, or sensor system.",
  },
  {
    id: "sato-et-al-2025",
    title: "Space Flight of Liquid Rotating Detonation Engine Using Sounding Rocket S-520-34",
    authors: "Tomoki Sato; Ken Matsuoka; Noboru Itouyama; Kazuhiko Yamada; et al.",
    year: 2025,
    doi: "10.2514/1.A36447",
    url: "https://doi.org/10.2514/1.A36447",
    supports: "Short-time frequency analysis can expose sequential deflagration, multi-wave, and single-wave operating intervals that a full-record spectrum would hide.",
    limitation: "The flight system, liquid propellants, and transient operating history are specific; Kythros uses the result only to justify windowed mode tracking.",
  },
];
