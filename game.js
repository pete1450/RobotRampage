'use strict';
/* ============================================================================
   ROBOT RAMPAGE — arcade building-smashing robot mayhem.
   45° isometric, voxel boxes, 1/3-res pixelated render, three.js r147 inlined.
   Desktop: WASD/arrows + SPACE/J punch. Mobile: left thumbstick + PUNCH button.
   ========================================================================== */

// logic.js globals (genCityData, damageFloor, topRow, buildingsLeft, TILE, FLOOR_H)
// are available: logic.js is concatenated before this file.

const clamp = (v,a,b)=>v<a?a:(v>b?b:v);
const lerp = (a,b,t)=>a+(b-a)*t;
const easeIO = k=>k<.5?2*k*k:1-Math.pow(-2*k+2,2)/2; // smooth in-out for camera flights
const PILOT_FOV = 75;      // first-person field of view
const CAMTRANS_DUR = 0.7;  // seconds for the disembark/embark camera flight
const rand = (a,b)=>a+Math.random()*(b-a);
const randi = (a,b)=>a+Math.floor(Math.random()*(b-a+1));
const TAU = Math.PI*2;
const el = id=>document.getElementById(id);
function angLerp(a,b,t){
  let d=(b-a)%TAU;
  if(d>Math.PI)d-=TAU; if(d<-Math.PI)d+=TAU;
  return a+d*t;
}

/* ---------------- audio (tiny synth) ---------------- */
let AC=null, muted=false;
function ac(){
  if(!AC){ try{ AC=new (window.AudioContext||window.webkitAudioContext)(); }catch(e){ AC=null; } }
  if(AC && AC.state==='suspended') AC.resume();
  return AC;
}
function tone(f0,f1,dur,type,vol,delay){
  if(muted) return; const c=ac(); if(!c) return;
  const t=c.currentTime+(delay||0);
  const o=c.createOscillator(), g=c.createGain();
  o.type=type||'square'; o.frequency.setValueAtTime(f0,t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20,f1),t+dur);
  g.gain.setValueAtTime(vol||0.2,t); g.gain.exponentialRampToValueAtTime(0.001,t+dur);
  o.connect(g); g.connect(c.destination); o.start(t); o.stop(t+dur+0.02);
}
function noiseBurst(dur,vol,fc,delay){
  if(muted) return; const c=ac(); if(!c) return;
  const t=c.currentTime+(delay||0);
  const len=Math.floor(c.sampleRate*dur), buf=c.createBuffer(1,len,c.sampleRate), d=buf.getChannelData(0);
  for(let i=0;i<len;i++) d[i]=(Math.random()*2-1)*(1-i/len);
  const s=c.createBufferSource(); s.buffer=buf;
  const f=c.createBiquadFilter(); f.type='lowpass'; f.frequency.value=fc||800;
  const g=c.createGain(); g.gain.setValueAtTime(vol||0.4,t); g.gain.exponentialRampToValueAtTime(0.001,t+dur);
  s.connect(f); f.connect(g); g.connect(c.destination); s.start(t);
}
const sPunch  =()=>{ noiseBurst(0.10,0.45,500); tone(140,55,0.12,'sine',0.5); };
const sWhiff  =()=>{ noiseBurst(0.08,0.15,1200); };
const sCrumble=(big)=>{ noiseBurst(big?0.7:0.4,big?0.7:0.5,260); tone(90,35,big?0.6:0.35,'triangle',0.4); };
const sEat    =()=>{ tone(420,900,0.09,'square',0.22); tone(700,1200,0.08,'square',0.18,0.06); };
const sShoot  =()=>{ tone(880,240,0.09,'square',0.12); };
const sHurt   =()=>{ tone(220,70,0.22,'sawtooth',0.4); noiseBurst(0.15,0.3,600); };
const sClimb  =()=>{ tone(520,760,0.05,'square',0.10); };
const sWave   =()=>{ tone(330,330,0.14,'square',0.25); tone(440,440,0.14,'square',0.25,0.15); tone(660,660,0.25,'square',0.28,0.3); };
const sOver   =()=>{ tone(300,60,0.9,'sawtooth',0.35); noiseBurst(0.8,0.4,300,0.1); };
const sKill   =()=>{ tone(300,120,0.12,'square',0.25); noiseBurst(0.1,0.25,900); };
const sPickup =()=>{ tone(600,1200,0.12,'square',0.25); tone(900,1600,0.10,'square',0.20,0.08); };
const sCharge =()=>{ tone(180,820,0.75,'sawtooth',0.22); };
const sBlast  =()=>{ noiseBurst(0.5,0.6,420); tone(150,38,0.5,'sine',0.5); };
const sPShoot =()=>{ noiseBurst(0.06,0.28,1800); tone(1200,300,0.08,'square',0.2); };
const sTorch  =()=>{ noiseBurst(0.22,0.14,3200); };
const sPilot  =()=>{ tone(500,950,0.16,'square',0.22); tone(750,1300,0.12,'square',0.15,0.1); };

/* ---------------- input ---------------- */
const input = { jx:0, jy:0, punchQueued:false, jumpQueued:false, fireHeld:false };
const keys = {};
function queuePunch(){ input.punchQueued = true; ac(); }
function queueJump(){ input.jumpQueued = true; ac(); }

window.addEventListener('keydown', e=>{
  if(e.repeat) return;
  keys[e.code]=true;
  if(e.code==='Space'||e.code==='KeyJ'){ if(pilot.active) input.fireHeld=true; else queuePunch(); e.preventDefault(); }
  if(e.code==='ShiftLeft'||e.code==='ShiftRight'||e.code==='KeyK'){ queueJump(); e.preventDefault(); }
  if(e.code==='KeyM') toggleMute();
  if(e.code==='KeyP') togglePause();
  if(e.code==='KeyE') useEnergy();
  if(e.code==='KeyF'){ togglePilot(); e.preventDefault(); }
  if(e.code==='KeyV') toggleTorch();
});
window.addEventListener('keyup', e=>{ keys[e.code]=false; if(e.code==='Space'||e.code==='KeyJ') input.fireHeld=false; });

function pollKeys(){
  if(joy.active) return; // touch owns the stick
  if(pilot.active){
    // pilot: WASD moves (arrows steer the view on desktop without pointer lock)
    const l=keys.KeyA?1:0, r=keys.KeyD?1:0, u=keys.KeyW?1:0, d=keys.KeyS?1:0;
    input.jx=r-l; input.jy=u-d;
    return;
  }
  const l=(keys.ArrowLeft||keys.KeyA)?1:0, r=(keys.ArrowRight||keys.KeyD)?1:0;
  const u=(keys.ArrowUp||keys.KeyW)?1:0, d=(keys.ArrowDown||keys.KeyS)?1:0;
  input.jx = r-l; input.jy = u-d;
}

// touch joystick (left half) + punch button
const joy = { active:false, id:null, ox:0, oy:0 };
const joyEl = el('joy'), knobEl = el('knob'), punchBtn = el('punchBtn');
const JR = 55;
function touchPos(t){ return {x:t.clientX, y:t.clientY}; }
document.addEventListener('touchstart', e=>{
  ac();
  for(const t of e.changedTouches){
    if(t.clientX < window.innerWidth*0.55 && !joy.active && t.target!==punchBtn){
      joy.active=true; joy.id=t.identifier; joy.ox=t.clientX; joy.oy=t.clientY;
      joyEl.style.display='block';
      joyEl.style.left=(joy.ox-60)+'px'; joyEl.style.top=(joy.oy-60)+'px';
      knobEl.style.transform='translate(0px,0px)';
      e.preventDefault();
    }
  }
},{passive:false});
document.addEventListener('touchmove', e=>{
  for(const t of e.changedTouches){
    if(joy.active && t.identifier===joy.id){
      let dx=t.clientX-joy.ox, dy=t.clientY-joy.oy;
      const m=Math.hypot(dx,dy);
      if(m>JR){ dx=dx/m*JR; dy=dy/m*JR; }
      knobEl.style.transform='translate('+dx+'px,'+dy+'px)';
      input.jx=dx/JR; input.jy=-dy/JR;
      e.preventDefault();
    }
  }
},{passive:false});
function joyEnd(e){
  for(const t of e.changedTouches){
    if(joy.active && t.identifier===joy.id){
      joy.active=false; joy.id=null; input.jx=0; input.jy=0;
      joyEl.style.display='none';
    }
  }
}
document.addEventListener('touchend', joyEnd);
document.addEventListener('touchcancel', joyEnd);
punchBtn.addEventListener('touchstart', e=>{ if(pilot.active) input.fireHeld=true; else queuePunch(); e.preventDefault(); e.stopPropagation(); },{passive:false});
punchBtn.addEventListener('touchend', ()=>{ input.fireHeld=false; });
punchBtn.addEventListener('mousedown', e=>{ if(pilot.active) input.fireHeld=true; else queuePunch(); e.preventDefault(); });
punchBtn.addEventListener('mouseup', ()=>{ input.fireHeld=false; });
const jumpBtn = el('jumpBtn');
jumpBtn.addEventListener('touchstart', e=>{ queueJump(); e.preventDefault(); e.stopPropagation(); },{passive:false});
jumpBtn.addEventListener('mousedown', e=>{ queueJump(); e.preventDefault(); });
const torchBtn = el('torchBtn');
torchBtn.addEventListener('touchstart', e=>{ toggleTorch(); e.preventDefault(); e.stopPropagation(); },{passive:false});
torchBtn.addEventListener('mousedown', e=>{ toggleTorch(); e.preventDefault(); });
const disembarkBtn = el('disembarkBtn');
disembarkBtn.addEventListener('touchstart', e=>{ togglePilot(); e.preventDefault(); e.stopPropagation(); },{passive:false});
disembarkBtn.addEventListener('mousedown', e=>{ togglePilot(); e.preventDefault(); });
const embarkBtn = el('embarkBtn');
embarkBtn.addEventListener('touchstart', e=>{ tryEmbark(); e.preventDefault(); e.stopPropagation(); },{passive:false});
embarkBtn.addEventListener('mousedown', e=>{ tryEmbark(); e.preventDefault(); });
// pilot look: drag on right half of screen (buttons stopPropagation so they never start a look)
const look = { active:false, id:null, lx:0, ly:0 };
document.addEventListener('touchstart', e=>{
  ac();
  for(const t of e.changedTouches){
    if(pilot.active && !look.active && t.clientX>window.innerWidth*0.45 && t.target===el('cv')){
      look.active=true; look.id=t.identifier; look.lx=t.clientX; look.ly=t.clientY;
      e.preventDefault();
    }
  }
},{passive:false});
document.addEventListener('touchmove', e=>{
  for(const t of e.changedTouches){
    if(look.active && t.identifier===look.id){
      pilot.yaw-=(t.clientX-look.lx)*0.0052;
      pilot.pitch=clamp(pilot.pitch-(t.clientY-look.ly)*0.0052,-1.25,1.25);
      look.lx=t.clientX; look.ly=t.clientY;
      e.preventDefault();
    }
  }
},{passive:false});
function lookEnd(e){
  for(const t of e.changedTouches){
    if(look.active && t.identifier===look.id){ look.active=false; look.id=null; }
  }
}
document.addEventListener('touchend', lookEnd);
document.addEventListener('touchcancel', lookEnd);
// desktop: click canvas for pointer-lock mouse look while piloting
el('cv').addEventListener('click', ()=>{
  if(pilot.active && !('ontouchstart' in window) && document.pointerLockElement!==el('cv') && el('cv').requestPointerLock)
    el('cv').requestPointerLock();
});
document.addEventListener('mousemove', e=>{
  if(pilot.active && document.pointerLockElement===el('cv')){
    pilot.yaw-=e.movementX*0.0026;
    pilot.pitch=clamp(pilot.pitch-e.movementY*0.0026,-1.25,1.25);
  }
});
el('cv').addEventListener('mousedown', e=>{ if(pilot.active && document.pointerLockElement===el('cv')) input.fireHeld=true; });
document.addEventListener('mouseup', ()=>{ if(pilot.active) input.fireHeld=false; });
const energyBtn = el('energyBtn');
function useEnergy(){
  if(robot.energyStored>0 && robot.chargeT<=0 && !robot.dead && !over && !pilot.active){
    robot.energyStored--;
    updateEnergyBtn();
    startEnergyCharge();
  }
}
function updateEnergyBtn(){
  energyBtn.style.display=(robot.energyStored>0)?'flex':'none';
}
energyBtn.addEventListener('touchstart', e=>{ useEnergy(); e.preventDefault(); e.stopPropagation(); },{passive:false});
energyBtn.addEventListener('mousedown', e=>{ useEnergy(); e.preventDefault(); });
el('cv').addEventListener('contextmenu', e=>e.preventDefault());
document.addEventListener('gesturestart', e=>e.preventDefault());

