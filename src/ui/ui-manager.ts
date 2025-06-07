export interface ConfigFields {
    voxelResolution: number;
    numLODLevels: number;
    seed: number;
    zBiasFactor: number;
    isoLevelBias: number;
    dithering: boolean;
    enableCollision: boolean;
    backfaceCulling: boolean;
    tintLODLevels: boolean;
    enableTriplanar: boolean;
    musicVolume: number;
    rootSizeMultiplier: number;
    fadeOverlapFactor: number;
    maxChunks: number;
    maxWorkers: number;
    lodDistanceFactor: number;
}

export const DEFAULTS: ConfigFields = {
    voxelResolution: 32,
    numLODLevels: 8,
    seed: 1337,
    zBiasFactor: -0.00002,
    isoLevelBias: 0.0,
    dithering: true,
    enableCollision: true,
    backfaceCulling: true,
    tintLODLevels: false,
    enableTriplanar: true,
    musicVolume: 0.3,
    rootSizeMultiplier: 32,
    fadeOverlapFactor: 0.35,
    maxChunks: 1024,
    maxWorkers: 8,
    lodDistanceFactor: 4.0
};

export class UIManager {
    private currentConfig: ConfigFields = { ...DEFAULTS };
    private menuVisible = true;
    private onRegenerateCallback?: () => void;
    private onVolumeChangeCallback?: (volume: number) => void;
    private chunkManager?: any;
    private onCollisionToggledCallback?: (enabled: boolean) => void;
    private onBackfaceCullingToggledCallback?: (enabled: boolean) => void;

    constructor() {
        this.setupUI();
        this.attachEventListeners();
    }

    public setChunkManager(chunkManager: any) {
        this.chunkManager = chunkManager;
    }

    public setOnRegenerateCallback(callback: () => void) {
        this.onRegenerateCallback = callback;
    }

    public setOnVolumeChangeCallback(callback: (volume: number) => void) {
        this.onVolumeChangeCallback = callback;
    }

    public setOnCollisionToggledCallback(cb: (enabled: boolean) => void) {
        this.onCollisionToggledCallback = cb;
    }

    public setOnBackfaceCullingToggledCallback(cb: (enabled: boolean) => void) {
        this.onBackfaceCullingToggledCallback = cb;
    }

    public getCurrentConfig(): ConfigFields {
        return { ...this.currentConfig };
    }

