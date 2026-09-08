#ifndef KYTHROS_RDRE_PROB_PARM_H
#define KYTHROS_RDRE_PROB_PARM_H

#include <AMReX_GpuMemory.H>
#include <AMReX_REAL.H>

struct ProbParmDevice
{
  // PeleC uses cgs units.
  amrex::Real inner_radius = 3.85;
  amrex::Real outer_radius = 4.25;
  amrex::Real chamber_length = 12.0;
  amrex::Real chamber_pressure = 1.0e6;
  amrex::Real chamber_temperature = 300.0;
  amrex::Real inlet_temperature = 300.0;
  amrex::Real outlet_pressure = 1.0e6;
  amrex::Real mass_flow = 620.0;
  amrex::Real injector_radius = 0.04;
  amrex::Real injector_angle_rad = 0.0;
  amrex::Real ignition_temperature = 2800.0;
  amrex::Real ignition_pressure = 2.0e7;
  amrex::Real ignition_radius = 0.35;
  amrex::Real ignition_axial_location = 0.7;
  int injector_count = 120;

  amrex::Real reactant_massfrac[NUM_SPECIES] = {0.0};
  amrex::Real product_massfrac[NUM_SPECIES] = {0.0};
};

struct ProbParmHost
{
  ProbParmHost() = default;
};

#endif
