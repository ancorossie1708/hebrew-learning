/* Gentle answer feedback. All notes and animation are produced on the device. */
(function () {
  'use strict';
  let context = null;
  let generation = 0;
  let celebration = null;
  let cleanupTimer = null;
  let shakenBox = null;
  const voices = new Set();

  function clear() {
    generation++;
    clearTimeout(cleanupTimer);
    celebration?.remove(); celebration = null;
    shakenBox?.classList.remove('quiz-shake'); shakenBox = null;
    for (const voice of voices) {
      try {
        const now = context.currentTime;
        voice.gain.gain.cancelScheduledValues(now);
        voice.gain.gain.setTargetAtTime(0, now, 0.012);
        voice.oscillator.stop(now + 0.04);
      } catch (_) {}
    }
    voices.clear();
  }

  async function chime(correct, token, tier, milestoneCount) {
    try {
      const volume = globalThis.AppPreferences?.effectiveVolume() ?? 1;
      if (volume <= 0) return;
      const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AudioContextClass) return;
      if (!context || context.state === 'closed') context = new AudioContextClass();
      if (context.state === 'suspended') await context.resume();
      if (token !== generation) return;
      const firstTen = !!tier && milestoneCount === 10;
      // Soft ascending bells for success; two mellow descending notes for retry.
      const notes = firstTen ? [523.25,659.25,783.99,1046.5,783.99,1046.5,1318.51] : tier === 'grand' ? [523.25,659.25,783.99,1046.5,783.99,1046.5,1174.66,1318.51] : tier === 'special' ? [523.25,659.25,783.99,987.77,1046.5,1318.51] : correct ? [523.25, 659.25, 783.99, 1046.5] : [329.63, 261.63];
      const spacing = firstTen ? 0.13 : tier ? 0.12 : correct ? 0.085 : 0.13;
      const duration = correct ? 0.24 : 0.21;
      const now = context.currentTime;
      notes.forEach((frequency, index) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const at = now + index * spacing;
        const noteDuration = firstTen && index === notes.length - 1 ? 0.44 : duration;
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(frequency, at);
        gain.gain.setValueAtTime(0.0001 * volume, now);
        gain.gain.setValueAtTime(0.0001 * volume, at);
        gain.gain.exponentialRampToValueAtTime((correct ? 0.055 : 0.045) * volume, at + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001 * volume, at + noteDuration);
        oscillator.connect(gain); gain.connect(context.destination);
        const voice = {oscillator, gain}; voices.add(voice);
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); voices.delete(voice); };
        oscillator.start(at); oscillator.stop(at + noteDuration + 0.015);
      });
    } catch (_) {
      // Visual and text feedback remain available if audio is unavailable.
    }
  }

  function fireworks(box, tier) {
    const rect = box.getBoundingClientRect();
    const layer = document.createElement('div');
    layer.className = 'quiz-celebration'; layer.setAttribute('aria-hidden', 'true');
    const colors = ['#138b87', '#d9a72f', '#d58579', '#8b80bd'];
    const bursts = tier === 'grand' ? 15 : tier === 'special' ? 9 : tier ? 5 : 3;
    for (let burst = 0; burst < bursts; burst++) {
      const x = rect.left + rect.width * (0.15 + (burst % 5) * 0.175);
      const y = Math.max(24, rect.top + rect.height * (tier ? 0.1 + (burst % 3) * 0.3 : 0.25));
      for (let ray = 0; ray < 8; ray++) {
        const spark = document.createElement('span'); spark.className = 'quiz-spark';
        const angle = ray * Math.PI / 4;
        const distance = (tier === 'grand' ? 80 : tier ? 55 : 33) + (ray % 3) * 10;
        spark.style.left = `${x}px`; spark.style.top = `${y}px`;
        spark.style.setProperty('--dx', `${Math.cos(angle) * distance}px`);
        spark.style.setProperty('--dy', `${Math.sin(angle) * distance - 10}px`);
        spark.style.setProperty('--delay', `${burst * 110}ms`);
        spark.style.setProperty('--spark-color', colors[(ray + burst) % colors.length]);
        layer.appendChild(spark);
      }
    }
    celebration = layer; (tier ? box : document.body).appendChild(layer);
    cleanupTimer = setTimeout(() => { layer.remove(); if (celebration === layer) celebration = null; }, tier ? 2500 : 1000);
  }

  function show(correct, box) {
    clear();
    void chime(correct, generation);
    if (!box || globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    if (correct) fireworks(box);
    else {
      shakenBox = box; box.classList.add('quiz-shake');
      box.addEventListener('animationend', () => { box.classList.remove('quiz-shake'); if (shakenBox === box) shakenBox = null; }, {once:true});
    }
  }

  globalThis.addEventListener('pagehide', () => {
    clear();
    if (context && context.state !== 'closed') void context.close().catch(() => {});
    context = null;
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) clear(); });
  function celebrate(tier, box, milestoneCount) {
    clear();
    void chime(true, generation, tier, milestoneCount);
    if (box && !globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) fireworks(box, tier);
  }
  globalThis.QuizFeedback = {show, clear, celebrate};
})();