    private setupUI() {
        document.body.innerHTML = `
        <div id="fpsCounter" class="fps-counter">FPS: --</div>
        <div id="volumeControl" class="volume-control">
            <span class="volume-icon">🎵</span>
            <input type="range" id="volumeSlider" min="0" max="1" step="0.01" value="${DEFAULTS.musicVolume}">
            <span class="volume-value">${Math.round(DEFAULTS.musicVolume * 100)}%</span>
        </div>
        <button id="openMenuBtn" class="open-menu-btn" ${this.menuVisible ? 'style="display: none;"' : ''}>
            <span class="icon">⚙</span>
            <span class="text">SYSTEM</span>
        </button>
        <div id="menu" class="menu-panel ${this.menuVisible ? '' : 'hidden'}">
            <div class="menu-header" id="menuHeader">
                <span class="menu-title">
                    <span class="icon">⚡</span>
                    <span>NEURAL INTERFACE</span>
                </span>
                <button class="close-btn" id="closeMenuBtn" title="Hide menu">⌃</button>
            </div>
            <div class="menu-content">
                <div class="control-section">
                    <h4><span class="icon">🌍</span>WORLD PARAMETERS</h4>
                    <div class="control-group">
                        <label>Voxel Resolution (finest LOD)</label>
                        <input type="number" id="voxelResolution" min="8" max="128" value="${DEFAULTS.voxelResolution}">
                    </div>
                    <div class="control-group">
                        <label>Number of LOD Levels</label>
                        <input type="number" id="numLODLevels" min="1" max="10" value="${DEFAULTS.numLODLevels}">
                    </div>
                    <div class="control-group">
                        <label>Root Size Multiplier</label>
                        <input type="number" id="rootSizeMultiplier" min="4" max="32" step="1" value="${DEFAULTS.rootSizeMultiplier}">
                        <small style="color: #fb923c; font-size: 9px; margin-top: 2px;">Root octree size = Planet Radius × this value (affects LOD distances)</small>
                    </div>
                    <div class="control-group">
                        <label>LOD Distance Factor</label>
                        <input type="number" id="lodDistanceFactor" min="2.01" max="12" step="0.01" value="${DEFAULTS.lodDistanceFactor}">
                        <small style="color: #fb923c; font-size: 9px; margin-top: 2px;">How far each LOD extends (higher = coarser, lower = denser)</small>
                    </div>
                    <div class="control-group">
                        <label>Fade Overlap Factor</label>
                        <input type="number" id="fadeOverlapFactor" min="0.1" max="0.8" step="0.01" value="${DEFAULTS.fadeOverlapFactor}">
                    </div>
                    <div class="control-group">
                        <label>Max Chunks</label>
                        <input type="number" id="maxChunks" min="256" max="4096" step="1" value="${DEFAULTS.maxChunks}">
                    </div>
                    <div class="control-group">
                        <label>Max Workers</label>
                        <input type="number" id="maxWorkers" min="1" max="8" step="1" value="${DEFAULTS.maxWorkers}">
                    </div>
                    <div class="control-group">
                        <label>Seed</label>
                        <input type="number" id="seed" min="0" max="99999999" value="${DEFAULTS.seed}">
                    </div>
                    <div class="control-group">
                        <label>Z-buffer Bias (per level difference)</label>
                        <input type="number" id="zBiasFactor" min="0" max="0.001" step="0.000001" value="${DEFAULTS.zBiasFactor}">
                        <small style="color: #fb923c; font-size: 9px; margin-top: 2px;">Finest LOD = 0 bias, each coarser level gets this value × level difference</small>
                    </div>
                    <div class="control-group">
                        <label>Iso Level Bias (per level difference)</label>
                        <input type="number" id="isoLevelBias" step="0.01" value="${DEFAULTS.isoLevelBias}">
                        <small style="color: #fb923c; font-size: 9px; margin-top: 2px;">Finest LOD = 0 bias, each coarser level gets this value × level difference</small>
                    </div>
                    <div class="control-group">
                        <button id="regenerateBtn" class="regenerate-btn">
                            <span class="icon">🔄</span>
                            <span>REGENERATE WORLD</span>
                        </button>
                    </div>
                </div>
                <div class="control-section">
                    <h4><span class="icon">🎮</span>DISPLAY SETTINGS</h4>
                    <div class="control-group">
                        <label class="checkbox-label">
                            <input type="checkbox" id="enableCollisionToggle">
                            <span class="checkmark"></span>
                            Enable Terrain Collision
                        </label>
                    </div>
                    <div class="control-group">
                        <label class="checkbox-label">
                            <input type="checkbox" id="backfaceCullingToggle" ${DEFAULTS.backfaceCulling ? "checked" : ""}>
                            <span class="checkmark"></span>
                            Enable Backface Culling
                        </label>
                    </div>
                    <div class="control-group">
                        <label class="checkbox-label">
                            <input type="checkbox" id="tintLODLevelsToggle" ${DEFAULTS.tintLODLevels ? "checked" : ""}>
                            <span class="checkmark"></span>
                            Tint LOD Levels
                        </label>
                    </div>
                    <div class="control-group">
                        <label class="checkbox-label">
                            <input type="checkbox" id="enableTriplanarToggle" ${DEFAULTS.enableTriplanar ? "checked" : ""}>
                            <span class="checkmark"></span>
                            Enable Texturing
                        </label>
                    </div>
                </div>
                <div class="info-panel" id="infoPanel">
                    <div class="info-header">
                        <span class="icon">📊</span>
                        <span>SYSTEM STATUS</span>
                    </div>
                    <div class="info-content">Initializing...</div>
                </div>
            </div>
        </div>
        <canvas id="glcanvas"></canvas>
        `;
        this.loadStyles();
    }

