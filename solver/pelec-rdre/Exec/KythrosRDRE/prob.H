#ifndef KYTHROS_RDRE_PROB_H
#define KYTHROS_RDRE_PROB_H

#include <AMReX_EB2_IF.H>
#include <AMReX_FArrayBox.H>
#include <AMReX_Geometry.H>
#include <AMReX_GpuMemory.H>
#include <AMReX_Math.H>
#include <AMReX_REAL.H>

#include <cmath>

#include "Constants.H"
#include "EB.H"
#include "EOS.H"
#include "Geometry.H"
#include "IndexDefines.H"
#include "PeleC.H"
#include "PelePhysics.H"
#include "ProblemSpecificFunctions.H"
#include "Tagging.H"
#include "mechanism.H"
#include "prob_parm.H"

class KythrosAnnulus : public pele::pelec::Geometry::Register<KythrosAnnulus>
{
public:
  static std::string identifier() { return "kythros-annulus"; }
  void build(const amrex::Geometry& geom, int max_coarsening_level) override;
};

AMREX_GPU_HOST_DEVICE
AMREX_FORCE_INLINE
amrex::Real kythros_two_pi()
{
  return 6.283185307179586476925286766559;
}

AMREX_GPU_DEVICE
AMREX_FORCE_INLINE
void
kythros_write_state(
  amrex::Real* target,
  amrex::Real pressure,
  amrex::Real temperature,
  amrex::Real velocity_x,
  amrex::Real velocity_y,
  amrex::Real velocity_z,
  const amrex::Real* massfrac)
{
  auto eos = pele::physics::PhysicsType::eos();
  amrex::Real rho = 0.0;
  amrex::Real eint = 0.0;
  eos.PYT2RE(pressure, massfrac, temperature, rho, eint);
  target[URHO] = rho;
  target[UMX] = rho * velocity_x;
  target[UMY] = rho * velocity_y;
  target[UMZ] = rho * velocity_z;
  target[UEINT] = rho * eint;
  target[UEDEN] = rho *
                  (eint + 0.5 *
                            (velocity_x * velocity_x + velocity_y * velocity_y +
                             velocity_z * velocity_z));
  target[UTEMP] = temperature;
  for (int n = 0; n < NUM_SPECIES; ++n) {
    target[UFS + n] = rho * massfrac[n];
  }
}

AMREX_GPU_DEVICE
AMREX_FORCE_INLINE
void
pc_initdata(
  int i,
  int j,
  int k,
  amrex::Array4<amrex::Real> const& state,
  amrex::GeometryData const& geomdata,
  ProbParmDevice const& prob_parm)
{
  const amrex::Real* prob_lo = geomdata.ProbLo();
  const amrex::Real* dx = geomdata.CellSize();
  const amrex::Real x = prob_lo[0] + (static_cast<amrex::Real>(i) + 0.5) * dx[0];
  const amrex::Real y = prob_lo[1] + (static_cast<amrex::Real>(j) + 0.5) * dx[1];
  const amrex::Real z = prob_lo[2] + (static_cast<amrex::Real>(k) + 0.5) * dx[2];
  const amrex::Real radius = std::sqrt(y * y + z * z);
  const amrex::Real mean_radius = 0.5 * (prob_parm.inner_radius + prob_parm.outer_radius);
  const amrex::Real theta = std::atan2(z, y);
  const amrex::Real arc_distance = mean_radius * theta;
  const amrex::Real axial_distance = x - prob_parm.ignition_axial_location;
  const bool ignition_kernel =
    radius > prob_parm.inner_radius && radius < prob_parm.outer_radius &&
    axial_distance * axial_distance + arc_distance * arc_distance <
      prob_parm.ignition_radius * prob_parm.ignition_radius;

  amrex::Real pressure = prob_parm.chamber_pressure;
  amrex::Real temperature = prob_parm.chamber_temperature;
  amrex::Real massfrac[NUM_SPECIES] = {0.0};
  for (int n = 0; n < NUM_SPECIES; ++n) {
    massfrac[n] = ignition_kernel ? prob_parm.product_massfrac[n]
                                  : prob_parm.reactant_massfrac[n];
  }
  if (ignition_kernel) {
    pressure = prob_parm.ignition_pressure;
    temperature = prob_parm.ignition_temperature;
  }

  amrex::Real conserved[NVAR] = {0.0};
  kythros_write_state(conserved, pressure, temperature, 0.0, 0.0, 0.0, massfrac);
  for (int n = 0; n < NVAR; ++n) {
    state(i, j, k, n) = conserved[n];
  }
}

