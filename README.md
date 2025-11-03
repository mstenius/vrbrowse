# Vrbrowse - a viewer for .vr files

Mårten Stenius

## Introduction

This is an ongoing effort to implement an open-source viewer for the `.vr` file format for virtual environments,
as specified in the file format for the legacy DIVE (Distributed Interactive Virtual Environment)
platform once developed by SICS (Swedish Institute of Computer Science).

The idea is to follow the `.vr` format as closely as possible without re-implementing the DIVE system itself.
The specification used for this implementation is the public DIVE 3.3x file description [1].

This is a spare-time project and will proceed accordingly.

## Why?

Why do I do this?

- Legacy - Being part of the DCE and ICE labs at SICS in the mid to late '90s was a privilege and spending 
  a little spare time on highlighting some of the ideas just feels nice.
- Nostalgia - I would once again like to walk around in those blocky worlds we created then.
- Curiosity - I would like to see how this looks and feels now, when at least the **visual** layers can be
  implemented with technology that is literally available to anyone.

Obviously, a browser-only local file viewer cobbled together using javascript, various code agents, and then me 
correcting and polishing much of what the agents thought was right, is nowhere close to what we did then. But 
I hope to convey some of the **flavour** of VR research in the late '90s.

There is very much more to be said about the **DIVE** system itself, and all the other core ideas pioneered
there. But that is another story.

## Status

The current state is rudimentary — very basic functionality, local to a web browser only.

Implemented so far:

- Simple 3D viewer with mouse look and WASD navigation
- Parsing of the world declaration and boxes, spheres, cylinders, etc

Ongoing now:

- Materials started
- Filling in remaining view types
- Sorting out the mushy but semi-functional parser draft I got from Copilot

## Running

To run locally, either just load the files into a web browser that supports JavaScript and WebGL or
serve the files statically using your favourite web server and do the same.

## References

`[1]` Avatare, Frécon, Hagsand, Jää-Aro, Simsarian, Stenius, Ståhl — "DIVE — The Distributed Interactive Virtual Environment: DIVE Files Description (v3.3x)". Swedish Institute of Computer Science, July 1999.

Available from ResearchGate: [DIVE — The Distributed Interactive Virtual Environment: DIVE Files Description (v3.3x)](https://www.researchgate.net/publication/2627184_DIVE_---_The_Distributed_Interactive_Virtual_Environment_DIVE_Files_Description)

## License

vrbrowse in its current form: Copyright (c) 2025 Mårten Stenius

SPDX-License-Identifier: MIT