    private loadStyles() {
        const style = document.createElement('style');
        style.textContent = `
            @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700&display=swap');
            * {
                box-sizing: border-box;
                -webkit-user-select: none;
                -moz-user-select: none;
                user-select: none;
                -webkit-touch-callout: none;
            }
            html, body {
                margin: 0;
                padding: 0;
                overflow: hidden;
                background: #000;
                position: fixed;
                width: 100%;
                height: 100%;
                overscroll-behavior: none;
                touch-action: none;
                font-family: 'Orbitron', monospace;
            }
            #glcanvas {
                position: fixed;
                top: 0;
                left: 0;
                width: 100vw;
                height: 100vh;
                background: #000;
                touch-action: none;
            }
            .fps-counter {
                position: fixed;
                bottom: calc(env(safe-area-inset-bottom, 0px) + 16px);
                left: calc(env(safe-area-inset-left, 0px) + 16px);
                font-size: 0.9em;
                font-weight: 400;
                color: #fb923c;
                z-index: 1000;
                pointer-events: none;
                font-family: 'Orbitron', monospace;
                opacity: 0.8;
            }
            .volume-control {
                position: fixed;
                top: calc(env(safe-area-inset-top, 0px) + 16px);
                right: calc(env(safe-area-inset-right, 0px) + 16px);
                z-index: 1000;
                display: flex;
                align-items: center;
                gap: 12px;
                background: rgba(0,0,0,0.4);
                border: 1px solid #fb923c;
                border-radius: 25px;
                padding: 8px 16px;
                font-family: 'Orbitron', monospace;
                color: #fb923c;
                font-size: 14px;
                font-weight: 700;
                backdrop-filter: blur(10px);
                min-width: 200px;
            }
            .volume-icon {
                font-size: 16px;
                user-select: none;
                flex-shrink: 0;
            }
            #volumeSlider {
                width: 120px;
                height: 4px;
                background: rgba(251, 146, 60, 0.3);
                border-radius: 2px;
                outline: none;
                -webkit-appearance: none;
                appearance: none;
                flex-shrink: 0;
            }
            #volumeSlider::-webkit-slider-thumb {
                -webkit-appearance: none;
                appearance: none;
                width: 16px;
                height: 16px;
                background: #fb923c;
                border-radius: 50%;
                cursor: pointer;
                box-shadow: 0 2px 6px rgba(0,0,0,0.3);
            }
            #volumeSlider::-moz-range-thumb {
                width: 16px;
                height: 16px;
                background: #fb923c;
                border-radius: 50%;
                cursor: pointer;
                border: none;
                box-shadow: 0 2px 6px rgba(0,0,0,0.3);
            }
            .volume-value {
                min-width: 40px;
                width: 40px;
                text-align: right;
                user-select: none;
                flex-shrink: 0;
            }
            .open-menu-btn {
                position: fixed;
                top: calc(env(safe-area-inset-top, 0px) + 20px);
                left: calc(env(safe-area-inset-left, 0px) + 20px);
                z-index: 1001;
                background: rgba(10, 10, 10, 0.85);
                color: #fb923c;
                border: 1.5px solid #fb923c;
                border-radius: 8px;
                padding: 10px 20px;
                cursor: pointer;
                font-family: 'Orbitron', monospace;
                font-weight: 700;
                font-size: 14px;
                transition: background 0.2s, border-color 0.2s;
                touch-action: manipulation;
                display: flex;
                align-items: center;
                gap: 8px;
                box-shadow: 0 2px 12px rgba(0,0,0,0.07);
            }
            .open-menu-btn:hover {
                background: rgba(251, 146, 60, 0.12);
                border-color: #fb923c;
            }
            .menu-panel {
                position: fixed;
                top: calc(env(safe-area-inset-top, 0px) + 20px);
                left: calc(env(safe-area-inset-left, 0px) + 20px);
                background: rgba(0, 0, 0, 0.15);
                border: 1.5px solid #fb923c;
                border-radius: 10px;
                min-width: 320px;
                max-width: 380px;
                max-height: calc(100vh - env(safe-area-inset-top, 20px) - env(safe-area-inset-bottom, 20px) - 40px);
                max-height: calc(100dvh - env(safe-area-inset-top, 20px) - env(safe-area-inset-bottom, 20px) - 40px);
                overflow: hidden;
                z-index: 1002;
                color: #e0e0e0;
                font-family: 'Orbitron', monospace;
                transition: transform 0.3s ease, opacity 0.3s ease;
                box-shadow: 0 8px 32px rgba(0,0,0,0.22);
            }
            .menu-panel.hidden {
                transform: translateX(-100%);
                opacity: 0;
                pointer-events: none;
            }
            .menu-header {
                background: rgba(251, 146, 60, 0.92);
                color: #000;
                padding: 12px 20px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                transition: background 0.2s;
                font-family: 'Orbitron', monospace;
                font-size: 15px;
                font-weight: 700;
                border-radius: 9px 9px 0 0;
                border-bottom: 1px solid #fb923c;
                position: relative;
            }
            .menu-title {
                font-weight: 700;
                font-size: 15px;
                display: flex;
                align-items: center;
                gap: 8px;
                letter-spacing: 0.05em;
            }
            .close-btn {
                background: rgba(0,0,0,0.04);
                border: 1.5px solid #fb923c;
                color: #fb923c;
                cursor: pointer;
                font-size: 18px;
                display: flex;
                align-items: center;
                justify-content: center;
                font-family: 'Orbitron', monospace;
                border-radius: 50%;
                padding: 2px 7px;
                margin-left: 12px;
                transition: background 0.2s, color 0.2s, border-color 0.2s, transform 0.1s;
                touch-action: manipulation;
                height: 32px;
                width: 32px;
                box-sizing: border-box;
            }
            .close-btn:hover {
                background: #fb923c;
                color: #000;
                border-color: #fb923c;
                transform: scale(1.15);
            }
            .menu-content {
                max-height: calc(100vh - 100px);
                max-height: calc(100dvh - 100px);
                overflow-y: auto;
                padding: 12px;
                touch-action: pan-y;
                -webkit-overflow-scrolling: touch;
            }
            .control-section {
                margin-bottom: 12px;
                border: 1px solid rgba(251, 146, 60, 0.3);
                border-radius: 7px;
                padding: 12px;
                background: rgba(0, 0, 0, 0.2);
            }
            .control-section h4 {
                margin: 0 0 12px 0;
                font-size: 13px;
                font-weight: 700;
                color: #fb923c;
                border-bottom: 1px solid rgba(251, 146, 60, 0.3);
                padding-bottom: 6px;
                display: flex;
                align-items: center;
                gap: 8px;
            }
            .control-group {
                margin-bottom: 12px;
                display: flex;
                flex-direction: column;
                gap: 4px;
            }
            .control-group:last-child {
                margin-bottom: 0;
            }
            .control-group label {
                font-size: 11px;
                font-weight: 400;
                color: #e0e0e0;
                -webkit-user-select: text;
                -moz-user-select: text;
                user-select: text;
            }
            .control-group input[type="number"] {
                padding: 6px 8px;
                background: rgba(0, 0, 0, 0.5);
                border: 1px solid rgba(251, 146, 60, 0.5);
                border-radius: 4px;
                color: #e0e0e0;
                font-family: 'Orbitron', monospace;
                font-size: 11px;
                touch-action: manipulation;
                -webkit-user-select: text;
                -moz-user-select: text;
                user-select: text;
            }
            .control-group input[type="number"]:focus {
                outline: none;
                border-color: #fb923c;
            }
            .regenerate-btn {
                width: 100%;
                padding: 8px 12px;
                background: rgba(0, 0, 0, 0.5);
                border: 1px solid rgba(251, 146, 60, 0.5);
                border-radius: 4px;
                color: #e0e0e0;
                font-family: 'Orbitron', monospace;
                font-weight: 700;
                font-size: 11px;
                cursor: pointer;
                touch-action: manipulation;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 8px;
                transition: border-color 0.2s;
            }
            .regenerate-btn:hover {
                border-color: #fb923c;
            }
            .regenerate-btn.active {
                background: #fb923c;
                color: #000;
                border-color: #fb923c;
            }
            .checkbox-label {
                display: flex !important;
                align-items: center;
                gap: 8px;
                cursor: pointer;
                font-size: 11px;
                position: relative;
            }
            .checkbox-label input[type="checkbox"] {
                opacity: 0;
                position: absolute;
                width: 16px;
                height: 16px;
            }
            .checkmark {
                width: 16px;
                height: 16px;
                border: 1px solid #fb923c;
                background: rgba(0, 0, 0, 0.8);
                position: relative;
                flex-shrink: 0;
            }
            .checkbox-label input[type="checkbox"]:checked + .checkmark {
                background: #fb923c;
            }
            .checkbox-label input[type="checkbox"]:checked + .checkmark::after {
                content: "✓";
                position: absolute;
                top: -2px;
                left: 3px;
                color: #000;
                font-size: 12px;
                font-family: 'Orbitron', monospace;
            }
            .info-panel {
                background: rgba(0, 0, 0, 0.3);
                border: 1px solid rgba(251, 146, 60, 0.3);
                border-radius: 6px;
                padding: 12px;
                font-size: 10px;
                line-height: 1.4;
            }
            .info-header {
                font-weight: 700;
                color: #fb923c;
                margin-bottom: 8px;
                display: flex;
                align-items: center;
                gap: 8px;
            }
            .info-content div {
                margin-bottom: 2px;
                color: rgba(224, 224, 224, 0.9);
                -webkit-user-select: text;
                -moz-user-select: text;
                user-select: text;
            }
            
            /* NEW: LOD color square styling */
            .lod-stat {
                display: flex;
                align-items: center;
                gap: 6px;
                margin-bottom: 2px;
            }
            .lod-color-square {
                width: 12px;
                height: 12px;
                border: 1px solid rgba(251, 146, 60, 0.5);
                border-radius: 2px;
                flex-shrink: 0;
                display: inline-block;
            }
            .lod-num {
                color: #fb923c;
                font-weight: 700;
                min-width: 20px;
            }
            .lod-bias {
                color: rgba(224, 224, 224, 0.7);
                font-size: 9px;
            }
            
            @media (max-width: 768px) {
                .fps-counter {
                    bottom: calc(env(safe-area-inset-bottom, 0px) + 10px);
                    left: calc(env(safe-area-inset-left, 0px) + 10px);
                    font-size: 0.8em;
                }
                .volume-control {
                    top: calc(env(safe-area-inset-top, 0px) + 10px);
                    right: calc(env(safe-area-inset-right, 0px) + 10px);
                    padding: 10px 14px;
                    min-width: 180px;
                }
                #volumeSlider {
                    width: 100px;
                }
                .volume-value {
                    min-width: 35px;
                    width: 35px;
                }
                .menu-panel {
                    top: calc(env(safe-area-inset-top, 0px) + 10px);
                    left: calc(env(safe-area-inset-left, 0px) + 10px);
                    right: calc(env(safe-area-inset-right, 0px) + 10px);
                    min-width: auto;
                    max-width: none;
                    max-height: calc(100vh - env(safe-area-inset-top, 10px) - env(safe-area-inset-bottom, 10px) - 20px);
                    max-height: calc(100dvh - env(safe-area-inset-top, 10px) - env(safe-area-inset-bottom, 10px) - 20px);
                    padding: 15px;
                }
                .open-menu-btn {
                    top: calc(env(safe-area-inset-top, 0px) + 10px);
                    left: calc(env(safe-area-inset-left, 0px) + 10px);
                    padding: 12px 18px;
                    font-size: 15px;
                }
                .control-group input[type="number"] {
                    padding: 12px;
                    font-size: 16px;
                }
                .checkbox-label {
                    gap: 12px;
                }
                .checkmark {
                    width: 20px;
                    height: 20px;
                }
                .lod-color-square {
                    width: 14px;
                    height: 14px;
                }
            }
            .menu-content::-webkit-scrollbar {
                width: 4px;
            }
            .menu-content::-webkit-scrollbar-track {
                background: rgba(0, 0, 0, 0.2);
            }
            .menu-content::-webkit-scrollbar-thumb {
                background: #fb923c;
                border-radius: 2px;
            }
        `;
        document.head.appendChild(style);
    }

