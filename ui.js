/* ui.js — small helper utilities for animations and DOM tasks */

export function fadeIn(element, duration = 300) {
  if (!element) return;
  element.style.opacity = 0;
  element.style.display = 'block';
  let start = null;
  const step = (timestamp) => {
    start = start || timestamp;
    const progress = Math.min(1, (timestamp - start) / duration);
    element.style.opacity = progress;
    if (progress < 1) {
      requestAnimationFrame(step);
    } else {
      element.style.opacity = 1;
    }
  };
  requestAnimationFrame(step);
}

export function fadeOut(element, duration = 300, cb) {
  if (!element) return;
  element.style.opacity = 1;
  let start = null;
  const step = (timestamp) => {
    start = start || timestamp;
    const progress = Math.min(1, (timestamp - start) / duration);
    element.style.opacity = 1 - progress;
    if (progress < 1) {
      requestAnimationFrame(step);
    } else {
      element.style.opacity = 0;
      element.style.display = 'none';
      if (typeof cb === 'function') cb();
    }
  };
  requestAnimationFrame(step);
}
