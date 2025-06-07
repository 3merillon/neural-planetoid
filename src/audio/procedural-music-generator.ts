export interface MusicConfig {
    seed: number;
    volume: number;
    tempo: number;
    key: string;
    scale: 'minor' | 'dorian' | 'phrygian' | 'mixolydian' | 'pentatonic' | 'blues';
}

export class ProceduralMusicGenerator {
    private audioContext!: AudioContext;
    private masterGain!: GainNode;
    private compressor!: DynamicsCompressorNode;
    private reverb!: ConvolverNode;
    private delay!: DelayNode;
    private delayFeedback!: GainNode;
    private delayWet!: GainNode;
    private filter!: BiquadFilterNode;
    private filter2!: BiquadFilterNode;
    private chorus!: DelayNode;
    private chorusLFO!: OscillatorNode;
    private chorusGain!: GainNode;
    private isPlaying: boolean = false;
    private config: MusicConfig;
    private oscillators: OscillatorNode[] = [];
    private envelopes: GainNode[] = [];
    private sequencePosition: number = 0;
    private nextNoteTime: number = 0;
    private lookahead: number = 25.0;
    private scheduleAheadTime: number = 0.1;
    private timerID: number = 0;
    private rng!: () => number;
    private currentKey: number = 0;
    private currentScale: number[] = [];
    private harmonicProgression: number[] = [];
    private sectionLength: number = 32;
    private currentSection: number = 0;
    private modulationTarget: number = 0;
    private isModulating: boolean = false;
    private instrumentTypes: string[] = ['lead', 'pad', 'bass', 'arp', 'pluck'];
    private currentInstruments: Map<string, any> = new Map();

    private readonly scales = {
        minor: [0, 2, 3, 5, 7, 8, 10],
        dorian: [0, 2, 3, 5, 7, 9, 10],
        phrygian: [0, 1, 3, 5, 7, 8, 10],
        mixolydian: [0, 2, 4, 5, 7, 9, 10],
        pentatonic: [0, 2, 4, 7, 9],
        blues: [0, 3, 5, 6, 7, 10]
    } as const;

    private readonly chordProgressions = [
        [0, 5, 6, 4],
        [0, 3, 6, 5],
        [0, 6, 4, 5],
        [0, 4, 5, 6],
        [0, 2, 5, 3],
        [0, 4, 6, 2],
        [0, 1, 4, 5],
        [0, 6, 2, 4],
    ] as const;

    private readonly modulations = [
        0, 5, 7, -5, 2, -2, 3, -3
    ];

    constructor(config: MusicConfig) {
        this.config = { ...config };
        this.setupSeededRandom(config.seed);
        this.initializeMusicalSystem();
        this.initializeAudioContext();
    }

    private setupSeededRandom(seed: number): void {
        let s = seed;
        this.rng = () => {
            s = Math.sin(s) * 10000;
            return s - Math.floor(s);
        };
    }

    private initializeMusicalSystem(): void {
        this.currentKey = 0;
        this.currentScale = [...this.scales[this.config.scale]];
        this.harmonicProgression = [...this.chordProgressions[Math.floor(this.rng() * this.chordProgressions.length)]];
        this.sectionLength = 16 + Math.floor(this.rng() * 32);
        this.currentSection = 0;
        this.modulationTarget = 0;
        this.isModulating = false;
        this.initializeInstruments();
    }