    private attachEventListeners() {
        document.getElementById("openMenuBtn")!.addEventListener("click", () => this.toggleMenu());
        document.getElementById("closeMenuBtn")!.addEventListener("click", (e) => {
            e.stopPropagation();
            this.toggleMenu();
        });
        document.getElementById("menuHeader")!.addEventListener("click", () => this.toggleMenu());
        document.addEventListener("keydown", (e) => {
            if (e.key === "Tab") {
                e.preventDefault();
                this.toggleMenu();
            }
        });

        const volumeSlider = document.getElementById("volumeSlider") as HTMLInputElement;
        const volumeValue = document.querySelector(".volume-value") as HTMLElement;
        volumeSlider.addEventListener("input", () => {
            const volume = parseFloat(volumeSlider.value);
            this.currentConfig.musicVolume = volume;
            volumeValue.textContent = `${Math.round(volume * 100)}%`;
            if (this.onVolumeChangeCallback) {
                this.onVolumeChangeCallback(volume);
            }
        });

        const fields = [
            "voxelResolution",
            "numLODLevels",
            "seed",
            "zBiasFactor",
            "isoLevelBias",
            "rootSizeMultiplier",
            "fadeOverlapFactor",
            "lodDistanceFactor",
            "maxChunks",
            "maxWorkers"
        ] as const;
        fields.forEach(field => {
            const el = document.getElementById(field) as HTMLInputElement;
            el.addEventListener("input", () => {
                this.currentConfig[field] = Number(el.value);
                this.updateRegenerateBtn();
            });
        });
        document.getElementById("regenerateBtn")!.addEventListener("click", () => {
            if (this.onRegenerateCallback) {
                this.onRegenerateCallback();
            }
            this.updateRegenerateBtn();
        });
        const enableCollisionToggle = document.getElementById("enableCollisionToggle") as HTMLInputElement;
        enableCollisionToggle.checked = this.currentConfig.enableCollision;
        enableCollisionToggle.addEventListener("change", () => {
            this.currentConfig.enableCollision = enableCollisionToggle.checked;
            if (this.onCollisionToggledCallback) {
                this.onCollisionToggledCallback(enableCollisionToggle.checked);
            }
        });
        const backfaceCullingToggle = document.getElementById("backfaceCullingToggle") as HTMLInputElement;
        backfaceCullingToggle.checked = this.currentConfig.backfaceCulling;
        backfaceCullingToggle.addEventListener("change", () => {
            this.currentConfig.backfaceCulling = backfaceCullingToggle.checked;
            if (this.onBackfaceCullingToggledCallback) {
                this.onBackfaceCullingToggledCallback(backfaceCullingToggle.checked);
            }
        });
        const tintLODToggle = document.getElementById("tintLODLevelsToggle") as HTMLInputElement;
        tintLODToggle.addEventListener("change", () => {
            this.currentConfig.tintLODLevels = tintLODToggle.checked;
        });
        const enableTriplanarToggle = document.getElementById("enableTriplanarToggle") as HTMLInputElement;
        enableTriplanarToggle.addEventListener("change", () => {
            this.currentConfig.enableTriplanar = enableTriplanarToggle.checked;
        });
    }

