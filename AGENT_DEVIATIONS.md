# AGENT DEVIATIONS LOG (`AGENT_DEVIATIONS.md`)

1. **Preservation of Existing Unity C# Scripts (`Assets/Scripts/`):**
   - During Step 1 Discovery, the repository was found to contain untracked Unity C# reference scripts under `Assets/Scripts/` and `ARCHITECTURE.md`, with no browser runtime yet present.
   - Per the constraint *"DO NOT rewrite existing working systems unless absolutely necessary"*, all existing files under `Assets/Scripts/` and `ARCHITECTURE.md` were preserved untouched, while the complete browser-based ES module implementation requested by the specification was built under `/src/`, `/assets/`, `/public/`, `index.html`, `package.json`, and `vite.config.js`.
2. **Procedural Web Audio Synthesizer (`src/utils/SoundManager.js`):**
   - To guarantee zero external audio file decoding failures and provide real-time continuous bus engine RPM pitch modulation and dynamic `BiquadFilterNode` low-pass weather muffling in Heavy Rain, audio cues are synthesized procedurally via the browser's native Web Audio API.