    private initializeInstruments(): void {
        this.currentInstruments.clear();
        this.currentInstruments.set('lead', {
            type: this.rng() > 0.5 ? 'sawtooth' : 'square',
            octave: 5 + Math.floor(this.rng() * 2),
            detune: 5 + this.rng() * 10,
            attack: 0.01 + this.rng() * 0.1,
            decay: 0.1 + this.rng() * 0.3,
            sustain: 0.3 + this.rng() * 0.4,
            release: 0.2 + this.rng() * 0.8,
            filterFreq: 1000 + this.rng() * 2000,
            resonance: 1 + this.rng() * 10
        });
        this.currentInstruments.set('pad', {
            type: 'sine',
            octave: 4 + Math.floor(this.rng() * 2),
            detune: 2 + this.rng() * 5,
            attack: 0.5 + this.rng() * 1.5,
            decay: 0.5 + this.rng() * 1.0,
            sustain: 0.6 + this.rng() * 0.3,
            release: 1.0 + this.rng() * 3.0,
            filterFreq: 500 + this.rng() * 1500,
            resonance: 0.5 + this.rng() * 2
        });
        this.currentInstruments.set('bass', {
            type: this.rng() > 0.7 ? 'triangle' : 'sawtooth',
            octave: 2,
            detune: 1 + this.rng() * 3,
            attack: 0.01 + this.rng() * 0.05,
            decay: 0.1 + this.rng() * 0.2,
            sustain: 0.7 + this.rng() * 0.2,
            release: 0.1 + this.rng() * 0.3,
            filterFreq: 200 + this.rng() * 400,
            resonance: 2 + this.rng() * 8
        });
        this.currentInstruments.set('arp', {
            type: this.rng() > 0.3 ? 'square' : 'triangle',
            octave: 6 + Math.floor(this.rng() * 2),
            detune: 3 + this.rng() * 7,
            attack: 0.01 + this.rng() * 0.03,
            decay: 0.05 + this.rng() * 0.15,
            sustain: 0.1 + this.rng() * 0.3,
            release: 0.1 + this.rng() * 0.4,
            pattern: Math.floor(this.rng() * 4),
            speed: 0.125 + this.rng() * 0.25
        });
        this.currentInstruments.set('pluck', {
            type: 'triangle',
            octave: 4 + Math.floor(this.rng() * 3),
            detune: 2 + this.rng() * 5,
            attack: 0.001 + this.rng() * 0.01,
            decay: 0.05 + this.rng() * 0.2,
            sustain: 0.0,
            release: 0.1 + this.rng() * 0.5,
            filterFreq: 800 + this.rng() * 2200,
            resonance: 3 + this.rng() * 7
        });
    }

    private initializeAudioContext(): void {
        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        this.masterGain = this.audioContext.createGain();
        this.masterGain.gain.value = this.config.volume;
        this.setupEffectsChain();
        this.masterGain.connect(this.audioContext.destination);
    }

    private setupEffectsChain(): void {
        this.compressor = this.audioContext.createDynamicsCompressor();
        this.compressor.threshold.value = -18;
        this.compressor.knee.value = 30;
        this.compressor.ratio.value = 8;
        this.compressor.attack.value = 0.003;
        this.compressor.release.value = 0.25;
        this.filter = this.audioContext.createBiquadFilter();
        this.filter.type = 'lowpass';
        this.filter.frequency.value = 2000;
        this.filter.Q.value = 1;
        this.filter2 = this.audioContext.createBiquadFilter();
        this.filter2.type = 'highpass';
        this.filter2.frequency.value = 80;
        this.filter2.Q.value = 0.7;
        this.chorus = this.audioContext.createDelay(0.05);
        this.chorus.delayTime.value = 0.02;
        this.chorusLFO = this.audioContext.createOscillator();
        this.chorusLFO.type = 'sine';
        this.chorusLFO.frequency.value = 0.5;
        this.chorusGain = this.audioContext.createGain();
        this.chorusGain.gain.value = 0.005;
        this.chorusLFO.connect(this.chorusGain);
        this.chorusGain.connect(this.chorus.delayTime);
        this.chorusLFO.start();
        this.reverb = this.audioContext.createConvolver();
        this.createImpulseResponse();
        this.delay = this.audioContext.createDelay(1.0);
        this.delay.delayTime.value = 0.25 + this.rng() * 0.25;
        this.delayFeedback = this.audioContext.createGain();
        this.delayFeedback.gain.value = 0.25 + this.rng() * 0.2;
        this.delayWet = this.audioContext.createGain();
        this.delayWet.gain.value = 0.15 + this.rng() * 0.1;
        this.delay.connect(this.delayFeedback);
        this.delayFeedback.connect(this.delay);
        this.delay.connect(this.delayWet);
        this.filter.connect(this.filter2);
        this.filter2.connect(this.chorus);
        this.chorus.connect(this.compressor);
        this.compressor.connect(this.reverb);
        this.reverb.connect(this.masterGain);
        this.delayWet.connect(this.masterGain);
    }

