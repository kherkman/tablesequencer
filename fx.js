console.log("Loading FX Engine...");

class FXEngine {
    constructor(audioCtx) {
        if (!audioCtx) throw new Error("AudioContext required for FXEngine");
        this.ctx = audioCtx;
        
        // --- ADSR STATE ---
        this.adsr = {
            attack: 0.01,
            decay: 0.1,
            sustain: 0.5,
            release: 0.5
        };

        // --- NODES ---
        this.input = this.ctx.createGain();
        this.output = this.ctx.createGain();

        // 1. FILTER SECTION (HPF & LPF)
        this.hpf = this.ctx.createBiquadFilter();
        this.hpf.type = 'highpass';
        this.hpf.frequency.value = 20;

        this.lpf = this.ctx.createBiquadFilter();
        this.lpf.type = 'lowpass';
        this.lpf.frequency.value = 20000;

        // 2. EQ SECTION (3-Band)
        this.eqLow = this.ctx.createBiquadFilter();
        this.eqLow.type = 'lowshelf';
        this.eqLow.frequency.value = 320;
        this.eqLow.gain.value = 0;

        this.eqMid = this.ctx.createBiquadFilter();
        this.eqMid.type = 'peaking';
        this.eqMid.frequency.value = 1000;
        this.eqMid.Q.value = 1.0;
        this.eqMid.gain.value = 0;

        this.eqHigh = this.ctx.createBiquadFilter();
        this.eqHigh.type = 'highshelf';
        this.eqHigh.frequency.value = 3200;
        this.eqHigh.gain.value = 0;

        // 3. EFFECT MODULES
        this.phaser = this.createPhaser();
        this.flanger = this.createFlanger();
        this.chorus = this.createChorus();
        this.delay = this.createDelay();
        this.reverb = this.createReverb();

        // --- CONNECT CHAIN ---
        // Input -> HPF -> LPF -> EQ -> Phaser -> Flanger -> Chorus -> Delay -> Reverb -> Output
        this.input.connect(this.hpf);
        this.hpf.connect(this.lpf);
        this.lpf.connect(this.eqLow);
        this.eqLow.connect(this.eqMid);
        this.eqMid.connect(this.eqHigh);
        
        this.eqHigh.connect(this.phaser.input);
        this.phaser.output.connect(this.flanger.input);
        this.flanger.output.connect(this.chorus.input);
        this.chorus.output.connect(this.delay.input);
        this.delay.output.connect(this.reverb.input);
        this.reverb.output.connect(this.output);
    }

    // --- EFFECT CREATORS ---

    createPhaser() {
        const input = this.ctx.createGain();
        const output = this.ctx.createGain();
        const dry = this.ctx.createGain();
        const wet = this.ctx.createGain();
        
        const stages = 3;
        const filters = [];
        for(let i=0; i<stages; i++) {
            const f = this.ctx.createBiquadFilter();
            f.type = 'allpass';
            f.frequency.value = 1000;
            filters.push(f);
            if(i > 0) filters[i-1].connect(f);
        }

        const lfo = this.ctx.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.value = 1.0; 
        const lfoGain = this.ctx.createGain();
        lfoGain.gain.value = 800; 
        lfo.connect(lfoGain);
        filters.forEach(f => lfoGain.connect(f.frequency));
        lfo.start();

        input.connect(dry);
        input.connect(filters[0]);
        filters[stages-1].connect(wet);
        
        dry.connect(output);
        wet.connect(output);

        dry.gain.value = 1;
        wet.gain.value = 0;

        return { 
            input, output, dry, wet, lfo, lfoGain, filters,
            active: false,
            set: (p, v) => {
                if(p==='rate') lfo.frequency.setTargetAtTime(v, this.ctx.currentTime, 0.1);
                if(p==='depth') lfoGain.gain.setTargetAtTime(v * 1000, this.ctx.currentTime, 0.1);
                if(p==='mix' && this.phaser.active) {
                       wet.gain.setTargetAtTime(v, this.ctx.currentTime, 0.1);
                       dry.gain.setTargetAtTime(1-v/2, this.ctx.currentTime, 0.1);
                }
            },
            toggle: (isActive) => {
                this.phaser.active = isActive;
                const mix = document.getElementById('phaserMix')?.value || 0.5;
                wet.gain.setTargetAtTime(isActive ? mix : 0, this.ctx.currentTime, 0.1);
                dry.gain.setTargetAtTime(isActive ? 1 - mix/2 : 1, this.ctx.currentTime, 0.1);
            }
        };
    }

