# WebGL Marching Cubes

This is a WebGL + WebASM implementation of the classic [Marching Cubes](https://en.wikipedia.org/wiki/Marching_cubes)
algorithm for extracting [isosurfaces](https://en.wikipedia.org/wiki/Isosurface) from 3D volume data.
An isosurface is a surface which represents points in the 3D data which all have the same value
(e.g., pressure, temperature). The isosurface extraction code is implemented in Rust and compiled
to WebAssembly to accelerate extraction of the surface. Depending on your browser,
when compared to the pure Javascript version the WebASM version is 10-50x faster!
The surface is rendered as a triangle mesh and combined with the
volume during the volume raycasting step, in a manner roughly similar to shadow mapping.
[Try it out online!](https://www.willusher.io/webgl-marching-cubes/)

To compile the WebAssembly version you'll need [Rust](https://www.rust-lang.org/) and wasm-pack.
After install Rust you can install wasm-pack with `cargo install wasm-pack`.
Then build the WASM code: `wasm-pack build -t web --release`, and
run a local webserver to serve the files.

# Images

![images](https://i.imgur.com/2tvnaYn.png)

1. Install Rust
Open your terminal and run:

bash


curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh




This will download and run the Rust installer.
Press Enter to proceed with the default installation.
When it finishes, it will tell you to add Rust to your $PATH.
Close and reopen your terminal (or run source $HOME/.cargo/env) so the cargo command is available.
2. Check Rust Installation
In your terminal, type:

bash


cargo --version




You should see something like cargo 1.XX.X (date).

3. Now Install wasm-pack
With Rust installed, run:

bash


cargo install wasm-pack




This will download and build wasm-pack (it may take a couple minutes the first time).
4. Continue with the previous steps
Once wasm-pack is installed, you can run:

bash


wasm-pack --version




And then continue with:

bash


wasm-pack build --target web --release




