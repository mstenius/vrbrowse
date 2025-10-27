# Vrbrowse - a viewer for .vr files

## Introduction

This is an ongoing effort to implement an open-source viewer for the `.vr` file format for virtual environments,
as specified in the file format for the legacy DIVE (Distributed Interactive Virtual Environment)
platform once developed by SICS (Swedish Institute of Computer Science).

The idea is to follow the `.vr` format as closely as possible without re-implementing the DIVE system itself.
The specification used for this implementation is the public DIVE 3.3x file description [1].

This is a spare-time project and will proceed accordingly.

## Status

The current state is rudimentary — very basic functionality, local to a web browser only.

Implemented so far:

- Simple 3D viewer with mouse look and WASD navigation
- Parsing of the world declaration and boxes, spheres, cylinders, etc
- Materials started

## Running

To run locally, either just load the files into a web browser that supports JavaScript and WebGL or
serve the files statically using your favourite web server and do the same.

## References

`[1]` Avatare, Frécon, Hagsand, Jää-Aro, Simsarian, Stenius, Ståhl — "DIVE — The Distributed Interactive Virtual Environment: DIVE Files Description (v3.3x)". Swedish Institute of Computer Science, July 1999.

Available from ResearchGate: [DIVE — The Distributed Interactive Virtual Environment: DIVE Files Description (v3.3x)](https://www.researchgate.net/publication/2627184_DIVE_---_The_Distributed_Interactive_Virtual_Environment_DIVE_Files_Description)

## License

vrbrowse in its current form: Copyright (c) 2025 Mårten Stenius

SPDX-License-Identifier: MIT
