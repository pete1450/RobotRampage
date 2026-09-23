'use strict';
/* ROBOT RAMPAGE — pure game logic (no THREE, no DOM). Loaded before game.js.
   Testable in node: require('./logic.js') */

function makeRng(seed){
  let s = (seed >>> 0) || 1;
  return function(){
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const TILE = 2;        // world units per tile
const FLOOR_H = 3;     // world units per building floor

// hits to destroy a floor: ground floor is tough, upper floors crumble fast
function floorMaxHp(row){
  return row === 0 ? 6 : (row <= 2 ? 3 : 2);
}

// city = { buildings:[ {id,bx1,bz1,bx2,bz2,w,d,hue,floors:[{row,hp,maxHp,destroyed}]} ], spanTiles, spanUnits }
function genCityData(wave, rnd){
  rnd = rnd || Math.random;
  const BLOCKS = 3, BLOCK_T = 8, STREET_T = 2;
  const span = BLOCKS * BLOCK_T + (BLOCKS + 1) * STREET_T; // tiles
  const buildings = [];
  let id = 0;
  for (let bi = 0; bi < BLOCKS; bi++) for (let bj = 0; bj < BLOCKS; bj++){
    const ox = -span / 2 + STREET_T + bi * (BLOCK_T + STREET_T);
    const oz = -span / 2 + STREET_T + bj * (BLOCK_T + STREET_T);
    const w = 4 + Math.floor(rnd() * 3);   // 4..6 tiles
    const d = 4 + Math.floor(rnd() * 3);
    const fx = ox + Math.floor((BLOCK_T - w) / 2);
    const fz = oz + Math.floor((BLOCK_T - d) / 2);
    const h = Math.min(14, 5 + wave + Math.floor(rnd() * 4));
    const floors = [];
    for (let r = 0; r < h; r++) floors.push({ row: r, hp: floorMaxHp(r), maxHp: floorMaxHp(r), destroyed: false });
    buildings.push({
      id: id++,
      bx1: fx * TILE, bz1: fz * TILE, bx2: (fx + w) * TILE, bz2: (fz + d) * TILE,
      w, d, hue: rnd(), floors
    });
  }
  return { buildings, spanTiles: span, spanUnits: span * TILE };
}

// Punch a floor row. Returns {hit, destroyed, rows[]}
// If the floor breaks, every floor above it crumbles too (rows marked destroyed).
function damageFloor(b, row, dmg){
  const f = b.floors[row];
  if (!f || f.destroyed) return { hit: false };
  f.hp -= dmg;
  if (f.hp > 0) return { hit: true, destroyed: false };
  const rows = [];
  for (let r = row; r < b.floors.length; r++){
    if (!b.floors[r].destroyed){ b.floors[r].destroyed = true; rows.push(r); }
  }
  return { hit: true, destroyed: true, rows };
}

function topRow(b){
  for (let r = b.floors.length - 1; r >= 0; r--) if (!b.floors[r].destroyed) return r;
  return -1;
}

function buildingsLeft(city){
  let n = 0;
  for (const b of city.buildings) if (topRow(b) >= 0) n++;
  return n;
}

if (typeof module !== 'undefined' && module.exports){
  module.exports = { makeRng, floorMaxHp, genCityData, damageFloor, topRow, buildingsLeft, TILE, FLOOR_H };
}
