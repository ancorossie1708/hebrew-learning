/* The Android bridge owns GitHub HTTPS, checksums and atomic content activation. */
(function(){
  'use strict';
  const native=globalThis.HebrewLearningNative;
  let busy=false,reloading=false;
  const status=value=>{const el=document.getElementById('native-update-status');if(el)el.textContent=value;};
  function activate(){
    if(!native)return;
    try{
      const result=JSON.parse(native.activateContent());
      if(result.changed&&!busy&&!reloading){reloading=true;location.reload();}
    }catch(_) {status('The current lessons are still available.');}
  }
  function setBusy(value){busy=value;if(native){native.setRoundActive(value);if(!value)activate();}}
  function check(){
    if(!native)return;
    try{
      const result=JSON.parse(native.checkForUpdates());
      status(result.status==='not-configured'?'Updates are not available in this test version.':'Checking for updates…');
    }catch(_){status('Update check unavailable. Your lessons still work.');}
  }
  if(native){
    const section=document.getElementById('native-updates');if(section)section.hidden=false;
    document.getElementById('check-updates')?.addEventListener('click',check);
    try{const info=JSON.parse(native.getStatus());document.getElementById('app-version').textContent='Version '+info.appVersion;}catch(_){}
  }
  globalThis.addEventListener('hebrew:native',event=>{
    const detail=event.detail||{};
    if(detail.status==='offline'){status('Offline. Your lessons are available.');return;}
    if(detail.status==='error'){status('Update unavailable. Your current lessons are safe.');return;}
    if(detail.event==='update-check'&&detail.status==='checked'){
      status(detail.appUpdateAvailable?'App update available.':detail.contentUpdateAvailable?'Downloading new lessons…':'Up to date.');
    }
    if(detail.event==='content-download'){
      if(detail.status==='progress')status(`Updating lessons: ${detail.completedFiles} / ${detail.totalFiles}`);
      if(detail.status==='ready'){status(busy?'New lessons will open when you return to topics.':'New lessons are ready.');activate();}
    }
    if(detail.event==='content-activation'&&detail.changed&&!busy&&!reloading){reloading=true;location.reload();}
    if(detail.event==='apk-update'&&detail.status==='downloading')status('Downloading the app update…');
  });
  globalThis.NativeUpdates={setBusy,check};
})();