    private createImpulseResponse(): void {
        const length = this.audioContext.sampleRate * (2 + this.rng() * 2);
        const impulse = this.audioContext.createBuffer(2, length, this.audioContext.sampleRate);
        for (let channel = 0; channel < 2; channel++) {
            const channelData = impulse.getChannelData(channel);
            for (let i = 0; i < length; i++) {
                const decay = Math.pow(1 - i / length, 1.5 + this.rng());
                channelData[i] = (this.rng() * 2 - 1) * decay * 0.08;
            }
        }
        this.reverb.buffer = impulse;
    }

    private noteToFrequency(note: number, octave: number = 4): number {
        return 440 * Math.pow(2, ((note + this.currentKey) + (octave - 4) * 12) / 12);
    }

    private createSynth(config: any): { osc: OscillatorNode, envelope: GainNode, filter?: BiquadFilterNode } {
        const osc = this.audioContext.createOscillator();
        osc.type = config.type;
        const envelope = this.audioContext.createGain();
        envelope.gain.value = 0;
        let filter: BiquadFilterNode | undefined;
        if (config.filterFreq) {
            filter = this.audioContext.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.value = config.filterFreq;
            filter.Q.value = config.resonance || 1;
            osc.connect(filter);
            filter.connect(envelope);
        } else {
            osc.connect(envelope);
        }
        return { osc, envelope, filter };
    }

    private triggerSynth(synth: any, frequency: number, startTime: number, duration: number, config: any): void {
        const currentTime = this.audioContext.currentTime;
        const safeStartTime = Math.max(startTime, currentTime + 0.01);
        const safeDuration = Math.max(duration, 0.1);
        synth.osc.frequency.value = frequency * (1 + (this.rng() * 2 - 1) * config.detune * 0.01);
        const attack = Math.max(config.attack, 0.001);
        const decay = Math.max(config.decay, 0.001);
        const sustain = Math.max(0, Math.min(1, config.sustain));
        const release = Math.max(config.release, 0.001);
        const attackEndTime = safeStartTime + attack;
        const decayEndTime = attackEndTime + decay;
        const sustainDuration = Math.max(safeDuration - attack - decay - release, 0.01);
        const releaseStartTime = safeStartTime + attack + decay + sustainDuration;
        const endTime = releaseStartTime + release;
        const times = [safeStartTime, attackEndTime, decayEndTime, releaseStartTime, endTime];
        let allTimesValid = true;
        for (let i = 1; i < times.length; i++) {
            if (times[i] <= times[i-1] || times[i] < currentTime) {
                allTimesValid = false;
                break;
            }
        }
        try {
            if (allTimesValid) {
                synth.envelope.gain.cancelScheduledValues(safeStartTime);
                synth.envelope.gain.setValueAtTime(0, safeStartTime);
                synth.envelope.gain.linearRampToValueAtTime(1, attackEndTime);
                synth.envelope.gain.linearRampToValueAtTime(sustain, decayEndTime);
                synth.envelope.gain.setValueAtTime(sustain, releaseStartTime);
                synth.envelope.gain.linearRampToValueAtTime(0, endTime);
            } else {
                synth.envelope.gain.cancelScheduledValues(safeStartTime);
                synth.envelope.gain.setValueAtTime(0, safeStartTime);
                synth.envelope.gain.linearRampToValueAtTime(sustain, safeStartTime + 0.1);
                synth.envelope.gain.linearRampToValueAtTime(0, safeStartTime + safeDuration);
            }
            synth.osc.start(safeStartTime);
            synth.osc.stop(safeStartTime + safeDuration);
        } catch (error) {
            return;
        }
    }

