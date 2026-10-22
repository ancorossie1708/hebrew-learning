const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function node() {
  const classes = new Set();
  return {children:[],events:{},style:{setProperty(){}},
    classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x)},
    setAttribute(){},appendChild(child){child.parent=this;this.children.push(child);},
    remove(){if(this.parent)this.parent.children=this.parent.children.filter(x=>x!==this);},
    addEventListener(name,fn){this.events[name]=fn;},
    getBoundingClientRect(){return {left:20,top:400,width:350,height:65};}};
}

async function main() {
  const body=node(), events={},oscillators=[],peaks=[],timers=new Map();
  let reduced=false,createdContext,initialState='running',resumeResolve,volume=1;
  class AudioContext {
    constructor(){this.currentTime=0;this.state=initialState;createdContext=this;}
    resume(){return new Promise(resolve=>{resumeResolve=()=>{this.state='running';resolve();};});}
    async close(){this.state='closed';}
    createGain(){return {gain:{setValueAtTime(){},exponentialRampToValueAtTime(value){peaks.push(value);},cancelScheduledValues(){},setTargetAtTime(){}},connect(){},disconnect(){}};}
    createOscillator(){const osc={frequency:{setValueAtTime(value){osc.hz=value;}},connect(){},disconnect(){},start(at){this.at=at;},stop(at){this.until=at;}};oscillators.push(osc);return osc;}
  }
  const globals={AudioContext,AppPreferences:{effectiveVolume:()=>volume},document:{body,hidden:false,createElement:node,addEventListener(name,fn){events[name]=fn;}},
    matchMedia:()=>({matches:reduced}),addEventListener(name,fn){events[name]=fn;},
    setTimeout(fn){const id=timers.size+1;timers.set(id,fn);return id;},clearTimeout(id){timers.delete(id);}};
  const context=vm.createContext(globals);
  vm.runInContext(fs.readFileSync('prototype/quiz-feedback.js','utf8'),context);
  const feedback=context.QuizFeedback,box=node();

  feedback.show(true,box);
  assert.equal(body.children.length,1);assert.equal(body.children[0].children.length,24);
  assert.equal(oscillators.length,4);assert.ok(oscillators.every(o=>o.type==='sine'));
  assert.ok(oscillators[3].hz>oscillators[0].hz);assert.ok(oscillators[3].until<0.6);
  assert.ok(Math.max(...peaks)<=0.055);

  feedback.show(false,box);
  assert.equal(body.children.length,0);assert.equal(oscillators.length,6);
  assert.ok(oscillators[4].hz>oscillators[5].hz);assert.ok(box.classList.contains('quiz-shake'));
  feedback.clear();assert.ok(!box.classList.contains('quiz-shake'));assert.equal(timers.size,0);

  for(const [tier,particles,notes] of [['standard',40,4],['special',72,6],['grand',120,8]]){
    const count=oscillators.length;
    feedback.celebrate(tier,box);
    assert.equal(box.children.at(-1).children.length,particles);
    assert.equal(oscillators.length-count,notes);
    assert.ok(Math.max(...peaks)<=0.055);
    feedback.clear();assert.equal(box.children.length,0);assert.equal(timers.size,0);
  }
  const firstTenStart=oscillators.length;
  feedback.celebrate('standard',box,10);
  const firstTenNotes=oscillators.slice(firstTenStart);
  assert.equal(firstTenNotes.length,7);
  assert.ok(firstTenNotes.at(-1).hz>firstTenNotes[0].hz);
  assert.ok(firstTenNotes.at(-1).until-firstTenNotes.at(-1).at>0.4);
  assert.ok(firstTenNotes.at(-1).until<1.3);
  assert.ok(Math.max(...peaks)<=0.055);
  feedback.clear();assert.equal(box.children.length,0);

  reduced=true;let reducedNotes=oscillators.length;feedback.show(true,box);
  assert.equal(body.children.length,0);assert.equal(oscillators.length,reducedNotes+4);
  feedback.show(false,box);assert.ok(!box.classList.contains('quiz-shake'));
  feedback.celebrate('grand',box);assert.equal(box.children.length,0);
  feedback.clear();volume=0;const mutedCount=oscillators.length;
  feedback.show(true,box);feedback.show(false,box);feedback.celebrate('grand',box);feedback.celebrate('standard',box,10);
  assert.equal(oscillators.length,mutedCount);
  volume=0.25;peaks.length=0;feedback.celebrate('grand',box);
  assert.ok(Math.max(...peaks)<=0.055*0.25);
  peaks.length=0;feedback.celebrate('standard',box,10);
  assert.ok(Math.max(...peaks)<=0.055*0.25);
  volume=1;

  // An interrupted permission/resume operation must not play on a later screen.
  feedback.clear();events.pagehide();initialState='suspended';
  const count=oscillators.length;feedback.show(true,box);feedback.clear();
  resumeResolve();await Promise.resolve();await Promise.resolve();
  assert.equal(oscillators.length,count);

  // Unsupported audio and a backgrounded page still leave safe visual feedback.
  events.pagehide();context.AudioContext=undefined;reduced=false;
  feedback.show(true,box);assert.equal(body.children.length,1);
  context.document.hidden=true;events.visibilitychange();assert.equal(body.children.length,0);
  console.log('Correct/wrong effects, soft note levels, cleanup, reduced motion and cancelled audio passed');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