/* ---------------- three.js boot (standard stack) ---------------- */
const PX = 3; // pixel scale: render at 1/3 res, upscale with pixelated CSS
let renderer, scene, camera, camTarget, pcam;
let viewH = 34, viewAspect = 1;
let shakeT = 0, shakeMag = 0;
function addShake(mag, dur){ shakeMag = Math.max(shakeMag, mag); shakeT = Math.max(shakeT, dur); }

const matCache = {};
function mat(color){
  if(!matCache[color]) matCache[color] = new THREE.MeshLambertMaterial({ color });
  return matCache[color];
}
function box(w,h,d,color,x,y,z,parent){
  const m = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), mat(color));
  m.position.set(x,y,z); (parent||scene).add(m); return m;
}

function bootThree(){
  const cv = el('cv');
  renderer = new THREE.WebGLRenderer({ canvas:cv, antialias:false });
  renderer.setPixelRatio(1);
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d1220); // night city sky
  camera = new THREE.OrthographicCamera(-1,1,1,-1,0.1,500);
  camTarget = new THREE.Vector3(0,0,0);
  // first-person pilot camera
  pcam = new THREE.PerspectiveCamera(PILOT_FOV, viewAspect, 0.1, 600);
  pcam.rotation.order = 'YXZ';
  scene.add(pcam);
  buildViewmodel();
  const hemi = new THREE.HemisphereLight(0x8fa8d8, 0x1c2030, 0.85); scene.add(hemi);
  const moon = new THREE.DirectionalLight(0xbfd4ff, 0.55); moon.position.set(-30,60,20); scene.add(moon);
  const warm = new THREE.DirectionalLight(0xffd9a0, 0.35); warm.position.set(40,20,40); scene.add(warm);
  resize(); window.addEventListener('resize', resize);
}
// gun / repair-torch viewmodel parented to the pilot camera
let gunGroup=null, gunTip=null, gunBarrel=null, flameMesh=null;
function buildViewmodel(){
  gunGroup = new THREE.Group();
  box(0.09,0.15,0.5, 0x2a2f3a, 0,0,-0.1, gunGroup);          // body
  gunBarrel = box(0.05,0.05,0.55, 0x8a93a3, 0,0.04,-0.5, gunGroup); // barrel
  box(0.08,0.2,0.1, 0x1c2028, 0,-0.15,0.08, gunGroup);        // grip
  box(0.03,0.03,0.12, 0xffd23f, 0,0.1,-0.05, gunGroup);       // sight
  flameMesh = box(0.14,0.14,0.14, 0xff9a2a, 0,0.04,-0.82, gunGroup); // torch flame
  flameMesh.visible = false;
  gunTip = new THREE.Group(); gunTip.position.set(0,0.04,-0.8); gunGroup.add(gunTip);
  gunGroup.position.set(0.42,-0.38,-0.75);
  pcam.add(gunGroup);
}
function resize(){
  const w = window.innerWidth, h = window.innerHeight;
  viewAspect = w/h;
  renderer.setSize(Math.floor(w/PX), Math.floor(h/PX), false);
  updateFrustum();
  if(pcam){ pcam.aspect=viewAspect; pcam.updateProjectionMatrix(); }
}
function updateFrustum(){
  const hw = viewH*viewAspect/2, hh = viewH/2;
  camera.left=-hw; camera.right=hw; camera.top=hh; camera.bottom=-hh;
  camera.updateProjectionMatrix(); positionCamera();
}
function positionCamera(){
  const d = 120;
  let sx=0, sy=0;
  if(shakeT>0){ sx=rand(-1,1)*shakeMag*shakeT; sy=rand(-1,1)*shakeMag*shakeT; }
  camera.position.set(camTarget.x+d*0.57711+sx, camTarget.y+d*0.57711+sy, camTarget.z+d*0.57711);
  camera.lookAt(camTarget);
}

/* ---------------- city ---------------- */
let city = null, cityGroup = null, buildings = [];
const PALETTE = [0x8a7f70, 0x7d7468, 0x9a8f80, 0x6f6a72, 0x857768]; // concrete tones

function buildCity(wave){
  if(cityGroup){ scene.remove(cityGroup); disposeGroup(cityGroup); }
  buildings = [];
  cityGroup = new THREE.Group(); scene.add(cityGroup);
  city = genCityData(wave, Math.random);
  const span = city.spanUnits, half = span/2;

  // asphalt base
  const asp = new THREE.Mesh(new THREE.PlaneGeometry(span+26, span+26), mat(0x23262e));
  asp.rotation.x = -Math.PI/2; asp.position.y = -0.25; cityGroup.add(asp);
  // block sidewalk slabs + lane dashes
  const BLOCKS=3, BLOCK_T=8, STREET_T=2;
  for(let bi=0; bi<BLOCKS; bi++) for(let bj=0; bj<BLOCKS; bj++){
    const ox = (-span/2 + STREET_T + bi*(BLOCK_T+STREET_T)) * TILE;
    const oz = (-span/2 + STREET_T + bj*(BLOCK_T+STREET_T)) * TILE;
    const slab = box(BLOCK_T*TILE, 0.5, BLOCK_T*TILE, 0x3a3f4a, ox+BLOCK_T*TILE/2, -0.05, oz+BLOCK_T*TILE/2, cityGroup);
    slab.receiveShadow = false;
  }
  // center dashes on streets
  for(let i=0;i<=BLOCKS;i++){
    const c = (-span/2 + i*(BLOCK_T+STREET_T)) * TILE; // street center-ish
    for(let k=0;k<Math.floor(span/4);k++){
      const p = -half + 2 + k*4;
      box(0.25,0.06,1.4,0xd8d84a, c, 0.03, p, cityGroup);
      box(1.4,0.06,0.25,0xd8d84a, p, 0.03, c, cityGroup);
    }
  }

  // buildings
  for(const b of city.buildings){
    buildings.push(b);
    b.dead = false;
    b.vis = { floors: [], cap: null, pile: null, ghostMats: [] };
    const W = b.bx2-b.bx1, D = b.bz2-b.bz1, cx = (b.bx1+b.bx2)/2, cz = (b.bz1+b.bz2)/2;
    const tone = PALETTE[Math.floor(b.hue*PALETTE.length)%PALETTE.length];
    const lit = Math.random()<0.7; // most buildings have some lit windows
    b.vis.tone = tone;
    for(const f of b.floors){
      const g = new THREE.Group(); cityGroup.add(g);
      const y = f.row*FLOOR_H + FLOOR_H/2;
      const slabMat = new THREE.MeshLambertMaterial({ color: tone });
      const slab = new THREE.Mesh(new THREE.BoxGeometry(W, FLOOR_H-0.35, D), slabMat);
      slab.position.set(cx, y, cz); g.add(slab);
      b.vis.ghostMats.push(slabMat);
      // window bands on all 4 faces (+x/+z face the camera, robot climbs all sides)
      const bandMats = [];
      const addBand=(bw,bd,px,py,pz)=>{
        const isLit = lit && Math.random()<0.45;
        const bm = new THREE.MeshLambertMaterial({ color: isLit?0x8a6f2f:0x18242f, emissive: isLit?0xffc63c:0x0a1626, emissiveIntensity: isLit?0.9:0.5 });
        const band = new THREE.Mesh(new THREE.BoxGeometry(bw,1.3,bd), bm);
        band.position.set(px,py,pz); g.add(band); bandMats.push(bm); b.vis.ghostMats.push(bm);
      };
      addBand(W-1.2, 0.25, cx, y, b.bz2+0.06); // +z
      addBand(W-1.2, 0.25, cx, y, b.bz1-0.06); // -z
      addBand(0.25, D-1.2, b.bx2+0.06, y, cz); // +x
      addBand(0.25, D-1.2, b.bx1-0.06, y, cz); // -x
      // dark trim top/bottom of floor
      b.vis.floors[f.row] = { group:g, slabMat, bandMats, baseColor:new THREE.Color(tone), flash:0, cx, cz, y };
    }
    // roof cap (sits on current top floor, moves down as building crumbles)
    const capMat = new THREE.MeshLambertMaterial({color:0x2c2f38});
    const cap = new THREE.Mesh(new THREE.BoxGeometry(W+0.8, 0.7, D+0.8), capMat);
    cap.position.set(cx, (topRow(b)+1)*FLOOR_H-0.35, cz);
    cityGroup.add(cap);
    b.vis.cap = cap; b.vis.ghostMats.push(capMat);
    // rubble pile, hidden until building fully destroyed
    const pile = box(W*0.85, 1.2, D*0.85, 0x4a4a52, cx, 0.4, cz, cityGroup);
    pile.visible = false; b.vis.pile = pile;
  }
  el('bleft').textContent = buildingsLeft(city);
}

// fix: remove the accidental broken mkBand stub lines above by rebuilding cleanly
function disposeGroup(g){
  g.traverse(o=>{ if(o.geometry) o.geometry.dispose(); if(o.material && !Object.values(matCache).includes(o.material)) o.material.dispose && o.material.dispose(); });
}

