'use strict';
/* Headless smoke test for ROBOT RAMPAGE: stub THREE + DOM, run the real sim. */
const fs = require('fs');
const path = __dirname + '/';

// ---------- DOM stub ----------
function mkEl(){
  const el = { style:{}, _l:{}, _tc:'', className:'', disabled:false,
    addEventListener(t,f){ this._l[t]=f; }, appendChild(){}, };
  Object.defineProperty(el, 'textContent', { get(){ return this._tc; }, set(v){ this._tc = String(v); } });
  return el;
}
const els = {};
global.document = {
  getElementById: id => els[id] || (els[id] = mkEl()),
  createElement: () => mkEl(),
  addEventListener(){}, readyState: 'complete', hidden: false,
};
global.window = { innerWidth: 900, innerHeight: 700, addEventListener(){},
  AudioContext: undefined, webkitAudioContext: undefined };
global.performance = { now: () => simNow };
let simNow = 0;
let rafCb = null;
global.requestAnimationFrame = cb => { rafCb = cb; };
// timers run immediately in tests (e.g. the 1.4s game-over overlay delay)
global.setTimeout = (fn)=>{ fn(); return 0; };

// ---------- THREE stub ----------
class V3 {
  constructor(x=0,y=0,z=0){ this.x=x; this.y=y; this.z=z; }
  set(x,y,z){ this.x=x; this.y=y; this.z=z; return this; }
  project(){ return this; }
}
class Color {
  constructor(h){ this.h=h; }
  setHex(h){ this.h=h; return this; }
  getHex(){ return this.h||0; }
  copy(c){ this.h=c.h; return this; }
  multiplyScalar(){ return this; }
  lerp(){ return this; }
}
class Mat {
  constructor(o={}){ this.color=new Color(o.color); this.emissive=new Color(o.emissive||0);
    this.emissiveIntensity=1; this.transparent=false; this.opacity=1; this.depthWrite=true; }
  dispose(){}
}
class Obj {
  constructor(){
    this.position=new V3();
    this.rotation={x:0,y:0,z:0,set(x,y,z){this.x=x;this.y=y;this.z=z;}};
    this.scale={x:1,y:1,z:1,set(x,y,z){this.x=x;this.y=y;this.z=z;}};
    this.children=[]; this.visible=true;
  }
  add(c){ this.children.push(c); return this; }
  remove(c){ const i=this.children.indexOf(c); if(i>=0) this.children.splice(i,1); }
  traverse(f){ f(this); for(const c of this.children) if(c.traverse) c.traverse(f); }
  lookAt(){}
}
class Mesh extends Obj { constructor(g,m){ super(); this.geometry=g||{dispose(){}}; this.material=m||new Mat(); } }
class Group extends Obj {}
class Geo { constructor(){ } dispose(){} }
global.THREE = {
  WebGLRenderer: class { setPixelRatio(){} setSize(){} render(){} },
  Scene: class extends Group {},
  OrthographicCamera: class extends Obj { updateProjectionMatrix(){} },
  PerspectiveCamera: class extends Obj { updateProjectionMatrix(){} },
  HemisphereLight: class extends Obj {},
  DirectionalLight: class extends Obj {},
  Mesh, Group, MeshLambertMaterial: Mat, MeshBasicMaterial: Mat,
  BoxGeometry: Geo, PlaneGeometry: Geo, SphereGeometry: Geo, Color, Vector3: V3,
};

