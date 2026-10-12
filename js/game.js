// ============================================================
//  Game engine: state, commands, battles, economy, AI
// ============================================================

const Game = (() => {
  const rnd = (a, b) => a + Math.random() * (b - a);
  const ri = (a, b) => Math.floor(rnd(a, b + 1));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const fmt = (n) => Math.round(n).toLocaleString('en-US');

  const ERULES = (typeof ERA !== 'undefined' && ERA.rules) || {};
  const LEGIT = ERULES.legitimacy || { enabled: true, label: '천자' };
  const COST = { develop: 200, fortify: 300, recruit: 300, reward: 200, ships: 300, pacify: 100, resettle: 600, plots: { spy: 100, incite: 500, unrest: 300, sabotage: 400, assassinate: 800 } };
  // Roads (typed, with waypoints) define adjacency
  const roadKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const ROAD_MAP = Object.fromEntries(ROADS.map((r) => [roadKey(r[0], r[1]), { type: r[2], via: r[3] || [] }]));
  const roadInfo = (a, b) => ROAD_MAP[roadKey(a, b)] || null;
  const roadType = (a, b) => { const r = roadInfo(a, b); return r ? r.type : null; };
  function buildAdj() {
    const adj = {};
    for (const p of PROVINCES) adj[p.id] = [];
    for (const [a, b] of ROADS) { adj[a].push(b); adj[b].push(a); }
    return adj;
  }
  const provData = (id) => PROVINCES.find((p) => p.id === id);
  const hasTrait = (p, t) => (p.traits || []).includes(t);
  const hasShipyard = (p) => hasTrait(p, 'river') || hasTrait(p, 'coast');
  const isNorth = (pid) => provData(pid).y < 560;
  const isSouth = (pid) => provData(pid).y > 640;
  const isWinter = () => S.month === 12 || S.month <= 2;
  const isSpring = () => S.month >= 3 && S.month <= 5;
  const isSummer = () => S.month >= 6 && S.month <= 8;
  // Economy tuning knobs
  const WALL_DIV = 1000;        // defense bonus = 1 + walls / WALL_DIV
  const FOOD_PER_AGRI = 4;     // monthly food from agriculture
  const HARVEST_MULT = 12;     // extra food per agriculture point in month 9
  const FOOD_UPKEEP = 0.1;     // food per soldier per month
  const GOLD_UPKEEP = 0.01;    // gold per soldier per month
  let quiet = false;           // suppress domestic log lines (AI turns)
  const SEASONS = ['겨울', '겨울', '봄', '봄', '봄', '여름', '여름', '여름', '가을', '가을', '가을', '겨울'];
  const MILITIA = { name: '향병', ldr: 50, war: 50, int: 40, pol: 40, chr: 40 };
  const GARRISON = { name: '수비대장', ldr: 40, war: 40, int: 35, pol: 35, chr: 35 };

  let S = null;

  // ---------- state creation ----------
  function newGame(playerId, options = {}) {
    const provinces = {};
    for (const p of PROVINCES) {
      const f = FACTIONS.find((f) => f.cities.includes(p.id));
      const t = p.tier;
      const capital = f && f.cities[0] === p.id;
      provinces[p.id] = {
        id: p.id,
        owner: f ? f.id : null,
        troops: f ? [0, 7000, 12000, 20000][t] + (capital ? 4000 : 0) : [0, 3000, 4500, 6000][t],
        gold: [0, 900, 1600, 3000][t],
        food: [0, 18000, 32000, 60000][t],
        agri: [0, 160, 260, 400][t] + ri(-30, 30),
        comm: [0, 120, 220, 340][t] + ri(-30, 30),
        defense: [0, 100, 220, 360][t],
        pop: [0, 120000, 250000, 450000][t] + ri(-20000, 20000),
        training: f ? 55 : 35,
        traits: p.traits || [],
        fleet: (p.traits || []).some((t) => t === 'river' || t === 'coast') ? (f ? 20 : 10) : 0,
        order: f ? 70 : 45, posture: 'hold',
      };
    }
    const adj = buildAdj();

    const officers = {};
    for (const o of OFFICERS) {
      officers[o[0]] = { name: o[0], ldr: o[1], war: o[2], int: o[3], pol: o[4], chr: o[5], faction: o[6], city: o[7], loyalty: o[8], born: o[9], acted: false, captive: null, skills: OFFICER_SKILLS[o[0]] || [], rank: 0 };
    }
    const factions = {};
    for (const f of FACTIONS) factions[f.id] = { id: f.id, name: f.name, ruler: f.ruler, color: f.color, aggr: f.aggr, alive: true, raider: !!f.raider, wanderer: !!f.wanderer, prestige: 0, guest: false, host: null, guestSince: 0, hasEmperor: !!f.emperor, favor: 0, household: { troops: 0, gold: 0 }, petitionUntil: 0, persona: f.persona || [], treachery: 0, lastLoss: -99, lastAttackTurn: -99, lastAttackTarget: null, plan: null, caution: 1, title: 0, phase: 'rising', attackedBy: {}, gains: [], reserve: null };

    S = {
      year: SCENARIO.year, month: SCENARIO.month, turn: 1,
      player: playerId || null, observer: !playerId, provinces, adj, officers, factions,
      diplomacy: {}, pendingProposals: [], pendingSuccession: null, favors: {}, pendingAid: [],
      options: { historicalDeaths: options.historicalDeaths !== false, difficulty: options.difficulty || 'normal' },
      pendingTitle: null, history: [], stats: { battles: 0, captures: 0, deaths: 0 },
      eventsFired: {}, objectivesDone: {}, pendingDecisions: [], battles: {},
      items: {}, arrived: {},
      log: [], notices: [], pendingCaptives: [], over: null, winner: null,
    };
    for (const [a, b, v] of INITIAL_RELATIONS) setRelation(a, b, v);
    // a base scenario (no houses block) uses the default FACTIONS/OFFICERS layout; only a dated scenario overrides it
    const sc0 = options.scenario ? SCENARIOS.find((x) => x.id === options.scenario) : null;
    if (sc0 && !sc0.base && sc0.houses) applyScenario(sc0);
    for (const it of ITEMS) { S.items[it.id] = { id: it.id, owner: null, city: it.city || null }; if (it.owner && S.officers[it.owner]) giveItem(it.id, it.owner, true); else if (it.owner) S.items[it.id].city = (OFFICERS.find((r) => r[0] === it.owner) || [])[7] || 'luoyang'; }
    if (S.observer) log('난세를 지켜보게 되었소. 각 제후는 저마다 제 갈 길을 갈 것이오.', 'sys');
    const baseId = (SCENARIOS.find((x) => x.base) || SCENARIOS[0]).id;
    const SC = SCENARIOS.find((x) => x.id === (options.scenario || baseId)) || SCENARIOS[0];
    S.scenario = SC.id;
    log(`${SC.title}. ${SC.intro}`, 'sys');
    snapshotMonth();
    const note = HISTORY_NOTES[`${S.year}-${S.month}`];
    if (note) log(note, 'hist');
    return S;
  }

  // ---------- scenarios other than 190 ----------
  function applyScenario(SC) {
    if (!SC) return;
    S.year = SC.year; S.month = SC.month;
    // everything unowned, everyone free, every house dead; then rebuild from the scenario
    for (const p of Object.values(S.provinces)) { p.owner = null; p.troops = 4000; p.order = 45; }
    for (const F of Object.values(S.factions)) { F.alive = false; F.hasEmperor = false; F.guest = false; F.host = null; }
    const deadBy = new Set(HISTORICAL_DEATHS.filter((dd) => dd[1] < SC.year || (dd[1] === SC.year && dd[2] < SC.month)).map((dd) => dd[0]));
    for (const o of Object.values(S.officers)) { o.faction = null; o.loyalty = 0; if (deadBy.has(o.name)) delete S.officers[o.name]; }
    // later officers whose year has come
    for (const r of LATER_OFFICERS) { const [name, ldr, war, int_, pol, chr, born, year, city] = r; if (year <= SC.year && !S.officers[name] && !deadBy.has(name)) { S.officers[name] = { name, ldr, war, int: int_, pol, chr, faction: null, city, loyalty: 0, born, acted: false, captive: null, skills: OFFICER_SKILLS[name] || [], rank: 0 }; S.arrived[name] = 0; } }
    const create = (name) => { const c = SCENARIO_CREATED.find((x) => x[0] === name); if (!c || S.officers[name]) return; S.officers[name] = { name, ldr: c[1], war: c[2], int: c[3], pol: c[4], chr: c[5], faction: null, city: 'luoyang', loyalty: 0, born: c[6], acted: false, captive: null, skills: OFFICER_SKILLS[name] || [], rank: 0 }; };
    for (const [fid, h] of Object.entries(SC.houses)) {
      if (h.dead) continue;
      const base = FACTIONS.find((f) => f.id === fid);
      const F = S.factions[fid] || (S.factions[fid] = { id: fid, name: h.name || fid, ruler: h.ruler, color: h.color || '#888', aggr: h.aggr || 1, alive: true, raider: false, wanderer: !!h.wanderer, prestige: 0, guest: false, host: null, guestSince: 0, hasEmperor: false, favor: 0, household: { troops: 0, gold: 0 }, petitionUntil: 0, persona: h.persona || [], treachery: 0, lastLoss: -99, lastAttackTurn: -99, lastAttackTarget: null, plan: null, caution: 1, title: 0 });
      F.alive = true; F.title = h.title || 0; F.prestige = (h.title || 0) * 12; if (h.raider) F.raider = true; if (h.persona) F.persona = h.persona; if (h.playable === false) F.playable = false;
      const rulerName = h.ruler.replace('*', '');
      if (h.ruler.endsWith('*')) create(rulerName);
      F.ruler = rulerName; F.name = h.name || (base ? base.name : rulerName);
      if (h.name && base && h.name !== base.name) F.name = h.name;
      const cities = (h.cities || []).map((c) => c.replace('?', '')).filter((c) => S.provinces[c]);
      for (const c of cities) { const p = S.provinces[c]; p.owner = fid; const tier = provData(c).tier; p.troops = Math.floor(([0, 7000, 12000, 20000][tier] + (c === cities[0] ? 4000 : 0)) * (h.garrison || 1)); p.order = 70; p.gold = [0, 900, 1600, 3000][tier]; p.food = [0, 18000, 32000, 60000][tier]; if (h.walls) p.defense = Math.min(999, p.defense + h.walls); if (h.fleet && hasShipyard(p)) p.fleet = Math.max(p.fleet || 0, h.fleet); if (h.training) p.training = h.training; }
      const seat = cities[0] || null;
      for (let n of h.officers || []) {
        const optional = n.endsWith('?'); n = n.replace(/[?*]/g, '');
        if (!S.officers[n]) { create(n); if (!S.officers[n]) continue; }
        if (optional && Math.random() < 0.5) continue;
        const o = S.officers[n]; if (o.faction && n !== rulerName) continue; o.faction = fid; o.loyalty = n === rulerName ? 100 : 80 + ri(0, 15); o.city = seat || o.city;
      }
      if (!S.officers[rulerName]) { F.alive = false; continue; }
      S.officers[rulerName].faction = fid; S.officers[rulerName].loyalty = 100;
      if (h.guestOf && S.factions[h.guestOf]) { F.guest = true; F.host = h.guestOf; F.guestSince = 0; F.favor = 50; F.household = { troops: 2000, gold: 500 }; }
      else if (!cities.length) F.alive = false;
      // spread officers a little: each city beyond the seat gets a couple
      if (cities.length > 1) { const offs = factionOfficers(fid).filter((o) => o.name !== rulerName); let i = 0; for (const c of cities.slice(1)) for (let k = 0; k < 2 && i < offs.length - 2; k++, i++) offs[offs.length - 1 - i].city = c; }
    }
    // guests sit at their host's seat
    for (const F of Object.values(S.factions)) if (F.alive && F.guest && S.factions[F.host]) { const seat = rulerOf(F.host) ? rulerOf(F.host).city : null; if (seat) for (const o of allOfficers()) if (o.faction === F.id) o.city = seat; }
    if (SC.emperor && S.factions[SC.emperor] && S.factions[SC.emperor].alive) S.factions[SC.emperor].hasEmperor = true;
    for (const [a, b, t] of SC.treaties || []) if (S.factions[a] && S.factions[b] && S.factions[a].alive && S.factions[b].alive) { const dd = dip(a, b); dd.status = t; dd.until = t === 'ceasefire' ? 24 : ALLIANCE_MONTHS; }
    for (const [a, b, v] of SC.relations || []) if (S.factions[a] && S.factions[b]) setRelation(a, b, v);
    // events whose windows have closed are treated as fired
    for (const ev of EVENTS) if (ev.to[0] < SC.year || (ev.to[0] === SC.year && ev.to[1] < SC.month)) S.eventsFired[ev.id] = true;
    // unclaimed cities get militia
    for (const p of Object.values(S.provinces)) if (!p.owner) p.troops = 4000 + provData(p.id).tier * 1000;
  }

  // ---------- helpers ----------
  const state = () => S;
  const prov = (id) => S.provinces[id];
  const off = (name) => S.officers[name];
  const fac = (id) => (id ? S.factions[id] : null);
  const pname = (id) => PROVINCES.find((p) => p.id === id).name;
  const fname = (id) => (id ? S.factions[id].name : '무주지');
  const dateStr = () => `${S.year}년 ${S.month}월`;
  const season = () => SEASONS[S.month - 1];

  function log(text, cls = '') {
    S.log.unshift({ t: `${S.year}.${S.month}`, text, cls });
    if (S.log.length > 300) S.log.length = 300;
  }
  function notice(text, cls = '', extra = {}) { S.notices.push({ text, cls, ...extra }); log(text, cls); }

  const allOfficers = () => Object.values(S.officers);
  const officersIn = (pid, fid) => allOfficers().filter((o) => o.city === pid && o.faction === fid && !o.captive);
  const freeOfficersIn = (pid) => allOfficers().filter((o) => o.city === pid && o.faction === null && !o.captive);
  const idleOfficers = (pid) => officersIn(pid, prov(pid).owner).filter((o) => !o.acted);
  const captivesIn = (pid, fid) => allOfficers().filter((o) => o.city === pid && o.captive === fid);
  const factionOfficers = (fid) => allOfficers().filter((o) => o.faction === fid && !o.captive);
  const factionProvinces = (fid) => Object.values(S.provinces).filter((p) => p.owner === fid);
  const rulerOf = (fid) => { const F = S.factions[fid]; return F ? off(F.ruler) : null; };
  const isRuler = (o) => { const F = o.faction && S.factions[o.faction]; return !!F && F.ruler === o.name; };
  const neighbors = (pid) => S.adj[pid].map(prov);
  const enemyNeighbors = (pid) => neighbors(pid).filter((n) => n.owner !== prov(pid).owner);
  const best = (list, stat, fallback) => (list.length ? Math.max(...list.map((o) => o[stat])) : fallback[stat]);
  const totalTroops = (fid) => factionProvinces(fid).reduce((s, p) => s + p.troops, 0);
  const hasSkill = (o, sk) => !!(o && o.skills && o.skills.includes(sk));
  const partyHas = (list, sk) => list.some((o) => hasSkill(o, sk));
  // officer ties
  const bondGroup = (name) => OFFICER_TIES.bonds.find((g) => g.includes(name)) || null;
  const bonded = (a, b) => { const g = bondGroup(a); return !!(g && g.includes(b) && a !== b); };
  const areEnemies = (a, b) => OFFICER_TIES.enemies.some((p) => (p[0] === a && p[1] === b) || (p[1] === a && p[0] === b));
  const areRivals = (a, b) => OFFICER_TIES.rivals.some((p) => (p[0] === a && p[1] === b) || (p[1] === a && p[0] === b));
  // the living house, other than `except`, whose ruler is bonded to this officer
  function bondedRuler(o, except) { const g = bondGroup(o.name); if (!g) return null; for (const F of Object.values(S.factions)) if (F.alive && F.id !== except && g.includes(F.ruler) && F.ruler !== o.name) return F.id; return null; }
  // titles and legitimacy
  const titleOf = (fid) => TITLES[Math.min(S.factions[fid].title || 0, TITLES.length - 1)];
  function eligibleTitle(fid) {
    const F = S.factions[fid]; const cities = factionProvinces(fid).length; let best = 0;
    for (const t of TITLES) { if (t.tier === 4) { if ((F.hasEmperor && cities >= 16) || cities >= t.cities) best = 4; } else if ((F.prestige || 0) >= t.prestige && cities >= t.cities) best = t.tier; }
    return best;
  }
  const legitimacy = (fid) => (S.factions[fid].title || 0) * 0.03;
  // difficulty multipliers
  const diff = () => (S.options && S.options.difficulty) || 'normal';
  const overextension = (fid) => Math.max(0, factionProvinces(fid).length - 16);
  const incomeMult = (fid) => (diff() === 'easy' ? (fid === S.player ? 1.2 : 0.9) : diff() === 'hard' ? (fid === S.player ? 1 : 1.2) : 1) * Math.max(0.75, 1 - 0.01 * overextension(fid));
  const governorOf = (p) => { if (!p.owner) return null; const offs = officersIn(p.id, p.owner); return offs.length ? offs.reduce((m, o) => (o.pol > m.pol ? o : m)) : null; };
  const has = (fid, t) => !!(S.factions[fid] && (S.factions[fid].persona || []).includes(t));
  const totalCities = () => Object.keys(S.provinces).length;
  // the runaway leader: a living house holding a third of the map or more
  function leaderHouse() { const n = totalCities(); const f = Object.values(S.factions).filter((x) => x.alive && !x.raider).sort((a, b) => factionProvinces(b.id).length - factionProvinces(a.id).length)[0]; return f && factionProvinces(f.id).length * 3 >= n ? f.id : null; }
  const borderTroops = (a, b) => factionProvinces(a).filter((p) => S.adj[p.id].some((n) => prov(n).owner === b)).reduce((s, p) => s + p.troops, 0);

  function fail(msg) { return { ok: false, msg }; }
  function ok(msg, cls = '') { if (!quiet) log(msg, cls); return { ok: true, msg }; }

  function useOfficer(name, pid) {
    const o = off(name);
    if (!o || o.city !== pid || o.faction !== prov(pid).owner || o.captive) return fail(`${name}은(는) 여기 없소.`);
    if (o.acted) return fail(`${name}은(는) 이번 달에 이미 움직였소.`);
    return null;
  }

  // ---------- domestic commands ----------
  function develop(pid, name, type) {
    const p = prov(pid); const e = useOfficer(name, pid); if (e) return e;
    if (p.gold < COST.develop) return fail(`금이 부족합니다 (필요${COST.develop}).`);
    const o = off(name);
    const gain = Math.floor((o.pol / 4 + ri(0, 10)) * (hasSkill(o, 'admin') ? 1.5 : 1));
    p.gold -= COST.develop;
    const key = type === 'agri' ? 'agri' : 'comm';
    const before = p[key];
    p[key] = clamp(p[key] + gain, 0, 999);
    o.acted = true;
    const label = key === 'agri' ? '농업' : '상업';
    return ok(`${o.name}이(가) ${pname(pid)}의 ${label}을(를) 일으켰소: ${before} → ${p[key]}.`);
  }

  // ---------- outstations ----------
  const sitesOf = (p) => p.sites || (p.sites = []);
  const hasSite = (p, type) => sitesOf(p).some((x) => x.type === type && !x.damaged);
  const siteName = (type) => (SITE_TYPES[type] || { label: type }).label;
  // where a kind of site could stand on the city's hex map: the right ground, outside the walls, near the roads
  function siteSpots(pid, type) {
    const m = HEXMAPS[pid]; const T = SITE_TYPES[type]; if (!m || !T) return [];
    const P = provData(pid); const p = prov(pid); const used = new Set(sitesOf(p).map((x) => `${x.c},${x.r}`));
    if (T.coast && !hasTrait(p, 'coast')) return [];
    if (T.water && !hasShipyard(p)) return [];
    if (type === 'pasture' && !(hasTrait(p, 'horses') || P.lat >= 34.5)) return [];
    const out = [];
    for (let r = 0; r < m.h; r++) for (let c = 0; c < m.w; c++) {
      const t = m.terrain[r * m.w + c]; const i = r * m.w + c; const dist = BATTLE.hexDist(c, r, 6, 5);
      if (!T.hexes.includes(t) || used.has(`${c},${r}`) || dist < T.near[0] || dist > T.near[1]) continue;
      if (T.road && m.roads[i] !== '1') continue;
      if (T.water && !BATTLE.neighbours(c, r, m.w, m.h).some(([nc, nr]) => BATTLE.navigable(m.terrain[nr * m.w + nc]))) continue;
      const nearRoad = BATTLE.neighbours(c, r, m.w, m.h).some(([nc, nr]) => m.roads[nr * m.w + nc] === '1') || m.roads[i] === '1';
      out.push({ c, r, score: dist + (nearRoad ? 0 : 1.5) });
    }
    return out.sort((a, b) => a.score - b.score);
  }
  function availableSites(pid) {
    const p = prov(pid);
    return SITE_ORDER.map((type) => { const T = SITE_TYPES[type]; const have = sitesOf(p).filter((x) => x.type === type).length; const spots = have >= T.max ? [] : siteSpots(pid, type); return { type, label: T.label, glyph: T.glyph, cost: T.cost, desc: T.desc, have, max: T.max, ok: spots.length > 0 && have < T.max, spot: spots[0] || null }; });
  }
  function buildSite(pid, name, type) {
    const p = prov(pid); const e = useOfficer(name, pid); if (e) return e;
    const a = availableSites(pid).find((x) => x.type === type);
    if (!a || !a.ok) return fail(`${pname(pid)}에 ${siteName(type)}를 세울 자리가 없습니다.`);
    if (p.gold < a.cost) return fail(`금이 부족합니다 (필요${a.cost}).`);
    p.gold -= a.cost; off(name).acted = true;
    sitesOf(p).push({ type, c: a.spot.c, r: a.spot.r, damaged: false, built: S.turn });
    return ok(`${name}이(가) ${pname(pid)} 밖에 ${siteName(type)}를 세웠습니다.`, 'good');
  }
  function repairSite(pid, name, index) {
    const p = prov(pid); const st = sitesOf(p)[index]; if (!st || !st.damaged) return fail('수리할 것이 없습니다.');
    const e = useOfficer(name, pid); if (e) return e;
    const cost = Math.floor(SITE_TYPES[st.type].cost / 2); if (p.gold < cost) return fail(`금이 부족합니다 (필요${cost}).`);
    p.gold -= cost; off(name).acted = true; st.damaged = false;
    return ok(`${name}이(가) ${pname(pid)} 밖의 ${siteName(st.type)}를 재건했습니다.`, 'good');
  }
  const siteGold = (p) => sitesOf(p).reduce((a, x) => a + (x.damaged ? 0 : (SITE_TYPES[x.type].gold || 0)), 0);
  const siteFood = (p) => sitesOf(p).filter((x) => x.type === 'village' && !x.damaged).length * SITE_TYPES.village.food * (hasTrait(p, 'grain') ? 1.25 : 1);
  const buildCost = (p, base, kind) => Math.floor(base * (kind === 'walls' && hasSite(p, 'mine') ? 0.8 : 1) * (hasSite(p, 'lumber') ? 0.7 : 1));
  // a raider's loot from an outstation, and its ruin
  function sackSiteFor(B, i, u) {
    const p = prov(B.city); const st = sitesOf(p)[i]; if (!st) return null;
    const home = prov(B.att.from); const T = SITE_TYPES[st.type]; const name = T.label.toLowerCase(); let text = '', food = 0;
    st.damaged = true;
    const loot = (gold) => { if (home && home.owner === B.attF) home.gold += gold; text = `금 ${fmt(gold)} 약탈`; };
    if (st.type === 'mine') loot(400 + ri(0, 200));
    else if (st.type === 'salt') loot(500 + ri(0, 200));
    else if (st.type === 'market') { loot(300 + ri(0, 200)); const F = S.factions[B.attF]; if (F) F.prestige = clamp((F.prestige || 0) - 3, 0, 100); text += '; 약탈한 자의 수치로 기억된다'; }
    else if (st.type === 'docks') { loot(150 + ri(0, 100)); p.fleet = Math.max(0, (p.fleet || 0) - 30); text += ', 배가 불탄다'; }
    else if (st.type === 'lumber') loot(100 + ri(0, 100));
    else if (st.type === 'village') { food = Math.min(p.food, 2000 + ri(0, 1000)); p.food -= food; p.pop = Math.max(1000, Math.floor(p.pop * 0.98)); text = `곡식 ${fmt(food)} 약탈, 백성이 쫓겨남`; }
    else if (st.type === 'pasture') { if (home && home.owner === B.attF) home.training = clamp(home.training + 5, 0, 100); loot(100 + ri(0, 100)); text += ', 가축을 끌고 감'; }
    else if (st.type === 'tower') text = '봉화대가 무너짐';
    if (p.owner === S.player || B.attF === S.player) notice(`${pname(B.city)} 밖의 ${name}이(가) ${fname(B.attF)}에게 약탈당했습니다.`, B.attF === S.player ? 'good' : 'bad');
    return { name, text, food };
  }
  function fortify(pid, name) {
    const p = prov(pid); const e = useOfficer(name, pid); if (e) return e;
    const cost = buildCost(p, COST.fortify, 'walls');
    if (p.gold < cost) return fail(`금이 부족합니다 (필요${cost}).`);
    const o = off(name);
    const gain = Math.floor(o.ldr / 4 + ri(0, 8));
    p.gold -= cost;
    const before = p.defense;
    p.defense = clamp(p.defense + gain, 0, 999);
    o.acted = true;
    return ok(`${o.name}이(가) ${pname(pid)}의 성벽을 강화했습니다: ${before} → ${p.defense}.`);
  }

  function train(pid, name) {
    const p = prov(pid); const e = useOfficer(name, pid); if (e) return e;
    const o = off(name);
    const gain = Math.floor(o.ldr / 8 + o.war / 20 + ri(0, 3));
    const before = p.training;
    p.training = clamp(p.training + gain, 0, 100);
    o.acted = true;
    return ok(`${o.name}이(가) ${pname(pid)} 병사들을 조련하였소: 훈련 ${before} → ${p.training}.`);
  }

  function recruitTroops(pid, name) {
    const p = prov(pid); const e = useOfficer(name, pid); if (e) return e;
    const rc = COST.recruit * (diff() === 'hard' && p.owner === S.player ? 1.3 : 1);
    if (p.gold < rc) return fail(`금이 부족합니다 (필요${Math.round(rc)}).`);
    if (p.pop < 30000) return fail('백성이 너무 적어 징병할 수 없소.');
    if ((p.order || 0) < 30) return fail(`${pname(pid)}은(는) 민심이 흉흉하오 (치안 ${p.order}). 먼저 민심을 수습하소서.`);
    const o = off(name);
    let n = Math.floor(((o.ldr + o.chr) / 2) * 25 + ri(0, 400));
    n = Math.floor(n * Math.min(1, 0.3 + (p.order || 0) / 100));
    const horses = hasTrait(p, 'horses');
    if (horses) n = Math.floor(n * 1.25);
    n = Math.min(n, Math.floor(p.pop * 0.04));
    p.gold -= Math.round(rc);
    p.pop -= Math.floor(n * 0.7);
    // green recruits dilute training (frontier riders less so)
    p.training = Math.round((p.training * p.troops + (horses || hasSite(p, 'pasture') ? 45 : 30) * n) / (p.troops + n));
    p.troops += n;
    o.acted = true;
    return ok(`${o.name}이(가) ${pname(pid)}에서 병사 ${fmt(n)}을(를) 모았소.`);
  }

  function search(pid, name) {
    const p = prov(pid); const e = useOfficer(name, pid); if (e) return e;
    const o = off(name);
    o.acted = true;
    const hidden = hiddenItemsIn(pid);
    if (hidden.length && Math.random() < 0.12 + o.int / 400) {
      const it = hidden[0];
      giveItem(it.id, o.name, true);
      const text = `${o.name}이(가) ${pname(pid)}를 뒤지다 ${it.name}을(를) 찾아냈소! ${it.desc}`;
      if (p.owner === S.player) notice(text, 'good'); else log(text, 'good');
      return { ok: true, msg: text };
    }
    const r = Math.random();
    if (r < 0.12) {
      const food = Math.floor(o.int * 20 + ri(0, 1500));
      p.food += food;
      return ok(`${o.name}이(가) ${pname(pid)}에서 숨겨진 창고를 찾아냈소: 군량 +${fmt(food)}.`);
    }
    const gold = Math.floor(o.int * 2 + ri(0, 250));
    p.gold += gold;
    return ok(`${o.name}이(가) ${pname(pid)}를 수색하여 세금과 공물로 금 ${fmt(gold)}을(를) 거두었소.`);
  }

  function recruitChance(recruiter, target, rulerChr, fid) {
    const diff = (target.ldr + target.war + target.int + target.pol + target.chr) / 5;
    const F = fid ? S.factions[fid] : null;
    const bonus = F ? (F.prestige || 0) / 400 + (F.hasEmperor ? 0.1 : 0) : 0;
    return clamp(((recruiter.chr + rulerChr) / 2 + 40 - diff) / 100 + bonus, 0.1, 0.95);
  }

  function recruitOfficer(pid, name, targetName) {
    const p = prov(pid); const e = useOfficer(name, pid); if (e) return e;
    const o = off(name); const t = off(targetName);
    if (!t || t.faction !== null || t.city !== pid) return fail(`${targetName}은(는) 여기에서 등용할 수 없소.`);
    o.acted = true;
    if (areEnemies(t.name, rulerOf(p.owner).name)) return ok(`${t.name}은(는) ${rulerOf(p.owner).name}님께는 결코 벼슬하지 않겠다 하오.`, 'bad');
    const kin = bondedRuler(t, p.owner); if (kin) return ok(`${t.name}은(는) 의형제이신 ${fname(kin)}님께서 다른 곳에 계시니 벼슬을 사양하오.`, 'bad');
    const chance = recruitChance(o, t, rulerOf(p.owner).chr, p.owner) + (hasSkill(o, 'orator') ? 0.15 : 0) + legitimacy(p.owner);
    if (Math.random() < chance) {
      t.faction = p.owner; t.loyalty = 60 + ri(0, 20);
      return ok(`${t.name}이(가) ${o.name}의 권유로 ${fname(p.owner)}께 귀순하였소!`, 'good');
    }
    return ok(`${t.name}이(가) ${o.name}의 청을 정중히 사양하였소.`, 'bad');
  }

  // Restore order in a restless city.
  function pacify(pid, name) {
    const p = prov(pid); const e = useOfficer(name, pid); if (e) return e;
    if (p.gold < COST.pacify) return fail(`금이 부족합니다 (필요${COST.pacify}).`);
    const o = off(name);
    let gain = Math.floor(3 + o.pol / 6 + o.chr / 10 + ri(0, 4));
    if (hasSkill(o, 'admin') || hasSkill(o, 'orator')) gain = Math.floor(gain * 1.5);
    p.gold -= COST.pacify; const before = p.order; p.order = clamp(p.order + gain, 0, 100); o.acted = true;
    return ok(`${o.name}이(가) ${pname(pid)}의 송사를 다스리고 굶주린 백성을 구휼하였소: 치안 ${before} → ${p.order}.`);
  }
  const popCapOf = (p) => [0, 260000, 520000, 900000][provData(p.id).tier];
  // Bring settlers to empty land: the answer to a countryside bled white by decades of levies
  function resettle(pid, name) {
    const p = prov(pid); const e = useOfficer(name, pid); if (e) return e;
    if (p.gold < COST.resettle) return fail(`금이 부족합니다 (필요${COST.resettle}).`);
    if (p.order < 40) return fail('법도 없는 고을에 정착할 백성은 없소. 먼저 치안을 바로잡으소서.');
    const cap = popCapOf(p); if (p.pop >= cap * 0.95) return fail(`${pname(pid)}은(는) 이미 땅이 먹일 수 있을 만큼 가득 찼소.`);
    const o = off(name);
    const gain = Math.min(cap - p.pop, Math.floor(cap * 0.006 + o.pol * 25 + ri(0, 800)) * (hasSkill(o, 'admin') ? 1.4 : 1));
    p.gold -= COST.resettle; const before = p.pop; p.pop += Math.floor(gain); p.order = clamp(p.order + 1, 0, 100); o.acted = true;
    return ok(`${o.name}이(가) ${pname(pid)}의 빈 들에 유민을 불러 모았소: 인구 ${fmt(before)} → ${fmt(p.pop)}.`);
  }
  function setPosture(pid, posture) {
    const p = prov(pid); if (!['hold', 'sally', 'ambush'].includes(posture)) return fail('알 수 없는 태세이오.');
    p.posture = posture; return { ok: true, msg: `${pname(pid)}은(는) ${posture === 'hold' ? '성문을 굳게 지킬 것이오' : posture === 'sally' ? '성 밖으로 나가 싸울 것이오' : '매복하여 적을 기다릴 것이오'}.` };
  }
  // Court ranks: cost gold, lift loyalty and set a floor under it. The ruler's title limits how many generals and marshals he may name.
  function appoint(pid, name) {
    const p = prov(pid); const o = off(name);
    if (!o || o.city !== pid || o.faction !== p.owner) return fail('그 장수가 여기 없습니다.');
    if (isRuler(o)) return fail('주공께서는 벼슬을 내리시는 분이시니 따로 품계가 없소.');
    const next = (o.rank || 0) + 1; if (next >= RANKS.length) return fail(`${o.name}은(는) 이미 최고 품계에 올랐소.`);
    const cost = RANK_COST[next]; if (p.gold < cost) return fail(`금이 부족합니다 (필요${cost}).`);
    if (next >= 2) { const slots = titleOf(p.owner).slots; const held = factionOfficers(p.owner).filter((x) => (x.rank || 0) >= 2 && x.name !== o.name).length; if (held >= slots) return fail(`${titleOf(p.owner).name}의 위로는 장수와 대장군을 ${slots}명까지만 둘 수 있소. 더 높은 작위를 먼저 얻으소서.`); }
    p.gold -= cost; o.rank = next; o.loyalty = clamp(o.loyalty + 10, 0, 100);
    return ok(`${o.name}을(를) ${RANKS[next]}에 봉하였소. 충성심이 ${o.loyalty}까지 올랐소.`, 'good');
  }
  const loyaltyFloor = (o) => (o.rank ? 40 + 15 * o.rank : 0);
  // Assume a title the house is entitled to. Jealous lords cool toward the claimant.
  function assumeTitle(fid, tier) {
    const F = S.factions[fid]; const elig = eligibleTitle(fid);
    if (tier > elig) return fail('아직 그 작위를 칭할 만한 공업이 쌓이지 않았소.');
    if (tier <= (F.title || 0)) return fail('이미 그 이상의 작위를 지니고 계시오.');
    F.title = tier; F.prestige = clamp((F.prestige || 0) + 5 * tier, 0, 100);
    for (const f of Object.keys(S.factions)) if (f !== fid && S.factions[f].alive) shiftRelation(fid, f, tier === 4 ? -30 : -5 * tier);
    S.pendingTitle = null;
    const text = tier === 4 ? `${rulerOf(fid).name}께서 황위에 올라 새 왕조를 선포하셨소! 뭇 제후들은 참칭이라 비난하오.` : `${rulerOf(fid).name}께서 ${TITLES[tier].name}의 작위를 칭하셨소.`;
    notice(text, 'hist', { major: tier >= 3 });
    return { ok: true, msg: text };
  }
  function processTitles() {
    for (const F of Object.values(S.factions)) {
      if (!F.alive || F.raider || F.guest) continue;
      const elig = eligibleTitle(F.id);
      if (elig <= (F.title || 0)) continue;
      if (F.id === S.player) { if (!S.pendingTitle) S.pendingTitle = { fid: F.id, tier: elig }; continue; }
      const p = has(F.id, 'cautious') ? 0.35 : has(F.id, 'reckless') || has(F.id, 'treacherous') ? 0.9 : 0.7;
      if (Math.random() < p / 6) assumeTitle(F.id, elig);
    }
  }
  // AI ranks: honour the best officers when rich
  function aiAppoint(fid) {
    for (const p of factionProvinces(fid)) {
      if (p.gold < 2500) continue;
      const cand = officersIn(p.id, fid).filter((o) => !isRuler(o) && (o.rank || 0) < 3 && o.loyalty < 90).sort((a, b) => (b.war + b.ldr) - (a.war + a.ldr))[0];
      if (cand) appoint(p.id, cand.name);
    }
  }

  // ---------- plots: schemes against a neighbouring city ----------
  const plotTargets = (pid) => { const p = prov(pid); return neighbors(pid).filter((n) => n.owner && n.owner !== p.owner && canAttack(p.owner, n.owner)); };
  function plot(pid, name, targetCity, kind, targetOfficer) {
    const p = prov(pid); const e = useOfficer(name, pid); if (e) return e;
    const t = prov(targetCity);
    if (!plotTargets(pid).some((x) => x.id === targetCity)) return fail('그 고을은 계략을 쓸 수 있는 대상이 아니오.');
    const cost = COST.plots[kind]; if (cost == null) return fail('알 수 없는 계략.');
    if (p.gold < cost) return fail(`금이 부족합니다 (필요${cost}).`);
    const o = off(name); const me = p.owner, them = t.owner;
    p.gold -= cost; o.acted = true;
    const skill = o.int / 100 + (hasSkill(o, 'stratagem') ? 0.1 : 0);
    const detected = (base) => Math.random() < base;
    if (kind !== 'spy' && hasSite(t, 'tower') && Math.random() < 0.5) { shiftRelation(me, them, -10); return ok(`${pname(targetCity)} 망루의 파수꾼이 길 위에서 ${o.name}의 세작을 잡았소. ${fname(them)}과의 관계가 나빠졌소.`, 'bad'); }
    if (kind === 'spy') {
      const hidden = hiddenItemsIn(targetCity).map((it) => it.name);
      const offs = officersIn(targetCity, them).sort((a, b) => a.loyalty - b.loyalty);
      const weakest = offs[0];
      return ok(`${o.name}의 세작이 ${pname(targetCity)}에서 보고하였소: 치안 ${t.order}, 병사 ${fmt(t.troops)}, 성벽 ${t.defense}, 수군 ${t.fleet || 0}, 금 ${fmt(t.gold)}과 군량 ${fmt(t.food)}. ${weakest ? `${weakest.name}이(가) 그곳 장수 중 가장 불만이 크오 (충성 ${weakest.loyalty}).` : '지키는 장수가 없소.'} ${hidden.length ? '그곳에 숨겨진 보물이 있다는 소문이 있소: ' + hidden.join(', ') + '.' : '보물이 있다는 소문은 없소.'}`, 'good');
    }
    if (kind === 'unrest') {
      const drop = Math.floor(6 + skill * 20 + ri(0, 6)); t.order = clamp(t.order - drop, 0, 100);
      if (detected(0.4)) { shiftRelation(me, them, -10); return ok(`${o.name}의 세작이 ${pname(targetCity)}에 유언비어를 퍼뜨렸소: 치안 -${drop}. 배후가 드러나 ${fname(them)}과의 관계가 나빠졌소.`, 'good'); }
      return ok(`${o.name}의 세작이 ${pname(targetCity)}에 유언비어를 퍼뜨렸소: 치안 -${drop}. 누가 사주했는지 아무도 모른다 하오.`, 'good');
    }
    if (kind === 'sabotage') {
      const w = Math.floor(t.defense * (0.08 + skill * 0.08)), f = Math.floor(t.food * (0.1 + skill * 0.1));
      t.defense -= w; t.food -= f;
      const standing = sitesOf(t).filter((x) => !x.damaged); if (standing.length && Math.random() < 0.4) { const st = pick(standing); st.damaged = true; log(`${o.name}의 군사들이 ${pname(targetCity)} 밖의 ${siteName(st.type).toLowerCase()}을(를) 불태웠소.`, 'strat'); }
      if (detected(0.45)) { shiftRelation(me, them, -15); return ok(`${o.name}의 군사들이 ${pname(targetCity)}의 창고에 불을 지르고 성벽을 허물었소: 성벽 -${w}, 군량 -${fmt(f)}. 발각되어 ${fname(them)}과의 관계가 나빠졌소.`, 'good'); }
      return ok(`${o.name}의 군사들이 ${pname(targetCity)}의 창고에 불을 지르고 성벽을 허물었소: 성벽 -${w}, 군량 -${fmt(f)}.`, 'good');
    }
    const tgt = off(targetOfficer);
    if (!tgt || tgt.city !== targetCity || tgt.faction !== them || tgt.captive) return fail('그 장수는 목표 고을에 없소.');
    if (kind === 'incite') {
      if (isRuler(tgt)) return fail('주공을 주공께 맞서도록 부추길 수는 없소.');
      if (bondGroup(tgt.name) && bondedRuler(tgt, me) === them) return fail(`${tgt.name}은(는) 주공께 의리로 맹세한 몸이오.`);
      const chance = clamp((o.int - tgt.loyalty) / 100 + 0.25 + (hasSkill(o, 'orator') ? 0.1 : 0) + legitimacy(me), 0.03, 0.85);
      if (Math.random() < chance) {
        tgt.faction = me; tgt.city = pid; tgt.loyalty = 55 + ri(0, 15); tgt.rank = 0;
        shiftRelation(me, them, -20);
        return ok(`${o.name}의 밀서가 통한 것이오: ${tgt.name}이(가) 밤을 틈타 ${pname(targetCity)}를 빠져나와 ${pname(pid)}의 그대에게 왔소!`, 'good');
      }
      tgt.loyalty = clamp(tgt.loyalty + 5, 0, 100);
      if (detected(0.4)) shiftRelation(me, them, -15);
      return ok(`${tgt.name}이(가) ${o.name}의 밀서를 읽지도 않고 불태웠소. 그 충성심이 더욱 굳어졌소.`, 'bad');
    }
    if (kind === 'assassinate') {
      const chance = clamp(skill * 0.35 * ((110 - tgt.ldr) / 100) - (guarded(tgt) ? 0.1 : 0), 0.02, 0.3);
      if (Math.random() < chance) {
        shiftRelation(me, them, -40);
        const spoils = itemsOf(tgt.name);
        killOfficer(tgt, `${pname(targetCity)}에서 자객의 칼에 쓰러짐`, false);
        return ok(`${o.name}의 자객이 ${pname(targetCity)}에서 ${tgt.name}을(를) 찾아 일을 해냈소${spoils.length ? ', 다만 ' + spoils.map((it) => it.name).join('와 ') + '은(는) 혼란 중에 잃어버렸소' : ''}. 온 천하가 그대를 의심할 것이오.`, 'good');
      }
      shiftRelation(me, them, -30);
      if (Math.random() < 0.5) { o.captive = them; o.city = targetCity; S.pendingCaptives.push({ name: o.name, captor: them, city: targetCity, from: me }); return ok(`자객이 실패하여 고문 끝에 자백하였소. ${o.name}이(가) 배후로 지목되어 ${pname(targetCity)}에 갇혔소!`, 'bad'); }
      return ok(`자객이 ${tgt.name}의 문 앞에서 베임을 당했소. ${o.name}은(는) 달아났으나 ${fname(them)}은(는) 누가 보냈는지 알게 되었소.`, 'bad');
    }
    return fail('알 수 없는 계략.');
  }
  function aiPlots(fid) {
    if (!has(fid, 'schemer') && !has(fid, 'treacherous')) return;
    const F = S.factions[fid]; if (!F.plan || !F.plan.enemy) return;
    const p = prov(F.plan.hammer); if (!p || p.owner !== fid || p.gold < 1500 || Math.random() > 0.2) return;
    const t = prov(F.plan.target); if (!t.owner || !plotTargets(p.id).some((x) => x.id === t.id)) return;
    const o = idleOfficers(p.id).sort((a, b) => b.int - a.int)[0]; if (!o || o.int < 70) return;
    const weak = officersIn(t.id, t.owner).filter((x) => !isRuler(x) && x.loyalty < 60).sort((a, b) => a.loyalty - b.loyalty)[0];
    if (weak && p.gold >= COST.plots.incite) plot(p.id, o.name, t.id, 'incite', weak.name);
    else if (t.order > 40 && p.gold >= COST.plots.unrest) plot(p.id, o.name, t.id, 'unrest');
  }

  // Buy food from merchants. No officer needed. Rate worsens the more you buy at once.
  function buyFood(pid, gold) {
    const p = prov(pid);
    gold = Math.floor(gold);
    if (gold <= 0 || gold > p.gold) return fail('가지고 있는 금보다 많이 쓸 수는 없소.');
    const rate = gold > 2000 ? 3 : gold > 800 ? 4 : 5;
    const food = gold * rate;
    p.gold -= gold; p.food += food;
    return ok(`${pname(pid)} 상인이 금 ${fmt(gold)}에 군량 ${fmt(food)}을(를) 내주었소.`);
  }

  function buildShips(pid, name) {
    const p = prov(pid); const e = useOfficer(name, pid); if (e) return e;
    if (!hasShipyard(p)) return fail(`${pname(pid)}에는 배를 띄울 강과 바다가 없소.`);
    const cost = buildCost(p, COST.ships, 'ships');
    if (p.gold < cost) return fail(`금이 부족합니다 (필요${cost}).`);
    if (p.fleet >= 100) return fail('수군은 이미 충실하오.');
    const o = off(name);
    const gain = Math.floor(o.ldr / 6 + o.int / 10 + ri(0, 5)) * (hasSite(p, 'docks') ? 2 : 1);
    p.gold -= cost;
    const before = p.fleet;
    p.fleet = clamp(p.fleet + gain, 0, 100);
    o.acted = true;
    return ok(`${o.name}이(가) ${pname(pid)}에서 전선을 지었소: 수군 ${before} → ${p.fleet}.`);
  }

  // Terrain, fleets and season modifiers for an attack from one city to a neighbour.
  function battleModifiers(fromId, toId) {
    const from = prov(fromId), to = prov(toId);
    const type = roadType(fromId, toId);
    const m = { type, att: 1, def: 1, loss: 0, blocked: null, notes: [] };
    if (!type) return m;
    if (type === 'pass') {
      m.def *= 1.3; m.notes.push('산길 관문: 수비가 1.30배가 되오.');
      if (isWinter() && isNorth(fromId) && isNorth(toId)) m.blocked = '눈이 관문을 막았소. 봄까지 기다리시게.';
    } else if (type === 'river' && isWinter() && isNorth(fromId) && isNorth(toId)) {
      m.frozen = true; m.notes.push('강이 얼었소. 대군이 얼음 위를 건너가니 수군은 무용지물이오.');
    } else if (type === 'river' || type === 'sea') {
      const af = from.fleet || 0, df = to.fleet || 0;
      const sea = type === 'sea';
      const flood = !sea && isSummer();
      const attF = sea ? 0.5 + af / 200 : flood ? 0.6 + af / 250 : 0.7 + af / 333;
      const defF = sea ? 1 + df / 400 : 1 + df / 500;
      m.att *= attF; m.def *= defF;
      const need = sea ? 40 : 30;
      if (af < need) m.loss = (sea ? 0.15 : 0.1) * (1 - af / need) * (flood ? 1.3 : 1);
      if (flood) m.notes.push('여름이라 강물이 불었소. 배가 그 어느 때보다 중요하오.');
      m.notes.push(`${sea ? '바닷길' : '강 건너기'}: 공격 ×${attF.toFixed(2)} (수군 ${af}), 수비 ×${defF.toFixed(2)} (수군 ${df}).`);
      if (m.loss > 0.005) m.notes.push(`배가 모자라오. 건너는 중에 대군의 ${Math.round(m.loss * 100)}%가량을 잃을 것이오.`);
    }
    if (isSummer() && isSouth(toId)) { m.att *= 0.85; m.notes.push('남쪽 장마철이오: 공격이 0.85배가 되오.'); }
    const gov = governorOf(to);
    if (gov && gov.ldr >= 60) { m.def *= 1 + gov.ldr / 1000; m.notes.push(`태수 ${gov.name}이(가) 수비를 정돈하였소: ×${(1 + gov.ldr / 1000).toFixed(2)}.`); }
    return m;
  }

  function reward(pid, targetName) {
    const p = prov(pid); const t = off(targetName);
    if (!t || t.city !== pid || t.faction !== p.owner) return fail('그 장수가 여기 없습니다.');
    if (p.gold < COST.reward) return fail(`금이 부족합니다 (필요${COST.reward}).`);
    if (t.loyalty >= 100) return fail(`${t.name}은(는) 이미 한마음으로 충성하고 있소.`);
    p.gold -= COST.reward;
    const before = t.loyalty;
    t.loyalty = clamp(t.loyalty + 8 + ri(0, 6), 0, 100);
    return ok(`${t.name}이(가) 하사품을 받았소. 충성 ${before} → ${t.loyalty}.`);
  }

  function transfer(fromId, toId, { troops = 0, gold = 0, food = 0, officers = [] }) {
    const a = prov(fromId), b = prov(toId);
    if (a.owner !== b.owner || !a.owner) return fail('아군의 고을로만 옮길 수 있소.');
    if (!S.adj[fromId].includes(toId)) return fail('이어진 고을로만 옮길 수 있소.');
    troops = Math.floor(troops); gold = Math.floor(gold); food = Math.floor(food);
    if (troops > a.troops || gold > a.gold || food > a.food || troops < 0 || gold < 0 || food < 0) return fail('그만큼의 병량과 재물이 없소.');
    if (troops > 0 && officers.length === 0) return fail('병사를 움직이려면 이끄는 장수가 있어야 하오.');
    for (const n of officers) { const e = useOfficer(n, fromId); if (e) return e; }
    if (S.battles && S.battles[toId] && troops > 0) {   // the city is under siege: the column joins the defence within one to ten days
      const B = S.battles[toId];
      for (const n of officers) off(n).acted = true;
      a.troops -= troops; a.gold -= gold; a.food -= food;
      BATTLE.addArrival(B, { side: 'D', fid: a.owner, from: fromId, troops, food, officers, training: a.training, days: ri(1, 10), exit: battleExitToward(toId, fromId) });
      log(`${fname(a.owner)}이(가) ${pname(fromId)}에서 ${pname(toId)} 구원으로 군사 ${fmt(troops)}을(를) 보냈소.`, 'war');
      return ok(`병사 ${fmt(troops)}이(가) ${pname(fromId)}를 떠나 포위된 ${pname(toId)} 구원으로 향하오. 열흘 안에 당도할 것이오.`);
    }
    if (officers.length >= officersIn(fromId, a.owner).length && officersIn(fromId, a.owner).length > 0 && troops < a.troops) {
      // allowed, but the city will be left with no officer
    }
    a.troops -= troops; b.troops += troops;
    a.gold -= gold; b.gold += gold;
    a.food -= food; b.food += food;
    if (troops > 0) b.training = Math.round((b.training * (b.troops - troops) + a.training * troops) / b.troops);
    for (const n of officers) { const o = off(n); o.city = toId; o.acted = true; }
    const parts = [];
    if (troops) parts.push(`병사 ${fmt(troops)}`);
    if (gold) parts.push(`금 ${fmt(gold)}`);
    if (food) parts.push(`군량 ${fmt(food)}`);
    if (officers.length) parts.push(officers.join(', '));
    return ok(`${pname(fromId)}에서 ${pname(toId)}으로 ${parts.join(', ')}을(를) 옮겼소.`);
  }

  // ---------- battle ----------
  function attack(fromId, toId, officerNames, troops, tactics = {}) {
    const a = prov(fromId), b = prov(toId);
    if (!a.owner) return fail('주인이 없는 땅이오.');
    if (b.owner === a.owner) return fail('아군의 고을은 칠 수 없소.');
    if (!S.adj[fromId].includes(toId)) return fail('이어진 고을로만 출병할 수 있소.');
    if (b.owner && !canAttack(a.owner, b.owner)) return fail(`${fname(b.owner)}와는 ${treatyStatus(a.owner, b.owner)} 중이오. 먼저 외교로 파기하소서.`);
    if (S.battles && S.battles[toId]) return fail(`${pname(toId)}은(는) 이미 포위 중이오.`);
    const mods = battleModifiers(fromId, toId);
    if (mods.blocked) return fail(mods.blocked);
    troops = Math.floor(troops);
    if (troops <= 0 || troops > a.troops) return fail('병사 수가 바르지 않소.');
    if (!officerNames.length) return fail('대군을 이끌 장수를 정하시게.');
    if (officerNames.length > 3) return fail('한 대군에 장수는 셋까지만 둘 수 있소.');
    for (const n of officerNames) { const e = useOfficer(n, fromId); if (e) return e; }
    if (a.food < troops * 0.1) return fail('원정에 쓸 군량이 모자라오 (병사 수의 10%가 필요하오).');
    a.food -= Math.floor(troops * 0.1);
    const A = S.factions[a.owner];
    A.lastAttackTurn = S.turn; A.lastAttackTarget = b.owner;
    if (b.owner) { const dd = dip(a.owner, b.owner); if (dd.expiredAt && dd.proposer === a.owner && S.turn - dd.expiredAt <= 3) { A.treachery = (A.treachery || 0) + 1; dd.expiredAt = 0; log(`${fname(a.owner)}이(가) 휴전이 끝나자마자 ${fname(b.owner)}을(를) 쳤소. 뭇 제후들이 이를 기억할 것이오.`, 'bad'); } }
    if (tacticalOn() && HEXMAPS[toId]) return startBattle(fromId, toId, officerNames, troops, tactics);
    const report = resolveBattle(fromId, toId, officerNames, troops, { tactics });
    return { ok: true, report };
  }

  function resolveBattle(fromId, toId, officerNames, troops, opts = {}) {
    const from = prov(fromId), to = prov(toId);
    const attF = opts.attF || from.owner, defF = to.owner;
    const external = !!opts.external;
    const attOfficers = officerNames.map(off);
    const defOfficers = defF ? officersIn(toId, defF) : [];
    const tactics = opts.tactics || {};
    const stance = ['assault', 'siege', 'feint', 'standard'].includes(tactics.stance) ? tactics.stance : 'standard';
    // defender posture: the player sets a standing order; AI houses decide on the day
    let posture = to.posture || 'hold';
    if (defF && defF !== S.player) {
      const bestInt = defOfficers.length ? Math.max(...defOfficers.map((o) => o.int)) : 0;
      posture = bestInt >= 85 && Math.random() < 0.5 ? 'ambush' : to.troops >= troops * 1.1 && Math.random() < 0.5 ? 'sally' : 'hold';
    }
    const R = { from: fromId, to: toId, attacker: attF, defender: defF, attOfficers: officerNames, defOfficers: defOfficers.map((o) => o.name), lines: [], result: null, captives: [] };
    const L = (text, cls = '') => R.lines.push({ text, cls });
    for (const o of attOfficers) o.acted = true;

    let a = troops, d = to.troops;
    const a0 = a, d0 = d;
    if (!external) from.troops -= troops;
    R.startA = a0; R.startD = d0;
    const fromTraining = external ? 60 : from.training;
    const mods = battleModifiers(fromId, toId);
    mods.external = external;
    R.mods = mods;

    const aFallback = MILITIA, dFallback = defF ? GARRISON : MILITIA;
    const aWar = best(attOfficers, 'war', aFallback), aLdr = best(attOfficers, 'ldr', aFallback), aInt = best(attOfficers, 'int', aFallback);
    const dWar = best(defOfficers, 'war', dFallback), dLdr = best(defOfficers, 'ldr', dFallback), dInt = best(defOfficers, 'int', dFallback);
    const aIntName = attOfficers.length ? attOfficers.reduce((m, o) => (o.int > m.int ? o : m)).name : '공격군';
    const dIntName = defOfficers.length ? defOfficers.reduce((m, o) => (o.int > m.int ? o : m)).name : '수비군';

    L(`${fname(attF)}이(가) ${pname(fromId)}에서 병사 ${fmt(a0)}을(를) 일으켜 ${pname(toId)}를 치오 (${fname(defF)}, 수비 ${fmt(d0)}, 성벽 ${to.defense}).`, 'head');
    L(`장수: ${officerNames.join(', ')} 대 ${defOfficers.length ? R.defOfficers.join(', ') : dFallback.name}.`);
    for (const n of mods.notes) L(n, 'terrain');
    let aMorale = 1, dMorale = 1;
    // stances, postures and skills
    let stanceAtt = 1, stanceLoss = 1, wallMult = 1, stratMultA = 1, stratMultD = 1, postureDef = 1, ambushRounds = 0;
    if (stance === 'assault') { stanceAtt = 1.15; stanceLoss = 1.2; L('공격군이 정면으로 성벽에 달려드오: 무력 ×1.15, 피해 ×1.2.', 'strat'); }
    if (stance === 'siege') { wallMult *= 0.7; stanceAtt = 0.9; L('공격군이 충차와 굴로 성을 에워쌌소: 성벽이 30% 무력해지고 무력 ×0.9, 싸움이 길어질 것이오.', 'strat'); }
    if (stance === 'feint') { stratMultA *= 2; stanceAtt = 0.92; L('공격군이 허실을 보이며 틈을 노리나니 모략이 두 배로 통하기 쉽고 무력 ×0.92가 되오.', 'strat'); }
    if (partyHas(attOfficers, 'siege')) { wallMult *= 0.7; L(`${attOfficers.find((o) => hasSkill(o, 'siege')).name}의 공성술: 성벽이 30% 무력해지오.`, 'strat'); }
    if (partyHas(attOfficers, 'cavalry')) { const horse = hasTrait(from, 'horses') || mods.frozen; stanceAtt *= horse ? 1.15 : 1.08; L(`${attOfficers.find((o) => hasSkill(o, 'cavalry')).name}이(가) 기병을 이끌었소: 무력 ×${horse ? '1.15' : '1.08'}.`, 'strat'); }
    if (partyHas(attOfficers, 'stratagem')) stratMultA *= 1.6;
    if (partyHas(defOfficers, 'stratagem')) stratMultD *= 1.6;
    if (partyHas(defOfficers, 'guardian')) { postureDef *= 1.1; L(`${defOfficers.find((o) => hasSkill(o, 'guardian')).name}이(가) 성벽을 지켰소: 수비 ×1.1.`, 'strat'); }
    if (defOfficers.length && posture === 'hold') { postureDef *= 1.08; L('수비군이 성벽을 굳게 지켰소: 수비 ×1.08.', 'strat'); }
    if (defOfficers.length && posture === 'sally') { postureDef *= 0.92; stanceLoss *= 1.25; L('수비군이 성 밖으로 나와 맞섰소: 수비 ×0.92, 공격군 피해 ×1.25.', 'strat'); }
    if (defOfficers.length && posture === 'ambush') { if (dInt > aInt) { ambushRounds = 2; L(`${dIntName}이(가) 길목에 매복을 깔았소!`, 'strat'); } else { postureDef *= 0.95; L('수비군이 매복하였으나 공격군이 이를 간파하였소: 수비 ×0.95.', 'strat'); } }
    // a chosen stratagem, if the commander is clever enough
    let scheme = tactics.stratagem && aInt >= 75 ? tactics.stratagem : 'auto';
    if (scheme === 'fire' && isWinter()) { scheme = 'auto'; L('날이 춥고 습하여 화계는 어렵소. 장수가 임기응변으로 나서오.', 'strat'); }
    if (scheme === 'flood' && !(mods.type === 'river' && (from.fleet || 0) >= 40)) scheme = 'auto';
    let schemeUsed = false;
    if (scheme === 'discord' && defOfficers.length) {
      const weak = defOfficers.filter((o) => !isRuler(o) && o.loyalty < 60 && !bondGroup(o.name)).sort((x, y) => x.loyalty - y.loyalty)[0];
      if (weak && Math.random() < 0.25 + (aInt - weak.loyalty) / 200) { weak.faction = attF; weak.city = external ? fromId : fromId; weak.loyalty = 55; L(`${aIntName}이(가) 이간계를 썼소: ${weak.name}이(가) 내통하여 싸우기도 전에 공격군에 붙었소!`, 'strat'); defOfficers.splice(defOfficers.indexOf(weak), 1); R.defOfficers = defOfficers.map((o) => o.name); }
      else L(`${aIntName}의 밀서가 수비군에 통하지 않았소.`, 'strat');
      dMorale *= 0.9; schemeUsed = true;
    }
    if (mods.loss > 0.005) {
      const drowned = Math.round(a * mods.loss);
      a -= drowned;
      L(`강을 건너기도 전에 병사 ${fmt(drowned)}을(를) 물에 잃었소.`, 'bad');
    }

    if (attOfficers.length && defOfficers.length && Math.random() < 0.45) {
      const ca = attOfficers.reduce((m, o) => (o.war > m.war ? o : m));
      const cd = defOfficers.reduce((m, o) => (o.war > m.war ? o : m));
      L(`${ca.name}이(가) 성 앞에 말을 몰고 나와 ${cd.name}에게 일기토를 청했소!`, 'duel');
      const pA = clamp(Math.pow(ca.war, 3) / (Math.pow(ca.war, 3) + Math.pow(cd.war, 3)) + duelBonus(ca) - duelBonus(cd), 0.05, 0.95);
      const bouts = ri(3, 60);
      if (Math.random() < pA) {
        dMorale = 0.82;
        L(`${bouts}합을 겨룬 끝에 ${ca.name}이(가) ${cd.name}을(를) 말에서 떨어뜨렸소! 수비군의 사기가 흔들리나이다.`, 'duel');
        if (Math.random() < 0.08 && !guarded(cd)) { const spoils = itemsOf(cd.name); L(`${cd.name}이(가) 전장에서 전사하였소!`, 'bad'); for (const it of spoils) { giveItem(it.id, ca.name, true); L(`${ca.name}이(가) 전사자의 ${it.name}을(를) 거두었소.`, 'good'); } killOfficer(cd, `${pname(toId)} 앞에서 ${ca.name}과의 일기토에 패하여 전사`); }
      } else {
        aMorale = 0.82;
        L(`${bouts}합을 겨룬 끝에 ${cd.name}이(가) ${ca.name}을(를) 물리쳤소! 공격군이 기가 꺾였소.`, 'duel');
        if (Math.random() < 0.08 && !guarded(ca)) { const spoils = itemsOf(ca.name); L(`${ca.name}이(가) 전장에서 전사하였소!`, 'bad'); for (const it of spoils) { giveItem(it.id, cd.name, true); L(`${cd.name}이(가) 전사자의 ${it.name}을(를) 거두었소.`, 'good'); } killOfficer(ca, `${pname(toId)} 앞에서 ${cd.name}과의 일기토에 패하여 전사`); }
      }
    }

    const maxRounds = stance === 'siege' ? 16 : 12;
    for (let r = 1; r <= maxRounds; r++) {
      const aPow = a * (0.5 + aWar / 100) * (0.7 + aLdr / 250) * (0.7 + fromTraining / 300) * aMorale * mods.att * stanceAtt;
      const dPow = d * (0.5 + dWar / 100) * (0.7 + dLdr / 250) * (0.7 + to.training / 300) * (1 + (to.defense * wallMult) / WALL_DIV) * dMorale * mods.def * postureDef;
      let dmgD = aPow * 0.075 * rnd(0.8, 1.2);
      let dmgA = dPow * 0.075 * rnd(0.8, 1.2) * stanceLoss;
      let note = '';
      if (ambushRounds > 0) { dmgA *= 1.6; ambushRounds--; note = ` ${pick(['산기슭', '갈대밭', '무너진 농가'])}에서 화살과 돌이 비 오듯 쏟아지오. 매복이 적중하였소!`; }
      if (!schemeUsed && scheme === 'fire' && Math.random() < (aInt - dInt + 30) / 200) { dmgD *= 2.5; schemeUsed = true; note = ` ${aIntName}의 화공이오! 불길이 ${pick(['진영', '창고', '포위망'])}을(를) 삼키니 수비군이 혼비백산하였소.`; }
      else if (!schemeUsed && scheme === 'flood' && r === 1) { dmgD *= 2.2; wallMult *= 0.7; schemeUsed = true; note = ` ${aIntName}이(가) 둑을 터뜨렸소. 강물이 ${pname(toId)}로 쏟아져 성벽이 무너졌소!`; }
      else if (!note && aInt > dInt && Math.random() < ((aInt - dInt) / 140) * stratMultA) {
        dmgD *= 1.9; note = ` ${aIntName}의 ${pick(['화공', '야습', '거짓 퇴각', '성문 파괴'])}에 수비군이 대혼란에 빠졌소!`;
      } else if (!note && dInt > aInt && Math.random() < ((dInt - aInt) / 140) * stratMultD) {
        dmgA *= 1.9; note = ` ${dIntName}이(가) ${pick(['매복', '기습 출격', '낙석과 화살의 함정'])}으로 공격군을 덮쳤소!`;
      }
      a = Math.max(0, Math.round(a - dmgA));
      d = Math.max(0, Math.round(d - dmgD));
      L(`${r}차전: 공격군 ${fmt(a)}, 수비군 ${fmt(d)}.${note}`, note ? 'strat' : '');
      if (d <= 0) { R.result = 'captured'; break; }
      if (a <= 0) { R.result = 'annihilated'; break; }
      if (a < a0 * 0.2) { R.result = 'retreat'; L('대군이 너무 지쳐 더는 싸울 수 없소. 물러나오.', 'bad'); break; }
    }
    if (!R.result) { R.result = 'retreat'; L('포위가 길어지나 결판이 나지 않았소. 공격군이 물러나오.', 'bad'); }

    R.endA = a; R.endD = d;
    to.troops = d;
    settleBattle(R, a, a0, attOfficers, defOfficers, external);
    return R;
  }

  // What happens after the fighting, shared by the abstract battle and the tactical one: the city changes hands
  // or the attackers go home, then the record, relations, reputation and reports.
  function settleBattle(R, a, a0, attOfficers, defOfficers, external) {
    const from = prov(R.from), to = prov(R.to); const attF = R.attacker, defF = R.defender; const fromId = R.from, toId = R.to;
    const L = (text, cls = '') => R.lines.push({ text, cls });
    if (R.result === 'captured' && S.factions[attF].raider) {
      R.result = 'raided';
      const loot = Math.floor(to.gold * 0.6), grain = Math.floor(to.food * 0.4);
      to.gold -= loot; to.food -= grain; to.pop = Math.floor(to.pop * 0.95);
      to.defense = Math.max(0, Math.floor(to.defense * 0.8)); to.order = clamp((to.order || 50) - 15, 0, 100);
      from.gold += loot; from.food += grain; from.troops += a;
      L(`${fname(attF)}의 기병이 ${pname(toId)}를 약탈하여 금 ${fmt(loot)}과 군량 ${fmt(grain)}을(를) 빼앗아 초원으로 사라졌소.`, 'bad');
    } else if (R.result === 'captured') {
      captureCity(R, attOfficers, defOfficers, a);
    } else {
      if (external) S.factions[attF].household.troops += a; else from.troops += a;
      if (R.result === 'annihilated') {
        L(`${fname(attF)}의 대군이 ${pname(toId)} 성 아래에서 전멸하였소!`, 'bad');
        // commanders scatter home
      } else {
        L(`${fname(attF)}이(가) 살아남은 ${fmt(a)}을(를) 이끌고 ${pname(fromId)}로 물러났소.`, 'bad');
      }
      // wall damage from the siege
      to.defense = Math.max(0, to.defense - ri(5, 25));
    }
    const summary = R.result === 'captured'
      ? `${fname(attF)}이(가) ${fname(defF)}에게서 ${pname(toId)}를 빼앗았소!`
      : R.result === 'raided'
        ? `${fname(attF)}의 기병이 ${pname(toId)} (${fname(defF)})를 약탈하였소!`
        : `${fname(attF)}의 ${pname(toId)} 공격이 ${fname(defF)}에게 막혔소.`;
    log(summary, 'war');
    S.stats.battles++; if (R.result === 'captured') S.stats.captures++;
    if (defF) shiftRelation(attF, defF, -25);
    if (defF) { S.factions[defF].attackedBy = S.factions[defF].attackedBy || {}; S.factions[defF].attackedBy[attF] = S.turn; }
    if (R.result === 'captured') { const A = S.factions[attF]; A.gains = (A.gains || []).filter((t) => S.turn - t < 36); A.gains.push(S.turn); }
    if (R.result === 'captured' || R.result === 'raided') { if (defF) S.factions[defF].lastLoss = S.turn; }
    else { S.factions[attF].lastLoss = S.turn; S.factions[attF].caution = Math.min(1.5, (S.factions[attF].caution || 1) + 0.15); }
    if (R.result === 'captured' && a > a0 * 0.7) S.factions[attF].caution = Math.max(0.85, (S.factions[attF].caution || 1) - 0.1);
    if (attF === S.player || defF === S.player || (S.observer && R.result !== 'retreat' && R.result !== 'annihilated')) S.notices.push({ text: summary, cls: 'war', report: R });
  }

  function captureCity(R, attOfficers, defOfficers, remaining) {
    const to = prov(R.to), from = prov(R.from);
    const attF = R.attacker, defF = R.defender && S.factions[R.defender] ? R.defender : null;
    const L = (text, cls = '') => R.lines.push({ text, cls });
    L(`${pname(R.to)}의 성문이 열렸소! ${fname(attF)}이(가) 성을 차지하였소.`, 'good');

    to.owner = attF;
    to.troops = remaining;
    to.order = clamp(25 + (has(attF, 'honourable') ? 10 : 0) - (has(attF, 'treacherous') ? 5 : 0), 0, 100);
    to.posture = 'hold';
    to.training = R.mods && R.mods.external ? 60 : from.training;
    to.defense = Math.max(0, Math.floor(to.defense * 0.7));
    to.pop = Math.floor(to.pop * 0.95);
    // a beloved lord's people follow him: part of the population leaves with the defeated house
    if (defF && rulerOf(defF) && rulerOf(defF).chr >= 88 && !S.factions[defF].raider) {
      const leaving = Math.floor(to.pop * 0.06); to.pop -= leaving;
      const dest = factionProvinces(defF).filter((q) => q.id !== R.to).sort((a, b) => (S.adj[R.to].includes(b.id) ? 1 : 0) - (S.adj[R.to].includes(a.id) ? 1 : 0))[0];
      if (dest) { dest.pop += leaving; dest.food += Math.floor(leaving / 10); L(`${pname(R.to)} 백성 ${fmt(leaving)}이(가) ${rulerOf(defF).name}님을 따라 ${pname(dest.id)}로 향했소.`); }
      else { const F = S.factions[defF]; F.household = F.household || { troops: 0, gold: 0 }; F.household.troops += Math.floor(leaving / 25); L(`${pname(R.to)} 백성이 ${rulerOf(defF).name}님을 따라 황야로 향하니 젊은이들이 병사가 되어 따르오.`); }
    }
    for (const o of attOfficers) o.city = R.to;

    // captives previously held here by the old owner are freed: home if their house lives, else masterless
    for (const c of captivesIn(R.to, defF)) {
      c.captive = null;
      if (c.faction && S.factions[c.faction].alive && factionProvinces(c.faction).length) { c.city = nearestOwnedCity(R.to, c.faction).id; L(`${c.name}이(가) 옥에서 풀려나 ${fname(c.faction)}께 돌아갔소.`); }
      else { c.faction = null; c.loyalty = 0; L(`${c.name}이(가) 옥에서 풀려났소.`); }
    }

    if (defF) {
      const remainingCities = factionProvinces(defF);
      const destroyed = remainingCities.length === 0;
      // a wandering lord slips away with most of his companions rather than being taken
      const exile = destroyed && S.factions[defF].wanderer;
      const flight = destroyed && !exile && S.adj[R.to].some((n) => !prov(n).owner);   // a masterless city next door: the remnant seizes it
      const escapees = [];
      // officers of a fallen city nearly always get away when a friendly city lies next door; with no such refuge, only six in ten
      const friendlyNext = S.adj[R.to].some((n) => prov(n).owner === defF);
      const pFlee = friendlyNext ? 0.95 : 0.6;
      for (const o of defOfficers.filter((x) => S.officers[x.name])) {
        const ruler = isRuler(o);
        const swift = canEscape(o);
        if ((exile || flight) && (swift || Math.random() < (ruler ? 0.9 : 0.6))) {
          escapees.push(o);
        } else if (!destroyed && (swift || Math.random() < (ruler ? Math.max(pFlee, 0.75) : pFlee))) {
          const refuge = nearestOwnedCity(R.to, defF);
          o.city = refuge.id;
          L(`${o.name}이(가) ${pname(refuge.id)}로 달아났소${swift ? ', 명마를 타고' : ''}.`);
        } else if (destroyed && !ruler && Math.random() < 0.35) {
          o.faction = null; o.loyalty = 0;
          o.city = pick(Object.keys(S.provinces).filter((id) => id !== R.to));
          L(`${o.name}이(가) 몸을 숨겨 자취를 감추었소.`);
        } else {
          o.captive = attF; o.city = R.to;
          R.captives.push(o.name);
          L(`${o.name}이(가) 사로잡혔소!`, 'good');
        }
      }
      if (flight && escapees.some(isRuler) && fleeToEmpty(defF, R.to, R.startD * 0.3, to.gold * 0.3)) {
        L(`${fname(defF)}은(는) 아직 끝나지 않았소. 가문의 잔당이 무주지를 향해 말을 몰았소.`, 'head');
      } else if (exile && escapees.length && (goGuest(defF, R.to, attF, R.startD * 0.2, to.gold * 0.2) || fleeToEmpty(defF, R.to, R.startD * 0.3, to.gold * 0.3))) {
        const F = S.factions[defF];
        if (!escapees.some(isRuler)) { const heir = escapees.reduce((m, o) => (heirScore(defF, o) > heirScore(defF, m) ? o : m)); F.ruler = heir.name; F.name = F.dynasty || heir.name; heir.loyalty = 100; L(`주공을 잃었으나 ${heir.name}이(가) 가문의 잔당을 이끌게 되었소.`, 'head'); }
        to.gold = Math.floor(to.gold * 0.8);
        L(`${escapees.map((o) => o.name).join(', ')}이(가) 충직한 병사 ${fmt(Math.floor(R.startD * 0.2))}을(를) 이끌고 ${pname(rulerOf(F.host).city)}로 달아나 ${fname(F.host)}의 객장이 되었소.`, 'head');
        S.notices.push({ text: `${fname(defF)}이(가) 마지막 고을을 잃고 ${fname(F.host)}의 품에 기대어 살게 되었소.`, cls: 'hist', major: true });
      } else if (destroyed) {
        S.factions[defF].alive = false;
        L(`${fname(defF)} 가문은 이제 없소!`, 'head');
        log(`${fname(defF)}이(가) ${fname(attF)}에게 망하였소.`, 'hist');
        // any captives held elsewhere by the destroyed faction go free
        for (const o of allOfficers()) if (o.captive === defF) { o.captive = null; o.faction = null; }
        // ruler stops being anyone's ruler; a captured ruler is treated like any officer
        for (const o of allOfficers()) if (o.faction === defF && !o.captive) { o.faction = null; o.loyalty = 0; }
        S.notices.push({ text: `${fname(defF)}이(가) ${fname(attF)}에게 망하였소.`, cls: 'hist', major: true });
      }
    }
    for (const n of R.captives) S.pendingCaptives.push({ name: n, captor: attF, city: R.to, from: defF });
    // the Emperor follows the city
    if (defF && S.factions[defF].hasEmperor && rulerOf(defF) && rulerOf(defF).city === R.to) {
      S.factions[defF].hasEmperor = false; S.factions[attF].hasEmperor = true;
      L(`${cap(LEGIT.label)}이(가) ${fname(attF)}의 손에 들어갔소!`, 'head');
      notice(`${cap(LEGIT.label)}께서 ${fname(attF)}의 품에 들어가셨소.`, 'hist', { major: true });
    }
    // guests sheltering here move on with their host, or find a new one
    for (const g of allOfficers().filter((o) => o.city === R.to && o.faction && o.faction !== attF && o.faction !== defF && !o.captive)) {
      const G = S.factions[g.faction];
      if (!G || !G.alive || !G.guest) continue;
      if (G.host === defF && factionProvinces(defF).length) { g.city = nearestOwnedCity(R.to, defF).id; }
      else if (!goGuest(g.faction, R.to, attF)) dissolveHouse(g.faction);
    }
  }

  // A lord who loses his last city may seize a masterless one next door with the remnant of his army instead of vanishing.
  function fleeToEmpty(fid, fromCity, troops = 0, gold = 0) {
    const F = S.factions[fid]; if (!F || !F.alive || factionProvinces(fid).length) return false;
    const empty = S.adj[fromCity].map(prov).filter((p) => !p.owner).sort((a, b) => a.troops - b.troops)[0];
    if (!empty) return false;
    empty.owner = fid; empty.troops = Math.floor(empty.troops * 0.5 + troops); empty.gold += Math.floor(gold); empty.order = Math.max(empty.order || 45, 55); empty.posture = 'hold';
    for (const o of allOfficers()) if (o.faction === fid && !o.captive) o.city = empty.id;
    F.lastLoss = S.turn;
    notice(`${fname(fid)}이(가) ${pname(fromCity)}에서 쫓겨나 잔당을 이끌고 무주 ${pname(empty.id)}를 차지하였소.`, 'hist', { major: fid === S.player });
    return true;
  }

  // ---------- wandering houses: exile as a guest ----------
  function goGuest(fid, fromCity, exclude, troops = 0, gold = 0, forced = null) {
    const F = S.factions[fid];
    const candidates = Object.values(S.factions).filter((h) => h.alive && !h.raider && !h.guest && h.id !== fid && h.id !== exclude && factionProvinces(h.id).length);
    if (!candidates.length) return false;
    const near = candidates.filter((h) => S.adj[fromCity].some((n) => prov(n).owner === h.id));
    const pool = near.length ? near : candidates;
    // a wanderer prefers hosts who hold the cities of his destiny, and kinsmen of his own surname
    const dest = destinyTargets(fid);
    const kin = (h) => rulerOf(h.id) && familyName(rulerOf(h.id).name) === familyName(rulerOf(fid) ? rulerOf(fid).name : F.ruler);
    const hostScore = (h) => { const seat = rulerOf(h.id) ? rulerOf(h.id).city : factionProvinces(h.id)[0].id; const weakNear = neighbors(seat).filter((n) => n.owner !== h.id && (!n.owner || n.troops < 6000)).length; return relation(fid, h.id) + weakNear * 12 + factionProvinces(h.id).length * 3 + factionProvinces(h.id).filter((p) => dest.has(p.id)).length * 15 + (kin(h) ? 12 : 0); };
    const host = forced && S.factions[forced] && S.factions[forced].alive && factionProvinces(forced).length ? S.factions[forced] : pool.reduce((m, h) => (hostScore(h) > hostScore(m) ? h : m));
    const seat = rulerOf(host.id) ? rulerOf(host.id).city : factionProvinces(host.id)[0].id;
    for (const o of allOfficers()) if (o.faction === fid && !o.captive) { o.city = seat; o.acted = true; }
    const wasGuest = F.guest;
    // a born wanderer like Liu Bei may fall four times before the land gives him up; other lords twice
    if (!wasGuest) { F.exiles = (F.exiles || 0) + 1; if (!F.wanderer && F.exiles > 2) { log(`${F.name}은(는) 세 번이나 모든 것을 잃었소. 더는 받아주는 제후가 없을 것이오.`, 'hist'); return false; } }
    F.guest = true; F.host = host.id; F.guestSince = S.turn; F.favor = kin(host) ? 62 : 50; F.petitionUntil = 0;
    F.household = F.household || { troops: 0, gold: 0 };
    F.household.troops += Math.floor(troops); F.household.gold += Math.floor(gold);
    shiftRelation(fid, host.id, 15);
    log(`${fname(fid)}이(가) ${pname(seat)}에서 ${fname(host.id)}의 객장이 되었소${F.household.troops ? `, 충직한 병사 ${fmt(F.household.troops)}과 함께` : ''}.`, 'hist');
    return true;
  }
  function wake(fid, cityId) {
    const F = S.factions[fid];
    if (!F.alive) return;
    const patron = F.guest && F.host && S.factions[F.host] && S.factions[F.host].alive && prov(cityId).owner === F.host ? F.host : null;   // a fief granted by the host makes a vassal, not a rival
    if (prov(cityId).owner !== fid) transferCity(cityId, fid);
    for (const o of allOfficers()) if (o.faction === fid && !o.captive && prov(o.city).owner !== fid) { o.city = cityId; }
    const p = prov(cityId);
    if (F.household) { p.troops += F.household.troops; p.gold += F.household.gold; F.household = { troops: 0, gold: 0 }; }
    if (patron) { const d = dip(fid, patron); d.status = 'alliance'; d.until = S.turn + 60; setRelation(fid, patron, Math.max(relation(fid, patron), 40)); }
    if (F.guest) log(`${fname(fid)}이(가) ${fname(F.host)}의 조정을 떠나 ${pname(cityId)}에 깃발을 세웠소.`, 'hist');
    F.guest = false; F.host = null; F.favor = 0;
  }
  const hostSeat = (fid) => {
    const F = S.factions[fid]; const r = rulerOf(fid); const H = F.host && S.factions[F.host];
    if (H && H.alive) { if (r && prov(r.city).owner === F.host) return r.city; const h = rulerOf(F.host); if (h) return h.city; const c = factionProvinces(F.host)[0]; if (c) return c.id; }
    return r ? r.city : Object.keys(S.provinces)[0];
  };
  function useGuestOfficer(fid, name) {
    const F = S.factions[fid]; const o = off(name);
    if (!F || !F.guest) return fail('그대의 가문은 유랑 중이 아니오.');
    if (!o || o.faction !== fid || o.captive) return fail(`${name}은(는) 그대의 가문 사람이 아니오.`);
    if (o.acted) return fail(`${name}은(는) 이번 달에 이미 움직였소.`);
    if (prov(o.city).owner !== F.host) return fail(`${name}은(는) 주인의 조정에 있지 않소.`);
    return null;
  }
  // ---- exile actions ----
  function exileServe(fid, name) {
    const e = useGuestOfficer(fid, name); if (e) return e;
    const F = S.factions[fid], o = off(name), p = prov(o.city);
    const key = p.agri <= p.comm ? 'agri' : 'comm';
    const gain = Math.floor(o.pol / 8 + ri(0, 5));
    p[key] = clamp(p[key] + gain, 0, 999);
    if (o.war >= 70) p.training = clamp(p.training + Math.floor(o.ldr / 16), 0, 100);
    const fav = Math.floor(2 + o.pol / 25 + (o.chr >= 80 ? 1 : 0));
    F.favor = clamp(F.favor + fav, 0, 100);
    const stipend = 60 + o.pol;
    F.household.gold += stipend;
    o.acted = true;
    return ok(`${o.name}이(가) ${pname(p.id)}에서 ${fname(F.host)}님을 섬겼소. 총애 +${fav}, 가문에 금 ${stipend}의 녹봉이 들었소.`);
  }
  function petitionChance(fid, o) {
    const F = S.factions[fid]; const cities = factionProvinces(F.host).length;
    return clamp((F.favor - 45) / 100 + o.chr / 400 + o.pol / 500 + (F.prestige || 0) / 300 + (cities - 2) * 0.05, 0.03, 0.85);
  }
  function exilePetition(fid, name) {
    const e = useGuestOfficer(fid, name); if (e) return e;
    const F = S.factions[fid], o = off(name);
    if (F.petitionUntil > S.turn) return fail(`${fname(F.host)}께서는 ${F.petitionUntil - S.turn}개월 동안 청을 듣지 않으시겠다 하오.`);
    const hostCities = factionProvinces(F.host);
    if (hostCities.length < 2) return fail(`${fname(F.host)}께는 고을이 하나뿐이라 내어줄 땅이 없소.`);
    o.acted = true; F.petitionUntil = S.turn + 6;
    if (S.factions[F.host].phase && S.factions[F.host].phase !== 'rising') { F.favor = clamp(F.favor - 3, 0, 100); return ok(`${fname(F.host)}께서는 반천하를 다스리시며 객장에게 봉토를 내리지 않으시오. ${o.name}은(는) 빈말만 듣고 돌아왔소. 총애 -3.`, 'bad'); }
    if (Math.random() < petitionChance(fid, o)) {
      const seat = hostSeat(fid);
      const dest = destinyTargets(fid);
      const exposure = (p) => neighbors(p.id).filter((n) => n.owner !== F.host && n.owner !== fid && (!n.owner || canAttack(n.owner, F.host))).length;
      const grant = hostCities.filter((p) => p.id !== seat).sort((a, b) => (dest.has(b.id) ? 1 : 0) - (dest.has(a.id) ? 1 : 0) || exposure(a) - exposure(b) || a.troops - b.troops)[0];
      const host = F.host;
      wake(fid, grant.id);
      shiftRelation(fid, host, 20);
      concludeTreaty(fid, host, 'ceasefire');
      const msg = `${o.name}이(가) 가문을 위해 간청하니 ${fname(host)}께서 ${pname(grant.id)}를 봉토로 내리셨소. ${fname(fid)}은(는) 다시 주공이 되셨소!`;
      (fid === S.player || S.observer) ? notice(msg, 'hist', { major: true }) : log(msg, 'hist');
      return { ok: true, msg };
    }
    F.favor = clamp(F.favor - 5, 0, 100);
    return ok(`${o.name}이(가) 봉토를 청하였으나 ${fname(F.host)}께서는 빈말로 미루셨소. 총애 -5.`, 'bad');
  }
  function exileRecruit(fid, name, targetName) {
    const e = useGuestOfficer(fid, name); if (e) return e;
    const o = off(name), t = off(targetName);
    if (!t || t.faction !== null || t.city !== o.city) return fail(`${targetName}은(는) 여기에서 등용할 수 없소.`);
    o.acted = true;
    if (Math.random() < recruitChance(o, t, rulerOf(fid).chr, fid)) { t.faction = fid; t.loyalty = 60 + ri(0, 20); return ok(`${t.name}이(가) 유랑 중인 ${fname(fid)} 가문에 몸을 맡겼소.`, 'good'); }
    return ok(`${t.name}은(는) 고을 없는 주공은 따르지 않겠다 하오.`, 'bad');
  }
  function exileRaise(fid, name) {
    const e = useGuestOfficer(fid, name); if (e) return e;
    const F = S.factions[fid], o = off(name);
    if (F.household.gold < 150) return fail('의병을 일으키려면 가문에 금 150이 있어야 하오.');
    const n = Math.floor(((o.ldr + o.chr) / 2) * 15 + ri(0, 200) + (F.prestige || 0) * 5);
    F.household.gold -= 150; F.household.troops += n; o.acted = true;
    const seat = prov(hostSeat(fid));
    let note = '';
    if (F.household.troops > seat.troops * 0.5) { F.favor = clamp(F.favor - 3, 0, 100); note = ` ${fname(F.host)}께서 늘어나는 진영을 못마땅히 여기시오 (총애 -3).`; }
    return ok(`${o.name}이(가) 가문의 깃발 아래 의병 ${fmt(n)}을(를) 모았소 (도합 ${fmt(F.household.troops)}).${note}`);
  }
  function exileFight(fid, name) {
    const e = useGuestOfficer(fid, name); if (e) return e;
    const F = S.factions[fid], o = off(name), p = prov(o.city);
    const enemies = neighbors(p.id).filter((n) => n.owner !== F.host && (!n.owner || treatyStatus(F.host, n.owner) === 'neutral'));
    if (!enemies.length) return fail(`${fname(F.host)}께는 ${pname(p.id)} 근처에 싸울 적이 없소.`);
    o.acted = true;
    const power = (o.war + o.ldr) / 2;
    if (Math.random() < 0.35 + power / 200) {
      const fav = Math.floor(4 + power / 20); F.favor = clamp(F.favor + fav, 0, 100);
      F.prestige = clamp((F.prestige || 0) + 2, 0, 100);
      p.training = clamp(p.training + 3, 0, 100);
      return ok(`${o.name}이(가) ${fname(F.host)}님의 기병을 이끌고 ${pname(pick(enemies).id)}에서 온 도적 떼를 무찌르고 수급을 안고 돌아왔소. 총애 +${fav}, 위신 +2.`, 'good');
    }
    F.household.troops = Math.max(0, F.household.troops - Math.floor(F.household.troops * 0.05));
    return ok(`${o.name}이(가) ${fname(F.host)}님의 변경에서 싸웠으나 별 소득이 없었소.`);
  }
  function exileSeekPatron(fid, name, newHost) {
    const e = useGuestOfficer(fid, name); if (e) return e;
    const F = S.factions[fid], H = S.factions[newHost];
    if (!H || !H.alive || H.raider || H.guest || newHost === fid || newHost === F.host || !factionProvinces(newHost).length) return fail('그 분께는 몸을 맡길 수 없소.');
    const old = F.host;
    shiftRelation(fid, old, -15);
    const seat = rulerOf(newHost) ? rulerOf(newHost).city : factionProvinces(newHost)[0].id;
    for (const o of allOfficers()) if (o.faction === fid && !o.captive) { o.city = seat; o.acted = true; }
    F.host = newHost; F.favor = 40; F.guestSince = S.turn; F.petitionUntil = S.turn + 3;
    F.prestige = clamp((F.prestige || 0) - 3, 0, 100);
    shiftRelation(fid, newHost, 10);
    const msg = `${fname(fid)}이(가) ${fname(old)}님께 하직하고 ${pname(seat)}의 ${fname(newHost)} 조정으로 말을 몰았소.`;
    log(msg, 'hist');
    return { ok: true, msg };
  }
  function exileTargets(fid) {
    const F = S.factions[fid]; const seat = hostSeat(fid);
    return neighbors(seat).filter((n) => n.owner !== F.host && canAttack(fid, n.owner) && !battleModifiers(seat, n.id).blocked);
  }
  function exileSeize(fid, toId, officerNames, troops) {
    const F = S.factions[fid];
    if (!F.guest) return fail('그대의 가문은 유랑 중이 아니오.');
    for (const n of officerNames) { const e = useGuestOfficer(fid, n); if (e) return e; }
    if (!officerNames.length || officerNames.length > 3) return fail('장수를 한 명에서 셋까지 정하시게.');
    const seat = hostSeat(fid);
    if (!exileTargets(fid).some((t) => t.id === toId)) return fail('여기서는 그 고을을 칠 수 없소.');
    troops = Math.floor(troops);
    if (troops <= 0 || troops > F.household.troops) return fail('가문의 병사가 모자라오.');
    F.household.troops -= troops;
    const report = resolveBattle(seat, toId, officerNames, troops, { attF: fid, external: true });
    if (report.result === 'captured') {
      wake(fid, toId);
      notice(`${fname(fid)}이(가) 가문의 병사로 ${pname(toId)}를 빼앗고 다시 주공이 되셨소!`, 'hist', { major: true });
    }
    return { ok: true, report };
  }
  function aiExile(fid) {
    const F = S.factions[fid];
    const H = S.factions[F.host];
    if (!H || !H.alive || !factionProvinces(F.host).length) { const at = rulerOf(fid) ? rulerOf(fid).city : null; if (!at || !goGuest(fid, at, F.host)) dissolveHouse(fid); return; }
    const seat = hostSeat(fid);
    const idle = () => factionOfficers(fid).filter((o) => !o.acted && prov(o.city).owner === F.host);
    // seize a weak neighbour when the household can take it
    const targets = exileTargets(fid);
    // do not seize a town that a giant next door will take straight back
    const safe = targets.filter((t) => !neighbors(t.id).some((n) => n.owner && n.owner !== F.host && n.owner !== t.owner && canAttack(n.owner, fid) && n.troops > F.household.troops * 2));
    if (safe.length && F.household.troops >= 3000) {
      const others = idle().filter((o) => !isRuler(o));
      const party = (others.length ? others : idle()).sort((a, b) => b.war - a.war).slice(0, 3);
      if (party.length) {
        const dest = destinyTargets(fid); const fated = safe.filter((x) => dest.has(x.id));
        const t = (fated.length ? fated : safe).reduce((m, x) => (defStrength(x) < defStrength(m) ? x : m));
        const m = battleModifiers(seat, t.id);
        const bar = dest.size && !dest.has(t.id) ? 1.7 : 1.25;   // a lord with a destiny does not scatter his strength on stray towns
        if (attStrength(F.household.troops * (1 - m.loss), party, { training: 60 }) * m.att > defStrength(t) * m.def * bar) { exileSeize(fid, t.id, party.map((o) => o.name), F.household.troops); if (!F.guest) return; }
      }
    }
    if (F.favor < 12 && Math.random() < 0.5) {
      const alt = Object.values(S.factions).filter((h) => h.alive && !h.raider && !h.guest && h.id !== fid && h.id !== F.host && factionProvinces(h.id).length).sort((a, b) => relation(fid, b.id) - relation(fid, a.id))[0];
      const o = idle()[0];
      if (alt && o) { exileSeekPatron(fid, o.name, alt.id); return; }
    }
    for (const o of idle()) {
      const free = freeOfficersIn(o.city);
      if (free.length && o.chr >= 70) { exileRecruit(fid, o.name, free[0].name); continue; }
      if (F.favor >= 60 && F.petitionUntil <= S.turn && factionProvinces(F.host).length >= 2 && !(S.factions[F.host].phase && S.factions[F.host].phase !== 'rising') && Math.random() < 0.6) { exilePetition(fid, o.name); continue; }
      if (F.household.gold >= 150 && F.household.troops < 12000 && o.ldr >= 70 && Math.random() < 0.5) { exileRaise(fid, o.name); continue; }
      if (o.war >= 80 && Math.random() < 0.4 && neighbors(o.city).some((n) => n.owner !== F.host)) { exileFight(fid, o.name); continue; }
      exileServe(fid, o.name);
    }
  }
  function dissolveHouse(fid) {
    const F = S.factions[fid];
    if (!F || !F.alive) return;
    F.alive = false; F.guest = false; F.host = null;
    for (const p of factionProvinces(fid)) { p.owner = null; p.troops = Math.floor(p.troops * 0.5); }
    for (const o of allOfficers()) { if (o.captive === fid) { o.captive = null; o.faction = null; } if (o.faction === fid && !o.captive) { o.faction = null; o.loyalty = 0; } }
    S.pendingCaptives = S.pendingCaptives.filter((c) => c.captor !== fid);
  }
  // Move a city to another owner (or to no one). Officers of the old owner in it are left masterless.
  function transferCity(cityId, toFid) {
    const p = prov(cityId); const prev = p.owner;
    if (prev === toFid) return;
    p.owner = toFid;
    for (const o of allOfficers()) if (o.city === cityId && o.faction === prev && prev && !o.captive && toFid !== prev) { o.faction = null; o.loyalty = 0; }
    if (prev && S.factions[prev].alive && !factionProvinces(prev).length && !S.factions[prev].guest) {
      if (!(S.factions[prev].wanderer && goGuest(prev, cityId, toFid, p.troops * 0.2, p.gold * 0.2)) && !fleeToEmpty(prev, cityId, p.troops * 0.3, p.gold * 0.3)) dissolveHouse(prev);
    }
  }
  function processGuests() {
    for (const F of Object.values(S.factions)) {
      if (!F.alive || !F.guest) continue;
      const months = S.turn - F.guestSince;
      const host = S.factions[F.host];
      if (!host || !host.alive || !factionProvinces(F.host).length) {
        const seatCity = rulerOf(F.id) ? rulerOf(F.id).city : null;
        if (!seatCity || !goGuest(F.id, seatCity, null)) { notice(`${F.name} 가문은 비호자 없이 바람 앞의 등불이 되어 흩어졌소.`, 'hist'); dissolveHouse(F.id); }
        continue;
      }
      F.exileTotal = (F.exileTotal || 0) + 1;   // counted across every host and every stint
      if (months >= (F.wanderer ? 240 : 144) || F.exileTotal >= (F.wanderer ? 300 : 180)) { notice(`긴 유랑 끝에 ${F.name}의 따르는 이들이 떠나고 가문은 스러졌소.`, 'hist'); dissolveHouse(F.id); continue; }
      // the household eats from the host's granary; a big camp wears out its welcome
      F.household = F.household || { troops: 0, gold: 0 };
      const seatP = prov(hostSeat(F.id));
      const eat = Math.floor(F.household.troops * FOOD_UPKEEP);
      if (seatP.food >= eat) seatP.food -= eat; else { const lost = Math.floor(F.household.troops * 0.1); F.household.troops -= lost; seatP.food = 0; }
      if (F.household.troops > 5000) F.favor = clamp(F.favor - 1, 0, 100);
      if ((F.prestige || 0) > (host.prestige || 0) + 20 && Math.random() < 0.05) {
        F.favor = clamp(F.favor - 15, 0, 100);
        const t = `${host.name}께서 명망 높은 객장 ${F.name}을(를) 경계하시니 조정에서 수군거리오. 용은 오래 연못에 머물지 않는다 하오. 총애 -15.`;
        (F.id === S.player) ? notice(t, 'bad') : log(t, 'bad');
      }
      if (F.favor <= 0) {
        const t = `${host.name}께서 ${F.name}을(를) 내치기로 하셨소.`;
        (F.id === S.player) ? notice(t, 'bad') : log(t, 'bad');
        const seatCity = hostSeat(F.id);
        if (!goGuest(F.id, seatCity, F.host)) { notice(`사방에서 문전박대를 당한 ${F.name} 가문은 흩어졌소.`, 'hist'); dissolveHouse(F.id); }
        continue;
      }
      // a generous host may grant a border town to a favoured guest
      const hostCities = factionProvinces(F.host);
      if (months >= 24 && hostCities.length >= 2 && F.favor >= 70 && Math.random() < 0.1 && !(host.phase && host.phase !== 'rising')) {
        const seat = rulerOf(F.host).city;
        const grant = hostCities.filter((p) => p.id !== seat).sort((a, b) => a.troops - b.troops)[0];
        if (grant) {
          wake(F.id, grant.id);
          shiftRelation(F.id, F.host || host.id, 20);
          concludeTreaty(F.id, host.id, 'ceasefire');
          notice(`${host.name}께서 객장 ${F.name}에게 ${pname(grant.id)}를 내리시니 다시 제 깃발을 들게 되었소.`, 'hist', { major: true });
        }
      }
    }
  }

  function nearestOwnedCity(pid, fid) {
    const owned = factionProvinces(fid);
    const adjOwned = owned.filter((p) => S.adj[pid].includes(p.id));
    if (adjOwned.length) return pick(adjOwned);
    const here = PROVINCES.find((p) => p.id === pid);
    return owned.reduce((m, p) => {
      const q = PROVINCES.find((x) => x.id === p.id), mq = PROVINCES.find((x) => x.id === m.id);
      return Math.hypot(q.x - here.x, q.y - here.y) < Math.hypot(mq.x - here.x, mq.y - here.y) ? p : m;
    });
  }

  // ---------- captives ----------
  // A living house must have a lord of its own; if the lord is gone mid-month, run the succession now.
  function ensureRuler(fid) {
    const F = S.factions[fid];
    if (!F || !F.alive) return null;
    const r = off(F.ruler);
    if (r && r.faction === fid) return r;
    succession(fid, `${F.ruler}께서 ${F.name} 가문을 떠나셨소.`);
    return F.alive ? off(F.ruler) : null;
  }

  function captiveChance(captorFid, o) {
    const ruler = ensureRuler(captorFid);
    if (!ruler) return 0;
    if (areEnemies(o.name, ruler.name)) return 0;
    if (bondedRuler(o, captorFid)) return 0;   // will not abandon a brother who still rules
    const originalLoyalty = o.faction && S.factions[o.faction].alive ? o.loyalty : Math.min(o.loyalty, 60);
    if (originalLoyalty >= 70 && o.faction && S.factions[o.faction].alive && factionProvinces(o.faction).length) return 0;   // a loyal man of a living house cannot be turned
    let c = (ruler.chr - originalLoyalty + 45) / 100;
    if (isRuler(o)) { if (S.factions[o.faction].alive) return 0; c = Math.min(c, 0.35); }
    return clamp(c, 0.05, 0.9);
  }

  const ransomPrice = (o) => 300 + (o.ldr + o.war + o.int + o.pol + o.chr) * 3;
  function resolveCaptive(name, action) {
    const idx = S.pendingCaptives.findIndex((c) => c.name === name);
    if (idx < 0) return fail('그런 포로가 없소.');
    const c = S.pendingCaptives.splice(idx, 1)[0];
    const o = off(name);
    if (!o) return fail(`${name}은(는) 이미 세상을 떠났소.`);
    if (action === 'ransom') {
      const house = c.from && S.factions[c.from] && S.factions[c.from].alive && o.faction === c.from && factionProvinces(c.from).length ? c.from : null;
      const price = ransomPrice(o);
      if (!house) { S.pendingCaptives.splice(idx, 0, c); return fail(`${o.name}에게는 몸값을 내어줄 가문이 없소.`); }
      const payer = factionProvinces(house).sort((x, y) => y.gold - x.gold)[0];
      const willing = payer && payer.gold >= price && (house === S.player || price <= payer.gold * 0.6 || o.war + o.int >= 150 || relation(house, c.captor) >= 0);
      if (!willing) { c.ransomRefused = true; S.pendingCaptives.splice(idx, 0, c); return fail(`${fname(house)}께서는 ${o.name}의 몸값으로 금 ${fmt(price)}을(를) 내지 않으시겠다 하오.`); }
      payer.gold -= price; prov(c.city).gold += price; shiftRelation(house, c.captor, 3);
      releaseCaptive(o, c);
      return ok(`${fname(house)}께서 금 ${fmt(price)}을(를) 내시고 ${o.name}이(가) 고향으로 돌아갔소.`, 'dip');
    }
    if (action === 'recruit') {
      const chance = captiveChance(c.captor, o);
      if (chance <= 0) { releaseCaptive(o, c); return ok(`${o.name}은(는) 살아 있는 가문의 주공이시니 남을 섬기지 않으시겠다 하오. ${fname(c.captor)}께서 놓아주셨소.`, 'bad'); }
      if (Math.random() < chance) {
        o.captive = null; o.faction = c.captor; o.city = c.city; o.loyalty = 50 + ri(0, 20);
        return ok(`${o.name}이(가) ${fname(c.captor)}께 충성을 맹세하였소.`, 'good');
      }
      releaseCaptive(o, c);
      return ok(`${o.name}이(가) ${fname(c.captor)}님 섬기기를 거부하여 풀려났소.`, 'bad');
    }
    if (action === 'execute') {
      const text = `${o.name}이(가) ${fname(c.captor)}에게 처형당하였소. 천하의 장수들이 불안해하오.`;
      const ownersPlayer = o.faction === S.player;
      for (const it of itemsOf(o.name)) { const r = rulerOf(c.captor); if (r) { giveItem(it.id, r.name, true); log(`${r.name}이(가) 처형당한 자의 ${it.name}을(를) 거두었소.`, 'good'); } }
      killOfficer(o, `${fname(c.captor)}에게 처형당함`);
      for (const x of factionOfficers(c.captor)) x.loyalty = clamp(x.loyalty - 4, 0, 100);
      if (ownersPlayer && c.captor !== S.player) notice(text, 'bad');
      return ok(text, 'bad');
    }
    releaseCaptive(o, c);
    return ok(`${o.name}이(가) ${fname(c.captor)}님께 풀려났소.`);
  }

  function releaseCaptive(o, c) {
    o.captive = null;
    if (o.faction && S.factions[o.faction].alive && factionProvinces(o.faction).length) {
      o.city = nearestOwnedCity(c.city, o.faction).id;
    } else if (o.faction && S.factions[o.faction].alive && S.factions[o.faction].guest && rulerOf(o.faction)) {
      o.city = rulerOf(o.faction).city;   // rejoin the house in exile
    } else {
      o.faction = null; o.loyalty = 0;
    }
  }

  // ---------- turn processing ----------
  // ---------- treasures ----------
  const itemData = (id) => ITEMS.find((i) => i.id === id);
  const itemsOf = (name) => Object.values(S.items).filter((i) => i.owner === name).map((i) => itemData(i.id));
  const hiddenItemsIn = (pid) => Object.values(S.items).filter((i) => !i.owner && i.city === pid).map((i) => itemData(i.id));
  function giveItem(id, name, silent = false) {
    const it = itemData(id), st = S.items[id], o = off(name);
    if (!it || !st || !o) return false;
    if (st.owner) takeItem(id);
    st.owner = name; st.city = null;
    for (const [k, v] of Object.entries(it.bonus || {})) o[k] = clamp(o[k] + v, 1, 100);
    if (it.prestige && o.faction) { const F = S.factions[o.faction]; F.prestige = clamp((F.prestige || 0) + it.prestige, 0, 100); }
    if (!silent) log(`${o.name}이(가) 이제 ${it.name}을(를) 지니게 되었소.`, 'good');
    return true;
  }
  function takeItem(id) {
    const it = itemData(id), st = S.items[id];
    if (!st || !st.owner) return;
    const o = off(st.owner);
    if (o) {
      for (const [k, v] of Object.entries(it.bonus || {})) o[k] = clamp(o[k] - v, 1, 100);
      if (it.prestige && o.faction) { const F = S.factions[o.faction]; F.prestige = clamp((F.prestige || 0) - it.prestige, 0, 100); }
      st.city = o.city;
    }
    st.owner = null;
  }
  // when an officer dies, his treasures are lost in his city until someone finds them
  function dropItems(name, city) {
    for (const st of Object.values(S.items)) if (st.owner === name) { takeItem(st.id); st.city = city || st.city; }
  }
  function bestow(pid, fromName, toName) {
    const p = prov(pid), a = off(fromName), b = off(toName);
    if (!a || !b || a.city !== pid || b.city !== pid || a.faction !== p.owner || b.faction !== p.owner) return fail('두 장수 모두 이 고을의 아군이어야 하오.');
    const held = itemsOf(fromName);
    if (!held.length) return fail(`${fromName}에게는 보물이 없소.`);
    const it = held[0];
    giveItem(it.id, toName, true);
    b.loyalty = clamp(b.loyalty + 10, 0, 100);
    return ok(`${a.name}이(가) ${b.name}에게 ${it.name}을(를) 내리니 그 충성이 ${b.loyalty}까지 올랐소.`, 'good');
  }
  const duelBonus = (o) => itemsOf(o.name).reduce((s, it) => s + (it.duel || 0), 0);
  const guarded = (o) => itemsOf(o.name).some((it) => it.guard);
  const itemValue = (it) => (it.type === 'seal' ? 30 : 12 + Object.values(it.bonus || {}).reduce((a, b) => a + b, 0) * 2 + (it.escape ? 4 : 0) + (it.guard ? 4 : 0));
  const houseItems = (fid) => Object.values(S.items).filter((i) => i.owner && S.officers[i.owner] && S.officers[i.owner].faction === fid && !S.officers[i.owner].captive).map((i) => itemData(i.id));
  // gift a treasure to another lord
  function giftItem(fid, target, itemId) {
    const it = itemData(itemId), st = S.items[itemId];
    if (!it || !st || !st.owner || !S.officers[st.owner] || S.officers[st.owner].faction !== fid) return fail('그 보물은 그대가 지니고 있지 않소.');
    if (!S.factions[target] || !S.factions[target].alive) return fail('그 가문은 이미 없어졌소.');
    const r = rulerOf(target); if (!r) return fail('그 가문에는 받을 주공이 없소.');
    const gain = Math.min(35, itemValue(it));
    giveItem(itemId, r.name, true);
    shiftRelation(fid, target, gain);
    return ok(`${fname(fid)}께서 ${fname(target)}께 ${it.name}을(를) 보내셨소. ${r.name}께서 크게 기뻐하시니 관계가 ${gain}만큼 좋아졌소.`, 'dip');
  }
  const canEscape = (o) => itemsOf(o.name).some((it) => it.escape);

  // ---------- new blood: later generations and local talents ----------
  const TALENT_CAP = 70;
  function talentName() {
    for (let i = 0; i < 40; i++) {
      const n = `${pick(SURNAMES)} ${pick(GIVEN)}`;
      if (!S.officers[n] && !OFFICERS.some((r) => r[0] === n) && !LATER_OFFICERS.some((r) => r[0] === n)) return n;
    }
    return null;
  }
  function processArrivals() {
    sonsOfHeroes();
    // 1. historical figures come of age or come forward on their year (spread across the months)
    for (const r of LATER_OFFICERS) {
      const [name, ldr, war, int_, pol, chr, born, year, city, pref] = r;
      if (year !== S.year) continue;
      if (S.officers[name] || S.arrived[name]) { S.arrived[name] = S.arrived[name] || S.turn; continue; }   // an event brought him in early
      const month = 1 + (name.length * 7 + city.length * 3) % 12;
      if (S.month !== month) continue;
      S.arrived[name] = S.turn;
      const house = pref && S.factions[pref] && S.factions[pref].alive && !S.factions[pref].guest && factionProvinces(pref).length ? pref : null;
      const where = house ? (prov(city).owner === house ? city : factionProvinces(house)[0].id) : city;
      S.officers[name] = { name, ldr, war, int: int_, pol, chr, faction: house, city: where, loyalty: house ? 80 : 0, born, acted: false, captive: null, skills: OFFICER_SKILLS[name] || [], rank: 0 };
      const text = house ? `${name}이(가) ${pname(where)}에서 ${fname(house)}께 벼슬하였소.` : `${name}, 제법 이름난 인재가 ${pname(where)}에 나타나 주군을 찾고 있소.`;
      (house === S.player || prov(where).owner === S.player) ? notice(text, 'good') : log(text, 'good');
    }
    // 2. when the realm runs thin, local worthies come forward in the cities of living houses
    const living = allOfficers().filter((o) => !o.captive).length;
    const target = 120;
    // houses that have grown faster than their courts draw talent to them
    const short = Object.values(S.factions).filter((f) => f.alive && !f.raider && !f.guest && factionProvinces(f.id).length >= 2 && factionOfficers(f.id).length < factionProvinces(f.id).length * 1.2);
    const pull = short.length && living < 170 ? 0.15 : 0;
    S.generatedTalents = S.generatedTalents || 0;
    const lateAge = S.year > 245;   // after the age of heroes the well runs slow, and the men it yields are lesser
    const wellDry = (!lateAge && S.generatedTalents >= TALENT_CAP) || S.year > 400;
    if (!wellDry && (!lateAge || Math.random() < 0.5) && (Math.random() < pull || (living < target && Math.random() < Math.min(0.9, 0.25 + (target - living) / 40)))) {
      const owned = Object.values(S.provinces).filter((p) => p.owner && !S.factions[p.owner].raider);
      // weight cities by their house's shortage of officers per city
      const weighted = owned.map((p) => { const f = S.factions[p.owner]; const ratio = factionOfficers(f.id).length / Math.max(1, factionProvinces(f.id).length); return { p, w: Math.max(0.2, 2.2 - ratio) }; });
      const total = weighted.reduce((a, x) => a + x.w, 0); let r = Math.random() * total; let p = weighted.length ? weighted[weighted.length - 1].p : pick(Object.values(S.provinces));
      for (const x of weighted) { r -= x.w; if (r <= 0) { p = x.p; break; } }
      const name = talentName();
      if (name) {
        S.generatedTalents++;
        const late = lateAge ? 8 : S.generatedTalents > TALENT_CAP * 0.6 ? 6 : 0;   // the later worthies are lesser men
        const q = (base) => clamp(Math.round(base - late + (Math.random() + Math.random() - 1) * 22), 20, 92);
        const kind = Math.random();
        const o = kind < 0.45 ? { ldr: q(66), war: q(70), int: q(45), pol: q(42), chr: q(52) } : kind < 0.8 ? { ldr: q(50), war: q(38), int: q(70), pol: q(72), chr: q(58) } : { ldr: q(62), war: q(58), int: q(62), pol: q(60), chr: q(64) };
        S.officers[name] = { name, ...o, faction: null, city: p.id, loyalty: 0, born: S.year - ri(20, 32), acted: false, captive: null, skills: Math.random() < 0.3 ? [pick(Object.keys(SKILL_INFO))] : [], rank: 0 };
        const text = `${name}, ${kind < 0.45 ? '고을에 이름난 무사' : kind < 0.8 ? '제법 학문을 닦은 선비' : '명문가의 쓸 만한 인물'}이(가) ${pname(p.id)}에서 나섰소.`;
        p.owner === S.player ? notice(text, 'good') : log(text, 'good');
      }
    }
  }

  // ---------- sons of the famous ----------
  // a notable officer past forty-five, or one who has just died, may be followed by a son of his line: his surname, most of his gifts, his house
  const notable = (o) => o.ldr + o.war + o.int + o.pol + o.chr >= 320 || isRuler(o);
  const worthy = (o) => o.ldr + o.war + o.int + o.pol + o.chr >= 260;   // a lesser man may still leave one son
  const sonsAllowed = (o) => (notable(o) ? 2 : worthy(o) ? 1 : 0);
  function spawnSon(father, why) {
    if ((father.sons || 0) >= sonsAllowed(father)) return null;
    const fam = familyName(father.name); let name = null;
    for (let i = 0; i < 40 && !name; i++) { const n = `${fam} ${pick(GIVEN)}`; if (!S.officers[n] && !OFFICERS.some((r) => r[0] === n) && !LATER_OFFICERS.some((r) => r[0] === n) && !(S.arrived && S.arrived[n])) name = n; }
    if (!name) return null;
    const q = (v) => clamp(Math.round(v * rnd(0.65, 0.88) + ri(-4, 4)), 20, 96);
    const born = Math.min(S.year - 16, (father.born == null ? S.year - 50 : father.born) + ri(24, 34));
    const house = father.faction && S.factions[father.faction] && S.factions[father.faction].alive && !S.factions[father.faction].guest && factionProvinces(father.faction).length ? father.faction : null;
    const city = house && prov(father.city) && prov(father.city).owner === house ? father.city : house ? factionProvinces(house)[0].id : (prov(father.city) ? father.city : pick(Object.keys(S.provinces)));
    S.officers[name] = { name, ldr: q(father.ldr), war: q(father.war), int: q(father.int), pol: q(father.pol), chr: q(father.chr), faction: house, city, loyalty: house ? 85 : 0, born, acted: false, captive: null, skills: father.skills && father.skills.length && Math.random() < 0.5 ? [pick(father.skills)] : [], rank: 0, father: father.name };
    S.arrived = S.arrived || {}; S.arrived[name] = S.turn; father.sons = (father.sons || 0) + 1;
    const text = `${name}, ${father.name}의 아들로 ${why === 'death' ? '아버지의 칼을 이어 들었소' : '장성하였소'}${house ? `, ${fname(house)}를 섬기며` : ''}, ${pname(city)}에서 나섰소.`;
    (house === S.player || prov(city).owner === S.player) ? notice(text, 'good') : log(text, 'good');
    return S.officers[name];
  }
  function sonsOfHeroes() {
    for (const o of allOfficers()) {
      if (o.captive || (o.sons || 0) >= sonsAllowed(o)) continue;
      const a = age(o); if (a < 45 || a > 72) continue;
      if (Math.random() < (notable(o) ? 1 / 60 : 1 / 120)) spawnSon(o, 'age');
    }
  }

  // ---------- ageing and death ----------
  const age = (o) => S.year - (o.born == null ? S.year - 35 : o.born);
  function deathChancePerMonth(a) {
    const yearly = a < 45 ? 0.003 : a < 55 ? 0.015 : a < 65 ? 0.04 : a < 75 ? 0.1 : a < 85 ? 0.25 : 0.5;
    return yearly / 12;
  }
  const familyName = (name) => name.split(' ')[0];
  const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
  function heirScore(fid, o) {
    const F = S.factions[fid]; const fam = F && familyName(F.ruler) === familyName(o.name) ? 60 : 0;
    return fam + o.ldr + o.chr + o.pol / 2 + o.int / 2;
  }
  const heirCandidates = (fid) => factionOfficers(fid).filter((o) => !isRuler(o)).sort((a, b) => heirScore(fid, b) - heirScore(fid, a));

  function killOfficer(o, cause, scripted = false) {
    if (!S.officers[o.name]) return;
    if (age(o) >= 40 && (o.sons || 0) < sonsAllowed(o) && Math.random() < (notable(o) ? 0.6 : 0.4)) spawnSon(o, 'death');
    const fid = o.faction, wasRuler = isRuler(o), captor = o.captive;
    const text = `${o.name}께서 ${cause}, 향년 ${age(o)}세에 돌아가셨소.`;
    S.stats.deaths++;
    dropItems(o.name, o.city);
    delete S.officers[o.name];
    S.pendingCaptives = S.pendingCaptives.filter((c) => c.name !== o.name);
    if (S.pendingSuccession && S.pendingSuccession.candidates) S.pendingSuccession.candidates = S.pendingSuccession.candidates.filter((n) => n !== o.name);
    if (wasRuler && fid && S.factions[fid].alive) { succession(fid, text); return; }
    if (scripted) { notice(text, 'hist', { major: true }); return; }
    (fid === S.player || captor === S.player) ? notice(text, 'bad') : log(text, 'bad');
  }

  function succession(fid, deathText) {
    const F = S.factions[fid];
    const cands = heirCandidates(fid);
    if (!cands.length) {
      F.alive = false;
      for (const p of factionProvinces(fid)) { p.owner = null; p.troops = Math.floor(p.troops * 0.5); }
      for (const o of allOfficers()) if (o.captive === fid) { o.captive = null; o.faction = null; }
      S.pendingCaptives = S.pendingCaptives.filter((c) => c.captor !== fid);
      notice(`${deathText} 뒤를 이을 자가 없어 ${F.name} 가문은 흩어지고 고을들은 무주지가 되었소.`, 'hist', { major: true });
      return;
    }
    const heir = cands[0];
    F.lastLoss = S.turn;
    F.ruler = heir.name; F.name = F.dynasty || heir.name; heir.loyalty = 100;
    F.lastSuccession = { turn: S.turn, rival: cands[1] ? cands[1].name : null };
    for (const o of factionOfficers(fid)) if (o.name !== heir.name) o.loyalty = clamp(o.loyalty - ri(5, 15), 0, 100);
    notice(`${deathText} ${heir.name}께서 가문을 이어 주공이 되셨소.`, 'hist', { major: true });
    if (fid === S.player && cands.length > 1) S.pendingSuccession = { fid, candidates: cands.map((c) => c.name) };
    else checkRestorations();
  }

  function chooseHeir(fid, name) {
    const F = S.factions[fid]; const o = off(name);
    if (!o || o.faction !== fid || o.captive) return fail(`${name}은(는) 대를 이을 수 없소.`);
    const old = off(F.ruler);
    if (old && old.name !== name) old.loyalty = 90;
    F.ruler = name; F.name = F.dynasty || name; o.loyalty = 100;
    F.lastSuccession = { turn: S.turn, rival: (S.pendingSuccession && S.pendingSuccession.candidates || []).find((n) => n !== name) || null };
    S.pendingSuccession = null;
    checkRestorations();
    return ok(`${name}께서 가문의 대를 이으셨소.`, 'hist');
  }

  const scriptedDeath = (name) => HISTORICAL_DEATHS.find((d) => d[0] === name);
  const scriptedOn = () => !!(S.options && S.options.historicalDeaths);

  function processAgeing() {
    const newYear = S.month === 1;
    // scripted deaths fire first, on their historical date
    if (scriptedOn()) {
      for (const [name, y, m, cause] of HISTORICAL_DEATHS) {
        if (y === S.year && m === S.month && S.officers[name]) killOfficer(S.officers[name], cause, true);
      }
    }
    for (const o of allOfficers()) {
      const a = age(o);
      if (newYear) {
        if (a <= 22) for (const k of ['war', 'ldr', 'int']) if (o[k] < 95) o[k] += 1;
        if (a >= 60) o.war = Math.max(10, o.war - ri(0, 2));
        if (a >= 70) o.ldr = Math.max(10, o.ldr - ri(0, 2));
      }
      // with scripted history on, officers whose day is still to come rarely die early
      const sd = scriptedOn() ? scriptedDeath(o.name) : null;
      const damp = sd && (sd[1] > S.year || (sd[1] === S.year && sd[2] > S.month)) ? 0.1 : 1;
      if (Math.random() < deathChancePerMonth(a) * damp) {
        const where = o.city ? `, ${pname(o.city)}에서` : '';
        const cause = a >= 65 ? pick([`노환으로${where}`, `평안히 눈을 감으시어${where}`, `오랜 병환 끝에${where}`]) : pick([`병으로${where}`, `갑작스런 열병으로${where}`, `아물지 않은 상처로${where}`]);
        killOfficer(o, cause);
      }
    }
  }

  // ---------- historical events, decisions, objectives ----------
  let _eventApi = null;
  const api = () => _eventApi || (_eventApi = {
    prov, off, fname, pname, rulerOf, relation, shiftRelation, factionOfficers, factionProvinces, bordering, treatyStatus,
    transferCity, wake, dissolveHouse, breakTreaty, age, heirCandidates, totalTroops, canAttack, setRelation, officersIn, governorOf,
    officers: () => allOfficers().filter((o) => !o.captive),
    ceasefire: (a, b, months) => { const d = dip(a, b); d.status = 'ceasefire'; d.until = S.turn + months; },
    ally: (a, b, months) => { const d = dip(a, b); d.status = 'alliance'; d.until = S.turn + months; },
    setTitle: (fid, tier) => { const F = S.factions[fid]; if (F) F.title = tier; },
    goGuestTo: (fid, hostId, troops = 0, gold = 0) => { const r = rulerOf(fid); return r ? goGuest(fid, r.city, null, troops, gold, hostId) : false; },
    killQuiet: (name, cause) => { const o = off(name); if (o) killOfficer(o, cause, false); },
    prestige: (fid, n) => { const F = S.factions[fid]; if (F) F.prestige = clamp((F.prestige || 0) + n, 0, 100); },
    gold: (fid, n) => { const p = factionProvinces(fid)[0]; if (p) p.gold += n; },
    food: (fid, n) => { const p = factionProvinces(fid)[0]; if (p) p.food += n; },
    troops: (fid, n) => { const p = factionProvinces(fid)[0]; if (p) p.troops += n; },
    addOfficer: (spec) => { if (S.officers[spec.name]) return S.officers[spec.name]; S.officers[spec.name] = { acted: false, captive: null, skills: OFFICER_SKILLS[spec.name] || [], rank: 0, ...spec }; return S.officers[spec.name]; },
    // bring an officer into a house: free officers always, others only if `force`
    joinHouse: (name, fid, loyalty = 70, city = null, force = false) => {
      const o = off(name); if (!o || o.captive) return false;
      if (o.faction && o.faction !== fid && !force) return false;
      o.faction = fid; o.loyalty = loyalty;
      if (city) o.city = city; else if (prov(o.city).owner !== fid) { const p = factionProvinces(fid)[0]; if (p) o.city = p.id; }
      return true;
    },
    moveHouse: (fid, cityId) => { for (const o of allOfficers()) if (o.faction === fid && !o.captive) o.city = cityId; },
    kill: (name, cause) => { const o = off(name); if (o) killOfficer(o, cause, true); },
    giveItem: (id, name) => giveItem(id, name, true), takeItem, itemsOf, houseItems,
    capture: (name, captor) => { const o = off(name); if (!o || !S.factions[captor]) return; o.captive = captor; S.pendingCaptives.push({ name, captor, city: o.city, from: o.faction }); },
    warTarget: (fid, target, months) => { const F = S.factions[fid]; if (F && S.factions[target]) { F.warTarget = target; F.warTargetUntil = S.turn + months; } },
    // Found a new house mid-game from cities and officers of an existing one
    foundHouse: ({ id, name, ruler, color, cities, officers = [], wanderer = false, aggr = 1, absorb = true, persona = [] }) => {
      if (S.factions[id] && S.factions[id].alive) return false;
      const r = off(ruler); if (!r || r.captive || !cities.length) return false;
      const prev = prov(cities[0]).owner;
      S.factions[id] = { id, name, ruler, color, aggr, alive: true, raider: false, wanderer, prestige: 5, guest: false, host: null, guestSince: 0, hasEmperor: false, favor: 0, household: { troops: 0, gold: 0 }, petitionUntil: 0, persona, treachery: 0, lastLoss: -99, lastAttackTurn: -99, lastAttackTarget: null, plan: null, caution: 1 };
      for (const c of cities) { if (prov(c).owner === id) continue; const p = prov(c); const old = p.owner; p.owner = id;
        // the old house's ruler is never absorbed: he withdraws to another of his cities if he has one
        const oldRuler = old ? rulerOf(old) : null; const refuge = old ? factionProvinces(old).find((q) => q.id !== c) : null;
        for (const o of allOfficers()) if (o.city === c && o.faction === old && !o.captive) { if ((oldRuler && o === oldRuler || !absorb) && refuge) { o.city = refuge.id; continue; } o.faction = id; o.loyalty = 75; } if (old && S.factions[old].alive && !factionProvinces(old).length && !S.factions[old].guest) { if (!(S.factions[old].wanderer && goGuest(old, c, id))) dissolveHouse(old); } }
      r.faction = id; r.loyalty = 100; r.captive = null; if (prov(r.city).owner !== id) r.city = cities[0];
      for (const n of officers) { const o = off(n); if (o && !o.captive) { o.faction = id; o.loyalty = Math.max(o.loyalty, 80); if (prov(o.city).owner !== id) o.city = cities[0]; } }
      if (prev && S.factions[prev]) setRelation(id, prev, -60);
      return true;
    },
  });
  const inWindow = (from, to) => { const t = S.year * 12 + S.month, a = from[0] * 12 + from[1], b = to[0] * 12 + to[1]; return t >= a && t <= b; };

  function processEvents() {
    for (const ev of EVENTS) {
      if ((S.eventsFired[ev.id] && !ev.repeat) || !inWindow(ev.from, ev.to)) continue;
      if (S.pendingDecisions.some((d) => d.id === ev.id)) continue;
      if (ev.repeat && S.eventsFired[ev.id] && S.turn - S.eventsFired[ev.id] < 12) continue;
      let ctx;
      try { ctx = ev.when(api(), S); } catch (e) { ctx = null; }
      if (!ctx) continue;
      if (ev.decision) {
        const house = ev.decision.house || ctx.fid;
        if (house === S.player) { S.pendingDecisions.push({ id: ev.id, ctx }); continue; }
        // AI: weighted choice
        const opts = ev.decision.options; const total = opts.reduce((a, o) => a + o.ai, 0);
        let r = Math.random() * total, pick = opts[opts.length - 1];
        for (const o of opts) { r -= o.ai; if (r <= 0) { pick = o; break; } }
        S.eventsFired[ev.id] = ev.repeat ? S.turn : true;
        const text = pick.apply(api(), S, ctx);
        notice(`${ev.title}: ${text}`, 'hist', { major: !ev.minor });
      } else {
        S.eventsFired[ev.id] = ev.repeat ? S.turn : true;
        const text = ev.apply(api(), S, ctx);
        notice(`${ev.title}: ${text}`, 'hist', { major: !ev.minor });
      }
    }
  }
  function decide(index, optionIndex) {
    const d = S.pendingDecisions.splice(index, 1)[0];
    if (!d) return fail('들을 만한 안건이 없소.');
    const ev = EVENTS.find((e) => e.id === d.id);
    S.eventsFired[ev.id] = ev.repeat ? S.turn : true;
    const opt = ev.decision.options[optionIndex] || ev.decision.options[ev.decision.options.length - 1];
    const text = opt.apply(api(), S, d.ctx);
    return ok(`${ev.title}: ${text}`, 'hist');
  }
  function objectiveStatus(ob) {
    const key = `${ob.house}:${ob.id}`;
    if (S.objectivesDone[key]) return { state: 'done' };
    if (S.year > ob.to) return { state: 'missed' };
    if (S.year < ob.from) return { state: 'future' };
    if (ob.hold) { const have = ob.hold.filter((c) => S.provinces[c].owner === ob.house).length; return { state: 'active', progress: `${have}/${ob.hold.length}`, complete: have === ob.hold.length }; }
    return { state: 'active', progress: '', complete: !!ob.custom(api(), S) };
  }
  function processObjectives() {
    for (const ob of OBJECTIVES) {
      const F = S.factions[ob.house];
      if (!F || !F.alive) continue;
      const st = objectiveStatus(ob);
      if (st.state !== 'active' || !st.complete) continue;
      S.objectivesDone[`${ob.house}:${ob.id}`] = `${S.year}.${S.month}`;
      const text = ob.reward(api(), S);
      const line = `${fname(ob.house)} — ${ob.title}: ${text}`;
      (ob.house === S.player || S.observer) ? notice(line, 'hist', { major: true }) : log(line, 'hist');
    }
  }
  const destinyTargets = (fid) => { const list = DESTINY[fid]; if (!list) return new Set(); return new Set(list.filter((d) => S.year >= d.from && S.year <= d.to).flatMap((d) => d.targets)); };

  // ---------- diplomacy ----------
  const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  function dip(a, b) {
    const k = pairKey(a, b);
    if (!S.diplomacy[k]) S.diplomacy[k] = { rel: 0, status: 'neutral', until: 0, cooldown: 0 };
    return S.diplomacy[k];
  }
  const relation = (a, b) => (a && b && a !== b ? dip(a, b).rel : 0);
  function setRelation(a, b, v) { dip(a, b).rel = clamp(Math.round(v), -100, 100); }
  function shiftRelation(a, b, dv) { if (a && b && a !== b) setRelation(a, b, dip(a, b).rel + dv); }
  function treatyStatus(a, b) {
    if (!a || !b || a === b) return 'neutral';
    const d = dip(a, b);
    if (d.status === 'alliance' && !d.until) d.until = S.turn + ALLIANCE_MONTHS;   // older saves: alliances had no term
    if ((d.status === 'ceasefire' || d.status === 'alliance') && d.until <= S.turn) { d.status = 'neutral'; }
    return d.status;
  }
  const canAttack = (a, b) => !b || treatyStatus(a, b) === 'neutral';
  const allies = (fid) => Object.keys(S.factions).filter((f) => f !== fid && S.factions[f].alive && treatyStatus(fid, f) === 'alliance');
  function relationWord(v) { return v <= -40 ? '적대' : v <= -10 ? '냉랭' : v < 20 ? '평범' : v < 50 ? '우호' : '친밀'; }
  function bordering(a, b) {
    return factionProvinces(a).some((p) => neighbors(p.id).some((n) => n.owner === b));
  }
  function sharedEnemy(a, b) {
    return Object.keys(S.factions).some((f) => f !== a && f !== b && S.factions[f].alive && bordering(a, f) && bordering(b, f) && treatyStatus(a, f) === 'neutral' && treatyStatus(b, f) === 'neutral');
  }
  const DIP_COST = { ceasefire: 300, alliance: 500, joint: 200 };
  const CEASEFIRE_MONTHS = 12;
  const ALLIANCE_MONTHS = 60;   // an alliance is sworn for five years and must then be renewed

  // Probability that `to` accepts a proposal of `type` from `from`.
  function acceptChance(from, to, type, envoy) {
    const F = S.factions[to];
    let c = type === 'ceasefire' ? 0.4 : type === 'alliance' ? 0.15 : 0.3;
    c += relation(from, to) / 200;
    if (envoy) c += ((envoy.chr + envoy.pol) / 2 - 60) / 200;
    const sf = totalTroops(from), st = totalTroops(to);
    if (type === 'ceasefire') {
      if (st < sf) c += 0.25;
      if (st > sf * 2) c -= 0.2;
    } else if (type === 'alliance') {
      if (sf > st) c += 0.15;
      if (sharedEnemy(from, to)) c += 0.2;
      if (bordering(from, to) && F.aggr >= 1.2) c -= 0.15;
      if (relation(from, to) < 0) c -= 0.15;
    } else if (type === 'joint') {
      c += 0.1;
    }
    c -= (F.aggr - 1) * 0.2;
    const P = S.factions[from];
    c += (P.prestige || 0) / 500 + (P.hasEmperor ? 0.1 : 0) + legitimacy(from) + (envoy && hasSkill(envoy, 'orator') ? 0.08 : 0);
    if (diff() === 'hard' && from === S.player) c -= 0.1;
    // reputation: treaty-breakers and those who let ceasefires lapse to strike are not trusted
    c -= Math.min(0.45, 0.15 * (P.treachery || 0));
    if (has(from, 'treacherous')) c -= 0.1;
    if (has(to, 'cautious')) c += 0.1;
    if (type === 'ceasefire' || type === 'alliance') {
      const sf = totalTroops(from), st = totalTroops(to);
      const desperate = st < sf * 0.6;   // a house about to be crushed cannot be picky
      // a "sold" ceasefire: the proposer is fighting someone else and wants a free hand, then our turn comes
      const busyElsewhere = (P.plan && P.plan.enemy && P.plan.enemy !== to) || (S.turn - (P.lastAttackTurn || -99) <= 6 && P.lastAttackTarget && P.lastAttackTarget !== to);
      if (busyElsewhere && sf > st * 0.9 && !desperate) c -= 0.3;
      // massing on our border while talking peace
      if (borderTroops(from, to) > borderTroops(to, from) * 1.3 && !desperate) c -= 0.15;
      // the runaway leader gets no help, except from the cautious who would rather bend than break
      if (leaderHouse() === from) c += has(to, 'cautious') || has(to, 'builder') ? 0.15 : -0.4;
      // a hegemon takes peace only from the desperate, or from the second power it wants to court
      const H = S.factions[to];
      if (H.phase === 'unifying') return 0.03;   // the war of unification admits no truce
      if (H.phase && H.phase !== 'rising') { const sp = secondPower(to); if (lastFoe(to) === from && !desperate) c -= 0.6; else if (!(desperate || (sp && sp.id === from))) c -= 0.3; }
      // honourable houses remember broken words
      if (has(to, 'honourable') && (P.treachery || 0) > 0) c -= 0.15;
    }
    if (type === 'joint' && P.jointAgainst && leaderHouse() === P.jointAgainst) c += 0.3;
    return clamp(c, 0.03, 0.9);
  }

  function findEnvoy(fid, name) {
    const o = off(name);
    if (!o || o.faction !== fid || o.captive) return fail(`${name}은(는) 쓸 수 없소.`);
    if (o.acted) return fail(`${name}은(는) 이번 달에 이미 움직였소.`);
    if (prov(o.city).owner !== fid) return fail(`${name}은(는) 아군의 고을에 있지 않소.`);
    return o;
  }

  function proposeTreaty(fid, target, type, envoyName, sweetener = null) {
    if (!S.factions[target] || !S.factions[target].alive) return fail('그 가문은 이미 없어졌소.');
    const d = dip(fid, target);
    if (type === 'alliance' && d.status === 'alliance' && d.until - S.turn > 12) return fail(`이미 ${d.until - S.turn}개월의 동맹이 남아 있소. 마지막 해에 갱신할 수 있소.`);
    if (type === 'ceasefire' && d.status !== 'neutral') return fail(`${fname(target)}와는 이미 ${d.status} 중이오.`);
    if (d.cooldown > S.turn && fid === S.player) return fail(`${fname(target)}께서는 ${d.cooldown - S.turn}개월 동안 사신을 받지 않으시겠다 하오.`);
    const envoy = findEnvoy(fid, envoyName); if (!envoy.name) return envoy;
    const city = prov(envoy.city);
    if (city.gold < DIP_COST[type]) return fail(`${pname(city.id)}에는 사신단에 쓸 금 ${DIP_COST[type]}이 모자라오.`);
    city.gold -= DIP_COST[type];
    envoy.acted = true;
    d.cooldown = S.turn + 6;
    const sw = sweetener ? itemData(sweetener) : null;
    const swOk = sw && S.items[sweetener] && S.items[sweetener].owner && S.officers[S.items[sweetener].owner] && S.officers[S.items[sweetener].owner].faction === fid;
    if (target === S.player) {
      S.pendingProposals.push({ from: fid, type, envoy: envoy.name, sweetener: swOk ? sweetener : null });
      return { ok: true, msg: `${envoy.name}이(가) ${fname(target)}의 조정으로 떠났소.`, pending: true };
    }
    const chance = acceptChance(fid, target, type, envoy) + (swOk ? Math.min(0.35, itemValue(sw) / 100) : 0);
    if (Math.random() < chance) {
      if (swOk) { const r = rulerOf(target); if (r) giveItem(sweetener, r.name, true); }
      concludeTreaty(fid, target, type);
      return { ok: true, accepted: true, msg: `${fname(target)}께서 받아들이셨소${swOk ? `, ${sw.name}의 주인도 바뀌었소` : ''}! ${fname(fid)}와 ${fname(target)} 사이에 ${type === 'alliance' ? '동맹이 맺어졌소' : '휴전이 성립되었소'}.` };
    }
    shiftRelation(fid, target, 3);
    return { ok: true, accepted: false, msg: `${fname(target)}께서 ${envoy.name}을(를) 예로 맞아들이고도 ${type}은(는) 사양하셨소.` };
  }

  function concludeTreaty(a, b, type) {
    const d = dip(a, b);
    const renewal = d.status === 'alliance' && type === 'alliance';
    d.status = type; d.proposer = a;
    d.until = type === 'ceasefire' ? S.turn + CEASEFIRE_MONTHS : S.turn + ALLIANCE_MONTHS;
    shiftRelation(a, b, type === 'alliance' ? (renewal ? 10 : 20) : 10);
    const text = type === 'alliance' ? (renewal ? `${fname(a)}와 ${fname(b)}이(가) 동맹을 ${ALLIANCE_MONTHS / 12}년 더 이어가기로 하였소.` : `${fname(a)}와 ${fname(b)}이(가) ${ALLIANCE_MONTHS / 12}년 동맹을 맺었소.`) : `${fname(a)}와 ${fname(b)}이(가) ${CEASEFIRE_MONTHS}개월 휴전에 합의하였소.`;
    (a === S.player || b === S.player) ? notice(text, 'dip') : log(text, 'dip');
  }

  function respondProposal(index, accept) {
    const pr = S.pendingProposals.splice(index, 1)[0];
    if (!pr) return fail('그런 제안이 없소.');
    if (!S.factions[pr.from].alive) return ok(`${fname(pr.from)} 가문은 이미 없어졌소.`);
    if (pr.type === 'ransom') {
      const c = S.pendingCaptives.find((x) => x.name === pr.officer && x.captor === pr.from); const o = off(pr.officer);
      if (!c || !o || o.captive !== pr.from) return ok(`${pr.officer}은(는) 이미 ${fname(pr.from)}께 잡혀 있지 않소.`);
      if (!accept) return ok(`${pr.officer}의 몸값을 치르지 않으셨소. 그 운명은 ${fname(pr.from)}의 손에 달렸소.`, 'dip');
      const payer = factionProvinces(S.player).sort((x, y) => y.gold - x.gold)[0];
      if (!payer || payer.gold < pr.price) return fail(`그대의 고을 어디에도 금 ${fmt(pr.price)}이 없으니 사신이 빈손으로 돌아갈 것이오.`);
      const r = resolveCaptive(pr.officer, 'ransom'); return r.ok ? ok(`금 ${fmt(pr.price)}을(를) 치르고 ${pr.officer}이(가) 돌아왔소.`, 'dip') : r;
    }
    if (accept) {
      if (pr.type === 'joint') {
        S.factions[S.player].warTarget = pr.enemy; S.factions[S.player].warTargetUntil = S.turn + 6;
        return ok(`${fname(pr.from)}와 손잡고 ${fname(pr.enemy)}을(를) 치기로 하였소.`, 'dip');
      }
      if (pr.sweetener && S.items[pr.sweetener] && S.items[pr.sweetener].owner) { const r = rulerOf(S.player); if (r) giveItem(pr.sweetener, r.name, true); }
      concludeTreaty(pr.from, S.player, pr.type);
      return ok(`${fname(pr.from)}와의 ${pr.type}을(를) 받아들였소${pr.sweetener ? `, ${itemData(pr.sweetener).name}은(는) 이제 그대 것이오` : ''}.`, 'dip');
    }
    shiftRelation(pr.from, S.player, -5);
    return ok(`${fname(pr.from)}의 사신을 빈손으로 돌려보냈소.`, 'dip');
  }

  // ---------- favours between allies ----------
  // a house that marches to an ally's battle is owed a favour; the debt is repaid by marching in turn, or by a gift worth 400 or more
  const favorKey = (a, b) => `${a}>${b}`;   // a owes b
  const favorsOwed = (a, b) => (a && b && S.favors && S.favors[favorKey(a, b)]) || 0;
  function addFavor(debtor, creditor, why) {
    if (!debtor || !creditor || debtor === creditor) return null;
    S.favors = S.favors || {};
    if (favorsOwed(creditor, debtor) > 0) { S.favors[favorKey(creditor, debtor)]--; log(`${fname(creditor)}이(가) ${fname(debtor)}께 진 빚을 갚았소${why ? ` (${why})` : ''}.`, 'dip'); return 'repaid'; }
    S.favors[favorKey(debtor, creditor)] = favorsOwed(debtor, creditor) + 1;
    const text = `${fname(debtor)}은(는) 이제 ${fname(creditor)}께 빚을 졌소${why ? ` (${why})` : ''}.`; if (debtor === S.player || creditor === S.player) notice(text, 'dip'); else log(text, 'dip');
    return 'owed';
  }
  function settleFavor(debtor, creditor) { if (favorsOwed(debtor, creditor) > 0) { S.favors[favorKey(debtor, creditor)]--; return true; } return false; }
  // an AI ally next to a battle asks the player to march; the battle waits for the player's month
  function askPlayerAid(B, fid, side, fromCity) {
    S.pendingAid = S.pendingAid || [];
    if (S.pendingAid.some((a) => a.city === B.city && a.from === fid)) return;
    const owed = favorsOwed(S.player, fid);
    S.pendingAid.push({ from: fid, city: B.city, side, fromCity, turn: S.turn });
    B.awaitPlayer = true;
    notice(`${fname(fid)}께서 ${pname(B.city)}의 ${side === 'A' ? '공성' : '수비'}에 원군을 청하시오${owed ? `, 그대는 빚이 ${owed}건 있소` : ''}. 이달이 가기 전에 ${pname(fromCity)}에서 병량를 보낼 수 있소.`, 'dip', { major: true });
  }
  function declineAid(index) {
    const a = (S.pendingAid || []).splice(index, 1)[0]; if (!a) return fail('그런 요청이 없소.');
    const owed = favorsOwed(S.player, a.from); shiftRelation(S.player, a.from, -(5 + 5 * owed));
    return ok(owed ? `빚이 ${owed}건 있음에도 ${fname(a.from)}를 외면하셨으니 그들이 이를 기억할 것이오.` : `${fname(a.from)}의 기별꾼을 미안하다는 말과 함께 돌려보냈소.`, 'dip');
  }
  // the AI repays what it owes with gifts when it has gold to spare
  function aiRepayFavors(fid) {
    for (const [k, n] of Object.entries(S.favors || {})) {
      if (n <= 0) continue; const [debtor, creditor] = k.split('>'); if (debtor !== fid || !S.factions[creditor] || !S.factions[creditor].alive) continue;
      const p = factionProvinces(fid).sort((x, y) => y.gold - x.gold)[0]; if (!p || p.gold < 1200 || Math.random() > 0.2) continue;
      const r = sendGift(fid, creditor, p.id, 500);
      if (r.ok) { if (creditor === S.player) notice(`${fname(fid)}께서 진 빚을 갚고자 예물로 금 500을 보내셨소.`, 'dip'); else log(`${fname(fid)}이(가) 진 빚을 갚고자 ${fname(creditor)}께 예물을 보냈소.`, 'dip'); }
    }
  }
  function sendGift(fid, target, pid, gold, food = 0) {
    const p = prov(pid);
    gold = Math.floor(gold || 0); food = Math.floor(food || 0);
    if (p.owner !== fid || gold < 0 || food < 0 || gold + food <= 0 || gold > p.gold || food > p.food) return fail('그 고을에 그만큼의 금과 군량이 없소.');
    if (!S.factions[target] || !S.factions[target].alive) return fail('그 가문은 이미 없어졌소.');
    p.gold -= gold; p.food -= food;
    const seat = rulerOf(target) && prov(rulerOf(target).city) && prov(rulerOf(target).city).owner === target ? prov(rulerOf(target).city) : factionProvinces(target)[0];
    if (seat) { seat.gold += gold; seat.food += food; }
    const value = gold + food / 10;
    const gain = Math.min(20, 3 + Math.floor(value / 100));
    shiftRelation(fid, target, gain);
    const settled = value >= 400 && settleFavor(fid, target);
    const what = [gold ? `금 ${fmt(gold)}` : '', food ? `군량 ${fmt(food)}` : ''].filter(Boolean).join('와 ');
    return ok(`${fname(fid)}께서 ${fname(target)}께 예물로 ${what}을(를) 보내셨소. 관계가 ${gain}만큼 좋아졌소.${settled ? ' 진 빚도 갚으셨소.' : ''}`, 'dip');
  }

  function breakTreaty(fid, target) {
    const d = dip(fid, target);
    if (d.status === 'neutral') return fail('파기할 조약이 없소.');
    const was = d.status;
    d.status = 'neutral'; d.until = 0;
    S.factions[fid].treachery = (S.factions[fid].treachery || 0) + 1;
    shiftRelation(fid, target, was === 'alliance' ? -60 : -40);
    for (const f of Object.keys(S.factions)) if (f !== fid && f !== target && S.factions[f].alive) shiftRelation(fid, f, -10);
    const text = `${fname(fid)}이(가) ${fname(target)}와의 ${was}을(를) 깨뜨렸소! 뭇 제후들이 이를 주목하오.`;
    (fid === S.player || target === S.player) ? notice(text, 'bad') : log(text, 'bad');
    return { ok: true, msg: text };
  }

  function requestJointAttack(fid, ally, enemy, envoyName) {
    if (treatyStatus(fid, ally) !== 'alliance') return fail('동맹끼리만 함께 출병을 청할 수 있소.');
    if (!S.factions[enemy] || !S.factions[enemy].alive) return fail('그 가문은 이미 없어졌소.');
    if (treatyStatus(ally, enemy) !== 'neutral') return fail(`${fname(ally)}께서는 ${fname(enemy)}와 ${treatyStatus(ally, enemy)} 중이시오.`);
    if (!bordering(ally, enemy)) return fail(`${fname(ally)}께서는 ${fname(enemy)}와 국경을 맞대고 있지 않소.`);
    const envoy = findEnvoy(fid, envoyName); if (!envoy.name) return envoy;
    const city = prov(envoy.city);
    if (city.gold < DIP_COST.joint) return fail(`${pname(city.id)}에는 사신단에 쓸 금 ${DIP_COST.joint}이 모자라오.`);
    city.gold -= DIP_COST.joint; envoy.acted = true;
    if (ally === S.player) {
      S.pendingProposals.push({ from: fid, type: 'joint', enemy, envoy: envoy.name });
      return { ok: true, pending: true, msg: `${envoy.name}이(가) ${fname(ally)}께 달려갔소.` };
    }
    S.factions[fid].jointAgainst = enemy;
    const agreed = Math.random() < acceptChance(fid, ally, 'joint', envoy);
    S.factions[fid].jointAgainst = null;
    if (agreed) {
      S.factions[ally].warTarget = enemy; S.factions[ally].warTargetUntil = S.turn + 6;
      return ok(`${fname(ally)}께서 ${fname(enemy)}를 함께 치기로 하셨소!`, 'dip');
    }
    return ok(`${fname(ally)}께서는 아직 ${fname(enemy)}와 전쟁할 뜻이 없으시오.`, 'dip');
  }

  function aiDiplomacy(fid) {
    const F = S.factions[fid];
    const envoys = factionOfficers(fid).filter((o) => !o.acted && !isRuler(o) && prov(o.city).owner === fid && prov(o.city).gold >= 500);
    if (!envoys.length) return;
    const envoy = envoys.reduce((m, o) => (o.chr + o.pol > m.chr + m.pol ? o : m));
    const mine = totalTroops(fid);
    const others = Object.keys(S.factions).filter((f) => f !== fid && S.factions[f].alive);
    const leader = leaderHouse();
    const hostileN = others.filter((f) => bordering(fid, f) && treatyStatus(fid, f) === 'neutral' && dip(fid, f).cooldown <= S.turn);
    // when only one rival is left, a treaty with him is a treaty against unification: it is torn up once the odds are overwhelming
    const foe = lastFoe(fid);
    if (foe && treatyStatus(fid, foe) !== 'neutral' && mine > totalTroops(foe) * (has(fid, 'honourable') ? 3 : 1.8) && Math.random() < 0.35) { breakTreaty(fid, foe); return; }
    const strongest = hostileN.sort((a, b) => totalTroops(b) - totalTroops(a))[0];
    // 0. the war of unification: no envoys, no gifts, and every treaty with a weaker rival is torn up
    if (F.phase === 'unifying') {
      const bound = others.filter((f) => !S.factions[f].raider && treatyStatus(fid, f) !== 'neutral' && mine > totalTroops(f) * 1.5);
      if (bound.length && Math.random() < 0.5) { const f = bound.sort((a, b) => totalTroops(b) - totalTroops(a))[0]; log(`${fname(fid)}께서 반천하를 쥐시고 경쟁자를 용납지 않으시니 ${fname(f)}와의 ${treatyStatus(fid, f)}을(를) 파기하였소.`, 'bad'); breakTreaty(fid, f); }
      return;
    }
    // 0a. the hegemon courts the second power so the rest cannot unite, and asks nothing of the others
    if (F.phase && F.phase !== 'rising') {
      const sp = secondPower(fid);
      if (lastFoe(fid)) return;   // the war of unification: no gifts and no treaties for the last rival
      if (sp && bordering(fid, sp.id)) {
        if (treatyStatus(fid, sp.id) === 'neutral' && dip(fid, sp.id).cooldown <= S.turn && Math.random() < 0.5) { const sw = houseItems(fid).filter((it) => it.type !== 'seal').sort((a, b) => itemValue(a) - itemValue(b))[0]; proposeTreaty(fid, sp.id, relation(fid, sp.id) >= 20 ? 'alliance' : 'ceasefire', envoy.name, sw && Math.random() < 0.5 ? sw.id : null); return; }
        const rich = factionProvinces(fid).filter((p) => p.gold > 3000)[0];
        if (rich && relation(fid, sp.id) < 40 && Math.random() < 0.4) { sendGift(fid, sp.id, rich.id, 500); return; }
      }
      return;
    }
    // 0a2. renew an alliance about to lapse when it still serves: a shared enemy, or a stronger partner one would rather not fight
    for (const a of allies(fid)) {
      const d = dip(fid, a);
      if (d.until - S.turn > 12 || d.cooldown > S.turn) continue;
      const useful = sharedEnemy(fid, a) || (bordering(fid, a) && totalTroops(a) > mine * 0.8) || relation(fid, a) >= 50;
      if (useful && !lastFoe(fid) && Math.random() < 0.35) { proposeTreaty(fid, a, 'alliance', envoy.name); return; }
    }
    // 0a3. a house with nowhere left to march (every neighbour under treaty) for a year picks the weakest, coolest ally and ends the pact
    if (F.idleSince && S.turn - F.idleSince >= 12) {
      const cand = allies(fid).filter((a) => bordering(fid, a) && mine > totalTroops(a) * (has(fid, 'honourable') ? 2.5 : 1.5)).sort((x, y) => relation(fid, x) - relation(fid, y))[0];
      if (cand && Math.random() < 0.2) { log(`${fname(fid)}께서 ${fname(cand)}와의 동맹은 다 쓰였다 여기셨소.`, 'dip'); breakTreaty(fid, cand); return; }
    }
    // 0b. small houses facing a hegemon: the cautious bandwagon, the bold balance
    if (leader && leader !== fid && bordering(fid, leader) && (has(fid, 'cautious') || has(fid, 'builder')) && treatyStatus(fid, leader) === 'neutral' && dip(fid, leader).cooldown <= S.turn && Math.random() < 0.4) { proposeTreaty(fid, leader, 'ceasefire', envoy.name); return; }
    // 0. coalition: when one house runs away with the map, its neighbours band together
    if (leader && leader !== fid && bordering(fid, leader) && !has(fid, 'cautious')) {
      const partners = others.filter((f) => f !== leader && bordering(f, leader) && treatyStatus(fid, f) !== 'alliance' && dip(fid, f).cooldown <= S.turn && relation(fid, f) > -30);
      if (partners.length && Math.random() < 0.5) { proposeTreaty(fid, partners[0], 'alliance', envoy.name); return; }
      const al = allies(fid).filter((a) => bordering(a, leader) && treatyStatus(a, leader) === 'neutral' && (!S.factions[a].warTarget || S.factions[a].warTargetUntil <= S.turn) && dip(fid, a).cooldown <= S.turn);
      if (al.length && Math.random() < 0.5) { dip(fid, al[0]).cooldown = S.turn + 6; requestJointAttack(fid, al[0], leader, envoy.name); return; }
    }
    // 1. ask the strongest hostile neighbour for a ceasefire when badly outmatched
    if (strongest && totalTroops(strongest) > mine * 1.6 && Math.random() < 0.5) { const sw = houseItems(fid).filter((it) => it.type !== 'seal').sort((a, b) => itemValue(a) - itemValue(b))[0]; proposeTreaty(fid, strongest, 'ceasefire', envoy.name, sw && Math.random() < 0.4 ? sw.id : null); return; }
    // 1b. sell a ceasefire on a secondary front to free a hand for the main war (others may see through it)
    if (F.plan && F.plan.enemy && !has(fid, 'honourable')) {
      const side = hostileN.filter((f) => f !== F.plan.enemy && totalTroops(f) > mine * 0.5);
      if (side.length && Math.random() < 0.35) { proposeTreaty(fid, side[0], 'ceasefire', envoy.name); return; }
    }
    // 1c. ask an ally to join the main war
    if (F.plan && F.plan.enemy && S.factions[F.plan.enemy]) {
      const al = allies(fid).filter((a) => bordering(a, F.plan.enemy) && treatyStatus(a, F.plan.enemy) === 'neutral' && (!S.factions[a].warTarget || S.factions[a].warTargetUntil <= S.turn) && dip(fid, a).cooldown <= S.turn);
      if (al.length && Math.random() < 0.4) { dip(fid, al[0]).cooldown = S.turn + 6; requestJointAttack(fid, al[0], F.plan.enemy, envoy.name); return; }
    }
    // 2. alliances with friendly houses that share an enemy or lie far away
    const friends = others.filter((f) => relation(fid, f) >= 25 && treatyStatus(fid, f) !== 'alliance' && dip(fid, f).cooldown <= S.turn && (sharedEnemy(fid, f) || !bordering(fid, f)));
    if (friends.length && Math.random() < 0.3) { proposeTreaty(fid, pick(friends), 'alliance', envoy.name); return; }
    // 3. ask an ally to join a war against a shared neighbour
    const al = allies(fid).filter((a) => !S.factions[a].warTarget || S.factions[a].warTargetUntil <= S.turn);
    for (const a of al) {
      const target = others.find((e) => e !== a && bordering(fid, e) && bordering(a, e) && treatyStatus(fid, e) === 'neutral' && treatyStatus(a, e) === 'neutral');
      if (target && Math.random() < 0.25 && dip(fid, a).cooldown <= S.turn) { dip(fid, a).cooldown = S.turn + 6; requestJointAttack(fid, a, target, envoy.name); return; }
    }
    // 3b. treacherous houses break a treaty when the partner is weak and the prize is near
    if (has(fid, 'treacherous') && Math.random() < 0.06) {
      const mark = others.find((f) => treatyStatus(fid, f) !== 'neutral' && bordering(fid, f) && totalTroops(f) < mine * 0.4);
      if (mark) { breakTreaty(fid, mark); return; }
    }
    // 4. gifts to a stronger, unfriendly neighbour when rich
    const rich = factionProvinces(fid).filter((p) => p.gold > 3000);
    if (rich.length && strongest && relation(fid, strongest) < 20 && Math.random() < 0.3) sendGift(fid, strongest, rich[0].id, 300);
  }

  let monthStart = null;
  function snapshotMonth() { try { monthStart = JSON.stringify(S); } catch (e) { monthStart = null; } }
  function undoMonth() { if (!monthStart) return false; S = JSON.parse(monthStart); return true; }
  const canUndo = () => !!monthStart;
  // ---------- a founder reclaims his house ----------
  // If the founding lord of a fallen house comes to rule another house (by succession, coup or a new banner),
  // that house becomes his original house again: its id, colour, persona and unfired events all return.
  const FOUNDERS = Object.fromEntries(FACTIONS.map((f) => [f.ruler, f.id]).concat([['L\u00fc Bu', 'lubu']]));
  const rekey = (v, from, to) => (v === from ? to : v);
  function restoreHouse(fid, origId) {
    const F = S.factions[fid]; const base = FACTIONS.find((f) => f.id === origId);
    const dead = S.factions[origId];
    const R = { ...F, id: origId, color: base ? base.color : (dead ? dead.color : F.color), persona: base ? base.persona || [] : (dead ? dead.persona : F.persona), aggr: base ? base.aggr : F.aggr, name: F.dynasty || F.ruler, wanderer: base ? !!base.wanderer : F.wanderer };
    S.factions[origId] = R;
    F.alive = false; F.guest = false; F.host = null; F.hasEmperor = false;
    for (const p of Object.values(S.provinces)) if (p.owner === fid) p.owner = origId;
    for (const o of allOfficers()) { if (o.faction === fid) o.faction = origId; if (o.captive === fid) o.captive = origId; }
    for (const c of S.pendingCaptives) { c.captor = rekey(c.captor, fid, origId); c.from = rekey(c.from, fid, origId); }
    for (const pr of S.pendingProposals || []) pr.from = rekey(pr.from, fid, origId);
    if (S.favors) S.favors = Object.fromEntries(Object.entries(S.favors).map(([k, v]) => [k.split('>').map((x) => rekey(x, fid, origId)).join('>'), v]));
    for (const a of S.pendingAid || []) a.from = rekey(a.from, fid, origId);
    // live battles follow the house too
    for (const B of Object.values(S.battles || {})) {
      B.attF = rekey(B.attF, fid, origId); B.defF = rekey(B.defF, fid, origId); B.att.fid = rekey(B.att.fid, fid, origId); B.def.fid = rekey(B.def.fid, fid, origId);
      for (const u of B.units) u.fid = rekey(u.fid, fid, origId); for (const a of B.arrivals || []) a.fid = rekey(a.fid, fid, origId);
      if (B.helpers) B.helpers = Object.fromEntries(Object.entries(B.helpers).map(([k, v]) => [rekey(k, fid, origId), v]));
    }
    for (const [k, d] of Object.entries(S.diplomacy)) {
      const [a, b] = k.split('|'); if (a !== fid && b !== fid) continue;
      const na = rekey(a, fid, origId), nb = rekey(b, fid, origId); if (na === nb) { delete S.diplomacy[k]; continue; }
      S.diplomacy[na < nb ? `${na}|${nb}` : `${nb}|${na}`] = d; delete S.diplomacy[k];
    }
    for (const f of Object.values(S.factions)) {
      if (f.host === fid) f.host = origId;
      if (f.warTarget === fid) f.warTarget = origId;
      if (f.lastAttackTarget === fid) f.lastAttackTarget = origId;
      if (f.plan && f.plan.enemy === fid) f.plan.enemy = origId;
      if (f.attackedBy && f.attackedBy[fid] != null) { f.attackedBy[origId] = f.attackedBy[fid]; delete f.attackedBy[fid]; }
    }
    if (S.player === fid) S.player = origId;
    if (S.hanEnded && S.hanEnded.by === fid) S.hanEnded.by = origId;
    notice(`${R.ruler}께서 물려받은 가문의 주인이 되어 다시 제 깃발을 드셨소. ${R.name} 가문이 되살아났소.`, 'hist', { major: true });
  }
  function checkRestorations() {
    for (const F of Object.values(S.factions)) {
      if (!F.alive) continue;
      const orig = FOUNDERS[F.ruler];
      if (orig && orig !== F.id && S.factions[orig] && !S.factions[orig].alive) restoreHouse(F.id, orig);
    }
  }


  // ============================================================
  //  Tactical battles: the hex-map engine in js/battle.js, driven from here.
  //  One battle per city; it lives in S.battles[city] and is advanced a day at a time.
  //  Battles between AI houses are fought out at once (thirty days a month); a
  //  battle the player is part of waits for the battle screen.
  // ============================================================
  const tacticalOn = () => !(S.options && S.options.tactical === false);
  const battleExitToward = (city, fromId) => { const m = HEXMAPS[city]; return (m.exits.find((e) => e.to === fromId) || m.exits[0] || null); };
  const battleCtx = (B) => ({
    officer: (n) => off(n), fname, pname, turn: () => S.turn,
    kill: (n, cause) => { const o = off(n); if (o) killOfficer(o, cause); },
    guarded: (n) => { const o = off(n); return o ? guarded(o) : false; },
    duelBonus: (n) => { const o = off(n); return o ? duelBonus(o) : 0; },
    // who may be turned in the field: no rulers, no sworn brothers, no one who hates the new lord, and only the wavering
    canDefect: (n, toFid) => { const o = off(n); if (!o || o.captive || !toFid || !S.factions[toFid] || !S.factions[toFid].alive || o.faction === toFid) return false; if (isRuler(o) || bondGroup(o.name)) return false; const r = rulerOf(toFid); if (r && areEnemies(o.name, r.name)) return false; return o.loyalty < 70; },
    defect: (n, toFid) => {
      const o = off(n); if (!o || !B.att) return; const from = o.faction;
      o.faction = toFid; o.loyalty = 55; o.acted = true; o.city = toFid === B.attF ? B.att.from : B.city;
      B.att.officers = B.att.officers.filter((x) => x !== n); B.def.officers = B.def.officers.filter((x) => x !== n); (toFid === B.attF ? B.att : B.def).officers.push(n);
      const text = `${n}이(가) ${pname(B.city)} 들판에서 ${fname(from)}을(를) 버리고 ${fname(toFid)}께 붙었소.`; if (from === S.player || toFid === S.player) notice(text, 'strat'); else log(text, 'strat');
    },
    raiseLoyalty: (n, d) => { const o = off(n); if (o) o.loyalty = clamp(o.loyalty + d, 0, 100); },
    sackSite: (i, u) => sackSiteFor(B, i, u), siteName, burnSite: (i) => { const st = sitesOf(prov(B.city))[i]; if (st) st.damaged = true; },
    skill: (n, k) => { const o = off(n); return !!(o && hasSkill(o, k)); },
    gold: (side) => { const p = prov(side === 'A' && B.att ? B.att.from : B.city); return p ? p.gold : 0; },
    spendGold: (side, n) => { const p = prov(side === 'A' && B.att ? B.att.from : B.city); if (!p || p.gold < n) return false; p.gold -= n; return true; },
    cityFood: (d) => { const p = prov(B.city); if (d >= 0) { p.food += d; return true; } if (p.food + d < 0) { p.food = 0; return false; } p.food += d; return true; },
    syncCity: (b) => { const p = prov(b.city); if (!b.defF || p.owner === b.defF) p.troops = BATTLE.sideTroops(b, 'D'); },
  });
  const playerSideOf = (B) => (B.att.control === 'player' ? 'A' : B.def.control === 'player' ? 'D' : null);
  const battleFor = (city) => (S.battles && S.battles[city]) || null;
  const playerBattles = () => Object.values(S.battles || {}).filter((B) => playerSideOf(B) && !B.over);

  // what an army is made of: horse country and pastures put more men in the saddle
  const armyMix = (p) => ({ cav: (hasTrait(p, 'horses') ? 0.3 : 0.1) + (hasSite(p, 'pasture') ? 0.1 : 0), arc: 0.2 });
  const seasonName = () => (isWinter() ? 'winter' : isSpring() ? 'spring' : isSummer() ? 'summer' : 'autumn');
  function startBattle(fromId, toId, officerNames, troops, tactics) {
    const a = prov(fromId), b = prov(toId); const attF = a.owner, defF = b.owner;
    a.troops -= troops;
    const exit = battleExitToward(toId, fromId);
    const defOfficers = defF ? officersIn(toId, defF).map((o) => o.name) : [];
    const mods = battleModifiers(fromId, toId);
    const B = BATTLE.create({ city: toId, attF, defF, fromCity: fromId, troops, food: Math.floor(troops * 0.1), officers: officerNames, training: a.training, walls: b.defense, exit,
      cityTroops: b.troops, cityOfficers: defOfficers, cityTraining: b.training, control: { A: attF === S.player ? 'player' : 'ai', D: defF === S.player ? 'player' : 'ai' }, ctx: battleCtx({ city: toId }), record: !!(S.options && S.options.watchBattles),
      fleet: mods.frozen ? 0 : (a.fleet || 0), cityFleet: mods.frozen ? 0 : (b.fleet || 0), sites: sitesOf(b),
      mix: armyMix(a), cityMix: armyMix(b), engines: officerNames.some((n) => off(n) && hasSkill(off(n), 'siege')) || hasSite(a, 'lumber') ? 1 : 0, siegecraft: officerNames.some((n) => off(n) && hasSkill(off(n), 'siege')),
      season: seasonName(), north: isNorth(toId), fog: !(S.options && S.options.fog === false),
      field: defF ? (defF === S.player ? b.posture === 'sally' : b.posture === 'sally' || (b.troops >= troops * 0.9 && defOfficers.some((n) => off(n) && off(n).war >= 75))) : false });
    B.tactics = tactics || {}; B.startD = b.troops; B.att.officers = [...officerNames]; B.def.officers = [...defOfficers]; B.phase = 'idle';
    S.battles[toId] = B;
    if (attF !== S.player) aiCallReinforcements(B, 'A');
    if (defF && defF !== S.player) aiCallReinforcements(B, 'D');
    battleCtx(B).syncCity(B);
    const text = `${fname(attF)}이(가) 병사 ${fmt(troops)}으로 ${pname(toId)}를 에워쌌소${defF ? `, ${fname(defF)}이(가) ${fmt(b.troops)}으로 지켰소` : ''}.`;
    log(text, 'war');
    if (defF === S.player) notice(`${text} 싸움이 그대를 기다리나이다.`, 'war', { major: true });
    if (!playerSideOf(B) && !B.awaitPlayer) runBattleMonth(B);
    return { ok: true, battle: toId, report: B.report || null };
  }
  // neighbours and allies march to the field: the attacker's within one to ten days, the defender's in fifteen to twenty
  function aiCallReinforcements(B, side) {
    const fid = side === 'A' ? B.attF : B.defF; if (!fid) return;
    const F = S.factions[fid]; if (!F || !F.alive) return;
    const days = () => (side === 'A' ? ri(1, 10) : ri(15, 20));
    for (const n of S.adj[B.city]) {
      const p = prov(n); if (!p.owner || n === B.att.from) continue;
      const own = p.owner === fid, allied = !own && treatyStatus(fid, p.owner) === 'alliance' && !S.factions[p.owner].guest;
      if (allied && p.owner === S.player && !S.observer) { askPlayerAid(B, fid, side, n); continue; }
      const owed = allied ? favorsOwed(p.owner, fid) : 0, owing = allied ? favorsOwed(fid, p.owner) : 0;
      const ally = allied && (relation(fid, p.owner) >= (side === 'A' ? 40 : 30) || owed > 0) && Math.random() < (side === 'A' ? 0.5 : 0.6) + 0.3 * Math.min(2, owed) - 0.15 * Math.min(2, owing);
      if (!own && !ally) continue;
      if (own && side === 'D' && (F.attackedBy || {})[B.attF] !== S.turn) { /* the messenger rides anyway */ }
      const spare = own ? spareTroops(fid, p) : Math.floor(p.troops * 0.3);
      const send = Math.floor(own ? spare * (side === 'A' ? 0.5 : 0.4) : spare);
      if (send < 2000) continue;
      const idle = idleOfficers(n).filter((o) => !isRuler(o)).sort((x, y) => y.war - x.war); const escort = idle[0];
      if (!escort) continue;
      escort.acted = true; p.troops -= send; const food = Math.min(p.food, Math.floor(send * 0.1)); p.food -= food;
      BATTLE.addArrival(B, { side, fid: p.owner, from: n, troops: send, food, officers: [escort.name], training: p.training, days: days(), exit: battleExitToward(B.city, n), fleet: p.fleet || 0, mix: armyMix(p) });
      BATTLE.log(B, `${fname(p.owner)}이(가) ${pname(n)}에서 병사 ${fmt(send)}을(를) 보내 ${side === 'A' ? '포위에 가담' : '성 구원'}케 하였소.`, side === 'A' ? 'att' : 'def');
      if (!own) { shiftRelation(fid, p.owner, 5); addFavor(fid, p.owner, `${pname(B.city)} 원군`); }
    }
    B[side === 'A' ? 'att' : 'def'].asked = true;
  }
  // what the player may ask for, and the asking
  function battleRequests(city) {
    const B = battleFor(city); if (!B) return null; const side = playerSideOf(B); if (!side) return null;
    const fid = side === 'A' ? B.attF : B.defF;
    const own = [], allies = [];
    for (const n of S.adj[city]) { const p = prov(n); if (!p.owner || n === B.att.from) continue; if (p.owner === fid) own.push({ city: n, troops: p.troops, spare: spareTroops(fid, p), food: p.food, officers: idleOfficers(n).filter((o) => !isRuler(o)).map((o) => o.name) }); else if (treatyStatus(fid, p.owner) === 'alliance' && !S.factions[p.owner].guest) allies.push({ fid: p.owner, city: n, troops: p.troops, relation: relation(fid, p.owner) }); }
    const ring = side === 'D' && BATTLE.encircled(B);
    return { side, asked: B[side === 'A' ? 'att' : 'def'].asked || ring, encircled: ring, own, allies, days: side === 'A' ? '1에서 10' : '15에서 20' };
  }
  function battleMessengers(city, { own = [], allies = [] }) {
    const B = battleFor(city); if (!B) return fail('그곳에 싸움이 없소.'); const side = playerSideOf(B); if (!side) return fail('그대의 싸움이 아니오.');
    if (side === 'D' && BATTLE.encircled(B)) return fail('성으로 통하는 모든 길이 포위군에 막혔소. 기별꾼이 나갈 수 없소.');
    const fid = side === 'A' ? B.attF : B.defF; const days = () => (side === 'A' ? ri(1, 10) : ri(15, 20)); const sent = [];
    for (const r of own) {
      const p = prov(r.city); if (p.owner !== fid || !S.adj[city].includes(r.city)) continue;
      const troops = Math.max(0, Math.min(p.troops, Math.floor(r.troops || 0))), food = Math.max(0, Math.min(p.food, Math.floor(r.food || 0)));
      if (troops <= 0) continue; const o = r.officer ? off(r.officer) : null; if (!o || o.city !== r.city || o.acted || o.faction !== fid) continue;
      o.acted = true; p.troops -= troops; p.food -= food;
      BATTLE.addArrival(B, { side, fid, from: r.city, troops, food, officers: [o.name], training: p.training, days: days(), exit: battleExitToward(city, r.city), fleet: p.fleet || 0, mix: armyMix(p) });
      sent.push(`${pname(r.city)}에서 ${fmt(troops)}`);
    }
    for (const af of allies) {
      const A = S.factions[af]; if (!A || !A.alive || treatyStatus(fid, af) !== 'alliance') continue;
      const cities = S.adj[city].filter((n) => prov(n).owner === af); if (!cities.length) continue;
      const chance = 0.35 + relation(fid, af) / 200 + (side === 'D' ? 0.1 : 0) + 0.3 * Math.min(2, favorsOwed(af, fid)) - 0.15 * Math.min(2, favorsOwed(fid, af));
      if (Math.random() > chance) { BATTLE.log(B, `${fname(af)}께서 사양하시고 병사를 보내지 않으셨소.`, ''); shiftRelation(fid, af, -5); continue; }
      const n = cities.sort((x, y) => prov(y).troops - prov(x).troops)[0]; const p = prov(n); const send = Math.floor(p.troops * 0.3); if (send < 1000) continue;
      const idle = idleOfficers(n).filter((o) => !isRuler(o)).sort((x, y) => y.war - x.war); const escort = idle[0]; if (!escort) continue;
      escort.acted = true; p.troops -= send; const food = Math.min(p.food, Math.floor(send * 0.1)); p.food -= food;
      BATTLE.addArrival(B, { side, fid: af, from: n, troops: send, food, officers: [escort.name], training: p.training, days: days(), exit: battleExitToward(city, n), fleet: p.fleet || 0, mix: armyMix(p) });
      shiftRelation(fid, af, 5); addFavor(fid, af, `${pname(city)} 원군`); sent.push(`${fname(af)}에게서 ${fmt(send)}`);
    }
    B[side === 'A' ? 'att' : 'def'].asked = true;
    return ok(sent.length ? `기별꾼이 달려나갔소. 오는 중: ${sent.join(', ')} (${side === 'A' ? '1에서 10' : '15에서 20'}일 안에 당도).` : '기별꾼은 떠났으나 오는 원군은 없소.');
  }
  // during a strategic turn: a house on either side (or an ally) sends more men and grain from a neighbouring city
  function reinforceBattle(fromId, city, { troops = 0, food = 0, officers = [] }) {
    const B = battleFor(city); if (!B) return fail('그곳에 싸움이 없소.');
    const p = prov(fromId); if (!p.owner || !S.adj[city].includes(fromId)) return fail('이어진 고을에서만 도울 수 있소.');
    const side = p.owner === B.attF || (B.attF && treatyStatus(p.owner, B.attF) === 'alliance' && B.defF !== p.owner) ? 'A' : p.owner === B.defF || (B.defF && treatyStatus(p.owner, B.defF) === 'alliance') ? 'D' : null;
    if (!side) return fail('그대의 가문은 그 싸움에 끼어 있지 않소.');
    troops = Math.floor(troops); food = Math.floor(food);
    if (troops <= 0 && food <= 0) return fail('병사나 군량을 보내시게.');
    if (troops > p.troops || food > p.food) return fail('그곳에 그만큼이 없소.');
    if (troops > 0 && !officers.length) return fail('행군에는 이끄는 장수가 있어야 하오.');
    for (const n of officers) { const e = useOfficer(n, fromId); if (e) return e; }
    for (const n of officers) off(n).acted = true;
    p.troops -= troops; p.food -= food;
    const house = side === 'A' ? B.attF : B.defF;
    if (p.owner !== house) { B.helpers = B.helpers || {}; if (!B.helpers[p.owner]) { B.helpers[p.owner] = true; shiftRelation(house, p.owner, 5); addFavor(house, p.owner, `${pname(city)} 원군`); } if (p.owner === S.player) S.pendingAid = (S.pendingAid || []).filter((a) => a.city !== city); }
    BATTLE.addArrival(B, { side, fid: p.owner, from: fromId, troops, food, officers, training: p.training, days: ri(1, 10), exit: battleExitToward(city, fromId), fleet: p.fleet || 0, mix: armyMix(p) });
    BATTLE.log(B, `${fname(p.owner)}이(가) ${pname(fromId)}에서 ${troops ? '병사 ' + fmt(troops) : '군량 수레'}${food ? `와 군량 ${fmt(food)}` : ''}을(를) 보냈소.`, side === 'A' ? 'att' : 'def');
    return ok(`행렬이 ${pname(fromId)}를 떠나 ${pname(city)}로 향하오. 열흘 안에 당도할 것이오.`);
  }
  // the AI does the same in its turn for battles it is part of
  function aiReinforceBattles(fid) {
    for (const B of Object.values(S.battles)) {
      if (B.over) continue;
      const side = fid === B.attF ? 'A' : fid === B.defF ? 'D' : (B.attF && treatyStatus(fid, B.attF) === 'alliance' && fid !== B.defF) ? 'A' : (B.defF && treatyStatus(fid, B.defF) === 'alliance') ? 'D' : null;
      if (!side || B.startedTurn === S.turn) continue;   // this month's opening call was already made
      const mine = BATTLE.sideTroops(B, side), theirs = BATTLE.sideTroops(B, side === 'A' ? 'D' : 'A');
      const house = side === 'A' ? B.attF : B.defF;
      if (mine > theirs * 1.5 && fid !== B.defF && !(fid !== house && favorsOwed(fid, house) > 0)) continue;   // a favour owed is a debt to march
      for (const n of S.adj[B.city]) {
        const p = prov(n); if (p.owner !== fid) continue;
        const spare = spareTroops(fid, p); const send = Math.floor(spare * 0.5); const escort = idleOfficers(n).filter((o) => !isRuler(o)).sort((x, y) => y.war - x.war)[0];
        const food = Math.min(Math.floor(p.food * 0.2), 6000);
        if ((send >= 2000 && escort) || (side === 'A' && B.att.food < BATTLE.sideTroops(B, 'A') * BATTLE.FOOD_PER_MAN_DAY * 10 && food > 500)) reinforceBattle(n, B.city, { troops: send >= 2000 && escort ? send : 0, food, officers: send >= 2000 && escort ? [escort.name] : [] });
      }
    }
  }
  function runBattleMonth(B) {
    const ctx = battleCtx(B);
    while (!B.over && B.dayInMonth < 30) BATTLE.runDay(B, ctx);
    if (B.over) finishBattle(B);
  }
  // the player's day: the attacker moves first, so a defending player sees the AI's moves before acting
  function battleBeginDay(city) {
    const B = battleFor(city); if (!B || B.over || B.phase === 'player' || B.dayInMonth >= 30) return fail('시작할 날이 없소.');
    const ctx = battleCtx(B); BATTLE.beginDay(B);
    if (B.att.control === 'ai') BATTLE.aiSide(B, 'A', ctx);
    BATTLE.checkOver(B, ctx); B.phase = 'player';
    if (B.over) finishBattle(B);
    return ok('날이 밝았소.');
  }
  function battleEndDay(city, auto = false) {
    const B = battleFor(city); if (!B || B.over) return fail('싸움이 없소.');
    if (B.phase !== 'player') battleBeginDay(city); if (B.over) return ok('over');
    const ctx = battleCtx(B); const ps = playerSideOf(B);
    if (B.pendingChallenge) BATTLE.answerChallenge(B, auto ? BATTLE.autoAnswer(B, ctx) : false, ctx);   // an unanswered challenge is declined
    if (!B.over && auto && ps && !B.autoActed) { B.autoActed = true; BATTLE.aiSide(B, ps, ctx); }
    if (!B.over && B.def.control === 'ai' && !B.defActed) { B.defActed = true; BATTLE.aiSide(B, 'D', ctx); }
    if (B.pendingChallenge) { if (auto) BATTLE.answerChallenge(B, BATTLE.autoAnswer(B, ctx), ctx); else { B.endPending = true; BATTLE.checkOver(B, ctx); if (B.over) finishBattle(B); return ok('challenge'); } }   // the AI has called out a champion; the player answers before the day ends
    BATTLE.checkOver(B, ctx);
    if (!B.over) BATTLE.endDay(B, ctx);
    B.phase = 'idle'; B.autoActed = false; B.defActed = false; B.endPending = false;
    if (B.over) finishBattle(B);
    return ok('날이 저물었소.');
  }
  function battleAnswerChallenge(city, accept) {
    const B = battleFor(city); if (!B || !B.pendingChallenge) return fail('맞붙자는 장수가 없소.');
    const ctx = battleCtx(B); BATTLE.answerChallenge(B, !!accept, ctx); BATTLE.checkOver(B, ctx);
    if (B.over) { finishBattle(B); return ok('over'); }
    if (B.endPending) return battleEndDay(city);
    return ok(accept ? '장수들이 맞붙으러 나섰소.' : '도전을 사양하였소.');
  }
  function battleFire(city, unitId, c, r) { const B = battleFor(city); if (!B || B.phase !== 'player') return fail('먼저 날을 여시게.'); const u = B.units.find((x) => x.id === unitId); if (!u || u.side !== playerSideOf(B)) return fail('그대의 부대가 아니오.'); return BATTLE.setFire(B, u, c, r, battleCtx(B)) ? ok('불길이 번졌소.') : fail('태울 것이 없거나 날씨가 허락지 않소.'); }
  function battleNight(city) { const B = battleFor(city); if (!B || playerSideOf(B) !== 'A' || B.over) return fail('포위군만이 밤에 칠 수 있소.'); return BATTLE.nightAssault(B) ? ok('내일 밤 대군이 어둠을 틈타 치리라.') : fail('이미 명을 내렸소.'); }
  function battleSally(city, field) { const B = battleFor(city); if (!B || playerSideOf(B) !== 'D') return fail('그대의 수비군이 아니오.'); return BATTLE.redeployField(B, !!field) ? ok(field ? '수비군이 성 밖으로 나섰소.' : '수비군이 성벽을 지켰소.') : fail('배치를 바꾸기엔 이미 늦었소.'); }
  function battleSack(city, unitId) { const B = battleFor(city); if (!B || B.phase !== 'player') return fail('먼저 날을 여시게.'); const u = B.units.find((x) => x.id === unitId); if (!u || u.side !== playerSideOf(B)) return fail('그대의 부대가 아니오.'); return BATTLE.sack(B, u, battleCtx(B)) ? ok('그곳이 불탔소.') : fail('약탈할 것이 여기엔 없소.'); }
  function battleSubornTargets(city) { const B = battleFor(city); if (!B) return []; const ps = playerSideOf(B); return ps ? BATTLE.subornTargets(B, ps, battleCtx(B)) : []; }
  function battleGold(city) { const B = battleFor(city); if (!B) return 0; const ps = playerSideOf(B); return ps ? battleCtx(B).gold(ps) : 0; }
  function battleSuborn(city, unitId, name, gold) {
    const B = battleFor(city); if (!B || B.over) return fail('싸움이 없소.'); const ps = playerSideOf(B); if (!ps || B.phase !== 'player') return fail('그대의 차례가 아니오.');
    const r = BATTLE.suborn(B, ps, unitId, name, Math.max(0, Math.floor(gold || 0)), battleCtx(B));
    if (r.ok) { BATTLE.checkOver(B, battleCtx(B)); if (B.over) finishBattle(B); }
    return r.ok ? ok(r.msg, r.turned ? 'good' : '') : fail(r.msg);
  }
  function battleAutoMonth(city) { const B = battleFor(city); if (!B) return fail('싸움이 없소.'); while (!B.over && B.dayInMonth < 30) battleEndDay(city, true); return ok('다 마쳤소.'); }
  function battleMove(city, unitId, c, r) { const B = battleFor(city); if (!B || B.phase !== 'player') return fail('먼저 날을 여시게.'); const u = B.units.find((x) => x.id === unitId); if (!u || u.side !== playerSideOf(B)) return fail('그대의 부대가 아니오.'); return BATTLE.moveUnit(B, u, c, r) ? ok('이동하였소.') : fail('그 칸은 닿지 않소.'); }
  function battleAttack(city, unitId, targetId, opts = {}) { const B = battleFor(city); if (!B || B.phase !== 'player') return fail('먼저 날을 여시게.'); const u = B.units.find((x) => x.id === unitId), v = B.units.find((x) => x.id === targetId); if (!u || !v || u.side !== playerSideOf(B)) return fail('그대의 부대가 아니오.'); if (u.acted) return fail('그 부대는 오늘 이미 싸웠소.'); if (!BATTLE.visibleTo(B, u.side, v)) return fail('보이는 곳에 적이 없소.'); const r = BATTLE.attackUnit(B, u, v, battleCtx(B), opts); if (r) BATTLE.checkOver(B, battleCtx(B)); if (B.over) finishBattle(B); return r ? ok('공격을 감행하였소.') : fail('닿지 않소.'); }
  function battleRam(city, unitId, c, r) { const B = battleFor(city); if (!B || B.phase !== 'player') return fail('먼저 날을 여시게.'); const u = B.units.find((x) => x.id === unitId); if (!u || u.side !== playerSideOf(B)) return fail('그대의 부대가 아니오.'); return BATTLE.ramGate(B, u, c, r) ? ok('충차가 문을 들이받았소.') : fail('거기엔 들이받을 성문이 없소.'); }
  function battleWithdraw(city) { const B = battleFor(city); if (!B || B.over) return fail('싸움이 없소.'); const ps = playerSideOf(B); if (!ps) return fail('그대의 싸움이 아니오.'); BATTLE.withdraw(B, ps, battleCtx(B)); finishBattle(B); return ok(ps === 'A' ? '포위를 풀었소.' : '수비군이 빠져나가고 성은 넘어갔소.'); }

  function finishBattle(B) {
    if (!S.battles[B.city]) return;
    const from = prov(B.att.from), to = prov(B.city); const attF = B.attF, defF = B.defF;
    const attNames = [...new Set([...B.att.officers, ...B.arrivals.map((a) => a.officers).flat()])];
    const R = { from: B.att.from, to: B.city, attacker: attF, defender: defF, attOfficers: attNames, defOfficers: B.def.officers, lines: B.log.map((l) => ({ text: `${l.day}일: ${l.text}`, cls: l.cls === 'att' ? 'war' : l.cls === 'def' ? 'strat' : l.cls })), result: null, captives: [], tactical: true, mods: battleModifiers(B.att.from, B.city) };
    const captured = new Set(B.captives.map((c) => c.name));
    for (const c of B.captives) { const o = off(c.name); const captor = c.by === 'A' ? attF : defF; if (!o || !captor || !S.factions[captor] || !S.factions[captor].alive || o.captive) continue; if (isRuler(o) && S.factions[o.faction] && S.factions[o.faction].alive && factionProvinces(o.faction).length) { R.lines.push({ text: `${o.name}께서 호위병에 이끌려 빠져나가셨소.`, cls: '' }); continue; } o.captive = captor; S.pendingCaptives.push({ name: o.name, captor, city: B.city, from: o.faction }); }
    const attOff = attNames.map(off).filter((o) => o && !captured.has(o.name) && o.faction === attF);
    const defOff = defF ? officersIn(B.city, defF).filter((o) => !captured.has(o.name)) : [];
    const a = BATTLE.sideTroops(B, 'A') + B.att.fled, d = BATTLE.sideTroops(B, 'D') + Math.floor(B.def.fled * 0.5);
    R.startA = B.att.start; R.startD = B.startD; R.endA = a; R.endD = d;
    const res = B.over ? B.over.result : 'withdrawn';
    R.result = res === 'captured' ? 'captured' : res === 'annihilated' ? 'annihilated' : 'retreat';
    delete S.battles[B.city];
    // the city may have changed hands or lost its lord while the siege ran
    if (to.owner !== defF) { R.result = 'retreat'; R.lines.push({ text: `${pname(B.city)}은(는) 이미 ${defF ? fname(defF) : '아무도'} 지키지 않으니 포위를 풀었소.`, cls: '' }); }
    if (!S.factions[attF] || !S.factions[attF].alive) { R.result = 'annihilated'; }
    to.troops = d;
    if (R.result !== 'captured') { to.food += Math.floor(B.att.food * 0); }
    settleBattle(R, a, B.att.start, attOff, defOff, false);
    if (R.result !== 'captured') from.food += Math.floor(B.att.food);   // the baggage train comes home
    R.replay = B.replay || null; R.city = B.city;
    B.report = R;
    return R;
  }
  // month roll-over: recruits raised in a besieged city join the wall, and AI battles fight the new month at once
  function processBattlesForNewMonth() {
    for (const B of Object.values(S.battles)) {
      if (B.over) { finishBattle(B); continue; }
      const p = prov(B.city);
      if (p.owner !== B.defF || !S.factions[B.attF] || !S.factions[B.attF].alive) { if (!B.over) B.over = { result: p.owner !== B.defF ? 'retreat' : 'annihilated' }; finishBattle(B); continue; }
      const extra = p.troops - BATTLE.sideTroops(B, 'D');
      if (extra > 500) { BATTLE.addArrival(B, { side: 'D', fid: B.defF, from: B.city, troops: extra, food: 0, officers: [], training: p.training, days: 1, exit: null }); p.troops -= extra; }
      B.dayInMonth = 0; B.phase = 'idle';
      if (!playerSideOf(B) && !B.awaitPlayer) runBattleMonth(B);
    }
  }
  // the player's unfinished battles are fought out by the AI before the month can end
  function autoResolvePlayerBattles() {
    for (const B of playerBattles()) battleAutoMonth(B.city);
    // allies' battles that waited on the player's answer: an unanswered plea from a house owed a favour is remembered
    for (const a of S.pendingAid || []) { const B = S.battles[a.city]; const helped = B && B.helpers && B.helpers[S.player]; if (!helped && favorsOwed(S.player, a.from) > 0) shiftRelation(S.player, a.from, -3); }
    S.pendingAid = [];
    for (const B of Object.values(S.battles)) if (B.awaitPlayer && !B.over) { B.awaitPlayer = false; runBattleMonth(B); }
  }

  function endTurn() {
    S.notices = [];
    checkRestorations();
    autoResolvePlayerBattles();
    // resolve any captives the player left unhandled: release them
    for (const c of [...S.pendingCaptives]) if (c.captor === S.player) resolveCaptive(c.name, 'release');
    // proposals the player ignored are declined; decisions left unanswered take the last option
    while (S.pendingProposals.length) respondProposal(0, false);
    while (S.pendingDecisions.length) { const ev = EVENTS.find((e) => e.id === S.pendingDecisions[0].id); decide(0, ev.decision.options.length - 1); }

    const order = Object.keys(S.factions).filter((f) => f !== S.player && S.factions[f].alive);
    order.sort(() => Math.random() - 0.5);
    for (const fid of order) { if (S.factions[fid].alive) aiTurn(fid); }

    advanceMonth();
    processBattlesForNewMonth();
    for (const o of allOfficers()) if (o.faction && !S.factions[o.faction]) { o.faction = null; o.loyalty = 0; }   // a house that was re-keyed leaves no one serving a ghost
    for (const o of allOfficers()) if (o.captive && !S.factions[o.captive]) o.captive = null;
    for (const fid of Object.keys(S.factions)) if (S.factions[fid].alive) ensureRuler(fid);   // the month never ends with a house leaderless
    checkGameOver();
    snapshotMonth();
    return S.notices;
  }

  function advanceMonth() {
    logGarrisons();
    S.month++; S.turn++;
    if (S.month > 12) { S.month = 1; S.year++; }
    const harvest = S.month === 9;
    // treaties: expiring ceasefires, relations drifting back toward neutral
    for (const k of Object.keys(S.diplomacy)) {
      const d = S.diplomacy[k];
      const [a, b] = k.split('|');
      if (d.status === 'ceasefire' && d.until <= S.turn && S.factions[a].alive && S.factions[b].alive) {
        d.status = 'neutral'; d.expiredAt = S.turn;
        const text = `${fname(a)}와 ${fname(b)} 사이의 휴전이 끝났소.`;
        (a === S.player || b === S.player) ? notice(text, 'dip') : log(text, 'dip');
      }
      if (d.status === 'alliance' && d.until && d.until <= S.turn && S.factions[a].alive && S.factions[b].alive) {
        d.status = 'neutral'; d.cooldown = Math.max(d.cooldown || 0, S.turn + 3);
        const text = `${fname(a)}와 ${fname(b)} 사이의 5년 동맹이 끝나고 갱신되지 않았소.`;
        (a === S.player || b === S.player) ? notice(text, 'dip') : log(text, 'dip');
      }
      if (d.status === 'alliance' && Math.random() < 0.3) d.rel = clamp(d.rel + 1, -100, 100);
      else if (d.rel !== 0 && Math.random() < 0.4) d.rel += d.rel > 0 ? -1 : 1;
    }
    for (const f of Object.values(S.factions)) if (f.warTarget && f.warTargetUntil <= S.turn) { f.warTarget = null; }
    if (S.turn % 36 === 0) for (const f of Object.values(S.factions)) if (f.treachery > 0) f.treachery -= 1;   // old sins fade
    for (const p of Object.values(S.provinces)) {
      if (!p.owner) {
        p.troops = Math.min(p.troops + 150, 6000);
        p.gold += 20; p.food += 200;
        p.order = clamp((p.order == null ? 45 : p.order) + (p.order < 50 ? 1 : 0), 0, 100);
        continue;
      }
      const gov = governorOf(p);
      // trade: links to friendly neighbours pay; a hostile border costs
      const links = neighbors(p.id).filter((n) => n.owner && (n.owner === p.owner || treatyStatus(p.owner, n.owner) === 'alliance')).length;
      const hostileBorder = neighbors(p.id).some((n) => n.owner && n.owner !== p.owner && treatyStatus(p.owner, n.owner) === 'neutral');
      const tradeMult = (1 + 0.08 * Math.min(4, links)) * (hostileBorder ? 0.9 : 1);
      p.order = p.order == null ? 70 : p.order;
      const orderMult = 0.5 + p.order / 200;
      const govMult = gov ? 1 + (gov.pol / 1000) * (hasSkill(gov, 'admin') ? 2 : 1) : 1;
      const income = Math.floor((p.comm * 1.2 + p.pop / 5000) * (hasTrait(p, 'salt') ? 1.2 : 1) * (S.factions[p.owner].hasEmperor ? 1.1 : 1) * govMult * tradeMult * orderMult * incomeMult(p.owner));
      p.tradeLinks = links; p.hostileBorder = hostileBorder;
      p.gold += income + siteGold(p);
      p.gold = Math.max(0, p.gold - Math.floor(p.troops * GOLD_UPKEEP));
      p.food += Math.floor((p.agri * FOOD_PER_AGRI + (harvest ? p.agri * HARVEST_MULT : 0)) * (hasTrait(p, 'grain') ? 1.25 : 1)) + Math.floor(siteFood(p));
      const upkeep = Math.floor(p.troops * FOOD_UPKEEP * (isWinter() ? 1.1 : 1));
      p.food -= upkeep;
      if (p.food < 0) {
        const lost = Math.floor(p.troops * 0.12);
        p.troops -= lost; p.food = 0; p.order = clamp(p.order - 10, 0, 100);
        S.factions[p.owner].lastLoss = S.turn;
        const t = `${pname(p.id)}에 기근이 들었소. 군량 부족으로 병사 ${fmt(lost)}이(가) 달아났소.`;
        if (p.owner === S.player) notice(t, 'bad'); else log(t, 'bad');
      }
      const popCap = popCapOf(p);
      const atPeace = !S.adj[p.id].some((n) => prov(n).owner && prov(n).owner !== p.owner && canAttack(p.owner, prov(n).owner));
      const settlers = p.owner && (p.order == null || p.order >= 55) && p.pop < popCap * 0.45 ? Math.floor(popCap * 0.0006) : 0;   // refugees return to orderly, half-empty land
      p.pop += Math.floor(p.pop * 0.004 * (isSpring() ? 1.5 : 1) * (atPeace ? 1.25 : 1) * (1 + 0.1 * sitesOf(p).filter((x) => x.type === 'village' && !x.damaged).length) * Math.max(0, 1 - p.pop / popCap)) + settlers;
      // order: a garrison and a governor keep the peace; neglect breeds revolt
      const garrisoned = p.troops >= p.pop / 60 || officersIn(p.id, p.owner).length > 0;
      const realm = factionProvinces(p.owner).length;
      const strain = realm > 16 ? Math.min(3, Math.floor((realm - 16) / 6) + 1) : 0;   // a realm past a dozen cities frays at the edges
      const cityGov = officersIn(p.id, p.owner).length > 0;
      p.order = clamp(p.order + (garrisoned ? (gov && hasSkill(gov, 'admin') ? 3 : 2) : -3) - (cityGov ? Math.max(0, strain - 1) : strain), 0, 100);
      // encirclement: a stronghold of a house down to its last towns, with enemies on every road and a larger host outside, is cut off from supply
      if (factionProvinces(p.owner).length <= 3 && S.adj[p.id].length) {
        const ring = neighbors(p.id);
        const cut = ring.every((q) => q.owner && q.owner !== p.owner && canAttack(q.owner, p.owner) && !S.factions[q.owner].raider);
        const outside = ring.reduce((a, q) => a + q.troops, 0);
        if (cut && outside > p.troops * 1.2) {
          p.troops -= Math.floor(p.troops * 0.03); p.order = clamp(p.order - 2, 0, 100); p.food = Math.max(0, p.food - Math.floor(p.food * 0.03));
          if (S.turn % 6 === 0) { const t = `${pname(p.id)}은(는) 사방이 막혔소. ${fname(p.owner)}의 마지막 보루에서 밤마다 탈영병이 성벽을 넘나이다.`; (p.owner === S.player) ? notice(t, 'bad') : log(t, 'bad'); }
        }
      }
      if (p.order < 20 && Math.random() < 0.1) {
        const owner = p.owner; const refuge = factionProvinces(owner).find((q) => q.id !== p.id && S.adj[p.id].includes(q.id)) || factionProvinces(owner).find((q) => q.id !== p.id);
        for (const o of officersIn(p.id, owner)) { if (refuge) o.city = refuge.id; else { o.faction = null; o.loyalty = 0; } }
        p.owner = null; p.troops = Math.floor(p.troops * 0.5); p.order = 50; p.posture = 'hold';
        const t = `${pname(p.id)} 백성이 ${fname(owner)}께 반기를 들고 수비군을 몰아냈소!`;
        (owner === S.player) ? notice(t, 'bad', { major: true }) : log(t, 'bad');
        S.factions[owner].lastLoss = S.turn;
        if (S.factions[owner].alive && !factionProvinces(owner).length && !S.factions[owner].guest) { if (!(S.factions[owner].wanderer && goGuest(owner, p.id, null)) && !fleeToEmpty(owner, p.id, p.troops * 0.3, 0)) dissolveHouse(owner); }
        continue;
      }
      // summer floods on the lower Yellow River
      if (isSummer() && FLOOD_PLAIN.includes(p.id) && Math.random() < 0.06) {
        const lossA = ri(15, 45), lossF = Math.floor(p.food * 0.25), dead = Math.floor(p.troops * 0.05);
        p.agri = Math.max(0, p.agri - lossA); p.food -= lossF; p.troops -= dead;
        const t = `${pname(p.id)}에 황하가 범람하였소. 농업 -${lossA}, 군량 -${fmt(lossF)}, 병사 ${fmt(dead)}이(가) 물에 잠겼소.`;
        p.owner === S.player ? notice(t, 'bad') : log(t, 'bad');
      }
      // random events
      const r = Math.random();
      if (r < 0.025) {
        const g = Math.floor(p.agri * 10); p.food += g;
        const t = `${pname(p.id)}에 대풍이 들었소. 군량 +${fmt(g)}.`;
        p.owner === S.player ? notice(t, 'good') : log(t, 'good');
      } else if (r < 0.045) {
        const lossA = ri(10, 40), lossF = Math.floor(p.food * 0.2);
        p.agri = Math.max(0, p.agri - lossA); p.food -= lossF;
        const t = `${pname(p.id)}에 홍수가 졌소. 농업 -${lossA}, 군량 -${fmt(lossF)}.`;
        p.owner === S.player ? notice(t, 'bad') : log(t, 'bad');
      } else if (r < 0.06) {
        const dead = Math.floor(p.troops * 0.1);
        p.troops -= dead; p.pop = Math.floor(p.pop * 0.97);
        const t = `${pname(p.id)}에 역병이 돌았소. 병사 ${fmt(dead)}이(가) 숨졌소.`;
        p.owner === S.player ? notice(t, 'bad') : log(t, 'bad');
      } else if (r < 0.075) {
        const g = Math.floor(p.gold * 0.25); p.gold -= g;
        const t = `${pname(p.id)} 곳간을 도적이 털었소. 금 -${fmt(g)}.`;
        p.owner === S.player ? notice(t, 'bad') : log(t, 'bad');
      }
    }
    if (harvest) notice('가을 추수라 온 땅의 창고가 가득 찼소.', 'good');
    if (S.month === 3) notice('봄이오. 백성이 불고 들에 씨를 뿌리니 북쪽 관문의 눈도 녹았소.', 'sys');
    if (S.month === 6) notice('여름이오. 남쪽 장마에 군사가 묶이고 황하가 불어 위험하오.', 'sys');
    if (S.month === 12) notice('겨울이오. 북쪽 관문이 눈으로 막히고 주둔군은 군량을 한 할 더 먹나이다.', 'sys');

    // a living house must always have a lord of its own; heal any inconsistency by succession
    for (const F of Object.values(S.factions)) if (F.alive) ensureRuler(F.id);
    // loyalty drift and defection
    for (const o of allOfficers()) {
      o.acted = false;
      if (!o.faction || o.captive || isRuler(o)) continue;
      const ruler = rulerOf(o.faction);
      if (!ruler) continue;
      if (Math.random() < 0.35) {
        if (ruler.chr >= 90 || (S.factions[o.faction].prestige || 0) >= 50 || (S.factions[o.faction].title || 0) >= 2) o.loyalty = clamp(o.loyalty + 1, 0, 100);
        else if (ruler.chr < 70) o.loyalty = clamp(o.loyalty - 1, 0, 100);
      }
      // ties: kin and sworn brothers of the lord are steadfast; brothers in the same house steady each other; rivals grate
      if (bonded(o.name, ruler.name)) o.loyalty = 100;
      else if (factionOfficers(o.faction).some((x) => x !== o && bonded(o.name, x.name))) o.loyalty = Math.max(o.loyalty, 85);
      if (factionOfficers(o.faction).some((x) => x !== o && areRivals(o.name, x.name)) && Math.random() < 0.5) o.loyalty = clamp(o.loyalty - 1, 0, 100);
      if (areEnemies(o.name, ruler.name) && Math.random() < 0.5) o.loyalty = clamp(o.loyalty - 2, 0, 100);
      if (loyaltyFloor(o) && o.loyalty < loyaltyFloor(o)) o.loyalty = loyaltyFloor(o);
      // a sworn brother or kinsman who rules another house calls him home
      const kinLord = bondedRuler(o, o.faction);
      if (kinLord && !isRuler(o) && Math.random() < 0.1) {
        const oldF = o.faction; const dest = rulerOf(kinLord).city;
        o.faction = kinLord; o.city = dest; o.loyalty = 100; o.rank = 0;
        const text = `${o.name}이(가) ${fname(oldF)}를 떠나 의형제이신 ${fname(kinLord)}께 합류하고자 ${pname(dest)}로 갔소.`;
        (oldF === S.player || kinLord === S.player) ? notice(text, 'hist') : log(text, 'hist');
        continue;
      }
      if (bondGroup(o.name) && factionOfficers(o.faction).some((x) => x !== o && bonded(o.name, x.name))) continue;   // the bonded never desert their brothers
      if (o.loyalty < 35 && Math.random() < 0.12) {
        const targets = enemyNeighbors(o.city).filter((n) => n.owner);
        const oldF = o.faction;
        if (targets.length) {
          const t = pick(targets);
          o.faction = t.owner; o.city = t.id; o.loyalty = 60 + ri(0, 15);
          const text = `${o.name}이(가) ${fname(oldF)}를 배신하고 ${fname(t.owner)}께 붙었소!`;
          (oldF === S.player || t.owner === S.player) ? notice(text, 'bad') : log(text, 'bad');
        } else {
          o.faction = null; o.loyalty = 0;
          const text = `${o.name}이(가) ${fname(oldF)}를 버리고 자취를 감추었소.`;
          oldF === S.player ? notice(text, 'bad') : log(text, 'bad');
        }
      }
    }
    processGuests();
    processEvents();
    processObjectives();
    processAgeing();
    processArrivals();
    processTitles();
    if (S.month === 1) S.history.push({ year: S.year, houses: Object.fromEntries(Object.values(S.factions).filter((f) => f.alive && !f.raider).map((f) => [f.id, { name: f.name, color: f.color, cities: factionProvinces(f.id).length, troops: totalTroops(f.id) }])), officers: allOfficers().length });
    const note = HISTORY_NOTES[`${S.year}-${S.month}`];
    if (note) notice(note, 'hist');
  }

  function checkGameOver() {
    if (S.observer) {
      const holders = [...new Set(Object.values(S.provinces).map((p) => p.owner).filter(Boolean))];
      if (holders.length <= 1 && !Object.values(S.provinces).some((p) => !p.owner)) { S.over = 'observer'; S.winner = holders[0] || null; }
      return;
    }
    const mine = factionProvinces(S.player).length;
    if (!S.factions[S.player].alive) { S.over = 'defeat'; return; }
    if (mine === 0 && !S.factions[S.player].guest) { S.over = 'defeat'; return; }
    const total = Object.keys(S.provinces).length;
    if (mine === total) { S.over = 'victory'; return; }
  }

  // ---------- AI ----------
  function aiTurn(fid) {
    quiet = true;
    try { aiTurnInner(fid); } finally { quiet = false; }
  }

  // Strength estimates shared by the AI (mirror the battle formula's first round)
  function defStrength(t) {
    const tOff = t.owner ? officersIn(t.id, t.owner) : [];
    const fb = t.owner ? GARRISON : MILITIA;
    return t.troops * (0.5 + best(tOff, 'war', fb) / 100) * (0.7 + best(tOff, 'ldr', fb) / 250) * (0.7 + t.training / 300) * (1 + t.defense / WALL_DIV);
  }
  function attStrength(troops, party, p) {
    return troops * (0.5 + best(party, 'war', MILITIA) / 100) * (0.7 + best(party, 'ldr', MILITIA) / 250) * (0.7 + p.training / 300);
  }
  // How many soldiers a city can feed and draw from its population
  const sustainCap = (p) => Math.floor(Math.min(p.agri * 50, p.pop * 0.22));
  function aiParty(pid) {
    let idle = idleOfficers(pid).filter((o) => !isRuler(o)).sort((x, y) => y.war - x.war);
    if (!idle.length) idle = idleOfficers(pid);
    return idle.slice(0, 3);
  }

  // ---------- AI: personality, planning and play ----------
  const baseThreshold = (fid) => { const F = S.factions[fid]; let th = Math.max(1.05, 1.25 / F.aggr); if (has(fid, 'reckless')) th -= 0.1; if (has(fid, 'cautious')) th += 0.1; return Math.min(1.5, Math.max(0.95, th)); };
  const spareTroops = (fid, p) => { const hostileN = neighbors(p.id).filter((n) => n.owner !== fid && n.owner && canAttack(fid, n.owner)); const safe = Math.max(3000, ...hostileN.map((n) => n.troops * 0.6)); return Math.max(0, p.troops - safe); };
  const isFront = (fid, p) => neighbors(p.id).some((n) => n.owner !== fid && (!n.owner || canAttack(fid, n.owner)));
  const threatOn = (fid, p) => Math.max(0, ...neighbors(p.id).filter((n) => n.owner && n.owner !== fid && canAttack(fid, n.owner)).map((n) => n.troops));
  // a garrison that has grown by a third within three months is an army being gathered: count the growth as a threat to
  // everything within two hops, in full next door and at three fifths one city further
  const hopsFrom = (id, k) => { const d = { [id]: 0 }; const q = [id]; while (q.length) { const x = q.shift(); if (d[x] >= k) continue; for (const n of S.adj[x]) if (d[n] === undefined) { d[n] = d[x] + 1; q.push(n); } } return d; };
  function buildupNear(fid, p) {
    const log = S.garrisonLog || {}; let sum = 0;
    for (const [id, dist] of Object.entries(hopsFrom(p.id, 2))) {
      if (!dist) continue; const n = prov(id); if (!n.owner || n.owner === fid || !canAttack(fid, n.owner)) continue;
      const h = log[id]; if (!h || h.length < 3) continue;
      const base = Math.min(...h.slice(0, 3)); if (n.troops >= base * 1.33 && n.troops - base >= 3000) sum += (n.troops - base) * (dist === 1 ? 1 : 0.6);
    }
    return sum;
  }
  const forecastThreat = (fid, p) => threatOn(fid, p) + buildupNear(fid, p);
  // the mobile reserve: the interior city with the most friendly neighbours keeps half its spare men at home
  const reserveCity = (fid) => factionProvinces(fid).filter((p) => !isFront(fid, p)).sort((a, b) => neighbors(b.id).filter((n) => n.owner === fid).length - neighbors(a.id).filter((n) => n.owner === fid).length || b.troops - a.troops)[0] || null;
  function logGarrisons() { S.garrisonLog = S.garrisonLog || {}; for (const p of Object.values(S.provinces)) { const h = S.garrisonLog[p.id] || (S.garrisonLog[p.id] = []); h.push(p.troops); if (h.length > 4) h.shift(); } }
  const nextHop = (fid, fromId, toId) => {   // BFS through own cities
    if (fromId === toId) return null;
    const prevMap = { [fromId]: null }; const q = [fromId];
    while (q.length) { const x = q.shift(); for (const n of S.adj[x]) { if (prevMap[n] !== undefined || prov(n).owner !== fid) continue; prevMap[n] = x; if (n === toId) { let cur = n; while (prevMap[cur] !== fromId) cur = prevMap[cur]; return cur; } q.push(n); } }
    return null;
  };

  // ---------- the largest power thinks differently ----------
  function detectPhase(fid) {
    const F = S.factions[fid];
    const mine = factionProvinces(fid); const n = mine.length;
    const others = Object.values(S.factions).filter((f) => f.alive && !f.raider && f.id !== fid).map((f) => factionProvinces(f.id).length);
    const second = Math.max(0, ...others);
    const total = Object.keys(S.provinces).length;
    if (n >= 12 && (n * 2 >= total || (n * 5 >= total * 2 && n >= second * 2.5))) { F.phase = 'unifying'; F.consolidatingSince = 0; return F.phase; }   // steamroll what is left
    const hegemon = n >= 10 && (n >= second * 1.5 || leaderHouse() === fid);
    if (!hegemon) { F.phase = 'rising'; return F.phase; }
    const avgOrder = mine.reduce((a, p) => a + p.order, 0) / Math.max(1, n);
    const lowOrder = mine.filter((p) => p.order < 50).length;
    const recentGains = (F.gains || []).filter((t) => S.turn - t < 24).length;
    const wants = (avgOrder < 62 || lowOrder >= 3 || recentGains >= 4) ? 'consolidating' : 'hegemon';
    // digesting has a limit: after two years the court demands the war be finished, and the last rival is never left in peace
    if (wants === 'consolidating') { if (!F.consolidatingSince) F.consolidatingSince = S.turn; } else F.consolidatingSince = 0;
    F.phase = wants === 'consolidating' && (S.turn - F.consolidatingSince > 24 || lastFoe(fid)) ? 'hegemon' : wants;
    return F.phase;
  }
  // the last rival: when every other lord is gone (or a guest), there is nothing left to court
  const rivals = (fid) => Object.values(S.factions).filter((f) => f.alive && !f.raider && !f.guest && f.id !== fid);
  const lastFoe = (fid) => { const r = rivals(fid); return r.length === 1 ? r[0].id : null; };
  const coalitionAgainst = (fid) => Object.entries(S.factions[fid].attackedBy || {}).filter(([f, t]) => S.turn - t <= 12 && S.factions[f] && S.factions[f].alive && !S.factions[f].raider).map(([f]) => f);
  const secondPower = (fid) => Object.values(S.factions).filter((f) => f.alive && !f.raider && f.id !== fid).sort((a, b) => factionProvinces(b.id).length - factionProvinces(a.id).length)[0] || null;
  // Realm cohesion. The AI wants a compact realm with a short frontier, not a scatter of cities across the map:
  // it prefers targets that touch several of its own cities, that reunite separated blocks of its land, and that
  // turn frontier cities into interior ones rather than pushing a lonely salient into enemy country.
  const isForeign = (fid, n) => n.owner !== fid && (!n.owner || canAttack(fid, n.owner));
  function realmComponents(fid) {
    const comp = {}; let k = 0;
    for (const p of factionProvinces(fid)) {
      if (comp[p.id] !== undefined) continue;
      k++; const q = [p.id]; comp[p.id] = k;
      while (q.length) { const x = q.pop(); for (const n of S.adj[x]) if (prov(n).owner === fid && comp[n] === undefined) { comp[n] = k; q.push(n); } }
    }
    return { comp, count: k };
  }
  function cohesion(fid, t, comps) {
    const nb = neighbors(t.id);
    const mineNb = nb.filter((n) => n.owner === fid);
    const foreign = nb.filter((n) => isForeign(fid, n)).length;
    const joins = new Set(mineNb.map((n) => comps.comp[n.id])).size >= 2;
    // frontier change: t joins the front if anything hostile still touches it; my neighbours whose only hostile neighbour was t leave it
    let delta = foreign ? 1 : 0;
    for (const n of mineNb) if (isFront(fid, n) && !neighbors(n.id).some((m) => m.id !== t.id && isForeign(fid, m))) delta -= 1;
    return { mineNb: mineNb.length, foreign, joins, delta, salient: mineNb.length === 1 && foreign >= 3 };
  }
  // a linchpin is a city whose loss would cut the realm in two: the AI holds it and reinforces it first
  function isLinchpin(fid, pid) {
    const mineNb = S.adj[pid].filter((n) => prov(n).owner === fid);
    if (mineNb.length < 2) return false;
    const seen = new Set([mineNb[0]]); const q = [mineNb[0]];
    while (q.length) { const x = q.pop(); for (const n of S.adj[x]) if (n !== pid && prov(n).owner === fid && !seen.has(n)) { seen.add(n); q.push(n); } }
    return mineNb.some((n) => !seen.has(n));
  }
  // multiplier on the strength an AI demands before an opportunistic strike: a strike that lengthens the line must be very favourable
  const cohesionBar = (co) => Math.max(0.8, 1 + 0.2 * Math.max(0, co.delta) + (co.salient ? 0.25 : 0) - (co.joins ? 0.25 : 0) - 0.05 * Math.max(0, co.mineNb - 1));

  // Govern the realm: interior garrisons feed the frontier, administrators go inland, generals go out,
  // a reserve waits in the middle, and the succession is prepared.
  function aiHegemon(fid) {
    const F = S.factions[fid];
    const mine = factionProvinces(fid);
    const seat = rulerOf(fid).city;
    const fronts = mine.filter((p) => isFront(fid, p));
    const interior = mine.filter((p) => !isFront(fid, p));
    // 1. reserve: the interior city with the most troops nearest the fronts
    const reserve = interior.length ? interior.reduce((m, p) => (p.troops > m.troops ? p : m)) : null;
    F.reserve = reserve ? reserve.id : null;
    // 2. interior cities keep a peacekeeping garrison and push the rest toward the front (or the reserve)
    for (const p of interior) {
      if (reserve && p.id === reserve.id) continue;
      const keep = F.phase === 'unifying' ? Math.max(1200, Math.floor(p.pop / 120)) : Math.max(3000, Math.floor(p.pop / 60));
      const spare = p.troops - keep;
      const idle = idleOfficers(p.id).filter((o) => !isRuler(o));
      if (spare < (F.phase === 'unifying' ? 800 : 2500) || !idle.length || officersIn(p.id, fid).length < (p.order >= 60 ? 1 : 2)) continue;   // a quiet interior town may be left to its magistrates
      const dest = fronts.length ? fronts.reduce((m, f) => ((threatOn(fid, f) / Math.max(1, f.troops)) > (threatOn(fid, m) / Math.max(1, m.troops)) ? f : m)) : reserve;
      if (!dest) continue;
      const hop = S.adj[p.id].includes(dest.id) ? dest.id : nextHop(fid, p.id, dest.id);
      if (!hop) continue;
      const escort = idle.filter((o) => !hasSkill(o, 'admin')).sort((a, b) => b.war - a.war)[0] || idle[0];
      transfer(p.id, hop, { troops: Math.floor(spare * 0.8), gold: Math.floor(Math.max(0, p.gold - 1500) * 0.5), food: Math.floor(Math.max(0, p.food - p.troops * FOOD_UPKEEP * 8) * 0.5), officers: [escort.name] });
    }
    // 3. the reserve rides to whichever border is in danger
    if (reserve) {
      const danger = fronts.filter((f) => threatOn(fid, f) > f.troops * 1.1).sort((a, b) => (threatOn(fid, b) - b.troops) - (threatOn(fid, a) - a.troops))[0];
      const idle = idleOfficers(reserve.id).filter((o) => !isRuler(o));
      if (danger && idle.length && reserve.troops > 4000) {
        const hop = S.adj[reserve.id].includes(danger.id) ? danger.id : nextHop(fid, reserve.id, danger.id);
        if (hop) transfer(reserve.id, hop, { troops: Math.floor(reserve.troops * 0.7), officers: [idle.sort((a, b) => b.war - a.war)[0].name] });
      } else if (!danger && idle.length && F.plan && prov(F.plan.hammer).owner === fid && F.plan.hammer !== reserve.id && reserve.troops > (F.phase === 'unifying' ? 3000 : 12000)) {
        // no border in danger: the reserve does not sit idle but marches to the main blow (a hegemon keeps a core at home; a unifier sends nearly all)
        const hop = S.adj[reserve.id].includes(F.plan.hammer) ? F.plan.hammer : nextHop(fid, reserve.id, F.plan.hammer);
        if (hop) transfer(reserve.id, hop, { troops: Math.floor(reserve.troops * (F.phase === 'unifying' ? 0.8 : 0.5)), food: Math.floor(Math.max(0, reserve.food - reserve.troops * FOOD_UPKEEP * 6) * 0.4), officers: [idle.sort((a, b) => b.war - a.war)[0].name] });
      }
    }
    // 4. administrators inland, to the richest interior cities without one
    for (const p of interior.sort((a, b) => b.comm - a.comm).slice(0, 4)) {
      if (officersIn(p.id, fid).some((o) => hasSkill(o, 'admin'))) continue;
      const donor = mine.find((d) => d.id !== p.id && S.adj[d.id].includes(p.id) && officersIn(d.id, fid).length >= 2 && idleOfficers(d.id).some((o) => hasSkill(o, 'admin') && !isRuler(o)));
      if (donor) { const adm = idleOfficers(donor.id).find((o) => hasSkill(o, 'admin') && !isRuler(o)); transfer(donor.id, p.id, { officers: [adm.name] }); }
    }
    // 5. new or restless cities get an officer to sit on them
    for (const p of mine.filter((q) => q.order < 55 && officersIn(q.id, fid).length === 0)) {
      const donor = mine.find((d) => S.adj[d.id].includes(p.id) && officersIn(d.id, fid).length >= 2 && idleOfficers(d.id).some((o) => !isRuler(o)));
      if (donor) { const o = idleOfficers(donor.id).filter((x) => !isRuler(x)).sort((a, b) => b.pol - a.pol)[0]; transfer(donor.id, p.id, { officers: [o.name] }); }
    }
    // 6. the succession and the ambitious: kin and marshals ranked and kept close, restless generals not left in rich far cities
    const seatP = prov(seat);
    for (const o of factionOfficers(fid)) {
      if (isRuler(o)) continue;
      const kin = bonded(o.name, rulerOf(fid).name);
      const ambitious = (o.war + o.ldr) / 2 >= 85 && o.loyalty < 75;
      if ((kin || ambitious) && (o.rank || 0) < 3 && prov(o.city).owner === fid && prov(o.city).gold >= RANK_COST[(o.rank || 0) + 1]) appoint(o.city, o.name);
      if (kin && o.city !== seat && !o.acted && prov(o.city).owner === fid && !isFront(fid, prov(o.city))) { const hop = S.adj[o.city].includes(seat) ? seat : nextHop(fid, o.city, seat); if (hop && officersIn(o.city, fid).length >= 2) transfer(o.city, hop, { officers: [o.name] }); }
      if (ambitious && !kin && !o.acted && prov(o.city).owner === fid && prov(o.city).gold > 4000 && o.city !== seat) { const hop = S.adj[o.city].includes(seat) ? seat : nextHop(fid, o.city, seat); if (hop && officersIn(o.city, fid).length >= 2) transfer(o.city, hop, { officers: [o.name] }); }
    }
    // 7. titles: a hegemon takes what it is owed, at once; without the Emperor, his court is the prize
    const elig = eligibleTitle(fid);
    if (elig > (F.title || 0)) assumeTitle(fid, elig);
    if (!F.hasEmperor) { const holder = Object.values(S.factions).find((f) => f.hasEmperor && f.alive && f.id !== fid); if (holder && bordering(fid, holder.id) && canAttack(fid, holder.id)) { F.warTarget = holder.id; F.warTargetUntil = S.turn + 6; } }
    // 8. under a coalition, give ground at the edges and strike the nearest member with everything
    const coal = coalitionAgainst(fid);
    if (coal.length >= 2) {
      const near = coal.filter((c) => bordering(fid, c)).sort((a, b) => totalTroops(a) - totalTroops(b))[0];
      if (near) { F.warTarget = near; F.warTargetUntil = S.turn + 6; }
    }
  }

  // Choose the main war for the month: enemy house (or free city), hammer city, target city.
  function makePlan(fid, avoid = null) {
    const F = S.factions[fid]; const th = baseThreshold(fid);
    const destiny = destinyTargets(fid); const leader = leaderHouse();
    const warTarget = F.warTarget && F.warTargetUntil > S.turn && S.factions[F.warTarget] && S.factions[F.warTarget].alive ? F.warTarget : null;
    let best = null; const comps = realmComponents(fid);
    // a split realm wants to grow back together: distance of every city from the block that holds the seat
    let distMain = null;
    if (comps.count > 1) {
      const seatComp = comps.comp[rulerOf(fid).city]; distMain = {};
      const q = factionProvinces(fid).filter((p) => comps.comp[p.id] === seatComp).map((p) => p.id); for (const c of q) distMain[c] = 0;
      while (q.length) { const x = q.shift(); for (const n of S.adj[x]) if (distMain[n] === undefined) { distMain[n] = distMain[x] + 1; q.push(n); } }
    }
    for (const p of factionProvinces(fid)) {
      const party = officersIn(p.id, fid).filter((o) => !isRuler(o)).sort((a, b) => b.war - a.war).slice(0, 3);
      if (!party.length) continue;
      const reinforce = neighbors(p.id).filter((n) => n.owner === fid).reduce((s, n) => s + spareTroops(fid, n) * 0.8, 0);
      const potential = p.troops * 0.7 + reinforce;
      for (const t of neighbors(p.id)) {
        if (t.owner === fid || !canAttack(fid, t.owner) || (S.battles && S.battles[t.id])) continue;
        if (avoid && (t.id === avoid.target || p.id === avoid.hammer || S.adj[avoid.target].includes(t.id) || S.adj[avoid.hammer].includes(p.id))) continue;   // a second front is a different front
        const m = battleModifiers(p.id, t.id); if (m.blocked) continue;
        let ratio = (attStrength(potential * (1 - m.loss), party, p) * m.att) / Math.max(1, defStrength(t) * m.def);
        let score = ratio;
        if (!t.owner) score += 0.25;
        if (destiny.has(t.id)) score += 0.3;
        if (t.owner && t.owner === warTarget) score += 0.4;
        if (t.owner && S.turn - (S.factions[t.owner].lastLoss || -99) <= 6) score += 0.25;     // opportunism
        if (t.owner && t.owner === leader && leader !== fid) score += 0.3;                      // coalition
        if (t.owner && relation(fid, t.owner) <= -30) score += 0.1;
        if (t.owner && S.factions[t.owner].raider) score += 0.15;                              // stamp out raiders
        const richness = (t.gold + t.food / 10) / 20000; if (F.raider) score += richness;      // raiders want loot
        const co = cohesion(fid, t, comps);
        if (!F.raider) {
          score += 0.12 * Math.min(3, co.mineNb - 1);                                            // hug my own land
          score -= 0.15 * Math.max(-3, Math.min(3, co.delta));                                   // shorten the frontier
          if (co.joins) score += 0.45;                                                           // reunite a split realm
          if (distMain && distMain[t.id] !== undefined && distMain[p.id] !== undefined && distMain[t.id] < distMain[p.id]) score += 0.35;   // a step back toward the seat
          if (co.salient && !destiny.has(t.id) && t.owner !== warTarget) score -= 0.3;          // no lonely salients
        }
        if (F.phase !== 'rising') {
          // the largest power: finish small neighbours, shorten the frontier, strike the second power decisively, avoid new fronts
          if (t.owner && factionProvinces(t.owner).length <= 2) score += 0.5;
          score -= 0.1 * Math.max(-3, Math.min(3, co.delta));                                   // the hegemon cares even more for a tidy line
          const sp = secondPower(fid);
          if (t.owner && sp && t.owner === sp.id && totalTroops(fid) >= totalTroops(sp.id) * 2 && rulerOf(sp.id) && rulerOf(sp.id).city === t.id) score += 0.3;
          if (F.phase !== 'unifying' && t.owner && F.plan && F.plan.enemy && t.owner !== F.plan.enemy && factionProvinces(t.owner).length > 2) score -= 0.3;
          if (F.phase === 'unifying' && t.owner) score += 0.2 + 0.4 / Math.max(1, factionProvinces(t.owner).length);   // finish the small ones, then the rest
          if (F.phase === 'consolidating' && t.owner && factionProvinces(t.owner).length > 2) score -= 0.6;   // digest first
        }
        if (!best || score > best.score) best = { enemy: t.owner, hammer: p.id, target: t.id, score, ratio, since: S.turn };
      }
    }
    const slot = avoid ? 'plan2' : 'plan'; const cur = F[slot];
    const valid = cur && prov(cur.hammer).owner === fid && prov(cur.target).owner === cur.enemy && prov(cur.target).owner !== fid && S.adj[cur.hammer].includes(cur.target) && canAttack(fid, cur.enemy) && !(avoid && (cur.target === avoid.target || cur.hammer === avoid.hammer));
    if (valid && S.turn - cur.since < 12 && (!best || best.score < cur.score * 1.4)) { return cur; }
    F[slot] = best; return best;
  }

  function aiPrisoners(fid) {
    for (const c of [...S.pendingCaptives]) {
      if (c.captor !== fid) continue;
      const o0 = off(c.name);
      if (o0 && c.from === S.player && !c.ransomAsked && S.factions[S.player] && S.factions[S.player].alive && factionProvinces(S.player).length && Math.random() < 0.5) { c.ransomAsked = true; S.pendingProposals.push({ from: fid, type: 'ransom', officer: c.name, price: ransomPrice(o0), envoy: (rulerOf(fid) || { name: fname(fid) }).name }); continue; }
      if (c.ransomAsked && S.pendingProposals.some((pr) => pr.type === 'ransom' && pr.officer === c.name)) continue;   // waiting on the answer
      let w = { recruit: 0.7, release: 0.22, execute: 0.08 };
      if (has(fid, 'honourable')) w = { recruit: 0.5, release: 0.5, execute: 0 };
      if (has(fid, 'schemer')) w = { recruit: 0.85, release: 0.12, execute: 0.03 };
      if (has(fid, 'treacherous')) w = { recruit: 0.5, release: 0.15, execute: 0.35 };
      const o = off(c.name); if (o && c.from && S.factions[c.from] && S.factions[c.from].ruler === c.name && has(fid, 'treacherous')) w = { recruit: 0.2, release: 0.1, execute: 0.7 };
      const r = Math.random(); resolveCaptive(c.name, r < w.recruit ? 'recruit' : r < w.recruit + w.release ? 'release' : 'execute');
    }
  }

  // what limits the house this month: food to feed its men, gold to raise and pay them, men below what the land can bear, or officers to govern
  function bottleneck(fid) {
    const provs = factionProvinces(fid); if (!provs.length) return null;
    const troops = provs.reduce((a, p) => a + p.troops, 0), food = provs.reduce((a, p) => a + p.food, 0), gold = provs.reduce((a, p) => a + p.gold, 0);
    const cap = provs.reduce((a, p) => a + sustainCap(p), 0);
    const foodMonths = food / Math.max(1, troops * FOOD_UPKEEP);
    if (foodMonths < 5 || provs.filter((p) => sustainCap(p) < p.troops * 0.8).length > provs.length / 2) return 'food';
    if (gold / provs.length < 500) return 'gold';
    if (factionOfficers(fid).length < provs.length * 1.2) return 'officers';
    if (troops < cap * 0.6 && gold / provs.length > 900) return 'men';
    return null;
  }
  function aiTurnInner(fid) {
    const F = S.factions[fid];
    if (!ensureRuler(fid)) return;
    if (F.guest) { aiExile(fid); return; }
    F.caution = Math.max(1, (F.caution || 1) - 0.05);
    aiPrisoners(fid);
    if (Math.random() < 0.6) aiDiplomacy(fid);
    aiAppoint(fid);
    aiPlots(fid);
    if (tacticalOn()) aiReinforceBattles(fid);
    aiRepayFavors(fid);
    const hostile = (n) => n.owner !== fid && canAttack(fid, n.owner);
    const comps = realmComponents(fid);
    const phase = detectPhase(fid);
    if (phase !== 'rising') aiHegemon(fid);
    const plan = makePlan(fid);
    if (!plan) { if (!F.idleSince) F.idleSince = S.turn; } else F.idleSince = 0;   // months with nothing to attack: see aiDiplomacy
    const th = phase === 'unifying' ? 1.1 * (diff() === 'hard' ? 0.95 : diff() === 'easy' ? 1.1 : 1) : baseThreshold(fid) * (F.caution || 1) * (diff() === 'hard' ? 0.95 : diff() === 'easy' ? 1.1 : 1) * Math.min(1.3, 1 + 0.015 * overextension(fid));
    const provs = factionProvinces(fid);
    const bn = bottleneck(fid); F.bottleneck = bn;
    const reserve = reserveCity(fid);
    const aiTactics = (H, T, party) => { const bestInt = Math.max(...party.map((o) => o.int)); const ratio = attStrength(H.troops * 0.7, party, H) / Math.max(1, defStrength(T)); const stance = T.defense >= 350 && (partyHas(party, 'siege') || ratio < 1.6) ? 'siege' : ratio >= 1.8 ? 'assault' : bestInt >= 85 ? 'feint' : 'standard'; const m = battleModifiers(H.id, T.id); const lowLoy = T.owner && officersIn(T.id, T.owner).some((o) => !isRuler(o) && o.loyalty < 60); const stratagem = bestInt < 75 ? 'auto' : lowLoy && has(fid, 'schemer') ? 'discord' : m.type === 'river' && (H.fleet || 0) >= 40 ? 'flood' : !isWinter() && bestInt >= 80 ? 'fire' : 'auto'; return { stance, stratagem }; };

    // rewards for wavering officers, before they think of leaving
    for (const o of factionOfficers(fid)) { const p = prov(o.city); if (o.loyalty < 70 && p.owner === fid && p.gold >= 400) reward(p.id, o.name); }
    // recruit free officers
    for (const p of provs) for (const fo of freeOfficersIn(p.id)) { const idle = idleOfficers(p.id); if (!idle.length) break; recruitOfficer(p.id, idle.reduce((m, o) => (o.chr > m.chr ? o : m)).name, fo.name); }
    // emergency food
    for (const p of provs) { const fm = p.food / Math.max(1, p.troops * FOOD_UPKEEP); if (fm < 4 && p.gold > 1200) buyFood(p.id, Math.min(p.gold - 600, 2500)); }

    // 1. defence: evacuate hopeless towns, reinforce threatened ones
    const attacked = new Set();
    const linchpins = new Set(factionProvinces(fid).filter((p) => isLinchpin(fid, p.id)).map((p) => p.id));
    for (const p of factionProvinces(fid).sort((a, b) => (linchpins.has(b.id) ? 1 : 0) - (linchpins.has(a.id) ? 1 : 0) || forecastThreat(fid, b) - forecastThreat(fid, a))) {
      const threat = forecastThreat(fid, p); if (!threat) continue;
      const now = threatOn(fid, p);   // only an army already at the gates justifies abandoning a town
      const seat = rulerOf(fid).city;
      const friends = neighbors(p.id).filter((n) => n.owner === fid);
      const bridge = linchpins.has(p.id);   // the link between two halves of the realm is held to the last
      if (now > p.troops * (bridge ? 5 : 3) && p.id !== seat && friends.length && p.troops > 800) {
        const dest = friends.reduce((m, n) => (n.troops > m.troops ? n : m));
        const idle = idleOfficers(p.id);
        if (idle.length) transfer(p.id, dest.id, { troops: p.troops - 500, gold: Math.max(0, p.gold - 200), food: Math.max(0, p.food - 2000), officers: idle.map((o) => o.name) });
        continue;
      }
      if (threat > p.troops * (bridge ? 0.9 : 1.2)) {
        for (const d of friends) {
          if (forecastThreat(fid, d) > d.troops) continue;
          const spare = spareTroops(fid, d); const idle = idleOfficers(d.id).filter((o) => !isRuler(o));
          if (spare >= 2000 && idle.length && officersIn(d.id, fid).length >= 2) transfer(d.id, p.id, { troops: Math.floor(spare * 0.7), officers: [idle.reduce((m, o) => (o.war > m.war ? o : m)).name] });
        }
      }
    }

    // 2. the campaigns: stage toward the hammer, hold the cities beside the target ready to march, strike when ready.
    //    A great or divided realm runs a second campaign on another front.
    const runCampaign = (pl, main) => {
      if (!pl || prov(pl.hammer).owner !== fid) return;
      const H = prov(pl.hammer), T = prov(pl.target);
      const m = battleModifiers(H.id, T.id);
      const need = (defStrength(T) * m.def * th) / (m.att * (1 - m.loss));
      const party = aiParty(H.id);
      const keepHome = phase === 'unifying' ? 0.15 : neighbors(H.id).filter((n) => n.owner && hostile(n)).length > 1 ? 0.35 : 0.2;
      const send = Math.floor(H.troops * (1 - keepHome));
      const smallPrey = !T.owner || factionProvinces(T.owner).length <= 2 || T.owner === lastFoe(fid);
      const staging = S.adj[T.id].filter((c) => c !== H.id && prov(c).owner === fid);   // they answer the call for reinforcements when the siege opens
      const stagedHelp = staging.reduce((s, c) => s + spareTroops(fid, prov(c)) * 0.5, 0);
      const ready = party.length && send >= 3000 && attStrength(send + stagedHelp * 0.5, party, H) > need && H.food > send * 0.15 && !(phase === 'consolidating' && !smallPrey && S.turn - pl.since < 6);
      if (ready) { attack(H.id, T.id, party.map((o) => o.name), send, aiTactics(H, T, party)); attacked.add(H.id); return; }
      // gather: neighbours send spare troops and a strong commander; interior cities route troops one hop closer; staging cities keep theirs
      for (const d of factionProvinces(fid)) {
        if (d.id === H.id || staging.includes(d.id) || attacked.has(d.id)) continue;
        const idle = idleOfficers(d.id).filter((o) => !isRuler(o));
        if (!idle.length || officersIn(d.id, fid).length < (phase !== 'rising' && !isFront(fid, d) && d.order >= 60 ? 1 : 2)) continue;
        const hop = S.adj[d.id].includes(H.id) ? H.id : nextHop(fid, d.id, H.id);
        if (!hop) continue;
        let spare = isFront(fid, d) ? spareTroops(fid, d) : Math.max(0, d.troops - (phase === 'unifying' ? 1200 : 2500));
        if (reserve && d.id === reserve.id) spare = Math.floor(spare * 0.5);   // the reserve keeps half back
        if (buildupNear(fid, d) > d.troops * 0.8) continue;                   // a city that sees an army gathering against it keeps its men
        if (spare < 2000) continue;
        const escort = idle.reduce((mm, o) => (o.war > mm.war ? o : mm));
        const keepGov = governorOf(d); if (keepGov && keepGov.name === escort.name && idle.length < 2) continue;
        transfer(d.id, hop, { troops: Math.floor(spare * 0.8), gold: Math.floor(Math.max(0, d.gold - 1000) * 0.3), food: Math.floor(Math.max(0, d.food - d.troops * FOOD_UPKEEP * 6) * 0.5), officers: [escort.name] });
        if (!main) break;   // the second campaign draws on one city a month
      }
    };
    runCampaign(plan, true);
    const wantSecond = plan && (comps.count > 1 || provs.length >= 10) && phase !== 'consolidating';
    const plan2 = wantSecond ? makePlan(fid, plan) : null;
    if (plan2) runCampaign(plan2, false);
    // 3. opportunistic strikes elsewhere when very favourable
    for (const p of factionProvinces(fid)) {
      if (attacked.has(p.id)) continue;
      for (const t of neighbors(p.id).filter(hostile)) {
        if (S.battles && S.battles[t.id]) continue;
        const party = aiParty(p.id); if (!party.length) break;
        const m = battleModifiers(p.id, t.id); if (m.blocked) continue;
        const send = Math.floor(p.troops * (phase === 'unifying' ? 0.75 : 0.65));
        const bonus = t.owner && S.turn - (S.factions[t.owner].lastLoss || -99) <= 6 ? 0.85 : 1;
        const bar = F.raider ? 1 : phase === 'unifying' ? 0.9 : 1.2 * cohesionBar(cohesion(fid, t, comps));
        if (send >= 3000 && attStrength(send * (1 - m.loss), party, p) * m.att > defStrength(t) * m.def * th * bonus * bar && p.food > send * 0.15) { attack(p.id, t.id, party.map((o) => o.name), send, aiTactics(p, t, party)); attacked.add(p.id); break; }
      }
    }

    // 4. officers: keep the wavering away from the border; send POL to the interior, WAR to the front
    for (const p of factionProvinces(fid)) {
      const idle = idleOfficers(p.id).filter((o) => !isRuler(o));
      if (!idle.length || officersIn(p.id, fid).length < 2) continue;
      const friends = neighbors(p.id).filter((n) => n.owner === fid);
      if (!friends.length) continue;
      if (isFront(fid, p)) {
        const shaky = idle.find((o) => o.loyalty < 50);
        const interior = friends.find((n) => !isFront(fid, n));
        if (shaky && interior) transfer(p.id, interior.id, { officers: [shaky.name] });
      } else {
        const front = friends.filter((n) => isFront(fid, n) && officersIn(n.id, fid).length < 3).sort((a, b) => threatOn(fid, b) - threatOn(fid, a))[0];
        const general = idle.filter((o) => o.war >= 78).sort((a, b) => b.war - a.war)[0];
        if (front && general && idle.length >= 2) transfer(p.id, front.id, { officers: [general.name] });
      }
    }

    // 5. domestic work: phased build order, personality, and spending the hoard
    const year = S.year;
    for (const p of factionProvinces(fid)) {
      const front = isFront(fid, p); const threat = threatOn(fid, p); const menace = forecastThreat(fid, p);
      const tier = provData(p.id).tier; const tierCap = 8000 + tier * 4000;
      const passCity = S.adj[p.id].some((n) => roadType(p.id, n) === 'pass' && prov(n).owner !== fid);
      for (const o of idleOfficers(p.id)) {
        const foodMonths = p.food / Math.max(1, p.troops * FOOD_UPKEEP);
        const cap = Math.max(tierCap, sustainCap(p)) * (has(fid, 'reckless') ? 1.1 : 1);
        const wantTroops = p.troops < cap && (p.troops < menace * 1.1 || p.troops < tierCap || (front && p.gold > 2000) || p.gold > 4000);
        const needFleet = hasShipyard(p) && p.fleet < (p.gold > 4000 ? 80 : 60) && neighbors(p.id).some((n) => hostile(n) && ['river', 'sea'].includes(roadType(p.id, n.id)));
        const rich = p.gold > 4000;
        const builder = has(fid, 'builder');
        if (p.order < (phase === 'rising' ? 55 : 70) && p.gold >= COST.pacify) pacify(p.id, o.name);
        // the bottleneck first: whatever caps the house this month gets the officer's hand
        else if (bn === 'food' && p.gold >= COST.develop && p.agri < 999 && foodMonths < 12) develop(p.id, o.name, 'agri');
        else if (bn === 'food' && p.gold >= SITE_TYPES.village.cost + 300 && availableSites(p.id).some((x) => x.type === 'village' && x.ok)) buildSite(p.id, o.name, 'village');
        else if (bn === 'gold' && p.gold >= COST.develop && p.comm < 900) develop(p.id, o.name, 'comm');
        else if (bn === 'gold' && p.gold >= 800 && availableSites(p.id).some((x) => ['mine', 'salt', 'market', 'docks'].includes(x.type) && x.ok && x.cost <= p.gold - 200)) buildSite(p.id, o.name, availableSites(p.id).find((x) => ['mine', 'salt', 'market', 'docks'].includes(x.type) && x.ok && x.cost <= p.gold - 200).type);
        else if (bn === 'officers' && !freeOfficersIn(p.id).length) search(p.id, o.name);
        else if (bn === 'men' && p.gold >= COST.recruit && p.troops < sustainCap(p) && p.pop > 60000 && foodMonths > 6) recruitTroops(p.id, o.name);
        // walls where an army is gathering against the city
        else if (menace > p.troops * 0.8 && p.gold >= COST.fortify && p.defense < 800) fortify(p.id, o.name);
        else if (p.gold >= COST.resettle && p.order >= 40 && p.pop < popCapOf(p) * (p.gold > 6000 ? 0.6 : 0.4)) resettle(p.id, o.name);
        else if (p.gold >= COST.develop && (foodMonths < 8 || p.agri < 200) && p.agri < 999) develop(p.id, o.name, 'agri');
        else if (rich && foodMonths < 12) buyFood(p.id, 2000), search(p.id, o.name);
        else if (needFleet && p.gold >= COST.ships) buildShips(p.id, o.name);
        else if (p.gold >= COST.recruit && wantTroops && p.pop > 60000 && foodMonths > 6) recruitTroops(p.id, o.name);
        else if (year <= 194 && p.gold >= COST.develop && p.comm < 500) develop(p.id, o.name, 'comm');
        else if (p.gold >= COST.fortify && front && p.defense < (menace > p.troops * 0.5 ? (phase !== 'rising' ? 700 : passCity ? 600 : builder ? 550 : 450) : 350)) fortify(p.id, o.name);
        else if (p.gold >= COST.develop && p.comm < (builder ? 900 : 750)) develop(p.id, o.name, 'comm');
        else if (p.gold >= COST.develop && p.agri < 999 && (p.troops > p.agri * 40 || builder)) develop(p.id, o.name, 'agri');
        else if (p.gold >= 900 && sitesOf(p).some((x) => x.damaged)) repairSite(p.id, o.name, sitesOf(p).findIndex((x) => x.damaged));
        else if (p.gold >= (front ? 2500 : 1500) && availableSites(p.id).some((x) => x.ok && x.cost <= p.gold - 600)) buildSite(p.id, o.name, availableSites(p.id).find((x) => x.ok && x.cost <= p.gold - 600).type);
        else if (rich && p.gold >= COST.fortify && p.defense < 700) fortify(p.id, o.name);
        else if (rich && hasShipyard(p) && p.fleet < 90 && p.gold >= COST.ships) buildShips(p.id, o.name);
        else if (p.training < 85) train(p.id, o.name);
        else search(p.id, o.name);
      }
      // gifts from the hoard to a stronger, unfriendly neighbour
      if (p.gold > 6000) { const strong = neighbors(p.id).filter((n) => n.owner && n.owner !== fid && totalTroops(n.owner) > totalTroops(fid) && relation(fid, n.owner) < 0)[0]; if (strong) sendGift(fid, strong.owner, p.id, 400); }
    }
  }

  // ---------- persistence ----------
  // saves are namespaced by era so a threekingdoms save never shadows a samguk one
  const eraTag = () => ((typeof ERA !== 'undefined' && ERA.id) || 'threekingdoms');
  const slotKey = (slot) => (slot ? `rotk_save_${eraTag()}_${slot}` : `rotk_save_${eraTag()}`);
  function save(slot) { try { localStorage.setItem(slotKey(slot), JSON.stringify(S)); return true; } catch (e) { return false; } }
  function slotInfo(slot) { try { const raw = localStorage.getItem(slotKey(slot)); if (!raw) return null; const j = JSON.parse(raw); const F = j.factions && j.player ? j.factions[j.player] : null; return { label: `${F ? F.name : '방관자'} — ${j.year}년 ${j.month}월`, scenario: j.scenario }; } catch (e) { return null; } }
  function load(slot) {
    let raw = null;
    try { raw = localStorage.getItem(slotKey(slot)); } catch (e) { return false; }
    if (!raw) return false;
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch (e) { return false; }
    // saves from an older map (different city set) cannot be loaded
    if (!parsed.provinces || Object.keys(parsed.provinces).length !== PROVINCES.length || PROVINCES.some((p) => !parsed.provinces[p.id])) return false;
    S = parsed;
    // older saves: backfill fields added later
    S.diplomacy = S.diplomacy || {}; S.pendingProposals = S.pendingProposals || []; S.pendingSuccession = S.pendingSuccession || null; S.favors = S.favors || {}; S.pendingAid = S.pendingAid || []; S.battles = S.battles || {}; S.garrisonLog = S.garrisonLog || {};
    S.options = S.options || { historicalDeaths: true };
    S.adj = buildAdj();
    for (const f of Object.values(S.factions)) { const d = FACTIONS.find((x) => x.id === f.id); if (f.raider == null) f.raider = !!(d && d.raider); if (f.wanderer == null) f.wanderer = !!(d && d.wanderer); if (f.prestige == null) f.prestige = 0; if (f.guest == null) { f.guest = false; f.host = null; f.guestSince = 0; } if (f.hasEmperor == null) f.hasEmperor = false; if (f.favor == null) f.favor = f.guest ? 50 : 0; if (!f.household) f.household = { troops: 0, gold: 0 }; if (f.petitionUntil == null) f.petitionUntil = 0; const dd = FACTIONS.find((x) => x.id === f.id); if (!f.persona) f.persona = (dd && dd.persona) || []; if (f.treachery == null) f.treachery = 0; if (f.lastLoss == null) f.lastLoss = -99; if (f.lastAttackTurn == null) f.lastAttackTurn = -99; if (f.caution == null) f.caution = 1; if (!f.phase) f.phase = 'rising'; if (!f.attackedBy) f.attackedBy = {}; if (!f.gains) f.gains = []; }
    if (!S.items) { S.items = {}; for (const it of ITEMS) S.items[it.id] = { id: it.id, owner: null, city: it.city || null }; }
    S.arrived = S.arrived || {}; S.history = S.history || []; S.stats = S.stats || { battles: 0, captures: 0, deaths: 0 };
    snapshotMonth();
    S.eventsFired = S.eventsFired || {}; S.objectivesDone = S.objectivesDone || {}; S.pendingDecisions = S.pendingDecisions || []; S.battles = S.battles || {};
    for (const p of Object.values(S.provinces)) { const d = provData(p.id); p.traits = d.traits || []; if (p.fleet == null) p.fleet = 0; if (p.order == null) p.order = p.owner ? 70 : 45; if (!p.posture) p.posture = 'hold'; if (!p.sites) p.sites = []; }
    for (const o of allOfficers()) { if (!o.skills) o.skills = OFFICER_SKILLS[o.name] || []; if (o.rank == null) o.rank = 0; }
    for (const f of Object.values(S.factions)) if (f.title == null) f.title = 0;
    if (S.pendingTitle === undefined) S.pendingTitle = null; if (!S.options.difficulty) S.options.difficulty = 'normal';
    for (const o of allOfficers()) if (o.born == null) { const row = OFFICERS.find((r) => r[0] === o.name); o.born = row ? row[9] : S.year - 35; }
    return true;
  }
  function hasSave(slot) { try { return !!localStorage.getItem(slotKey(slot)); } catch (e) { return false; } }

  return {
    newGame, state, prov, off, fac, pname, fname, dateStr, season, fmt,
    officersIn, freeOfficersIn, idleOfficers, captivesIn, factionOfficers, factionProvinces, rulerOf, isRuler, neighbors, enemyNeighbors, totalTroops,
    develop, fortify, train, recruitTroops, search, recruitOfficer, recruitChance, reward, buyFood, transfer, attack,
    resolveCaptive, captiveChance, endTurn, aiTurn, save, load, hasSave, COST, log,
    relation, relationWord, treatyStatus, canAttack, allies, bordering, acceptChance, proposeTreaty, respondProposal, sendGift, breakTreaty, requestJointAttack, DIP_COST, CEASEFIRE_MONTHS, ALLIANCE_MONTHS,
    age, heirCandidates, chooseHeir,
    roadInfo, roadType, battleModifiers, buildShips, hasShipyard, hasTrait,
    decide, objectiveStatus, destinyTargets,
    itemsOf, hiddenItemsIn, itemData, bestow, ITEMS, governorOf, leaderHouse, houseItems, giftItem, itemValue,
    SCENARIOS, undoMonth, canUndo, slotInfo, BIOS, CITY_NOTES, detectPhase,
    pacify, resettle, setPosture, battleFor, playerBattles, playerSideOf, battleRequests, battleMessengers, reinforceBattle, battleBeginDay, battleEndDay, battleAutoMonth, battleMove, battleAttack, battleRam, battleWithdraw, tacticalOn, battleAnswerChallenge, battleSuborn, battleSubornTargets, battleGold, favorsOwed, declineAid, ransomPrice, availableSites, buildSite, repairSite, battleSack, siteName, buildCost, battleFire, battleNight, battleSally, appoint, assumeTitle, eligibleTitle, titleOf, plot, plotTargets, hasSkill, bondGroup, bonded, areEnemies, areRivals, bondedRuler, RANKS, RANK_COST, TITLES, SKILL_INFO,
    hostSeat, exileServe, exilePetition, petitionChance, exileRecruit, exileRaise, exileFight, exileSeekPatron, exileTargets, exileSeize,
    era: () => (typeof ERA !== 'undefined' ? ERA : { id: 'unknown', title: document.title, rules: {} }),
    getOption: (k) => !!(S && S.options && S.options[k]),
    setOption: (k, v) => { if (S) { S.options = S.options || {}; S.options[k] = !!v; log(`${k === 'historicalDeaths' ? '역사 속 죽음' : k}을(를) ${v ? '따르기로 하였소' : '따르지 않기로 하였소'}.`, 'sys'); } },
    HISTORICAL_DEATHS,
  };
})();