    private toggleMenu() {
        this.menuVisible = !this.menuVisible;
        const menu = document.getElementById("menu")!;
        const openBtn = document.getElementById("openMenuBtn")!;
        if (this.menuVisible) {
            menu.classList.remove("hidden");
            openBtn.style.display = "none";
        } else {
            menu.classList.add("hidden");
            openBtn.style.display = "flex";
        }
    }

    private updateRegenerateBtn() {
        const changed = Object.keys(DEFAULTS).some(key =>
            this.currentConfig[key as keyof ConfigFields] !== DEFAULTS[key as keyof ConfigFields]
        );
        const btn = document.getElementById("regenerateBtn")!;
        btn.classList.toggle("active", changed);
    }

    public updateInfoPanel() {
        if (!this.chunkManager) return;
        const stats = this.chunkManager.getStats();
        const config = this.getCurrentConfig();

        const infoContent = document.querySelector('.info-content');
        if (infoContent) {
            const levelCounts = stats.levelCounts || [];
            const maxLevel = stats.maxLevel || 0;
            const perLevelIsoBias = config.isoLevelBias;
            const perLevelZBias = config.zBiasFactor;
            const colorRGB = [
                [255, 255, 255], [255, 0, 0], [0, 0, 255], [0, 255, 0],
                [255, 0, 255], [255, 255, 0], [0, 255, 255], [255, 128, 0],
                [128, 0, 255], [128, 255, 0]
            ];
            const lodRows = levelCounts.map((count: number, index: number) => {
                const finestLevel = maxLevel;
                const levelDifference = finestLevel - index;
                const actualIsoBias = levelDifference * perLevelIsoBias;
                const actualZBias = levelDifference * perLevelZBias;
                const isoBiasStr = actualIsoBias > 0 ? `+${actualIsoBias.toFixed(2)}` : actualIsoBias.toFixed(2);
                const zBiasStr = actualZBias.toExponential(1);
                const invertedLevel = finestLevel - index;
                const rgb = colorRGB[invertedLevel % colorRGB.length];
                const colorStyle = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
                return `<div class="lod-stat">
                    <span class="lod-color-square" style="background-color: ${colorStyle}"></span>
                    L${index}: <span class="lod-num">${count}</span> 
                    <span class="lod-bias">(iso:${isoBiasStr}, z:${zBiasStr})</span>
                </div>`;
            }).join("");
            infoContent.innerHTML = `
                <div class="stat-row"><b>Total Nodes:</b> <span class="stat-num">${stats.totalNodes || 0}</span></div>
                <div class="stat-row"><b>Leaf Nodes:</b> <span class="stat-num">${stats.leafNodes || 0}</span></div>
                <div class="stat-row"><b>Visible:</b> <span class="stat-num">${stats.visibleNodes || 0}</span></div>
                <div class="stat-row"><b>Generating:</b> <span class="stat-num">${stats.pendingGeneration || 0}</span></div>
                <div class="stat-row"><b>Queue:</b> <span class="stat-num">${stats.queueLength || 0}</span></div>
                <div class="lod-row-label"><b>Octree Levels</b></div>
                <div class="lod-vertical-row">${lodRows}</div>
                <div class="workers-row"><b>Workers:</b> <span style="color:#fb923c">${stats.workers?.busyWorkers || 0}</span> / ${stats.workers?.totalWorkers || 0}</div>
                <div class="stat-row"><b>Memory:</b> <span class="stat-num">${(stats.memoryUsageMB || 0).toFixed(1)}MB</span></div>
                <div class="stat-row"><b>Root Ready:</b> <span class="stat-num">${stats.rootInitialized ? 'Yes' : 'No'}</span></div>
            `;
        }
    }

    public updateFPS(fps: number) {
        const fpsCounter = document.getElementById("fpsCounter");
        if (fpsCounter) {
            fpsCounter.textContent = `FPS: ${fps.toFixed(1)}`;
        }
    }
}