// ---------- load game ----------
// strict-mode eval keeps its own scope: export what the test needs onto globalThis
const src = fs.readFileSync(path+'logic.js','utf8') + '\n' + fs.readFileSync(path+'game.js','utf8');
eval(src + `
;Object.assign(globalThis,{robot,pilot,pcam,input,joy,civs,soldiers,helis,bullets,
  topRow,buildingsLeft,damageFloor,spawnSoldier,spawnBullet,hurtRobot,updateHp,onFloorHit,
  startWave,disembark,embark,tryEmbark,hurtPilot,killSoldier,pilotShoot,toggleTorch});
;Object.defineProperty(globalThis,'rr_score',{configurable:true,get:function(){return score;}});
;Object.defineProperty(globalThis,'rr_wave',{configurable:true,get:function(){return wave;}});
;Object.defineProperty(globalThis,'rr_over',{configurable:true,get:function(){return over;}});
;Object.defineProperty(globalThis,'buildings',{configurable:true,get:function(){return buildings;}});
;Object.defineProperty(globalThis,'city',{configurable:true,get:function(){return city;}});
;Object.defineProperty(globalThis,'rr_camTrans',{configurable:true,get:function(){return camTrans;}});
`);

// ---------- helpers ----------
function assert(c,msg){ if(!c){ console.error('FAIL:',msg); process.exit(1); } console.log('ok:',msg); }
function frames(n){ for(let i=0;i<n;i++){ simNow+=16.7; rafCb(simNow); } }
function punchOnce(){ input.punchQueued=true; frames(25); } // > punchCd

// boot ran at load; drive the rAF chain
simNow=16.7; rafCb(simNow); // outer: sets lastT, registers frame
frames(5);
joy.active = true; // test drives input.jx/jy directly (like the touch stick); keeps pollKeys() from clobbering them
assert(robot.mode==='ground', 'robot starts on ground');
assert(typeof buildings!=='undefined' && buildings.length===9, '9 buildings built');

// walk into the center building -> should start climbing its west face
const b = buildings[4];
assert(topRow(b) >= 5, 'center building is tall enough');
robot.x = b.bx1 - 4; robot.z = (b.bz1+b.bz2)/2; robot.y = 0;
input.jx = 1; input.jy = -1; // world +x
frames(15);
input.jx = 0; input.jy = 0; // let go once climbing (holding stick-down would dismount after the mount grace)
frames(25);
assert(robot.mode==='climb', 'robot climbs when pushing into building (mode='+robot.mode+')');
assert(robot.cf===3, 'climbing west face (cf='+robot.cf+')');

// punch ground floor 6x -> whole building crumbles
const topBefore = topRow(b);
for(let i=0;i<6;i++) punchOnce();
assert(topRow(b)===-1 && b.dead, '6 ground punches crumble whole building');
assert(robot.mode==='ground', 'robot drops to ground after total collapse');
assert(rr_score>0, 'rr_score increased ('+rr_score+')');
assert(els['bleft'].textContent==='8', 'HUD buildings-left = 8');

// climb another building upward, then punch an upper floor -> only above crumbles
const b2 = buildings[0];
robot.x = b2.bx1 - 4; robot.z = (b2.bz1+b2.bz2)/2; robot.y = 0; robot.mode = 'ground';
input.jx = 1; input.jy = -1; frames(15); input.jx=0; input.jy=0; frames(25);
assert(robot.mode==='climb', 'climbing second building');
const top2 = topRow(b2);
assert(top2>=5, 'second building tall enough (top='+top2+')');
// climb to row 4, staying below the top (reaching the top would mount the roof and walk off)
input.jy = 1;
for(let i=0;i<300 && robot.crow<4;i++) frames(1);
input.jy = 0;
assert(robot.mode==='climb' && robot.crow===4, 'climbed to row 4 (crow='+robot.crow+', mode='+robot.mode+')');
const rowHit = robot.crow;
punchOnce(); punchOnce(); // upper floors have 2 hp (row>=3)
assert(topRow(b2)===rowHit-1, 'punching row '+rowHit+' crumbled everything above (top '+top2+' -> '+topRow(b2)+')');
assert(!b2.floors[rowHit-1].destroyed, 'floor below the punched row intact');
assert(robot.crow===topRow(b2), 'robot settled onto new top row');