function setBuildingGhost(b, ghost){
  if(!b.vis) return;
  // Always reapply (no early-return): keeps flag and materials in sync even
  // if a previous call was interrupted. needsUpdate ensures the renderer
  // picks up the transparency change.
  b.vis.ghosted=ghost;
  for(const m of b.vis.ghostMats){
    m.transparent=ghost; m.opacity=ghost?0.3:1; m.depthWrite=!ghost;
    m.needsUpdate=true;
  }
}
// rays from camera to sample points spanning the robot's body: any building
// a ray passes through (before reaching the robot) occludes part of the robot
// -> ghost it at 70%.
function rayBoxT(ox,oy,oz,dx,dy,dz,maxD,b,h){  let t0=0,t1=maxD,t,ta,tb;
  if(Math.abs(dx)<1e-9){ if(ox<b.bx1||ox>b.bx2) return -1; }
  else{ ta=(b.bx1-ox)/dx; tb=(b.bx2-ox)/dx; if(ta>tb){t=ta;ta=tb;tb=t;} if(ta>t0)t0=ta; if(tb<t1)t1=tb; if(t0>t1)return -1; }
  if(Math.abs(dy)<1e-9){ if(oy<0||oy>h) return -1; }
  else{ ta=(0-oy)/dy; tb=(h-oy)/dy; if(ta>tb){t=ta;ta=tb;tb=t;} if(ta>t0)t0=ta; if(tb<t1)t1=tb; if(t0>t1)return -1; }
  if(Math.abs(dz)<1e-9){ if(oz<b.bz1||oz>b.bz2) return -1; }
  else{ ta=(b.bz1-oz)/dz; tb=(b.bz2-oz)/dz; if(ta>tb){t=ta;ta=tb;tb=t;} if(ta>t0)t0=ta; if(tb<t1)t1=tb; if(t0>t1)return -1; }
  return t0;
}
function updateOcclusion(){
  const cp=camera.position;
  // Orthographic camera: occlusion rays start at sample points spanning the
  // robot's body and run PARALLEL to the fixed camera view axis (toward the
  // camera). Any building a ray passes through before reaching the camera
  // occludes part of the robot -> ghost it at 70%.
  // (Perspective-style rays converging on camera.position disagree with what
  // the iso camera actually draws away from screen center, so some buildings
  // failed to ghost near edges, during camera lag, or while climbing.)
  let vx=cp.x-camTarget.x, vy=cp.y-camTarget.y, vz=cp.z-camTarget.z;
  const vl=Math.sqrt(vx*vx+vy*vy+vz*vz)||1;
  vx/=vl; vy/=vl; vz/=vl;
  // Dense 3D grid over the robot's body box (5 x-positions * 5 heights * 3 z-
  // positions = 75 rays). A sparse handful of sample points is not enough: a
  // building can cover the robot on screen while threading between them.
  const rbx=[-2.5,-1.25,0,1.25,2.5], rby=[0.5,2.5,4.5,6.5,8.5], rbz=[-1,0,1];
  for(const b of buildings){
    if(b.dead){ setBuildingGhost(b,false); continue; }
    const h=(topRow(b)+1)*FLOOR_H;
    if(h<=0){ setBuildingGhost(b,false); continue; }
    let hit=false;
    for(let ix=0;ix<5&&!hit;ix++) for(let iy=0;iy<5&&!hit;iy++) for(let iz=0;iz<3&&!hit;iz++){
      const px=robot.x+rbx[ix], py=robot.y+rby[iy], pz=robot.z+rbz[iz];
      // distance from the sample point to the camera along the view axis
      const tCam=(cp.x-px)*vx+(cp.y-py)*vy+(cp.z-pz)*vz;
      const t=rayBoxT(px,py,pz,vx,vy,vz,tCam,b,h);
      if(t>=0 && t<tCam-1.5){ hit=true; }
    }
    setBuildingGhost(b, hit);
  }
  // Debug readout: which buildings the occlusion logic thinks are ghosted.
}

/* ---------------- robot ---------------- */
const robot = {
  x:0, z:0, y:0, angle:0, mode:'ground', hp:100,
  vx:0, vy:0, vz:0, noAttach:null, noAttachT:0, chargeT:0, energyStored:0,
  // climb state
  cb:null, cf:0, cs:0, crow:0, climbCd:0, mountCd:0,
  punchT:1, punchCd:0, walkT:0, moving:false,
  group:null, parts:{}, dead:false, deadT:0,
};
const ROBOT_R = 1.3;

function buildRobot(){
  const g = new THREE.Group(); scene.add(g);
  const P = robot.parts;
  const gun = 0x565c68, red = 0xd63c1e, dark = 0x33363e, orange = 0xff8c2a;
  P.legL = box(1,1.8,1.1, gun, -0.62, 0.9, 0, g);
  P.legR = box(1,1.8,1.1, gun,  0.62, 0.9, 0, g);
  P.footL = box(1.15,0.5,1.5, dark, -0.62, 0.25, 0.15, g);
  P.footR = box(1.15,0.5,1.5, dark,  0.62, 0.25, 0.15, g);
  P.torso = box(2.7,2.2,1.9, red, 0, 2.9, 0, g);
  P.belt = box(2.85,0.5,2.0, dark, 0, 1.95, 0, g);
  P.padL = box(1.25,0.9,1.5, orange, -1.85, 3.9, 0, g);
  P.padR = box(1.25,0.9,1.5, orange,  1.85, 3.9, 0, g);
  P.armL = new THREE.Group(); P.armL.position.set(-1.85,3.5,0); g.add(P.armL);
  P.armR = new THREE.Group(); P.armR.position.set( 1.85,3.5,0); g.add(P.armR);
  const uaL = box(0.85,1.5,0.95, gun, 0,-0.7,0, P.armL);
  const uaR = box(0.85,1.5,0.95, gun, 0,-0.7,0, P.armR);
  P.fistL = box(1.15,1.1,1.15, dark, 0,-1.9,0, P.armL);
  P.fistR = box(1.15,1.1,1.15, dark, 0,-1.9,0, P.armR);
  P.head = box(1.6,1.4,1.6, gun, 0, 4.75, 0, g);
  const eye = new THREE.Mesh(new THREE.BoxGeometry(1.25,0.4,0.15),
    new THREE.MeshLambertMaterial({ color:0x0a2a33, emissive:0x37e6ff, emissiveIntensity:1 }));
  eye.position.set(0,4.85,0.82); g.add(eye); P.eye = eye;
  P.antenna = box(0.12,1.1,0.12, dark, 0.5, 5.9, 0, g);
  const tip = new THREE.Mesh(new THREE.BoxGeometry(0.3,0.3,0.3),
    new THREE.MeshLambertMaterial({ color:0x330000, emissive:0xff2222, emissiveIntensity:1 }));
  tip.position.set(0.5,6.5,0); g.add(tip); P.tip = tip;
  g.scale.set(1, 1.5, 1); // 50% taller
  robot.group = g;
}

// face helpers: 0:+z 1:+x 2:-z 3:-x  (faces 0,1 face the camera)
const FACE_N = [[0,1],[1,0],[0,-1],[-1,0]];
const FACE_T = [[1,0],[0,-1],[-1,0],[0,1]]; // tangent d(pos)/ds
function faceMaxS(b,f){ return (f===0||f===2) ? (b.bx2-b.bx1) : (b.bz2-b.bz1); }
function facePos(b,f,s,out){
  const OFF = 1.15;
  if(f===0){ out.x=b.bx1+s; out.z=b.bz2+OFF; }
  else if(f===1){ out.x=b.bx2+OFF; out.z=b.bz2-s; }
  else if(f===2){ out.x=b.bx2-s; out.z=b.bz1-OFF; }
  else { out.x=b.bx1-OFF; out.z=b.bz1+s; }
  return out;
}
const _fp = { x:0, z:0 };

function startClimb(b, f, x, z, row){
  robot.mode='climb'; robot.cb=b; robot.cf=f;
  // project position onto the face to get s
  let s;
  if(f===0) s=x-b.bx1; else if(f===1) s=b.bz2-z; else if(f===2) s=b.bx2-x; else s=z-b.bz1;
  robot.cs = clamp(s, 0, faceMaxS(b,f));
  robot.crow = row||0; robot.climbCd = 0; robot.punchT = 1;
  robot.mountCd = 0.45; // grace: held stick-down won't instantly dismount
  robot.vx=robot.vy=robot.vz=0; robot.noAttach=null; robot.noAttachT=0;
  // building ghosting is handled by updateOcclusion() (camera ray test)
}
function stopClimbToGround(x, z){
  robot.mode='ground'; robot.cb=null; robot.x=x; robot.z=z; robot.y=0;
  robot.vx=robot.vy=robot.vz=0; robot.noAttach=null; robot.noAttachT=0;
}

// circle vs building rects; returns deepest hit {b,f,px,pz} or null
function collideBuildings(x, z, r){
  let best=null;
  for(const b of buildings){
    if(b.dead) continue;
    const cx=clamp(x,b.bx1,b.bx2), cz=clamp(z,b.bz1,b.bz2);
    let dx=x-cx, dz=z-cz;
    const d2=dx*dx+dz*dz;
    if(d2 >= r*r) continue;
    let f, px, pz, pen;
    if(d2 > 1e-6){
      const d=Math.sqrt(d2); pen=r-d; dx/=d; dz/=d;
      // face = dominant axis of push dir (outward normal)
      if(Math.abs(dx)>Math.abs(dz)) f = dx>0?1:3; else f = dz>0?0:2;
      px=cx; pz=cz;
    } else {
      // center inside: push out along min-penetration axis
      const pl=x-b.bx1, pr=b.bx2-x, pt=z-b.bz1, pb=b.bz2-z;
      const m=Math.min(pl,pr,pt,pb);
      if(m===pl){ f=3; px=b.bx1; pz=z; pen=r+pl; }
      else if(m===pr){ f=1; px=b.bx2; pz=z; pen=r+pr; }
      else if(m===pt){ f=2; px=x; pz=b.bz1; pen=r+pt; }
      else { f=0; px=x; pz=b.bz2; pen=r+pb; }
    }
    if(!best || pen>best.pen) best={b,f,px,pz,pen};
  }
  return best;
}

function updateGround(dt,wx,wz){
  const r=robot;
  const SPD=11;
  let nx=r.x+wx*SPD*dt, nz=r.z+wz*SPD*dt;
  const half=city.spanUnits/2+3;
  nx=clamp(nx,-half,half); nz=clamp(nz,-half,half);
  const hit=collideBuildings(nx,nz,ROBOT_R);
  if(hit){
    const cx=clamp(nx,hit.b.bx1,hit.b.bx2), cz=clamp(nz,hit.b.bz1,hit.b.bz2);
    let dx=nx-cx, dz=nz-cz; const d=Math.hypot(dx,dz);
    if(d>1e-4){ nx=cx+dx/d*ROBOT_R; nz=cz+dz/d*ROBOT_R; }
    // pushing into the building -> start climbing
    const inw = wx*-FACE_N[hit.f][0] + wz*-FACE_N[hit.f][1]; // input vs inward normal
    if(inw>0.25 && topRow(hit.b)>=0 && r.moving){
      r.x=nx; r.z=nz; startClimb(hit.b, hit.f, nx, nz, 0);
      return;
    }
    r.x=nx; r.z=nz;
  } else { r.x=nx; r.z=nz; }
  r.y=0;
  if(r.moving) r.angle=angLerp(r.angle, Math.atan2(wx,wz), Math.min(1,dt*10));
  r.walkT+=dt*(r.moving?1:0);
  const sw=r.moving?Math.sin(r.walkT*11)*0.45:0;
  r.parts.legL.rotation.x=sw; r.parts.legR.rotation.x=-sw;
  r.parts.armL.rotation.x=-sw*0.7; r.parts.armR.rotation.x=sw*0.7;
  r.group.position.set(r.x, r.y+Math.abs(Math.sin(r.walkT*11))*0.25*(r.moving?1:0), r.z);
  r.group.rotation.y=r.angle;
}