    private playInstrument(instrumentName: string, notes: number[], startTime: number, duration: number): void {
        const config = this.currentInstruments.get(instrumentName);
        if (!config) return;
        const currentTime = this.audioContext.currentTime;
        const safeStartTime = Math.max(startTime, currentTime + 0.02);
        const safeDuration = Math.max(duration, 0.15);
        notes.forEach((note, index) => {
            const frequency = this.noteToFrequency(note, config.octave);
            const synth = this.createSynth(config);
            synth.envelope.connect(this.filter);
            synth.envelope.connect(this.delay);
            const noteStartTime = safeStartTime + (index * 0.02);
            this.triggerSynth(synth, frequency, noteStartTime, safeDuration, config);
            this.oscillators.push(synth.osc);
            this.envelopes.push(synth.envelope);
            setTimeout(() => {
                const oscIndex = this.oscillators.indexOf(synth.osc);
                if (oscIndex > -1) {
                    this.oscillators.splice(oscIndex, 1);
                    const envIndex = this.envelopes.indexOf(synth.envelope);
                    if (envIndex > -1) {
                        this.envelopes.splice(envIndex, 1);
                    }
                }
            }, (safeDuration + 1) * 1000);
        });
    }

    private playArpeggioPattern(notes: number[], startTime: number, beatLength: number): void {
        const config = this.currentInstruments.get('arp');
        if (!config || this.rng() > 0.7) return;
        const patterns = [
            [0, 1, 2, 1],
            [0, 2, 1, 2],
            [0, 1, 2, 3],
            [2, 1, 0, 1],
            [0, 2, 1, 3],
        ];
        const pattern = patterns[config.pattern % patterns.length];
        const noteLength = Math.max(beatLength * config.speed, 0.1);
        const currentTime = this.audioContext.currentTime;
        const safeStartTime = Math.max(startTime, currentTime + 0.02);
        pattern.forEach((patternIndex, step) => {
            if (patternIndex < notes.length) {
                const note = notes[patternIndex];
                const timing = safeStartTime + (step * noteLength);
                if (timing > currentTime) {
                    this.playInstrument('arp', [note], timing, noteLength * 0.8);
                }
            }
        });
    }

    private checkForModulation(): void {
        if (this.sequencePosition % this.sectionLength === 0 && this.sequencePosition > 0) {
            this.currentSection++;
            if (this.rng() > 0.7 && !this.isModulating) {
                this.isModulating = true;
                this.modulationTarget = this.modulations[Math.floor(this.rng() * this.modulations.length)];
                this.harmonicProgression = [...this.chordProgressions[Math.floor(this.rng() * this.chordProgressions.length)]];
            } else if (this.isModulating) {
                this.currentKey += this.modulationTarget;
                this.isModulating = false;
                this.modulationTarget = 0;
                if (this.rng() > 0.6) {
                    this.initializeInstruments();
                }
            }
            this.sectionLength = 16 + Math.floor(this.rng() * 32);
        }
    }