// enemies: punch a soldier (robot back on the ground so the fist can reach)
robot.mode='ground'; robot.y=0; robot.cb=null;
spawnSoldier();
const s0 = soldiers[soldiers.length-1];
s0.x = robot.x+3; s0.z = robot.z; // in fist range
const sc0 = rr_score;
robot.angle = Math.atan2(s0.x-robot.x, s0.z-robot.z);
punchOnce();
assert(soldiers.indexOf(s0)===-1, 'soldier destroyed by punch');
assert(rr_score>sc0, 'rr_score for soldier kill');

// civilians get eaten on contact
const c0 = civs[0]; c0.x = robot.x+1; c0.z = robot.z;
const hp0 = robot.hp = 80; updateHp();
frames(10);
assert(civs.indexOf(c0)===-1, 'civilian eaten on contact');
assert(robot.hp>hp0, 'eating restores hp');

// bullets hurt the robot; lethal damage -> game over
const hpBefore = robot.hp;
spawnBullet(robot.x, robot.y+2.5, robot.z, robot.x, robot.y+2.5, robot.z, 1, 5);
frames(5);
assert(robot.hp<hpBefore, 'bullet damaged robot');
hurtRobot(500);
assert(rr_over && robot.dead, 'lethal damage -> game over');
assert(els['over'].style.display==='flex', 'game over overlay shown');

// restart
els['restartBtn']._l.click();
assert(!rr_over && rr_wave===1 && rr_score===0, 'restart resets game');
assert(robot.hp===100, 'hp restored');

// wave clear -> next sector
for(const bb of buildings){
  const cx=(bb.bx1+bb.bx2)/2, cz=(bb.bz1+bb.bz2)/2;
  const res = damageFloor(bb, 0, 99);
  onFloorHit(bb, 0, res, cx, cz);
}
assert(buildingsLeft(city)===0, 'all buildings destroyed');
frames(200); // waveClearT elapses -> startWave(2)
assert(rr_wave===2, 'advanced to sector 2 (wave='+rr_wave+')');
assert(els['wave'].textContent==='2', 'HUD wave = 2');
assert(buildings.length===9 && buildingsLeft(city)===9, 'fresh city built');

// ---------- pilot mode ----------
// fresh sector for pilot tests (robot parked at a street corner, grounded)
startWave(1); frames(5);
assert(robot.mode==='ground' && !robot.dead, 'robot grounded for disembark');
const prx=robot.x, prz=robot.z;

// disembark -> pilot active, spawns next to the robot, camera FLIGHT (no hard cut)
disembark();
assert(pilot.active, 'pilot disembarked');
assert(pilot.hp===100, 'pilot hp full on disembark');
assert(Math.hypot(pilot.x-robot.x,pilot.z-robot.z)<5, 'pilot spawns next to robot');
assert(!!rr_camTrans, 'camera flight starts on disembark');
const cpx=pcam.position.x, cpy=pcam.position.y, cpz=pcam.position.z;
frames(10);
assert(Math.hypot(pcam.position.x-cpx,pcam.position.y-cpy,pcam.position.z-cpz)>0.5, 'camera flies during transition (no snap)');
assert(!!rr_camTrans, 'flight still in progress mid-way');
frames(60);
assert(!rr_camTrans, 'camera flight completes');
assert(pilot.active, 'pilot still active after flight');
// robot is parked while the pilot walks: drive input, robot must not move
const ppx=pilot.x, ppz=pilot.z;
input.jx=1; input.jy=0; frames(20); input.jx=0; input.jy=0;
assert(robot.x===prx && robot.z===prz, 'robot parked while pilot is out');
assert(Math.hypot(pilot.x-ppx,pilot.z-ppz)>0.5, 'pilot walks with stick input');
// pilot cannot walk through buildings
pilot.x=buildings[4].bx1-1; pilot.z=(buildings[4].bz1+buildings[4].bz2)/2;
input.jx=1; input.jy=-1; frames(30); input.jx=0; input.jy=0; // push +x into the building
assert(pilot.x<buildings[4].bx1, 'pilot blocked by building (x='+pilot.x.toFixed(2)+')');

