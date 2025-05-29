# LOD Marching Cubes Planet Renderer

[🌐 **Live Demo: https://cybercyril.com/planetLOD/**](https://cybercyril.com/planetLOD/)

![screenshot](https://cybercyril.com/planetLOD/screenshot.png)

---

## Overview

**Marching Cubes Planet** is a real-time, interactive, procedural planet renderer for the web.  
It combines advanced WebGL2 rendering, a Rust+WASM marching cubes engine, and a responsive UI to let you explore, tweak, and visualize a fully 3D, cave-filled, LOD-enabled world—right in your browser.

---

## ✨ Features

### 🌍 Procedural World Generation
- Procedural planet terrain with caves, craters, and multi-octave noise
- Rust + WebAssembly mesh extraction using [Twinklebear/webgl-marching-cubes](https://github.com/Twinklebear/webgl-marching-cubes) (with modifications for mesh deduplication)
- Parallel chunk generation via Web Workers (responsive even at high LOD)
- Dynamic Level of Detail (LOD) system with seamless LOD transitions and chunk pooling

### 🎵 Procedural Music System
- **Celestial electro music** that evolves with your world 
- **Seed-based composition**: Music regenerates with each new world seed
- **Harmonic modulations**: Automatic key changes and chord progressions
- **5 Dynamic instruments**: Lead synths, atmospheric pads, bass lines, arpeggios, and pluck sounds
- **Real-time audio effects**: Reverb, delay, chorus, and dynamic filtering
- **Evolving complexity**: Rhythmic variations, polyrhythmic patterns, and extended harmonies
- **Volume control**: Elegant slider for seamless audio adjustment

### 🎨 Advanced Rendering
- Bayer matrix dithering for smooth, crack-free LOD fades
- Physically-based triplanar shading with multi-material blending (rock, grass, dirt, sand)
- Animated sun and skybox [Spacescape](http://alexcpeterson.com/spacescape/)
- Free high-res PBR textures from [Poly Haven](https://polyhaven.com/)

### 🎮 Interactive Experience
- Orbitron-themed UI with real-time stats, world controls, and instant feedback
- 6DOF free-fly camera with optional isosurface collision
- **Responsive audio-visual synchronization** between world generation and music

---

## 🖥️ Try it Out

- [Live Demo](https://cybercyril.com/planet/)

---

## 🚀 Quickstart

### 1. Prerequisites

- Node.js (v18+ recommended): https://nodejs.org/
- Rust: https://www.rust-lang.org/tools/install
- wasm-pack: https://rustwasm.github.io/wasm-pack/installer/

### 2. Install dependencies

npm install

### 3. Build the Rust WASM (marching cubes engine)

npm run build-wasm

This will:
- Build the Rust code in rust/marching-cubes/ using wasm-pack
- Copy marching_cubes_bg.wasm, marching_cubes.js, and marching_cubes.d.ts to src/gl/marching-cubes-wasm/

### 4. Start the app (development)

npm run dev

Open http://localhost:5173 in your browser.

### 5. Build for production

npm run build

### 6. Preview production build

npm run preview

---

## 🕹️ Controls

- WASD / Arrow keys: Move
- Mouse drag: Look around
- Q / E: Roll
- Space / Shift: Up / Down
- Pinch / Touch: Move and look on mobile

---

## ⚙️ System Menu

- Open/close with the SYSTEM button or Tab
- Change LOD count, chunk size, voxel resolution, seed, and more
- Toggle backface culling, LOD tint, and triplanar texturing
- See real-time chunk/worker stats, LOD breakdown, and FPS

---

## 🏗️ Architecture & Technical Highlights

### Rust + WASM Marching Cubes

- Core mesh extraction is powered by Rust, compiled to WebAssembly for maximum speed
- Based on [Twinklebear/webgl-marching-cubes](https://github.com/Twinklebear/webgl-marching-cubes) (MIT), with additional mesh deduplication for seamless joins and integration
- Communicated with JS via TypeScript bindings and loaded dynamically

### Procedural Music Engine

- **Web Audio API**: High-performance real-time synthesis and effects processing
- **Seed-based generation**: Deterministic music creation tied to world parameters
- **Harmonic progression system**: Complex chord progressions with automatic modulations
- **Multi-instrument synthesis**: Lead, pad, bass, arpeggio, and pluck instruments with unique characteristics
- **Dynamic effects chain**: Reverb, delay, chorus, dual filtering, and compression
- **Temporal evolution**: Music structure changes over time with section-based variations
- **Audio scheduling**: Precise timing using Web Audio's scheduling system

### Level of Detail (LOD) System

- Multiple concentric LOD rings around the camera (configurable up to 10+)
- Each LOD has its own chunk size, fade range, and mesh bias to eliminate cracks
- Chunks are pooled and reused for efficiency

### Web Workers

- All chunk mesh generation happens in parallel Web Workers
- No main thread blocking, even at high LODs or large worlds

### Triplanar PBR Shading

- Rock, grass, dirt, and sand materials blended using triplanar mapping
- Material assignment based on slope, altitude, and latitude for natural transitions
- Uses [Poly Haven](https://polyhaven.com/) CC0 textures for all materials

### Bayer Matrix Dithering

- 4x4 Bayer matrix in the fragment shader for smooth, temporally stable LOD fades
- Prevents popping and visual cracks at LOD boundaries

### Animated Sun & Skybox

- Sun is a roll-aligned, animated billboard with procedural flares
- Procedural skybox created with [Spacescape by Alex Peterson](http://alexcpeterson.com/spacescape/)
- Optional HDR/texture skyboxes supported

### Free-Fly Camera

- 6DOF controls (keyboard, mouse, touch)
- Optional isosurface collision: restricts camera to the planet surface

### Responsive UI

- Orbitron-themed menu overlays
- Real-time system status: chunk counts, LOD breakdown, worker usage, FPS
- All parameters live-editable

---

## 📦 Project Structure

src/
  gl/
    marching-cubes-wasm/
      marching_cubes_bg.wasm
      marching_cubes.js
      marching_cubes.d.ts
    ... (WebGL, shaders, rendering)
  chunking/
    ... (Chunk manager, config, LOD, density, workers)
  ui/
    ... (UIManager, menu)
rust/
  marching-cubes/
    Cargo.toml
    src/
      lib.rs
      ...
build-wasm.cjs
README.md
...

---

## 🎵 Music Technical Details

The procedural music system creates **Jean-Michel Jarre style celestial electro** compositions with:

- **8 chord progressions** that rotate between musical sections
- **6 musical scales** (minor, dorian, phrygian, mixolydian, pentatonic, blues)
- **Harmonic modulations** every 16-48 beats to new keys
- **5 instrument types** with randomized parameters per world seed:
  - **Lead synths**: Sawtooth/square waves with detuning and filtering
  - **Atmospheric pads**: Sine waves with long attack/release envelopes
  - **Bass lines**: Triangle/sawtooth waves in low octaves
  - **Arpeggios**: 5 different patterns with varying speeds
  - **Pluck sounds**: Short percussive notes with quick decay
- **Real-time effects processing**: Multi-stage filtering, chorus, reverb, and delay
- **Tempo variation**: 75-175 BPM based on world seed
- **Polyrhythmic complexity**: Syncopated patterns and off-beat elements

---

## 📝 Credits & Attributions

- Marching Cubes WASM engine based on [Twinklebear/webgl-marching-cubes](https://github.com/Twinklebear/webgl-marching-cubes) (MIT, Will Usher), with additional mesh deduplication and integration (Rust code only)
- Procedural skybox generator inspired by [Spacescape by Alex Peterson](http://alexcpeterson.com/spacescape/)
- Free PBR textures and assets from [Poly Haven](https://polyhaven.com/)
- Sun shader, LOD blending, and UI design by [cybercyril.com](https://cybercyril.com/)
- WebGL utilities: [gl-matrix](https://github.com/toji/gl-matrix)
- Orbitron font: Google Fonts
- Marching Cubes algorithm: Lorensen and Cline (1987)

---

## 🧑‍💻 Development Notes

- If you change the Rust code, always re-run npm run build-wasm before starting or building the JS app.
- Vite is used for hot-reload development and optimized production builds.
- All UI and controls are responsive and mobile-friendly.

---

## 📝 License

- Rust code (marching-cubes): MIT License, (C) 2024 Will Usher, with modifications by contributors.
- All other code, shaders, UI, and assets in this repo: MIT License, (C) 2025 Cyril Monkewitz and contributors.

---

Enjoy exploring your procedural planet!