function updateClimb(dt,wx,wz){
  const r=robot, b=r.cb;
  if(!b || b.dead || topRow(b)<0){ // building vanished under us
    facePos(b||{bx1:r.x,bx2:r.x,bz1:r.z,bz2:r.z}, r.cf, r.cs, _fp);
    stopClimbToGround(_fp.x - FACE_N[r.cf][0]*2.5, _fp.z - FACE_N[r.cf][1]*2.5);
    return;
  }
  // climb intent is screen-space: stick up = climb up, left/right = move along face
  const vv = input.jy;
  const top=topRow(b);
  if(r.climbCd<=0){
    if(vv>0.5){
      if(r.crow<top){ r.crow++; r.climbCd=0.24; sClimb(); }
      else {
        // mount the roof
        r.mode='top';
        r.x=clamp(r.x,b.bx1+1.2,b.bx2-1.2); r.z=clamp(r.z,b.bz1+1.2,b.bz2-1.2);
        r.y=(top+1)*FLOOR_H; sClimb();
        return;
      }
    }
    else if(vv<-0.5){
      if(r.crow>0){ r.crow--; r.climbCd=0.24; sClimb(); }
      else if(r.mountCd<=0){ // climb down off the building
        facePos(b,r.cf,r.cs,_fp);
        stopClimbToGround(_fp.x+FACE_N[r.cf][0]*2.5, _fp.z+FACE_N[r.cf][1]*2.5);
        return;
      }
    }
  }
  // lateral move along face (project input onto tangent)
  const tx=FACE_T[r.cf][0], tz=FACE_T[r.cf][1];
  const ds=(wx*tx+wz*tz)*9*dt;
  let maxS=faceMaxS(b,r.cf);
  r.cs+=ds;
  if(r.cs>maxS){ r.cf=(r.cf+1)%4; r.cs-=maxS; const nm=faceMaxS(b,r.cf); if(r.cs>nm) r.cs=nm; }
  else if(r.cs<0){ r.cf=(r.cf+3)%4; const nm=faceMaxS(b,r.cf); r.cs+=nm; if(r.cs<0) r.cs=0; }
  facePos(b,r.cf,r.cs,_fp);
  const targetY=r.crow*FLOOR_H;
  r.x=_fp.x; r.z=_fp.z; r.y=lerp(r.y,targetY,Math.min(1,dt*10));
  const n=FACE_N[r.cf];
  r.angle=angLerp(r.angle, Math.atan2(-n[0],-n[1]), Math.min(1,dt*12));
  // climb pose: arms up, legs dangle
  r.parts.armL.rotation.x=-2.5; r.parts.armR.rotation.x=-2.5;
  r.parts.legL.rotation.x=Math.sin(performance.now()*0.008)*0.3;
  r.parts.legR.rotation.x=-Math.sin(performance.now()*0.008)*0.3;
  r.group.position.set(r.x, r.y, r.z);
  r.group.rotation.y=r.angle;
}

function updateAir(dt){
  const r=robot;
  const prevY=r.y;
  r.vy-=26*dt;
  // slight air steering
  const s2=Math.SQRT1_2;
  const wx=(input.jx-input.jy)*s2, wz=(-input.jx-input.jy)*s2;
  r.vx+=wx*6*dt; r.vz+=wz*6*dt;
  const sp=Math.hypot(r.vx,r.vz);
  if(sp>14){ r.vx*=14/sp; r.vz*=14/sp; }
  r.x+=r.vx*dt; r.z+=r.vz*dt; r.y+=r.vy*dt;
  const half=city.spanUnits/2+3;
  r.x=clamp(r.x,-half,half); r.z=clamp(r.z,-half,half);
  // land on a roof
  if(r.vy<=0){
    for(const b of buildings){
      if(b.dead) continue;
      const topY=(topRow(b)+1)*FLOOR_H;
      if(topY<=0) continue;
      if(r.x>b.bx1+1&&r.x<b.bx2-1&&r.z>b.bz1+1&&r.z<b.bz2-1&&prevY>=topY-0.05&&r.y<=topY){
        r.mode='top'; r.cb=b; r.y=topY; r.vx=r.vy=r.vz=0; r.noAttach=null;
        burst(r.x,r.y+0.3,r.z,0x9a938a,8,5,0.5,0.6,1.2);
        sClimb();
        break;
      }
    }
    if(r.mode!=='air'){ r.group.position.set(r.x,r.y,r.z); return; }
  }
  // attach to a building side on the way down (only when below its roofline)
  if(r.y>0.6){
    const hit=collideBuildings(r.x,r.z,ROBOT_R);
    if(hit && !(hit.b===r.noAttach&&r.noAttachT>0)){
      const top=topRow(hit.b);
      const topYb=(top+1)*FLOOR_H;
      if(top>=0 && r.vy<1 && r.y<topYb-0.5){
        startClimb(hit.b,hit.f,r.x,r.z,clamp(Math.floor(r.y/FLOOR_H),0,top));
        r.noAttach=null;
        r.group.position.set(r.x,r.y,r.z);
        return;
      }
      if(r.y<topYb){
        // bonk: slide along the wall instead (only when beside the building,
        // never when falling above its roofline)
        const cx=clamp(r.x,hit.b.bx1,hit.b.bx2), cz=clamp(r.z,hit.b.bz1,hit.b.bz2);
        let dx=r.x-cx, dz=r.z-cz; const d=Math.hypot(dx,dz)||1;
        r.x=cx+dx/d*ROBOT_R; r.z=cz+dz/d*ROBOT_R;
        const vn=r.vx*dx/d+r.vz*dz/d;
        if(vn<0){ r.vx-=dx/d*vn; r.vz-=dz/d*vn; }
      }
    }
  }
  if(r.y<=0){ // ground landing
    r.y=0; r.mode='ground'; r.vx=r.vy=r.vz=0; r.noAttach=null;
    burst(r.x,0.4,r.z,0x9a938a,8,5,0.5,0.6,1.2);
  }
  if(Math.hypot(r.vx,r.vz)>1) r.angle=angLerp(r.angle,Math.atan2(r.vx,r.vz),Math.min(1,dt*8));
  r.group.position.set(r.x,r.y,r.z);
  r.group.rotation.y=r.angle;
}

function updateTop(dt,wx,wz){
  const r=robot, b=r.cb;
  if(!b||b.dead){ // roof gone under us
    r.mode='air'; r.vy=0; r.vx=0; r.vz=0; r.cb=null; r.noAttach=b; r.noAttachT=0.35;
    return;
  }
  const topY=(topRow(b)+1)*FLOOR_H;
  r.y=lerp(r.y,topY,Math.min(1,dt*12));
  const SPD=8;
  const nx=r.x+wx*SPD*dt, nz=r.z+wz*SPD*dt;
  const walkedOff=nx<b.bx1+1||nx>b.bx2-1||nz<b.bz1+1||nz>b.bz2-1;
  if(walkedOff){
    // walked off the edge -> fall
    r.mode='air'; r.vy=0; r.vx=wx*SPD; r.vz=wz*SPD; r.noAttach=b; r.noAttachT=0.3;
    return;
  }
  r.x=nx; r.z=nz;
  if(r.moving) r.angle=angLerp(r.angle, Math.atan2(wx,wz), Math.min(1,dt*10));
  r.walkT+=dt*(r.moving?1:0);
  const sw=r.moving?Math.sin(r.walkT*11)*0.45:0;
  r.parts.legL.rotation.x=sw; r.parts.legR.rotation.x=-sw;
  r.parts.armL.rotation.x=-sw*0.7; r.parts.armR.rotation.x=sw*0.7;
  r.group.position.set(r.x,r.y,r.z);
  r.group.rotation.y=r.angle;
}

function doJump(){
  const r=robot;
  if(r.dead||r.mode==='air') return;
  const s2=Math.SQRT1_2;
  const wx=(input.jx-input.jy)*s2, wz=(-input.jx-input.jy)*s2;
  if(r.mode==='climb'){
    const b=r.cb, n=FACE_N[r.cf];
    facePos(b,r.cf,r.cs,_fp);
    r.x=_fp.x; r.z=_fp.z;
    r.mode='air';
    r.vx=n[0]*9+wx*5; r.vz=n[1]*9+wz*5; r.vy=13.5;
    r.noAttach=b; r.noAttachT=0.45; r.cb=null;
  } else if(r.mode==='top'){
    const b=r.cb; r.cb=null; r.mode='air';
    const sp=Math.hypot(wx,wz);
    if(sp>0.15){ r.vx=wx/sp*12; r.vz=wz/sp*12; }
    else { r.vx=Math.sin(r.angle)*6; r.vz=Math.cos(r.angle)*6; }
    r.vy=14; r.noAttach=b; r.noAttachT=0.3;
  } else { // ground
    const sp=Math.hypot(wx,wz);
    if(sp>0.15){ r.vx=wx/sp*11; r.vz=wz/sp*11; }
    else { r.vx=Math.sin(r.angle)*5; r.vz=Math.cos(r.angle)*5; }
    r.vy=14.5; r.mode='air'; r.noAttach=null; r.noAttachT=0;
  }
  burst(r.x,r.y+0.5,r.z,0x9a938a,6,4,0.4,0.5,1);
  tone(280,620,0.14,'square',0.16);
}

function updateRobot(dt){
  const r=robot;
  if(pilot.active||camTrans) return; // parked while the pilot is out on foot
  if(r.dead){ r.deadT+=dt; r.group.rotation.x=Math.min(Math.PI/2,r.deadT*2); return; }
  // Energy sphere charge: crouch, brace, then release
  if(r.chargeT>0){
    r.chargeT-=dt;
    r.group.scale.y=0.85; // crouch
    // spiced-up charge: particles spiral inward, intensifying as release nears
    const inten=1.6-r.chargeT; // 0.7 -> 1.6
    for(let k=0;k<3;k++){
      const a=Math.random()*TAU, rr=3+Math.random()*4;
      burst(r.x+Math.cos(a)*rr, r.y+1+Math.random()*6, r.z+Math.sin(a)*rr,
        k?0x4de1ff:0xffffff, 1, 10*inten, 0.35, 0, 0.9);
    }
    if(Math.random()<0.3*inten) burst(r.x,r.y+7,r.z,0xbff4ff,4,5,0.4,0,1.0);
    if(r.chargeT<=0){
      r.group.scale.y=1.5; // back to full height
      releaseEnergySphere();
    }
    // skip normal movement while charging (brace)
    updateOcclusion();
    return;
  }
  pollKeys();
  // iso mapping: screen-right=(1,0,-1)/√2, screen-up=(-1,0,-1)/√2
  const s2=Math.SQRT1_2;
  const wx=(input.jx-input.jy)*s2, wz=(-input.jx-input.jy)*s2;
  r.moving=Math.hypot(input.jx,input.jy)>0.15;
  if(r.punchCd>0) r.punchCd-=dt;
  if(r.punchT<1) r.punchT=Math.min(1,r.punchT+dt/0.32);
  if(r.climbCd>0) r.climbCd-=dt;
  if(r.mountCd>0) r.mountCd-=dt;
  if(r.noAttachT>0) r.noAttachT-=dt;

  if(input.punchQueued){ input.punchQueued=false; doPunch(); }
  if(input.jumpQueued){ input.jumpQueued=false; doJump(); }

  if(r.mode==='ground') updateGround(dt,wx,wz);
  else if(r.mode==='climb') updateClimb(dt,wx,wz);
  else if(r.mode==='air') updateAir(dt);
  else if(r.mode==='top') updateTop(dt,wx,wz);

  // punch arm anim (right arm extends forward)
  if(r.punchT<1){
    const e=Math.sin(r.punchT*Math.PI);
    r.parts.armR.rotation.x=-1.4;
    r.parts.fistR.position.z=e*2.6;
  } else {
    r.parts.fistR.position.z=0;
  }
  // antenna blink
  r.parts.tip.material.emissiveIntensity=(Math.floor(performance.now()/400)%2)?1:0.15;
}

/* ---------------- pilot: disembark to first-person ---------------- */
const pilot = { active:false, x:0, z:0, y:0, vy:0, yaw:0, pitch:0, hp:100, mode:'gun', fireCd:0, torchMsgCd:0 };
const EYE = 2.7; // pilot eye height
// camera flight between the robot iso view and the pilot first-person view
let camTrans=null, _ctV=null, _ctTgt=null;
const tracers = [];

