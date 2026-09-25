/**
 * ▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄
 * ██░▄▄▄░██░▄▄░█░█░█▄░▄██░▄▄▄░█░▄▄▀█▄░▄
 * ██░███░██░█▀▀█▀▄▀██░███▄▄▄▀▀█░▀▀░██░█
 * ██░▀▀▀░██░▀▀▄█▄█▄█▀░▀██░▀▀▀░█░██░█▀░▀
 * ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀
 *
 * OGxISAI 🌑 — Ultimate Discord Voice Manager
 * ═══════════════════════════════════════════════════════════
 */
(function () {
  'use strict';
  if (window.__OGxISAI__) return;
  window.__OGxISAI__ = true;

  /* ─── resolve asset URLs injected via data attributes ─── */
  const _script      = document.querySelector('script[data-loading-gif]');
  const LOADING_GIF  = _script ? _script.dataset.loadingGif : '';
  const HEADER_GIF   = _script ? _script.dataset.headerGif  : '';

  /* ══════════════════════════════════════════════════════════
     FAKE MUTE / DEAFEN — 3-layer protection
     ══════════════════════════════════════════════════════════ */
  window.BMFakeMute   = false;
  window.BMFakeDeafen = false;

  const _origEnabledDesc = Object.getOwnPropertyDescriptor(MediaStreamTrack.prototype, 'enabled');
  if (_origEnabledDesc) {
    Object.defineProperty(MediaStreamTrack.prototype, 'enabled', {
      get() { return _origEnabledDesc.get.call(this); },
      set(val) {
        if (!val && (window.BMFakeMute || window.BMFakeDeafen)) return;
        _origEnabledDesc.set.call(this, val);
      },
      configurable: true, enumerable: true
    });
  }
  if (window.RTCRtpSender) {
    const _origReplace = RTCRtpSender.prototype.replaceTrack;
    RTCRtpSender.prototype.replaceTrack = function (track) {
      if (track === null && (window.BMFakeMute || window.BMFakeDeafen)) return Promise.resolve();
      return _origReplace.call(this, track);
    };
  }
  if (window.MediaStream && MediaStream.prototype.removeTrack) {
    const _origRemove = MediaStream.prototype.removeTrack;
    MediaStream.prototype.removeTrack = function (track) {
      if (window.BMFakeDeafen || window.BMFakeMute) return;
      return _origRemove.call(this, track);
    };
  }

  /* ══════════════════════════════════════════════════════════
     STATE
     ══════════════════════════════════════════════════════════ */
  const MAX_RAW_GAIN = 9999999;

  const STATE = {
    masterGain:    1.0,
    preAmp:        1.0,
    rawBoost:      1,         // Bloody Cord quadratic gain (1 – 9999999)
    rawSlider:     0,         // 0-100 slider position for raw boost
    pitch:         0,
    stereoWidth:   0,
    inputLevel:    -Infinity,
    eqBands:       [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    effect:        null,
    reverb:        { wetMix: 0.35, decay: 3.5, roomSize: 2.3, dry: false },
    chaosMode:     false,
    godGain:       0,
    hyperBoost:    0,
    voiceTone:     'Natural',
    compEnabled:   false,
    compThreshold: -24,
    compRatio:     4,
    widerEnabled:  false,
    widerWidth:    1.0,
    widerDepth:    1.0,
    widerFreq:     80,
    deepVoice:     0,
    kidVoice:      0,
    masterGainUltra: 0,
    fakeMute:      false,
    fakeDeafen:    false,
    sessionStart:  Date.now(),
    clipCount:     0,
    peakDb:        -Infinity,
  };

  /* ══════════════════════════════════════════════════════════
     MP3 PLAYER STATE
     ══════════════════════════════════════════════════════════ */
  const MP3 = {
    audio: null, source: null, gainNode: null, musicGain: null,
    analyser: null, playing: false, fileName: null, volume: 1.0,
    musicBoost: 1.0, _interval: null, _objUrl: null,
    routeTarget: null, routeConnected: false,
  };

  const EQ_FREQS  = [60, 150, 400, 1000, 2400, 6000, 12000, 16000, 80, 8000];
  const EQ_LABELS = ['60', '150', '400', '1k', '2.4k', '6k', '12k', '16k', 'Bass', 'Treb'];

  /* ══════════════════════════════════════════════════════════
     PRESETS
     ══════════════════════════════════════════════════════════ */
  const PRESETS = [
    { name:'Clean',        icon:'✨', master:1.0, preAmp:1.0, pitch:0,   effect:null,        reverb:{wetMix:0,   decay:3.5,roomSize:2.3,dry:true},  god:0,   hyper:0   },
    { name:'Loud Mic',     icon:'📢', master:2.5, preAmp:2.0, pitch:0,   effect:null,        reverb:{wetMix:0,   decay:3.5,roomSize:2.3,dry:true},  god:0,   hyper:0   },
    { name:'Demon Throat', icon:'😈', master:1.5, preAmp:1.4, pitch:-7,  effect:'deep',      reverb:{wetMix:0.4, decay:3.0,roomSize:2.5,dry:false}, god:0.2, hyper:0   },
    { name:'Haunted Hall', icon:'👻', master:1.2, preAmp:1.1, pitch:0,   effect:'cave',      reverb:{wetMix:0.6, decay:5.0,roomSize:4.0,dry:false}, god:0,   hyper:0   },
    { name:'Ghost Whisper',icon:'🌫️', master:0.9, preAmp:0.8, pitch:3,   effect:'echo',      reverb:{wetMix:0.5, decay:2.5,roomSize:2.0,dry:false}, god:0,   hyper:0   },
    { name:'Possessed',    icon:'🔥', master:1.6, preAmp:1.6, pitch:-3,  effect:'distort',   reverb:{wetMix:0.3, decay:2.0,roomSize:1.8,dry:false}, god:0.3, hyper:0.2 },
    { name:'Chipmunk',     icon:'🐿️', master:1.3, preAmp:1.2, pitch:7,   effect:'chipmunk',  reverb:{wetMix:0.1, decay:1.0,roomSize:1.2,dry:false}, god:0,   hyper:0   },
    { name:'Chainsaw',     icon:'⚡', master:1.8, preAmp:1.7, pitch:-2,  effect:'bitcrush',  reverb:{wetMix:0.1, decay:1.0,roomSize:1.0,dry:false}, god:0.4, hyper:0   },
    { name:'Radio Voice',  icon:'📻', master:1.2, preAmp:1.0, pitch:0,   effect:'radio',     reverb:{wetMix:0.1, decay:1.0,roomSize:1.0,dry:false}, god:0,   hyper:0   },
    { name:'Alien',        icon:'👽', master:1.3, preAmp:1.2, pitch:0,   effect:'alien',     reverb:{wetMix:0.3, decay:2.0,roomSize:1.5,dry:false}, god:0,   hyper:0   },
    { name:'Vocalizer',    icon:'🎤', master:1.2, preAmp:1.0, pitch:0,   effect:'vocalizer', reverb:{wetMix:0.2, decay:2.0,roomSize:1.5,dry:false}, god:0,   hyper:0   },
    { name:'God Mode',     icon:'⚡', master:3.0, preAmp:2.5, pitch:0,   effect:null,        reverb:{wetMix:0,   decay:3.5,roomSize:2.3,dry:true},  god:0.7, hyper:0.5 },
    { name:'BLOODMOON',    icon:'🌑', master:5.0, preAmp:3.0, pitch:0,   effect:'distort',   reverb:{wetMix:0.3, decay:2.5,roomSize:2.0,dry:false}, god:1.0, hyper:1.0 },
    { name:'Nexus',        icon:'🌐', master:2.0, preAmp:1.8, pitch:-1,  effect:'chorus',    reverb:{wetMix:0.3, decay:2.5,roomSize:2.0,dry:false}, god:0.5, hyper:0.3 },
    { name:'Broadcaster',  icon:'🎙️', master:1.4, preAmp:1.2, pitch:0,   effect:null,        reverb:{wetMix:0.1, decay:1.5,roomSize:1.2,dry:false}, god:0.1, hyper:0   },
    { name:'Cave Echo',    icon:'🗿', master:1.1, preAmp:1.0, pitch:-2,  effect:'cave',      reverb:{wetMix:0.7, decay:6.0,roomSize:5.0,dry:false}, god:0,   hyper:0   },
    { name:'Robot Army',   icon:'🤖', master:1.4, preAmp:1.2, pitch:0,   effect:'robot',     reverb:{wetMix:0.2, decay:2.0,roomSize:1.5,dry:false}, god:0.2, hyper:0   },
    { name:'Flanger Jet',  icon:'✈️', master:1.2, preAmp:1.0, pitch:0,   effect:'flanger',   reverb:{wetMix:0.2, decay:1.5,roomSize:1.2,dry:false}, god:0,   hyper:0   },
    { name:'Tremolo',      icon:'💓', master:1.1, preAmp:1.0, pitch:2,   effect:'tremolo',   reverb:{wetMix:0.25,decay:2.0,roomSize:1.8,dry:false}, god:0,   hyper:0   },
    { name:'Megaphone',    icon:'📣', master:1.5, preAmp:1.3, pitch:0,   effect:'megaphone', reverb:{wetMix:0.1, decay:1.0,roomSize:1.0,dry:false}, god:0.1, hyper:0   },
  ];

  const EFFECTS = [
    { id:'robot',      name:'Robot',      icon:'🤖', color:'#a78bfa' },
    { id:'megaphone',  name:'Megaphone',  icon:'📣', color:'#f472b6' },
    { id:'telephone',  name:'Telephone',  icon:'📞', color:'#818cf8' },
    { id:'deep',       name:'Deep',       icon:'🔉', color:'#60a5fa' },
    { id:'chipmunk',   name:'Chipmunk',   icon:'🐿️', color:'#fb923c' },
    { id:'echo',       name:'Echo',       icon:'🔄', color:'#34d399' },
    { id:'distort',    name:'Distort',    icon:'⚡', color:'#f87171' },
    { id:'alien',      name:'Alien',      icon:'👽', color:'#4ade80' },
    { id:'chorus',     name:'Chorus',     icon:'🎵', color:'#22d3ee' },
    { id:'flanger',    name:'Flanger',    icon:'🌀', color:'#c084fc' },
    { id:'bitcrush',   name:'Bitcrush',   icon:'💀', color:'#fb7185' },
    { id:'tremolo',    name:'Tremolo',    icon:'💓', color:'#f43f5e' },
    { id:'cave',       name:'Cave',       icon:'🏔️', color:'#94a3b8' },
    { id:'radio',      name:'Radio',      icon:'📻', color:'#fbbf24' },
    { id:'vocalizer',  name:'Vocalizer',  icon:'🎤', color:'#e879f9' },
    { id:'whisper',    name:'Whisper',    icon:'🌫️', color:'#bfdbfe' },
    { id:'growl',      name:'Growl',      icon:'😤', color:'#ef4444' },
    { id:'underwater', name:'Underwater', icon:'🌊', color:'#06b6d4' },
  ];

  /* ══════════════════════════════════════════════════════════
     AUDIO ENGINE
     ══════════════════════════════════════════════════════════ */
  let audioCtx    = null;
  let activeChain = null;

  function getCtx() {
    if (!audioCtx || audioCtx.state === 'closed') {
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)({
          latencyHint: 'interactive',
          sampleRate:  48000,
        });
      } catch (e) { return null; }
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  }

  /* ── Pitch shifter (granular, ScriptProcessor) ─────────────
     Only instantiate when pitch != 0 to avoid audio dropouts.
     bufSize 8192 = less frequent callbacks = less stutter.    */
  function createPitchShifter(ctx) {
    const bufSize   = 8192;
    const inputNode  = ctx.createGain();
    const outputNode = ctx.createGain();
    let pitchOffset  = 0;
    const inputBuf   = new Float32Array(bufSize);
    let writePos     = 0;
    let grainPhase   = 0;

    const proc = ctx.createScriptProcessor(bufSize, 1, 1);
    proc.onaudioprocess = (e) => {
      const inp  = e.inputBuffer.getChannelData(0);
      const out  = e.outputBuffer.getChannelData(0);
      const rate = 1 + pitchOffset;
      for (let i = 0; i < inp.length; i++) {
        inputBuf[(writePos + i) % bufSize] = inp[i];
      }
      for (let i = 0; i < out.length; i++) {
        const readPos = ((writePos + i) - bufSize * 0.5 + grainPhase * bufSize) % bufSize;
        const idx     = ((Math.round(readPos) % bufSize) + bufSize) % bufSize;
        out[i]        = inputBuf[idx] || 0;
        grainPhase    = (grainPhase + rate / bufSize) % 1;
      }
      writePos = (writePos + inp.length) % bufSize;
    };
    inputNode.connect(proc);
    proc.connect(outputNode);

    return {
      input: inputNode,
      output: outputNode,
      setPitchOffset(o) { pitchOffset = o; },
      dispose() { try { proc.disconnect(); } catch(_){} },
    };
  }

  function makeDistortionCurve(amount) {
    const n = 512, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      curve[i] = (Math.PI + amount) * x / (Math.PI + amount * Math.abs(x));
    }
    return curve;
  }

  function makeBitcrushCurve(bits) {
    const n = 512, curve = new Float32Array(n), step = Math.pow(0.5, bits - 1);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      curve[i] = Math.round(x / step) * step;
    }
    return curve;
  }

  /* cap decay/size so we never allocate a massive buffer that causes glitches */
  function buildImpulse(ctx, decay, size) {
    const safDecay = Math.min(decay, 6);
    const safSize  = Math.min(size, 4);
    const len = Math.max(100, Math.floor(ctx.sampleRate * safDecay));
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, Math.max(0.1, safSize));
      }
    }
    return buf;
  }

  function buildEffectNode(ctx, effectId) {
    const input    = ctx.createGain();
    const output   = ctx.createGain();
    const disposers = [];

    switch (effectId) {
      case 'robot': {
        const osc = ctx.createOscillator(); osc.frequency.value = 75;
        const ring = ctx.createGain(); ring.gain.value = 1;
        osc.connect(ring.gain);
        input.connect(ring); ring.connect(output);
        osc.start();
        disposers.push(() => { try { osc.stop(); } catch(_){} });
        break;
      }
      case 'megaphone': {
        const hp = ctx.createBiquadFilter(); hp.type = 'highpass';  hp.frequency.value = 700;
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';   lp.frequency.value = 3500;
        const ws = ctx.createWaveShaper();   ws.curve = makeDistortionCurve(30);
        const g  = ctx.createGain();         g.gain.value = 2.5;
        input.connect(hp); hp.connect(lp); lp.connect(ws); ws.connect(g); g.connect(output);
        break;
      }
      case 'telephone': {
        const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 500;
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';  lp.frequency.value = 3000;
        const ws = ctx.createWaveShaper();  ws.curve = makeDistortionCurve(15);
        input.connect(hp); hp.connect(lp); lp.connect(ws); ws.connect(output);
        break;
      }
      case 'deep': {
        const lp1 = ctx.createBiquadFilter(); lp1.type = 'lowpass';   lp1.frequency.value = 3000; lp1.Q.value = 0.5;
        const lsf = ctx.createBiquadFilter(); lsf.type = 'lowshelf';  lsf.frequency.value = 200;  lsf.gain.value = 10;
        const hsf = ctx.createBiquadFilter(); hsf.type = 'highshelf'; hsf.frequency.value = 4000; hsf.gain.value = -8;
        const pk  = ctx.createBiquadFilter(); pk.type  = 'peaking';   pk.frequency.value  = 90;   pk.gain.value  = 8; pk.Q.value = 0.8;
        const ws  = ctx.createWaveShaper();   ws.curve = makeDistortionCurve(20); ws.oversample = '4x';
        const g   = ctx.createGain(); g.gain.value = 1.6;
        input.connect(lp1); lp1.connect(lsf); lsf.connect(pk); pk.connect(hsf); hsf.connect(ws); ws.connect(g); g.connect(output);
        break;
      }
      case 'chipmunk': {
        const ps = createPitchShifter(ctx); ps.setPitchOffset(0.7);
        input.connect(ps.input); ps.output.connect(output);
        disposers.push(() => ps.dispose());
        break;
      }
      case 'echo': {
        const delay = ctx.createDelay(1.0); delay.delayTime.value = 0.25;
        const fb    = ctx.createGain();     fb.gain.value = 0.4;
        input.connect(output);
        input.connect(delay); delay.connect(fb); fb.connect(delay); delay.connect(output);
        break;
      }
      case 'distort': {
        const ws = ctx.createWaveShaper(); ws.curve = makeDistortionCurve(80); ws.oversample = '2x';
        const g  = ctx.createGain(); g.gain.value = 0.45;
        input.connect(ws); ws.connect(g); g.connect(output);
        break;
      }
      case 'alien': {
        const lfo   = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 7;
        const depth = ctx.createGain();       depth.gain.value = 0.6;
        const mod   = ctx.createGain();       mod.gain.value = 0.4;
        lfo.connect(depth); depth.connect(mod.gain);
        input.connect(mod); mod.connect(output);
        const ps   = createPitchShifter(ctx); ps.setPitchOffset(0.3);
        const psG  = ctx.createGain(); psG.gain.value = 0.5;
        input.connect(ps.input); ps.output.connect(psG); psG.connect(output);
        lfo.start();
        disposers.push(() => { try { lfo.stop(); } catch(_){} ps.dispose(); });
        break;
      }
      case 'chorus': {
        const delay = ctx.createDelay(0.1);   delay.delayTime.value = 0.025;
        const lfo   = ctx.createOscillator(); lfo.frequency.value = 1.5;
        const lfoG  = ctx.createGain();       lfoG.gain.value = 0.008;
        const wet   = ctx.createGain();       wet.gain.value = 0.5;
        lfo.connect(lfoG); lfoG.connect(delay.delayTime);
        input.connect(output); input.connect(delay); delay.connect(wet); wet.connect(output);
        lfo.start();
        disposers.push(() => { try { lfo.stop(); } catch(_){} });
        break;
      }
      case 'flanger': {
        const delay = ctx.createDelay(0.05);  delay.delayTime.value = 0.005;
        const lfo   = ctx.createOscillator(); lfo.frequency.value = 0.5;
        const lfoG  = ctx.createGain();       lfoG.gain.value = 0.003;
        const fb    = ctx.createGain();       fb.gain.value = 0.5;
        const wet   = ctx.createGain();       wet.gain.value = 0.6;
        lfo.connect(lfoG); lfoG.connect(delay.delayTime);
        input.connect(output); input.connect(delay);
        delay.connect(fb); fb.connect(delay); delay.connect(wet); wet.connect(output);
        lfo.start();
        disposers.push(() => { try { lfo.stop(); } catch(_){} });
        break;
      }
      case 'bitcrush': {
        const ws = ctx.createWaveShaper(); ws.curve = makeBitcrushCurve(4);
        input.connect(ws); ws.connect(output);
        break;
      }
      case 'tremolo': {
        const lfo  = ctx.createOscillator(); lfo.frequency.value = 6;
        const lfoG = ctx.createGain();       lfoG.gain.value = 0.4;
        const trem = ctx.createGain();       trem.gain.value = 0.6;
        lfo.connect(lfoG); lfoG.connect(trem.gain);
        input.connect(trem); trem.connect(output);
        lfo.start();
        disposers.push(() => { try { lfo.stop(); } catch(_){} });
        break;
      }
      case 'cave': {
        const conv = ctx.createConvolver(); conv.buffer = buildImpulse(ctx, 2.0, 3.0);
        const wet  = ctx.createGain(); wet.gain.value = 0.6;
        const dry  = ctx.createGain(); dry.gain.value = 0.6;
        input.connect(dry); dry.connect(output);
        input.connect(conv); conv.connect(wet); wet.connect(output);
        break;
      }
      case 'radio': {
        const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 800;
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';  lp.frequency.value = 2800;
        const ws = ctx.createWaveShaper();   ws.curve = makeDistortionCurve(20);
        input.connect(hp); hp.connect(lp); lp.connect(ws); ws.connect(output);
        const nbuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const nd   = nbuf.getChannelData(0);
        for (let i = 0; i < nd.length; i++) nd[i] = (Math.random() * 2 - 1) * 0.03;
        const noise = ctx.createBufferSource(); noise.buffer = nbuf; noise.loop = true;
        noise.connect(output); noise.start();
        disposers.push(() => { try { noise.stop(); } catch(_){} });
        break;
      }
      case 'vocalizer': {
        const f1 = ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 700;  f1.Q.value = 6;
        const f2 = ctx.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 1220; f2.Q.value = 6;
        const f3 = ctx.createBiquadFilter(); f3.type = 'bandpass'; f3.frequency.value = 2600; f3.Q.value = 6;
        const s  = ctx.createGain();         s.gain.value = 1.2;
        input.connect(f1); f1.connect(s);
        input.connect(f2); f2.connect(s);
        input.connect(f3); f3.connect(s);
        s.connect(output);
        break;
      }
      case 'whisper': {
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 4000;
        const g  = ctx.createGain();         g.gain.value = 0.4;
        const ws = ctx.createWaveShaper();   ws.curve = makeDistortionCurve(5);
        input.connect(ws); ws.connect(lp); lp.connect(g); g.connect(output);
        break;
      }
      case 'growl': {
        const ws = ctx.createWaveShaper(); ws.curve = makeDistortionCurve(200); ws.oversample = '4x';
        const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 100;
        const g  = ctx.createGain(); g.gain.value = 0.6;
        input.connect(ws); ws.connect(hp); hp.connect(g); g.connect(output);
        break;
      }
      case 'underwater': {
        const lp1 = ctx.createBiquadFilter(); lp1.type = 'lowpass'; lp1.frequency.value = 600;
        const lp2 = ctx.createBiquadFilter(); lp2.type = 'lowpass'; lp2.frequency.value = 600;
        const lfo  = ctx.createOscillator(); lfo.frequency.value = 0.3;
        const lfoG = ctx.createGain();       lfoG.gain.value = 200;
        lfo.connect(lfoG); lfoG.connect(lp1.frequency);
        input.connect(lp1); lp1.connect(lp2); lp2.connect(output);
        lfo.start();
        disposers.push(() => { try { lfo.stop(); } catch(_){} });
        break;
      }
      default: { input.connect(output); }
    }

    return { input, output, dispose: () => disposers.forEach(d => d()) };
  }

  /* ── Build the full audio processing chain ─────────────── */
  function buildChain(ctx, sourceStream) {
    const src  = ctx.createMediaStreamSource(sourceStream);
    const dest = ctx.createMediaStreamDestination();

    /* Pre-amp */
    const preAmp = ctx.createGain(); preAmp.gain.value = STATE.preAmp;

    /* Pitch shifter — created lazily in applyPitch() */
    const pitchBypass = ctx.createGain();
    let   pitchShifter = null;

    /* EQ */
    const eqNodes = EQ_FREQS.map((freq, i) => {
      const f = ctx.createBiquadFilter();
      if (i === 0)                         { f.type = 'lowshelf';  f.frequency.value = 80; }
      else if (i === EQ_FREQS.length - 1) { f.type = 'highshelf'; f.frequency.value = 12000; }
      else                                 { f.type = 'peaking';   f.frequency.value = freq; f.Q.value = 1.2; }
      f.gain.value = STATE.eqBands[i] || 0;
      return f;
    });

    const fxIn  = ctx.createGain();
    const fxOut = ctx.createGain();

    /* CHAOS / ultra gain stage */
    const chaosGain  = ctx.createGain(); chaosGain.gain.value  = 1.0;
    const godGainNode = ctx.createGain(); godGainNode.gain.value = 1.0;

    /* Raw Boost (Bloody Cord style) */
    const rawBoostNode = ctx.createGain(); rawBoostNode.gain.value = STATE.rawBoost;

    /* Reverb */
    const reverbConv = ctx.createConvolver();
    reverbConv.buffer = buildImpulse(ctx, STATE.reverb.decay, STATE.reverb.roomSize);
    const reverbWet = ctx.createGain(); reverbWet.gain.value = STATE.reverb.dry ? 0 : STATE.reverb.wetMix;
    const reverbDry = ctx.createGain(); reverbDry.gain.value = 1.0;

    /* Compressor */
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = STATE.compThreshold;
    comp.knee.value      = 10;
    comp.ratio.value     = STATE.compRatio;
    comp.attack.value    = 0.003;
    comp.release.value   = 0.25;

    /* Master gain */
    const masterGainNode = ctx.createGain(); masterGainNode.gain.value = STATE.masterGain;

    /* Stereo wider (mid/side) */
    const widerMidGain  = ctx.createGain(); widerMidGain.gain.value  = 1.0;
    const widerSideGain = ctx.createGain(); widerSideGain.gain.value = 1.0;
    const widerLpf      = ctx.createBiquadFilter(); widerLpf.type = 'lowpass'; widerLpf.frequency.value = 80;

    /* Master Gain Ultra node (up to 40 M×) */
    const ultraMasterNode = ctx.createGain(); ultraMasterNode.gain.value = 1.0;

    /* Safety limiter — stops browser audio muting every ~5 s at extreme gain */
    const safetyLimiter = ctx.createDynamicsCompressor();
    safetyLimiter.threshold.value = -1;
    safetyLimiter.knee.value      = 0;
    safetyLimiter.ratio.value     = 20;
    safetyLimiter.attack.value    = 0.001;
    safetyLimiter.release.value   = 0.1;

    /* Input level analyser */
    const inAnalyser = ctx.createAnalyser(); inAnalyser.fftSize = 1024;

    /* ── Signal chain ─────────────────────────────────────
       src → inAnalyser → preAmp → [pitch] → pitchBypass
       → eqNodes chain → fxIn → fxOut → reverbDry → chaosGain
       → godGainNode → masterGainNode → [comp] → rawBoostNode → dest
       rawBoostNode is the LAST node before dest (Bloody Cord
       style — raw post-chain boost, no hard limiter after it).
       + reverbWet side chain
    ─────────────────────────────────────────────────────── */
    src.connect(inAnalyser);
    inAnalyser.connect(preAmp);

    /* EQ chain */
    pitchBypass.connect(eqNodes[0]);
    for (let i = 0; i < eqNodes.length - 1; i++) eqNodes[i].connect(eqNodes[i + 1]);
    eqNodes[eqNodes.length - 1].connect(fxIn);

    /* Reverb routing */
    fxOut.connect(reverbDry);
    fxOut.connect(reverbConv);
    reverbConv.connect(reverbWet);
    reverbDry.connect(chaosGain);
    reverbWet.connect(chaosGain);

    chaosGain.connect(godGainNode);
    godGainNode.connect(masterGainNode);
    masterGainNode.connect(ultraMasterNode);
    ultraMasterNode.connect(comp);
    comp.connect(rawBoostNode);
    rawBoostNode.connect(safetyLimiter);
    safetyLimiter.connect(dest);

    let currentFx = null;
    function connectEffect(fx) {
      fxIn.connect(fx.input);
      fx.output.connect(fxOut);
      currentFx = fx;
    }
    connectEffect(buildEffectNode(ctx, STATE.effect));

    function applyPitch(semitones) {
      if (semitones === 0) {
        if (pitchShifter) {
          try { preAmp.disconnect(pitchShifter.input); } catch(_){}
          try { pitchShifter.output.disconnect(pitchBypass); } catch(_){}
          pitchShifter.dispose();
          pitchShifter = null;
        }
        try { preAmp.connect(pitchBypass); } catch(_){}
      } else {
        if (!pitchShifter) {
          try { preAmp.disconnect(pitchBypass); } catch(_){}
          pitchShifter = createPitchShifter(ctx);
          preAmp.connect(pitchShifter.input);
          pitchShifter.output.connect(pitchBypass);
        }
        pitchShifter.setPitchOffset(semitones / 12);
      }
    }
    applyPitch(STATE.pitch);

    /* Level loop */
    const inData = new Uint8Array(inAnalyser.fftSize);
    let lastTs   = 0;
    function levelLoop(ts) {
      if (!chain.alive) return;
      if (ts - lastTs >= 66) {
        lastTs = ts;
        inAnalyser.getByteTimeDomainData(inData);
        let peak = 0;
        for (let i = 0; i < inData.length; i++) {
          const a = Math.abs(inData[i] - 128) / 128;
          if (a > peak) peak = a;
        }
        const db = peak > 0 ? 20 * Math.log10(peak) : -Infinity;
        STATE.inputLevel = db;
        if (db > STATE.peakDb) STATE.peakDb = db;
        if (db > -0.5) STATE.clipCount++;
        window.dispatchEvent(new CustomEvent('bm:levels', { detail: { db } }));
      }
      requestAnimationFrame(levelLoop);
    }
    requestAnimationFrame(levelLoop);

    const chain = {
      alive: true,
      src, dest, preAmp, eqNodes, reverbConv, reverbWet, reverbDry,
      masterGainNode, chaosGain, godGainNode, rawBoostNode, comp,

      rebuildEffect() {
        if (currentFx) {
          try { fxIn.disconnect(currentFx.input); }   catch(_){}
          try { currentFx.output.disconnect(fxOut); } catch(_){}
          try { currentFx.dispose(); }                 catch(_){}
        }
        const nfx = buildEffectNode(ctx, STATE.effect);
        fxIn.connect(nfx.input);
        nfx.output.connect(fxOut);
        currentFx = nfx;
      },

      rebuildReverb() {
        reverbWet.gain.setTargetAtTime(STATE.reverb.dry ? 0 : STATE.reverb.wetMix, ctx.currentTime, 0.05);
      },

      rebuildReverbImpulse() {
        reverbConv.buffer = buildImpulse(ctx, Math.max(0.1, STATE.reverb.decay), Math.max(0.1, STATE.reverb.roomSize));
      },

      applyPitch,

      /* Deep Voice / Kid Voice — reuse existing pitch shifter, ±7 semitones */
      applyDeepKid() {
        const semitones = Math.round((STATE.kidVoice - STATE.deepVoice) * 7 * 10) / 10;
        applyPitch(semitones);
      },

      /* Master Gain Ultra — exponential up to 40 M× */
      applyMasterGainUltra() {
        const t = Math.max(0, Math.min(1, STATE.masterGainUltra));
        const g = t <= 0 ? 1.0 : Math.pow(40_000_000, t);
        ultraMasterNode.gain.setTargetAtTime(g, ctx.currentTime, 0.05);
      },

      applyUltraGain() {
        const chaos = STATE.chaosMode ? 8.0 : 1.0;
        const god   = 1 + STATE.godGain * 40;
        const hyper = 1 + STATE.hyperBoost * 80;
        chaosGain.gain.setTargetAtTime(chaos, ctx.currentTime, 0.02);
        godGainNode.gain.setTargetAtTime(god * hyper, ctx.currentTime, 0.02);
      },

      applyRawBoost() {
        rawBoostNode.gain.setTargetAtTime(STATE.rawBoost, ctx.currentTime, 0.02);
      },

      applyWider() {
        const t = ctx.currentTime;
        if (!STATE.widerEnabled) {
          widerSideGain.gain.setTargetAtTime(1.0, t, 0.05);
          widerMidGain.gain.setTargetAtTime(1.0, t, 0.05);
        } else {
          const side = Math.max(0, STATE.widerWidth * STATE.widerDepth);
          widerSideGain.gain.setTargetAtTime(side, t, 0.05);
          widerMidGain.gain.setTargetAtTime(1.0, t, 0.05);
          widerLpf.frequency.setTargetAtTime(Math.max(20, Math.min(STATE.widerFreq, 500)), t, 0.05);
        }
      },

      stop() {
        chain.alive = false;
        if (currentFx) { try { currentFx.dispose(); } catch(_){} }
        if (pitchShifter) { try { pitchShifter.dispose(); } catch(_){} }
      }
    };

    return chain;
  }

  /* ══════════════════════════════════════════════════════════
     MP3 PLAYER
     ══════════════════════════════════════════════════════════ */
  function mp3RouteToCurrentTarget() {
    if (!MP3.analyser || !audioCtx) return false;
    try { MP3.analyser.disconnect(); } catch (_) {}
    MP3.routeConnected = false;
    MP3.routeTarget = null;

    const target = activeChain ? activeChain.dest : audioCtx.destination;
    if (target) {
      try { MP3.analyser.connect(target); } catch (_) {}
      MP3.routeTarget = target;
      MP3.routeConnected = true;
    }
    return MP3.routeConnected;
  }

  function mp3Load(file) {
    const ctx = getCtx(); if (!ctx) return;
    mp3Stop();
    if (MP3._objUrl) URL.revokeObjectURL(MP3._objUrl);
    MP3._objUrl  = URL.createObjectURL(file);
    MP3.fileName = file.name;
    MP3.audio    = new Audio(MP3._objUrl);
    MP3.audio.loop = true; MP3.audio.preload = 'auto';
    MP3.audio.crossOrigin = 'anonymous';
    if (MP3.source) { try { MP3.source.disconnect(); } catch (_) {} }
    MP3.source    = ctx.createMediaElementSource(MP3.audio);
    MP3.musicGain = ctx.createGain(); MP3.musicGain.gain.value = MP3.musicBoost;
    MP3.gainNode  = ctx.createGain(); MP3.gainNode.gain.value  = MP3.volume;
    MP3.analyser  = ctx.createAnalyser(); MP3.analyser.fftSize = 256;
    MP3.source.connect(MP3.musicGain); MP3.musicGain.connect(MP3.gainNode);
    MP3.gainNode.connect(MP3.analyser);
    mp3RouteToCurrentTarget();
    mp3UpdateNameEl();
    mp3Play();
  }
  function mp3Play() {
    if (!MP3.audio) return;
    const doPlay = () => {
      const p = MP3.audio.play();
      if (p && typeof p.then === 'function') p.then(() => { MP3.playing = true; mp3UpdatePlayBtn(); mp3StartInterval(); }).catch(() => {});
      else { MP3.playing = true; mp3UpdatePlayBtn(); mp3StartInterval(); }
    };
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().then(doPlay).catch(doPlay);
    } else {
      doPlay();
    }
  }
  function mp3Pause()  { if (!MP3.audio) return; MP3.audio.pause();              MP3.playing = false; mp3UpdatePlayBtn(); mp3StopInterval();  }
  function mp3Toggle() { if (!MP3.audio) return; MP3.audio.paused ? mp3Play() : mp3Pause(); }
  function mp3Stop()   { if (MP3.audio) { MP3.audio.pause(); MP3.audio.currentTime = 0; } MP3.playing = false; mp3UpdatePlayBtn(); mp3StopInterval(); }
  function mp3StartInterval() {
    mp3StopInterval();
    MP3._interval = setInterval(() => {
      if (!MP3.audio) return;
      const cur = MP3.audio.currentTime || 0, dur = MP3.audio.duration || 0;
      const pct = dur > 0 ? (cur / dur) * 100 : 0;
      const prog = document.getElementById('bm-mp3-prog');
      const time = document.getElementById('bm-mp3-time');
      if (prog) prog.style.width = pct + '%';
      if (time) time.textContent = fmtMp3Time(cur) + ' / ' + fmtMp3Time(dur);
      if (MP3.analyser) {
        const buf = new Uint8Array(MP3.analyser.frequencyBinCount);
        MP3.analyser.getByteFrequencyData(buf);
        const bars = document.querySelectorAll('.bm-mp3-bar');
        const step = Math.floor(buf.length / Math.max(bars.length, 1));
        bars.forEach((b, i) => { const v = buf[i * step] / 255; b.style.transform = `scaleY(${0.08 + v * 0.92})`; });
      }
    }, 100);
  }
  function mp3StopInterval() { if (MP3._interval) { clearInterval(MP3._interval); MP3._interval = null; } }
  function fmtMp3Time(s) { const m = Math.floor(s/60); return m + ':' + Math.floor(s%60).toString().padStart(2,'0'); }
  function mp3UpdatePlayBtn() { const btn = document.getElementById('bm-mp3-playbtn'); if (btn) btn.textContent = MP3.playing ? '⏸' : '▶'; }
  function mp3UpdateNameEl()  { const nm  = document.getElementById('bm-mp3-name');    if (nm)  nm.textContent  = MP3.fileName || 'No file loaded'; }

  /* ══════════════════════════════════════════════════════════
     getUserMedia HOOK
     ══════════════════════════════════════════════════════════ */
  const origGUM = navigator.mediaDevices && navigator.mediaDevices.getUserMedia
    ? navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices) : null;

  if (origGUM) {
    navigator.mediaDevices.getUserMedia = async function (constraints) {
      const stream = await origGUM(constraints);
      if (!constraints || !constraints.audio) return stream;
      try {
        const ctx = getCtx(); if (!ctx) return stream;
        if (activeChain) { try { activeChain.stop(); } catch(_){} activeChain = null; }
        activeChain = buildChain(ctx, stream);
        window.__OGxISAI_CHAIN__ = activeChain;
        mp3RouteToCurrentTarget();
        window.dispatchEvent(new CustomEvent('bm:ready'));
        const processed = activeChain.dest.stream;
        const newStream = new MediaStream();
        processed.getAudioTracks().forEach(t => newStream.addTrack(t));
        stream.getVideoTracks().forEach(t => newStream.addTrack(t));
        return newStream;
      } catch (e) {
        console.warn('[OGxISAI] stream wrap failed', e);
        return stream;
      }
    };
  }

  function applyState() {
    if (!activeChain || !audioCtx) return;
    const t = audioCtx.currentTime;
    activeChain.masterGainNode.gain.setTargetAtTime(STATE.masterGain, t, 0.02);
    activeChain.preAmp.gain.setTargetAtTime(STATE.preAmp, t, 0.02);
    activeChain.eqNodes.forEach((f, i) => f.gain.setTargetAtTime(STATE.eqBands[i] || 0, t, 0.02));
    activeChain.applyPitch(STATE.pitch);
    activeChain.applyDeepKid();
    activeChain.applyMasterGainUltra();
    activeChain.applyUltraGain();
    activeChain.applyRawBoost();
    if (STATE.compEnabled) {
      activeChain.comp.threshold.setTargetAtTime(STATE.compThreshold, t, 0.02);
      activeChain.comp.ratio.setTargetAtTime(STATE.compRatio, t, 0.02);
    }
  }

  /* ══════════════════════════════════════════════════════════
     BLOODYMOON STYLES
     ══════════════════════════════════════════════════════════ */
  function injectStyles() {
    const s = document.createElement('style');
    s.id = 'bm-styles';
    s.textContent = `
@import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@700;900&family=Rajdhani:wght@500;700&family=Inter:wght@400;500;600;700&display=swap');

@keyframes bmBootIn    { from{opacity:0} to{opacity:1} }
@keyframes bmBootOut   { from{opacity:1;transform:scale(1)} to{opacity:0;transform:scale(1.05)} }
@keyframes bmShimmer   { to{background-position:300% center} }
@keyframes bmTitleIn   { from{opacity:0;transform:translateY(28px) scale(0.9)} to{opacity:1;transform:none} }
@keyframes bmPulse     { 0%,100%{opacity:0.3} 50%{opacity:0.85} }
@keyframes bmDotPulse  { 0%,100%{box-shadow:0 0 6px #b91c1c,0 0 14px rgba(185,28,28,.45)} 50%{box-shadow:0 0 14px #ef4444,0 0 30px rgba(220,38,38,.7)} }
@keyframes bmMoonFloat { 0%,100%{transform:translateY(0) rotate(-3deg)} 50%{transform:translateY(-10px) rotate(3deg)} }
@keyframes bmGlow      { 0%,100%{opacity:.55} 50%{opacity:1} }
@keyframes bmBorderSpin{ to{background-position:200% center} }
@keyframes bmSectionIn { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:none} }
@keyframes bmChaos     { from{box-shadow:0 0 20px rgba(185,28,28,.5)} to{box-shadow:0 0 44px rgba(185,28,28,.9),0 0 70px rgba(239,68,68,.35)} }
@keyframes bmBarPulse    { 0%,100%{transform:scaleY(0.3)} 50%{transform:scaleY(1)} }
@keyframes bmDrip        { 0%{height:0;opacity:0} 20%{opacity:1} 100%{height:100vh;opacity:.6} }
@keyframes bmScanline    { 0%{transform:translateY(-100%)} 100%{transform:translateY(100vh)} }
@keyframes bmGlitch      { 0%,100%{clip-path:inset(0 0 100% 0)} 20%{clip-path:inset(33% 0 40% 0)} 40%{clip-path:inset(50% 0 20% 0)} 60%{clip-path:inset(10% 0 70% 0)} 80%{clip-path:inset(80% 0 5% 0)} }
@keyframes bmBloodPulse  { 0%,100%{opacity:0;transform:scaleX(0)} 50%{opacity:1;transform:scaleX(1)} }
@keyframes bmFlicker     { 0%,19%,21%,23%,25%,54%,56%,100%{opacity:1} 20%,24%,55%{opacity:0.4} }
@keyframes bmSlideUp     { from{opacity:0;transform:translateY(40px)} to{opacity:1;transform:translateY(0)} }

/* ─── Loading screen ─── */
#bm-boot {
  position:fixed;inset:0;z-index:2147483647;
  display:flex;flex-direction:column;align-items:flex-end;justify-content:flex-end;
  overflow:hidden;animation:bmBootIn .4s ease both;
  background:#000;
}
#bm-boot-bg {
  position:absolute;inset:0;object-fit:cover;width:100%;height:100%;
  filter:brightness(1.0) saturate(1.3) contrast(1.05);pointer-events:none;
}
#bm-boot-overlay {
  position:absolute;inset:0;pointer-events:none;
  background:linear-gradient(
    to top,
    rgba(0,0,0,.92) 0%,
    rgba(0,0,0,.55) 30%,
    rgba(0,0,0,.1) 60%,
    rgba(0,0,0,0) 100%
  );
}
#bm-boot-scanline {
  position:absolute;left:0;right:0;height:3px;
  background:linear-gradient(90deg,transparent,rgba(220,38,38,.18),transparent);
  animation:bmScanline 3s linear infinite;pointer-events:none;z-index:3;
}
#bm-boot-scanline2 {
  position:absolute;left:0;right:0;height:1px;
  background:rgba(255,255,255,.04);
  background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,.08) 2px,rgba(0,0,0,.08) 4px);
  inset:0;pointer-events:none;z-index:2;
}
.bm-boot-drip {
  position:absolute;top:0;width:2px;background:linear-gradient(180deg,#dc2626,#7f1d1d,transparent);
  border-radius:0 0 2px 2px;pointer-events:none;z-index:4;opacity:0;
  animation:bmDrip linear infinite;
}
.bm-boot-content {
  position:relative;z-index:5;display:flex;flex-direction:column;align-items:center;gap:0;
  font-family:'Cinzel',serif;text-align:center;width:100%;
  padding:0 24px 36px;
}
.bm-boot-moon {
  font-size:80px;animation:bmMoonFloat 3.5s ease-in-out infinite;
  filter:drop-shadow(0 0 40px rgba(185,28,28,1)) drop-shadow(0 0 80px rgba(239,68,68,.6)) drop-shadow(0 0 120px rgba(185,28,28,.3));
  margin-bottom:14px;line-height:1;animation:bmMoonFloat 3.5s ease-in-out infinite,bmSlideUp .7s cubic-bezier(.16,1,.3,1) .05s both;
}
.bm-boot-title {
  font-size:clamp(40px,9vw,80px);font-weight:900;letter-spacing:12px;
  color:#fff;
  text-shadow:
    0 0 20px rgba(220,38,38,1),
    0 0 40px rgba(220,38,38,.8),
    0 0 80px rgba(185,28,28,.6),
    0 0 120px rgba(185,28,28,.4),
    2px 2px 0 rgba(127,29,29,.8);
  animation:bmFlicker 4s ease-in-out infinite,bmSlideUp .8s cubic-bezier(.16,1,.3,1) .15s both;
  line-height:1.05;
}
.bm-boot-sub {
  font-family:'Rajdhani',sans-serif;font-size:12px;letter-spacing:8px;
  color:rgba(252,165,165,.75);text-transform:uppercase;margin-top:12px;
  text-shadow:0 0 16px rgba(220,38,38,.7),0 0 32px rgba(185,28,28,.4);
  animation:bmSlideUp .8s cubic-bezier(.16,1,.3,1) .3s both;
}
.bm-boot-bar-wrap {
  margin-top:24px;width:min(360px,90vw);
  animation:bmSlideUp .8s cubic-bezier(.16,1,.3,1) .45s both;
}
.bm-boot-bar-track {
  height:6px;background:rgba(127,29,29,.2);border-radius:3px;overflow:visible;
  border:1px solid rgba(220,38,38,.2);box-shadow:0 0 12px rgba(220,38,38,.1),inset 0 1px 0 rgba(255,255,255,.04);
}
.bm-boot-bar-fill {
  height:100%;
  background:linear-gradient(90deg,#450a0a,#7f1d1d,#dc2626,#ef4444,#fca5a5,#fff);
  border-radius:3px;width:0%;transition:width .15s linear;
  box-shadow:0 0 10px #dc2626,0 0 30px rgba(220,38,38,.7),0 0 60px rgba(185,28,28,.4);
  position:relative;
}
.bm-boot-bar-fill::after {
  content:'';position:absolute;inset:0;
  background:linear-gradient(90deg,transparent 70%,rgba(255,255,255,.4));
  border-radius:3px;
}
.bm-boot-bar-label {
  margin-top:10px;font-size:10px;letter-spacing:4px;
  color:rgba(252,165,165,.55);text-align:center;text-transform:uppercase;
  font-family:'Rajdhani',sans-serif;
  text-shadow:0 0 10px rgba(220,38,38,.5);
  animation:bmFlicker 3s ease-in-out infinite;
}
.bm-boot-pct {
  position:absolute;right:0;top:-20px;
  font-size:10px;font-family:'Rajdhani',sans-serif;letter-spacing:1px;
  color:rgba(252,165,165,.5);
}

/* ─── Root ─── */
#bm-root {
  position:fixed;inset:0;pointer-events:none;z-index:2147483646;
  font-family:'Inter',sans-serif;-webkit-font-smoothing:antialiased;
}
#bm-root *, #bm-root *::before, #bm-root *::after { box-sizing:border-box; }

/* ─── Launcher pill ─── */
#bm-launcher {
  position:absolute;top:14px;right:14px;pointer-events:auto;
  display:inline-flex;align-items:center;gap:10px;
  background:linear-gradient(135deg,rgba(0,0,0,.98),rgba(2,12,42,.95));
  border:1px solid rgba(37,99,235,.5);color:#bfdbfe;font-weight:700;font-size:13px;
  padding:9px 18px 9px 13px;border-radius:30px;cursor:pointer;
  box-shadow:0 0 24px rgba(37,99,235,.18),0 8px 24px rgba(0,0,0,.7),inset 0 1px 0 rgba(255,255,255,.07);
  transition:all .28s cubic-bezier(.16,1,.3,1);backdrop-filter:blur(20px) saturate(150%);
  user-select:none;
}
#bm-launcher:hover {
  border-color:rgba(59,130,246,.7);
  box-shadow:0 0 38px rgba(59,130,246,.3),0 0 18px rgba(37,99,235,.22),0 10px 28px rgba(0,0,0,.7);
  transform:translateY(-2px) scale(1.02);
}
.bm-pill-dot {
  width:8px;height:8px;border-radius:50%;
  background:rgba(255,255,255,.12);transition:all .35s;flex-shrink:0;
}
.bm-pill-dot.live {
  background:#dc2626;
  box-shadow:0 0 10px #dc2626,0 0 22px rgba(185,28,28,.55);
  animation:bmDotPulse 1.4s ease-in-out infinite;
}
.bm-pill-name { font-family:'Cinzel',serif;font-size:11px;letter-spacing:2px;color:#fff; }
.bm-pill-status { font-size:9px;color:rgba(96,165,250,.45);letter-spacing:1.2px;margin-top:1px; }

/* ─── Panel ─── */
#bm-panel {
  position:absolute;top:62px;right:14px;width:380px;
  max-height:calc(100vh - 82px);
  background:linear-gradient(170deg,rgba(3,7,24,.98) 0%,rgba(5,13,38,.99) 60%,rgba(0,0,0,1) 100%);
  border-radius:18px;pointer-events:auto;display:flex;flex-direction:column;
  overflow:hidden;transition:all .36s cubic-bezier(.16,1,.3,1);transform-origin:top right;
  border:1px solid rgba(37,99,235,.22);
  box-shadow:0 0 0 1px rgba(255,255,255,.04) inset,0 0 60px rgba(37,99,235,.1),0 0 130px rgba(59,130,246,.05),0 30px 90px rgba(0,0,0,.88);
  backdrop-filter:blur(32px) saturate(170%);
}
#bm-panel.hidden { opacity:0;transform:scale(.91) translateY(-10px);pointer-events:none; }
#bm-panel::before {
  content:'';position:absolute;top:0;left:0;right:0;height:2px;z-index:10;
  background:linear-gradient(90deg,transparent 0%,#2563eb 10%,#3b82f6 25%,#dc2626 45%,#ef4444 55%,#3b82f6 75%,#2563eb 90%,transparent 100%);
  background-size:200%;animation:bmGlow 2.8s ease-in-out infinite,bmBorderSpin 5s linear infinite;
}

/* ─── Header gif ─── */
.bm-hdr-gif {
  width:100%;height:80px;object-fit:cover;object-position:center;
  display:block;opacity:0.85;flex-shrink:0;
}

/* ─── Panel header ─── */
.bm-hdr {
  display:flex;align-items:center;gap:10px;padding:11px 16px 10px;
  border-bottom:1px solid rgba(37,99,235,.12);position:relative;z-index:2;
  cursor:move;user-select:none;
  background:linear-gradient(180deg,rgba(37,99,235,.06),transparent);
}
.bm-hdr-moon { font-size:22px;filter:drop-shadow(0 0 10px rgba(37,99,235,.85)) drop-shadow(0 0 14px rgba(220,38,38,.35));animation:bmMoonFloat 4s ease-in-out infinite;flex-shrink:0; }
.bm-hdr-info { flex:1;min-width:0; }
.bm-hdr-title {
  font-family:'Cinzel',serif;font-size:15px;font-weight:900;letter-spacing:3px;
  background:linear-gradient(90deg,#2563eb,#3b82f6,#dc2626,#ef4444,#bfdbfe);
  background-size:250%;-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;
  animation:bmShimmer 4s linear infinite;line-height:1;
}
.bm-hdr-sub { font-size:8px;letter-spacing:2.5px;color:rgba(96,165,250,.35);text-transform:uppercase;margin-top:4px;font-family:'Rajdhani',sans-serif; }
.bm-hdr-ver { font-size:8px;padding:3px 7px;border-radius:5px;background:rgba(37,99,235,.12);border:1px solid rgba(37,99,235,.28);color:rgba(96,165,250,.55);font-family:'Rajdhani',sans-serif;letter-spacing:1px;margin-left:auto;align-self:flex-start;flex-shrink:0; }
.bm-hdr-close {
  width:28px;height:28px;border-radius:50%;background:rgba(37,99,235,.08);
  border:1px solid rgba(37,99,235,.22);color:rgba(96,165,250,.55);
  display:flex;align-items:center;justify-content:center;cursor:pointer;
  font-size:12px;transition:all .2s;flex-shrink:0;
}
.bm-hdr-close:hover { background:rgba(37,99,235,.25);color:#fff;border-color:rgba(59,130,246,.55);transform:rotate(90deg) scale(1.1); }

/* ─── Status + meter ─── */
.bm-status {
  display:flex;align-items:center;gap:8px;padding:6px 16px;
  background:rgba(15,23,42,.15);border-bottom:1px solid rgba(37,99,235,.1);
  font-family:'Rajdhani',sans-serif;position:relative;z-index:2;
}
.bm-status-dot { width:6px;height:6px;border-radius:50%;background:rgba(255,255,255,.12);flex-shrink:0;transition:all .35s; }
.bm-status-dot.live { background:#dc2626;box-shadow:0 0 7px #dc2626,0 0 14px rgba(185,28,28,.55);animation:bmDotPulse 1.4s ease-in-out infinite; }
.bm-status-text { font-size:10px;letter-spacing:1.8px;color:rgba(96,165,250,.55);text-transform:uppercase;flex:1; }
.bm-status-session { font-size:9px;color:rgba(96,165,250,.35);letter-spacing:1px; }

.bm-meter-wrap { padding:6px 16px 5px;display:flex;align-items:center;gap:9px;position:relative;z-index:2; }
.bm-meter-lbl { font-size:9px;letter-spacing:1.8px;color:rgba(96,165,250,.35);text-transform:uppercase;font-family:'Rajdhani',sans-serif;width:20px;flex-shrink:0; }
.bm-meter { flex:1;height:5px;background:rgba(255,255,255,.04);border-radius:3px;overflow:hidden;border:1px solid rgba(37,99,235,.1); }
.bm-meter-fill { height:100%;background:linear-gradient(90deg,#1d4ed8 0%,#2563eb 45%,#dc2626 75%,#ef4444 100%);border-radius:3px;width:0%;transition:width .07s linear;box-shadow:0 0 10px rgba(37,99,235,.55); }
.bm-meter-fill.clip { background:linear-gradient(90deg,#1e3a8a,#2563eb,#dc2626,#f00) !important;box-shadow:0 0 16px rgba(37,99,235,.9) !important; }
.bm-meter-val { font-size:9px;font-family:'Rajdhani',sans-serif;color:rgba(96,165,250,.5);width:38px;text-align:right;font-variant-numeric:tabular-nums;letter-spacing:.5px; }

/* ─── Tabs ─── */
.bm-tabs {
  display:flex;gap:0;padding:8px 10px 0;overflow-x:auto;scrollbar-width:none;
  border-bottom:1px solid rgba(37,99,235,.12);position:relative;z-index:2;
  background:rgba(255,255,255,.01);
}
.bm-tabs::-webkit-scrollbar { display:none; }
.bm-tab {
  flex-shrink:0;padding:6px 9px 9px;font-size:8px;font-weight:700;letter-spacing:1.1px;
  text-transform:uppercase;color:rgba(96,165,250,.3);cursor:pointer;transition:all .2s;
  position:relative;font-family:'Rajdhani',sans-serif;white-space:nowrap;
  display:flex;flex-direction:column;align-items:center;gap:2px;border-radius:7px 7px 0 0;
}
.bm-tab-icon { font-size:12px;line-height:1; }
.bm-tab::after {
  content:'';position:absolute;bottom:0;left:15%;right:15%;height:2px;
  background:linear-gradient(90deg,#2563eb,#3b82f6,#dc2626);border-radius:2px 2px 0 0;
  transform:scaleX(0);transition:transform .22s cubic-bezier(.16,1,.3,1);
  box-shadow:0 0 8px rgba(37,99,235,.6);
}
.bm-tab:hover  { color:rgba(96,165,250,.65);background:rgba(37,99,235,.07); }
.bm-tab.active { color:#fff;background:rgba(37,99,235,.09); }
.bm-tab.active::after { transform:scaleX(1); }

/* ─── Scrollable body ─── */
.bm-body {
  flex:1;overflow-y:auto;overflow-x:hidden;padding:14px 14px 18px;
  position:relative;z-index:1;scrollbar-width:thin;
  scrollbar-color:rgba(37,99,235,.25) transparent;
}
.bm-body::-webkit-scrollbar { width:3px; }
.bm-body::-webkit-scrollbar-thumb { background:linear-gradient(180deg,#1d4ed8,#2563eb);border-radius:3px; }
.bm-body::-webkit-scrollbar-track { background:transparent; }
.bm-section { animation:bmSectionIn .25s cubic-bezier(.16,1,.3,1) both; }

/* ─── Slider blocks ─── */
.bm-slider-block {
  margin-bottom:9px;padding:11px 13px;
  background:rgba(255,255,255,.022);border:1px solid rgba(37,99,235,.1);
  border-radius:12px;transition:border-color .2s,box-shadow .2s;
}
.bm-slider-block:hover { border-color:rgba(37,99,235,.26);box-shadow:0 0 20px rgba(37,99,235,.06); }
.bm-slider-hdr { display:flex;justify-content:space-between;align-items:center;margin-bottom:9px; }
.bm-slider-name {
  font-size:10px;letter-spacing:1.5px;text-transform:uppercase;
  color:rgba(96,165,250,.55);font-weight:700;font-family:'Rajdhani',sans-serif;
  display:flex;align-items:center;gap:7px;
}
.bm-slider-name span { font-size:13px; }
.bm-slider-val {
  font-family:'Rajdhani',sans-serif;font-size:12px;font-weight:700;
  background:linear-gradient(90deg,#2563eb,#3b82f6,#dc2626,#ef4444);
  -webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;
  filter:drop-shadow(0 0 6px rgba(37,99,235,.5));
}
.bm-track { position:relative;height:22px;display:flex;align-items:center; }
.bm-track-bg {
  position:absolute;inset:0;margin:auto;height:4px;
  background:rgba(255,255,255,.06);border-radius:3px;overflow:hidden;border:1px solid rgba(37,99,235,.1);
}
.bm-track-fill { height:100%;background:linear-gradient(90deg,#1e3a8a,#2563eb,#dc2626,#ef4444);border-radius:3px;box-shadow:0 0 12px rgba(37,99,235,.45);transition:width .06s linear; }
.bm-range {
  -webkit-appearance:none;appearance:none;position:absolute;width:100%;height:100%;
  background:transparent;margin:0;cursor:pointer;z-index:2;
}
.bm-range::-webkit-slider-thumb {
  -webkit-appearance:none;width:18px;height:18px;border-radius:50%;
  background:radial-gradient(circle at 35% 35%,#fff 0%,#93c5fd 45%,#2563eb 100%);
  border:2px solid rgba(255,255,255,.5);
  box-shadow:0 0 0 3px rgba(37,99,235,.18),0 0 14px rgba(37,99,235,.6),0 0 30px rgba(59,130,246,.25);
  transition:transform .14s ease,box-shadow .14s ease;
}
.bm-range::-webkit-slider-thumb:hover {
  transform:scale(1.28);
  box-shadow:0 0 0 4px rgba(37,99,235,.28),0 0 22px rgba(37,99,235,.8),0 0 46px rgba(59,130,246,.4);
}
.bm-range::-moz-range-thumb {
  width:18px;height:18px;border-radius:50%;
  background:radial-gradient(circle at 35% 35%,#fff 0%,#93c5fd 45%,#2563eb 100%);
  border:2px solid rgba(255,255,255,.5);box-shadow:0 0 14px rgba(37,99,235,.6);
}

/* ─── Toggle row ─── */
.bm-toggle-row {
  display:flex;align-items:center;justify-content:space-between;
  padding:10px 12px;margin-bottom:8px;
  background:rgba(255,255,255,.022);border:1px solid rgba(37,99,235,.1);
  border-radius:12px;transition:all .2s;
}
.bm-toggle-info { display:flex;align-items:center;gap:9px; }
.bm-toggle-icon { font-size:16px; }
.bm-toggle-label { font-size:10px;letter-spacing:1.2px;text-transform:uppercase;color:rgba(96,165,250,.65);font-weight:700;font-family:'Rajdhani',sans-serif; }
.bm-toggle-sub { font-size:9px;color:rgba(96,165,250,.35);letter-spacing:.8px;margin-top:2px;font-family:'Rajdhani',sans-serif; }
.bm-toggle {
  width:38px;height:20px;border-radius:10px;background:rgba(255,255,255,.08);
  border:1px solid rgba(37,99,235,.2);position:relative;cursor:pointer;
  transition:all .25s;flex-shrink:0;
}
.bm-toggle::after { content:'';position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:rgba(96,165,250,.5);transition:all .25s; }
.bm-toggle.on { background:rgba(37,99,235,.25);border-color:rgba(37,99,235,.5);box-shadow:0 0 12px rgba(37,99,235,.3); }
.bm-toggle.on::after { left:20px;background:#dc2626;box-shadow:0 0 8px rgba(220,38,38,.6); }

/* ─── Section title ─── */
.bm-section-title {
  font-size:9px;letter-spacing:3px;text-transform:uppercase;
  color:rgba(96,165,250,.75);font-family:'Rajdhani',sans-serif;font-weight:700;
  margin:12px 0 8px;padding-bottom:6px;border-bottom:1px solid rgba(37,99,235,.1);
  display:flex;align-items:center;gap:6px;
}
.bm-section-title::before { content:'';flex:1;height:1px;background:rgba(37,99,235,.1); }

/* ─── Row end (buttons) ─── */
.bm-row-end { display:flex;justify-content:flex-end;gap:8px;margin-top:8px; }
.bm-btn {
  font-family:'Rajdhani',sans-serif;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;
  padding:7px 14px;border-radius:7px;cursor:pointer;border:none;transition:all .2s;font-weight:700;
}
.bm-btn-ghost { background:transparent;border:1px solid rgba(37,99,235,.25);color:rgba(96,165,250,.55); }
.bm-btn-ghost:hover { border-color:rgba(59,130,246,.5);color:#bfdbfe;background:rgba(37,99,235,.08); }
.bm-btn-primary { background:rgba(37,99,235,.2);border:1px solid rgba(59,130,246,.4);color:#bfdbfe; }
.bm-btn-primary:hover { background:rgba(59,130,246,.3);border-color:rgba(96,165,250,.6);color:#fff; }

/* ─── FX grid ─── */
.bm-fx-grid { display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-bottom:10px; }
.bm-fx-cell {
  display:flex;flex-direction:column;align-items:center;gap:4px;padding:10px 5px 8px;
  background:rgba(255,255,255,.022);border:1px solid rgba(37,99,235,.1);border-radius:10px;
  cursor:pointer;transition:all .2s;position:relative;overflow:hidden;
}
.bm-fx-cell:hover { border-color:var(--fc,rgba(37,99,235,.4));background:rgba(255,255,255,.04);transform:translateY(-1px); }
.bm-fx-cell.active { border-color:var(--fc,#2563eb);background:rgba(255,255,255,.06);box-shadow:0 0 12px color-mix(in srgb, var(--fc,#2563eb) 30%, transparent); }
.bm-fx-emoji { font-size:20px;line-height:1; }
.bm-fx-name { font-size:8px;letter-spacing:.8px;text-transform:uppercase;color:rgba(96,165,250,.65);font-family:'Rajdhani',sans-serif;font-weight:700; }
.bm-fx-clear { width:100%;padding:8px;background:transparent;border:1px dashed rgba(37,99,235,.2);border-radius:8px;color:rgba(96,165,250,.6);font-size:9px;letter-spacing:1.5px;text-transform:uppercase;font-family:'Rajdhani',sans-serif;cursor:pointer;transition:all .2s; }
.bm-fx-clear:hover { border-color:rgba(59,130,246,.4);color:rgba(96,165,250,.8); }

/* ─── EQ ─── */
.bm-eq-grid { display:flex;gap:4px;justify-content:space-between;height:130px;margin-bottom:8px;align-items:flex-end; }
.bm-eq-col { display:flex;flex-direction:column;align-items:center;flex:1;height:100%; }
.bm-eq-val { font-size:8px;color:rgba(96,165,250,.65);font-family:'Rajdhani',sans-serif;font-weight:700;height:16px;display:flex;align-items:center; }
.bm-eq-slider {
  -webkit-appearance:slider-vertical;appearance:slider-vertical;writing-mode:vertical-lr;
  direction:rtl;flex:1;width:100%;max-width:20px;cursor:pointer;
  -webkit-appearance:none;appearance:none;background:rgba(255,255,255,.06);
  border-radius:3px;border:1px solid rgba(37,99,235,.12);
}
.bm-eq-slider::-webkit-slider-thumb { -webkit-appearance:none;width:14px;height:14px;border-radius:50%;background:radial-gradient(circle,#93c5fd,#2563eb);box-shadow:0 0 8px rgba(37,99,235,.5); }
.bm-eq-label { font-size:7px;color:rgba(96,165,250,.45);font-family:'Rajdhani',sans-serif;margin-top:3px; }

/* ─── Presets list ─── */
.bm-preset-list { display:flex;flex-direction:column;gap:5px; }
.bm-preset {
  display:flex;align-items:center;gap:10px;padding:10px 12px;
  background:rgba(255,255,255,.022);border:1px solid rgba(37,99,235,.1);
  border-radius:10px;cursor:pointer;transition:all .18s;
}
.bm-preset:hover { background:rgba(37,99,235,.08);border-color:rgba(59,130,246,.3);transform:translateX(3px); }
.bm-preset-icon { font-size:18px;flex-shrink:0; }
.bm-preset-name { font-size:11px;font-weight:700;color:rgba(96,165,250,.85);font-family:'Rajdhani',sans-serif;letter-spacing:.8px; }
.bm-preset-sub { font-size:9px;color:rgba(96,165,250,.45);font-family:'Rajdhani',sans-serif;margin-top:2px; }
.bm-preset-arrow { margin-left:auto;font-size:16px;color:rgba(37,99,235,.6);flex-shrink:0; }

/* ─── Power grid ─── */
.bm-power-grid { display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-bottom:12px; }
.bm-power-btn {
  padding:12px 10px;background:rgba(255,255,255,.022);border:1px solid rgba(37,99,235,.12);
  border-radius:11px;cursor:pointer;transition:all .2s;text-align:center;
}
.bm-power-btn:hover { background:rgba(37,99,235,.08);border-color:rgba(59,130,246,.3); }
.bm-power-btn.on { background:rgba(37,99,235,.15);border-color:rgba(59,130,246,.45);box-shadow:0 0 14px rgba(37,99,235,.2); }
.bm-power-icon { font-size:22px;margin-bottom:5px; }
.bm-power-label { font-size:9px;letter-spacing:1.5px;text-transform:uppercase;color:rgba(96,165,250,.6);font-family:'Rajdhani',sans-serif;font-weight:700; }
.chaos-btn.on { background:rgba(37,99,235,.25) !important;border-color:#2563eb !important;animation:bmChaos 0.7s alternate infinite !important; }

/* ─── Stats ─── */
.bm-stats-grid { display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-bottom:10px; }
.bm-stat-card { padding:12px;background:rgba(255,255,255,.022);border:1px solid rgba(37,99,235,.1);border-radius:10px; }
.bm-stat-label { font-size:8px;letter-spacing:1.8px;text-transform:uppercase;color:rgba(96,165,250,.4);font-family:'Rajdhani',sans-serif;margin-bottom:5px; }
.bm-stat-val { font-size:18px;font-weight:700;font-family:'Rajdhani',sans-serif;color:#bfdbfe;letter-spacing:.5px; }

/* ─── Voice cards ─── */
.bm-voice-display {
  padding:12px;background:rgba(37,99,235,.04);border:1px solid rgba(37,99,235,.12);
  border-radius:12px;margin-bottom:10px;text-align:center;
}
.bm-voice-active-name { font-size:15px;font-weight:700;color:#bfdbfe;font-family:'Rajdhani',sans-serif;letter-spacing:1px; }
.bm-voice-active-sub { font-size:9px;color:rgba(96,165,250,.4);font-family:'Rajdhani',sans-serif;margin-top:3px; }
.bm-voice-bars { display:flex;gap:2px;justify-content:center;margin-top:10px;height:30px;align-items:flex-end; }
.bm-voice-bar { width:6px;background:linear-gradient(180deg,#2563eb,#1d4ed8);border-radius:3px;transition:height .1s ease; }
.bm-voice-grid { display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px; }
.bm-voice-card {
  display:flex;align-items:center;gap:8px;padding:9px 10px;
  background:rgba(255,255,255,.02);border:1px solid rgba(37,99,235,.1);
  border-radius:10px;cursor:pointer;transition:all .18s;
}
.bm-voice-card:hover { background:rgba(37,99,235,.07);border-color:rgba(59,130,246,.28); }
.bm-voice-card.active { background:rgba(37,99,235,.14);border-color:rgba(59,130,246,.4);box-shadow:0 0 10px rgba(37,99,235,.15); }
.bm-voice-card-icon { font-size:18px;flex-shrink:0; }
.bm-voice-card-name { font-size:9px;font-weight:700;color:rgba(96,165,250,.8);font-family:'Rajdhani',sans-serif;letter-spacing:.6px; }
.bm-voice-card-desc { font-size:8px;color:rgba(96,165,250,.45);font-family:'Rajdhani',sans-serif;margin-top:1px; }

/* ─── Reverb viz ─── */
.bm-reverb-viz { display:flex;gap:3px;align-items:flex-end;height:40px;margin-bottom:10px;padding:0 4px; }
.bm-reverb-bar { flex:1;background:linear-gradient(180deg,#2563eb,#1d4ed8);border-radius:2px;transition:all .2s; }

/* ─── Wider display ─── */
.bm-wider-display { padding:10px;background:rgba(37,99,235,.04);border:1px solid rgba(37,99,235,.1);border-radius:12px;margin-bottom:10px;text-align:center; }
.bm-wider-viz { display:flex;gap:2px;justify-content:center;align-items:center;height:40px; }
.bm-wider-bar { width:8px;background:linear-gradient(180deg,#2563eb,#1d4ed8);border-radius:2px;transition:all .2s; }
.bm-wider-big { font-size:28px;font-weight:700;font-family:'Rajdhani',sans-serif;color:#bfdbfe;letter-spacing:1px; }
.bm-wider-unit { font-size:9px;color:rgba(96,165,250,.4);letter-spacing:2px;font-family:'Rajdhani',sans-serif; }

/* ─── MP3 Player ─── */
.bm-mp3-drop {
  border:2px dashed rgba(37,99,235,.25);border-radius:10px;padding:16px;text-align:center;cursor:pointer;
  transition:all .2s;position:relative;overflow:hidden;margin-bottom:8px;
  background:rgba(37,99,235,.03);
}
.bm-mp3-drop:hover { border-color:rgba(59,130,246,.45);background:rgba(37,99,235,.06); }
.bm-mp3-drop input[type=file] { position:absolute;inset:0;opacity:0;cursor:pointer; }
.bm-mp3-drop-icon { font-size:24px;margin-bottom:5px; }
.bm-mp3-drop-label { font-size:10px;letter-spacing:1px;color:rgba(96,165,250,.45);font-family:'Rajdhani',sans-serif; }
.bm-mp3-name { font-size:10px;color:rgba(96,165,250,.6);font-family:'Rajdhani',sans-serif;text-align:center;margin-bottom:6px;letter-spacing:.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
.bm-mp3-waveform { display:flex;gap:3px;justify-content:center;height:32px;align-items:flex-end;margin-bottom:6px; }
.bm-mp3-bar { width:6px;background:linear-gradient(180deg,#2563eb,#1d4ed8);border-radius:2px;transform:scaleY(0.08);transform-origin:bottom;transition:transform .1s; }
.bm-mp3-progress-wrap { height:4px;background:rgba(255,255,255,.07);border-radius:2px;cursor:pointer;margin-bottom:4px;overflow:hidden;border:1px solid rgba(37,99,235,.1); }
.bm-mp3-progress-fill { height:100%;background:linear-gradient(90deg,#1d4ed8,#2563eb,#3b82f6);border-radius:2px;width:0%;transition:width .1s; }
.bm-mp3-time { font-size:8px;color:rgba(96,165,250,.35);text-align:center;font-family:'Rajdhani',sans-serif;margin-bottom:8px; }
.bm-mp3-controls { display:flex;gap:8px;justify-content:center;margin-bottom:10px; }
.bm-mp3-btn { width:32px;height:32px;border-radius:50%;background:rgba(255,255,255,.04);border:1px solid rgba(37,99,235,.18);color:rgba(96,165,250,.6);display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:12px;transition:all .18s; }
.bm-mp3-btn:hover,.bm-mp3-btn.play-btn { background:rgba(37,99,235,.15);border-color:rgba(59,130,246,.4);color:#bfdbfe; }
.bm-mp3-btn.active-btn { background:rgba(37,99,235,.2);border-color:rgba(59,130,246,.5); }

/* ─── Raw Boost special ─── */
.bm-rawboost-val { font-family:'Rajdhani',sans-serif;font-size:14px;font-weight:900;color:#bfdbfe;filter:drop-shadow(0 0 8px rgba(59,130,246,.7)); }

/* ─── Dragging cursor ─── */
body.bm-dragging * { cursor:grabbing !important; }
    `;
    document.head.appendChild(s);
  }

  /* ══════════════════════════════════════════════════════════
     BOOT / LOADING SCREEN
     ══════════════════════════════════════════════════════════ */
  function showBoot(onDone) {
    const boot = document.createElement('div');
    boot.id = 'bm-boot';

    /* Background gif — full brightness, no dimming */
    const bgImg = document.createElement('img');
    bgImg.id  = 'bm-boot-bg';
    bgImg.src = LOADING_GIF;
    boot.appendChild(bgImg);

    /* Bottom-fade overlay only — keeps gif visible on top */
    const overlay = document.createElement('div');
    overlay.id = 'bm-boot-overlay';
    boot.appendChild(overlay);

    /* Scanline sweep */
    const scanline = document.createElement('div');
    scanline.id = 'bm-boot-scanline';
    boot.appendChild(scanline);

    /* CRT scanlines texture */
    const scanlines2 = document.createElement('div');
    scanlines2.id = 'bm-boot-scanline2';
    boot.appendChild(scanlines2);

    /* Blood drip columns */
    const dripPositions = [8, 18, 31, 45, 52, 67, 78, 88];
    dripPositions.forEach((pct, i) => {
      const drip = document.createElement('div');
      drip.className = 'bm-boot-drip';
      drip.style.left = pct + '%';
      drip.style.animationDuration = (3.5 + i * 0.7) + 's';
      drip.style.animationDelay    = (i * 0.4) + 's';
      boot.appendChild(drip);
    });

    /* Content pinned to bottom */
    const content = document.createElement('div');
    content.className = 'bm-boot-content';
    content.innerHTML = `
      <div class="bm-boot-moon">🌑</div>
      <div class="bm-boot-title">OGxISAI</div>
      <div class="bm-boot-sub">Ultimate Discord Voice Manager</div>
      <div class="bm-boot-bar-wrap" style="position:relative;">
        <div class="bm-boot-bar-track">
          <div class="bm-boot-bar-fill" id="bm-bar-fill"></div>
        </div>
        <div class="bm-boot-bar-label" id="bm-bar-lbl">Initializing…</div>
      </div>
    `;
    boot.appendChild(content);
    document.body.appendChild(boot);

    const barFill = document.getElementById('bm-bar-fill');
    const barLbl  = document.getElementById('bm-bar-lbl');

    const steps = [
      'Initializing audio engine…',
      'Loading voice effects…',
      'Calibrating EQ filters…',
      'Hooking getUserMedia…',
      'Connecting CHAOS engine…',
      'OGxISAI ready! 🌑',
    ];
    let step = 0;
    const interval = setInterval(() => {
      if (step >= steps.length) { clearInterval(interval); return; }
      const pct = Math.round(((step + 1) / steps.length) * 100);
      barFill.style.width = pct + '%';
      barLbl.textContent  = steps[step];
      step++;
      if (step === steps.length) {
        setTimeout(() => {
          boot.style.animation = 'bmBootOut 0.5s cubic-bezier(0.4,0,1,1) forwards';
          setTimeout(() => { boot.remove(); onDone(); }, 500);
        }, 380);
      }
    }, 260);
  }

  /* ══════════════════════════════════════════════════════════
     UI HELPERS
     ══════════════════════════════════════════════════════════ */
  let panelVisible = false;
  let activeTab    = 'Gain';
  let chainReady   = false;
  let rootEl, launcherEl, panelEl, bodyEl;
  let levelFill, levelVal;
  let statsInterval, voiceBarTimerId;

  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) { typeof html === 'string' ? e.innerHTML = html : e.textContent = html; }
    return e;
  }

  function fmtDb(db) { if (!isFinite(db)) return '-∞'; return (db >= 0 ? '+' : '') + db.toFixed(1) + 'dB'; }
  function fmtTime(ms) {
    const s = Math.floor(ms / 1000), m = Math.floor(s / 60), h = Math.floor(m / 60);
    return h > 0 ? `${h}h${m % 60}m` : m > 0 ? `${m}m${s % 60}s` : `${s}s`;
  }

  function buildSlider({ label, icon, min, max, step, value, format, onChange }) {
    const block = el('div', 'bm-slider-block');
    const hdr   = el('div', 'bm-slider-hdr');
    const name  = el('div', 'bm-slider-name');
    if (icon) { const sp = el('span'); sp.textContent = icon; name.appendChild(sp); }
    const nTxt = el('span'); nTxt.textContent = label; name.appendChild(nTxt);
    const valEl = el('div', 'bm-slider-val', format(value));
    hdr.appendChild(name); hdr.appendChild(valEl);
    const track = el('div', 'bm-track');
    const bg    = el('div', 'bm-track-bg');
    const fill  = el('div', 'bm-track-fill');
    const range = el('input', 'bm-range');
    range.type = 'range'; range.min = min; range.max = max; range.step = step; range.value = value;
    bg.appendChild(fill); track.appendChild(bg); track.appendChild(range);
    block.appendChild(hdr); block.appendChild(track);

    function update(v) {
      const pct = ((v - min) / (max - min)) * 100;
      fill.style.width  = pct + '%';
      valEl.textContent = format(v);
    }
    update(value);
    range.addEventListener('input', () => { const v = parseFloat(range.value); update(v); onChange(v); });
    return { el: block, set(v) { range.value = v; update(v); } };
  }

  function buildToggleRow({ icon, label, sub, checked, onChange }) {
    const row  = el('div', 'bm-toggle-row');
    const info = el('div', 'bm-toggle-info');
    const ic   = el('div', 'bm-toggle-icon', icon);
    const txts = el('div');
    const lbl  = el('div', 'bm-toggle-label', label);
    const subEl= el('div', 'bm-toggle-sub', sub);
    txts.appendChild(lbl); txts.appendChild(subEl);
    info.appendChild(ic); info.appendChild(txts);
    const tog  = el('div', 'bm-toggle' + (checked ? ' on' : ''));
    row.appendChild(info); row.appendChild(tog);
    tog.addEventListener('click', () => { const on = tog.classList.toggle('on'); onChange(on); });
    return { el: row, setOn(v) { v ? tog.classList.add('on') : tog.classList.remove('on'); } };
  }

  /* ── Raw Boost helpers (Bloody Cord quadratic) ─────────── */
  function gainFromSlider(v)  { const t = v / 100; return Math.max(1, Math.round(1 + (MAX_RAW_GAIN - 1) * t * t)); }
  function sliderFromGain(g)  { return Math.round(Math.sqrt((g - 1) / (MAX_RAW_GAIN - 1)) * 100); }
  function formatRaw(g) {
    if (g >= 1000000) return (g / 1000000).toFixed(2) + 'M×';
    if (g >= 1000)    return (g / 1000).toFixed(1) + 'K×';
    return g + '×';
  }

  /* ══════════════════════════════════════════════════════════
     TAB BUILDERS
     ══════════════════════════════════════════════════════════ */

  /* ── Gain/Amp Tab ── */
  function buildGainTab() {
    const root = el('div', 'bm-section');

    const masterSlider = buildSlider({
      label:'Master Gain', icon:'🎚️',
      min:0, max:25, step:0.1, value:STATE.masterGain,
      format: v => fmtDb(v <= 0 ? -Infinity : 20 * Math.log10(v)),
      onChange: v => { STATE.masterGain = v; applyState(); }
    });
    const preAmpSlider = buildSlider({
      label:'Pre-Amp', icon:'🔊',
      min:0, max:15, step:0.1, value:STATE.preAmp,
      format: v => fmtDb(v <= 0 ? -Infinity : 20 * Math.log10(v)),
      onChange: v => { STATE.preAmp = v; applyState(); }
    });
    const widthSlider = buildSlider({
      label:'Stereo Width', icon:'↔️',
      min:0, max:100, step:1, value:STATE.stereoWidth,
      format: v => Math.round(v) + '%',
      onChange: v => {
        STATE.stereoWidth = v; STATE.widerEnabled = v > 0;
        STATE.widerWidth  = 1 + (v / 100) * 6; STATE.widerDepth = 1;
        if (activeChain) activeChain.applyWider();
      }
    });

    root.appendChild(masterSlider.el);
    root.appendChild(preAmpSlider.el);
    root.appendChild(widthSlider.el);

    /* Raw Boost (Bloody Cord) */
    const rawTitle = el('div', 'bm-section-title', '🩸 Loudest Mic');
    root.appendChild(rawTitle);

    const rawBlock = el('div', 'bm-slider-block');
    const rawHdr   = el('div', 'bm-slider-hdr');
    const rawName  = el('div', 'bm-slider-name');
    const rawIcon  = el('span'); rawIcon.textContent = '🩸'; rawName.appendChild(rawIcon);
    const rawTxt   = el('span'); rawTxt.textContent  = 'Loudest Mic'; rawName.appendChild(rawTxt);
    const rawVal   = el('div', 'bm-slider-val bm-rawboost-val', formatRaw(STATE.rawBoost));
    rawHdr.appendChild(rawName); rawHdr.appendChild(rawVal);

    const rawTrack  = el('div', 'bm-track');
    const rawBg     = el('div', 'bm-track-bg');
    const rawFill   = el('div', 'bm-track-fill');
    const rawRange  = el('input', 'bm-range');
    rawRange.type = 'range'; rawRange.min = 0; rawRange.max = 100; rawRange.step = 1;
    rawRange.value = sliderFromGain(STATE.rawBoost);
    rawBg.appendChild(rawFill); rawTrack.appendChild(rawBg); rawTrack.appendChild(rawRange);
    rawBlock.appendChild(rawHdr); rawBlock.appendChild(rawTrack);

    function updateRaw(v) {
      const pct = v;
      rawFill.style.width = pct + '%';
      const g = gainFromSlider(v);
      STATE.rawBoost = g;
      rawVal.textContent = formatRaw(g);
      if (activeChain) activeChain.applyRawBoost();
    }
    updateRaw(parseInt(rawRange.value));
    rawRange.addEventListener('input', () => updateRaw(parseInt(rawRange.value)));
    root.appendChild(rawBlock);

    const rawWarning = el('div');
    rawWarning.style.cssText = 'font-size:9px;color:rgba(96,165,250,.75);text-align:center;padding:4px 8px;letter-spacing:.5px;font-family:Rajdhani,sans-serif;';
    rawWarning.textContent = '⚠ Extreme boost may cause feedback. Use headphones!';
    root.appendChild(rawWarning);

    /* Ultra Gain section */
    const ultraTitle = el('div', 'bm-section-title', '⚡ Ultra Gain');
    root.appendChild(ultraTitle);

    const godSlider = buildSlider({
      label:'God Gain', icon:'⚡',
      min:0, max:1, step:0.01, value:STATE.godGain,
      format: v => (v * 100).toFixed(0) + '%',
      onChange: v => { STATE.godGain = v; if (activeChain) activeChain.applyUltraGain(); }
    });
    const hyperSlider = buildSlider({
      label:'Hyper Boost', icon:'🚀',
      min:0, max:1, step:0.01, value:STATE.hyperBoost,
      format: v => (v * 100).toFixed(0) + '%',
      onChange: v => { STATE.hyperBoost = v; if (activeChain) activeChain.applyUltraGain(); }
    });
    root.appendChild(godSlider.el);
    root.appendChild(hyperSlider.el);

    /* ── Master Gain Ultra ──────────────────────────────── */
    const ultraSec = el('div', 'bm-section-title', '👑 Master Gain Ultra');
    root.appendChild(ultraSec);

    function fmtUltra(t) {
      const g = t <= 0 ? 1 : Math.pow(40_000_000, t);
      if (g >= 1_000_000) return (g/1_000_000).toFixed(2) + 'M×';
      if (g >= 1_000)     return (g/1_000).toFixed(1) + 'K×';
      return Math.round(g) + '×';
    }
    const ultraSlider = buildSlider({
      label: 'Ultra Gain', icon: '👑',
      min: 0, max: 1, step: 0.001, value: STATE.masterGainUltra,
      format: fmtUltra,
      onChange: v => { STATE.masterGainUltra = v; if (activeChain) activeChain.applyMasterGainUltra(); }
    });
    root.appendChild(ultraSlider.el);

    const ultraHint = el('div');
    ultraHint.style.cssText = 'font-size:9px;color:rgba(96,165,250,.65);text-align:center;padding:2px 8px 6px;letter-spacing:.5px;font-family:Rajdhani,sans-serif;';
    ultraHint.textContent = '👑 Lord Wisdom Ultra — up to 40,000,000× — use headphones!';
    root.appendChild(ultraHint);

    /* ── Voice Morph (Deep / Kid) ────────────────────────── */
    const voiceSec = el('div', 'bm-section-title', '🎭 Voice Morph');
    root.appendChild(voiceSec);

    const deepSlider = buildSlider({
      label: 'Deep Voice', icon: '🔉',
      min: 0, max: 1, step: 0.01, value: STATE.deepVoice,
      format: v => Math.round(v * 100) + '%',
      onChange: v => { STATE.deepVoice = v; if (activeChain) activeChain.applyDeepKid(); }
    });
    const kidSlider = buildSlider({
      label: 'Kid Voice', icon: '🐣',
      min: 0, max: 1, step: 0.01, value: STATE.kidVoice,
      format: v => Math.round(v * 100) + '%',
      onChange: v => { STATE.kidVoice = v; if (activeChain) activeChain.applyDeepKid(); }
    });
    root.appendChild(deepSlider.el);
    root.appendChild(kidSlider.el);

    const rowEnd   = el('div', 'bm-row-end');
    const resetBtn = el('button', 'bm-btn bm-btn-ghost', '↺ Reset All');
    resetBtn.addEventListener('click', () => {
      STATE.masterGain = 1.0; STATE.preAmp = 1.0; STATE.rawBoost = 1; STATE.rawSlider = 0;
      STATE.stereoWidth = 0; STATE.godGain = 0; STATE.hyperBoost = 0; STATE.pitch = 0;
      STATE.deepVoice = 0; STATE.kidVoice = 0; STATE.masterGainUltra = 0;
      STATE.eqBands = [0,0,0,0,0,0,0,0,0,0]; STATE.effect = null;
      STATE.reverb  = { wetMix: 0.35, decay: 3.5, roomSize: 2.3, dry: false };
      masterSlider.set(1.0); preAmpSlider.set(1.0); widthSlider.set(0);
      godSlider.set(0); hyperSlider.set(0);
      ultraSlider.set(0); deepSlider.set(0); kidSlider.set(0);
      rawRange.value = 0; updateRaw(0);
      applyState();
      if (activeChain) { activeChain.rebuildEffect(); activeChain.rebuildReverb(); activeChain.rebuildReverbImpulse(); }
    });
    rowEnd.appendChild(resetBtn);
    root.appendChild(rowEnd);
    return root;
  }

  /* ── Effects Tab ── */
  function buildEffectsTab() {
    const root = el('div', 'bm-section');
    const grid = el('div', 'bm-fx-grid');
    EFFECTS.forEach(fx => {
      const cell = el('div', 'bm-fx-cell');
      cell.style.setProperty('--fc', fx.color);
      if (STATE.effect === fx.id) cell.classList.add('active');
      cell.appendChild(el('div', 'bm-fx-emoji', fx.icon));
      cell.appendChild(el('div', 'bm-fx-name', fx.name));
      cell.addEventListener('click', () => {
        STATE.effect = STATE.effect === fx.id ? null : fx.id;
        if (activeChain) activeChain.rebuildEffect();
        grid.querySelectorAll('.bm-fx-cell').forEach(c => c.classList.remove('active'));
        if (STATE.effect) cell.classList.add('active');
      });
      grid.appendChild(cell);
    });
    root.appendChild(grid);
    const clearBtn = el('button', 'bm-fx-clear', '✕ Clear Effect');
    clearBtn.addEventListener('click', () => {
      STATE.effect = null;
      if (activeChain) activeChain.rebuildEffect();
      grid.querySelectorAll('.bm-fx-cell').forEach(c => c.classList.remove('active'));
    });
    root.appendChild(clearBtn);
    return root;
  }

  /* ── EQ Tab ── */
  function buildEqTab() {
    const root    = el('div', 'bm-section');
    const grid    = el('div', 'bm-eq-grid');
    const sliders = [];
    EQ_LABELS.forEach((lbl, i) => {
      const col    = el('div', 'bm-eq-col');
      const val    = el('div', 'bm-eq-val', (STATE.eqBands[i] || 0) > 0 ? '+' + STATE.eqBands[i] : (STATE.eqBands[i] || 0).toString());
      const slider = document.createElement('input');
      slider.type = 'range'; slider.className = 'bm-eq-slider';
      slider.min = -15; slider.max = 15; slider.step = 0.5; slider.value = STATE.eqBands[i] || 0;
      slider.style.writingMode = 'vertical-lr'; slider.style.webkitAppearance = 'slider-vertical';
      slider.style.height = '100%'; slider.style.flex = '1';
      const label = el('div', 'bm-eq-label', lbl);
      slider.addEventListener('input', () => {
        const v = parseFloat(slider.value);
        STATE.eqBands[i] = v;
        val.textContent   = (v > 0 ? '+' : '') + v;
        if (activeChain && activeChain.eqNodes[i]) {
          activeChain.eqNodes[i].gain.setTargetAtTime(v, audioCtx.currentTime, 0.02);
        }
      });
      col.appendChild(val); col.appendChild(slider); col.appendChild(label);
      grid.appendChild(col);
      sliders.push({ slider, val });
    });
    root.appendChild(grid);
    const rowEnd  = el('div', 'bm-row-end');
    const flatBtn = el('button', 'bm-btn bm-btn-ghost', '♭ Flat');
    flatBtn.addEventListener('click', () => {
      STATE.eqBands = STATE.eqBands.map(() => 0);
      sliders.forEach(({ slider, val }) => { slider.value = 0; val.textContent = '0'; });
      applyState();
    });
    rowEnd.appendChild(flatBtn);
    root.appendChild(rowEnd);
    return root;
  }

  /* ── Reverb Tab ── */
  function buildReverbTab() {
    const root = el('div', 'bm-section');
    const viz  = el('div', 'bm-reverb-viz');
    const bars = [];
    for (let i = 0; i < 20; i++) { const b = el('div', 'bm-reverb-bar'); viz.appendChild(b); bars.push(b); }
    root.appendChild(viz);

    function updateViz() {
      const wet = STATE.reverb.dry ? 0 : STATE.reverb.wetMix;
      const decay = STATE.reverb.decay;
      bars.forEach((b, i) => {
        const decay_factor = Math.exp(-i / (bars.length * decay * 0.3));
        const scale = wet * decay_factor;
        b.style.transform = `scaleY(${0.05 + scale * 0.95})`;
        b.style.opacity   = 0.3 + scale * 0.7;
      });
    }
    updateViz();

    const wetSlider = buildSlider({ label:'Wet Mix', icon:'🌊', min:0, max:1, step:0.01, value:STATE.reverb.wetMix, format: v => (v*100).toFixed(0)+'%', onChange: v => { STATE.reverb.wetMix = v; if (activeChain) activeChain.rebuildReverb(); updateViz(); } });
    const decaySlider = buildSlider({ label:'Decay', icon:'⏱️', min:0.1, max:6, step:0.1, value:STATE.reverb.decay, format: v => v.toFixed(1)+'s', onChange: v => { STATE.reverb.decay = v; if (activeChain) activeChain.rebuildReverbImpulse(); updateViz(); } });
    const sizeSlider  = buildSlider({ label:'Room Size', icon:'🏠', min:0.1, max:4, step:0.1, value:STATE.reverb.roomSize, format: v => v.toFixed(1), onChange: v => { STATE.reverb.roomSize = v; if (activeChain) activeChain.rebuildReverbImpulse(); updateViz(); } });
    const dryToggle   = buildToggleRow({ icon:'🔇', label:'Dry Mode', sub:'Bypass reverb', checked: STATE.reverb.dry, onChange: v => { STATE.reverb.dry = v; if (activeChain) activeChain.rebuildReverb(); updateViz(); } });

    root.appendChild(wetSlider.el); root.appendChild(decaySlider.el);
    root.appendChild(sizeSlider.el); root.appendChild(dryToggle.el);
    return root;
  }

  /* ── Power Tab ── */
  function buildPowerTab() {
    const root = el('div', 'bm-section');
    const grid = el('div', 'bm-power-grid');
    const btns = [
      { id:'fakeMute',   icon:'🔇', label:'Fake Mute',   sub:'Discord thinks you\'re muted', extra:'' },
      { id:'fakeDeafen', icon:'🎧', label:'Fake Deafen', sub:'Discord thinks you\'re deafened', extra:'' },
      { id:'compEnabled',icon:'🗜️', label:'Compressor',  sub:'Dynamic range control', extra:'' },
      { id:'chaosMode',  icon:'💥', label:'CHAOS MODE',  sub:'Extreme gain stack', extra:'chaos-btn' },
    ];
    btns.forEach(b => {
      const btn = el('div', 'bm-power-btn' + (b.extra ? ' ' + b.extra : '') + (STATE[b.id] ? ' on' : ''));
      btn.appendChild(el('div', 'bm-power-icon', b.icon));
      btn.appendChild(el('div', 'bm-power-label', b.label));
      btn.appendChild(el('div', 'bm-toggle-sub', b.sub));
      btn.addEventListener('click', () => {
        STATE[b.id] = !STATE[b.id];
        btn.classList.toggle('on', STATE[b.id]);
        if (b.id === 'fakeMute')   window.BMFakeMute   = STATE.fakeMute;
        if (b.id === 'fakeDeafen') window.BMFakeDeafen = STATE.fakeDeafen;
        if (b.id === 'chaosMode' && activeChain)  activeChain.applyUltraGain();
        if (b.id === 'compEnabled') applyState();
        updateLauncher();
      });
      grid.appendChild(btn);
    });
    root.appendChild(grid);

    const compTitle = el('div', 'bm-section-title', 'Compressor');
    root.appendChild(compTitle);
    const threshSlider = buildSlider({ label:'Threshold', icon:'📉', min:-60, max:0, step:1, value:STATE.compThreshold, format: v => v+'dB', onChange: v => { STATE.compThreshold = v; applyState(); } });
    const ratioSlider  = buildSlider({ label:'Ratio',     icon:'⚖️', min:1, max:20, step:0.5, value:STATE.compRatio, format: v => v.toFixed(1)+':1', onChange: v => { STATE.compRatio = v; applyState(); } });
    root.appendChild(threshSlider.el);
    root.appendChild(ratioSlider.el);
    return root;
  }

  /* ── Presets Tab ── */
  function buildPresetsTab() {
    const root = el('div', 'bm-section');
    const list = el('div', 'bm-preset-list');
    PRESETS.forEach(p => {
      const row = el('div', 'bm-preset');
      const mid = el('div'); mid.style.flex = '1';
      const nm  = el('div', 'bm-preset-name', p.name);
      const sub = el('div', 'bm-preset-sub');
      sub.textContent = `Gain: ${fmtDb(20 * Math.log10(Math.max(0.001, p.master)))}  Pitch: ${p.pitch >= 0 ? '+' : ''}${p.pitch}st  FX: ${p.effect || 'none'}`;
      mid.appendChild(nm); mid.appendChild(sub);
      row.appendChild(el('div', null, p.icon)); row.appendChild(mid); row.appendChild(el('div', 'bm-preset-arrow', '›'));
      row.addEventListener('click', () => {
        STATE.masterGain = p.master; STATE.preAmp = p.preAmp; STATE.pitch = p.pitch;
        STATE.effect = p.effect;    STATE.reverb  = { ...p.reverb };
        STATE.godGain = p.god || 0; STATE.hyperBoost = p.hyper || 0;
        applyState();
        if (activeChain) { activeChain.rebuildEffect(); activeChain.rebuildReverb(); activeChain.rebuildReverbImpulse(); }
        row.style.background = 'rgba(37,99,235,.15)';
        setTimeout(() => { row.style.background = ''; }, 400);
        renderTab();
      });
      list.appendChild(row);
    });
    root.appendChild(list);
    return root;
  }

  /* ── Stats Tab ── */
  function buildStatsTab() {
    const root = el('div', 'bm-section');
    const grid = el('div', 'bm-stats-grid');
    const cards = [
      { id:'s-level', label:'Input Level', val:fmtDb(STATE.inputLevel) },
      { id:'s-peak',  label:'Peak dB',     val:fmtDb(STATE.peakDb) },
      { id:'s-clips', label:'Clips',       val:STATE.clipCount.toString() },
      { id:'s-sess',  label:'Session',     val:fmtTime(Date.now() - STATE.sessionStart) },
    ];
    cards.forEach(c => {
      const card = el('div', 'bm-stat-card'); card.id = c.id;
      card.appendChild(el('div', 'bm-stat-label', c.label));
      card.appendChild(el('div', 'bm-stat-val', c.val));
      grid.appendChild(card);
    });
    root.appendChild(grid);
    if (statsInterval) clearInterval(statsInterval);
    statsInterval = setInterval(() => {
      const lvCard = document.getElementById('s-level');
      const pkCard = document.getElementById('s-peak');
      const clCard = document.getElementById('s-clips');
      const ssCard = document.getElementById('s-sess');
      if (lvCard) lvCard.querySelector('.bm-stat-val').textContent = fmtDb(STATE.inputLevel);
      if (pkCard) pkCard.querySelector('.bm-stat-val').textContent = fmtDb(STATE.peakDb);
      if (clCard) clCard.querySelector('.bm-stat-val').textContent = STATE.clipCount.toString();
      if (ssCard) ssCard.querySelector('.bm-stat-val').textContent = fmtTime(Date.now() - STATE.sessionStart);
    }, 500);
    const rowEnd = el('div', 'bm-row-end');
    const resetStats = el('button', 'bm-btn bm-btn-ghost', '↺ Reset Stats');
    resetStats.addEventListener('click', () => { STATE.clipCount = 0; STATE.peakDb = -Infinity; STATE.sessionStart = Date.now(); });
    rowEnd.appendChild(resetStats);
    root.appendChild(rowEnd);
    return root;
  }

  /* ── Voice Tab ── */
  const VOICE_PRESETS = [
    { id:'natural',     name:'Natural',     icon:'😊', desc:'Your real voice',         pitch:0,  effect:null,        reverb:{wetMix:0.05,decay:1,  roomSize:1,  dry:true},  god:0,    hyper:0    },
    { id:'deepmale',    name:'Deep Male',   icon:'🧔', desc:'Low masculine rumble',    pitch:-5, effect:'deep',      reverb:{wetMix:0.15,decay:2.5,roomSize:2,  dry:false}, god:0.15, hyper:0    },
    { id:'female',      name:'Warm Female', icon:'👩', desc:'Bright warm feminine',    pitch:5,  effect:'vocalizer', reverb:{wetMix:0.1, decay:1.5,roomSize:1.2,dry:false}, god:0,    hyper:0    },
    { id:'child',       name:'Child',       icon:'👧', desc:'Playful high voice',      pitch:9,  effect:'chipmunk',  reverb:{wetMix:0.12,decay:1.2,roomSize:1,  dry:false}, god:0,    hyper:0    },
    { id:'anime',       name:'Anime Girl',  icon:'🌸', desc:'Ultra high kawaii tone',  pitch:11, effect:'vocalizer', reverb:{wetMix:0.18,decay:1.5,roomSize:1.2,dry:false}, god:0,    hyper:0    },
    { id:'monster',     name:'Monster',     icon:'👹', desc:'Terrifying low growl',    pitch:-9, effect:'growl',     reverb:{wetMix:0.4, decay:4,  roomSize:3.5,dry:false}, god:0.3,  hyper:0.1  },
    { id:'robot',       name:'Cyborg',      icon:'🤖', desc:'Digital machine voice',   pitch:0,  effect:'robot',     reverb:{wetMix:0.2, decay:2,  roomSize:1.8,dry:false}, god:0.1,  hyper:0    },
    { id:'ghost',       name:'Ghost',       icon:'👻', desc:'Ethereal whisper',        pitch:3,  effect:'whisper',   reverb:{wetMix:0.55,decay:4,  roomSize:3,  dry:false}, god:0,    hyper:0    },
    { id:'alien',       name:'Alien',       icon:'👽', desc:'Otherworldly being',      pitch:0,  effect:'alien',     reverb:{wetMix:0.35,decay:2.5,roomSize:2,  dry:false}, god:0.2,  hyper:0    },
    { id:'demon',       name:'Demon Lord',  icon:'😈', desc:'Ancient evil entity',     pitch:-7, effect:'distort',   reverb:{wetMix:0.45,decay:5,  roomSize:4,  dry:false}, god:0.35, hyper:0.12 },
    { id:'broadcaster', name:'Broadcaster', icon:'📻', desc:'Pro broadcast voice',     pitch:0,  effect:'telephone', reverb:{wetMix:0.08,decay:1.2,roomSize:1,  dry:false}, god:0.05, hyper:0    },
    { id:'megaphone',   name:'Megaphone',   icon:'📢', desc:'Loud crowd speaker',      pitch:0,  effect:'megaphone', reverb:{wetMix:0.15,decay:1.5,roomSize:1.5,dry:false}, god:0.1,  hyper:0    },
  ];
  let activeVoiceId = 'natural';

  function applyVoicePreset(vp) {
    activeVoiceId = vp.id; STATE.pitch = vp.pitch; STATE.effect = vp.effect;
    STATE.reverb = { ...vp.reverb }; STATE.godGain = vp.god; STATE.hyperBoost = vp.hyper;
    applyState();
    if (activeChain) {
      activeChain.applyPitch(vp.pitch); activeChain.rebuildEffect();
      activeChain.rebuildReverb(); activeChain.rebuildReverbImpulse(); activeChain.applyUltraGain();
    }
  }

  function buildVoiceTab() {
    const root = el('div', 'bm-section');
    const display = el('div', 'bm-voice-display');
    const curVP   = VOICE_PRESETS.find(v => v.id === activeVoiceId) || VOICE_PRESETS[0];
    const activeName = el('div', 'bm-voice-active-name', curVP.icon + '  ' + curVP.name);
    const activeSub  = el('div', 'bm-voice-active-sub',  curVP.desc);
    const barsWrap   = el('div', 'bm-voice-bars');
    const barEls     = [];
    for (let i = 0; i < 20; i++) {
      const b = el('div', 'bm-voice-bar');
      b.style.height = (4 + Math.random() * 24) + 'px'; barsWrap.appendChild(b); barEls.push(b);
    }
    display.appendChild(activeName); display.appendChild(activeSub); display.appendChild(barsWrap);
    root.appendChild(display);

    if (voiceBarTimerId) clearInterval(voiceBarTimerId);
    voiceBarTimerId = setInterval(() => {
      barEls.forEach((b, i) => {
        const t = Date.now() / 300 + i * 0.4;
        b.style.height = (4 + (Math.sin(t) * 0.5 + 0.5) * 26) + 'px';
      });
    }, 70);

    const grid = el('div', 'bm-voice-grid');
    VOICE_PRESETS.forEach(vp => {
      const card = el('div', 'bm-voice-card' + (vp.id === activeVoiceId ? ' active' : ''));
      const info = el('div');
      info.appendChild(el('div', 'bm-voice-card-name', vp.name));
      info.appendChild(el('div', 'bm-voice-card-desc', vp.desc));
      card.appendChild(el('div', 'bm-voice-card-icon', vp.icon));
      card.appendChild(info);
      card.addEventListener('click', () => {
        applyVoicePreset(vp);
        grid.querySelectorAll('.bm-voice-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        activeName.textContent = vp.icon + '  ' + vp.name;
        activeSub.textContent  = vp.desc;
      });
      grid.appendChild(card);
    });
    root.appendChild(grid);

    const rowEnd   = el('div', 'bm-row-end');
    const resetBtn = el('button', 'bm-btn bm-btn-ghost', '↺ Natural Voice');
    resetBtn.addEventListener('click', () => {
      const nat = VOICE_PRESETS[0];
      applyVoicePreset(nat);
      grid.querySelectorAll('.bm-voice-card').forEach(c => c.classList.remove('active'));
      grid.querySelector('.bm-voice-card').classList.add('active');
      activeName.textContent = nat.icon + '  ' + nat.name;
      activeSub.textContent  = nat.desc;
    });
    rowEnd.appendChild(resetBtn);
    root.appendChild(rowEnd);
    return root;
  }

  /* ── Wider Tab ── */
  function buildWiderTab() {
    const root    = el('div', 'bm-section');
    const display = el('div', 'bm-wider-display');
    const viz     = el('div', 'bm-wider-viz');
    const bars    = [];
    for (let i = 4; i >= 0; i--) { const b = el('div', 'bm-wider-bar'); b.style.height = (12 + i * 6) + 'px'; viz.appendChild(b); bars.push(b); }
    const cLine = document.createElement('div'); cLine.style.cssText = 'width:2px;height:40px;background:rgba(220,38,38,.3);border-radius:1px;'; viz.appendChild(cLine);
    for (let i = 0; i < 5; i++) { const b = el('div', 'bm-wider-bar'); b.style.height = (12 + i * 6) + 'px'; viz.appendChild(b); bars.push(b); }
    const valRow  = el('div'); valRow.style.cssText = 'display:flex;align-items:baseline;gap:4px;justify-content:center;margin-top:8px;';
    const bigVal  = el('div', 'bm-wider-big', (STATE.widerWidth * 100).toFixed(0));
    const unitLbl = el('div', 'bm-wider-unit', '% WIDTH');
    valRow.appendChild(bigVal); valRow.appendChild(unitLbl);
    display.appendChild(viz); display.appendChild(valRow);
    root.appendChild(display);

    function updateViz(w) {
      bigVal.textContent = (w * 100).toFixed(0);
      bars.forEach((b, i) => {
        const dist = Math.abs(i - 4.5) / 4.5;
        const spread = STATE.widerEnabled ? w : 0.5;
        b.style.height  = (8 + (1 - dist) * spread * 30) + 'px';
        b.style.opacity = STATE.widerEnabled ? (0.4 + spread * 0.6).toString() : '0.2';
      });
    }
    updateViz(STATE.widerWidth);

    const enableToggle = buildToggleRow({ icon:'↔️', label:'Stereo Wider', sub:'Mid/side channel expansion', checked: STATE.widerEnabled, onChange: v => { STATE.widerEnabled = v; if (activeChain) activeChain.applyWider(); updateViz(STATE.widerWidth); } });
    const widthSlider  = buildSlider({ label:'Width', icon:'🔊', min:0, max:3, step:0.01, value:STATE.widerWidth, format: v => (v*100).toFixed(0)+'%', onChange: v => { STATE.widerWidth = v; if (activeChain) activeChain.applyWider(); updateViz(v); } });
    const depthSlider  = buildSlider({ label:'Depth', icon:'🎚️', min:0, max:1, step:0.01, value:STATE.widerDepth, format: v => (v*100).toFixed(0)+'%', onChange: v => { STATE.widerDepth = v; if (activeChain) activeChain.applyWider(); updateViz(STATE.widerWidth); } });
    root.appendChild(enableToggle.el); root.appendChild(widthSlider.el); root.appendChild(depthSlider.el);

    const rowEnd   = el('div', 'bm-row-end');
    const resetBtn = el('button', 'bm-btn bm-btn-ghost', '↺ Reset');
    resetBtn.addEventListener('click', () => {
      STATE.widerEnabled = false; STATE.widerWidth = 1.0; STATE.widerDepth = 1.0;
      enableToggle.setOn(false); widthSlider.set(1.0); depthSlider.set(1.0);
      if (activeChain) activeChain.applyWider(); updateViz(1.0);
    });
    rowEnd.appendChild(resetBtn);
    root.appendChild(rowEnd);
    return root;
  }

  /* ── MP3 Tab ── */
  function buildMp3Tab() {
    const root   = el('div', 'bm-section');
    const drop   = el('div', 'bm-mp3-drop');
    const fileIn = document.createElement('input');
    fileIn.type = 'file'; fileIn.accept = 'audio/*';
    drop.innerHTML = `<div class="bm-mp3-drop-icon">🎵</div><div class="bm-mp3-drop-label">Tap to load audio file<br><span style="font-size:9px;opacity:.5;">MP3 / WAV / OGG — plays through your mic</span></div>`;
    drop.appendChild(fileIn);
    drop.addEventListener('click', () => fileIn.click());
    fileIn.addEventListener('change', () => { if (fileIn.files[0]) { mp3Load(fileIn.files[0]); mp3UpdateNameEl(); mp3UpdatePlayBtn(); } });
    root.appendChild(drop);

    const nameEl = el('div', 'bm-mp3-name'); nameEl.id = 'bm-mp3-name'; nameEl.textContent = MP3.fileName || 'No file loaded';
    root.appendChild(nameEl);

    const wave = el('div', 'bm-mp3-waveform');
    for (let i = 0; i < 28; i++) wave.appendChild(el('div', 'bm-mp3-bar'));
    root.appendChild(wave);

    const progWrap = el('div', 'bm-mp3-progress-wrap');
    const progFill = el('div', 'bm-mp3-progress-fill'); progFill.id = 'bm-mp3-prog';
    progWrap.appendChild(progFill);
    progWrap.addEventListener('click', (e) => { if (!MP3.audio || !MP3.audio.duration) return; MP3.audio.currentTime = (e.offsetX / progWrap.offsetWidth) * MP3.audio.duration; });
    root.appendChild(progWrap);

    const timeEl = el('div', 'bm-mp3-time', '0:00 / 0:00'); timeEl.id = 'bm-mp3-time';
    root.appendChild(timeEl);

    const controls = el('div', 'bm-mp3-controls');
    const stopBtn  = el('div', 'bm-mp3-btn', '⏹');
    const playBtn  = el('div', 'bm-mp3-btn play-btn'); playBtn.id = 'bm-mp3-playbtn'; playBtn.textContent = MP3.playing ? '⏸' : '▶';
    const rwdBtn   = el('div', 'bm-mp3-btn', '⏮');
    const loopBtn  = el('div', 'bm-mp3-btn active-btn', '🔁');
    const fwdBtn   = el('div', 'bm-mp3-btn', '⏭');
    let loopOn = true;
    rwdBtn.addEventListener('click',  () => { if (MP3.audio) MP3.audio.currentTime = Math.max(0, MP3.audio.currentTime - 10); });
    stopBtn.addEventListener('click', () => mp3Stop());
    playBtn.addEventListener('click', () => mp3Toggle());
    loopBtn.addEventListener('click', () => { loopOn = !loopOn; if (MP3.audio) MP3.audio.loop = loopOn; loopBtn.classList.toggle('active-btn', loopOn); });
    fwdBtn.addEventListener('click',  () => { if (MP3.audio) MP3.audio.currentTime = Math.min(MP3.audio.duration || 0, MP3.audio.currentTime + 10); });
    [rwdBtn, stopBtn, playBtn, loopBtn, fwdBtn].forEach(b => controls.appendChild(b));
    root.appendChild(controls);

    const volSection = el('div', 'bm-section-title', 'Volume & Boost');
    root.appendChild(volSection);

    const volSlider   = buildSlider({ label:'Volume',      icon:'🔊', min:0, max:8,  step:0.05, value:MP3.volume,     format: v => (v*100).toFixed(0)+'%', onChange: v => { MP3.volume = v;      if (MP3.gainNode)  MP3.gainNode.gain.value  = v; } });
    const boostSlider = buildSlider({ label:'Music Boost', icon:'📻', min:1, max:60, step:0.5,  value:MP3.musicBoost, format: v => v.toFixed(1)+'×',       onChange: v => { MP3.musicBoost = v; if (MP3.musicGain) MP3.musicGain.gain.value = v; } });
    root.appendChild(volSlider.el); root.appendChild(boostSlider.el);

    const routeRow = el('div', 'bm-row-end');
    const routeBtn = el('button', 'bm-btn bm-btn-primary', '🔗 Route to Mic');
    routeBtn.addEventListener('click', () => {
      if (MP3.analyser && activeChain) {
        try { MP3.analyser.connect(activeChain.dest); } catch(_){}
        routeBtn.textContent = '✓ Routed!';
        setTimeout(() => { routeBtn.textContent = '🔗 Route to Mic'; }, 1500);
      }
    });
    routeRow.appendChild(routeBtn); root.appendChild(routeRow);
    return root;
  }

  /* ══════════════════════════════════════════════════════════
     TAB RENDERER
     ══════════════════════════════════════════════════════════ */
  const TABS = [
    { id:'Gain',    icon:'🎚' },
    { id:'Voice',   icon:'🎤' },
    { id:'Effects', icon:'✨' },
    { id:'EQ',      icon:'📊' },
    { id:'Reverb',  icon:'🌊' },
    { id:'Wider',   icon:'↔' },
    { id:'MP3',     icon:'🎵' },
    { id:'Power',   icon:'⚡' },
    { id:'Presets', icon:'🔥' },
    { id:'Stats',   icon:'📈' },
  ];

  function renderTab() {
    if (!bodyEl) return;
    bodyEl.innerHTML = '';
    if (statsInterval)     { clearInterval(statsInterval);     statsInterval     = null; }
    if (voiceBarTimerId)   { clearInterval(voiceBarTimerId);   voiceBarTimerId   = null; }
    let content;
    switch (activeTab) {
      case 'Gain':    content = buildGainTab();     break;
      case 'Voice':   content = buildVoiceTab();    break;
      case 'Effects': content = buildEffectsTab();  break;
      case 'EQ':      content = buildEqTab();       break;
      case 'Reverb':  content = buildReverbTab();   break;
      case 'Wider':   content = buildWiderTab();    break;
      case 'MP3':     content = buildMp3Tab();      break;
      case 'Power':   content = buildPowerTab();    break;
      case 'Presets': content = buildPresetsTab();  break;
      case 'Stats':   content = buildStatsTab();    break;
      default:        content = buildGainTab();
    }
    bodyEl.appendChild(content);
  }

  function updateLauncher() {
    if (!launcherEl) return;
    const dot    = launcherEl.querySelector('.bm-pill-dot');
    const status = launcherEl.querySelector('.bm-pill-status');
    if (chainReady) {
      dot.classList.add('live');
      status.textContent = '● LIVE';
    } else {
      dot.classList.remove('live');
      status.textContent = '○ READY';
    }
  }

  /* ══════════════════════════════════════════════════════════
     BUILD FULL UI
     ══════════════════════════════════════════════════════════ */
  function buildUI() {
    rootEl = el('div'); rootEl.id = 'bm-root';

    /* Launcher */
    launcherEl = el('div'); launcherEl.id = 'bm-launcher';
    launcherEl.innerHTML = `
      <div class="bm-pill-dot"></div>
      <div>
        <div class="bm-pill-name">OGxISAI</div>
        <div class="bm-pill-status">○ READY</div>
      </div>
    `;
    launcherEl.addEventListener('click', togglePanel);

    /* Panel */
    panelEl = el('div'); panelEl.id = 'bm-panel'; panelEl.classList.add('hidden');

    /* Header gif */
    if (HEADER_GIF) {
      const gifEl = document.createElement('img');
      gifEl.className = 'bm-hdr-gif';
      gifEl.src = HEADER_GIF;
      gifEl.alt = '';
      panelEl.appendChild(gifEl);
    }

    /* Panel header */
    const hdr = el('div', 'bm-hdr');
    hdr.innerHTML = `
      <div class="bm-hdr-moon">🌑</div>
      <div class="bm-hdr-info">
        <div class="bm-hdr-title">OGxISAI</div>
        <div class="bm-hdr-sub">Ultimate Voice Manager</div>
      </div>
      <div class="bm-hdr-ver">v1.0</div>
      <div class="bm-hdr-close">✕</div>
    `;
    hdr.querySelector('.bm-hdr-close').addEventListener('click', togglePanel);

    /* Status */
    const statusBar = el('div', 'bm-status');
    statusBar.innerHTML = `
      <div class="bm-status-dot" id="bm-status-dot"></div>
      <div class="bm-status-text" id="bm-status-text">Waiting for voice…</div>
      <div class="bm-status-session" id="bm-status-session"></div>
    `;

    /* Meter */
    const meterWrap = el('div', 'bm-meter-wrap');
    meterWrap.innerHTML = `
      <div class="bm-meter-lbl">IN</div>
      <div class="bm-meter"><div class="bm-meter-fill" id="bm-level-fill"></div></div>
      <div class="bm-meter-val" id="bm-level-val">-∞</div>
    `;

    /* Tabs */
    const tabsEl = el('div', 'bm-tabs');
    TABS.forEach(({ id, icon }) => {
      const tab = el('div', 'bm-tab' + (id === activeTab ? ' active' : ''));
      tab.innerHTML = `<div class="bm-tab-icon">${icon}</div><span>${id}</span>`;
      tab.addEventListener('click', () => {
        activeTab = id;
        tabsEl.querySelectorAll('.bm-tab').forEach(x => x.classList.remove('active'));
        tab.classList.add('active');
        renderTab();
      });
      tabsEl.appendChild(tab);
    });

    bodyEl = el('div', 'bm-body');

    panelEl.appendChild(hdr);
    panelEl.appendChild(statusBar);
    panelEl.appendChild(meterWrap);
    panelEl.appendChild(tabsEl);
    panelEl.appendChild(bodyEl);

    rootEl.appendChild(launcherEl);
    rootEl.appendChild(panelEl);
    document.body.appendChild(rootEl);

    levelFill = document.getElementById('bm-level-fill');
    levelVal  = document.getElementById('bm-level-val');

    makeDraggable(panelEl, hdr);

    window.addEventListener('bm:levels', (e) => {
      const db  = e.detail.db;
      const pct = Math.max(0, Math.min(1, (db + 60) / 60)) * 100;
      if (levelFill) { levelFill.style.width = pct + '%'; levelFill.classList.toggle('clip', db > -0.5); }
      if (levelVal)  levelVal.textContent = fmtDb(db);
    });

    window.addEventListener('bm:ready', () => {
      chainReady = true; updateLauncher();
      const dot = document.getElementById('bm-status-dot');
      const txt = document.getElementById('bm-status-text');
      if (dot) dot.classList.add('live');
      if (txt) txt.textContent = 'Processing — mic hooked!';
    });

    setInterval(() => {
      const el2 = document.getElementById('bm-status-session');
      if (el2) el2.textContent = fmtTime(Date.now() - STATE.sessionStart);
    }, 1000);

    renderTab();
  }

  function togglePanel() {
    panelVisible = !panelVisible;
    panelEl.classList.toggle('hidden', !panelVisible);
    if (panelVisible && audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    if (panelVisible) getCtx();
  }

  function makeDraggable(target, handle) {
    let startX, startY, origLeft, origTop, dragging = false;
    handle.addEventListener('mousedown', (e) => {
      dragging = true; startX = e.clientX; startY = e.clientY;
      const rect = target.getBoundingClientRect();
      origLeft = rect.left; origTop = rect.top;
      target.style.right = 'auto'; target.style.left = origLeft + 'px'; target.style.top = origTop + 'px';
      document.body.classList.add('bm-dragging'); e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      target.style.left = Math.max(0, origLeft + (e.clientX - startX)) + 'px';
      target.style.top  = Math.max(0, origTop  + (e.clientY - startY)) + 'px';
    });
    document.addEventListener('mouseup', () => { if (dragging) { dragging = false; document.body.classList.remove('bm-dragging'); } });
    handle.addEventListener('touchstart', (e) => {
      dragging = true; const t = e.touches[0]; startX = t.clientX; startY = t.clientY;
      const rect = target.getBoundingClientRect();
      origLeft = rect.left; origTop = rect.top;
      target.style.right = 'auto'; target.style.left = origLeft + 'px'; target.style.top = origTop + 'px';
    }, { passive: true });
    document.addEventListener('touchmove', (e) => {
      if (!dragging) return; const t = e.touches[0];
      target.style.left = Math.max(0, origLeft + (t.clientX - startX)) + 'px';
      target.style.top  = Math.max(0, origTop  + (t.clientY - startY)) + 'px';
    }, { passive: true });
    document.addEventListener('touchend', () => { dragging = false; });
  }

  /* ══════════════════════════════════════════════════════════
     INIT
     ══════════════════════════════════════════════════════════ */
  function init() {
    injectStyles();
    showBoot(() => { buildUI(); });
  }

  if (document.body) init();
  else document.addEventListener('DOMContentLoaded', init);

  window.__OGxISAI_STATE__ = STATE;

})();
