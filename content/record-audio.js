/* Local recording for the vocabulary review sheet. No audio is uploaded. */
(function () {
  'use strict';
  const recordings = new Map();
  let active = null;
  let microphone = null;
  let directory = null;
  const folderMessage = value => { const el=document.getElementById('recording-folder-status');if(el)el.textContent=value; };

  function updateSaveLabels() {
    for(const panel of panels()) control(panel,'download').textContent=directory?'שמור בתיקייה':'הורד הקלטה';
  }
  async function chooseDirectory() {
    try {
      directory=await globalThis.showDirectoryPicker({id:'hebrew-learning-recordings',mode:'readwrite',...(directory?{startIn:directory}:{})});
      folderMessage(`תיקיית ההקלטות: ${directory.name}. מעכשיו הקלטות חדשות יישמרו בה אוטומטית.`);
      updateSaveLabels();
      try{await globalThis.RecordingStore.setDirectory(directory);}catch(_){folderMessage(`תיקיית ההקלטות: ${directory.name}. הבחירה תקפה לעמוד הנוכחי; הדפדפן לא הצליח לשמור אותה לפעם הבאה.`);}
    } catch(error) {
      if(error.name!=='AbortError')folderMessage('בחירת תיקייה לא זמינה בדפדפן הזה. אפשר לפתוח את הדף ב־Chrome או Edge מעודכנים, או להשתמש בהורדה רגילה.');
    }
  }
  async function saveToDirectory(panel,recording,requestPermission) {
    if(!directory)throw new Error('לא נבחרה תיקייה');
    const permission={mode:'readwrite'};
    let state=await directory.queryPermission(permission);
    if(state!=='granted' && requestPermission)state=await directory.requestPermission(permission);
    if(state!=='granted')throw new Error('נדרש אישור גישה לתיקייה. לחץ ״בחר תיקיית הקלטות״ ואשר גישה.');
    const id=panel.dataset.recordId;
    if(!/^[a-z][a-z0-9_]{0,80}$/.test(id))throw new Error('שם קובץ ההקלטה אינו תקין');
    let writer;
    try{
      const file=await directory.getFileHandle(id+'.wav',{create:true});
      writer=await file.createWritable();await writer.write(recording.blob);await writer.close();
    }catch(error){try{await writer?.abort();}catch(_){}throw error;}
    recording.downloaded=true;
    message(panel,`נשמר ישירות בתיקייה ״${directory.name}״: ${id}.wav`);
  }
  const panels = () => [...document.querySelectorAll('[data-record-id]')];
  const control = (panel, action) => panel.querySelector(`[data-record="${action}"]`);
  const message = (panel, value) => { panel.querySelector('.record-status').textContent = value; };

  function encodeMonoWav(buffer) {
    const frames = buffer.length;
    const channelCount = buffer.numberOfChannels;
    const channels = Array.from({length: channelCount}, (_, i) => buffer.getChannelData(i));
    const bytes = new ArrayBuffer(44 + frames * 2);
    const view = new DataView(bytes);
    const text = (offset, value) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
    text(0, 'RIFF'); view.setUint32(4, 36 + frames * 2, true); text(8, 'WAVE');
    text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
    view.setUint16(22, 1, true); view.setUint32(24, buffer.sampleRate, true);
    view.setUint32(28, buffer.sampleRate * 2, true); view.setUint16(32, 2, true);
    view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, frames * 2, true);
    let peak = 0;
    for (let frame = 0; frame < frames; frame++) {
      let sample = 0;
      for (const channel of channels) sample += channel[frame] / channelCount;
      sample = Math.max(-1, Math.min(1, sample));
      peak = Math.max(peak, Math.abs(sample));
      view.setInt16(44 + frame * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
    }
    return {blob: new Blob([bytes], {type: 'audio/wav'}), peak};
  }

  function refreshControls() {
    for (const panel of panels()) {
      control(panel, 'start').disabled = !!active;
      panel.querySelector('[data-record-file]').disabled = !!active;
      control(panel, 'stop').disabled = !(active?.panel === panel && active.recorder?.state === 'recording');
    }
    const end = document.getElementById('end-recording-session');
    if (end) end.disabled = !microphone && !active;
    const status = document.getElementById('microphone-session-status');
    if (status) status.textContent = microphone
      ? active?.recorder?.state === 'recording' ? 'מקליט כעת.' : 'רצף הקלטות פעיל. המיקרופון מושתק בין ההקלטות; אין צורך באישור נוסף לכל מילה.'
      : 'בלחיצה על הקלטה יידרש אישור אחד לרצף. בסיום או במעבר לרקע המיקרופון ישוחרר.';
  }

  async function prepare(panel, blob) {
    const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioContextClass) throw new Error('הדפדפן אינו תומך בהכנת הקלטה. נסה לפתוח את הדף ב־Chrome או ב־Edge.');
    const context = new AudioContextClass();
    let encoded;
    try {
      const audio = await context.decodeAudioData(await blob.arrayBuffer());
      const duration = audio.length / audio.sampleRate;
      if (duration < 0.3) throw new Error('ההקלטה קצרה מדי. הקלט שוב ואמור את המילה בשלמותה.');
      if (duration > 5) throw new Error('ההקלטה ארוכה מדי. הקלט את המילה פעם אחת, עד 5 שניות.');
      encoded = encodeMonoWav(audio);
      if (encoded.peak < 0.002) throw new Error('לא נשמע קול ברור. בדוק את המיקרופון והקלט שוב.');
    } finally {
      await context.close();
    }
    const previous = recordings.get(panel.dataset.recordId);
    const url = URL.createObjectURL(encoded.blob);
    const recording = {blob: encoded.blob, url, persisted:false, downloaded:false};
    recordings.set(panel.dataset.recordId, recording);
    const preview = panel.querySelector('.record-preview');
    preview.pause(); preview.src = url; preview.hidden = false;
    if (previous) URL.revokeObjectURL(previous.url);
    control(panel, 'download').disabled = false;
    try {
      await globalThis.RecordingStore.put(panel.dataset.recordId,encoded.blob,panel.dataset.sourceSha || 'missing');
      recording.persisted = true;
      message(panel, 'ההקלטה נשמרה גם בדפדפן ותשוחזר לאחר רענון. האזן לה ולחץ ״שמור הקלטה״ כדי להעביר את קובץ הקול למאגר.');
    } catch (_) {
      message(panel, 'ההקלטה מוכנה, אך השמירה האוטומטית בדפדפן אינה זמינה. לחץ ״שמור הקלטה״ לפני רענון או סגירה.');
    }
    if(directory){try{await saveToDirectory(panel,recording,false);}catch(error){message(panel,'ההקלטה מוכנה, אך השמירה בתיקייה לא הושלמה. '+error.message);}}
  }

  function release(session) {
    clearTimeout(session.timer);
    session.stream?.getTracks().forEach(track => { track.enabled = false; });
  }

  function endSession() {
    if (active?.recorder?.state === 'recording') stop();
    else if (active && !active.recorder && !active.file) active.cancelled = true;
    microphone?.getTracks().forEach(track => track.stop());
    microphone = null;
    refreshControls();
  }

  function stop() {
    const session = active;
    if (!session?.recorder || session.recorder.state !== 'recording') return;
    session.recorder.stop();
    release(session);
    control(session.panel, 'stop').disabled = true;
    message(session.panel, 'מכין את ההקלטה להאזנה…');
  }

  function errorText(error) {
    if (['NotAllowedError', 'SecurityError'].includes(error.name)) return 'לא ניתנה גישה למיקרופון. אפשר לאפשר אותה בהגדרות הדפדפן, או לבחור הקלטה מוכנה למטה.';
    if (error.name === 'NotFoundError') return 'לא נמצא מיקרופון. חבר מיקרופון או בחר הקלטה מוכנה למטה.';
    if (error.name === 'NotReadableError') return 'המיקרופון אינו זמין כרגע. סגור יישום אחר שמשתמש בו ונסה שוב.';
    return error.message || 'ההקלטה לא הצליחה. נסה שוב או בחר קובץ קול למטה.';
  }

  async function start(panel) {
    if (active) return;
    if (!navigator.mediaDevices?.getUserMedia || !globalThis.MediaRecorder) {
      message(panel, 'הדפדפן הזה אינו מאפשר הקלטה. פתח את הדף ב־Chrome או ב־Edge, או בחר הקלטה מוכנה למטה.');
      return;
    }
    const session = {panel, stream: null, recorder: null, cancelled: false};
    active = session; refreshControls();
    document.querySelectorAll('audio').forEach(audio => audio.pause());
    message(panel, 'ממתין להרשאת מיקרופון…');
    try {
      session.stream = microphone?.getTracks().some(track => track.readyState !== 'ended')
        ? microphone : await navigator.mediaDevices.getUserMedia({audio: true, video: false});
      if (session.cancelled || document.hidden) { session.stream.getTracks().forEach(track => track.stop()); return; }
      microphone = session.stream;
      microphone.getTracks().forEach(track => { track.enabled = true; });
      const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
      const mimeType = types.find(type => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(session.stream, mimeType ? {mimeType} : {});
      session.recorder = recorder;
      const chunks = [];
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onstop = async () => {
        release(session);
        try {
          if (session.failed || session.cancelled) return;
          await prepare(panel, new Blob(chunks, {type: recorder.mimeType}));
        } catch (error) { message(panel, errorText(error)); }
        finally { if (active === session) active = null; refreshControls(); }
      };
      recorder.onerror = event => {
        session.failed = true; release(session); endSession();
        message(panel, errorText(event.error || new Error('ההקלטה לא הצליחה. נסה שוב.')));
        if (active === session) active = null;
        refreshControls();
      };
      recorder.start();
      session.timer = setTimeout(stop, 4000);
      message(panel, 'מקליט כעת — אמור את המילה פעם אחת ולחץ ״עצירה״. ההקלטה נעצרת גם אוטומטית.');
      refreshControls();
    } catch (error) {
      release(session); endSession(); message(panel, errorText(error));
      if (active === session) active = null;
      refreshControls();
    } finally {
      if (session.cancelled && active === session) { active = null; refreshControls(); }
    }
  }

  function init() {
    for (const panel of panels()) {
      control(panel, 'start').addEventListener('click', () => start(panel));
      control(panel, 'stop').addEventListener('click', stop);
      control(panel, 'download').addEventListener('click', async () => {
        const recording = recordings.get(panel.dataset.recordId);
        if (!recording) return;
        if(directory){try{await saveToDirectory(panel,recording,true);}catch(error){message(panel,'הקובץ לא נשמר בתיקייה. '+error.message);}return;}
        const link = document.createElement('a'); link.href = recording.url;
        link.download = panel.dataset.recordId + '.wav';
        document.body.appendChild(link); link.click(); link.remove();
        recording.downloaded = true;
        message(panel, 'הורדת הקובץ התחילה. שמור אותו בתיקיית הקלטות המקור או צרף אותו לשיחה לשילוב במאגר.');
      });
      panel.querySelector('[data-record-file]').addEventListener('change', async event => {
        const file = event.target.files?.[0];
        if (!file || active) return;
        const session = {panel,file:true}; active = session; refreshControls();
        message(panel, 'מכין את קובץ הקול להאזנה…');
        try { await prepare(panel, file); }
        catch (error) { message(panel, errorText(error)); }
        finally { if (active === session) active = null; refreshControls(); }
      });
    }
    document.getElementById('end-recording-session')?.addEventListener('click',endSession);
    const choose=document.getElementById('choose-recording-folder');
    if(choose){
      choose.disabled=typeof globalThis.showDirectoryPicker!=='function';
      choose.addEventListener('click',chooseDirectory);
      if(choose.disabled)folderMessage('בחירת תיקייה ישירה אינה זמינה בדפדפן הזה. ב־Chrome או Edge מעודכנים אפשר לבחור תיקייה פעם אחת ולשמור אליה ישירות.');
    }
    document.addEventListener('visibilitychange', () => { if (document.hidden) endSession(); });
    globalThis.addEventListener('pagehide', event => {
      if (active) { active.cancelled = true; release(active); }
      endSession();
      if (!event.persisted) for (const recording of recordings.values()) URL.revokeObjectURL(recording.url);
    });
    globalThis.addEventListener('beforeunload', event => {
      if (active || [...recordings.values()].some(recording => !recording.persisted && !recording.downloaded)) {
        event.preventDefault(); event.returnValue = '';
      }
    });
    refreshControls();
    void restore();
  }
  async function restore() {
    try {
      if(!directory && globalThis.RecordingStore?.getDirectory){
        directory=await globalThis.RecordingStore.getDirectory();
        if(directory){
          const granted=await directory.queryPermission({mode:'readwrite'});
          folderMessage(`תיקיית ההקלטות: ${directory.name}. ${granted==='granted'?'הקלטות חדשות יישמרו בה אוטומטית.':'לפני שמירה יש לאשר שוב גישה לתיקייה.'}`);
          updateSaveLabels();
        }
      }
    } catch (_) { directory=null; }
    try {
      for (const saved of await globalThis.RecordingStore.all()) {
        const panel = panels().find(item => item.dataset.recordId === saved.id);
        if (!panel || recordings.has(saved.id) || saved.baseline !== (panel.dataset.sourceSha || 'missing')) continue;
        const url = URL.createObjectURL(saved.blob);
        recordings.set(saved.id,{blob:saved.blob,url,persisted:true,downloaded:false});
        const preview = panel.querySelector('.record-preview');
        preview.src = url; preview.hidden = false;
        control(panel,'download').disabled = false;
        message(panel,'שוחזרה הקלטה ששמרת בדפדפן. אפשר להאזין ולהוריד אותה באמצעות ״שמור הקלטה״.');
      }
    } catch (_) { /* Recording remains available when persistent storage is blocked. */ }
  }
  globalThis.AudioReviewRecording = {encodeMonoWav, init, endSession, restore};
  init();
})();