function pilotAimDir(){
  const cp=Math.cos(pilot.pitch);
  return { x:-Math.sin(pilot.yaw)*cp, y:Math.sin(pilot.pitch), z:-Math.cos(pilot.yaw)*cp };
}
function eyePose(){
  const dir=pilotAimDir();
  return {
    pos:{x:pilot.x, y:EYE+pilot.y, z:pilot.z},
    tgt:{x:pilot.x+dir.x*12, y:EYE+pilot.y+dir.y*12, z:pilot.z+dir.z*12},
  };
}
// Fly the camera between the iso view and the pilot's eye instead of a hard cut.
// dir 'out': iso -> pilot eye. dir 'in': current pcam pose -> iso view.
function startCamTrans(dir){
  const eye=eyePose();
  let fp, ft;
  if(dir==='out'){
    fp={x:camera.position.x, y:camera.position.y, z:camera.position.z};
    ft={x:camTarget.x, y:camTarget.y, z:camTarget.z};
  } else {
    fp={x:pcam.position.x, y:pcam.position.y, z:pcam.position.z};
    ft=_ctTgt?{x:_ctTgt.x, y:_ctTgt.y, z:_ctTgt.z}:eye.tgt;
  }
  const iso={x:camera.position.x, y:camera.position.y, z:camera.position.z};
  const isoT={x:camTarget.x, y:camTarget.y, z:camTarget.z};
  camTrans={ t:0, dur:CAMTRANS_DUR,
    fp, ft,
    tp: dir==='out'?eye.pos:iso, tt: dir==='out'?eye.tgt:isoT,
    ff: dir==='out'?18:PILOT_FOV, tf: dir==='out'?PILOT_FOV:18 };
  _ctTgt={x:ft.x, y:ft.y, z:ft.z};
}
function updateCamTrans(dt){
  const c=camTrans; c.t+=dt;
  const k=easeIO(Math.min(1, c.t/c.dur));
  pcam.position.set(lerp(c.fp.x,c.tp.x,k), lerp(c.fp.y,c.tp.y,k), lerp(c.fp.z,c.tp.z,k));
  if(!_ctV) _ctV=new THREE.Vector3();
  _ctV.set(lerp(c.ft.x,c.tt.x,k), lerp(c.ft.y,c.tt.y,k), lerp(c.ft.z,c.tt.z,k));
  pcam.lookAt(_ctV);
  _ctTgt={x:_ctV.x, y:_ctV.y, z:_ctV.z};
  pcam.fov=lerp(c.ff,c.tf,k); pcam.updateProjectionMatrix();
  if(c.t>=c.dur) camTrans=null;
}
function togglePilot(){
  if(over||paused||camTrans) return;
  if(pilot.active) tryEmbark(); else disembark();
}
function disembark(){
  const r=robot;
  if(r.dead||over||r.mode!=='ground'||r.chargeT>0||camTrans) return;
  pilot.active=true;
  pilot.x=r.x+3.4; pilot.z=r.z+0.5; pilot.y=0; pilot.vy=0; pilot.fireCd=0;
  pilot.yaw=Math.atan2(-(r.x-pilot.x), -(r.z-pilot.z)); // face the robot
  pilot.pitch=0.08;
  for(const b of buildings) setBuildingGhost(b,false); // solid buildings in first person
  setPilotUI(true); updatePilotHp();
  startCamTrans('out');
  sPilot();
  floatText(r.x,r.y+9,r.z,'PILOT OUT','#9fe8ff');
  if(!('ontouchstart' in window)) banner('CLICK TO LOOK AROUND — F TO RE-EMBARK',2600);
}
function tryEmbark(){
  if(!pilot.active||camTrans) return;
  if(Math.hypot(pilot.x-robot.x,pilot.z-robot.z)>7){ banner('GET CLOSER TO THE ROBOT',1200); return; }
  embark();
}
function embark(){
  pilot.active=false;
  pilot.hp=100; updatePilotHp(); // health bar refills whenever entering the robot
  input.fireHeld=false; look.active=false;
  if(document.exitPointerLock && document.pointerLockElement) document.exitPointerLock();
  setPilotUI(false);
  startCamTrans('in');
  sPilot();
}
function toggleTorch(){
  if(!pilot.active||over) return;
  pilot.mode=pilot.mode==='gun'?'torch':'gun';
  const em=pilot.mode==='gun'?'🔫':'🔥';
  el('torchBtn').textContent=em;
  punchBtn.textContent=em;
  if(gunBarrel) gunBarrel.material=mat(pilot.mode==='gun'?0x8a93a3:0xc77e1e);
  if(flameMesh) flameMesh.visible=pilot.mode==='torch';
  sPilot();
}
function setPilotUI(on){
  el('crosshair').style.display=on?'block':'none';
  el('pilotHpwrap').style.display=on?'block':'none';
  el('torchBtn').style.display=on?'flex':'none';
  punchBtn.textContent=on?(pilot.mode==='gun'?'🔫':'🔥'):'👊';
  if(on) el('energyBtn').style.display='none'; else updateEnergyBtn();
  updatePilotButtons();
}
function updatePilotHp(){ el('pilothpbar').style.width=pilot.hp+'%'; }
function updatePilotButtons(){
  const r=robot;
  el('disembarkBtn').style.display=(!pilot.active&&!over&&!r.dead&&r.mode==='ground')?'flex':'none';
  el('embarkBtn').style.display=(pilot.active&&Math.hypot(pilot.x-r.x,pilot.z-r.z)<7)?'block':'none';
}
function hurtPilot(dmg){
  const p=pilot;
  if(!p.active||over) return;
  p.hp-=dmg; updatePilotHp(); sHurt();
  el('dmg').style.opacity=1;
  setTimeout(()=>{ el('dmg').style.opacity=0; },180);
  if(p.hp<=0){ embark(); addScore(-250); banner('PILOT DOWN!',1600); }
}
function killSoldier(s){
  const i=soldiers.indexOf(s);
  if(i>=0){ removeEnt(soldiers[i]); soldiers.splice(i,1); }
  burst(s.x,1.5,s.z,0x3f6b34,12,7,0.7,1,1.2);
  addScore(30); floatText(s.x,3,s.z,'+30','#ffd75e'); sKill();
}
function damageSoldier(s,dmg){
  s.hp-=dmg;
  if(s.hp<=0){ killSoldier(s); return; }
  burst(s.x,1.4,s.z,0xff5a4d,6,6,0.4,1,0.9); sKill();
}
function damageHeli(h,dmg){
  const p=h.g.position;
  h.hp-=dmg;
  burst(p.x,p.y,p.z,0xff9a4d,10,8,0.6,1,1.2); sKill();
  if(h.hp<=0){
    const i=helis.indexOf(h);
    if(i>=0){ removeEnt(helis[i]); helis.splice(i,1); }
    burst(p.x,p.y,p.z,0xff5a2a,26,12,1.2,1,2);
    burst(p.x,p.y,p.z,0x333333,16,8,1.4,0.5,2);
    addScore(150); floatText(p.x,p.y,p.z,'+150 CHOPPA!','#ff9a4d');
    addShake(2,0.4);
  }
}
// distance along ray before a living building blocks it (rayBoxT: -1 = miss)
function rayBuildingDist(ox,oy,oz,dx,dy,dz,maxD){
  let best=maxD;
  for(const b of buildings){
    if(b.dead) continue;
    const tr=topRow(b); if(tr<0) continue;
    const t=rayBoxT(ox,oy,oz,dx,dy,dz,best,b,(tr+1)*FLOOR_H);
    if(t>=0&&t<best) best=t;
  }
  return best;
}
function addTracer(eye,dir,len){
  const g=new THREE.Mesh(new THREE.BoxGeometry(0.07,0.07,1),
    new THREE.MeshBasicMaterial({color:0xfff2b0,transparent:true,opacity:0.9,depthWrite:false}));
  g.position.set(eye.x+dir.x*len/2, eye.y+dir.y*len/2, eye.z+dir.z*len/2);
  g.lookAt(eye.x+dir.x*len, eye.y+dir.y*len, eye.z+dir.z*len);
  g.scale.z=len;
  scene.add(g); tracers.push({m:g,t:0});
}
function updateTracers(dt){
  for(let i=tracers.length-1;i>=0;i--){
    const tr=tracers[i]; tr.t+=dt;
    if(tr.t>0.07){ scene.remove(tr.m); tr.m.geometry.dispose(); tr.m.material.dispose(); tracers.splice(i,1); continue; }
    tr.m.material.opacity=0.9*(1-tr.t/0.07);
  }
}
function pilotShoot(){
  const p=pilot, eye={x:p.x, y:EYE+p.y, z:p.z};
  const dir=pilotAimDir();
  if(p.mode==='gun'){
    sPShoot();
    burst(eye.x+dir.x*1.1, eye.y+dir.y*1.1-0.15, eye.z+dir.z*1.1, 0xffe14d,4,3,0.12,0,0.5);
    let best=null, bestD=60;
    for(const s of soldiers){
      const ox=s.x-eye.x, oy=1.2-eye.y, oz=s.z-eye.z;
      const t=ox*dir.x+oy*dir.y+oz*dir.z;
      if(t<1||t>bestD) continue;
      const px=eye.x+dir.x*t-s.x, py=eye.y+dir.y*t-1.2, pz=eye.z+dir.z*t-s.z;
      if(px*px+py*py+pz*pz<2.6){ best={k:0,e:s}; bestD=t; }
    }
    for(const h of helis){
      const hp=h.g.position;
      const ox=hp.x-eye.x, oy=hp.y-eye.y, oz=hp.z-eye.z;
      const t=ox*dir.x+oy*dir.y+oz*dir.z;
      if(t<1||t>bestD) continue;
      const px=eye.x+dir.x*t-hp.x, py=eye.y+dir.y*t-hp.y, pz=eye.z+dir.z*t-hp.z;
      if(px*px+py*py+pz*pz<7){ best={k:1,e:h}; bestD=t; }
    }
    const bd=rayBuildingDist(eye.x,eye.y,eye.z,dir.x,dir.y,dir.z,Math.min(bestD,60));
    addTracer(eye,dir,Math.min(bestD,bd));
    if(best&&bestD<=bd){
      if(best.k===0) damageSoldier(best.e,1); else damageHeli(best.e,1);
    }
  } else {
    pilotTorch(eye,dir);
  }
}
function pilotTorch(eye,dir){
  const p=pilot, r=robot;
  // repair the robot?
  const dx=r.x-eye.x, dy=(r.y+3.75)-eye.y, dz=r.z-eye.z;
  const dist=Math.sqrt(dx*dx+dy*dy+dz*dz)||0.001;
  const dot=(dx*dir.x+dy*dir.y+dz*dir.z)/dist;
  // line of sight: buildings block the repair beam (same rule as the gun)
  const blocked=rayBuildingDist(eye.x,eye.y,eye.z,dir.x,dir.y,dir.z,dist)<dist-0.01;
  if(dist<34&&dot>0.986&&!blocked){
    if(r.hp<100){ r.hp=Math.min(100,r.hp+1.8); updateHp(); }
    for(let k=0;k<3;k++){
      const t=Math.random();
      burst(eye.x+(r.x-eye.x)*t, eye.y+(r.y+3.75-eye.y)*t, eye.z+(r.z-eye.z)*t,
        k?0xff9a2a:0xffe14d, 1, 1.5, 0.3, 0, 0.7);
    }
    if(Math.random()<0.3) sTorch();
    p.torchMsgCd-=0.08;
    if(p.torchMsgCd<=0){ floatText(r.x,r.y+8,r.z,'REPAIRING','#ff9a2a'); p.torchMsgCd=1.4; }
    return;
  }
  // otherwise burn soldiers right in front
  for(const s of soldiers){
    const sx=s.x-eye.x, sy=1.2-eye.y, sz=s.z-eye.z;
    const sd=Math.sqrt(sx*sx+sy*sy+sz*sz)||0.001;
    if(sd<14&&(sx*dir.x+sy*dir.y+sz*dir.z)/sd>0.94){
      damageSoldier(s,1);
      burst(s.x,1.4,s.z,0xff9a2a,5,5,0.35,0.5,1);
      break;
    }
  }
  if(Math.random()<0.3) sTorch();
}
function updatePilot(dt){
  const p=pilot;
  pollKeys();
  // desktop: arrows steer the view when the pointer isn't locked
  if(!('ontouchstart' in window)&&document.pointerLockElement!==el('cv')){
    if(keys.ArrowLeft) p.yaw+=1.9*dt;
    if(keys.ArrowRight) p.yaw-=1.9*dt;
    if(keys.ArrowUp) p.pitch=clamp(p.pitch+1.4*dt,-1.25,1.25);
    if(keys.ArrowDown) p.pitch=clamp(p.pitch-1.4*dt,-1.25,1.25);
  }
  const sp=11;
  const fx=-Math.sin(p.yaw), fz=-Math.cos(p.yaw);
  const rx=Math.cos(p.yaw), rz=-Math.sin(p.yaw);
  let mx=fx*input.jy+rx*input.jx, mz=fz*input.jy+rz*input.jx;
  const ml=Math.hypot(mx,mz);
  if(ml>1){ mx/=ml; mz/=ml; }
  if(!groundBlocked(p.x+mx*sp*dt,p.z,0.7)) p.x+=mx*sp*dt;
  if(!groundBlocked(p.x,p.z+mz*sp*dt,0.7)) p.z+=mz*sp*dt;
  const half=city.spanUnits/2+4;
  p.x=clamp(p.x,-half,half); p.z=clamp(p.z,-half,half);
  if(input.jumpQueued){ input.jumpQueued=false; if(p.y<=0.01) p.vy=7.5; }
  p.vy-=24*dt; p.y+=p.vy*dt;
  if(p.y<=0){ p.y=0; p.vy=0; }
  p.fireCd-=dt;
  if(input.fireHeld&&p.fireCd<=0){ pilotShoot(); p.fireCd=p.mode==='gun'?0.22:0.08; }
  pcam.position.set(p.x, EYE+p.y, p.z);
  pcam.rotation.y=p.yaw; pcam.rotation.x=p.pitch; pcam.rotation.z=0;
  if(gunGroup){
    const moving=(Math.abs(mx)+Math.abs(mz))>0.1;
    gunGroup.position.y=-0.38+(moving?Math.sin(performance.now()*0.014)*0.012:0);
    if(flameMesh.visible){ const fs=0.8+Math.random()*0.5; flameMesh.scale.set(fs,fs,fs); }
  }
}

