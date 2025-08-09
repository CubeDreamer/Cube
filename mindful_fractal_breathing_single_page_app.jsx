import React, { useRef, useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";

// Single-file React component (tailwind-ready). Default export below.
// Bugfixes applied:
// - Fixed TypeError from calling oscRef.current.stop() when oscRef.current was an object.
// - Made audio creation/resume more robust for modern browsers (resume suspended AudioContext).
// - Safer oscillator/gain cleanup and scheduling.

export default function MindfulFractalBreathing() {
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const audioCtxRef = useRef(null);
  const oscRef = useRef(null); // will store { osc: OscillatorNode, gain: GainNode }

  // Session / breathing state
  const [running, setRunning] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const [theme, setTheme] = useState("dark");

  // breathing cycle (seconds)
  const [inhale, setInhale] = useState(4);
  const [hold, setHold] = useState(2);
  const [exhale, setExhale] = useState(6);
  const cycleLength = inhale + hold + exhale;

  // session length in minutes
  const [sessionMinutes, setSessionMinutes] = useState(5);

  // runtime trackers
  const [elapsed, setElapsed] = useState(0); // seconds
  const [breathsCompleted, setBreathsCompleted] = useState(0);
  const [phase, setPhase] = useState("idle"); // 'inhale'|'hold'|'exhale'|'idle'
  const [phaseTimeLeft, setPhaseTimeLeft] = useState(0);
  const [bestMinutes, setBestMinutes] = useState(() => {
    try {
      return Number(localStorage.getItem("mf_best_minutes") || 0);
    } catch (e) { return 0; }
  });

  // derived
  const sessionSeconds = Math.max(1, sessionMinutes * 60);
  const progressPct = Math.min(100, (elapsed / sessionSeconds) * 100);

  // helpers: audio
  const ensureAudio = useCallback(() => {
    if (!audioCtxRef.current) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      audioCtxRef.current = new AudioContext();
    }
  }, []);

  // startTone: create a new oscillator+gain and safely stop any previous one
  const startTone = useCallback(async () => {
    if (!soundOn) return;
    ensureAudio();
    const ctx = audioCtxRef.current;
    if (!ctx) return;

    // browsers require resume after a user gesture sometimes
    if (ctx.state === "suspended") {
      try { await ctx.resume(); } catch (e) { /* ignore */ }
    }

    // If there's an existing oscillator object, try to stop and cleanup safely
    if (oscRef.current) {
      try {
        const prev = oscRef.current;
        if (prev.osc && typeof prev.osc.stop === 'function') {
          try { prev.osc.stop(); } catch (e) { /* ignore */ }
        }
        if (prev.gain && typeof prev.gain.disconnect === 'function') {
          try { prev.gain.disconnect(); } catch (e) { /* ignore */ }
        }
      } catch (e) { /* ignore */ }
      oscRef.current = null;
    }

    // create nodes
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      // start almost silent using scheduled API
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);

      osc.type = "sine";
      osc.frequency.setValueAtTime(220, ctx.currentTime);

      // connect and start
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();

      // store reference in a predictable shape
      oscRef.current = { osc, gain };

      // fade in
      try { gain.gain.linearRampToValueAtTime(0.02, ctx.currentTime + 0.6); } catch (e) { /* some browsers may throw if node disconnected */ }
    } catch (e) {
      // swallow audio creation errors (device may block audio)
      console.warn("Audio start failed:", e);
    }
  }, [ensureAudio, soundOn]);

  const stopTone = useCallback(() => {
    const ctx = audioCtxRef.current;
    const current = oscRef.current;
    if (!ctx || !current) return;
    try {
      const { osc, gain } = current;
      // cancel scheduled values and ramp down
      try { gain.gain.cancelScheduledValues(ctx.currentTime); } catch (e) {}
      try { gain.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 0.4); } catch (e) {}
      // stop after ramp completes
      setTimeout(() => {
        try { if (osc && typeof osc.stop === 'function') osc.stop(); } catch (e) {}
        try { if (gain && typeof gain.disconnect === 'function') gain.disconnect(); } catch (e) {}
        oscRef.current = null;
      }, 600);
    } catch (e) {
      oscRef.current = null;
    }
  }, []);

  const bell = useCallback(async () => {
    if (!soundOn) return;
    ensureAudio();
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    if (ctx.state === "suspended") {
      try { await ctx.resume(); } catch (e) { /* ignore */ }
    }

    try {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(880, ctx.currentTime);
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      o.connect(g);
      g.connect(ctx.destination);
      o.start();
      // quick bell envelope
      g.gain.linearRampToValueAtTime(0.06, ctx.currentTime + 0.005);
      o.frequency.exponentialRampToValueAtTime(220, ctx.currentTime + 1.6);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 2.2);
      setTimeout(()=>{ try{ o.stop(); }catch(e){} try{ g.disconnect(); }catch(e){} }, 2300);
    } catch (e) {
      console.warn("Bell failed:", e);
    }
  }, [ensureAudio, soundOn]);

  // breathing schedule
  useEffect(() => {
    let sessionStart = null;

    function tick() {
      if (!sessionStart) sessionStart = performance.now();
      const localElapsed = (performance.now() - sessionStart) / 1000; // seconds
      setElapsed(localElapsed);

      // determine position in breathing cycle
      const cyclePos = localElapsed % cycleLength; // 0..cycleLength
      let newPhase = "inhale";
      let timeLeft = 0;
      if (cyclePos < inhale) {
        newPhase = "inhale";
        timeLeft = inhale - cyclePos;
      } else if (cyclePos < inhale + hold) {
        newPhase = "hold";
        timeLeft = inhale + hold - cyclePos;
      } else {
        newPhase = "exhale";
        timeLeft = cycleLength - cyclePos;
      }
      setPhase(newPhase);
      setPhaseTimeLeft(timeLeft);

      // sound modulation: vary oscillator frequency / gain with phase progress
      if (oscRef.current && audioCtxRef.current) {
        try {
          const { osc, gain } = oscRef.current;
          const ctx = audioCtxRef.current;
          const denom = (newPhase === 'inhale' ? inhale : newPhase === 'hold' ? hold || 0.0001 : exhale);
          const phaseProgress = 1 - (timeLeft / denom);
          const base = newPhase === 'inhale' ? 220 : newPhase === 'hold' ? 240 : 200;
          const freq = base + Math.sin(phaseProgress * Math.PI * 2) * 10;
          if (osc && typeof osc.frequency?.setTargetAtTime === 'function') {
            osc.frequency.setTargetAtTime(freq, ctx.currentTime, 0.1);
          } else if (osc && typeof osc.frequency?.setValueAtTime === 'function') {
            osc.frequency.setValueAtTime(freq, ctx.currentTime);
          }

          const gainTarget = 0.02 * (0.6 + 0.4 * (1 - Math.abs(phaseProgress - 0.5)*2));
          if (gain && typeof gain.gain?.setTargetAtTime === 'function') {
            gain.gain.setTargetAtTime(gainTarget, ctx.currentTime, 0.15);
          } else if (gain && typeof gain.gain?.setValueAtTime === 'function') {
            gain.gain.setValueAtTime(gainTarget, ctx.currentTime);
          }
        } catch (e) {
          // ignore modulation errors
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    }

    if (running) {
      // start audio tone and animation loop
      startTone();
      rafRef.current = requestAnimationFrame(tick);
    }

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      stopTone();

      // update best
      try {
        if (elapsed / 60 > bestMinutes) {
          localStorage.setItem("mf_best_minutes", String(Math.floor(elapsed / 60)));
          setBestMinutes(Math.floor(elapsed / 60));
        }
      } catch (e) {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, inhale, hold, exhale, cycleLength, startTone, stopTone]);

  // detect breath completions by monitoring transitions
  const prevPhaseRef = useRef("idle");
  useEffect(() => {
    if (prevPhaseRef.current === 'exhale' && phase !== 'exhale') {
      // exhale finished -> breath complete
      setBreathsCompleted((b) => b + 1);
      bell();
    }
    prevPhaseRef.current = phase;
  }, [phase, bell]);

  // session end check
  useEffect(() => {
    if (!running) return;
    if (elapsed >= sessionSeconds) {
      setRunning(false);
      bell();
      // finalize best
      try {
        const minutesDone = Math.floor(sessionSeconds / 60);
        if (minutesDone > bestMinutes) {
          localStorage.setItem("mf_best_minutes", String(minutesDone));
          setBestMinutes(minutesDone);
        }
      } catch (e) {}
    }
  }, [elapsed, running, sessionSeconds, bestMinutes, bell]);

  // canvas drawing: evolving fractal-like pattern
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let width = canvas.clientWidth * (window.devicePixelRatio || 1);
    let height = canvas.clientHeight * (window.devicePixelRatio || 1);
    canvas.width = width;
    canvas.height = height;

    let t0 = performance.now();
    let anim = true;

    function draw(now) {
      const t = (now - t0) / 1000; // seconds
      // clear with translucent to produce trailing
      ctx.fillStyle = theme === 'dark' ? 'rgba(6,6,23,0.12)' : 'rgba(250,250,255,0.12)';
      ctx.fillRect(0, 0, width, height);

      // breathing influence: scale from 0.9..1.1 based on phase
      const pulse = (() => {
        if (phase === 'inhale') return 0.9 + (1 - (phaseTimeLeft / inhale)) * 0.2;
        if (phase === 'hold') return 1.05;
        if (phase === 'exhale') return 1.1 - (1 - (phaseTimeLeft / exhale)) * 0.2;
        return 1.0;
      })();

      const cx = width / 2;
      const cy = height / 2;

      // draw a spiralling recursive circle pattern
      const arms = 6;
      const layers = 10;
      for (let i = 0; i < layers; i++) {
        const r = (Math.min(width, height) / 2) * ((i + 1) / layers) * 0.85 * pulse;
        const hue = (t * 10 + i * 40) % 360;
        ctx.beginPath();
        for (let a = 0; a < arms; a++) {
          const angle = (a / arms) * Math.PI * 2 + t * 0.15 * (1 + i * 0.02);
          const x = cx + Math.cos(angle) * r * (1 + 0.02 * Math.sin(t * (0.5 + i * 0.1)));
          const y = cy + Math.sin(angle) * r * (1 + 0.02 * Math.cos(t * (0.4 + i * 0.07)));
          const size = Math.max(2, (layers - i) * 2 * (0.6 + 0.4 * pulse));
          ctx.moveTo(x, y);
          ctx.arc(x, y, size, 0, Math.PI * 2);
        }
        ctx.closePath();
        // stroke with soft glow
        ctx.strokeStyle = `hsla(${hue},60%,${theme==='dark'?'70%':'30%'},${0.08 + i*0.02})`;
        ctx.lineWidth = 1.2 + i * 0.15;
        ctx.stroke();
      }

      // slight radial gradient overlay
      const g = ctx.createRadialGradient(cx, cy, Math.min(width, height)*0.05, cx, cy, Math.min(width, height)*0.6);
      if (theme === 'dark') {
        g.addColorStop(0, 'rgba(20,24,48,0)');
        g.addColorStop(1, 'rgba(6,6,23,0.18)');
      } else {
        g.addColorStop(0, 'rgba(255,255,255,0)');
        g.addColorStop(1, 'rgba(255,255,255,0.14)');
      }
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, width, height);

      if (anim) requestAnimationFrame(draw);
    }

    let id = requestAnimationFrame(draw);

    // responsiveness
    function onResize() {
      width = canvas.clientWidth * (window.devicePixelRatio || 1);
      height = canvas.clientHeight * (window.devicePixelRatio || 1);
      canvas.width = width;
      canvas.height = height;
    }
    window.addEventListener('resize', onResize);

    return () => {
      anim = false;
      cancelAnimationFrame(id);
      window.removeEventListener('resize', onResize);
    };
  }, [phase, phaseTimeLeft, inhale, exhale, theme]);

  // start / pause handlers
  const handleStart = () => {
    setRunning(true);
    setElapsed(0);
    setBreathsCompleted(0);
    setPhase('inhale');
    // startTone will resume audio context if needed
    startTone();
  };
  const handlePause = () => { setRunning(false); stopTone(); };
  const handleStop = () => {
    setRunning(false);
    setElapsed(0);
    setBreathsCompleted(0);
    setPhase('idle');
    stopTone();
  };

  // small UI components inline
  return (
    <div className={`min-h-screen p-6 ${theme==='dark'?'bg-gradient-to-br from-slate-900 to-slate-800 text-white':'bg-gradient-to-br from-indigo-50 to-pink-50 text-slate-900'}`}>
      <div className="max-w-6xl mx-auto grid lg:grid-cols-2 gap-6">
        <div className="rounded-2xl shadow-2xl overflow-hidden bg-black/10 backdrop-blur p-4">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-2xl font-semibold">Mindful Fractal Breathing</h1>
            <div className="flex items-center gap-2">
              <button className="px-3 py-1 rounded-lg bg-white/10 hover:bg-white/20" onClick={() => setTheme(t => t==='dark'?'light':'dark')}>{theme==='dark'?'Light':'Dark'}</button>
              <button className="px-3 py-1 rounded-lg bg-white/10 hover:bg-white/20" onClick={() => setSoundOn(s => !s)}>{soundOn? 'Sound: On':'Sound: Off'}</button>
            </div>
          </div>

          <div className="h-[56vh] rounded-xl overflow-hidden border border-white/6">
            <canvas ref={canvasRef} className="w-full h-full block" aria-label="evolving fractal visualization"></canvas>
          </div>

          <div className="mt-4 flex gap-3 items-center">
            {!running ? (
              <button onClick={handleStart} className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600">Start</button>
            ) : (
              <button onClick={handlePause} className="px-5 py-2 rounded-xl bg-yellow-500 hover:bg-yellow-600">Pause</button>
            )}
            <button onClick={handleStop} className="px-4 py-2 rounded-xl bg-red-500 hover:bg-red-600">Stop</button>

            <div className="ml-auto text-sm opacity-80">Session: {sessionMinutes} min • Elapsed: {Math.floor(elapsed)}s</div>
          </div>

        </div>

        <aside className="space-y-4">
          <motion.div initial={{opacity:0, y:6}} animate={{opacity:1, y:0}} className="rounded-2xl p-4 bg-white/5 backdrop-blur shadow">
            <h2 className="text-lg font-medium">Breathing Cycle</h2>
            <div className="grid grid-cols-3 gap-2 mt-3">
              <label className="text-xs">Inhale (s)
                <input type="range" min={2} max={8} value={inhale} onChange={(e)=>setInhale(Number(e.target.value))} className="w-full mt-1" />
                <div className="text-sm mt-1">{inhale}s</div>
              </label>
              <label className="text-xs">Hold (s)
                <input type="range" min={0} max={6} value={hold} onChange={(e)=>setHold(Number(e.target.value))} className="w-full mt-1" />
                <div className="text-sm mt-1">{hold}s</div>
              </label>
              <label className="text-xs">Exhale (s)
                <input type="range" min={3} max={10} value={exhale} onChange={(e)=>setExhale(Number(e.target.value))} className="w-full mt-1" />
                <div className="text-sm mt-1">{exhale}s</div>
              </label>
            </div>

            <div className="mt-3 text-sm opacity-80">Phase: <span className="font-semibold">{phase}</span> • Time left: {phaseTimeLeft.toFixed(1)}s</div>
          </motion.div>

          <motion.div initial={{opacity:0, y:6}} animate={{opacity:1, y:0}} transition={{delay:0.06}} className="rounded-2xl p-4 bg-white/5 backdrop-blur shadow">
            <h2 className="text-lg font-medium">Session</h2>
            <div className="mt-3">
              <label className="text-xs">Length (minutes)
                <input type="range" min={1} max={30} value={sessionMinutes} onChange={(e)=>setSessionMinutes(Number(e.target.value))} className="w-full mt-1" />
                <div className="text-sm mt-1">{sessionMinutes} minutes</div>
              </label>
            </div>

            <div className="mt-4">
              <div className="text-sm">Progress</div>
              <div className="w-full h-3 bg-white/8 rounded-full mt-2 overflow-hidden">
                <div className="h-full bg-gradient-to-r from-emerald-400 to-cyan-400" style={{width:`${progressPct}%`}}></div>
              </div>
              <div className="flex justify-between text-xs mt-2 opacity-80"><span>{Math.floor(progressPct)}%</span><span>{breathsCompleted} breaths</span></div>
            </div>

            <div className="mt-4 text-sm opacity-80">
              Best session (mins): <span className="font-semibold">{bestMinutes}</span>
            </div>
          </motion.div>

          <motion.div initial={{opacity:0, y:6}} animate={{opacity:1, y:0}} transition={{delay:0.12}} className="rounded-2xl p-4 bg-white/5 backdrop-blur shadow">
            <h2 className="text-lg font-medium">Quick Controls</h2>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button onClick={()=>{ setInhale(4); setHold(2); setExhale(6); }} className="px-3 py-2 rounded-lg bg-white/6">Relax (4-2-6)</button>
              <button onClick={()=>{ setInhale(5); setHold(3); setExhale(5); }} className="px-3 py-2 rounded-lg bg-white/6">Balanced (5-3-5)</button>
              <button onClick={()=>{ setInhale(3); setHold(0); setExhale(7); }} className="px-3 py-2 rounded-lg bg-white/6">Calm (3-0-7)</button>
              <button onClick={()=>{ setSessionMinutes(10); }} className="px-3 py-2 rounded-lg bg-white/6">10 min</button>
            </div>

            <div className="mt-3 text-sm opacity-80">Tip: inhale gently — let the fractal expand on the inhale and soften on exhale.</div>
          </motion.div>

          <motion.div initial={{opacity:0, y:6}} animate={{opacity:1, y:0}} transition={{delay:0.18}} className="rounded-2xl p-4 bg-white/5 backdrop-blur shadow">
            <h2 className="text-lg font-medium">Session Stats</h2>
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <div className="p-2 rounded bg-white/3">Elapsed<br/><strong>{Math.floor(elapsed)}s</strong></div>
              <div className="p-2 rounded bg-white/3">Breaths<br/><strong>{breathsCompleted}</strong></div>
              <div className="p-2 rounded bg-white/3">Progress<br/><strong>{Math.floor(progressPct)}%</strong></div>
              <div className="p-2 rounded bg-white/3">Best (mins)<br/><strong>{bestMinutes}</strong></div>
            </div>
          </motion.div>

        </aside>
      </div>

      <footer className="max-w-6xl mx-auto text-xs mt-6 text-center opacity-70">
        Built for calm • Uses WebAudio & Canvas • Works best in modern browsers. Close to stop audio.
      </footer>
    </div>
  );
}
