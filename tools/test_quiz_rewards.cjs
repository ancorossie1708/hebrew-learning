// Exercise the actual app handlers with a small DOM stand-in; no browser or audio access.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

function makeElement(){
  const classes=new Set();
  return {dataset:{},disabled:false,hidden:false,textContent:'',listeners:{},isConnected:true,
    showModal(){this.open=true;},close(){this.open=false;},focus(){this.focused=true;},
    classList:{add(...items){items.forEach(x=>classes.add(x));},remove(x){classes.delete(x);},toggle(x,on){if(on)classes.add(x);else classes.delete(x);},contains:x=>classes.has(x)},
    addEventListener(name,callback){this.listeners[name]=callback;}};
}

const html=fs.readFileSync('prototype/index.html','utf8');
const scripts=[...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)];
const seed=scripts.find(s=>s[1].includes('application/json'))[2];
const code=scripts.at(-1)[2];
const frozenProgress=JSON.parse(fs.readFileSync('tools/fixtures/progress-v0.5.1.json','utf8'));
const activeIds=new Set(JSON.parse(seed).words.map(w=>w.id));
// Published IDs are learner records: additions may never rename/remove them silently.
for(const id of frozenProgress.publishedWordIds)assert.ok(activeIds.has(id),`Published word ID changed or removed: ${id}`);
// Changing the installed app identity or storage origin would create an empty profile.
const installedIdentity=frozenProgress.android;
const escapePattern=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const gradleSource=fs.readFileSync('android-app/app/build.gradle.kts','utf8');
const nativeSource=fs.readFileSync('android-app/app/src/main/java/org/hebrewlearning/app/MainActivity.java','utf8');
assert.match(gradleSource,new RegExp('applicationId\\s*=\\s*'+escapePattern(JSON.stringify(installedIdentity.applicationId))));
assert.match(nativeSource,new RegExp('HOST\\s*=\\s*'+escapePattern(JSON.stringify(installedIdentity.originHost))));
assert.match(nativeSource,new RegExp('START\\s*=\\s*"https://"\\s*\\+\\s*HOST\\s*\\+\\s*'+escapePattern(JSON.stringify(installedIdentity.entryPath))));
assert.equal(fs.readFileSync('android-app/signing-certificate.sha256','utf8').trim(),installedIdentity.signingCertificateSha256);

function app(storage,catalog=JSON.parse(seed),options={}){
  let answers=[];
  const elements={main:makeElement(),back:makeElement(),eyebrow:makeElement(),title:makeElement(),seed:{textContent:JSON.stringify(catalog)}};
  Object.defineProperty(elements.main,'innerHTML',{get(){return this.markup;},set(value){
    this.markup=value;answers=[];
    for(const match of value.matchAll(/<button class="answer-select" data-answer="([^"]+)"/g)){
      const button=makeElement(),row=makeElement();button.dataset.answer=match[1];
      button.closest=selector=>selector==='.option'?row:button;button.row=row;answers.push(button);
    }
    elements.feedback=makeElement();elements['quiz-rewards']=makeElement();elements.continue=makeElement();
    elements.continue.hidden=/<button[^>]*id="continue"[^>]*\bhidden/.test(value);
  }});
  const effects=[],milestones=[],audio=[],body=makeElement(),layoutRequests=[],capacities=[];
  const context=vm.createContext({addEventListener(){},AndroidLayout:{setLayout(value){layoutRequests.push(value);}},document:{body,getElementById:id=>elements[id]||(elements[id]=makeElement()),querySelectorAll:selector=>selector==='.answer-select'?answers:[]},
    localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
    MilestoneRewards:{configure(count){capacities.push(count);},dismiss(){},markup(){return '';},check(before,after){if(before<after && after%10===0)milestones.push(after);return false;}},
    QuizFeedback:{clear(){},show(correct){effects.push(correct);}},Audio:class{constructor(src){this.src=src;audio.push(this);}pause(){this.paused=true;}play(){this.played=true;}}});
  vm.runInContext(fs.readFileSync('prototype/preferences.js','utf8'),context);
  if(options.nativeCatalog)context.HebrewLearningNative={getVocabulary:()=>JSON.stringify(options.nativeCatalog)};
  vm.runInContext(options.code||code,context);
  const run=expression=>vm.runInContext(expression,context);
  const click=button=>elements.main.listeners.click({target:{closest:()=>button}});
  return {elements,effects,milestones,audio,body,layoutRequests,capacities,run,answers:()=>answers,
    answer(id){click(answers.find(b=>b.dataset.answer===id));},
    wrong(){const target=run('byCategory(categoryId)[quizIndex].id');const button=answers.find(b=>!b.disabled && b.dataset.answer!==target);click(button);return button.dataset.answer;},
    action(name){const b=makeElement();b.dataset.action=name;click(b);},
    listen(id){const b=makeElement();b.dataset.playChoice=id;click(b);}};
}