function fistWorld(){
  const r=robot;
  const dx=Math.sin(r.angle), dz=Math.cos(r.angle);
  return { x:r.x+dx*3.2, y:r.y+4.8, z:r.z+dz*3.2 };
}

function doPunch(){
  const r=robot;
  if(r.dead || r.punchCd>0) return;
  r.punchCd=0.34; r.punchT=0;
  const dx=Math.sin(r.angle), dz=Math.cos(r.angle);
  let hitSomething=false;
  if(r.mode==='climb' && r.cb){
    const b=r.cb, row=r.crow;
    const res=damageFloor(b,row,1);
    if(res.hit){
      hitSomething=true;
      facePos(b,r.cf,r.cs,_fp);
      onFloorHit(b,row,res,_fp.x+FACE_N[r.cf][0]*0.5,_fp.z+FACE_N[r.cf][1]*0.5);
    }
  } else if(r.mode==='top' && r.cb){
    // punch down into the roof
    const b=r.cb, t=topRow(b);
    if(t>=0){
      const res=damageFloor(b,t,1);
      if(res.hit){ hitSomething=true; onFloorHit(b,t,res,r.x,r.z); }
    }
  } else if(r.mode==='air'){
    // punch the building side we're flying past
    const hit=collideBuildings(r.x+dx*3.2, r.z+dz*3.2, 1.5);
    if(hit && topRow(hit.b)>=0){
      const row=clamp(Math.floor(r.y/FLOOR_H),0,topRow(hit.b));
      const res=damageFloor(hit.b,row,1);
      if(res.hit){ hitSomething=true; onFloorHit(hit.b,row,res,r.x+dx*3.2,r.z+dz*3.2); }
    }
  } else {
    // ground punch: adjacent building face?
    let best=null, bd=1e9;
    for(const b of buildings){
      if(b.dead) continue;
      const cx=clamp(r.x,b.bx1,b.bx2), cz=clamp(r.z,b.bz1,b.bz2);
      const d=Math.hypot(r.x-cx,r.z-cz);
      if(d<5.2 && d<bd){ bd=d; best={b,px:cx,pz:cz}; }
    }
    if(best){
      const res=damageFloor(best.b,0,1);
      if(res.hit){ hitSomething=true; onFloorHit(best.b,0,res,best.px,best.pz); }
    }
  }
  // punch enemies near the fist (works climbing or grounded)
  const f=fistWorld();
  hitSomething = punchEnemies(f) || hitSomething;
  if(hitSomething){ sPunch(); addShake(0.9,0.18); }
  else sWhiff();
}

/* ---------------- particles & floating text ---------------- */
const particles=[];
const PARTICLE_N=170;
function initParticles(){
  const geo=new THREE.BoxGeometry(0.55,0.55,0.55);
  for(let i=0;i<PARTICLE_N;i++){
    const m=new THREE.Mesh(geo, new THREE.MeshLambertMaterial({color:0xffffff}));
    m.visible=false; scene.add(m);
    particles.push({m, vx:0,vy:0,vz:0, life:0, maxLife:1, grav:1, rx:0, rz:0});
  }
}
let pIdx=0;
function burst(x,y,z,color,n,speed,life,grav,size){
  for(let k=0;k<n;k++){
    const p=particles[pIdx]; pIdx=(pIdx+1)%PARTICLE_N;
    p.m.visible=true; p.m.material.color.setHex(color);
    p.m.position.set(x+rand(-1,1), y+rand(-1,1), z+rand(-1,1));
    const a=rand(0,TAU), e=rand(-1,1), sp=rand(0.3,1)*speed;
    p.vx=Math.cos(a)*sp; p.vz=Math.sin(a)*sp; p.vy=e*speed*0.9+speed*0.35;
    p.life=p.maxLife=life*rand(0.6,1.2); p.grav=grav;
    p.rx=rand(-6,6); p.rz=rand(-6,6);
    const s=(size||1)*rand(0.6,1.4); p.m.scale.set(s,s,s);
    p.m.rotation.set(rand(0,3),rand(0,3),0);
  }
}
function updateParticles(dt){
  for(const p of particles){
    if(p.life<=0) continue;
    p.life-=dt;
    if(p.life<=0){ p.m.visible=false; continue; }
    p.vy-=22*p.grav*dt;
    p.m.position.x+=p.vx*dt; p.m.position.y+=p.vy*dt; p.m.position.z+=p.vz*dt;
    if(p.m.position.y<0.3){ p.m.position.y=0.3; p.vy*=-0.35; p.vx*=0.7; p.vz*=0.7; }
    p.m.rotation.x+=p.rx*dt; p.m.rotation.z+=p.rz*dt;
    const s=p.m.scale.x*Math.min(1,p.life/(p.maxLife*0.4)+0.2);
    p.m.scale.set(Math.max(0.01,s),Math.max(0.01,s),Math.max(0.01,s));
  }
}

const floats=[];
function initFloats(){
  const c=el('floats');
  for(let i=0;i<10;i++){
    const d=document.createElement('div'); d.className='ftext'; d.style.display='none';
    c.appendChild(d); floats.push({d, x:0,y:0,z:0, life:0});
  }
}
let fIdx=0;
const _v3={v:null};
function floatText(x,y,z,txt,color){
  const f=floats[fIdx]; fIdx=(fIdx+1)%floats.length;
  f.x=x; f.y=y; f.z=z; f.life=1.1;
  f.d.style.display='block'; f.d.textContent=txt; f.d.style.color=color||'#ffe14d';
}
function updateFloats(dt){
  if(!_v3.v) _v3.v=new THREE.Vector3();
  for(const f of floats){
    if(f.life<=0) continue;
    f.life-=dt; f.y+=dt*3;
    if(f.life<=0){ f.d.style.display='none'; continue; }
    _v3.v.set(f.x,f.y,f.z).project(pilot.active?pcam:camera);
    f.d.style.left=((_v3.v.x*0.5+0.5)*window.innerWidth)+'px';
    f.d.style.top=((-_v3.v.y*0.5+0.5)*window.innerHeight)+'px';
    f.d.style.opacity=Math.min(1,f.life*2);
  }
}

/* ---------------- floor damage & collapse ---------------- */
let score=0, wave=1;
function addScore(n){ score+=n; el('score').textContent=score; }

function onFloorHit(b,row,res,hx,hz){
  const vis=b.vis.floors[row]; if(!vis) return;
  vis.flash=1; // white hit-flash, decays in updateFloorFlash
  const f=b.floors[row];
  // kill lit windows once the floor is half-destroyed
  if(f.hp/f.maxHp<0.5) for(const bm of vis.bandMats){ bm.emissive.setHex(0x000000); }
  burst(hx,row*FLOOR_H+1.5,hz,0xd8cfc0,7,7,0.5,1,0.9);
  addShake(0.5,0.12);
  if(!res.destroyed){ addScore(10); floatText(hx,row*FLOOR_H+3,hz,'+10'); return; }
  // ---- collapse: every floor at row and above crumbles ----
  const n=res.rows.length;
  addScore(40+25*n);
  floatText(hx,(row+n)*FLOOR_H+2,hz,'+'+(40+25*n)+' CRUMBLE!');
  sCrumble(n>3);
  addShake(Math.min(4,1.2+n*0.45),0.5);
  for(const rr of res.rows){
    const v=b.vis.floors[rr]; if(!v) continue;
    v.group.visible=false;
    // rubble chunks + dust from the floor's position
    burst(v.cx, rr*FLOOR_H+1.5, v.cz, vis.baseColor.getHex(), 6, 9, 1.1, 1, 2.2);
    burst(v.cx, rr*FLOOR_H+0.8, v.cz, 0x9a938a, 8, 6, 0.9, 0.4, 1.2);
  }
  const nt=topRow(b);
  if(nt<0){
    b.dead=true; b.vis.cap.visible=false; b.vis.pile.visible=true;
    floatText(hx,4,hz,'BUILDING DOWN! +200','#ff9a4d'); addScore(200);
    burst(hx,2,hz,0x6a6a72,20,10,1.4,1,2.5);
    if(robot.cb===b && (robot.mode==='climb'||robot.mode==='top')){
      if(robot.mode==='top'){
        // roof crumbled under us: fall and try to grab the face
        robot.mode='air'; robot.vy=0; robot.vx=0; robot.vz=0;
        robot.cb=null; robot.noAttach=b; robot.noAttachT=0.4;
      } else {
        facePos(b,robot.cf,robot.cs,_fp);
        stopClimbToGround(_fp.x+FACE_N[robot.cf][0]*2.5,_fp.z+FACE_N[robot.cf][1]*2.5);
      }
    }
  } else {
    b.vis.cap.position.y=(nt+1)*FLOOR_H-0.35;
    // robot was punching the destroyed row: settle onto the new top
    if(robot.mode==='climb'&&robot.cb===b){
      robot.crow=Math.min(robot.crow,nt);
      if(robot.crow<0){ facePos(b,robot.cf,robot.cs,_fp); stopClimbToGround(_fp.x+FACE_N[robot.cf][0]*2.5,_fp.z+FACE_N[robot.cf][1]*2.5); }
    }
    else if(robot.mode==='top'&&robot.cb===b){
      robot.y=(nt+1)*FLOOR_H; // roof dropped a floor under us
    }
  }
  el('bleft').textContent=buildingsLeft(city);
  if(buildingsLeft(city)===0) waveClear();
}

