const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const dialogs=[],effects=[],events={};
const focus={isConnected:true,count:0,focus(){this.count++;}};
function dialog(){
  const button={addEventListener(name,fn){this[name]=fn;}};
  return {attributes:{},events:{},button,open:false,removed:false,
    setAttribute(name,value){this.attributes[name]=value;},
    querySelector(){return button;},addEventListener(name,fn){this.events[name]=fn;},
    showModal(){this.open=true;},close(){this.open=false;},remove(){this.removed=true;}};
}
const context=vm.createContext({document:{activeElement:focus,createElement:dialog,body:{appendChild(d){dialogs.push(d);}}},
  QuizFeedback:{clear(){},celebrate(tier,box,count){effects.push({tier,box,count});}},
  addEventListener(name,fn){events[name]=fn;}});
vm.runInContext(fs.readFileSync('prototype/milestones.js','utf8'),context);
const rewards=context.MilestoneRewards;
assert.equal(rewards.check(0,0),false);
assert.equal(rewards.check(8,9),false);
assert.equal(rewards.check(10,10),false);
for(const count of [10,20,30,40,50,60,70,80,90,100]){
  assert.equal(rewards.check(count-1,count),true);
  const d=dialogs.at(-1),expected=count===100?'grand':count===50||count===90?'special':'standard';
  assert.equal(d.open,true);assert.equal(effects.at(-1).tier,expected);
  assert.equal(effects.at(-1).count,count);
  assert.match(d.innerHTML,new RegExp(`${count} stars earned`));
  assert.equal(d.attributes['aria-labelledby'],'milestone-title');
  d.button.click();assert.equal(d.open,false);assert.equal(d.removed,true);
  assert.equal(rewards.check(count,count),false);
}
const markup=rewards.markup(50);
assert.equal((markup.match(/ unlocked/g)||[]).length,5);
assert.equal((markup.match(/ locked/g)||[]).length,5);
assert.equal((rewards.markup(0).match(/ unlocked/g)||[]).length,0);
assert.equal((rewards.markup(100).match(/ unlocked/g)||[]).length,10);
const next={isConnected:true,count:0,focus(){this.count++;}};
rewards.check(9,10,next);rewards.dismiss();assert.equal(next.count,1);
rewards.check(89,90);let prevented=false;
dialogs.at(-1).events.cancel({preventDefault(){prevented=true;}});
assert.equal(prevented,true);assert.equal(dialogs.at(-1).removed,true);
rewards.check(99,100);events.pagehide();assert.equal(dialogs.at(-1).removed,true);
assert.ok(focus.count>=12);
rewards.configure(120);
assert.equal((rewards.markup(120).match(/ unlocked/g)||[]).length,12);
for(const count of [10,20,30,40,50,60,70,80,90,100,110,120]){
  assert.equal(rewards.check(count-1,count),true);
  assert.equal(effects.at(-1).tier,count===120?'grand':count===60||count===110?'special':'standard');
  if(count===60)assert.match(dialogs.at(-1).innerHTML,/Halfway there!/);
  if(count===110)assert.match(dialogs.at(-1).innerHTML,/reach 120/);
  if(count===120)assert.match(dialogs.at(-1).innerHTML,/All 120 words/);
  rewards.dismiss();
}
// Expansion moves only the prominent targets; existing earned star counts stay intact.
rewards.configure(160);
const expandedMarkup=rewards.markup(120);
assert.equal((expandedMarkup.match(/ unlocked/g)||[]).length,12);
assert.equal((expandedMarkup.match(/ locked/g)||[]).length,4);
assert.match(expandedMarkup,/special unlocked[^>]*[\s\S]*?80 stars: earned/);
assert.match(expandedMarkup,/special locked[^>]*[\s\S]*?150 stars: not yet earned/);
assert.match(expandedMarkup,/grand locked[^>]*[\s\S]*?160 stars: not yet earned/);
for(let count=10;count<=160;count+=10){
  assert.equal(rewards.check(count-1,count),true);
  assert.equal(effects.at(-1).tier,count===160?'grand':count===80||count===150?'special':'standard');
  if(count===80)assert.match(dialogs.at(-1).innerHTML,/Halfway there!/);
  if(count===150)assert.match(dialogs.at(-1).innerHTML,/Just 10 more to reach 160!/);
  if(count===160)assert.match(dialogs.at(-1).innerHTML,/All 160 words/);
  rewards.dismiss();
}
assert.equal(rewards.check(120,120),false,'Reopening after expansion must not celebrate again');
assert.equal(rewards.check(120,121),false);
assert.equal(rewards.check(129,130),true);assert.equal(effects.at(-1).tier,'standard');rewards.dismiss();
for(const invalid of [0,9,125,160.5,NaN])assert.throws(()=>rewards.configure(invalid),/complete ten-word topics/);
assert.equal((rewards.markup(160).match(/ unlocked/g)||[]).length,16);
rewards.configure(200);
for(const [count,expected] of [[100,'special'],[190,'special'],[200,'grand']]){
  rewards.check(count-1,count);assert.equal(effects.at(-1).tier,expected);rewards.dismiss();
}
rewards.configure(140);
assert.equal((rewards.markup(120).match(/ unlocked/g)||[]).length,12);
assert.equal((rewards.markup(120).match(/ locked/g)||[]).length,2);
for(let count=10;count<=140;count+=10){
  rewards.check(count-1,count);
  assert.equal(effects.at(-1).tier,count===140?'grand':count===70||count===130?'special':'standard');
  rewards.dismiss();
}
console.log('Dynamic milestones passed: 140 gives 70/130/140, 160 gives 80/150/160, 200 gives 100/190/200');