const storage=new Map(),test=app(storage);
test.run("showCategory('shopping');startQuiz();");
assert.equal(test.elements.continue.hidden,true);
const firstWrong=test.wrong();
assert.equal(test.answers().filter(b=>!b.disabled).length,2);
assert.ok(test.answers().every(b=>!b.row.classList.contains('correct')));
assert.ok(!test.elements.feedback.textContent.includes('לקנות'));
assert.ok(!test.elements.feedback.textContent.includes('lik-NOT'));
assert.equal(test.elements.continue.hidden,true);
test.action('continue');assert.equal(test.run('quizIndex'),0);
test.answer(firstWrong);assert.equal(test.run('attempts'),1);
test.listen('shopping_buy');assert.equal(test.run('attempts'),1);
test.answer('shopping_buy');assert.equal(test.run('totalStars()'),0);
assert.equal(test.run("topicStars('shopping')"),0);
assert.equal(test.elements.continue.hidden,false);
assert.ok(test.answers().every(b=>b.disabled));
test.action('continue');test.answer('shopping_price');
assert.equal(test.run('totalStars()'),1);assert.equal(test.run('quizStars'),1);
assert.equal(test.run("topicStars('shopping')"),1);
assert.equal(test.run("topicStars('kitchen')"),0);
test.answer('shopping_price');assert.equal(test.run('totalStars()'),1);
test.action('continue');
test.wrong();test.wrong();
assert.equal(test.answers().filter(b=>!b.disabled).length,1);
assert.ok(test.answers().every(b=>!b.row.classList.contains('correct')));
test.answer('shopping_money');assert.equal(test.run('totalStars()'),1);
for(let index=3;index<10;index++){
  test.action('continue');assert.equal(test.answers().length,3);test.wrong();
  test.answer(test.run('byCategory(categoryId)[quizIndex].id'));
}
test.action('continue');assert.equal(test.run('view'),'quiz-result');
assert.match(test.elements.main.innerHTML,/You earned 1 star!/);
assert.match(test.elements.main.innerHTML,/1 of 10 correct on the first try/);
assert.deepEqual(JSON.parse(storage.get('hebrew-learning-word-stars-v1')),['shopping_price']);
test.action('quiz');assert.equal(test.run('quizStars'),0);
test.answer('shopping_buy');assert.equal(test.run('totalStars()'),2);
const reloaded=app(storage);assert.equal(reloaded.run('totalStars()'),2);
assert.equal(reloaded.run("topicStars('shopping')"),2);
reloaded.run("showCategory('shopping')");
assert.match(reloaded.elements.main.innerHTML,/aria-label="2 of 10 stars"/);
assert.equal((reloaded.elements.main.innerHTML.match(/fill="currentColor"/g)||[]).length,2);
assert.equal((reloaded.elements.main.innerHTML.match(/fill="none"/g)||[]).length,8);
reloaded.action('quiz');reloaded.answer('shopping_buy');
assert.equal(reloaded.run("topicStars('shopping')"),2);
assert.equal(reloaded.run('totalStars()'),2);
assert.ok(!reloaded.elements.feedback.textContent.includes('+1 star'));
assert.equal(reloaded.run('done.size'),10);
reloaded.run('showHome()');
assert.match(reloaded.elements.main.innerHTML,/2 stars earned/);
assert.equal((reloaded.elements.main.innerHTML.match(/fill="currentColor"/g)||[]).length,2);
assert.equal(reloaded.run('categories.reduce((sum,c)=>sum+topicStars(c.id),0)'),reloaded.run('totalStars()'));