let _white=null;
function updateFloorFlash(dt){
  if(!_white) _white=new THREE.Color(0xffffff);
  for(const b of buildings){
    if(b.dead) continue;
    for(let i=0;i<b.vis.floors.length;i++){
      const v=b.vis.floors[i];
      if(!v||v.flash<=0) continue;
      v.flash=Math.max(0,v.flash-dt*4);
      const f=b.floors[i], frac=f?f.hp/f.maxHp:1;
      v.slabMat.color.copy(v.baseColor).multiplyScalar(0.55+0.45*frac);
      if(v.flash>0) v.slabMat.color.lerp(_white, v.flash*0.65);
    }
  }
}

/* ---------------- enemies ---------------- */
const civs=[], soldiers=[], helis=[], bullets=[];
let soldierTimer=0;

// enemies use fresh geometries (mat() cache owns materials); dispose geo on remove
function removeEnt(e){
  e.g.traverse(o=>{ if(o.geometry) o.geometry.dispose(); });
  scene.remove(e.g);
}

function freeStreetSpot(){
  const half=city.spanUnits/2;
  for(let t=0;t<40;t++){
    const x=rand(-half,half), z=rand(-half,half);
    let ok=true;
    for(const b of buildings){
      if(x>b.bx1-2.5&&x<b.bx2+2.5&&z>b.bz1-2.5&&z<b.bz2+2.5){ ok=false; break; }
    }
    if(ok) return {x,z};
  }
  return {x:half+2,z:0};
}
function spawnCiv(){
  const p=freeStreetSpot();
  const g=new THREE.Group();
  const shirt=[0x3fa7ff,0xffd23f,0x7dff6a,0xff6ad5,0xffffff][randi(0,4)];
  box(0.7,0.9,0.45,shirt,0,0.85,0,g);
  box(0.45,0.45,0.45,0xf2c89b,0,1.55,0,g);
  box(0.55,0.5,0.4,0x2c2f38,0,0.25,0,g);
  g.position.set(p.x,0,p.z); scene.add(g);
  const a=rand(0,TAU);
  civs.push({g, x:p.x, z:p.z, tx:p.x, tz:p.z, a, speed:rand(2.5,4), panic:0});
}
function spawnSoldier(){
  const half=city.spanUnits/2+2, side=randi(0,3);
  let x,z; if(side===0){x=-half;z=rand(-half,half);} else if(side===1){x=half;z=rand(-half,half);}
  else if(side===2){z=-half;x=rand(-half,half);} else {z=half;x=rand(-half,half);}
  const g=new THREE.Group();
  box(0.8,1.0,0.5,0x3f6b34,0,0.9,0,g);
  box(0.5,0.5,0.5,0xf2c89b,0,1.7,0,g);
  box(0.62,0.3,0.62,0x2c4a26,0,2.05,0,g);
  const gun=box(0.15,0.15,1.2,0x222222,0.3,1.1,0.5,g);
  g.position.set(x,0,z); scene.add(g);
  soldiers.push({g,x,z,shootCd:rand(1,2),strafe:rand(0,TAU),hp:2});
}
function spawnHeli(){
  const g=new THREE.Group();
  box(2.6,1.2,1.4,0x4a5568,0,0,0,g);
  box(1.0,0.8,1.0,0x18242f,0,0.2,0.9,g);
  const rotor=box(5.2,0.12,0.35,0x222228,0,0.9,0,g);
  box(0.3,0.3,2.6,0x4a5568,0,0.3,-1.8,g);
  g.position.set(0,24,0); scene.add(g);
  helis.push({g, ang:rand(0,TAU), r:22, y:24, rotor, shootCd:2, hp:3});
}
/* ---------------- powerups ---------------- */
let powerups=[], powerupTimer=14, sphereFx=[];
function spawnPowerup(){
  if(powerups.length>=3) return;
  const p=freeStreetSpot();
  const type=Math.random()<0.5?'health':'energy';
  const g=new THREE.Group();
  if(type==='health'){
    box(1.3,0.45,0.45,0x2dff5e,0,1.1,0,g);
    box(0.45,1.3,0.45,0x2dff5e,0,1.1,0,g);
  }else{
    const orb=new THREE.Mesh(new THREE.SphereGeometry(0.75,14,10),
      new THREE.MeshBasicMaterial({color:0x4de1ff}));
    orb.position.y=1.1; g.add(orb);
    const ring=new THREE.Mesh(new THREE.BoxGeometry(1.9,0.18,1.9),
      new THREE.MeshBasicMaterial({color:0x4de1ff,transparent:true,opacity:0.6}));
    ring.position.y=1.1; g.add(ring);
  }
  g.position.set(p.x,0,p.z); scene.add(g);
  powerups.push({g,type,x:p.x,z:p.z,life:30,t:rand(0,6)});
}
function updatePowerups(dt){
  powerupTimer-=dt;
  if(powerupTimer<=0){ spawnPowerup(); powerupTimer=rand(18,30); }
  for(let i=powerups.length-1;i>=0;i--){
    const pu=powerups[i];
    pu.life-=dt; pu.t+=dt;
    pu.g.position.y=Math.sin(pu.t*3.2)*0.35;
    pu.g.rotation.y+=dt*2.2;
    if(pu.life<=0){ scene.remove(pu.g); powerups.splice(i,1); continue; }
    const d=Math.hypot(robot.x-pu.x,robot.z-pu.z);
    if(d<2.8 && robot.y<5 && !robot.dead && !over){
      scene.remove(pu.g); powerups.splice(i,1);
      if(pu.type==='health'){
        robot.hp=Math.min(100,robot.hp+40); updateHp();
        floatText(pu.x,3.5,pu.z,'+40 HP','#2dff5e'); sPickup();
        burst(pu.x,1.6,pu.z,0x2dff5e,14,7,0.7,1,1.1);
      }else{
        // Store the charge; player triggers it with the ⚡ button (or E key) when wanted
        if(robot.energyStored<3){
          robot.energyStored++;
          floatText(pu.x,3.5,pu.z,'ENERGY STORED','#4de1ff'); sPickup();
          burst(pu.x,1.6,pu.z,0x4de1ff,14,7,0.7,1,1.1);
        }else{
          addScore(50); floatText(pu.x,3.5,pu.z,'+50','#4de1ff'); sPickup();
        }
        updateEnergyBtn();
      }
    }
  }
  // expanding sphere visuals
  for(let i=sphereFx.length-1;i>=0;i--){
    const f=sphereFx[i]; f.t+=dt;
    if(f.t<0) continue; // staggered start
    const k=f.t/f.dur;
    if(k>=1){ scene.remove(f.m); sphereFx.splice(i,1); continue; }
    const s=1+k*22;
    f.m.scale.set(s,s,s);
    f.m.material.opacity=0.55*(1-k);
  }
}
function startEnergyCharge(){
  if(robot.chargeT>0) return;
  robot.chargeT=0.9;
  sCharge();
  floatText(robot.x,robot.y+10,robot.z,'ENERGY!','#4de1ff');
}
function releaseEnergySphere(){
  const R=20, cx=robot.x, cy=robot.y+4.5, cz=robot.z;
  // Triple expanding shells for a spicier release
  const cols=[0x4de1ff,0xbff4ff,0xffffff];
  for(let k=0;k<3;k++){
    const m=new THREE.Mesh(new THREE.SphereGeometry(1,22,14),
      new THREE.MeshBasicMaterial({color:cols[k],transparent:true,opacity:0.55,depthWrite:false}));
    m.position.set(cx,cy,cz); scene.add(m);
    sphereFx.push({m,t:-k*0.08,dur:0.5}); // staggered start
  }
  // Big multi-color particle bursts
  burst(cx,cy,cz,0x4de1ff,40,14,0.9,0.4,1.5);
  burst(cx,cy,cz,0xffffff,22,10,0.6,0.2,1.1);
  burst(cx,cy-3,cz,0x1e9ed6,24,11,0.8,0.6,1.3);
  // ground ring flash
  burst(cx,0.5,cz,0x4de1ff,26,16,0.5,0,1.2);
  for(let i=soldiers.length-1;i>=0;i--){
    const s=soldiers[i];
    if(Math.hypot(s.x-cx,s.z-cz)<R){
      removeEnt(soldiers[i]); soldiers.splice(i,1);
      burst(s.x,1.6,s.z,0x4de1ff,14,8,0.7,1,1.2);
      addScore(50); floatText(s.x,3,s.z,'+50 ZAP','#4de1ff');
    }
  }
  for(let i=helis.length-1;i>=0;i--){
    const h=helis[i], hp=h.g.position;
    if(Math.hypot(hp.x-cx,hp.z-cz)<R){
      removeEnt(helis[i]); helis.splice(i,1);
      burst(hp.x,hp.y,hp.z,0x4de1ff,22,11,0.8,1,1.5);
      burst(hp.x,hp.y,hp.z,0xff9a4d,14,9,0.6,1,1.2);
      addScore(100); floatText(hp.x,hp.y,hp.z,'+100 ZAP','#4de1ff');
    }
  }
  sBlast(); addShake(5,0.7);
}
function spawnBullet(x,y,z,tx,ty,tz,speed,dmg){
  let b=bullets.find(b=>b.life<=0);
  if(!b){
    if(bullets.length>40) return;
    const m=box(0.45,0.45,0.45,0xffe14d,0,-99,0);
    b={m,life:0}; bullets.push(b);
  }
  const dx=tx-x, dy=ty-y, dz=tz-z, d=Math.hypot(dx,dy,dz)||1;
  b.m.visible=true; b.m.position.set(x,y,z);
  b.vx=dx/d*speed; b.vy=dy/d*speed; b.vz=dz/d*speed;
  b.life=3; b.dmg=dmg;
}

function pointHitsBuilding(x,y,z){
  for(const b of buildings){
    if(b.dead) continue;
    if(x>b.bx1&&x<b.bx2&&z>b.bz1&&z<b.bz2&&y<topRow(b)*FLOOR_H+FLOOR_H) return b;
  }
  return null;
}
// 2D footprint check for ground NPCs (civs, soldiers) so they walk around buildings
function groundBlocked(x,z,pad){
  for(const b of buildings){
    if(b.dead) continue;
    if(x>b.bx1-pad&&x<b.bx2+pad&&z>b.bz1-pad&&z<b.bz2+pad) return true;
  }
  return false;
}

