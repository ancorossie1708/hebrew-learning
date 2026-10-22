/* Device-local settings shared by word playback and generated feedback sounds. */
(function () {
  'use strict';
  const key = 'hebrew-learning-settings-v1';
  const defaults = {soundEnabled:true, volume:1, showPictures:true, layout:'phone'};
  let settings = {...defaults};
  const listeners = new Set();
  function clean(input) {
    return {
      soundEnabled:typeof input?.soundEnabled === 'boolean' ? input.soundEnabled : true,
      volume:typeof input?.volume === 'number' && Number.isFinite(input.volume) ? Math.max(0,Math.min(1,input.volume)) : 1,
      showPictures:typeof input?.showPictures === 'boolean' ? input.showPictures : true,
      layout:input?.layout === 'ktc-24' ? 'ktc-24' : 'phone',
    };
  }
  try { settings = clean(JSON.parse(localStorage.getItem(key) || '{}')); } catch (_) {}
  function set(patch) {
    settings = clean({...settings,...patch});
    try { localStorage.setItem(key,JSON.stringify(settings)); } catch (_) {}
    listeners.forEach(listener => listener({...settings}));
  }
  globalThis.AppPreferences = {
    get:() => ({...settings}),
    effectiveVolume:() => settings.soundEnabled ? settings.volume : 0,
    set, reset:() => set(defaults),
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
})();
