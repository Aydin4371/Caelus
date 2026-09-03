# AMReX / PeleC dimensionality and compiler
DIM = 3
COMP = gnu
PRECISION = DOUBLE

# Runtime parallelism. The packaged reference build uses OpenMP on CPU.
# Release engineering may override these values for MPI or CUDA builds.
USE_MPI ?= FALSE
USE_OMP ?= TRUE
USE_CUDA ?= FALSE
USE_HIP = FALSE
USE_SYCL = FALSE

# Build diagnostics
PROFILE = FALSE
TINY_PROFILE = FALSE
COMM_PROFILE = FALSE
TRACE_PROFILE = FALSE
MEM_PROFILE = FALSE
DEBUG = FALSE
FSANITIZER = FALSE
THREAD_SANITIZER = FALSE

# Reacting-flow models
PELE_CVODE_FORCE_YCORDER = FALSE
PELE_USE_MAGMA = FALSE
PELE_COMPILE_AJACOBIAN = FALSE
Eos_Model := Fuego
Transport_Model := Simple
Chemistry_Model := LiDryer

Bpack := ./Make.package
Blocs := .
PELE_HOME := ../../..
include $(PELE_HOME)/Exec/Make.PeleC