function updateEnemies(dt){
  const r=robot;
  // civilians: wander, flee robot, get eaten
  for(let i=civs.length-1;i>=0;i--){
    const c=civs[i];
    const dx=r.x-c.x, dz=r.z-c.z, d=Math.hypot(dx,dz);
    if(d<2.6 && r.y<2.5 && !r.dead){
      // EATEN
      removeEnt(civs[i]); civs.splice(i,1);
      burst(c.x,1.5,c.z,0xff6a5e,10,6,0.6,1,1);
      addScore(15); r.hp=Math.min(100,r.hp+4); updateHp();
      floatText(c.x,3,c.z,'+15 YUM','#7dff6a'); sEat();
      if(civs.length<9) spawnCiv();
      continue;
    }
    if(d<9){ c.panic=1; c.tx=c.x-dx/d*14; c.tz=c.z-dz/d*14; }
    else if(Math.hypot(c.tx-c.x,c.tz-c.z)<1 || Math.random()<0.005){
      const p=freeStreetSpot(); c.tx=p.x; c.tz=p.z;
    }
    const mx=c.tx-c.x, mz=c.tz-c.z, md=Math.hypot(mx,mz);
    if(md>0.2){
      const sp=c.speed*(c.panic?2.2:1);
      const stepX=mx/md*sp*dt, stepZ=mz/md*sp*dt;
      // Axis-separated move so civs slide around building footprints instead of through them
      let moved=false;
      if(!groundBlocked(c.x+stepX,c.z,0.6)){ c.x+=stepX; moved=true; }
      if(!groundBlocked(c.x,c.z+stepZ,0.6)){ c.z+=stepZ; moved=true; }
      if(moved){
        c.a=Math.atan2(mx,mz);
        c.g.position.x=c.x; c.g.position.z=c.z; c.g.rotation.y=c.a;
        c.g.position.y=Math.abs(Math.sin(performance.now()*0.012))*0.15;
      } else {
        // fully blocked: pick a new street target
        const p=freeStreetSpot(); c.tx=p.x; c.tz=p.z;
      }
    }
    c.panic=Math.max(0,c.panic-dt);
  }
  // soldiers: approach, shoot
  soldierTimer-=dt;
  if(soldierTimer<=0 && soldiers.length<2+wave && !r.dead){
    spawnSoldier(); soldierTimer=Math.max(1.6,4.5-wave*0.4);
  }
  for(let i=soldiers.length-1;i>=0;i--){
    const s=soldiers[i];
    // target: nearest of the robot / the disembarked pilot
    let tx=r.x, ty=r.y+3.75, tz=r.z, canShoot=!r.dead;
    if(pilot.active){
      const pd=Math.hypot(pilot.x-s.x,pilot.z-s.z), rd=Math.hypot(r.x-s.x,r.z-s.z);
      if(pd<rd){ tx=pilot.x; ty=2.0+pilot.y; tz=pilot.z; canShoot=true; }
    }
    const dx=tx-s.x, dz=tz-s.z, d=Math.hypot(dx,dz);
    if(d>13){
      const stepX=dx/d*6*dt, stepZ=dz/d*6*dt;
      // Axis-separated so soldiers path around buildings instead of through them
      if(!groundBlocked(s.x+stepX,s.z,0.6)) s.x+=stepX;
      if(!groundBlocked(s.x,s.z+stepZ,0.6)) s.z+=stepZ;
    }
    else {
      s.strafe+=dt;
      const stX=Math.cos(s.strafe)*1.5*dt, stZ=Math.sin(s.strafe)*1.5*dt;
      if(!groundBlocked(s.x+stX,s.z,0.6)) s.x+=stX;
      if(!groundBlocked(s.x,s.z+stZ,0.6)) s.z+=stZ;
    }
    s.g.position.x=s.x; s.g.position.z=s.z; s.g.rotation.y=Math.atan2(dx,dz);
    s.shootCd-=dt;
    if(s.shootCd<=0 && d<24 && canShoot && !over){
      s.shootCd=rand(1.8,2.6)-Math.min(0.8,wave*0.08);
      spawnBullet(s.x,1.6,s.z, tx,ty,tz, 26, 5);
      sShoot(); burst(s.x,1.8,s.z,0xffe14d,3,3,0.2,0,0.6);
    }
  }
  // helicopters: circle, shoot
  for(let i=helis.length-1;i>=0;i--){
    const h=helis[i];
    h.ang+=dt*0.5; h.rotor.rotation.y+=dt*22;
    h.g.position.set(Math.cos(h.ang)*h.r, h.y+Math.sin(h.ang*2)*1.2, Math.sin(h.ang)*h.r);
    h.g.rotation.y=-h.ang;
    h.shootCd-=dt;
    if(h.shootCd<=0 && !r.dead){
      h.shootCd=3.2;
      spawnBullet(h.g.position.x,h.g.position.y,h.g.position.z, r.x, r.y+3.75, r.z, 30, 7);
      sShoot();
    }
  }
  // bullets
  for(const b of bullets){
    if(b.life<=0) continue;
    b.life-=dt;
    b.m.position.x+=b.vx*dt; b.m.position.y+=b.vy*dt; b.m.position.z+=b.vz*dt;
    const p=b.m.position;
    let dead=b.life<=0 || p.y<0;
    if(!dead){
      const hb=pointHitsBuilding(p.x,p.y,p.z);
      if(hb){ burst(p.x,p.y,p.z,0x9a938a,4,4,0.3,1,0.8); dead=true; }
    }
    if(!dead && !r.dead){
      const d=Math.hypot(p.x-r.x,(p.y-(r.y+3.75)),p.z-r.z);
      if(d<2.3){ hurtRobot(b.dmg); burst(p.x,p.y,p.z,0xff5a4d,8,6,0.4,1,1); dead=true; }
    }
    if(!dead && pilot.active){
      const pd=Math.hypot(p.x-pilot.x,(p.y-(2.0+pilot.y)),p.z-pilot.z);
      if(pd<1.7){ hurtPilot(b.dmg); burst(p.x,p.y,p.z,0xff5a4d,8,6,0.4,1,1); dead=true; }
    }
    if(dead){ b.life=0; b.m.visible=false; }
  }
}

function punchEnemies(f){
  let hit=false;
  for(let i=soldiers.length-1;i>=0;i--){
    const s=soldiers[i];
    const d=Math.hypot(f.x-s.x,f.z-s.z);
    if(d<5.5 && Math.abs(f.y-1.5)<6){
      killSoldier(s); hit=true;
    }
  }
  for(let i=helis.length-1;i>=0;i--){
    const h=helis[i], p=h.g.position;
    const d=Math.hypot(f.x-p.x,f.y-p.y,f.z-p.z);
    if(d<8){
      damageHeli(h,1); hit=true;
      break;
    }
  }
  return hit;
}

function hurtRobot(dmg){
  const r=robot;
  if(r.dead) return;
  r.hp-=dmg; updateHp(); sHurt(); addShake(1.6,0.3);
  el('dmg').style.opacity=1;
  setTimeout(()=>el('dmg').style.opacity=0,180);
  if(r.hp<=0){ r.hp=0; updateHp(); gameOver(); }
}
function updateHp(){ el('hpbar').style.width=robot.hp+'%'; }

/* ---------------- HUD / waves / game state ---------------- */
let paused=false, over=false, waveClearT=0;

function banner(txt, ms){
  const b=el('banner'); b.textContent=txt; b.style.opacity=1;
  clearTimeout(banner._t);
  banner._t=setTimeout(()=>b.style.opacity=0, ms||1800);
}
function toggleMute(){ muted=!muted; el('muteBtn').textContent=muted?'🔇':'🔊'; }
el('muteBtn').addEventListener('click', ()=>{ ac(); toggleMute(); });
function togglePause(){
  if(over) return;
  paused=!paused;
  el('pauseOv').style.display=paused?'flex':'none';
}
el('pauseOv').addEventListener('click', togglePause);
document.addEventListener('visibilitychange', ()=>{ if(document.hidden && !paused && !over) togglePause(); });

function startWave(n){
  wave=n; el('wave').textContent=n;
  // clear old entities
  for(const c of civs) removeEnt(c); civs.length=0;
  for(const s of soldiers) removeEnt(s); soldiers.length=0;
  for(const h of helis) removeEnt(h); helis.length=0;
  for(const b of bullets){ b.life=0; b.m.visible=false; }
  for(const pu of powerups) scene.remove(pu.g); powerups.length=0;
  for(const f of sphereFx) scene.remove(f.m); sphereFx.length=0;
  powerupTimer=14; robot.chargeT=0; robot.energyStored=0; robot.group.scale.y=1.5;
  updateEnergyBtn();
  // pilot back in the cockpit for the new sector
  pilot.active=false; camTrans=null; pilot.hp=100; pilot.mode='gun'; pilot.fireCd=0;
  input.fireHeld=false;
  if(document.exitPointerLock && document.pointerLockElement) document.exitPointerLock();
  setPilotUI(false); updatePilotHp();
  buildCity(n);
  for(let i=0;i<9;i++) spawnCiv();
  spawnHeli(); if(n>=3) spawnHeli();
  soldierTimer=2;
  // robot to a street corner
  const half=city.spanUnits/2;
  stopClimbToGroundSilent(-half-1, -half-1);
  robot.hp=Math.max(robot.hp,60); updateHp();
  banner('SECTOR '+n+' — SMASH IT!', 2000); sWave();
}
function stopClimbToGroundSilent(x,z){
  robot.mode='ground'; robot.cb=null; robot.x=x; robot.z=z; robot.y=0; robot.group.rotation.x=0;
  robot.vx=robot.vy=robot.vz=0; robot.noAttach=null; robot.noAttachT=0;
}
function waveClear(){
  if(over) return;
  waveClearT=2.6;
  const bonus=500*wave;
  addScore(bonus);
  banner('SECTOR CLEARED! +'+bonus, 2400);
  sWave();
}
function gameOver(){
  if(over) return;
  over=true; robot.dead=true; robot.deadT=0;
  pilot.active=false; camTrans=null; input.fireHeld=false;
  if(document.exitPointerLock && document.pointerLockElement) document.exitPointerLock();
  setPilotUI(false);
  if(robot.cb) setBuildingGhost(robot.cb,false);
  sOver(); addShake(3,0.8);
  burst(robot.x,3,robot.z,0xd63c1e,24,10,1.2,1,2);
  setTimeout(()=>{
    el('finalScore').textContent=score;
    el('finalWave').textContent=wave;
    el('over').style.display='flex';
  },1400);
}
el('restartBtn').addEventListener('click', ()=>{
  el('over').style.display='none';
  over=false; score=0; el('score').textContent='0';
  robot.dead=false; robot.hp=100; updateHp();
  robot.group.rotation.x=0;
  startWave(1);
});

/* ---------------- main loop (fixed timestep) ---------------- */
const STEP=1/60;
let lastT=0, acc=0;
function frame(t){
  requestAnimationFrame(frame);
  if(paused){ lastT=t; return; }
  let dt=(t-lastT)/1000; lastT=t;
  if(dt>0.25) dt=0.25;
  acc+=dt;
  let n=0;
  while(acc>=STEP && n<4){ sim(STEP); acc-=STEP; n++; }
  if(n===4) acc=0;
  // camera follow
  const r=robot;
  let activeCam=camera;
  if(camTrans||pilot.active){
    activeCam=pcam; // positioned by updateCamTrans during the flight, by updatePilot after
  } else {
    camTarget.x=lerp(camTarget.x, r.x, 0.08);
    camTarget.z=lerp(camTarget.z, r.z, 0.08);
    camTarget.y=lerp(camTarget.y, r.y*0.55, 0.08);
    positionCamera();
  }
  if(shakeT>0){ shakeT-=1/60; if(shakeT<=0) shakeMag=0; }
  if(!pilot.active) updateOcclusion();
  updateParticles(1/60);
  updateFloats(1/60);
  updateTracers(1/60);
  updatePilotButtons();
  renderer.render(scene,activeCam);
}
function sim(dt){
  if(over){ updateRobot(dt); return; }
  if(waveClearT>0){
    waveClearT-=dt;
    updateRobot(dt); updateEnemies(dt); updatePowerups(dt); updateFloorFlash(dt);
    if(waveClearT<=0) startWave(wave+1);
    return;
  }
  updateRobot(dt);
  if(pilot.active&&!camTrans) updatePilot(dt);
  if(camTrans) updateCamTrans(dt);
  updateEnemies(dt);
  updatePowerups(dt);
  updateFloorFlash(dt);
}

/* ---------------- boot ---------------- */
function boot(){
  bootThree();
  initParticles();
  initFloats();
  buildRobot();
  robot.hp=100; updateHp();
  startWave(1);
  // hide desktop hint on touch devices
  if('ontouchstart' in window) el('hint').style.display='none';
  requestAnimationFrame(t=>{ lastT=t; requestAnimationFrame(frame); });
}
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