// Resetting one topic updates the total while retaining another topic's stars.
reloaded.run("showCategory('kitchen');startQuiz();");reloaded.answer('kitchen_plate');
assert.equal(reloaded.run('totalStars()'),3);
reloaded.run("showCategory('shopping')");
assert.match(reloaded.elements.main.innerHTML,/>Reset Stars<\/button>/);
reloaded.action('reset-stars');
assert.equal(reloaded.run("topicStars('shopping')"),0);
assert.equal(reloaded.run("topicStars('kitchen')"),1);
assert.equal(reloaded.run('totalStars()'),1);
assert.equal(reloaded.run('categories.reduce((sum,c)=>sum+topicStars(c.id),0)'),1);
const afterReset=app(storage);
assert.equal(afterReset.run('totalStars()'),1);
assert.equal(afterReset.run("topicStars('kitchen')"),1);
assert.equal(afterReset.run('done.size'),11);

// Updating/opening the app must never repeat the historical one-off reset.
const practised=JSON.parse(seed).words.slice(0,13).map(w=>w.id);
const legacyStorage=new Map([
  ['hebrew-learning-stars-v1','2'],
  ['hebrew-learning-word-stars-v1','["shopping_buy","kitchen_plate"]'],
  ['hebrew-care-done',JSON.stringify(practised)]
]);
const migrated=app(legacyStorage);
assert.equal(migrated.run('totalStars()'),2);
assert.equal(migrated.run('categories.reduce((sum,c)=>sum+topicStars(c.id),0)'),2);
assert.equal(migrated.run('done.size'),13);
assert.match(migrated.elements.main.innerHTML,/2 stars earned/);
migrated.run("showCategory('shopping');startQuiz();");migrated.answer('shopping_buy');
assert.equal(migrated.run('totalStars()'),2);
assert.equal(migrated.run("topicStars('shopping')"),1);
assert.equal(legacyStorage.get('hebrew-learning-stars-v1'),'2');
assert.equal(app(legacyStorage).run('totalStars()'),2);
const mismatched=app(new Map([
  ['hebrew-learning-star-reset-version',storage.get('hebrew-learning-star-reset-version')],
  ['hebrew-learning-stars-v1','99'],
  ['hebrew-learning-word-stars-v1','["shopping_buy","shopping_buy","shopping_price","unknown"]']
]));
assert.equal(mismatched.run('totalStars()'),2);
assert.equal(mismatched.run('categories.reduce((sum,c)=>sum+topicStars(c.id),0)'),2);
// Milestones follow unique earned stars, not visits, retry completions, or replay.
for(const threshold of Array.from({length:JSON.parse(seed).words.length/10},(_,i)=>(i+1)*10)){
  const milestone=app(new Map());
  milestone.run(`starredWords=new Set(words.filter(w=>w.id!=='shopping_buy').slice(0,${threshold-1}).map(w=>w.id));showCategory('shopping');startQuiz();`);
  milestone.answer('shopping_buy');
  assert.equal(milestone.run('totalStars()'),threshold);
  assert.deepEqual(milestone.milestones,[threshold]);
  milestone.answer('shopping_buy');
  milestone.action('quiz');milestone.answer('shopping_buy');
  assert.deepEqual(milestone.milestones,[threshold]);
  const retry=app(new Map());
  retry.run(`starredWords=new Set(words.filter(w=>w.id!=='shopping_buy').slice(0,${threshold-1}).map(w=>w.id));showCategory('shopping');startQuiz();`);
  retry.wrong();retry.answer('shopping_buy');
  assert.deepEqual(retry.milestones,[]);
  assert.equal(retry.run('totalStars()'),threshold-1);
}
// Settings apply immediately and survive reload without restarting a quiz.
const settingStorage=new Map([['hebrew-learning-audio-review-v1','keep-review-evidence']]);
const settings=app(settingStorage);
assert.equal(settings.run('AppPreferences.effectiveVolume()'),1);
assert.equal(settings.run('AppPreferences.get().showPictures'),true);
assert.equal(settings.run('AppPreferences.get().layout'),'phone');
assert.deepEqual(settings.layoutRequests,['phone']);
assert.equal(settings.elements.eyebrow.hidden,true);assert.equal(settings.elements.title.hidden,true);
settings.run("showCategory('shopping');startQuiz();");settings.wrong();
const originalChoices=settings.answers();
settings.elements['settings-open'].listeners.click();
assert.equal(settings.elements['settings-dialog'].open,true);
settings.elements['setting-pictures'].checked=false;settings.elements['setting-pictures'].listeners.change();
settings.elements['setting-layout'].value='ktc-24';settings.elements['setting-layout'].listeners.change();
assert.equal(settings.run('attempts'),1);assert.equal(settings.run('quizIndex'),0);
assert.equal(settings.answers(),originalChoices);assert.equal(settings.answers().filter(b=>!b.disabled).length,2);
assert.equal(settings.body.classList.contains('without-pictures'),true);
assert.equal(settings.body.classList.contains('tablet-layout'),true);
assert.deepEqual(settings.layoutRequests,['phone','ktc-24']);
settings.elements['setting-volume'].value='25';settings.elements['setting-volume'].listeners.input();
settings.listen('shopping_buy');assert.equal(settings.audio.at(-1).volume,0.25);
settings.elements['setting-sound'].checked=false;settings.elements['setting-sound'].listeners.change();
const audioCount=settings.audio.length;settings.listen('shopping_buy');
assert.equal(settings.audio.length,audioCount);assert.equal(settings.audio.at(-1).volume,0);
assert.equal(settings.audio.at(-1).paused,true);
assert.equal(settings.elements['setting-volume'].disabled,true);
settings.elements['setting-sound'].checked=true;settings.elements['setting-sound'].listeners.change();
settings.listen('shopping_buy');assert.equal(settings.audio.at(-1).volume,0.25);
assert.deepEqual(settings.layoutRequests,['phone','ktc-24']);
settings.answer('shopping_buy');assert.equal(settings.run('totalStars()'),0);
settings.action('continue');settings.answer('shopping_price');assert.equal(settings.run('totalStars()'),1);
const persisted=app(settingStorage);
assert.equal(persisted.run('AppPreferences.get().layout'),'ktc-24');
assert.equal(persisted.run('AppPreferences.effectiveVolume()'),0.25);
assert.equal(persisted.body.classList.contains('without-pictures'),true);
persisted.run("showCategory('shopping')");
assert.match(persisted.elements.main.innerHTML,/Match Hebrew to English/);
assert.ok(!persisted.elements.main.innerHTML.includes('see its picture'));
persisted.elements['settings-open'].listeners.click();
persisted.elements['reset-game'].listeners.click();assert.equal(persisted.run('totalStars()'),1);
persisted.elements['reset-cancel'].listeners.click();assert.equal(persisted.run('totalStars()'),1);
persisted.elements['reset-game'].listeners.click();persisted.elements['reset-confirm-button'].listeners.click();
assert.equal(persisted.run('view'),'home');assert.equal(persisted.run('done.size'),0);
assert.equal(persisted.run('totalStars()'),0);
assert.equal(persisted.run('categories.reduce((sum,c)=>sum+topicStars(c.id),0)'),0);
assert.equal(persisted.run('AppPreferences.get().layout'),'phone');
assert.equal(persisted.run('AppPreferences.get().showPictures'),true);
assert.equal(persisted.run('AppPreferences.effectiveVolume()'),1);
assert.equal(persisted.body.classList.contains('tablet-layout'),false);
assert.equal(persisted.elements['settings-dialog'].open,false);
assert.equal(settingStorage.get('hebrew-learning-audio-review-v1'),'keep-review-evidence');
assert.equal(app(settingStorage).run('totalStars()'),0);
const corrupt=app(new Map([['hebrew-learning-settings-v1','broken JSON']]));
assert.equal(corrupt.run('AppPreferences.effectiveVolume()'),1);
assert.equal(corrupt.run('AppPreferences.get().layout'),'phone');

