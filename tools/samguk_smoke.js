// Boot the engine on an era and start a game as each playable house.
// tools/test.js is wired to threekingdoms gameplay; this is the era-generic
// smoke test:  ERA=samguk node tools/samguk_smoke.js
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const era = process.env.ERA || 'samguk';
const root = path.join(__dirname, '..', 'js');
const eraDir = path.join(root, 'eras', era);
const load = (f) => fs.readFileSync(path.join(fs.existsSync(path.join(eraDir, f)) ? eraDir : root, f), 'utf8');
const src = ['era.js', 'data.js', 'events.js', 'hexmaps.js', 'battle.js', 'game.js', 'geo.js', 'terrain.js'].map(load).join('\n');
const ctx = { localStorage: { store: {}, getItem(k) { return this.store[k] || null; }, setItem(k, v) { this.store[k] = v; } }, console };
vm.createContext(ctx);
vm.runInContext(src + '\nthis.Game = Game; this.FACTIONS = FACTIONS; this.PROVINCES = PROVINCES; this.HEXMAPS = HEXMAPS; this.SCENARIOS = SCENARIOS;', ctx);
const baseId = (ctx.SCENARIOS.find((s) => s.base) || ctx.SCENARIOS[0]).id;

let fails = 0;
const check = (c, m) => { if (!c) { console.log('  ✗ ' + m); fails++; } };

check(Object.keys(ctx.HEXMAPS).length === ctx.PROVINCES.length, `hex maps: ${Object.keys(ctx.HEXMAPS).length} vs ${ctx.PROVINCES.length} cities`);
for (const id of Object.keys(ctx.HEXMAPS)) check(ctx.HEXMAPS[id].terrain.length === 156 && ctx.HEXMAPS[id].exits.length >= 1, `hex map ${id} malformed`);

const playable = ctx.FACTIONS.filter((f) => f.playable !== false);
for (const f of playable) {
  try {
    ctx.Game.newGame(f.id, { scenario: baseId });
    const S = ctx.Game.state();
    const owned = Object.values(S.provinces).filter((p) => p.owner === f.id).length;
    check(owned === f.cities.length, `${f.id}: owns ${owned} cities, expected ${f.cities.length}`);
    const ruler = S.officers[f.ruler];
    check(ruler && ruler.faction === f.id, `${f.id}: ruler ${f.ruler} not placed`);
    const offs = ctx.Game.factionOfficers(f.id).length;
    check(offs >= 1, `${f.id}: no officers`);
    // one turn must not throw
    for (const o of ctx.Game.factionOfficers(f.id)) o.acted = true;
    ctx.Game.endTurn();
    console.log(`  ✓ ${f.id} (${f.name}): ${owned} cities, ${offs} officers, turn ok`);
  } catch (e) {
    console.log(`  ✗ ${f.id}: ${(e.stack || e.message).split('\n').slice(0, 2).join(' | ')}`);
    fails++;
  }
}

// every scenario boots as one of its houses and takes a turn without throwing
for (const sc of ctx.SCENARIOS) {
  const houseIds = sc.houses ? Object.keys(sc.houses) : playable.map((f) => f.id);
  const fid = houseIds.find((id) => { const f = ctx.FACTIONS.find((x) => x.id === id); return !f || f.playable !== false; }) || houseIds[0];
  try {
    ctx.Game.newGame(fid, { scenario: sc.id });
    const S = ctx.Game.state();
    const owned = Object.values(S.provinces).filter((p) => p.owner).length;
    check(owned >= 1, `scenario ${sc.id}: no cities owned`);
    if (sc.houses) {
      for (const [hid, h] of Object.entries(sc.houses)) {
        if (h.ruler) { const r = S.officers[h.ruler]; check(r && r.faction === hid, `scenario ${sc.id}: ruler ${h.ruler} of ${hid} not placed`); }
      }
    }
    for (const o of ctx.Game.factionOfficers(fid)) o.acted = true;
    ctx.Game.endTurn();
    console.log(`  ✓ scenario ${sc.id} (${sc.title}) boots as ${fid}: ${owned}/${ctx.PROVINCES.length} cities placed, turn ok`);
  } catch (e) {
    console.log(`  ✗ scenario ${sc.id}: ${(e.stack || e.message).split('\n').slice(0, 2).join(' | ')}`);
    fails++;
  }
}

console.log(fails ? `\n${fails} problem(s).` : '\n✓ all playable houses + scenarios boot and take a turn.');
process.exit(fails ? 1 : 0);