// gun: two hits kill a soldier (soldiers have 2 hp)
pilot.mode='gun'; pilot.fireCd=0; pilot.yaw=0; pilot.pitch=0;
pilot.x=prx; pilot.z=prz; // open street corner, no buildings between
spawnSoldier();
const ps=soldiers[soldiers.length-1];
ps.hp=2; ps.x=pilot.x; ps.z=pilot.z-10; ps.shootCd=99;
pilotShoot();
assert(ps.hp===1 && soldiers.indexOf(ps)>=0, 'first gun hit damages soldier (hp='+ps.hp+')');
pilotShoot();
assert(soldiers.indexOf(ps)===-1, 'second gun hit kills soldier');

// repair torch: damages robot hp back up while aimed at the robot
robot.hp=60; updateHp();
pilot.mode='torch'; pilot.fireCd=0;
// aim at the robot: pilot behind the robot, yaw facing it
pilot.x=robot.x; pilot.z=robot.z-12; pilot.y=0;
pilot.yaw=Math.atan2(-(robot.x-pilot.x), -(robot.z-pilot.z)); pilot.pitch=0.1;
const rhp0=robot.hp;
pilotShoot(); // torch mode -> pilotTorch
assert(robot.hp>rhp0, 'repair torch restores robot hp ('+rhp0+' -> '+robot.hp.toFixed(1)+')');
// torch cannot repair through buildings: robot and pilot on opposite faces
const tb=buildings[4], tcx=(tb.bx1+tb.bx2)/2;
robot.x=tcx; robot.z=tb.bz2+3; robot.mode='ground'; robot.y=0;
pilot.x=tcx; pilot.z=tb.bz1-3; pilot.y=0;
pilot.yaw=Math.atan2(-(robot.x-pilot.x), -(robot.z-pilot.z)); pilot.pitch=0.1;
robot.hp=60; updateHp();
pilotShoot();
assert(robot.hp===60, 'torch blocked by building (hp='+robot.hp.toFixed(1)+')');

// enemy bullets damage the pilot (pilot away from the robot so the robot doesn't absorb it)
pilot.mode='gun'; pilot.active=true; pilot.hp=100;
pilot.x=prx+12; pilot.z=prz; pilot.y=0;
const php0=pilot.hp;
spawnBullet(pilot.x, 2.0+pilot.y, pilot.z, pilot.x, 2.0+pilot.y, pilot.z, 1, 7);
frames(5);
assert(pilot.hp<php0, 'bullet damaged pilot ('+php0+' -> '+pilot.hp+')');

// embark restores pilot hp to full, with a return camera flight
pilot.hp=40;
pilot.x=robot.x+2; pilot.z=robot.z; // within 7 units
tryEmbark();
assert(!pilot.active, 'embarked back into robot');
assert(pilot.hp===100, 'pilot hp refilled on embark');
assert(!!rr_camTrans, 'camera flight starts on embark');
frames(60);
assert(!rr_camTrans, 'embark flight completes');

// pilot death: auto-embark, -250 score, hp refilled
disembark();
assert(!!rr_camTrans, 'camera flight starts on second disembark');
frames(60);
assert(!rr_camTrans, 'second disembark flight completes');
const scBefore=rr_score;
pilot.hp=10;
hurtPilot(25);
assert(!pilot.active && pilot.hp===100, 'pilot death auto-embarks with full hp');
assert(rr_score===scBefore-250, 'pilot down costs 250 score');
assert(!!rr_camTrans, 'camera flight starts on pilot-death embark');
frames(60);
assert(!rr_camTrans, 'pilot-death flight completes');

console.log('\nALL HEADLESS TESTS PASSED');
