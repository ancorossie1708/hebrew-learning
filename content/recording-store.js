/* Durable, device-local draft audio. No network calls. */
(function () {
  'use strict';
  let database;
  function open() {
    if (!database) database = new Promise((resolve, reject) => {
      if (!globalThis.indexedDB) return reject(new Error('Local audio storage unavailable'));
      const request = indexedDB.open('hebrew-learning-recordings-v1',2);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('recordings')) request.result.createObjectStore('recordings',{keyPath:'id'});
        if (!request.result.objectStoreNames.contains('settings')) request.result.createObjectStore('settings');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Local audio storage blocked'));
    });
    return database;
  }
  async function put(id,blob,baseline) {
    const db = await open();
    return new Promise((resolve,reject) => {
      const tx = db.transaction('recordings','readwrite');
      tx.objectStore('recordings').put({id,blob,baseline,savedAt:Date.now()});
      tx.oncomplete = () => resolve(true);
      tx.onerror = tx.onabort = () => reject(tx.error || new Error('Draft audio was not saved'));
    });
  }
  async function all() {
    const db = await open();
    return new Promise((resolve,reject) => {
      const tx = db.transaction('recordings','readonly');
      const request = tx.objectStore('recordings').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async function setDirectory(handle) {
    const db = await open();
    return new Promise((resolve,reject) => {
      const tx=db.transaction('settings','readwrite');
      tx.objectStore('settings').put(handle,'directory');
      tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>reject(tx.error);
    });
  }
  async function getDirectory() {
    const db=await open();
    return new Promise((resolve,reject)=>{
      const request=db.transaction('settings','readonly').objectStore('settings').get('directory');
      request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
    });
  }
  globalThis.RecordingStore = {put,all,setDirectory,getDirectory};
})();
