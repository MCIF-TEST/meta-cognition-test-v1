// ui.js — helper utilities for the front-end (ES module)
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
  ctx.stroke();
  ctx.lineTo(w - pad, h - pad);
  ctx.lineTo(pad, h - pad);
  ctx.closePath();
  ctx.fill();
}

// small radar chart for phase scores (values 0..1)
export function drawRadar(canvas, labels, values) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0,0,w,h);
  const cx = w / 2, cy = h / 2;
  const radius = Math.min(w,h) * 0.35;
  const n = labels.length;
  // grid
  ctx.strokeStyle = '#eee';
  for (let l=4; l>=1; l--) {
    ctx.beginPath();
    for (let i=0;i<n;i++){
      const a = (Math.PI*2 * i)/n - Math.PI/2;
      const r = (radius * l)/4;
      const x = cx + Math.cos(a)*r;
      const y = cy + Math.sin(a)*r;
      if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    }
    ctx.closePath();
    ctx.stroke();
  }
  // axes & labels
  ctx.fillStyle = '#333';
  ctx.textAlign = 'center';
  ctx.font = '12px sans-serif';
  for (let i=0;i<n;i++){
    const a = (Math.PI*2 * i)/n - Math.PI/2;
    const x = cx + Math.cos(a)*(radius+12);
    const y = cy + Math.sin(a)*(radius+12);
    ctx.fillText(labels[i], x, y);
    ctx.beginPath();
    ctx.moveTo(cx,cy);
    ctx.lineTo(cx + Math.cos(a)*radius, cy + Math.sin(a)*radius);
    ctx.strokeStyle = '#eee';
    ctx.stroke();
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

// phase bar chart helper: labels:[], values:[] (0..1)
export function drawPhaseBars(canvas, labels, values) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0,0,w,h);
  const pad = 30;
  const barW = (w - pad*2) / labels.length * 0.7;
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'center';
  for (let i=0;i<labels.length;i++){
    const x = pad + i * ((w - pad*2) / labels.length) + barW/2;
    const val = Math.max(0, Math.min(1, values[i] || 0));
    const bh = val * (h - pad*2);
    ctx.fillStyle = '#2b6ef6';
    ctx.fillRect(x - barW/2, h - pad - bh, barW, bh);
    ctx.fillStyle = '#333';
    ctx.fillText(Math.round(val*100) + '%', x, h - pad - bh - 6);
    ctx.fillText(labels[i], x, h - 6);
  }
}

// mentor panel rendering
export function renderMentorPanel(container, aiReflection, suggestions = []) {
  if (!container) return;
  container.innerHTML = `
    <div class="mentor-header"><strong>Mentor Reflection (local)</strong></div>
    <div class="mentor-body">${escapeHtml(aiReflection || 'No reflection available.')}</div>
    <div class="mentor-suggestions"><strong>Practice Suggestions:</strong>
      <ul>
        ${suggestions.map(s => `<li>${escapeHtml(s)}</li>`).join('')}
      </ul>
    </div>
  `;
  container.classList.remove('hidden');
}

function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
}