    createFlanger() {
        const input = this.ctx.createGain();
        const output = this.ctx.createGain();
        const dry = this.ctx.createGain();
        const wet = this.ctx.createGain();
        
        const delay = this.ctx.createDelay();
        delay.delayTime.value = 0.005; 
        
        const feedback = this.ctx.createGain();
        feedback.gain.value = 0.5;
        
        const lfo = this.ctx.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.value = 0.5;
        const lfoGain = this.ctx.createGain();
        lfoGain.gain.value = 0.002;
        
        lfo.connect(lfoGain);
        lfoGain.connect(delay.delayTime);
        lfo.start();

        input.connect(dry);
        input.connect(delay);
        delay.connect(wet);
        delay.connect(feedback);
        feedback.connect(delay); 

        dry.connect(output);
        wet.connect(output);
        
        dry.gain.value = 1;
        wet.gain.value = 0;

        return {
            input, output, dry, wet, lfo, lfoGain, feedback,
            active: false,
            set: (p, v) => {
                if(p==='rate') lfo.frequency.setTargetAtTime(v, this.ctx.currentTime, 0.1);
                if(p==='feedback') feedback.gain.setTargetAtTime(v, this.ctx.currentTime, 0.1);
                if(p==='mix' && this.flanger.active) {
                        wet.gain.setTargetAtTime(v, this.ctx.currentTime, 0.1);
                        dry.gain.setTargetAtTime(1-v/2, this.ctx.currentTime, 0.1);
                }
            },
            toggle: (isActive) => {
                this.flanger.active = isActive;
                const mix = document.getElementById('flangerMix')?.value || 0.5;
                wet.gain.setTargetAtTime(isActive ? mix : 0, this.ctx.currentTime, 0.1);
                dry.gain.setTargetAtTime(isActive ? 1 - mix/2 : 1, this.ctx.currentTime, 0.1);
            }
        };
    }

    createChorus() {
        const input = this.ctx.createGain();
        const output = this.ctx.createGain();
        const dry = this.ctx.createGain();
        const wet = this.ctx.createGain();
        
        const delay = this.ctx.createDelay();
        delay.delayTime.value = 0.03; 
        
        const lfo = this.ctx.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.value = 1.5;
        const lfoGain = this.ctx.createGain();
        lfoGain.gain.value = 0.002; 
        
        lfo.connect(lfoGain);
        lfoGain.connect(delay.delayTime);
        lfo.start();

        input.connect(dry);
        input.connect(delay);
        delay.connect(wet);
        
        dry.connect(output);
        wet.connect(output);

        dry.gain.value = 1;
        wet.gain.value = 0;

        return {
            input, output, dry, wet, lfo, lfoGain,
            active: false,
            set: (p, v) => {
                if(p==='rate') lfo.frequency.setTargetAtTime(v, this.ctx.currentTime, 0.1);
                if(p==='depth') lfoGain.gain.setTargetAtTime(v * 0.005, this.ctx.currentTime, 0.1);
                if(p==='mix' && this.chorus.active) {
                        wet.gain.setTargetAtTime(v, this.ctx.currentTime, 0.1);
                        dry.gain.setTargetAtTime(1-v/2, this.ctx.currentTime, 0.1);
                }
            },
            toggle: (isActive) => {
                this.chorus.active = isActive;
                const mix = document.getElementById('chorusMix')?.value || 0.5;
                wet.gain.setTargetAtTime(isActive ? mix : 0, this.ctx.currentTime, 0.1);
                dry.gain.setTargetAtTime(isActive ? 1 - mix/2 : 1, this.ctx.currentTime, 0.1);
            }
        };
    }

    createDelay() {
        const input = this.ctx.createGain();
        const output = this.ctx.createGain();
        const dry = this.ctx.createGain();
        const wet = this.ctx.createGain();
        
        const delay = this.ctx.createDelay();
        delay.delayTime.value = 0.5; 
        
        const feedback = this.ctx.createGain();
        feedback.gain.value = 0.4;
        
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 4000;

        input.connect(dry);
        input.connect(delay);
        delay.connect(filter);
        filter.connect(feedback);
        feedback.connect(delay);
        filter.connect(wet);
        
        dry.connect(output);
        wet.connect(output);

        dry.gain.value = 1;
        wet.gain.value = 0;

        return {
            input, output, dry, wet, delay, feedback,
            active: false,
            set: (p, v) => {
                if(p==='time') delay.delayTime.setTargetAtTime(v, this.ctx.currentTime, 0.1);
                if(p==='feedback') feedback.gain.setTargetAtTime(v, this.ctx.currentTime, 0.1);
                if(p==='mix' && this.delay.active) {
                        wet.gain.setTargetAtTime(v, this.ctx.currentTime, 0.1);
                        dry.gain.setTargetAtTime(1-v/2, this.ctx.currentTime, 0.1);
                }
            },
            toggle: (isActive) => {
                this.delay.active = isActive;
                const mix = document.getElementById('delayMix')?.value || 0.5;
                wet.gain.setTargetAtTime(isActive ? mix : 0, this.ctx.currentTime, 0.1);
                dry.gain.setTargetAtTime(isActive ? 1 - mix/2 : 1, this.ctx.currentTime, 0.1);
            }
        };
    }

