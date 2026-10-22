// Verify WAV output and microphone lifecycle without accessing a real microphone.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function element() {
  return {disabled:false, hidden:false, textContent:'', listeners:{},
    addEventListener(type, fn){this.listeners[type]=fn;}, pause(){}, click(){this.clicked=true;}, remove(){}};
}
function panel(id) {
  const controls = {start:element(), stop:element(), download:element(), file:element(), status:element(), preview:element()};
  return {dataset:{recordId:id}, controls, querySelector(selector){
    if(selector==='[data-record-file]')return controls.file;
    if(selector==='.record-status')return controls.status;
    if(selector==='.record-preview')return controls.preview;
    return controls[selector.match(/data-record="(.*?)"/)[1]];
  }};
}
async function main() {
  const cup=panel('kitchen_cup'),bucket=panel('cleaning_bucket'),panels=[cup,bucket];
  let requests=0,stopped=0,denied=false,stopTask,downloaded;
  const samples=Float32Array.from({length:24000},(_,i)=>Math.sin(i/20)*0.25);
  const buffer={length:samples.length,numberOfChannels:1,sampleRate:48000,getChannelData:()=>samples};
  const events={};
  const drafts=new Map(),end=element(),sessionStatus=element(),chooseFolder=element(),folderStatus=element();
  let savedDirectory=null,chosenDirectory=null;
  let track;
  class Recorder {
    static isTypeSupported(){return true;}
    constructor(){this.state='inactive';this.mimeType='audio/webm';}
    start(){this.state='recording';}
    stop(){this.state='inactive';this.ondataavailable({data:new Blob(['test'])});stopTask=this.onstop();}
  }
  const context=vm.createContext({Blob,DataView,ArrayBuffer,Map,Float32Array,console,
    setTimeout:()=>1,clearTimeout:()=>{},
    RecordingStore:{async put(id,blob,baseline){drafts.set(id,{id,blob,baseline});},async all(){return [...drafts.values()];},async getDirectory(){return savedDirectory;},async setDirectory(handle){savedDirectory=handle;}},
    async showDirectoryPicker(options){assert.equal(options.mode,'readwrite');return chosenDirectory;},
    navigator:{mediaDevices:{async getUserMedia(){requests++;if(denied){const e=new Error();e.name='NotAllowedError';throw e;}track={enabled:true,readyState:'live',stop(){stopped++;this.readyState='ended';}};return {getTracks:()=>[track]};}}},
    MediaRecorder:Recorder,
    AudioContext:class {async decodeAudioData(){return buffer;}async close(){}},
    URL:{createObjectURL:()=> 'blob:recording',revokeObjectURL(){}},
    addEventListener(type,fn){events[type]=fn;},
    document:{hidden:false,querySelectorAll(selector){return selector==='[data-record-id]'?panels:[];},
      getElementById(id){return {'end-recording-session':end,'microphone-session-status':sessionStatus,'choose-recording-folder':chooseFolder,'recording-folder-status':folderStatus}[id];},
      addEventListener(type,fn){events[type]=fn;},
      createElement(){downloaded=element();return downloaded;},body:{appendChild(){}}}
  });
  vm.runInContext(fs.readFileSync('content/record-audio.js','utf8'),context);
  const encode=context.AudioReviewRecording.encodeMonoWav;
  const stereo={length:3,numberOfChannels:2,sampleRate:16000,
    getChannelData:i=>new Float32Array(i?[1,-1,0]:[1,-1,1])};
  const encoded=encode(stereo),raw=await encoded.blob.arrayBuffer(),wav=new DataView(raw);
  assert.equal(Buffer.from(raw).subarray(0,4).toString(),'RIFF');
  assert.equal(wav.getUint16(22,true),1);assert.equal(wav.getUint32(24,true),16000);
  assert.equal(wav.getUint32(40,true),6);assert.equal(wav.getInt16(44,true),32767);
  assert.equal(wav.getInt16(46,true),-32768);assert.equal(wav.getInt16(48,true),16384);
  await cup.controls.start.listeners.click();
  assert.equal(requests,1);assert.equal(cup.controls.stop.disabled,false);assert.equal(bucket.controls.start.disabled,true);
  await bucket.controls.start.listeners.click();assert.equal(requests,1);
  cup.controls.stop.listeners.click();await stopTask;
  assert.equal(stopped,0);assert.equal(track.enabled,false);assert.equal(cup.controls.preview.hidden,false);assert.equal(cup.controls.download.disabled,false);
  assert.ok(drafts.has('kitchen_cup'));
  assert.equal(bucket.controls.start.disabled,false);
  cup.controls.download.listeners.click();assert.equal(downloaded.download,'kitchen_cup.wav');assert.equal(downloaded.href,'blob:recording');
  await bucket.controls.start.listeners.click();assert.equal(requests,1);assert.equal(track.enabled,true);
  bucket.controls.stop.listeners.click();await stopTask;assert.equal(track.enabled,false);
  assert.equal(requests,1);end.listeners.click();assert.ok(stopped>0);
  denied=true;await bucket.controls.start.listeners.click();
  assert.match(bucket.controls.status.textContent,/לא ניתנה גישה/);assert.equal(bucket.controls.start.disabled,false);
  const before=requests;
  await bucket.controls.file.listeners.change({target:{files:[new Blob(['phone audio'])]}});
  assert.equal(requests,before);assert.equal(bucket.controls.preview.hidden,false);
  denied=false;await bucket.controls.start.listeners.click();
  const previousStops=stopped;events.pagehide({persisted:false});assert.ok(stopped>previousStops);
  // Simulate reopening: the script restores saved drafts without microphone access.
  cup.controls.preview.hidden=true;cup.controls.download.disabled=true;
  const previousRequests=requests;
  vm.runInContext(fs.readFileSync('content/record-audio.js','utf8'),context);
  await context.AudioReviewRecording.restore();
  assert.equal(requests,previousRequests);assert.equal(cup.controls.preview.hidden,false);
  assert.equal(cup.controls.download.disabled,false);
  await bucket.controls.start.listeners.click();
  const hiddenStops=stopped;context.document.hidden=true;events.visibilitychange();await stopTask;
  assert.ok(stopped>hiddenStops);assert.equal(track.readyState,'ended');
  // A chosen folder receives correctly named WAVs directly, without a download.
  context.document.hidden=false;
  const savedFiles=new Map();let permission='granted',permissionRequests=0,failWrite=false,aborts=0;
  chosenDirectory={name:'human',async queryPermission(){return permission;},async requestPermission(){permissionRequests++;permission='granted';return permission;},
    async getFileHandle(name){return {async createWritable(){let bytes;return {async write(blob){if(failWrite)throw new Error('Disk full');bytes=await blob.arrayBuffer();},async close(){savedFiles.set(name,bytes);},async abort(){aborts++;}};}};}};
  await chooseFolder.listeners.click();assert.equal(savedDirectory,chosenDirectory);
  await cup.controls.start.listeners.click();cup.controls.stop.listeners.click();await stopTask;
  assert.ok(savedFiles.has('kitchen_cup.wav'));
  assert.equal(Buffer.from(savedFiles.get('kitchen_cup.wav')).subarray(0,4).toString(),'RIFF');
  assert.match(cup.controls.status.textContent,/נשמר ישירות/);
  permission='prompt';
  await bucket.controls.start.listeners.click();bucket.controls.stop.listeners.click();await stopTask;
  assert.equal(savedFiles.has('cleaning_bucket.wav'),false);assert.equal(permissionRequests,0);
  await bucket.controls.download.listeners.click();assert.equal(permissionRequests,1);
  assert.ok(savedFiles.has('cleaning_bucket.wav'));
  failWrite=true;await cup.controls.download.listeners.click();
  assert.ok(aborts>0);assert.match(cup.controls.status.textContent,/לא נשמר/);
  assert.ok(drafts.has('kitchen_cup'));
  context.AudioReviewRecording.endSession();
  vm.runInContext(fs.readFileSync('content/record-audio.js','utf8'),context);
  await context.AudioReviewRecording.restore();
  assert.equal(cup.controls.download.textContent,'שמור בתיקייה');
  console.log('Session permission reuse, microphone release, draft/folder restoration, direct WAV saving, permission renewal and disk errors passed');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