// Upgrade the frozen synthetic learner from the released 120-word version.
const sourceCatalog=JSON.parse(seed);
assert.equal(sourceCatalog.words.length,140,'Release includes the original 120 plus Sentences 1 and Politics');
assert.equal(sourceCatalog.categories.length,14);
assert.ok(sourceCatalog.categories.some(c=>c.id==='sentences_1'));
assert.ok(sourceCatalog.categories.some(c=>c.id==='politics'));
assert.ok(!sourceCatalog.categories.some(c=>c.id==='sentences_2'||c.id==='swear_words'));
const deferredStorage=new Map(Object.entries(frozenProgress.storage));
const deferredStars=JSON.parse(deferredStorage.get('hebrew-learning-word-stars-v1'));
const deferredDone=JSON.parse(deferredStorage.get('hebrew-care-done'));
for(const id of ['swear_words_stupid','sentences_2_explain_again']){deferredStars.push(id);deferredDone.push(id);}
deferredStorage.set('hebrew-learning-word-stars-v1',JSON.stringify(deferredStars));
deferredStorage.set('hebrew-care-done',JSON.stringify(deferredDone));
const selectedRelease=app(deferredStorage,sourceCatalog);
assert.equal(selectedRelease.run('totalStars()'),68);
assert.equal(selectedRelease.run('practisedCount()'),92);
assert.deepEqual(selectedRelease.capacities,[140]);
selectedRelease.run('save()');
assert.ok(JSON.parse(deferredStorage.get('hebrew-learning-word-stars-v1')).includes('swear_words_stupid'));
assert.ok(JSON.parse(deferredStorage.get('hebrew-care-done')).includes('sentences_2_explain_again'));
const publishedIds=new Set(frozenProgress.publishedWordIds);
const oldWords=sourceCatalog.words.filter(w=>publishedIds.has(w.id));
const oldTopicIds=new Set(oldWords.map(w=>w.categoryId));
const oldCatalog={categories:sourceCatalog.categories.filter(c=>oldTopicIds.has(c.id)),words:oldWords};
const expandedCatalog=JSON.parse(JSON.stringify(oldCatalog));
for(let topic=0;topic<4;topic++){
  const id=`upgrade_fixture_topic_${topic}`;
  expandedCatalog.categories.push({id,title:`Test-only expansion ${topic+1}`});
  for(let index=0;index<10;index++)expandedCatalog.words.push({
    ...oldWords[0],id:`${id}_word_${index}`,categoryId:id,hebrew:'בדיקה',english:'Test fixture only',pronunciation:'test'
  });
}
assert.equal(oldCatalog.words.length,120);assert.equal(expandedCatalog.words.length,160);
const upgradedStorage=new Map(Object.entries(frozenProgress.storage));
const beforeOpening=JSON.stringify([...upgradedStorage]);
// A data update delivers 160 words while the installed fallback bundle still has 120.
const expanded=app(upgradedStorage,oldCatalog,{nativeCatalog:expandedCatalog});
assert.deepEqual(expanded.capacities,[160]);
assert.equal(JSON.stringify([...upgradedStorage]),beforeOpening,'Opening an update must not rewrite or reset saved records');
assert.equal(expanded.run('totalStars()'),68);
assert.equal(expanded.run('practisedCount()'),92);
assert.equal(expanded.run('categories.reduce((sum,c)=>sum+topicStars(c.id),0)'),68);
assert.equal(expanded.run("categories.filter(c=>c.id.startsWith('upgrade_fixture_')).reduce((sum,c)=>sum+topicStars(c.id),0)"),0);
assert.match(expanded.elements.main.innerHTML,/92 of 160/);
assert.equal(expanded.run('AppPreferences.get().soundEnabled'),false);
assert.equal(expanded.run('AppPreferences.get().volume'),0.25);
assert.equal(expanded.run('AppPreferences.get().showPictures'),false);
assert.equal(expanded.run('AppPreferences.get().layout'),'ktc-24');
assert.deepEqual(expanded.milestones,[],'An expansion/reopen must not replay old celebrations');
const newWord='upgrade_fixture_topic_0_word_0';
expanded.run("showCategory('upgrade_fixture_topic_0');startQuiz();");expanded.answer(newWord);
assert.equal(expanded.run('totalStars()'),69);assert.equal(expanded.run('practisedCount()'),93);
// A temporary catalog fallback hides the new entry but must retain its stored ID.
const fallback=app(upgradedStorage,oldCatalog);
assert.equal(fallback.run('totalStars()'),68);assert.equal(fallback.run('practisedCount()'),92);
fallback.run('save()');
assert.ok(JSON.parse(upgradedStorage.get('hebrew-learning-word-stars-v1')).includes(newWord));
assert.ok(JSON.parse(upgradedStorage.get('hebrew-care-done')).includes(newWord));
// The next APK bundles 160 words directly; the extra star and all settings reappear.
const upgradedApk=app(upgradedStorage,expandedCatalog);
assert.equal(upgradedApk.run('totalStars()'),69);assert.equal(upgradedApk.run('practisedCount()'),93);
assert.equal(upgradedApk.run('AppPreferences.get().layout'),'ktc-24');
assert.equal(upgradedApk.run('categories.reduce((sum,c)=>sum+topicStars(c.id),0)'),69);
assert.deepEqual(upgradedApk.milestones,[]);
for(const marker of [undefined,'old-version']){
  const missingMarker=new Map(Object.entries(frozenProgress.storage));
  if(marker===undefined)missingMarker.delete('hebrew-learning-star-reset-version');
  else missingMarker.set('hebrew-learning-star-reset-version',marker);
  const safeUpgrade=app(missingMarker,expandedCatalog);
  assert.equal(safeUpgrade.run('totalStars()'),68,'An absent/outdated old reset marker must never erase stars');
  assert.equal(safeUpgrade.run('practisedCount()'),92);
}
const completedStorage=new Map(Object.entries(frozenProgress.storage));
completedStorage.set('hebrew-learning-word-stars-v1',JSON.stringify(frozenProgress.publishedWordIds));
completedStorage.set('hebrew-care-done',JSON.stringify(frozenProgress.publishedWordIds));
const completedUpgrade=app(completedStorage,expandedCatalog);
assert.equal(completedUpgrade.run('totalStars()'),120);
assert.equal(completedUpgrade.run('practisedCount()'),120);
assert.match(completedUpgrade.elements.main.innerHTML,/120 of 160/);
for(const category of oldCatalog.categories)assert.equal(completedUpgrade.run(`topicStars(${JSON.stringify(category.id)})`),10);
// Merely opening/cancelling Reset keeps every record; only confirmation clears them.
upgradedApk.elements['settings-open'].listeners.click();upgradedApk.elements['reset-game'].listeners.click();
assert.equal(upgradedApk.run('totalStars()'),69);
upgradedApk.elements['reset-cancel'].listeners.click();assert.equal(upgradedApk.run('practisedCount()'),93);
upgradedApk.elements['reset-game'].listeners.click();upgradedApk.elements['reset-confirm-button'].listeners.click();
assert.equal(upgradedApk.run('totalStars()'),0);assert.equal(upgradedApk.run('practisedCount()'),0);
assert.equal(upgradedApk.run('AppPreferences.get().layout'),'phone');
assert.deepEqual(JSON.parse(upgradedStorage.get('hebrew-learning-word-stars-v1')),[]);
assert.deepEqual(JSON.parse(upgradedStorage.get('hebrew-care-done')),[]);
assert.equal(upgradedStorage.get('hebrew-learning-audio-review-v1'),'synthetic-review-evidence');
assert.equal(app(upgradedStorage,expandedCatalog).run('totalStars()'),0);
console.log('Quiz/rewards/settings/reset and Android identity guards passed; released progress survives simulated 120→160 catalog/app upgrades and fallback');