    createReverb() {
        const input = this.ctx.createGain();
        const output = this.ctx.createGain();
        const dry = this.ctx.createGain();
        const wet = this.ctx.createGain();
        
        const convolver = this.ctx.createConvolver();
        // Generate initial impulse response
        this.generateReverbImpulse(2.0, 2.0).then(buffer => convolver.buffer = buffer);

        input.connect(dry);
        input.connect(convolver);
        convolver.connect(wet);
        
        dry.connect(output);
        wet.connect(output);

        dry.gain.value = 1;
        wet.gain.value = 0;

        return {
            input, output, dry, wet, convolver,
            active: false,
            set: (p, v) => {
                if(p==='time') {
                    // Regenerate buffer with new decay time
                    this.generateReverbImpulse(v * 3 + 0.1, 2.0).then(b => convolver.buffer = b);
                }
                if(p==='mix' && this.reverb.active) {
                        wet.gain.setTargetAtTime(v, this.ctx.currentTime, 0.1);
                        dry.gain.setTargetAtTime(1-v/2, this.ctx.currentTime, 0.1);
                }
            },
            toggle: (isActive) => {
                this.reverb.active = isActive;
                const mix = document.getElementById('reverbMix')?.value || 0.5;
                wet.gain.setTargetAtTime(isActive ? mix : 0, this.ctx.currentTime, 0.1);
                dry.gain.setTargetAtTime(isActive ? 1 - mix/2 : 1, this.ctx.currentTime, 0.1);
            }
        };
    }

    async generateReverbImpulse(duration, decay) {
        const rate = this.ctx.sampleRate;
        const length = rate * duration;
        const impulse = this.ctx.createBuffer(2, length, rate);
        const impulseL = impulse.getChannelData(0);
        const impulseR = impulse.getChannelData(1);

        for (let i = 0; i < length; i++) {
            const n = i;
            // Simple exponential decay noise
            const factor = Math.pow(1 - n / length, decay);
            impulseL[i] = (Math.random() * 2 - 1) * factor;
            impulseR[i] = (Math.random() * 2 - 1) * factor;
        }
        return impulse;
    }

    // --- ADSR LOGIC FOR VOICE ---
    getAdsr() {
        return this.adsr;
    }

    // --- GRAPHIC HELPERS ---
    
    drawAdsr(canvas) {
        if (!canvas) return;
        const w = canvas.width;
        const h = canvas.height;
        const ctx = canvas.getContext('2d');
        const a = parseFloat(this.adsr.attack);
        const d = parseFloat(this.adsr.decay);
        const s = parseFloat(this.adsr.sustain);
        const r = parseFloat(this.adsr.release);

        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = '#111';
        ctx.fillRect(0,0,w,h);

        const totalTime = 4.0; // Viewport width in seconds (increased)
        const scaleX = w / totalTime;
        
        ctx.beginPath();
        ctx.moveTo(0, h);
        
        // Attack
        const xA = a * scaleX;
        ctx.lineTo(xA, 0); // Peak
        
        // Decay
        const xD = xA + (d * scaleX);
        const yS = h - (s * h);
        ctx.lineTo(xD, yS);

        // Sustain (Arbitrary length for vis)
        const xS = xD + (0.5 * scaleX); 
        ctx.lineTo(xS, yS);

        // Release
        const xR = xS + (r * scaleX);
        ctx.lineTo(xR, h);

        ctx.lineWidth = 2;
        ctx.strokeStyle = '#00f3ff';
        ctx.stroke();
        
        ctx.fillStyle = 'rgba(0, 243, 255, 0.1)';
        ctx.lineTo(xA, h); // Fill shape simplified
        ctx.fill();
    }

    drawEq(canvas) {
        if (!canvas) return;
        const w = canvas.width;
        const h = canvas.height;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0,0,w,h);
        ctx.fillStyle = '#111';
        ctx.fillRect(0,0,w,h);

        // Draw EQ Curve (Approximation visual)
        ctx.beginPath();
        ctx.strokeStyle = '#ff0055';
        ctx.lineWidth = 2;
        
        for(let x=0; x<w; x++) {
            // Map x to log frequency 20Hz - 20kHz
            const relX = x/w;
            let y = h/2;

            // Low Shelf influence
            if(relX < 0.3) {
                y -= this.eqLow.gain.value * 2; 
            }
            // Mid Peaking influence
            const dist = Math.abs(relX - 0.5);
            if(dist < 0.2) {
                y -= this.eqMid.gain.value * (1 - dist*5) * 2;
            }
            // High Shelf influence
            if(relX > 0.7) {
                y -= this.eqHigh.gain.value * 2;
            }

            // HPF / LPF rolloff viz (Visual approximation)
            const f = 20 * Math.pow(1000, relX); 
            if(f < this.hpf.frequency.value) y = h;
            if(f > this.lpf.frequency.value) y = h;

            // Clamp
            y = Math.max(0, Math.min(h, y));

            if(x===0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // Grid
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, h/2); ctx.lineTo(w, h/2);
        ctx.stroke();
    }
}

// Global accessor for main script
window.FXEngineClass = FXEngine;
console.log("FX Engine Loaded.");