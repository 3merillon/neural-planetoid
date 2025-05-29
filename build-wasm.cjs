const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const rustDir = path.join(__dirname, 'rust', 'marching-cubes');
const outDir = path.join(__dirname, 'src', 'gl', 'marching-cubes-wasm');

console.log('Building Rust WASM...');
execSync('wasm-pack build --release --target bundler --out-dir pkg', { cwd: rustDir, stdio: 'inherit' });

console.log('Copying WASM artifacts...');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

fs.copyFileSync(path.join(rustDir, 'pkg', 'marching_cubes_bg.wasm'), path.join(outDir, 'marching_cubes_bg.wasm'));
fs.copyFileSync(path.join(rustDir, 'pkg', 'marching_cubes.js'), path.join(outDir, 'marching_cubes.js'));
fs.copyFileSync(path.join(rustDir, 'pkg', 'marching_cubes.d.ts'), path.join(outDir, 'marching_cubes.d.ts'));

console.log('Done.');