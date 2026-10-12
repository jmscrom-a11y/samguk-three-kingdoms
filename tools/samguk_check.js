// Era-generic data-integrity check for an era pack (tools/test.js is hard-wired
// to the threekingdoms gameplay, so it cannot verify a new era). Runs the
// pure-data invariants the engine relies on, against ERA=<id>.
//
//   ERA=samguk node tools/samguk_check.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ERA_ID = process.env.ERA || 'samguk';
const ERA_DIR = path.join(__dirname, '..', 'js', 'eras', ERA_ID);
const ctx = {};
vm.createContext(ctx);
for (const f of ['era.js', 'data.js', 'geo.js']) {
  vm.runInContext(fs.readFileSync(path.join(ERA_DIR, f), 'utf8'), ctx);
}
vm.runInContext('this.PROVINCES=PROVINCES; this.ROADS=ROADS; this.FACTIONS=FACTIONS; this.OFFICERS=OFFICERS; this.MAP=MAP; this.INITIAL_RELATIONS=INITIAL_RELATIONS; this.ITEMS=ITEMS; this.OFFICER_SKILLS=OFFICER_SKILLS; this.OFFICER_TIES=OFFICER_TIES; this.LATER_OFFICERS=LATER_OFFICERS; this.HISTORICAL_DEATHS=HISTORICAL_DEATHS; this.GEO=(typeof GEO!=="undefined"?GEO:null);', ctx);
const { PROVINCES, ROADS, FACTIONS, OFFICERS, MAP, INITIAL_RELATIONS, ITEMS, OFFICER_SKILLS, OFFICER_TIES, LATER_OFFICERS, HISTORICAL_DEATHS } = ctx;

let fails = 0;
const check = (c, msg) => { if (!c) { console.log('  ✗ ' + msg); fails++; } };

// 1. roads reference real provinces, and the map is one connected network
const pids = new Set(PROVINCES.map((p) => p.id));
for (const [a, b] of ROADS) check(pids.has(a) && pids.has(b), `road refers to unknown city: ${a}-${b}`);
const adj = {}; for (const [a, b] of ROADS) { (adj[a] = adj[a] || []).push(b); (adj[b] = adj[b] || []).push(a); }
const seen = new Set([PROVINCES[0].id]); const q = [PROVINCES[0].id];
while (q.length) { const c = q.pop(); for (const n of (adj[c] || [])) if (!seen.has(n)) { seen.add(n); q.push(n); } }
check(seen.size === PROVINCES.length, 'disconnected cities: ' + PROVINCES.filter((p) => !seen.has(p.id)).map((p) => p.id).join(', '));

// 2. every city on the canvas, and no two labels collide (engine rule: |dx|>=98 or |dy|>=44)
for (const p of PROVINCES) check(p.x >= 0 && p.x <= MAP.W && p.y >= 0 && p.y <= MAP.H, `${p.id} off canvas (${p.x},${p.y})`);
for (let i = 0; i < PROVINCES.length; i++) for (let j = i + 1; j < PROVINCES.length; j++) {
  const a = PROVINCES[i], b = PROVINCES[j];
  check(Math.abs(a.x - b.x) >= 98 || Math.abs(a.y - b.y) >= 44, `${a.id}(${a.x},${a.y}) overlaps ${b.id}(${b.x},${b.y})`);
}

// 3. faction cities exist and are owned once; ruler sits in his own city
const owners = {};
for (const f of FACTIONS) for (const c of f.cities) { check(pids.has(c), `${f.id} owns unknown city ${c}`); check(!owners[c], `city ${c} owned twice`); owners[c] = f.id; }
for (const f of FACTIONS) { const r = OFFICERS.find((o) => o[0] === f.ruler); check(r && r[6] === f.id && f.cities.includes(r[7]), `ruler ${f.ruler} misplaced`); }
for (const p of PROVINCES) check(owners[p.id], `city ${p.id} has no owner`);

// 4. officers: unique names, valid city, numeric birth year, faction exists
const fids = new Set(FACTIONS.map((f) => f.id));
const names = new Set();
for (const o of OFFICERS) {
  check(!names.has(o[0]), 'duplicate officer ' + o[0]); names.add(o[0]);
  check(fids.has(o[6]), `${o[0]} in unknown faction ${o[6]}`);
  check(pids.has(o[7]), `${o[0]} in unknown city ${o[7]}`);
  check(o[6] == null || (FACTIONS.find((f) => f.id === o[6]).cities.includes(o[7])), `${o[0]} sits in ${o[7]} not owned by ${o[6]}`);
  check(typeof o[9] === 'number', `${o[0]} birth year not a number`);
}
// 4b. later officers: unique names, valid city, sane debut year, faction preference exists
for (const r of LATER_OFFICERS) {
  const [name, , , , , , born, year, city, pref] = r;
  check(!names.has(name), 'duplicate officer ' + name); names.add(name);
  check(pids.has(city), `${name} arrives in unknown city ${city}`);
  check(typeof born === 'number' && typeof year === 'number', `${name} birth/debut year not a number`);
  check(year > 554, `${name} debuts ${year}, before the 554 opening (belongs in OFFICERS)`);
  check(pref == null || fids.has(pref), `${name} prefers unknown faction ${pref}`);
}
// 4c. scripted deaths only name roster officers, on dates after the opening
for (const [name, y, m] of HISTORICAL_DEATHS) {
  check(names.has(name), 'scripted death for unknown officer ' + name);
  check(y > 554 || (y === 554 && m >= 1), `scripted death for ${name} in ${y}-${m}, before the opening`);
}

// 5. cross-refs: skills, ties, items, relations point at things that exist
for (const n of Object.keys(OFFICER_SKILLS)) check(names.has(n), 'skills for unknown officer ' + n);
for (const g of OFFICER_TIES.bonds) for (const n of g) check(names.has(n), 'bond for unknown officer ' + n);
for (const g of OFFICER_TIES.enemies) for (const n of g) check(names.has(n), 'enmity for unknown officer ' + n);
for (const g of OFFICER_TIES.rivals) for (const n of g) check(names.has(n), 'rivalry for unknown officer ' + n);
for (const it of ITEMS) if (it.owner) check(names.has(it.owner), 'item owner unknown ' + it.owner);
for (const it of ITEMS) if (it.city) check(pids.has(it.city), 'item city unknown ' + it.city);
for (const r of INITIAL_RELATIONS) check(fids.has(r[0]) && fids.has(r[1]), 'relation between unknown houses ' + r.join('-'));

console.log(`\n${ERA_ID}: ${PROVINCES.length} cities, ${FACTIONS.length} houses, ${OFFICERS.length} officers, ${ROADS.length} roads`);
console.log(fails ? `\n${fails} problem(s) found.` : '\n✓ all data-integrity checks pass.');
process.exit(fails ? 1 : 0);