    private scheduleNote(): void {
        this.checkForModulation();
        const beatLength = Math.max(60.0 / this.config.tempo, 0.25);
        const currentTime = this.audioContext.currentTime;
        if (this.nextNoteTime <= currentTime + 0.05) {
            this.nextNoteTime = currentTime + 0.1;
        }
        const progressionIndex = Math.floor(this.sequencePosition / 4) % this.harmonicProgression.length;
        const chordRoot = this.harmonicProgression[progressionIndex];
        const chord = [
            this.currentScale[chordRoot % this.currentScale.length],
            this.currentScale[(chordRoot + 2) % this.currentScale.length],
            this.currentScale[(chordRoot + 4) % this.currentScale.length]
        ];
        if (this.rng() > 0.7) {
            chord.push(this.currentScale[(chordRoot + 6) % this.currentScale.length]);
        }
        const currentBeat = this.sequencePosition % 4;
        if (currentBeat === 0) {
            this.playInstrument('pad', chord, this.nextNoteTime, beatLength * 4);
            this.playInstrument('bass', [chord[0]], this.nextNoteTime, beatLength * 0.8);
            if (this.rng() > 0.4) {
                this.playInstrument('lead', [chord[0] + 12], this.nextNoteTime + 0.05, beatLength * 2);
            }
        } else if (currentBeat === 1) {
            if (this.rng() > 0.6) {
                this.playInstrument('bass', [chord[0] + 7], this.nextNoteTime, beatLength * 0.4);
            }
            if (this.rng() > 0.5) {
                const melodyNote = this.currentScale[Math.floor(this.rng() * this.currentScale.length)];
                this.playInstrument('pluck', [melodyNote + 12], this.nextNoteTime + 0.03, beatLength * 0.3);
            }
        } else if (currentBeat === 2) {
            this.playInstrument('lead', chord.slice(0, 2), this.nextNoteTime, beatLength);
            this.playArpeggioPattern(chord, this.nextNoteTime + 0.02, beatLength);
        } else if (currentBeat === 3) {
            if (this.rng() > 0.3) {
                const leadNotes = [
                    this.currentScale[Math.floor(this.rng() * this.currentScale.length)] + 12,
                    this.currentScale[Math.floor(this.rng() * this.currentScale.length)] + 12
                ];
                this.playInstrument('lead', leadNotes, this.nextNoteTime, beatLength * 0.6);
            }
        }
        const filterFreq = 300 + Math.sin(this.sequencePosition * 0.05) * 1500 +
                        Math.sin(this.sequencePosition * 0.13) * 800 + this.rng() * 400;
        this.filter.frequency.setTargetAtTime(Math.max(200, filterFreq), this.nextNoteTime, 0.1);
        if (this.sequencePosition % 16 === 0) {
            const newDelayTime = 0.125 + this.rng() * 0.375;
            this.delay.delayTime.setTargetAtTime(newDelayTime, this.nextNoteTime, 0.5);
        }
        this.nextNoteTime += beatLength;
        this.sequencePosition++;
    }

    private scheduler(): void {
        if (!this.isPlaying) return;
        try {
            while (this.nextNoteTime < this.audioContext.currentTime + this.scheduleAheadTime) {
                this.scheduleNote();
            }
        } catch (error) {}
        this.timerID = window.setTimeout(() => this.scheduler(), this.lookahead);
    }

    public async start(): Promise<void> {
        try {
            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
            }
            if (!this.isPlaying) {
                this.isPlaying = true;
                this.nextNoteTime = this.audioContext.currentTime + 0.2;
                this.sequencePosition = 0;
                this.scheduler();
            }
        } catch (error) {}
    }

    public stop(): void {
        this.isPlaying = false;
        if (this.timerID) {
            clearTimeout(this.timerID);
            this.timerID = 0;
        }
        this.oscillators.forEach(osc => {
            try {
                osc.stop();
            } catch (e) {}
        });
        this.oscillators = [];
        this.envelopes = [];
    }

    public setVolume(volume: number): void {
        this.config.volume = Math.max(0, Math.min(1, volume));
        if (this.masterGain) {
            this.masterGain.gain.setTargetAtTime(this.config.volume, this.audioContext.currentTime, 0.1);
        }
    }

    public setSeed(seed: number): void {
        this.config.seed = seed;
        this.setupSeededRandom(seed);
        this.initializeMusicalSystem();
        if (this.audioContext) {
            this.setupEffectsChain();
        }
    }

    public setTempo(tempo: number): void {
        this.config.tempo = Math.max(60, Math.min(200, tempo));
    }

    public getVolume(): number {
        return this.config.volume;
    }

    public isActive(): boolean {
        return this.isPlaying;
    }
}