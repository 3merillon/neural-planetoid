import { ProceduralMusicGenerator, type MusicConfig } from './procedural-music-generator';

export class AudioManager {
    private musicGenerator: ProceduralMusicGenerator | null = null;
    private isInitialized: boolean = false;
    private pendingStart: boolean = false;

    constructor() {}

    public async initialize(seed: number): Promise<void> {
        if (this.isInitialized) return;

        const config: MusicConfig = {
            seed: seed,
            volume: 0.3,
            tempo: 75 + Math.floor((seed % 1000) / 10), // Tempo varies with seed
            key: 'A',
            scale: this.getScaleFromSeed(seed)
        };

        this.musicGenerator = new ProceduralMusicGenerator(config);
        this.isInitialized = true;

        if (this.pendingStart) {
            await this.startMusic();
            this.pendingStart = false;
        }
    }

    private getScaleFromSeed(seed: number): 'minor' | 'dorian' | 'phrygian' | 'mixolydian' | 'pentatonic' | 'blues' {
        const scales: Array<'minor' | 'dorian' | 'phrygian' | 'mixolydian' | 'pentatonic' | 'blues'> = 
            ['minor', 'dorian', 'phrygian', 'mixolydian', 'pentatonic', 'blues'];
        return scales[seed % scales.length];
    }

    public async startMusic(): Promise<void> {
        if (!this.isInitialized || !this.musicGenerator) {
            this.pendingStart = true;
            return;
        }

        try {
            await this.musicGenerator.start();
            //console.log('Enhanced procedural music started');
        } catch (error) {
            //console.warn('Failed to start music:', error);
        }
    }

    public stopMusic(): void {
        if (this.musicGenerator) {
            this.musicGenerator.stop();
        }
    }

    public setVolume(volume: number): void {
        if (this.musicGenerator) {
            this.musicGenerator.setVolume(volume);
        }
    }

    public getVolume(): number {
        return this.musicGenerator ? this.musicGenerator.getVolume() : 0.3;
    }

    public setSeed(seed: number): void {
        if (this.musicGenerator) {
            // Update tempo based on seed
            const newTempo = 75 + Math.floor((seed % 1000) / 10);
            this.musicGenerator.setTempo(newTempo);
            this.musicGenerator.setSeed(seed);
        }
    }

    public setTempo(tempo: number): void {
        if (this.musicGenerator) {
            this.musicGenerator.setTempo(tempo);
        }
    }

    public isPlaying(): boolean {
        return this.musicGenerator ? this.musicGenerator.isActive() : false;
    }

    public cleanup(): void {
        if (this.musicGenerator) {
            this.musicGenerator.stop();
        }
        this.isInitialized = false;
        this.musicGenerator = null;
    }
}