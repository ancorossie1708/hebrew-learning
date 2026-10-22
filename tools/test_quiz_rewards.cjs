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

function app(storage){
  let answers=[];
  const elements={main:makeElement(),back:makeElement(),eyebrow:makeElement(),title:makeElement(),seed:{textContent:seed}};
  Object.defineProperty(elements.main,'innerHTML',{get(){return this.markup;},set(value){
    this.markup=value;answers=[];
    for(const match of value.matchAll(/<button class="answer-select" data-answer="([^"]+)"/g)){
      const button=makeElement(),row=makeElement();button.dataset.answer=match[1];
      button.closest=selector=>selector==='.option'?row:button;button.row=row;answers.push(button);
    }
    elements.feedback=makeElement();elements['quiz-rewards']=makeElement();elements.continue=makeElement();
    elements.continue.hidden=/<button[^>]*id="continue"[^>]*\bhidden/.test(value);
  }});
  const effects=[],milestones=[],audio=[],body=makeElement(),layoutRequests=[];
  const context=vm.createContext({addEventListener(){},AndroidLayout:{setLayout(value){layoutRequests.push(value);}},document:{body,getElementById:id=>elements[id]||(elements[id]=makeElement()),querySelectorAll:selector=>selector==='.answer-select'?answers:[]},
    localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
    MilestoneRewards:{configure(){},dismiss(){},markup(){return '';},check(before,after){if(before<after && after%10===0)milestones.push(after);return false;}},
    QuizFeedback:{clear(){},show(correct){effects.push(correct);}},Audio:class{constructor(src){this.src=src;audio.push(this);}pause(){this.paused=true;}play(){this.played=true;}}});
  vm.runInContext(fs.readFileSync('prototype/preferences.js','utf8'),context);
  vm.runInContext(code,context);
  const run=expression=>vm.runInContext(expression,context);
  const click=button=>elements.main.listeners.click({target:{closest:()=>button}});
  return {elements,effects,milestones,audio,body,layoutRequests,run,answers:()=>answers,
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

// The explicit fresh start clears every old star once, preserving learned words.
const practised=JSON.parse(seed).words.slice(0,13).map(w=>w.id);
const legacyStorage=new Map([
  ['hebrew-learning-stars-v1','2'],
  ['hebrew-learning-word-stars-v1','["shopping_buy","kitchen_plate"]'],
  ['hebrew-care-done',JSON.stringify(practised)]
]);
const migrated=app(legacyStorage);
assert.equal(migrated.run('totalStars()'),0);
assert.equal(migrated.run('categories.reduce((sum,c)=>sum+topicStars(c.id),0)'),0);
assert.equal(migrated.run('done.size'),13);
assert.match(migrated.elements.main.innerHTML,/0 stars earned/);
migrated.run("showCategory('shopping');startQuiz();");migrated.answer('shopping_buy');
assert.equal(migrated.run('totalStars()'),1);
assert.equal(migrated.run("topicStars('shopping')"),1);
assert.equal(legacyStorage.has('hebrew-learning-stars-v1'),false);
assert.equal(app(legacyStorage).run('totalStars()'),1);
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
console.log('Rewards, all milestones, persistent sound/picture/layout settings, active-quiz preservation and full reset passed');
