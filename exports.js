// exports.js
(function() {
    let isRecordingWav = false;
    let recordedLeft = [];
    let recordedRight = [];
    let recorderNode = null;

    function writeString(view, offset, string) {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
        }
    }

    // Luodaan standardin mukainen RIFF/WAV-otsikko ja muunnetaan liukuluvut 16-bittiseksi PCM-dataksi
    function bufferToWav(leftChannel, rightChannel, sampleRate) {
        const bufferLength = leftChannel.length;
        const wavBuffer = new ArrayBuffer(44 + bufferLength * 4); // Stereo 16-bit PCM = 4 tavua per kehys
        const view = new DataView(wavBuffer);

        writeString(view, 0, 'RIFF');
        view.setUint32(4, 36 + bufferLength * 4, true);
        writeString(view, 8, 'WAVE');
        writeString(view, 12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true); // Formi: PCM
        view.setUint16(22, 2, true); // Kanavat: Stereo
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * 4, true); // Byte rate
        view.setUint16(32, 4, true); // Block align
        view.setUint16(34, 16, true); // Bits per sample
        writeString(view, 36, 'data');
        view.setUint32(40, bufferLength * 4, true);

        let offset = 44;
        for (let i = 0; i < bufferLength; i++) {
            // Vasen kanava
            let sL = Math.max(-1, Math.min(1, leftChannel[i]));
            let valL = sL < 0 ? sL * 0x8000 : sL * 0x7FFF;
            view.setInt16(offset, valL, true);
            offset += 2;

            // Oikea kanava
            let sR = Math.max(-1, Math.min(1, rightChannel[i]));
            let valR = sR < 0 ? sR * 0x8000 : sR * 0x7FFF;
            view.setInt16(offset, valR, true);
            offset += 2;
        }

        return new Blob([view], { type: 'audio/wav' });
    }

    window.startWavRecording = function() {
        if (isRecordingWav) return;
        recordedLeft = [];
        recordedRight = [];
        isRecordingWav = true;
        window.isRecordingWav = true;

        const bufferSize = 4096;
        // Käytetään ScriptProcessorNodea reaaliaikaiseen signaalin kaappaamiseen
        recorderNode = audioCtx.createScriptProcessor(bufferSize, 2, 2);
        
        recorderNode.onaudioprocess = function(e) {
            if (!isRecordingWav) return;
            const leftInput = e.inputBuffer.getChannelData(0);
            const rightInput = e.inputBuffer.getChannelData(1);
            
            // Kopioidaan näytteet erilliseen muistialueeseen
            recordedLeft.push(new Float32Array(leftInput));
            recordedRight.push(new Float32Array(rightInput));
            
            // Ohjataan ääni eteenpäin, jotta toisto kuuluu nauhoituksen aikana
            const leftOutput = e.outputBuffer.getChannelData(0);
            const rightOutput = e.outputBuffer.getChannelData(1);
            leftOutput.set(leftInput);
            rightOutput.set(rightInput);
        };

        // Kytketään nauhoitin masterLimiterin ja ulostulon väliin
        masterLimiter.disconnect(audioCtx.destination);
        masterLimiter.connect(recorderNode);
        recorderNode.connect(audioCtx.destination);

        const btn = document.getElementById('wavExportBtn');
        if (btn) btn.style.borderColor = 'var(--fx-warn)';

        showAlert("WAV-nauhoitus aloitettu! Paina uudelleen 'WAV EXPORT' tai ylhäältä 'STOP' ladataksesi valmiin tiedoston.");
    };

    window.stopWavRecordingAndDownload = function() {
        if (!isRecordingWav) return;
        isRecordingWav = false;
        window.isRecordingWav = false;

        if (recorderNode) {
            recorderNode.disconnect();
            masterLimiter.disconnect(recorderNode);
            masterLimiter.connect(audioCtx.destination);
            recorderNode = null;
        }

        const btn = document.getElementById('wavExportBtn');
        if (btn) btn.style.borderColor = '';

        const totalSamples = recordedLeft.reduce((acc, val) => acc + val.length, 0);
        if (totalSamples === 0) {
            showAlert("Äänisignaalia ei tallentunut.");
            return;
        }

        const mergedLeft = new Float32Array(totalSamples);
        const mergedRight = new Float32Array(totalSamples);
        let offset = 0;
        for (let chunk of recordedLeft) {
            mergedLeft.set(chunk, offset);
            offset += chunk.length;
        }
        offset = 0;
        for (let chunk of recordedRight) {
            mergedRight.set(chunk, offset);
            offset += chunk.length;
        }

        const wavBlob = bufferToWav(mergedLeft, mergedRight, audioCtx.sampleRate);
        const url = URL.createObjectURL(wavBlob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = "session_export.wav";
        a.click();
        
        showAlert("Häviötön WAV-tiedosto ladattu onnistuneesti!");
    };

    window.handleWavExportClick = function() {
        if (!isRecordingWav) {
            window.startWavRecording();
            if (!isPlaying) {
                togglePlay();
            }
        } else {
            window.stopWavRecordingAndDownload();
            if (isPlaying) {
                togglePlay();
            }
        }
    };

    window.exportAllMidi = function() {
        const midi = new Midi();
        const bpm = document.getElementById('bpm').value;
        midi.header.setTempo(bpm);
        
        sequencers.forEach(s => {
            if (!s) return;
            const track = midi.addTrack();
            const stepDur = 60 / bpm / 4;
            
            for (let r = 0; r < s.rows; r++) {
                let lastHz = 0;
                let startTime = 0;
                const chan = r % 16;
                
                for (let c = 0; c < 64; c++) {
                    let hz = s.evaluateCell(r, c % s.cols);
                    let hasData = (s.data[r] && s.data[r][c % s.cols]) !== "";
                    
                    if (hasData) {
                        if (lastHz > 0) {
                            const mNoteF = 12 * Math.log2(lastHz / 440) + 69;
                            const note = Math.round(mNoteF);
                            const bend = Math.max(-1, Math.min(1, (mNoteF - note) / 2));
                            const duration = (c * stepDur) - startTime;
                            
                            track.addNote({
                                midi: Math.max(0, Math.min(127, note)),
                                time: startTime,
                                duration: duration,
                                velocity: 0.8,
                                channel: chan
                            });
                            
                            track.addPitchBend({
                                time: startTime,
                                value: bend,
                                channel: chan
                            });
                        }
                        lastHz = hz;
                        startTime = c * stepDur;
                    }
                }
                
                if (lastHz > 0) {
                    const mNoteF = 12 * Math.log2(lastHz / 440) + 69;
                    const note = Math.round(mNoteF);
                    const bend = Math.max(-1, Math.min(1, (mNoteF - note) / 2));
                    
                    track.addNote({
                        midi: Math.max(0, Math.min(127, note)),
                        time: startTime,
                        duration: stepDur,
                        velocity: 0.8,
                        channel: chan
                    });
                    
                    track.addPitchBend({
                        time: startTime,
                        value: bend,
                        channel: chan
                    });
                }
            }
        });
        
        const blob = new Blob([midi.toArray()], { type: "audio/midi" });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = "session_export.mid";
        a.click();
    };
})();