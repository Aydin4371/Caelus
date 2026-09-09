#include "prob.H"
#include "ReactorCvode.H"

#include <AMReX_ParmParse.H>
#include <AMReX_Vector.H>

#include <algorithm>

void pc_prob_close() {}

namespace {
// Explicitly register the case geometry: clang-cl may defer the template's
// implicit static registration until after the factory's first lookup.
const bool annulus_registered = KythrosAnnulus::add_sub_type();
const bool reactor_registered =
  pele::physics::reactions::ReactorCvode::add_sub_type();

void
parse_problem(ProbParmDevice* problem)
{
  amrex::ParmParse pp("prob");
  pp.query("inner_radius", problem->inner_radius);
  pp.query("outer_radius", problem->outer_radius);
  pp.query("chamber_length", problem->chamber_length);
  pp.query("chamber_pressure", problem->chamber_pressure);
  pp.query("chamber_temperature", problem->chamber_temperature);
  pp.query("inlet_temperature", problem->inlet_temperature);
  pp.query("outlet_pressure", problem->outlet_pressure);
  pp.query("mass_flow", problem->mass_flow);
  pp.query("injector_radius", problem->injector_radius);
  pp.query("injector_count", problem->injector_count);
  pp.query("injector_angle_rad", problem->injector_angle_rad);
  pp.query("ignition_temperature", problem->ignition_temperature);
  pp.query("ignition_pressure", problem->ignition_pressure);
  pp.query("ignition_radius", problem->ignition_radius);
  pp.query("ignition_axial_location", problem->ignition_axial_location);

  amrex::Real y_h2 = 0.0283;
  amrex::Real y_o2 = 0.2264;
  amrex::Real y_n2 = 0.7453;
  pp.query("Y_H2", y_h2);
  pp.query("Y_O2", y_o2);
  pp.query("Y_N2", y_n2);

  amrex::Vector<std::string> species_names;
  pele::physics::eos::speciesNames<pele::physics::PhysicsType::eos_type>(
    species_names);
  int h2_index = -1;
  int o2_index = -1;
  int h2o_index = -1;
  int n2_index = -1;
  for (int n = 0; n < static_cast<int>(species_names.size()); ++n) {
    if (species_names[n] == "H2") h2_index = n;
    if (species_names[n] == "O2") o2_index = n;
    if (species_names[n] == "H2O") h2o_index = n;
    if (species_names[n] == "N2") n2_index = n;
  }
  if (h2_index < 0 || o2_index < 0 || h2o_index < 0 || n2_index < 0) {
    amrex::Abort("Kythros RDRE requires H2, O2, H2O, and N2 in the chemistry mechanism.");
  }

  const amrex::Real total = y_h2 + y_o2 + y_n2;
  if (total <= 0.0) {
    amrex::Abort("Kythros RDRE reactant mass fractions must have a positive sum.");
  }
  y_h2 /= total;
  y_o2 /= total;
  y_n2 /= total;
  problem->reactant_massfrac[h2_index] = y_h2;
  problem->reactant_massfrac[o2_index] = y_o2;
  problem->reactant_massfrac[n2_index] = y_n2;

  constexpr amrex::Real stoich_h2_to_o2_mass = 4.032 / 31.998;
  const amrex::Real reacted_h2 = std::min(y_h2, y_o2 * stoich_h2_to_o2_mass);
  const amrex::Real reacted_o2 = reacted_h2 / stoich_h2_to_o2_mass;
  problem->product_massfrac[h2_index] = y_h2 - reacted_h2;
  problem->product_massfrac[o2_index] = y_o2 - reacted_o2;
  problem->product_massfrac[h2o_index] = reacted_h2 + reacted_o2;
  problem->product_massfrac[n2_index] = y_n2;
}
} // namespace

extern "C" {
void
amrex_probinit(
  const int* /*init*/,
  const int* /*name*/,
  const int* /*namelen*/,
  const amrex::Real* /*problo*/,
  const amrex::Real* /*probhi*/)
{
  parse_problem(PeleC::h_prob_parm_device);
}
}

void PeleC::problem_post_timestep() {}
void PeleC::problem_post_init() {}
void PeleC::problem_post_restart() {}

void
KythrosAnnulus::build(
  const amrex::Geometry& geom, const int max_coarsening_level)
{
  parse_problem(PeleC::h_prob_parm_device);
  const ProbParmDevice* problem = PeleC::h_prob_parm_device;
  amrex::EB2::CylinderIF inner(
    problem->inner_radius, 0, {AMREX_D_DECL(0.0, 0.0, 0.0)}, false);
  amrex::EB2::CylinderIF outer(
    problem->outer_radius, 0, {AMREX_D_DECL(0.0, 0.0, 0.0)}, true);
  auto annulus = amrex::EB2::makeUnion(inner, outer);
  auto geometry_shop = amrex::EB2::makeShop(annulus);
  amrex::EB2::Build(
    geometry_shop, geom, max_coarsening_level, max_coarsening_level, 4, false);
}
