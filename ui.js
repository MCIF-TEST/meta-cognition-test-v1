// ui.js — small helper utilities for the front-end (ES module)
export function fadeIn(el, duration = 300) {
  if (!el) return;
  el.style.opacity = 0;
  el.style.display = '';
  let start = null;
  function step(ts) {
    start = start || ts;
    const p = Math.min(1, (ts - start) / duration);
    el.style.opacity = p;
    if (p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

export function fadeOut(el, duration = 300, cb) {
  if (!el) { if (cb) cb(); return; }
  let start = null;
  function step(ts) {
    start = start || ts;
    const p = Math.min(1, (ts - start) / duration);
    el.style.opacity = 1 - p;
    if (p < 1) requestAnimationFrame(step);
    else { el.style.display = 'none'; if (cb) cb(); }
  }
  requestAnimationFrame(step);
}

// minimal line draw for meta-curve; points: array of numbers (0..1)
export function drawMetaCurve(canvas, points) {
  if (!canvas || !points || points.length === 0) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0,0,w,h);
  ctx.strokeStyle = '#2b6ef6';
  ctx.fillStyle = 'rgba(43,110,246,0.08)';
  ctx.lineWidth = 2;
  const pad = 20;
  const stepX = (w - pad*2) / Math.max(1, points.length - 1);
  ctx.beginPath();
  for (let i = 0; i < points.length; i++) {
    const x = pad + stepX * i;
    const y = pad + (1 - points[i]) * (h - pad*2);
    if (i === 0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  }
  // stroke and fill
  ctx.stroke();
  ctx.lineTo(w - pad, h - pad);
  ctx.lineTo(pad, h - pad);
  ctx.closePath();
  ctx.fill();
}

// very small radar chart for 6-phase scores (values 0..1)
export function drawRadar(canvas, labels, values) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0,0,w,h);
  const cx = w / 2, cy = h / 2;
  const radius = Math.min(w,h) * 0.35;
  const n = labels.length;
  // draw grid
  ctx.strokeStyle = '#ddd';
  ctx.lineWidth = 1;
  const levels = 4;
  for (let l=1; l<=levels; l++){
    ctx.beginPath();
    for (let i=0;i<n;i++){
      const a = (Math.PI*2 * i)/n - Math.PI/2;
      const r = (radius * l)/levels;
      const x = cx + Math.cos(a)*r;
      const y = cy + Math.sin(a)*r;
      if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    }
    ctx.closePath();
    ctx.stroke();
  }
  // axes and labels
  ctx.fillStyle = '#333';
  for (let i=0;i<n;i++){
    const a = (Math.PI*2 * i)/n - Math.PI/2;
    const x = cx + Math.cos(a)*radius;
    const y = cy + Math.sin(a)*radius;
    ctx.beginPath();
    ctx.moveTo(cx,cy);
    ctx.lineTo(x,y);
    ctx.stroke();
    // label
    const lx = cx + Math.cos(a)*(radius+18);
    const ly = cy + Math.sin(a)*(radius+18);
    ctx.fillText(labels[i], lx-20, ly);
  }
  // polygon
  ctx.beginPath();
  for (let i=0;i<n;i++){
    const val = Math.max(0, Math.min(1, values[i] || 0));
    const a = (Math.PI*2 * i)/n - Math.PI/2;
    const r = val * radius;
    const x = cx + Math.cos(a)*r;
    const y = cy + Math.sin(a)*r;
    if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  }
  ctx.closePath();
  ctx.fillStyle = 'rgba(43,110,246,0.15)';
  ctx.fill();
  ctx.strokeStyle = '#2b6ef6';
  ctx.stroke();
}