AMREX_GPU_DEVICE
AMREX_FORCE_INLINE
void
bcnormal(
  const amrex::Real x[AMREX_SPACEDIM],
  const amrex::Real s_int[NVAR],
  amrex::Real s_ext[NVAR],
  const int idir,
  const int sgn,
  const amrex::Real /*time*/,
  amrex::GeometryData const& geomdata,
  ProbParmDevice const& prob_parm,
  const amrex::GpuArray<amrex::Real, AMREX_SPACEDIM>& /*turb_fluc*/)
{
  if (idir != 0) {
    return;
  }

  if (sgn == 1) {
    const amrex::Real radius = std::sqrt(x[1] * x[1] + x[2] * x[2]);
    const amrex::Real theta = std::atan2(x[2], x[1]);
    const amrex::Real injector_step = kythros_two_pi() /
                                      static_cast<amrex::Real>(prob_parm.injector_count);
    const amrex::Real nearest_theta =
      std::nearbyint(theta / injector_step) * injector_step;
    const amrex::Real mean_radius =
      0.5 * (prob_parm.inner_radius + prob_parm.outer_radius);
    const amrex::Real injector_y = mean_radius * std::cos(nearest_theta);
    const amrex::Real injector_z = mean_radius * std::sin(nearest_theta);
    const amrex::Real dy = x[1] - injector_y;
    const amrex::Real dz = x[2] - injector_z;
    const bool in_annulus =
      radius > prob_parm.inner_radius && radius < prob_parm.outer_radius;
    const bool in_injector =
      dy * dy + dz * dz <= prob_parm.injector_radius * prob_parm.injector_radius;

    // UserBC is a wall unless the point is one of the physical injector holes.
    if (!in_annulus || !in_injector) {
      s_ext[URHO] = s_int[URHO];
      s_ext[UMX] = -s_int[UMX];
      s_ext[UMY] = -s_int[UMY];
      s_ext[UMZ] = -s_int[UMZ];
      s_ext[UEINT] = s_int[UEINT];
      s_ext[UEDEN] = s_int[UEDEN];
      s_ext[UTEMP] = s_int[UTEMP];
      for (int n = 0; n < NUM_SPECIES; ++n) {
        s_ext[UFS + n] = s_int[UFS + n];
      }
      return;
    }

    amrex::Real p_inside = prob_parm.chamber_pressure;
    amrex::Real interior_massfrac[NUM_SPECIES] = {0.0};
    for (int n = 0; n < NUM_SPECIES; ++n) {
      interior_massfrac[n] = s_int[UFS + n] / s_int[URHO];
    }
    auto eos = pele::physics::PhysicsType::eos();
    eos.RTY2P(s_int[URHO], s_int[UTEMP], interior_massfrac, p_inside);
    p_inside = amrex::max(p_inside, static_cast<amrex::Real>(1.0e4));

    amrex::Real rho_inlet = 0.0;
    amrex::Real inlet_eint = 0.0;
    eos.PYT2RE(
      p_inside, prob_parm.reactant_massfrac, prob_parm.inlet_temperature,
      rho_inlet, inlet_eint);
    const amrex::Real total_injector_area =
      static_cast<amrex::Real>(prob_parm.injector_count) *
      3.1415926535897932384626433832795 * prob_parm.injector_radius *
      prob_parm.injector_radius;
    const amrex::Real speed = prob_parm.mass_flow /
                              amrex::max(
                                rho_inlet * total_injector_area,
                                static_cast<amrex::Real>(1.0e-12));
    const amrex::Real axial_velocity = speed * std::cos(prob_parm.injector_angle_rad);
    const amrex::Real tangential_velocity =
      speed * std::sin(prob_parm.injector_angle_rad);
    const amrex::Real velocity_y = -tangential_velocity * std::sin(theta);
    const amrex::Real velocity_z = tangential_velocity * std::cos(theta);
    kythros_write_state(
      s_ext, p_inside, prob_parm.inlet_temperature, axial_velocity, velocity_y,
      velocity_z, prob_parm.reactant_massfrac);
    return;
  }

  if (sgn == -1) {
    // Characteristic pressure outlet following the strategy used by PeleC's
    // EB-ConvergingNozzle regression case (Blazek, Eq. 8.23).
    const amrex::Real rho_inside = s_int[URHO];
    const amrex::Real velocity_x_inside = s_int[UMX] / rho_inside;
    const amrex::Real velocity_y_inside = s_int[UMY] / rho_inside;
    const amrex::Real velocity_z_inside = s_int[UMZ] / rho_inside;
    const amrex::Real temperature_inside = s_int[UTEMP];
    amrex::Real massfrac[NUM_SPECIES] = {0.0};
    for (int n = 0; n < NUM_SPECIES; ++n) {
      massfrac[n] = s_int[UFS + n] / rho_inside;
    }
    auto eos = pele::physics::PhysicsType::eos();
    amrex::Real pressure_inside = 0.0;
    amrex::Real sound_speed_inside = 0.0;
    eos.RTY2P(rho_inside, temperature_inside, massfrac, pressure_inside);
    eos.RTY2Cs(rho_inside, temperature_inside, massfrac, sound_speed_inside);

    const amrex::Real* prob_hi = geomdata.ProbHi();
    const amrex::Real* dx = geomdata.CellSize();
    const amrex::Real interior_location = prob_hi[0] - 0.5 * dx[0];
    const amrex::Real boundary_location = prob_hi[0];
    const amrex::Real target_density = rho_inside +
      (prob_parm.outlet_pressure - pressure_inside) /
        (sound_speed_inside * sound_speed_inside);
    const amrex::Real target_velocity_x = velocity_x_inside +
      (pressure_inside - prob_parm.outlet_pressure) /
        (rho_inside * sound_speed_inside);
    const amrex::Real fraction =
      (x[0] - interior_location) / (boundary_location - interior_location);
    const amrex::Real rho = amrex::max(
      rho_inside + fraction * (target_density - rho_inside),
      static_cast<amrex::Real>(1.0e-12));
    const amrex::Real pressure = amrex::max(
      pressure_inside + fraction * (prob_parm.outlet_pressure - pressure_inside),
      static_cast<amrex::Real>(1.0e4));
    const amrex::Real velocity_x = velocity_x_inside +
      fraction * (target_velocity_x - velocity_x_inside);
    amrex::Real eint = 0.0;
    amrex::Real temperature = temperature_inside;
    eos.RYP2E(rho, massfrac, pressure, eint);
    eos.REY2T(rho, eint, massfrac, temperature);
    kythros_write_state(
      s_ext, pressure, temperature, velocity_x, velocity_y_inside,
      velocity_z_inside, massfrac);
  }
}

void pc_prob_close();

using ProblemSpecificFunctions = DefaultProblemSpecificFunctions;

#endif
