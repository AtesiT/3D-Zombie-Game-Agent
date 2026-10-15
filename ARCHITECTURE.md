# Top-Down Zombie Survival Shooter — Systems Architecture & Feature Specification

## Overview
This repository contains the production-ready C# architecture and implementation for the major survival expansion:
1. **Data-Driven Map Selection & Asynchronous Scene Streaming** (`Assets/Scripts/Systems/MapSelection/`)
2. **Map 1: "Terminal Transit" — Top-Down Armored Bus, Hybrid NavMesh Carving, Roof-Latching & Co-Op Turret** (`Assets/Scripts/Systems/Vehicles/TopDownBusController.cs`)
3. **Map 2 ("Neon Night Market") & Map 3 ("Blackwood Logging Camp") Environmental Hazards** (`Assets/Scripts/Systems/Maps/MapUniqueMechanics.cs`)
4. **Dynamic Weather State Machine & Day/Night Cycle Director** (`Assets/Scripts/Systems/Environment/EnvironmentDirector.cs`)
5. **Decoupled Event Bus & Unified Environment Modifier Snapshot** (`Assets/Scripts/Core/Events/EnvironmentModifiers.cs`)

---

## Directory Structure
```text
Assets/
└── Scripts/
    ├── Core/
    │   └── Events/
    │       └── EnvironmentModifiers.cs        # Snapshot struct, IDamageable, IZombieAgent, SurvivalEventBus
    └── Systems/
        ├── Environment/
        │   └── EnvironmentDirector.cs         # Weather FSM, Day/Night Cycle, Lightning Hazards, Audio/Physics modifiers
        ├── MapSelection/
        │   ├── MapDefinitionSO.cs             # ScriptableObject + JSON DTO + Polymorphic MapMechanicProfileSO
        │   └── MapSelectionAndStreamingManager.cs # Pre-match selection UI state & Async Scene Streaming
        ├── Maps/
        │   └── MapUniqueMechanics.cs          # Neon Night Market & Blackwood Logging Camp hazards
        └── Vehicles/
            └── TopDownBusController.cs        # Armored Bus physics, drift, crush, NavMesh hybrid carving, Turret
```
