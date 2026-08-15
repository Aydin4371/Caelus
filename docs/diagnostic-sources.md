# Diagnostic source ledger

Caevera uses a reviewed, versioned record of primary RDE literature and
general V&V guidance. A source makes a hypothesis traceable and supplies an
applicability boundary; it does not independently prove causality for a loaded
case. Runtime records live in `lib/diagnostic-knowledge.ts`.

| ID | Verified source | Runtime use |
|---|---|---|
| `strakey-ferguson-2022` | Strakey & Ferguson, “Validation of a Computational Fluid Dynamics Model of a Methane-Oxygen Rotating Detonation Engine,” AIAA 2022-1113, [doi:10.2514/6.2022-1113](https://doi.org/10.2514/6.2022-1113) | Mesh and wall-heat-loss sensitivity |
| `tobias-agrawal-paxson-2022` | Tobias, Agrawal & Paxson, “Experimental and Computational Analysis of a Rotating Detonation Combustor,” AIAA 2022-1879, [doi:10.2514/6.2022-1879](https://doi.org/10.2514/6.2022-1879) | Multi-observable validation only |
| `batista-et-al-2026` | Batista et al., “Spatiotemporal Sensitivity in Rotating Detonation Rocket Engine Large Eddy Simulations,” AIAA 2026-2419, [doi:10.2514/6.2026-2419](https://doi.org/10.2514/6.2026-2419) | Spatial and chemistry time-resolution sensitivity |
| `dille-et-al-2024` | Dille et al., “Rotating detonation combustor performance informed through a novel megahertz-rate stagnation pressure measurement,” *Physics of Fluids* 36, 026127, [doi:10.1063/5.0195465](https://doi.org/10.1063/5.0195465) | Operating-pressure, wave-speed, and preburning context |
| `yan-teng-ng-2021` | Yan, Teng & Ng, “Effects of slot injection on detonation wavelet characteristics in a rotating detonation engine,” *Acta Astronautica* 182, 274–285, [doi:10.1016/j.actaastro.2021.02.010](https://doi.org/10.1016/j.actaastro.2021.02.010) | Injection and wavelet-structure sensitivity |
| `paxson-miki-2022` | Paxson & Miki, “Computational Assessment of Inlet Backflow Effects on Rotating Detonation Engine Performance and Operability,” AIAA 2022-1263, [doi:10.2514/6.2022-1263](https://doi.org/10.2514/6.2022-1263) | Inlet-backflow and pressure-gain sensitivity |
| `yao-wang-2016` | Yao & Wang, “Multiple ignitions and the stability of rotating detonation waves,” *Applied Thermal Engineering* 108, 927–936, [doi:10.1016/j.applthermaleng.2016.07.166](https://doi.org/10.1016/j.applthermaleng.2016.07.166) | Initialization and mode selection |
| `nist-ir-8298` | Yeo, “A Summary of Industrial Verification, Validation, and Uncertainty Quantification Procedures in Computational Fluid Dynamics,” NISTIR 8298, [doi:10.6028/NIST.IR.8298](https://doi.org/10.6028/NIST.IR.8298) | General CFD V&V and uncertainty guardrails |

Each runtime source record includes authors, year, title, publication, DOI,
URL, configuration, finding, limitation, and review date. Each displayed
research claim stores the exact source IDs that support it plus a separate
applicability boundary. The interface links those sources for the active
recommendation, and the downloadable report expands the IDs into the complete
records used for that case.

Mappings are deliberately narrower than the source list. The Tobias paper is
used for multi-observable validation, not as proof of “missing unsteadiness.”
The Yan paper is used for injection sensitivity, not wave-count selection. The
NIST report supplies general CFD V&V guardrails and is not represented as an RDE
paper. Diagnostic branches without a directly applicable source remain uncited
prototype heuristics in the report rather than borrowing a nearby citation.
