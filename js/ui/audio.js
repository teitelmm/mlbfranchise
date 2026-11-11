// Ballpark sound made in code: a crowd that breathes and reacts, the crack of the bat,
// the pop of the mitt and a stadium organ. Nothing is downloaded.
import { muted } from './core.js';

let ctx = null, master = null, bed = null, noiseBuf = null;
const BED = 0.045;

function noise() {
  if (noiseBuf) return noiseBuf;
  const n = ctx.sampleRate * 3, b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
  let last = 0;
  for (let i = 0; i < n; i++) { const w = Math.random() * 2 - 1; last = (last + 0.03 * w) / 1.03; d[i] = last * 3 + w * 0.22; }
  return (noiseBuf = b);
}
const live = () => !!(ctx && master && bed);

export function parkOn() {
  try { ctx ??= new AudioContext(); if (ctx.state === 'suspended') ctx.resume(); } catch { return; }
  parkOff();
  master = ctx.createGain(); master.gain.value = muted() ? 0 : 0.9; master.connect(ctx.destination);
  const src = ctx.createBufferSource(); src.buffer = noise(); src.loop = true;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 750; bp.Q.value = 0.45;
  const g = ctx.createGain(); g.gain.value = BED;
  // a slow swell so the crowd sounds alive between pitches
  const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 0.11; lg.gain.value = 0.012; lfo.connect(lg).connect(g.gain); lfo.start();
  src.connect(bp).connect(g).connect(master); src.start();
  bed = { src, g, bp, lfo };
}
export function parkOff() {
  try { bed?.src.stop(); bed?.lfo.stop(); master?.disconnect(); } catch { }
  bed = null; master = null;
}
export function parkMute(m) { if (master) master.gain.setTargetAtTime(m ? 0 : 0.9, ctx.currentTime, 0.05); }

// the crowd gets loud, then settles back
export function cheer(level = 1) {
  if (!live() || level <= 0) return;
  const t = ctx.currentTime, gp = bed.g.gain, fp = bed.bp.frequency;
  gp.cancelScheduledValues(t); gp.setValueAtTime(gp.value, t);
  gp.linearRampToValueAtTime(BED + 0.2 * Math.min(level, 2), t + 0.22);
  gp.setTargetAtTime(BED, t + 0.6 + level * 1.3, 0.7);
  fp.cancelScheduledValues(t); fp.setValueAtTime(fp.value, t); fp.linearRampToValueAtTime(1150, t + 0.2); fp.setTargetAtTime(750, t + 1 + level, 0.6);
}
// a falling "ohhh"
export function groan(level = 1) {
  if (!live() || level <= 0) return;
  const t = ctx.currentTime, src = ctx.createBufferSource(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
  src.buffer = noise(); lp.type = 'bandpass'; lp.Q.value = 1.2;
  lp.frequency.setValueAtTime(620, t); lp.frequency.exponentialRampToValueAtTime(260, t + 1.3);
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.13 * Math.min(level, 1.5), t + 0.18); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
  src.connect(lp).connect(g).connect(master); src.start(t, Math.random()); src.stop(t + 1.6);
}
function burst(t, dur, type, freq, vol, q = 0.8) {
  const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  src.buffer = noise(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(master); src.start(t, Math.random() * 2); src.stop(t + dur + 0.02);
}
function tone(t, f0, f1, dur, vol, type = 'sine') {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master); o.start(t); o.stop(t + dur + 0.02);
}
// wood on leather: a bright snap with a short ring; `power` 0.3 (foul tip) to 1.4 (home run)
export function crack(power = 1) {
  if (!live()) return;
  const t = ctx.currentTime;
  burst(t, 0.05 + power * 0.03, 'highpass', 1500, 0.55 * Math.min(power, 1.4));
  tone(t, 2400, 900, 0.045, 0.22 * Math.min(power, 1.3), 'triangle');
  tone(t, 420, 160, 0.09, 0.25 * Math.min(power, 1.3));
}
// ball into a mitt
export function pop(vol = 1) {
  if (!live()) return;
  const t = ctx.currentTime;
  burst(t, 0.035, 'lowpass', 1100, 0.45 * vol);
  tone(t, 190, 70, 0.08, 0.35 * vol);
}
// the stadium organ: "charge" for the home crowd, a short ditty between innings
const NOTE = n => 440 * Math.pow(2, (n - 69) / 12);
export function organ(kind = 'charge') {
  if (!live()) return;
  const seqs = {
    charge: [[67, 0, .14], [72, .15, .14], [76, .3, .14], [79, .45, .3], [76, .8, .14], [79, .95, .6]],
    stretch: [[72, 0, .3], [84, .32, .3], [81, .64, .3], [79, .96, .3], [76, 1.28, .3], [79, 1.6, .5], [74, 2.15, .6]],
    walkup: [[60, 0, .12], [64, .13, .12], [67, .26, .12], [72, .39, .35]],
  };
  const t0 = ctx.currentTime + 0.05;
  for (const [n, at, dur] of seqs[kind] || seqs.charge) {
    const f = NOTE(n), t = t0 + at;
    for (const [mult, v] of [[1, 0.05], [2, 0.03], [3, 0.012], [0.5, 0.02]]) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f * mult;
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + 0.02); g.gain.setValueAtTime(v, t + dur - 0.03); g.gain.linearRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(master); o.start(t); o.stop(t + dur + 0.02);
    }
  }
}
