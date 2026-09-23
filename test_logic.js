'use strict';
const L = require('/home/hatch/workspace/robot-rampage/build/logic.js');
function assert(c, msg){ if (!c){ console.error('FAIL:', msg); process.exit(1); } }

const rnd = L.makeRng(1234);
const city = L.genCityData(1, rnd);
assert(city.buildings.length === 9, '9 buildings per wave');
const b = city.buildings.find(x => x.floors.length >= 7);
assert(b, 'tall building exists');
assert(b.floors[0].maxHp === 6 && b.floors[1].maxHp === 3 && b.floors[4].maxHp === 2, 'hp tiers');

// hit an upper floor once: damaged but standing, nothing above crumbles
let e = L.damageFloor(b, 4, 1);
assert(e.hit && !e.destroyed, 'upper floor survives 1 hit');
assert(L.topRow(b) === b.floors.length - 1, 'nothing crumbled');

// second hit: floor 4 breaks -> everything above crumbles, below intact
const top = b.floors.length - 1;
e = L.damageFloor(b, 4, 1);
assert(e.hit && e.destroyed, 'floor destroyed');
assert(e.rows.length === top - 4 + 1 && e.rows[0] === 4 && e.rows[e.rows.length-1] === top, 'collapse rows = 4..top');
assert(b.floors[5].destroyed && b.floors[top].destroyed, 'above crumbled');
assert(!b.floors[3].destroyed && !b.floors[0].destroyed, 'below intact');
assert(L.topRow(b) === 3, 'new top is row 3');

// punching an already-destroyed row is a no-op
e = L.damageFloor(b, 5, 1);
assert(!e.hit, 'destroyed row no-op');

// ground floor takes 6 hits, then whole building goes
for (let i = 0; i < 5; i++){ e = L.damageFloor(b, 0, 1); assert(e.hit && !e.destroyed, 'ground floor holds ' + i); }
e = L.damageFloor(b, 0, 1);
assert(e.destroyed && e.rows[0] === 0 && e.rows[e.rows.length-1] === 3, 'ground floor collapse takes rest');
assert(L.topRow(b) === -1, 'building gone');
assert(L.buildingsLeft(city) === 8, '8 buildings left');

console.log('logic OK');
