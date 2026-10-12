// ============================================================
//  UI layer: start screen, map, panels, dialogs
// ============================================================

const UI = (() => {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"'`]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c]));
  const fmt = Game.fmt;
  const FREE_COLOR = '#6b6b52';
  const ITEM_ICON = { weapon: '⚔', horse: '🐎', book: '📜', seal: '🜲', armor: '🛡' };
  const itemBadge = (o) => Game.itemsOf(o.name).map((it) => `<span class="item-badge" title="${esc(it.name)}: ${esc(it.desc)}">${ITEM_ICON[it.type] || '✦'}</span>`).join('');
  const SKILL_ABBR = { cavalry: '기병', naval: '수군', siege: '공성', stratagem: '계략', guardian: '수성', admin: '내정', orator: '변설' };
  const skillTags = (o) => (o.skills || []).map((s) => `<span class="skill-tag" title="${esc(SKILL_INFO[s].label)}: ${esc(SKILL_INFO[s].desc)}">${SKILL_ABBR[s] || s}</span>`).join('');
  const rankTag = (o) => (o.rank ? `<span class="rank-tag" title="관등: ${esc(Game.RANKS[o.rank])}">${Game.RANKS[o.rank][0]}</span> ` : '');
  const tieNote = (o) => { const g = Game.bondGroup(o.name); const parts = []; if (g) parts.push('의형제·혈족: ' + g.filter((n) => n !== o.name).join(', ')); return parts.length ? `<span class="hint" title="${esc(parts.join('; '))}"> ⛓</span>` : ''; };
  // Officer avatar: a portrait image if the era ships one, else a faction-coloured initial.
  const portraitDir = () => { const E = Game.era(); return (E && E.assets && E.assets.portraits) || ''; };
  const avatar = (o) => {
    const color = o.faction ? Game.fac(o.faction).color : FREE_COLOR;
    const dir = portraitDir();
    const src = dir ? `${dir}${encodeURIComponent(o.name)}.png` : '';
    return `<span class="avatar" style="--ac:${color}">${src ? `<img src="${esc(src)}" alt="" loading="lazy" onerror="this.style.display='none'">` : ''}<span class="ini">${esc((o.name || '?').slice(0, 1))}</span></span>`;
  };
  // One-time coaching banner for new players (dismissed into localStorage).
  const coachBanner = () => {
    try { if (localStorage.getItem('rotk_coach') === '0') return ''; } catch (e) { /* ignore */ }
    return `<div class="coach"><b>처음이신가요?</b><ol><li>장수를 골라 <b>농업·상업</b>으로 도시를 키우고</li><li><b>징병</b>으로 병력을 모은 뒤</li><li>적 도시 옆에서 <b>⚔ 공격</b>, 끝나면 <b>월 넘기기 ▶</b></li></ol><button class="btn-sm" onclick="try{localStorage.setItem('rotk_coach','0')}catch(e){};this.parentNode.remove()">알겠어요</button></div>`;
  };

  let selected = null;
  let modalHandlers = {};
  let modalLocked = false;

  // ---------- boot ----------
  let scenarioId = '190';
  let far = false;          // semantic zoom: at the widest views city boxes show only their name
  let seenEntry = null;     // newest chronicle entry the player has seen (for the ticker's unread count)
  let showLegend = false;
  try { showLegend = localStorage.getItem('rotk_legend') === '1'; } catch (e) { /* ignore */ }

  function openDrawer() { $('#side').classList.add('open'); }
  function closeDrawer() { $('#side').classList.remove('open'); }
  function setLegend(on) { showLegend = on; $('#legend').hidden = !on; $('#toggle-legend').classList.toggle('on', on); try { localStorage.setItem('rotk_legend', on ? '1' : '0'); } catch (e) { /* ignore */ } }
  function toggleChronicle(open) { const c = $('#chronicle'); c.hidden = open === undefined ? !c.hidden : !open; if (!c.hidden) seenEntry = Game.state().log[0] || null; renderLog(); }
  function toggleCinema() { document.body.classList.toggle('cinema'); }
  function toggleMore(open) { const m = $('#more-menu'); m.hidden = open === undefined ? !m.hidden : !open; }

  function init() {
    // the era names the page and the title screen
    const E = Game.era();
    if (E && E.title) {
      document.title = E.title;
      const t = $('.title'); if (t) t.innerHTML = `${esc(E.sigil || '')}<span>${esc(E.title)}</span>`;
    }
    const sel = $('#scenario-select');
    // era picker: ERAS/ERA_ID come from js/eras.js (absent in headless tests)
    try {
      const eraSel = $('#era-select');
      const eras = (typeof ERAS !== 'undefined') ? ERAS : null;
      const eraId = (typeof ERA_ID !== 'undefined') ? ERA_ID : ((Game.era() && Game.era().id) || null);
      if (eraSel && eras && eras.length > 1) {
        eraSel.innerHTML = eras.map((e) => `<option value="${esc(e.id)}">${esc(e.title)}${e.years ? ` (${esc(e.years)})` : ''}</option>`).join('');
        if (eraId) eraSel.value = eraId;
        eraSel.addEventListener('change', () => {
          try { localStorage.setItem('rotk_era', eraSel.value); } catch (e) { /* ignore */ }
          const u = new URL(location.href);
          u.searchParams.set('era', eraSel.value);
          location.href = u.toString();
        });
      } else if (eraSel) {
        eraSel.closest('.scenario-pick').hidden = true;
      }
    } catch (e) { /* a picker that cannot be built is simply hidden */ }
    sel.innerHTML = SCENARIOS.map((sc) => `<option value="${sc.id}">${sc.year}년 — ${esc(sc.title)}</option>`).join('');
    const scKey = `rotk_scenario_${(Game.era() && Game.era().id) || 'threekingdoms'}`;
    try { const saved = localStorage.getItem(scKey); if (saved && SCENARIOS.some((sc) => sc.id === saved)) { sel.value = saved; scenarioId = saved; } } catch (e) { /* ignore */ }
    // the default scenarioId may belong to another era (e.g. threekingdoms' '190'); fall back to this era's base scenario
    if (!SCENARIOS.some((sc) => sc.id === scenarioId)) { scenarioId = (SCENARIOS.find((sc) => sc.base) || SCENARIOS[0]).id; sel.value = scenarioId; }
    const applyScenarioText = () => { const sc = SCENARIOS.find((x) => x.id === scenarioId); $('#scenario-title').textContent = sc.title; $('#scenario-intro').textContent = sc.intro; renderStart(); };
    sel.addEventListener('change', () => { scenarioId = sel.value; try { localStorage.setItem(scKey, scenarioId); } catch (e) { /* ignore */ } applyScenarioText(); });
    applyScenarioText();
    $('#btn-continue').hidden = !Game.hasSave();
    $('#btn-continue').addEventListener('click', () => { if (Game.load()) { selected = null; showGame(); } else { alert('저장본이 예전 지도의 것이라 불러올 수 없습니다.'); $('#btn-continue').hidden = true; } });
    $('#btn-endturn').addEventListener('click', endTurn);
    $('#btn-overview').addEventListener('click', showOverview);
    $('#btn-officers').addEventListener('click', showOfficers);
    $('#btn-save').addEventListener('click', () => { Game.save(); Game.log('게임을 저장했습니다.', 'sys'); renderLog(); toast('게임을 저장했습니다.'); });
    $('#btn-menu').addEventListener('click', () => { stopAuto(); showMenu(); });
    $('#btn-diplomacy').addEventListener('click', showDiplomacy);
    $('#btn-objectives').addEventListener('click', showObjectives);
    $('#btn-stats').addEventListener('click', showStats);
    $('#btn-wiki').addEventListener('click', () => showWiki());
    $('#btn-help').addEventListener('click', showHelp);
    document.addEventListener('keydown', (e) => {
      if (document.getElementById('game-screen').hidden) return;
      if (e.target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
      const modalOpen = !$('#modal').hidden;
      const k = e.key;
      if (k === '?' || (k === '/' && e.shiftKey)) { e.preventDefault(); if (!modalOpen) showHelp(); return; }
      if (modalOpen) return;
      if (k === ' ' || k === 'Enter') { e.preventDefault(); endTurn(); }
      else if (k === 'o' || k === 'O') showObjectives();
      else if (k === 'd' || k === 'D') showDiplomacy();
      else if (k === 'r' || k === 'R') showOverview();
      else if (k === 'f' || k === 'F') showOfficers();
      else if (k === 's' || k === 'S') showStats();
      else if (k === 'l' || k === 'L') showWiki();
      else if (k === 'm' || k === 'M') showMenu();
      else if (k === 'h' || k === 'H') toggleCinema();
      else if (k === '+' || k === '=') zoomAt(1.3, VB.x + VB.w / 2, VB.y + VB.h / 2);
      else if (k === '-' || k === '_') zoomAt(1 / 1.3, VB.x + VB.w / 2, VB.y + VB.h / 2);
      else if (k === 'Home' || k === '0') resetView();
      else if (k.startsWith('Arrow')) { const step = VB.w * 0.08; if (k === 'ArrowLeft') VB.x -= step; if (k === 'ArrowRight') VB.x += step; if (k === 'ArrowUp') VB.y -= step; if (k === 'ArrowDown') VB.y += step; clampView(); applyViewBox(); e.preventDefault(); }
      else if (k === 'Tab') { e.preventDefault(); cycleIdle(); }
    });
    $('#btn-auto').addEventListener('click', toggleAuto);
    initAutoSpeed(); initWatchMode();
    // map-first chrome: the more-menu, the drawer, the chronicle ticker, the legend and the cinematic toggle
    $('#btn-more').addEventListener('click', (e) => { e.stopPropagation(); toggleMore(); });
    $('#more-menu').addEventListener('click', () => toggleMore(false));
    document.addEventListener('click', (e) => { if (!e.target.closest('.tb-actions')) toggleMore(false); });
    $('#btn-legend').addEventListener('click', () => setLegend(!showLegend));
    $('#btn-hexmaps').addEventListener('click', () => { Game.save(); window.open('hexmaps.html' + (selected ? '#' + selected : ''), '_blank'); });
    $('#toggle-legend').addEventListener('click', () => setLegend(!showLegend));
    $('#btn-cinema').addEventListener('click', toggleCinema);
    $('#cinema-exit').addEventListener('click', toggleCinema);
    $('#drawer-close').addEventListener('click', closeDrawer);
    $('#drawer-handle').addEventListener('click', openDrawer);
    $('#ticker').addEventListener('click', () => toggleChronicle());
    $('#chron-close').addEventListener('click', () => toggleChronicle(false));
    $('#tb-badges').addEventListener('click', (e) => { const b = e.target.closest('.badge.act'); if (b && b.dataset.act === 'idle') cycleIdle(); if (b && b.dataset.act === 'battle') { const pb = Game.playerBattles()[0]; if (pb) openBattle(pb.city); } });
    initBattleScreen();
    window.addEventListener('resize', () => { if ($('#game-screen').hidden) return; const r = $('#map').getBoundingClientRect(); if (!r.width || !r.height) return; VB.h = VB.w / (r.width / r.height); clampView(); applyViewBox(); });
    $('#btn-observe').addEventListener('click', () => startGame(null));
    initMapControls();
    initTooltip();
    $('#map').addEventListener('click', (e) => {
      if (suppressClick) { suppressClick = false; return; }
      const g = e.target.closest('.prov');
      if (!g) return;
      selected = g.dataset.id;
      renderMap(); renderPanel(); openDrawer();
    });
    $('#modal-box').addEventListener('click', (e) => {
      const el = e.target.closest('[data-act]');
      if (el && modalHandlers[el.dataset.act]) { modalHandlers[el.dataset.act](el, e); return; }
      const bio = e.target.closest('.bio-link'); if (bio) { showWiki(bio.dataset.bio); return; }
      const li = e.target.closest('.pick li');
      if (li) togglePick(li);
    });
    $('#modal-box').addEventListener('input', (e) => { if (modalHandlers.oninput) modalHandlers.oninput(e); });
    $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal' && !modalLocked) closeModal(); });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (!$('#modal').hidden) { if (!modalLocked) closeModal(); return; }
      if (!$('#more-menu').hidden) { toggleMore(false); return; }
      if (!$('#chronicle').hidden) { toggleChronicle(false); return; }
      if (document.body.classList.contains('cinema')) { toggleCinema(); return; }
      if ($('#side').classList.contains('open')) closeDrawer();
    });
  }

  function cycleIdle() {
    const S = Game.state(); if (S.observer) return;
    const mine = Game.factionProvinces(S.player).filter((p) => Game.idleOfficers(p.id).length); if (!mine.length) return;
    const i = mine.findIndex((p) => p.id === selected); selected = mine[(i + 1) % mine.length].id;
    renderMap(); renderPanel(); openDrawer();
  }

  function factionStrength(f) {
    const cities = f.cities.reduce((s, c) => s + PROVINCES.find((p) => p.id === c).tier * 8, 0);
    const officers = OFFICERS.filter((o) => o[6] === f.id).reduce((s, o) => s + (o[1] + o[2] + o[3] + o[4] + o[5]) / 50, 0);
    return cities + officers;
  }

  function renderStart() {
    const sc = SCENARIOS.find((x) => x.id === scenarioId);
    const list = sc.base ? FACTIONS : Object.entries(sc.houses).filter(([id, h]) => !h.dead && (h.cities && h.cities.length || h.guestOf)).map(([id, h]) => { const base = FACTIONS.find((f) => f.id === id); return { id, name: h.name || (base ? base.name : id), color: h.color || (base ? base.color : '#888'), cities: (h.cities || []).map((c) => c.replace('?', '')), blurb: h.blurb || (base ? base.blurb : '이 시대의 한 가문.'), playable: h.playable != null ? h.playable : (base ? base.playable : true), guestOf: h.guestOf, officers: (h.officers || []).length }; });
    const strength = (f) => (sc.base ? factionStrength(f) : f.cities.length * 10 + f.officers * 2);
    const ranked = [...list].sort((a, b) => strength(b) - strength(a));
    const grid = $('#faction-grid');
    grid.innerHTML = list.map((f) => {
      const rank = ranked.indexOf(f);
      const stars = 1 + Math.floor((rank / list.length) * 5);
      const n = sc.base ? OFFICERS.filter((o) => o[6] === f.id).length : f.officers;
      const cities = f.cities.length ? f.cities.map((c) => (PROVINCES.find((p) => p.id === c) || { name: c }).name).join(', ') : (f.guestOf ? `${esc((sc.houses && sc.houses[f.guestOf] && sc.houses[f.guestOf].name) || (FACTIONS.find((x) => x.id === f.guestOf) || {}).name || f.guestOf)}에 의탁 중` : '도시 없음');
      return `<div class="fcard${f.playable === false ? ' fcard-npc' : ''}" style="--fc:${f.color}" data-fid="${f.id}">
        <span class="fstars" title="${f.playable === false ? '플레이 불가' : '난이도'}">${f.playable === false ? 'AI 전용' : '★'.repeat(stars) + '☆'.repeat(5 - stars)}</span>
        <h3>${esc(f.name)}</h3>
        <div class="fmeta">${esc(cities)} · 장수 ${n}명</div>
        <div class="fblurb">${esc(f.blurb)}</div>
      </div>`;
    }).join('');
    grid.querySelectorAll('.fcard:not(.fcard-npc)').forEach((c) => c.addEventListener('click', () => startGame(c.dataset.fid)));
  }

  function startGame(fid) {
    Game.newGame(fid, { historicalDeaths: $('#opt-hist-deaths').checked, difficulty: $('#opt-difficulty').value, scenario: scenarioId });
    if (!fid) {
      selected = null;
      showGame();
      // (observer)
      openModal(`<h3>관전 모드</h3>
        <p>모든 세력을 AI가 운영합니다. <b>다음 달</b>로 한 달씩 넘기거나 <b>자동</b>을 눌러 시대가 스스로 흘러가게 두세요. 아무 도시나 눌러 살펴보고, <b>영토</b>·<b>장수</b>·<b>외교</b>로 세력 균형을 지켜보세요.</p>
        <div class="modal-actions"><button class="btn btn-gold" data-act="close">관전</button></div>`, { close: closeModal });
      return;
    }
    const f = FACTIONS.find((x) => x.id === fid) || { name: Game.fname(fid), blurb: 'A house of this age.' };
    const home = Game.factionProvinces(fid)[0];
    selected = home ? home.id : null;
    showGame();
    openModal(`<h3>${esc(Game.fname(fid))}</h3>
      <p>${esc(f.blurb)}</p>
      <p><b>플레이 방법.</b> 매달 도시의 각 장수는 명령 하나를 수행합니다: 땅을 개발(농업·상업)하거나, 병사를 징집·훈련하거나, 금을 탐색하거나, 재야 인재를 등용하거나, 인접 도시로 출병합니다. 금은 상업에서, 식량은 농업에서 나옵니다. 병사는 매달 식량을 먹고, 굶주린 병사는 도망칩니다.</p>
      <p>전투는 병력 수, 장수의 <b>무력</b>·<b>통솔</b>, 훈련도, 성벽으로 결정됩니다. <b>지력</b>이 높은 장수는 계략을 펼칩니다. 장수 간 일기토는 사기를 크게 좌우합니다.</p>
      <p><b>외교</b>로 사신을 보내세요: 정전은 ${Game.CEASEFIRE_MONTHS}개월의 평화를, 동맹은 두 세력을 ${Game.ALLIANCE_MONTHS / 12}년간 묶으며(마지막 해에 갱신 가능) 동맹에게 참전을 요청할 수 있습니다. 선물은 관계를 좋게 합니다. 조약을 깨면 모든 세력에게 이름이 더럽혀집니다.</p>
      <p>장수는 나이 들고 성장하며 죽습니다. ${Game.getOption('historicalDeaths') ? '역사적 사망이 <b>켜짐</b>: 전쟁이 먼저 앗아가지 않는 한 명사들은 역사대로 수명을 다합니다.' : '역사적 사망이 <b>꺼짐</b>: 운명은 우연에 맡겨집니다.'} 군주가 죽으면 후계자가 자리를 잇습니다.</p>
      <p>포상으로 장수의 충성을 지키고, 적장을 사로잡아 회유하며, 천하 ${Object.keys(Game.state().provinces).length}개 도시를 모두 통일하세요.</p>
      <div class="modal-actions"><button class="btn btn-gold" data-act="close">시작</button></div>`, { close: closeModal });
  }

  function showGame() {
    $('#start-screen').hidden = true;
    $('#game-screen').hidden = false;
    ensureMapBase();
    document.body.classList.remove('cinema');
    $('#chronicle').hidden = true; toggleMore(false);
    seenEntry = Game.state().log[0] || null;
    setLegend(showLegend);
    resetView();
    renderAll();
    openDrawer();
  }

  function backToMenu() {
    stopAuto(); document.body.classList.remove('cinema');
    $('#game-screen').hidden = true;
    $('#start-screen').hidden = false;
    $('#btn-continue').hidden = !Game.hasSave();
  }

  // ---------- rendering ----------
  function renderAll() { renderTop(); renderMap(); renderPanel(); renderLog(); }

  function renderTop() {
    const S = Game.state();
    if (S.observer && !S.watchSynced) { S.watchSynced = true; syncWatchOption(); }
    $('#tb-date').textContent = `${Game.dateStr()} · ${Game.season()}`;
    $('#auto-ctl').hidden = !S.observer;
    $('#btn-endturn').textContent = S.observer ? '다음 달 ▶' : '월 넘기기 ▶';
    if (S.observer) {
      const alive = Object.values(S.factions).filter((f) => f.alive);
      const all = Object.values(S.provinces);
      $('#tb-faction').innerHTML = `👁 관전`;
      $('#tb-stats').innerHTML = [
        ['병력', fmt(all.reduce((s, p) => s + p.troops, 0))],
        ['장수', Object.values(S.officers).filter((o) => o.faction && !o.captive).length],
        ['조약', Object.entries(S.diplomacy).filter(([k, d]) => d.status !== 'neutral' && k.split('|').every((f) => S.factions[f].alive)).length],
      ].map(([k, v]) => `<div class="stat" title="${k}"><b data-k="${k.slice(0, 5)}">${v}</b><span>${k}</span></div>`).join('');
      $('#tb-badges').innerHTML = '';
      return;
    }
    const f = Game.fac(S.player);
    $('#tb-faction').innerHTML = `<span class="chip" style="background:${f.color}"></span>${esc(f.name)}${f.title ? ` <small class="persona" title="당신의 칭호; 사신·등용에 정통성을 더하고 장수 ${Game.titleOf(S.player).slots}명을 둘 수 있습니다">${esc(Game.titleOf(S.player).name)}</small>` : ''}${f.hasEmperor ? ' <span title="정통(正統)이 당신에게 있습니다">👑</span>' : ''}${f.guest ? ` <span class="observer-badge" title="망명 중">${esc(Game.fname(f.host))}의 식객</span>` : ''}`;
    const provs = Game.factionProvinces(S.player);
    const sum = (k) => provs.reduce((s, p) => s + p[k], 0);
    const idle = provs.reduce((s, p) => s + Game.idleOfficers(p.id).length, 0);
    $('#tb-stats').innerHTML = [
      ['도시', provs.length], ['병력', fmt(sum('troops'))], ['금', fmt(sum('gold'))], ['식량', fmt(sum('food'))],
      ['장수', Game.factionOfficers(S.player).length], ['대기', f.guest ? Game.factionOfficers(S.player).filter((o) => !o.acted).length : idle], ['위세', f.prestige || 0],
      ...(f.guest ? [['신세', f.favor], ['사병', fmt(f.household.troops)]] : []),
    ].map(([k, v]) => `<div class="stat" title="${k}"><b data-k="${k.slice(0, 5)}">${v}</b><span>${k}</span></div>`).join('');
    // things waiting on the player, always visible
    const idleN = f.guest ? Game.factionOfficers(S.player).filter((o) => !o.acted).length : idle;
    const caps = S.pendingCaptives.filter((c) => c.captor === S.player).length;
    const props = (S.pendingProposals || []).length;
    const pbs = Game.playerBattles();
    $('#tb-badges').innerHTML = [
      pbs.length ? `<span class="badge warn act" data-act="battle" title="명령을 기다리는 전투">⚔ 전투 ${pbs.length}</span>` : '',
      idleN ? `<span class="badge act" data-act="idle" title="이달에 행동하지 않은 장수. 클릭하거나 Tab으로 해당 도시를 순회합니다.">⚑ 대기 ${idleN}</span>` : '',
      caps ? `<span class="badge warn" title="월말에 처분을 기다리는 포로">⛓ 포로 ${caps}</span>` : '',
      props ? `<span class="badge" title="궁정에서 기다리는 사신. 월말에 접견합니다.">✉ 사신 ${props}</span>` : '',
    ].join('');
  }

  function isDark(hex) {
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return (0.299 * r + 0.587 * g + 0.114 * b) > 150;
  }

  // ---------- map: static terrain + dynamic layer, pan & zoom ----------
  const VB = { x: 0, y: 0, w: TERRAIN.W, h: TERRAIN.H };
  let suppressClick = false;

  function ensureMapBase() {
    const svg = $('#map');
    if (!svg.querySelector('#terrain')) {
      svg.innerHTML = `<g id="terrain">${TERRAIN.svg()}</g><g id="dyn"></g>`;
      applyViewBox();
    }
  }

  function renderMap() {
    ensureMapBase();
    const S = Game.state();
    const pos = Object.fromEntries(PROVINCES.map((p) => [p.id, p]));
    let roads = '', glyphs = '';
    const GLYPH = { pass: '▲', river: '≋', sea: '≋' };
    const ls = labelScale();
    for (const [a, b, type, via] of ROADS) {
      const hl = selected && (a === selected || b === selected);
      const mods = Game.battleModifiers(a, b);
      let mid = via && via.length ? via[Math.floor((via.length - 1) / 2)] : null;
      if (!mid) {   // bow the road a little to one side (the same side every render)
        const dx = pos[b].x - pos[a].x, dy = pos[b].y - pos[a].y, len = Math.hypot(dx, dy) || 1;
        const side = (a + b).length % 2 ? 1 : -1;
        mid = [Math.round((pos[a].x + pos[b].x) / 2 - dy / len * len * 0.07 * side), Math.round((pos[a].y + pos[b].y) / 2 + dx / len * len * 0.07 * side)];
      }
      const points = [[pos[a].x, pos[a].y], ...(via && via.length ? via : [mid]), [pos[b].x, pos[b].y]];
      roads += `<path class="road road-${type}${hl ? ' hl' : ''}${mods.blocked ? ' closed' : ''}" d="${TERRAIN.smoothPath(points)}"/>`;
      if (type !== 'plain') {
        glyphs += `<g class="glyph" data-x="${mid[0]}" data-y="${mid[1]}" transform="translate(${mid[0]},${mid[1]}) scale(${ls})"><text class="road-glyph g-${type}${mods.blocked ? ' closed' : ''}" y="4" text-anchor="middle">${mods.blocked ? '❄' : GLYPH[type]}</text></g>`;
      }
    }
    roads += glyphs;
    renderTerritory();
    const selOwner = selected ? Game.prov(selected).owner : null;
    let nodes = '';
    for (const P of PROVINCES) {
      const p = S.provinces[P.id];
      const color = p.owner ? Game.fac(p.owner).color : FREE_COLOR;
      const cls = ['prov'];
      if (P.id === selected) cls.push('selected');
      if (!S.observer && selected && selOwner === S.player && S.adj[selected].includes(P.id) && p.owner !== S.player && Game.canAttack(S.player, p.owner)) cls.push('target');
      if (isDark(color)) cls.push('dark');
      const officers = p.owner ? Game.officersIn(P.id, p.owner).length : 0;
      const hasRuler = p.owner && Game.rulerOf(p.owner).city === P.id;
      nodes += far
        ? `<g class="${cls.join(' ')}" data-id="${P.id}" data-x="${P.x}" data-y="${P.y}" transform="translate(${P.x},${P.y}) scale(${ls})">
        <rect x="-46" y="-13" width="92" height="26" rx="5" fill="${color}"/>
        <text class="pn" text-anchor="middle" y="5">${S.battles && S.battles[P.id] ? '⚔ ' : ''}${hasRuler ? '★ ' : ''}${esc(P.name)}</text>
      </g>`
        : `<g class="${cls.join(' ')}" data-id="${P.id}" data-x="${P.x}" data-y="${P.y}" transform="translate(${P.x},${P.y}) scale(${ls})">
        <rect x="-48" y="-21" width="96" height="42" rx="6" fill="${color}"/>
        <text class="pn" text-anchor="middle" y="-4">${S.battles && S.battles[P.id] ? '<tspan class="battle-mark">⚔</tspan> ' : ''}${hasRuler ? '★ ' : ''}${esc(P.name)}</text>
        <text class="pt" text-anchor="middle" y="12">⚔ ${fmt(p.troops)}${officers ? `  ☗ ${officers}` : ''}</text>
      </g>`;
    }
    $('#dyn').innerHTML = roads + nodes;
    renderLegend();
  }

  // Territory shading: a coarse grid of land cells, each tinted by the nearest city's owner.
  let TERR_CELLS = null;
  const CELL = 22, REACH = 150;
  function territoryCells() {
    if (TERR_CELLS) return TERR_CELLS;
    TERR_CELLS = [];
    for (let y = 0; y < TERRAIN.H; y += CELL) for (let x = 0; x < TERRAIN.W; x += CELL) {
      const cx = x + CELL / 2, cy = y + CELL / 2;
      if (TERRAIN.isSea(cx, cy)) continue;
      let best = null, bd = REACH * REACH;
      for (const P of PROVINCES) { const d = (P.x - cx) ** 2 + (P.y - cy) ** 2; if (d < bd) { bd = d; best = P.id; } }
      if (best) TERR_CELLS.push({ x, y, city: best });
    }
    return TERR_CELLS;
  }
  let showTerritory = false;
  try { showTerritory = localStorage.getItem('rotk_territory') === '1'; } catch (e) { /* storage unavailable */ }
  function setTerritory(on) {
    showTerritory = !!on;
    try { localStorage.setItem('rotk_territory', on ? '1' : '0'); } catch (e) { /* ignore */ }
    const b = $('#toggle-territory');
    if (b) { b.classList.toggle('on', showTerritory); b.title = `세력권 음영 (${showTerritory ? '켬' : '끔'})`; }
    renderTerritory();
  }
  function renderTerritory() {
    const S = Game.state();
    const slot = $('#territory-slot'); if (!slot) return;
    if (!showTerritory) { slot.innerHTML = ''; return; }
    const paths = {};
    for (const c of territoryCells()) {
      const owner = S.provinces[c.city].owner; if (!owner) continue;
      paths[owner] = (paths[owner] || '') + `M${c.x},${c.y}h${CELL}v${CELL}h-${CELL}z`;
    }
    slot.innerHTML = `<g clip-path="url(#landClip)"><g filter="url(#soft)">${Object.entries(paths).map(([f, d]) => `<path d="${d}" fill="${Game.fac(f).color}" class="terr"/>`).join('')}</g></g>`;
  }

  function renderLegend() {
    const S = Game.state();
    $('#legend').innerHTML = Object.values(S.factions).filter((f) => f.alive)
      .map((f) => `<span class="lg"><i style="background:${f.color}"></i>${esc(f.name)}</span>`).join('') +
      `<span class="lg"><i style="background:${FREE_COLOR}"></i>미점령</span>`;
  }

  // ---------- hover tooltip ----------
  function tooltipHtml(pid) {
    const S = Game.state();
    const p = Game.prov(pid), P = PROVINCES.find((x) => x.id === pid);
    const offs = p.owner ? Game.officersIn(pid, p.owner) : [];
    const color = p.owner ? Game.fac(p.owner).color : FREE_COLOR;
    let html = `<div class="tt-head"><span class="chip" style="background:${color}"></span><b>${esc(P.name)}</b><span class="tt-owner">${esc(Game.fname(p.owner))}</span></div>
      <div class="tt-row">⚔ 병력 ${fmt(p.troops)} · 성벽 ${p.defense} · 훈련 ${p.training}${Game.hasShipyard(p) ? ` · 수군 ${p.fleet}` : ''}</div>
      <div class="tt-row">금 ${fmt(p.gold)} · 식량 ${fmt(p.food)} · 인구 ${fmt(p.pop)}</div>`;
    if (p.traits && p.traits.length) html += `<div class="tt-row tt-traits">${p.traits.map((t) => `<span class="trait" title="${esc(TRAIT_INFO[t].desc)}">${esc(TRAIT_INFO[t].label)}</span>`).join('')}</div>`;
    if (offs.length) { const gov = Game.governorOf(p); html += `<div class="tt-row tt-offs">${offs.map((o) => `${Game.isRuler(o) ? '★ ' : ''}${gov && gov.name === o.name ? '⚖ ' : ''}${esc(o.name)}${Game.itemsOf(o.name).length ? ' ' + Game.itemsOf(o.name).map((it) => ITEM_ICON[it.type] || '✦').join('') : ''}`).join(', ')}</div>`; }
    const free = Game.freeOfficersIn(pid);
    if (free.length) html += `<div class="tt-row tt-free">재야: ${free.map((o) => esc(o.name)).join(', ')}</div>`;
    if (!S.observer && p.owner && p.owner !== S.player) {
      const rel = Game.relation(S.player, p.owner);
      html += `<div class="tt-row"><span class="rel-${Game.relationWord(rel)}">${Game.relationWord(rel)} (${rel})</span> · ${treatyLabel(S.player, p.owner)}</div>`;
    }
    if (selected && selected !== pid && S.adj[selected].includes(pid)) {
      const m = Game.battleModifiers(selected, pid);
      const t = Game.roadType(selected, pid);
      html += `<div class="tt-row tt-road">${esc(Game.pname(selected))}에서의 길: ${t}${m.blocked ? ' — ' + esc(m.blocked) : ''}${m.notes.length && !m.blocked ? '<br>' + m.notes.map(esc).join('<br>') : ''}</div>`;
    }
    return html;
  }
  function initTooltip() {
    const tip = $('#tip'), wrap = $('#map-wrap'), svg = $('#map');
    let cur = null;
    svg.addEventListener('pointerover', (e) => { const g = e.target.closest('.prov'); if (g) { cur = g.dataset.id; tip.innerHTML = tooltipHtml(cur); tip.hidden = false; } });
    svg.addEventListener('pointermove', (e) => {
      if (tip.hidden) return;
      const g = e.target.closest('.prov');
      if (!g) { tip.hidden = true; cur = null; return; }
      if (g.dataset.id !== cur) { cur = g.dataset.id; tip.innerHTML = tooltipHtml(cur); }
      const r = wrap.getBoundingClientRect();
      let x = e.clientX - r.left + 16, y = e.clientY - r.top + 16;
      if (x + tip.offsetWidth > r.width - 8) x = e.clientX - r.left - tip.offsetWidth - 12;
      if (y + tip.offsetHeight > r.height - 8) y = e.clientY - r.top - tip.offsetHeight - 12;
      tip.style.left = x + 'px'; tip.style.top = y + 'px';
    });
    svg.addEventListener('pointerout', (e) => { if (!e.relatedTarget || !e.relatedTarget.closest || !e.relatedTarget.closest('.prov')) { tip.hidden = true; cur = null; } });
    svg.addEventListener('pointerdown', () => { tip.hidden = true; });
  }

  // City boxes and road glyphs are drawn in map units, so they would grow with every zoom step. Past a
  // comfortable on-screen size they are scaled back down, leaving open ground between cities instead.
  const LABEL_CAP_PX = 125;
  function labelScale() {
    const r = $('#map').getBoundingClientRect();
    if (!r.width || !r.height) return 1;
    const pxPerUnit = Math.min(r.width / VB.w, r.height / VB.h);
    return Math.min(1, LABEL_CAP_PX / (96 * pxPerUnit));
  }
  function applyLabelScale() {
    const s = labelScale().toFixed(3);
    for (const g of document.querySelectorAll('#dyn .prov, #dyn .glyph')) g.setAttribute('transform', `translate(${g.dataset.x},${g.dataset.y}) scale(${s})`);
  }
  function applyViewBox() {
    $('#map').setAttribute('viewBox', `${VB.x} ${VB.y} ${VB.w} ${VB.h}`);
    const f = VB.w > TERRAIN.W * 0.8;
    const dyn = document.getElementById('dyn');
    if (f !== far) { far = f; if (dyn && dyn.innerHTML) renderMap(); }
    else if (dyn && dyn.innerHTML) applyLabelScale();
  }
  function clampView() {
    VB.x = Math.max(-VB.w * 0.6, Math.min(TERRAIN.W - VB.w * 0.4, VB.x));
    VB.y = Math.max(-VB.h * 0.6, Math.min(TERRAIN.H - VB.h * 0.4, VB.y));
  }
  function zoomAt(factor, cx, cy) {
    const nw = Math.max(TERRAIN.W / 6, Math.min(TERRAIN.W * 1.4, VB.w / factor));
    const f = VB.w / nw;
    VB.x = cx - (cx - VB.x) / f; VB.y = cy - (cy - VB.y) / f;
    VB.w = nw; VB.h = VB.h / f;
    clampView(); applyViewBox();
  }
  // fill the map area (no letterboxing); a wide screen sees the heartland band and pans north or south
  function resetView() {
    const r = $('#map').getBoundingClientRect();
    const ar = r.width && r.height ? r.width / r.height : TERRAIN.W / TERRAIN.H;
    if (ar >= TERRAIN.W / TERRAIN.H) { VB.w = TERRAIN.W; VB.h = TERRAIN.W / ar; VB.x = 0; VB.y = Math.max(0, (TERRAIN.H - VB.h) * 0.42); }
    else { VB.h = TERRAIN.H; VB.w = TERRAIN.H * ar; VB.y = 0; VB.x = Math.max(0, (TERRAIN.W - VB.w) * 0.55); }
    applyViewBox();
  }
  function svgPoint(clientX, clientY) {
    const svg = $('#map'); const pt = svg.createSVGPoint(); pt.x = clientX; pt.y = clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  }
  function unitsPerPixel() { const r = $('#map').getBoundingClientRect(); return Math.max(VB.w / r.width, VB.h / r.height); }

  function initMapControls() {
    const svg = $('#map');
    svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = svgPoint(e.clientX, e.clientY);
      zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, p.x, p.y);
    }, { passive: false });
    const pointers = new Map();
    let dragStart = null, pinchStart = null;
    svg.addEventListener('pointerdown', (e) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      svg.setPointerCapture(e.pointerId);
      if (pointers.size === 1) dragStart = { x: e.clientX, y: e.clientY, vx: VB.x, vy: VB.y, moved: false };
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchStart = { dist: Math.hypot(a.x - b.x, a.y - b.y), w: VB.w, h: VB.h, mid: svgPoint((a.x + b.x) / 2, (a.y + b.y) / 2) };
        dragStart = null;
      }
    });
    svg.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2 && pinchStart) {
        const [a, b] = [...pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        const f = dist / pinchStart.dist;
        const nw = Math.max(TERRAIN.W / 6, Math.min(TERRAIN.W * 1.4, pinchStart.w / f));
        const real = pinchStart.w / nw;
        VB.w = nw; VB.h = pinchStart.h / real;
        VB.x = pinchStart.mid.x - (pinchStart.mid.x - VB.x) / 1; VB.y = pinchStart.mid.y - (pinchStart.mid.y - VB.y) / 1;
        clampView(); applyViewBox();
        return;
      }
      if (dragStart) {
        const dx = e.clientX - dragStart.x, dy = e.clientY - dragStart.y;
        if (!dragStart.moved && Math.hypot(dx, dy) > 4) { dragStart.moved = true; svg.classList.add('dragging'); }
        if (dragStart.moved) {
          const upp = unitsPerPixel();
          VB.x = dragStart.vx - dx * upp; VB.y = dragStart.vy - dy * upp;
          clampView(); applyViewBox();
        }
      }
    });
    const end = (e) => {
      pointers.delete(e.pointerId);
      if (dragStart && dragStart.moved) suppressClick = true;
      if (pointers.size < 2) pinchStart = null;
      if (pointers.size === 0) { dragStart = null; svg.classList.remove('dragging'); }
    };
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);
    $('#zoom-in').addEventListener('click', () => zoomAt(1.3, VB.x + VB.w / 2, VB.y + VB.h / 2));
    $('#zoom-out').addEventListener('click', () => zoomAt(1 / 1.3, VB.x + VB.w / 2, VB.y + VB.h / 2));
    $('#zoom-reset').addEventListener('click', resetView);
    $('#toggle-territory').addEventListener('click', () => setTerritory(!showTerritory));
    setTerritory(showTerritory);
  }

  function loyClass(l) { return l < 50 ? 'loy-lo' : l < 80 ? 'loy-ok' : 'loy-hi'; }

  function officerTable(list, opts = {}) {
    if (!list.length) return '<div class="hint">이곳에 장수가 없습니다.</div>';
    return `<table class="off"><tr><th>이름</th><th>나이</th><th>통솔</th><th>무력</th><th>지력</th><th>정치</th><th>매력</th>${opts.loyalty ? '<th>충성</th>' : ''}${opts.city ? '<th>도시</th>' : ''}${opts.faction ? '<th>세력</th>' : ''}${opts.status ? '<th></th>' : ''}</tr>
      ${list.map((o) => `<tr class="${o.acted && opts.status ? 'acted' : ''}">
        <td class="n">${avatar(o)}${Game.isRuler(o) ? '<span class="crown">★</span> ' : ''}${rankTag(o)}<span class="${BIOS[o.name] ? 'bio-link' : ''}" data-bio="${esc(o.name)}">${esc(o.name)}</span>${itemBadge(o)}${skillTags(o)}</td>
        <td class="num">${Game.age(o)}</td>
        <td class="num">${o.ldr}</td><td class="num">${o.war}</td><td class="num">${o.int}</td><td class="num">${o.pol}</td><td class="num">${o.chr}</td>
        ${opts.loyalty ? `<td class="num ${loyClass(o.loyalty)}">${Game.isRuler(o) ? '—' : o.loyalty}</td>` : ''}
        ${opts.city ? `<td>${esc(Game.pname(o.city))}</td>` : ''}
        ${opts.faction ? `<td><span class="chip" style="background:${o.faction ? Game.fac(o.faction).color : FREE_COLOR}"></span> ${esc(Game.fname(o.faction))}</td>` : ''}
        ${opts.status ? `<td>${o.acted ? '완료' : ''}</td>` : ''}
      </tr>`).join('')}</table>`;
  }

  function renderPanel() {
    const S = Game.state();
    if (!selected) { $('#panel').innerHTML = overviewHtml(); bindPanel(); return; }
    const p = Game.prov(selected);
    const P = PROVINCES.find((x) => x.id === selected);
    const mine = !S.observer && p.owner === S.player;
    const ownerColor = p.owner ? Game.fac(p.owner).color : FREE_COLOR;
    const income = Math.floor(p.comm * 1.2 + p.pop / 5000) - Math.floor(p.troops * 0.01);
    const harvest = Math.floor(p.agri * 4);
    const upkeep = Math.floor(p.troops * 0.1);
    const bar = (v, max) => `<div class="bar"><i style="width:${Math.min(100, (v / max) * 100)}%"></i></div>`;

    const meGuest = !S.observer && S.factions[S.player].guest;
    const B = Game.battleFor(selected);
    const nearBattle = !S.observer && p.owner === S.player && !B ? S.adj[selected].map((n) => Game.battleFor(n)).filter((x) => x && (x.attF === S.player || x.defF === S.player || (x.attF && Game.treatyStatus(S.player, x.attF) === 'alliance') || (x.defF && Game.treatyStatus(S.player, x.defF) === 'alliance'))) : [];
    let html = `${meGuest ? '<div class="hint"><a href="#" id="back-exile">◂ 망명 가솔로 돌아가기</a></div>' : ''}<div class="ph"><h2>${esc(P.name)}</h2><div class="owner"><span class="chip" style="background:${ownerColor}"></span>${esc(Game.fname(p.owner))}</div></div>${CITY_NOTES[P.id] ? `<div class="hint" style="font-style:italic">${esc(CITY_NOTES[P.id])}</div>` : ''}
      <div class="grid2">
        <div class="kv"><span>병력</span><b>${fmt(p.troops)}</b></div>
        <div class="kv"><span>훈련도</span><b>${p.training}</b></div>
        <div class="kv"><span>금</span><b>${fmt(p.gold)} <small style="color:var(--muted)">(+${fmt(income)}/월)</small></b></div>
        <div class="kv"><span>식량</span><b>${fmt(p.food)} <small style="color:var(--muted)">(${harvest - upkeep >= 0 ? '+' : ''}${fmt(harvest - upkeep)}/월)</small></b></div>
        <div><div class="kv"><span>농업</span><b>${p.agri}</b></div>${bar(p.agri, 999)}</div>
        <div><div class="kv"><span>상업</span><b>${p.comm}</b></div>${bar(p.comm, 999)}</div>
        <div><div class="kv"><span>성벽</span><b>${p.defense}</b></div>${bar(p.defense, 999)}</div>
        <div class="kv"><span>인구</span><b>${fmt(p.pop)}</b></div>
        ${Game.hasShipyard(p) ? `<div><div class="kv"><span>수군</span><b>${p.fleet}</b></div>${bar(p.fleet, 100)}</div>` : ''}
        <div><div class="kv"><span>치안</span><b class="${p.order < 30 ? 'loy-lo' : p.order < 60 ? 'loy-ok' : 'loy-hi'}" title="60 미만이면 수입 감소, 30 미만이면 징집 불가, 20 미만이면 반란 가능">${p.order}</b></div>${bar(p.order, 100)}</div>
        <div class="kv"><span>교역로</span><b title="아군·동맹의 인접 도시. 하나당 수입 +8%. 적대 국경은 -10%.">${p.tradeLinks || 0}${p.hostileBorder ? ' · 최전선' : ''}</b></div>
      </div>
      ${p.traits && p.traits.length ? `<div class="traits">${p.traits.map((t) => `<span class="trait" title="${esc(TRAIT_INFO[t].desc)}">${esc(TRAIT_INFO[t].label)}</span>`).join('')}</div>` : ''}`;
    const idleHere = Game.idleOfficers(selected);
    if (B) {
      const ps = Game.playerSideOf(B);
      html += `<div class="sec">전투</div><div class="kv"><span>포위한 세력</span><b>${esc(Game.fname(B.attF))}</b></div><div class="kv"><span>일차</span><b>${B.day}일차 (이달 ${B.dayInMonth}일째)</b></div><div class="kv"><span>전장</span><b>공격 ${fmt(BATTLE.sideTroops(B, 'A'))} · 수비 ${fmt(BATTLE.sideTroops(B, 'D'))}</b></div>
        <div class="cmds">${ps ? `<button class="wide btn-gold" data-cmd="openBattle">⚔ ${B.dayInMonth < 30 ? '전투 치르기' : '전투 보기'}</button>` : `<button class="wide" data-cmd="openBattle">공성 관전</button>`}</div>`;
    }
    const sites = p.sites || [];
    if (sites.length || (p.owner === S.player && !S.observer)) {
      html += `<div class="sec">외성 시설</div><div class="sites-list">${sites.map((st, i) => { const T = SITE_TYPES[st.type]; return `<div class="kv" title="${esc(T.desc)}"><span><span class="glyph">${T.glyph}</span>${esc(T.label)}${st.damaged ? ' <small style="color:#e29a8f">(파괴됨)</small>' : ''}</span><b>${st.damaged && p.owner === S.player && !S.observer ? `<button class="btn-sm" data-cmd="repair" data-i="${i}" ${!idleHere.length ? 'disabled' : ''}>수리 (${Math.floor(T.cost / 2)}금)</button>` : `<small class="hint">${st.type === 'village' ? '+식량' : T.gold ? `+${T.gold}금` : '건설됨'}</small>`}</b></div>`; }).join('') || '<div class="hint">\uc544\uc9c1 \uc5c6\uc74c. \uc678\uc131 \uc2dc\uc124\uc740 \ub3c4\uc2dc \uc804\ud22c\ub9f5 \uc704\uc5d0 \uc11c\uba70 \uacf5\uc131\uc804\uc5d0\uc11c \uc57d\ud0c8\ub2f9\ud560 \uc218 \uc788\uc2b5\ub2c8\ub2e4.</div>'}</div>`;
      if (p.owner === S.player && !S.observer) html += `<div class="cmds"><button class="wide" data-cmd="site" ${!idleHere.length ? 'disabled' : ''} title="성 밖에 광산·촌락·목장·벌목장·선착장·염전·망루·저자를 세움">⚒ 외성 시설 건설</button></div>`;
    }
    if (nearBattle.length) html += `<div class="sec">인근 전투</div><div class="cmds">${nearBattle.map((x) => `<button data-cmd="reinforce" data-target="${x.city}" ${!idleHere.length ? 'disabled' : ''}>${esc(Game.pname(x.city))}에 지원</button>`).join('')}</div>`;

    const offs = p.owner ? Game.officersIn(selected, p.owner) : [];
    const gov = Game.governorOf(p);
    html += `<div class="sec">장수 (${offs.length})${gov ? ` · 태수 ${esc(gov.name)} <span class="hint" title="정치가 가장 높은 장수가 태수를 맡음: 수입 +${(gov.pol / 10).toFixed(0)}%${gov.ldr >= 60 ? `, 수비 ×${(1 + gov.ldr / 1000).toFixed(2)}` : ''}">(정치 ${gov.pol})</span>` : ''}</div>${officerTable(offs, { loyalty: mine, status: mine })}`;

    const guests = Object.values(S.officers).filter((o) => o.city === selected && o.faction && o.faction !== p.owner && !o.captive && S.factions[o.faction].guest);
    if (guests.length) {
      const byHouse = {};
      for (const g of guests) (byHouse[g.faction] = byHouse[g.faction] || []).push(g);
      for (const [fid, list] of Object.entries(byHouse)) html += `<div class="sec">망명 손님: ${esc(Game.fname(fid))} 가문</div>${officerTable(list)}`;
    }
    const free = Game.freeOfficersIn(selected);
    if (free.length) {
      html += `<div class="sec">재야 인재</div>${officerTable(free)}`;
      if (mine) html += `<div class="cmds">${free.map((o) => `<button data-cmd="recruitOfficer" data-target="${esc(o.name)}">${esc(o.name)} 등용</button>`).join('')}</div>`;
    }
    if (mine) {
      const caps = Game.captivesIn(selected, S.player);
      if (caps.length) html += `<div class="sec">포로</div><div class="hint">${caps.map((c) => esc(c.name)).join(', ')} (처분 대기)</div>`;
    }

    if (mine) {
      const idle = Game.idleOfficers(selected);
      const canAttack = Game.enemyNeighbors(selected).some((n) => Game.canAttack(S.player, n.owner) && !Game.battleModifiers(selected, n.id).blocked);
      const canMove = Game.neighbors(selected).some((n) => n.owner === S.player);
      html += `${coachBanner()}<div class="sec">명령</div>
        <div class="row" style="margin:2px 0 6px"><label title="이 도시가 공격받을 때의 기본 방침">수비 방침</label><select data-posture="1"><option value="hold" ${p.posture === 'hold' ? 'selected' : ''}>농성 (성벽 +8%)</option><option value="sally" ${p.posture === 'sally' ? 'selected' : ''}>출격 (적 손실↑, 성벽 효과↓)</option><option value="ambush" ${p.posture === 'ambush' ? 'selected' : ''}>매복 (적장보다 지략이 높아야 함)</option></select></div>
        <div class="hint">${idle.length ? `장수 ${idle.length}명 행동 대기 중.` : '이달에는 모든 장수가 행동을 마쳤습니다.'}</div>
        <div class="cmds">
          <button data-cmd="agri" ${!idle.length ? 'disabled' : ''}>농업 (${Game.COST.develop}금)</button>
          <button data-cmd="comm" ${!idle.length ? 'disabled' : ''}>상업 (${Game.COST.develop}금)</button>
          <button data-cmd="fortify" ${!idle.length ? 'disabled' : ''}>축성 (${Game.COST.fortify}금)</button>
          <button data-cmd="train" ${!idle.length ? 'disabled' : ''}>훈련</button>
          <button data-cmd="recruit" ${!idle.length ? 'disabled' : ''}>징병 (${Game.COST.recruit}금)</button>
          <button data-cmd="search" ${!idle.length ? 'disabled' : ''}>탐색</button>
          <button data-cmd="reward">포상 (${Game.COST.reward}금)</button>
          <button data-cmd="pacify" ${!idle.length ? 'disabled' : ''} title="치안 회복">선정 (${Game.COST.pacify}금)</button>
          <button data-cmd="resettle" ${!idle.length ? 'disabled' : ''} title="백성을 이주시켜 인구 회복">사민 (${Game.COST.resettle}금)</button>
          <button data-cmd="appoint" title="관등을 수여">관등 수여</button>
          <button data-cmd="plot" ${!idle.length || !Game.plotTargets(selected).length ? 'disabled' : ''} title="인접 도시에 대한 계략">계략</button>
          <button data-cmd="bestow" ${offs.some((o) => Game.itemsOf(o.name).length) && offs.length > 1 ? '' : 'disabled'} title="이곳의 다른 장수에게 보물을 하사">보물 하사</button>
          <button data-cmd="buyfood" ${p.gold <= 0 ? 'disabled' : ''}>군량 구입</button>
          ${Game.hasShipyard(p) ? `<button data-cmd="ships" ${!idle.length ? 'disabled' : ''}>병선 건조 (${Game.COST.ships}금)</button><button data-cmd="transfer" ${!canMove ? 'disabled' : ''}>이동</button>` : `<button data-cmd="transfer" class="wide" ${!canMove ? 'disabled' : ''}>이동</button>`}
          <button data-cmd="attack" class="wide btn-red" ${!idle.length || !canAttack ? 'disabled' : ''}>⚔ 공격</button>
        </div>`;
    } else {
      const from = S.observer || !Game.canAttack(S.player, p.owner) ? [] : Game.neighbors(selected).filter((n) => n.owner === S.player && Game.idleOfficers(n.id).length && !Game.battleModifiers(n.id, selected).blocked);
      if (from.length) {
        html += `<div class="sec">공격 출발지</div><div class="cmds">${from.map((n) => `<button class="btn-red" data-cmd="attackFrom" data-from="${n.id}">${esc(Game.pname(n.id))} (${fmt(n.troops)})</button>`).join('')}</div>`;
      }
      if (p.owner && p.owner !== S.player) {
        const fp = Game.factionProvinces(p.owner);
        html += `<div class="sec">${esc(Game.fname(p.owner))}</div><div class="hint">${fp.length}개 도시 · 병력 ${fmt(Game.totalTroops(p.owner))} · 장수 ${Game.factionOfficers(p.owner).length}명</div>`;
        if (!S.observer) {
          const rel = Game.relation(S.player, p.owner), st = Game.treatyStatus(S.player, p.owner);
          html += `<div class="hint">관계: <span class="rel-${Game.relationWord(rel)}">${Game.relationWord(rel)} (${rel})</span> · <span class="st-${st}">${treatyLabel(S.player, p.owner)}</span></div>`;
        } else {
          const al = Game.allies(p.owner).map(Game.fname);
          html += `<div class="hint">동맹: ${al.length ? esc(al.join(', ')) : '없음'}</div>`;
        }
      }
    }
    $('#panel').innerHTML = html;
    bindPanel();
  }
  function bindPanel() {
    $('#panel').querySelectorAll('.bio-link').forEach((el) => el.addEventListener('click', () => showWiki(el.dataset.bio)));
    $('#panel').querySelectorAll('[data-cmd]').forEach((b) => b.addEventListener('click', () => command(b.dataset.cmd, b.dataset)));
    const post = $('#panel [data-posture]'); if (post) post.addEventListener('change', () => { const r = Game.setPosture(selected, post.value); toast(r.msg); });
    const back = $('#back-exile'); if (back) back.addEventListener('click', (e) => { e.preventDefault(); selected = null; renderMap(); renderPanel(); });
  }

  // ---------- exile: the house without a city ----------
  function exileHtml() {
    const S = Game.state(); const F = S.factions[S.player];
    const seat = Game.hostSeat(S.player);
    const offs = Game.factionOfficers(S.player);
    const idle = offs.filter((o) => !o.acted && Game.prov(o.city).owner === F.host);
    const host = Game.fac(F.host);
    const free = Game.freeOfficersIn(seat);
    const targets = Game.exileTargets(S.player);
    const hostCities = Game.factionProvinces(F.host).length;
    const favWord = F.favor >= 75 ? '귀빈' : F.favor >= 50 ? '환영받음' : F.favor >= 25 ? '묵인됨' : '눈칫밥';
    const bar = (v, max, color) => `<div class="bar"><i style="width:${Math.min(100, (v / max) * 100)}%;background:${color}"></i></div>`;
    let html = `<div class="ph"><h2>망명 중</h2><div class="owner"><span class="chip" style="background:${host.color}"></span>${esc(host.name)}의 식객</div></div>
      <div class="hint">세력의 도시가 없습니다. <b>${esc(Game.pname(seat))}</b>에 몸을 의탁하고 있습니다. 군주의 신임을 얻어 영지를 청원하거나, 가솔 병력을 모아 도시를 기습 탈환하거나, 다른 후원자를 찾으십시오. 보금자리 없이 12년이 지나면 가솔들이 흩어집니다.</div>
      <div class="grid2">
        <div><div class="kv"><span>신임도</span><b>${F.favor} · ${favWord}</b></div>${bar(F.favor, 100, F.favor >= 50 ? 'var(--green)' : 'var(--red)')}</div>
        <div class="kv"><span>가솔 병력</span><b>${fmt(F.household.troops)}</b></div>
        <div class="kv"><span>가솔 금</span><b>${fmt(F.household.gold)}</b></div>
        <div class="kv"><span>망명 개월</span><b>${S.turn - F.guestSince}</b></div>
        <div class="kv"><span>군주의 도시 수</span><b>${hostCities}</b></div>
        <div class="kv"><span>위세</span><b>${F.prestige || 0}</b></div>
      </div>
      <div class="sec">가솔 장수 (${offs.length})</div>${officerTable(offs, { loyalty: true, status: true })}`;
    if (free.length) html += `<div class="sec">조정의 재야 인재</div>${officerTable(free)}<div class="cmds">${free.map((o) => `<button data-cmd="exRecruit" data-target="${esc(o.name)}">${esc(o.name)} 등용</button>`).join('')}</div>`;
    const dis = idle.length ? '' : 'disabled';
    html += `<div class="sec">명령</div>
      <div class="hint">${idle.length ? `${idle.length}명의 장수가 행동 가능합니다.` : '모든 장수가 이달 행동을 마쳤습니다.'}</div>
      <div class="cmds">
        <button data-cmd="exServe" ${dis} title="군주를 돕습니다: 신임과 급료">망명처 봉사</button>
        <button data-cmd="exPetition" ${dis || (F.petitionUntil > S.turn || hostCities < 2 ? 'disabled' : '')} title="변방의 영지를 청원합니다">영지 청원${F.petitionUntil > S.turn ? ` (${F.petitionUntil - S.turn}개월 후)` : ''}</button>
        <button data-cmd="exRaise" ${dis || (F.household.gold < 150 ? 'disabled' : '')} title="의용군을 모읍니다 (150금)">의용군 모집</button>
        <button data-cmd="exFight" ${dis} title="군주의 군사를 이끌고 적과 싸웁니다">망명처 위해 참전</button>
        <button data-cmd="exPatron" ${dis} title="가솔을 이끌고 다른 군주에게 몸을 의탁합니다">새 군주 찾기</button>
        <button data-cmd="exSeize" class="btn-red" ${dis || (!targets.length || F.household.troops <= 0 ? 'disabled' : '')} title="가솔 군대로 인접 도시를 기습 공격합니다">⚔ 거점 탈환</button>
      </div>
      ${targets.length ? `<div class="hint">${esc(Game.pname(seat))}에서 닿는 도시: ${targets.map((t) => `${esc(Game.pname(t.id))} (${esc(Game.fname(t.owner))}, ${fmt(t.troops)})`).join('; ')}</div>` : `<div class="hint">${esc(Game.pname(seat))}에서 공격할 수 있는 도시가 없습니다.</div>`}`;
    return html;
  }

  function exileCommand(cmd, data) {
    const S = Game.state(); const F = S.factions[S.player];
    const idle = Game.factionOfficers(S.player).filter((o) => !o.acted && Game.prov(o.city).owner === F.host);
    const done = (r) => { if (!r.ok) { result(r); return; } renderAll(); showResult(r.msg, () => {}); };
    switch (cmd) {
      case 'exServe': return chooseOfficer('망명처 봉사', `장수가 한 달간 <b>${esc(Game.fname(F.host))}</b>을(를) 위해 일합니다: 도시를 발전시키고 신임(<b>정치</b> 비례)과 가솔 급료를 얻습니다.`, idle, (o) => `신임 +${Math.floor(2 + o.pol / 25 + (o.chr >= 80 ? 1 : 0))} · ${60 + o.pol}금`, (n) => done(Game.exileServe(S.player, n)));
      case 'exPetition': return chooseOfficer('영지 청원', `사신을 보내 <b>${esc(Game.fname(F.host))}</b>에게 변방 영지를 청원합니다. 확률은 신임도(${F.favor}), 사신의 <b>매력</b>과 <b>정치</b>, 위세 및 군주의 영토 규모에 좌우됩니다. 실패 시 신임이 깎이며 6개월간 재청원할 수 없습니다.`, idle, (o) => `${Math.round(Game.petitionChance(S.player, o) * 100)}%`, (n) => done(Game.exilePetition(S.player, n)));
      case 'exRaise': return chooseOfficer('의용군 모집', '가솔 금 150을 써서 군기를 세우고 장정을 모읍니다. 모병 수는 <b>통솔</b>과 <b>매력</b>에 좌우됩니다. 군주의 수비군 절반을 넘는 규모는 군주를 불안하게 만듭니다.', idle, (o) => `≈ ${fmt(((o.ldr + o.chr) / 2) * 15 + 100 + (F.prestige || 0) * 5)}명`, (n) => done(Game.exileRaise(S.player, n)));
      case 'exFight': return chooseOfficer('망명처 위해 참전', '군주의 군사를 이끌고 국경의 침략군을 물리칩니다. 성공(<b>무력</b>과 <b>통솔</b>) 시 신임과 위세를 얻습니다.', idle, (o) => `${Math.round((0.35 + (o.war + o.ldr) / 400) * 100)}%`, (n) => done(Game.exileFight(S.player, n)));
      case 'exRecruit': { const t = Game.off(data.target); return chooseOfficer(`${t.name} 등용`, `<b>${esc(t.name)}</b>을(를) 설득하여 영지 없는 세력에 합류하게 합니다. 위세가 도움이 됩니다.`, idle, (o) => `${Math.round(Game.recruitChance(o, t, Game.rulerOf(S.player).chr, S.player) * 100)}%`, (n) => done(Game.exileRecruit(S.player, n, t.name))); }
      case 'exPatron': {
        const lords = Object.values(S.factions).filter((h) => h.alive && !h.raider && !h.guest && h.id !== S.player && h.id !== F.host && Game.factionProvinces(h.id).length).sort((a, b) => Game.relation(S.player, b.id) - Game.relation(S.player, a.id));
        if (!lords.length) { result({ ok: false, msg: '받아들여 줄 군주가 없습니다.' }); return; }
        openModal(`<h3>새 군주 찾기</h3><p>${esc(Game.fname(F.host))}의 조정을 떠나(관계 -15, 위세 -3) 온 가솔을 다른 군주에게 옮깁니다. 새 군주와의 신임도는 40에서 시작합니다.</p>
          <div class="row"><label>새 군주</label><select id="ex-host" style="flex:1">${lords.map((h) => `<option value="${h.id}">${esc(h.name)} — ${Game.factionProvinces(h.id).length}개 도시 · ${Game.relationWord(Game.relation(S.player, h.id))} (${Game.relation(S.player, h.id)})</option>`).join('')}</select></div>
          <p class="hint">청을 전할 장수를 선택하십시오:</p>${pickList(idle)}
          <div class="modal-actions"><button data-act="cancel">취소</button><button class="btn btn-gold" data-act="ok">출발</button></div>`, {
          cancel: closeModal, ok: () => { const n = picked()[0]; if (!n) return; closeModal(); done(Game.exileSeekPatron(S.player, n, $('#ex-host').value)); },
        });
        return;
      }
      case 'exSeize': {
        const targets = Game.exileTargets(S.player); const seat = Game.hostSeat(S.player);
        const refresh = () => {
          const t = $('#ex-target').value; const n = Math.min(+$('#ex-troops').value, F.household.troops); $('#ex-range').value = n;
          const names = picked(); if (!names.length) { $('#ex-est').innerHTML = '<span class="hint">지휘관을 선택하십시오.</span>'; return; }
          const to = Game.prov(t); const m = Game.battleModifiers(seat, t); const att = names.map(Game.off); const def = to.owner ? Game.officersIn(t, to.owner) : [];
          const mx = (l, k, d) => (l.length ? Math.max(...l.map((o) => o[k])) : d);
          const aPow = n * (1 - m.loss) * (0.5 + mx(att, 'war', 50) / 100) * (0.7 + mx(att, 'ldr', 50) / 250) * (0.7 + 60 / 300) * m.att;
          const dPow = to.troops * (0.5 + mx(def, 'war', to.owner ? 40 : 50) / 100) * (0.7 + mx(def, 'ldr', to.owner ? 40 : 50) / 250) * (0.7 + to.training / 300) * (1 + to.defense / 1000) * m.def;
          const r = dPow > 0 ? aPow / dPow : 9;
          const label = r > 2.2 ? ['압도적 우세', 'var(--green)'] : r > 1.5 ? ['유리함', '#9fd69f'] : r > 1.1 ? ['약간 유리', 'var(--gold2)'] : r > 0.8 ? ['호각 (위험)', '#ffb86b'] : ['불리함', '#e29a8f'];
          $('#ex-est').innerHTML = `<span style="color:${label[1]}">${label[0]}</span> <small style="color:var(--muted)">(전력비 ${r.toFixed(2)})</small>${m.notes.length ? `<div class="hint">${m.notes.map(esc).join('<br>')}</div>` : ''}`;
        };
        openModal(`<h3>${esc(Game.pname(seat))}에서 거점 탈환</h3>
          <p>가솔 군대를 이끌고 인접 도시를 기습합니다. 이기면 세력의 터전을 되찾고, 지면 생존자들만 군주의 품으로 돌아옵니다.</p>
          <div class="row"><label>공격 대상</label><select id="ex-target" style="flex:1">${targets.map((t) => `<option value="${t.id}">${esc(Game.pname(t.id))} — ${esc(Game.fname(t.owner))} · 병력 ${fmt(t.troops)} · 성벽 ${t.defense}</option>`).join('')}</select></div>
          <p class="hint">지휘관 (최대 3명):</p>${pickList(idle, { multi: true, max: 3 })}
          <div class="row"><label>출진 병력</label><input type="number" id="ex-troops" min="1" max="${F.household.troops}" value="${F.household.troops}"><span class="max">/ ${fmt(F.household.troops)}</span></div>
          <input type="range" id="ex-range" min="1" max="${F.household.troops}" value="${F.household.troops}">
          <div class="row"><label>전망</label><span id="ex-est"></span></div>
          <div class="modal-actions"><button data-act="cancel">취소</button><button class="btn btn-gold" data-act="ok">출진!</button></div>`, {
          cancel: closeModal, onpick: refresh,
          oninput: (e) => { if (e.target.id === 'ex-range') $('#ex-troops').value = e.target.value; refresh(); },
          ok: () => { const res = Game.exileSeize(S.player, $('#ex-target').value, picked(), +$('#ex-troops').value); if (!res.ok) { result(res); return; } closeModal(); renderAll(); showBattle(res.report, () => handleCaptives(renderAll)); },
        });
        refresh();
        return;
      }
    }
  }

  function overviewHtml() {
    const S = Game.state();
    const rows = Object.values(S.factions).map((f) => ({ f, cities: Game.factionProvinces(f.id).length, troops: Game.totalTroops(f.id), offs: Game.factionOfficers(f.id).length }))
      .sort((a, b) => b.cities - a.cities || b.troops - a.troops);
    const me = !S.observer && S.factions[S.player];
    if (me && me.guest) return exileHtml();
    return `<div class="ph"><h2>천하 정세</h2></div>
      <div class="hint">지도에서 도시를 선택해 살펴보세요.</div>
      <ul class="factlist">${rows.map((r) => `<li><span class="chip" style="background:${r.f.color}"></span><span class="fn ${r.f.alive ? '' : 'dead'}">${esc(r.f.name)}${r.f.id === S.player ? ' (나)' : ''}</span><small>${r.cities}개 도시 · 병력 ${fmt(r.troops)} · 장수 ${r.offs}</small></li>`).join('')}</ul>`;
  }

  function renderLog() {
    const S = Game.state();
    $('#log').innerHTML = S.log.slice(0, 120).map((l) => `<div class="log-line ${l.cls}"><span class="lt">${l.t}</span>${esc(l.text)}</div>`).join('');
    const latest = S.log[0];
    $('#ticker-time').textContent = latest ? latest.t : '';
    $('#ticker-text').textContent = latest ? latest.text : '';
    $('#ticker-text').className = latest ? `log-line ${latest.cls || ''}` : '';
    const idx = seenEntry ? S.log.indexOf(seenEntry) : -1;
    const unread = idx === -1 ? Math.min(S.log.length, 99) : idx;
    $('#ticker-more').textContent = $('#chronicle').hidden ? `연대기 ▴${unread ? ` · ${unread} 새 소식` : ''}` : '연대기 ▾';
  }

  function toast(msg) { Game.log(msg, 'sys'); renderLog(); }

  // ---------- modal helpers ----------
  function openModal(html, handlers = {}, lock = false) {
    modalHandlers = handlers; modalLocked = lock;
    $('#modal-box').innerHTML = html;
    $('#modal').hidden = false;
  }
  function closeModal() { $('#modal').hidden = true; modalHandlers = {}; modalLocked = false; }

  function togglePick(li) {
    const list = li.closest('.pick');
    const multi = list.dataset.multi === '1';
    const max = parseInt(list.dataset.max || '99', 10);
    if (!multi) list.querySelectorAll('li.sel').forEach((x) => { if (x !== li) x.classList.remove('sel'); });
    if (li.classList.contains('sel')) li.classList.remove('sel');
    else if (multi && list.querySelectorAll('li.sel').length >= max) return;
    else li.classList.add('sel');
    if (modalHandlers.onpick) modalHandlers.onpick();
  }
  const picked = (sel = '.pick') => [...$('#modal-box').querySelectorAll(`${sel} li.sel`)].map((li) => li.dataset.name);

  function pickList(officers, { multi = false, max = 3, extra = () => '', id = '' } = {}) {
    if (!officers.length) return '<div class="hint">가용 장수가 없습니다.</div>';
    return `<ul class="pick" ${id ? `id="${id}"` : ''} data-multi="${multi ? 1 : 0}" data-max="${max}">${officers.map((o) => `<li data-name="${esc(o.name)}"><span class="nm">${avatar(o)}${Game.isRuler(o) ? '★ ' : ''}${esc(o.name)}${itemBadge(o)}</span><span class="st">나이 ${Game.age(o)} · 통솔 ${o.ldr} · 무력 ${o.war} · 지력 ${o.int} · 정치 ${o.pol} · 매력 ${o.chr}</span><span class="ex">${extra(o)}</span></li>`).join('')}</ul>`;
  }

  function chooseOfficer(title, desc, officers, extra, onChoose) {
    openModal(`<h3>${esc(title)}</h3><p>${desc}</p>${pickList(officers, { extra })}
      <div class="modal-actions"><button data-act="cancel">취소</button><button class="btn btn-gold" data-act="ok">확인</button></div>`, {
      cancel: closeModal,
      ok: () => { const n = picked()[0]; if (!n) return; closeModal(); onChoose(n); },
    });
  }

  function result(res) {
    if (!res.ok) { openModal(`<h3>할 수 없습니다</h3><p>${esc(res.msg)}</p><div class="modal-actions"><button class="btn btn-gold" data-act="close">확인</button></div>`, { close: closeModal }); return false; }
    renderAll();
    return true;
  }

  // ---------- commands ----------
  function command(cmd, data) {
    if (cmd.startsWith('ex')) return exileCommand(cmd, data);
    const pid = selected;
    const idle = Game.idleOfficers(pid);
    const S = Game.state();
    switch (cmd) {
      case 'agri':
        return chooseOfficer('농업 개발', `${Game.COST.develop}금을 들여 농지를 개량합니다. 성과는 <b>정치</b>에 좌우됩니다.`, idle, (o) => `≈ +${Math.floor(o.pol / 4 + 5)}`, (n) => result(Game.develop(pid, n, 'agri')));
      case 'comm':
        return chooseOfficer('상업 개발', `${Game.COST.develop}금을 들여 저자를 키웁니다. 성과는 <b>정치</b>에 좌우됩니다.`, idle, (o) => `≈ +${Math.floor(o.pol / 4 + 5)}`, (n) => result(Game.develop(pid, n, 'comm')));
      case 'fortify':
        return chooseOfficer('성벽 축성', `${Game.COST.fortify}금을 들여 성의 방어를 높입니다. 성과는 <b>통솔</b>에 좌우됩니다.`, idle, (o) => `≈ +${Math.floor(o.ldr / 4 + 4)}`, (n) => result(Game.fortify(pid, n)));
      case 'train':
        return chooseOfficer('병사 훈련', '수비병을 조련해 훈련도를 올립니다(최대 100). 성과는 <b>통솔</b>과 <b>무력</b>에 좌우됩니다.', idle, (o) => `≈ +${Math.floor(o.ldr / 8 + o.war / 20 + 1)}`, (n) => result(Game.train(pid, n)));
      case 'recruit':
        return chooseOfficer('징병', `${Game.COST.recruit}금을 들여 백성에서 병사를 모읍니다. 수는 <b>통솔</b>과 <b>매력</b>에 좌우됩니다. 신병은 훈련도를 낮춥니다.`, idle, (o) => `≈ ${fmt(((o.ldr + o.chr) / 2) * 25 + 200)}`, (n) => result(Game.recruitTroops(pid, n)));
      case 'search':
        return chooseOfficer('도시 탐색', '세금과 공물을 거두고, 숨겨진 재물을 찾을 수도 있습니다. <b>지력</b>에 좌우됩니다.', idle, (o) => `≈ ${fmt(o.int * 2 + 125)}금`, (n) => result(Game.search(pid, n)));
      case 'recruitOfficer': {
        const t = Game.off(data.target);
        const ruler = Game.rulerOf(S.player);
        return chooseOfficer(`${t.name} 등용`, `사신을 보내 <b>${esc(t.name)}</b> (통솔 ${t.ldr} · 무력 ${t.war} · 지력 ${t.int} · 정치 ${t.pol} · 매력 ${t.chr})을 설득합니다. 성공은 사신과 당신의 <b>매력</b>에 좌우됩니다.`, idle,
          (o) => `성공률 ${Math.round(Game.recruitChance(o, t, ruler.chr) * 100)}%`, (n) => result(Game.recruitOfficer(pid, n, t.name)));
      }
      case 'reward': {
        const list = Game.officersIn(pid, S.player).filter((o) => !Game.isRuler(o));
        return chooseOfficer('장수 포상', `${Game.COST.reward}금을 선물에 써 충성을 높입니다. 충성 50 미만인 장수는 배신할 수 있습니다.`, list, (o) => `충성 ${o.loyalty}`, (n) => result(Game.reward(pid, n)));
      }
      case 'buyfood': return buyFoodDialog(pid);
      case 'resettle':
        return chooseOfficer('사민(이주)', `${Game.COST.resettle}금을 들여 빈 들판에 유민과 이주민을 데려옵니다. 성과는 도시 규모와 장수의 <b>정치</b>에 좌우되며, 내정가가 더 낫습니다. 인구는 도시가 유지할 수 있는 병력(인구의 30%)을 정하고 수입에도 더해지므로, 전란으로 황폐해진 땅은 다시 사람을 채워야 군사를 일으킬 수 있습니다. 치안 40 이상 필요.`, idle, (o) => `≈ +${fmt(Math.floor(([0, 260000, 520000, 900000][PROVINCES.find((x) => x.id === pid).tier] * 0.006 + o.pol * 25 + 400) * ((o.skills || []).includes('admin') ? 1.4 : 1)))}`, (n) => result(Game.resettle(pid, n)));
      case 'pacify':
        return chooseOfficer('선정(치안)', `${Game.COST.pacify}금을 들여 분쟁을 가라앉히고 빈민을 먹입니다. 성과는 <b>정치</b>와 <b>매력</b>에 좌우되며, 내정가·변설가는 1.5배 효과입니다. 치안 60 미만이면 수입이 줄고, 30 미만이면 징병이 멈추며, 20 미만이면 반란 위험이 있습니다.`, idle, (o) => `≈ +${Math.floor((3 + o.pol / 6 + o.chr / 10 + 2) * ((o.skills || []).some((s) => s === 'admin' || s === 'orator') ? 1.5 : 1))}`, (n) => result(Game.pacify(pid, n)));
      case 'appoint': {
        const list = Game.officersIn(pid, S.player).filter((o) => !Game.isRuler(o) && (o.rank || 0) < 3);
        return chooseOfficer('관등 수여', `관등은 금이 들고(${Game.RANK_COST.slice(1).join(' / ')}) 충성을 10 올리며 하한선이 유지됩니다. 당신의 칭호(${esc(Game.titleOf(S.player).name)})는 장군·대장군 ${Game.titleOf(S.player).slots}명을 둘 수 있습니다.`, list, (o) => `${o.rank ? Game.RANKS[o.rank] + ' → ' : ''}${Game.RANKS[(o.rank || 0) + 1]} (${Game.RANK_COST[(o.rank || 0) + 1]}금) · 충성 ${o.loyalty}`, (n) => result(Game.appoint(pid, n)));
      }
      case 'plot': return plotDialog(pid);
      case 'bestow': {
        const holders = Game.officersIn(pid, S.player).filter((o) => Game.itemsOf(o.name).length);
        return chooseOfficer('보물 하사', '보물을 내놓을 장수를 고르세요. 보물을 받으면 받는 장수의 충성이 10 오릅니다.', holders, (o) => Game.itemsOf(o.name).map((it) => it.name).join(', '), (from) => {
          const others = Game.officersIn(pid, S.player).filter((o) => o.name !== from);
          chooseOfficer(`${Game.itemsOf(from)[0].name} 하사`, `누구에게 줄까요?`, others, (o) => `충성 ${o.loyalty}`, (to) => result(Game.bestow(pid, from, to)));
        });
      }
      case 'ships':
        return chooseOfficer('병선 건조', `${Game.COST.ships}금을 들여 배를 띄웁니다(수군 최대 100). 성과는 <b>통솔</b>과 <b>지력</b>에 좌우됩니다. 수군은 공수 양쪽에서 강 도하와 해로를 결정합니다.`, idle, (o) => `≈ +${Math.floor(o.ldr / 6 + o.int / 10 + 2)}`, (n) => result(Game.buildShips(pid, n)));
      case 'transfer': return transferDialog(pid);
      case 'attack': return attackDialog(pid, null);
      case 'openBattle': return openBattle(pid);
      case 'site': return siteDialog(pid);
      case 'repair': return chooseOfficer('외성 시설 재건', '장수가 재건을 감독합니다. 건설 비용의 절반이 듭니다.', Game.idleOfficers(pid), () => '', (n) => result(Game.repairSite(pid, n, +data.i)));
      case 'reinforce': return reinforceDialog(pid, data.target);
      case 'attackFrom': return attackDialog(data.from, pid);
    }
  }

  function plotDialog(pid) {
    const S = Game.state();
    const targets = Game.plotTargets(pid);
    const idle = Game.idleOfficers(pid).sort((a, b) => b.int - a.int);
    const kinds = [['spy', '정찰', '도시의 상태, 가장 충성이 낮은 장수, 숨은 보물 소문을 알아냅니다.'], ['unrest', '민심 교란', '소문을 퍼뜨려 치안을 6~30 떨어뜨립니다. 때로 당신에게 추적됩니다.'], ['sabotage', '파괴 공작', '창고를 불태우고 성벽을 허뭅니다. 흔히 당신에게 추적됩니다.'], ['incite', '이반 선동', '불충한 장수를 돌려세웁니다; 넘어오면 이곳에서 당신에게 합류합니다. 대상 장수 필요.'], ['assassinate', '암살', '장수를 죽입니다. 성공률 낮음; 요원이 잡히면 온 천하가 당신을 의심합니다. 대상 장수 필요.']];
    const refresh = () => {
      const kind = $('#pl-kind').value, t = $('#pl-target').value;
      const offs = Game.prov(t).owner ? Game.officersIn(t, Game.prov(t).owner) : [];
      const needOfficer = kind === 'incite' || kind === 'assassinate';
      $('#pl-officer-row').hidden = !needOfficer;
      $('#pl-officer').innerHTML = offs.map((o) => `<option value="${esc(o.name)}">${esc(o.name)} · 충성 ${o.loyalty} · 통솔 ${o.ldr}${Game.isRuler(o) ? ' (군주)' : ''}</option>`).join('');
      $('#pl-desc').textContent = kinds.find((k) => k[0] === kind)[2] + ` 비용 ${Game.COST.plots[kind]}금.`;
    };
    openModal(`<h3>${esc(Game.pname(pid))}에서의 계략</h3>
      <div class="row"><label>대상 도시</label><select id="pl-target" style="flex:1">${targets.map((t) => `<option value="${t.id}">${esc(Game.pname(t.id))} — ${esc(Game.fname(t.owner))} · 치안 ${t.order}</option>`).join('')}</select></div>
      <div class="row"><label>계략</label><select id="pl-kind" style="flex:1">${kinds.map((k) => `<option value="${k[0]}">${k[1]} (${Game.COST.plots[k[0]]}금)</option>`).join('')}</select></div>
      <div class="row" id="pl-officer-row" hidden><label>대상</label><select id="pl-officer" style="flex:1"></select></div>
      <p class="hint" id="pl-desc"></p>
      <p class="hint">요원 (<b>지력</b> 높은 순; 계략 특기가 도움; 변설가가 선동을 더 잘함):</p>${pickList(idle)}
      <div class="modal-actions"><button data-act="cancel">취소</button><button class="btn btn-gold" data-act="ok">계략 실행</button></div>`, {
      cancel: closeModal, oninput: refresh,
      ok: () => { const n = picked()[0]; if (!n) return; const r = Game.plot(pid, n, $('#pl-target').value, $('#pl-kind').value, $('#pl-officer').value); if (!r.ok) { result(r); return; } closeModal(); renderAll(); showResult(r.msg, () => {}); },
    });
    refresh();
  }

  function handleTitle(done) {
    const S = Game.state(); const pt = S.pendingTitle;
    if (!pt || pt.fid !== S.player) { done(); return; }
    const t = TITLES[pt.tier];
    openModal(`<h3>손에 닿는 칭호</h3>
      <p>당신의 위세와 ${Game.factionProvinces(S.player).length}개 도시는 <b>${esc(t.name)}</b> 칭호에 걸맞습니다. 이를 취하면 사신·등용에 정통성이 더해지고 장수 ${t.slots === 99 ? '무제한' : t.slots}명을 둘 수 있습니다${pt.tier === 4 ? '. 그러나 제위에 오름은 천하의 정통을 자처하는 것이니, 모든 세력이 당신을 참칭자라 부를 것입니다' : '. 다만 다른 세력들이 그 주제넘음을 조금 못마땅해할 것입니다'}.</p>
      <div class="modal-actions"><button data-act="no">아직</button><button class="btn btn-gold" data-act="yes">칭호를 취함</button></div>`, {
      yes: () => { const r = Game.assumeTitle(S.player, pt.tier); renderAll(); showResult(r.msg, done); },
      no: () => { S.pendingTitle = null; closeModal(); done(); },
    }, true);
  }

  function buyFoodDialog(pid) {
    const p = Game.prov(pid);
    const rateFor = (g) => (g > 2000 ? 3 : g > 800 ? 4 : 5);
    const refresh = () => {
      const g = Math.max(0, Math.min(+$('#bf-gold').value || 0, p.gold));
      $('#bf-out').textContent = `${fmt(g)}금 → 식량 ${fmt(g * rateFor(g))} (비율 ${rateFor(g)}:1)`;
    };
    openModal(`<h3>${esc(Game.pname(pid))} 군량 구입</h3>
      <p>상인이 금을 받고 곡식을 팝니다. 소량은 금당 식량 5, 대량은 4나 3입니다. 장수는 필요 없습니다.</p>
      <div class="row"><label>금</label><input type="number" id="bf-gold" min="1" max="${p.gold}" value="${Math.min(500, p.gold)}"><span class="max">보유 ${fmt(p.gold)}</span></div>
      <div class="row"><label>받는 식량</label><span id="bf-out"></span></div>
      <div class="modal-actions"><button data-act="cancel">취소</button><button class="btn btn-gold" data-act="ok">구입</button></div>`, {
      cancel: closeModal,
      oninput: refresh,
      ok: () => { const res = Game.buyFood(pid, +$('#bf-gold').value); if (res.ok) closeModal(); result(res); },
    });
    refresh();
  }

  function transferDialog(pid) {
    const S = Game.state();
    const p = Game.prov(pid);
    const dests = Game.neighbors(pid).filter((n) => n.owner === S.player);
    const idle = Game.idleOfficers(pid);
    openModal(`<h3>${esc(Game.pname(pid))}에서 이동</h3>
      <div class="row"><label>목적지</label><select id="tr-dest">${dests.map((d) => `<option value="${d.id}">${esc(Game.pname(d.id))} (병력 ${fmt(d.troops)})</option>`).join('')}</select></div>
      <div class="row"><label>병력</label><input type="number" id="tr-troops" min="0" max="${p.troops}" value="0"><span class="max">최대 ${fmt(p.troops)}</span></div>
      <div class="row"><label>금</label><input type="number" id="tr-gold" min="0" max="${p.gold}" value="0"><span class="max">최대 ${fmt(p.gold)}</span></div>
      <div class="row"><label>식량</label><input type="number" id="tr-food" min="0" max="${p.food}" value="0"><span class="max">최대 ${fmt(p.food)}</span></div>
      <p class="hint">이동할 장수 (병력은 호위 장수가 최소 1명 필요):</p>
      ${pickList(idle, { multi: true, max: 99 })}
      <div class="modal-actions"><button data-act="cancel">취소</button><button class="btn btn-gold" data-act="ok">이동</button></div>`, {
      cancel: closeModal,
      ok: () => {
        const res = Game.transfer(pid, $('#tr-dest').value, {
          troops: +$('#tr-troops').value, gold: +$('#tr-gold').value, food: +$('#tr-food').value, officers: picked(),
        });
        if (res.ok) closeModal();
        result(res);
      },
    });
  }

  function estimate(fromId, toId, names, troops) {
    const from = Game.prov(fromId), to = Game.prov(toId);
    const att = names.map(Game.off);
    const def = to.owner ? Game.officersIn(toId, to.owner) : [];
    const mx = (l, k, d) => (l.length ? Math.max(...l.map((o) => o[k])) : d);
    const m = Game.battleModifiers(fromId, toId);
    const aPow = troops * (1 - m.loss) * (0.5 + mx(att, 'war', 50) / 100) * (0.7 + mx(att, 'ldr', 50) / 250) * (0.7 + from.training / 300) * m.att;
    const dPow = to.troops * (0.5 + mx(def, 'war', to.owner ? 40 : 50) / 100) * (0.7 + mx(def, 'ldr', to.owner ? 40 : 50) / 250) * (0.7 + to.training / 300) * (1 + to.defense / 1000) * m.def;
    const r = dPow > 0 ? aPow / dPow : 9;
    const label = r > 2.2 ? ['압도적', 'var(--green)'] : r > 1.5 ? ['우세', '#9fd69f'] : r > 1.1 ? ['약간 우세', 'var(--gold2)'] : r > 0.8 ? ['대등 — 위험', '#ffb86b'] : ['불리', '#e29a8f'];
    return `<span style="color:${label[1]}">${label[0]}</span> <small style="color:var(--muted)">(전력비 ${r.toFixed(2)})</small>${m.notes.length ? `<div class="hint">${m.notes.map(esc).join('<br>')}</div>` : ''}`;
  }

  function attackDialog(fromId, presetTarget) {
    const S = Game.state();
    const p = Game.prov(fromId);
    const targets = Game.enemyNeighbors(fromId).filter((n) => Game.canAttack(S.player, n.owner) && !Game.battleModifiers(fromId, n.id).blocked);
    const closed = Game.enemyNeighbors(fromId).filter((n) => Game.canAttack(S.player, n.owner) && Game.battleModifiers(fromId, n.id).blocked);
    const idle = Game.idleOfficers(fromId);
    const defaultTroops = Math.floor(p.troops * 0.7);
    const targetHtml = (t) => {
      const def = t.owner ? Game.officersIn(t.id, t.owner) : [];
      return `<option value="${t.id}" ${t.id === presetTarget ? 'selected' : ''}>${esc(Game.pname(t.id))} — ${esc(Game.fname(t.owner))} · 병력 ${fmt(t.troops)} · 성벽 ${t.defense}${def.length ? ` · ${def.map((o) => o.name).join(', ')}` : ''}</option>`;
    };
    const refresh = () => {
      const t = $('#at-target').value;
      const n = Math.min(+$('#at-troops').value, p.troops);
      $('#at-troops-range').value = n;
      $('#at-est').innerHTML = picked().length ? estimate(fromId, t, picked(), n) : '<span class="hint">지휘관을 고르세요.</span>';
      const to = Game.prov(t);
      const def = to.owner ? Game.officersIn(t, to.owner) : [];
      $('#at-def').innerHTML = def.length ? officerTable(def) : '<div class="hint">주둔군만 수비합니다.</div>';
    };
    openModal(`<h3>${esc(Game.pname(fromId))}에서 출병</h3>
      <div class="row"><label>목표</label><select id="at-target" style="flex:1">${targets.map(targetHtml).join('')}</select></div>
      ${closed.length ? `<div class="hint">이 계절 통행 불가: ${closed.map((n) => `${esc(Game.pname(n.id))} (${esc(Game.battleModifiers(fromId, n.id).blocked)})`).join('; ')}</div>` : ''}
      <div id="at-def"></div>
      <p class="hint">지휘관 (최대 3명). 전투에선 가장 높은 무력·통솔이, 계략은 가장 높은 지력이 작용합니다.</p>
      ${pickList(idle, { multi: true, max: 3 })}
      <div class="row"><label>병력</label><input type="number" id="at-troops" min="1" max="${p.troops}" value="${defaultTroops}"><span class="max">보유 ${fmt(p.troops)} · 군량 ${fmt(defaultTroops * 0.1)} 소모</span></div>
      <input type="range" id="at-troops-range" min="1" max="${p.troops}" value="${defaultTroops}">
      <div class="row"><label>전법</label><select id="at-stance" style="flex:1"><option value="standard">정공</option><option value="assault">강습 · 전력 ×1.15, 손실 ×1.2</option><option value="siege">공성 · 성벽 효과 30%↓, ×0.9, 장기전</option><option value="feint">양동 · 계략 확률 2배, ×0.92</option></select></div>
      <div class="row"><label>계략</label><select id="at-strat" style="flex:1"><option value="auto">임기응변 (유능한 지휘관이 있어야 효과)</option><option value="fire">화공 · 한 번 큰 타격, 겨울엔 불가</option><option value="flood">수공 · 수군 40+로 강 도하</option><option value="discord">이간계 · 전투 전 불충한 수비장을 돌려세움</option></select></div>
      <div class="hint">계략은 지력 75 이상 지휘관이 필요하며, 계략 특기가 도움이 됩니다.</div>
      <div class="row"><label>전망</label><span id="at-est"></span></div>
      <div class="modal-actions"><button data-act="cancel">취소</button><button class="btn btn-gold" data-act="ok">진군!</button></div>`, {
      cancel: closeModal,
      onpick: refresh,
      oninput: (e) => {
        if (e.target.id === 'at-troops-range') $('#at-troops').value = e.target.value;
        refresh();
      },
      ok: () => {
        const res = Game.attack(fromId, $('#at-target').value, picked(), +$('#at-troops').value, { stance: $('#at-stance').value, stratagem: $('#at-strat').value });
        if (!res.ok) { result(res); return; }
        closeModal();
        renderAll();
        if (res.battle) { messengerDialog(res.battle, () => openBattle(res.battle)); return; }
        showBattle(res.report, () => handleCaptives(renderAll));
      },
    });
    refresh();
  }

  // ---------- battle report ----------
  function showBattle(R, onClose) {
    const S = Game.state();
    const attackerWon = R.result === 'captured' || R.result === 'raided';
    const playerWon = (R.attacker === S.player && attackerWon) || (R.defender === S.player && !attackerWon);
    const involved = R.attacker === S.player || R.defender === S.player;
    const banner = involved ? `<div class="result-banner ${playerWon ? 'win' : 'lose'}">${playerWon ? '승리!' : '패배'}</div>` : '';
    openModal(`<h3>${esc(Game.pname(R.to))} 전투</h3>
      ${banner}
      <div class="battle">
        <div class="rounds">${R.lines.map((l) => `<div class="${l.cls}">${esc(l.text)}</div>`).join('')}</div>
        <div>공격: ${fmt(R.startA)} → ${fmt(R.endA)} &nbsp;·&nbsp; 수비: ${fmt(R.startD)} → ${fmt(R.endD)}</div>
      </div>
      <div class="modal-actions">${R.replay && R.replay.length ? '<button data-act="replay">▶ 전투 보기</button>' : ''}<button class="btn btn-gold" data-act="close">계속</button></div>`, {
      close: () => { closeModal(); if (onClose) onClose(); },
      replay: () => { closeModal(); openReplay(R, () => { if (onClose) onClose(); }); },
    }, true);
  }

  // ---------- captives ----------
  function handleCaptives(done) {
    const S = Game.state();
    const c = S.pendingCaptives.find((x) => x.captor === S.player);
    if (!c) { if (done) done(); return; }
    const o = Game.off(c.name);
    const chance = Math.round(Game.captiveChance(S.player, o) * 100);
    const from = c.from ? Game.fname(c.from) : '무소속';
    const house = c.from && S.factions[c.from] && S.factions[c.from].alive && Game.factionProvinces(c.from).length ? c.from : null;
    const price = Game.ransomPrice(o);
    openModal(`<h3>포로: ${esc(o.name)}</h3>
      <div class="captive-card"><div class="cn">${esc(o.name)}</div><div class="cs">나이 ${Game.age(o)} · 통솔 ${o.ldr} · 무력 ${o.war} · 지력 ${o.int} · 정치 ${o.pol} · 매력 ${o.chr}<br>${esc(from)}를 충성 ${o.loyalty}로 섬겼습니다.</div></div>
      <p>${esc(o.name)}이(가) 사슬에 묶여 당신 앞에 끌려왔습니다. 어찌하시겠습니까?</p>
      <div class="modal-actions">
        <button data-act="release">석방</button>
        <button class="btn-red" data-act="execute">처형</button>
        ${house && !c.ransomRefused ? `<button data-act="ransom" title="${esc(Game.fname(house))}에게 ${fmt(price)}금을 요구합니다; 거절할 수 있습니다">몸값 (${fmt(price)}금)</button>` : ''}
        ${chance > 0 ? `<button class="btn btn-gold" data-act="recruit">등용 (${chance}%)</button>` : `<button disabled title="충성 ${o.loyalty}: 자기 세력이 건재한 동안은 돌아서지 않습니다">등용</button>`}
      </div>`, {
      recruit: () => { const r = Game.resolveCaptive(c.name, 'recruit'); showResult(r.msg, () => handleCaptives(done)); },
      ransom: () => { const r = Game.resolveCaptive(c.name, 'ransom'); renderAll(); showResult(r.msg, () => handleCaptives(done)); },
      release: () => { const r = Game.resolveCaptive(c.name, 'release'); showResult(r.msg, () => handleCaptives(done)); },
      execute: () => { const r = Game.resolveCaptive(c.name, 'execute'); showResult(r.msg, () => handleCaptives(done)); },
    }, true);
  }

  function showResult(msg, next) {
    openModal(`<p style="font-size:15px">${esc(msg)}</p><div class="modal-actions"><button class="btn btn-gold" data-act="ok">계속</button></div>`, { ok: () => { closeModal(); next(); } }, true);
  }

  // ---------- end of month ----------
  function endTurn() {
    const S = Game.state();
    if (S.observer) {
      const notices = Game.endTurn();
      renderAll();
      if (S.over) { stopAuto(); showGameOver(); return; }
      if (autoTimer) return;
      const reps = watchMode() === 'all' ? notices.filter((n) => n.report && n.report.replay && n.report.replay.length).map((n) => n.report) : [];
      playReplays(reps, () => { if (notices.length) showNotices(notices, () => {}); });
      return;
    }
    if (S.pendingCaptives.some((c) => c.captor === S.player)) { handleCaptives(endTurn); return; }
    const unfought = Game.playerBattles().filter((B) => B.dayInMonth < 30);
    if (unfought.length) {
      const B = unfought[0];
      openModal(`<h3>${esc(Game.pname(B.city))} 전투가 아직 끝나지 않았습니다</h3><p>이달에 싸울 날이 ${30 - B.dayInMonth}일 남았습니다. 지금 직접 싸우거나, 월말 전에 장수들에게 맡길 수 있습니다.</p>
        <div class="modal-actions"><button data-act="cancel">돌아가기</button><button data-act="auto">장수에게 맡김</button><button class="btn btn-gold" data-act="fight">⚔ 직접 싸움</button></div>`, { cancel: closeModal, fight: () => { closeModal(); openBattle(B.city); }, auto: () => { closeModal(); Game.battleAutoMonth(B.city); renderAll(); const S2 = Game.state(); const i = S2.notices.findIndex((n) => n.report && n.report.to === B.city); if (i >= 0) { const R = S2.notices.splice(i, 1)[0].report; showBattle(R, endTurn); } else endTurn(); } });
      return;
    }
    const F = S.factions[S.player];
    const idle = F.guest ? Game.factionOfficers(S.player).filter((o) => !o.acted && Game.prov(o.city).owner === F.host).length : Game.factionProvinces(S.player).reduce((s, p) => s + Game.idleOfficers(p.id).length, 0);
    const afterTurn = () => handleDecisions(() => handleTitle(() => handleSuccession(() => handleAid(() => handleProposals(() => handleCaptives(renderAll))))));
    const go = () => {
      const notices = Game.endTurn();
      if (S.factions[S.player].guest) selected = null;
      renderAll();
      if (S.over) { if (notices.length) showNotices(notices, showGameOver); else showGameOver(); return; }
      if (notices.length) showNotices(notices, afterTurn);
      else afterTurn();
    };
    if (idle > 0) {
      openModal(`<h3>이달을 끝낼까요?</h3><p>아직 행동하지 않은 장수가 ${idle}명 있습니다.</p>
        <div class="modal-actions"><button data-act="cancel">돌아가기</button><button class="btn btn-gold" data-act="ok">월 넘기기</button></div>`, { cancel: closeModal, ok: () => { closeModal(); go(); } });
    } else go();
  }

  function showNotices(notices, done) {
    const S = Game.state();
    openModal(`<h3>${esc(Game.dateStr())} — 보고</h3>
      <div class="notices">${notices.map((n, i) => `<div class="n ${n.cls}">${esc(n.text)}${n.report && watchMode() !== 'skip' ? `<button class="btn-sm" data-act="rep" data-i="${i}">전투 보기</button>` : ''}</div>`).join('')}</div>
      <div class="modal-actions"><button class="btn btn-gold" data-act="close">계속</button></div>`, {
      close: () => { closeModal(); done(); },
      rep: (el) => showBattle(notices[+el.dataset.i].report, () => showNotices(notices, done)),
    }, true);
  }

  function showGameOver() {
    const S = Game.state();
    if (S.over === 'observer') {
      openModal(`<div class="gameover"><h2>천하 통일</h2>
        <p>${esc(Game.dateStr())}, ${esc(Game.fname(S.winner))}이(가) 모든 도시를 하나의 깃발 아래 두었습니다. 새 왕조가 시작됩니다.</p>
        <div class="modal-actions" style="justify-content:center"><button data-act="close">계속 보기</button><button class="btn btn-gold" data-act="menu">메뉴로</button></div></div>`, { close: closeModal, menu: () => { closeModal(); backToMenu(); } }, true);
      return;
    }
    const win = S.over === 'victory';
    openModal(`<div class="gameover"><h2>${win ? '천하 통일!' : '가문의 몰락'}</h2>
      <p>${win ? `${esc(Game.dateStr())}, ${esc(Game.fname(S.player))}이(가) 삼한의 모든 도시를 하나의 깃발 아래 두었습니다. 새 왕조가 시작됩니다.` : `${esc(Game.dateStr())}, ${esc(Game.fname(S.player))}의 마지막 도시가 함락되었습니다. 역사는 당신의 분투를 기억할 것입니다.`}</p>
      <div class="modal-actions" style="justify-content:center"><button class="btn btn-gold" data-act="menu">메뉴로</button></div></div>`, { menu: () => { closeModal(); backToMenu(); } }, true);
  }

  // ---------- info screens ----------
  function showOverview() {
    const S = Game.state();
    const rows = Object.values(S.factions).map((f) => {
      const provs = Game.factionProvinces(f.id);
      return { f, cities: provs.length, troops: Game.totalTroops(f.id), gold: provs.reduce((s, p) => s + p.gold, 0), food: provs.reduce((s, p) => s + p.food, 0), offs: Game.factionOfficers(f.id).length, names: provs.map((p) => Game.pname(p.id)).join(', ') };
    }).sort((a, b) => b.cities - a.cities || b.troops - a.troops);
    openModal(`<h3>천하 정세 — ${esc(Game.dateStr())}</h3>
      <table class="overview"><tr><th></th><th>세력</th><th>도시</th><th>병력</th><th>금</th><th>식량</th><th>장수</th><th>위세</th></tr>
      ${rows.map((r) => `<tr><td><span class="chip" style="background:${r.f.color}"></span></td><td class="${r.f.alive ? '' : 'dead'}">${r.f.hasEmperor ? '👑 ' : ''}${esc(r.f.name)}${r.f.id === S.player ? ' (나)' : ''}${(r.f.persona || []).length ? ` <small class="persona">${esc((r.f.persona || []).join(', '))}</small>` : ''}${r.f.phase === 'unifying' ? ' <small class="persona" style="color:#e29a8f" title="천하의 절반을 차지: 어떤 조약도 맺지 않고 기존 조약을 찢으며 통일될 때까지 전방위 공격">천하통일 추진</small>' : r.f.phase === 'hegemon' ? ' <small class="persona" title="최강 세력: 내정에 힘쓰고 2위 세력과 통교하며 작은 이웃을 정리; 나머지가 연합해 대항">패자(霸者)</small>' : r.f.phase === 'consolidating' ? ' <small class="persona" title="최강 세력이 다시 진군하기 전 어수선한 도시의 치안을 정비하며 숨 고르는 중">내실 다지는 중</small>' : Game.leaderHouse() === r.f.id ? ' <small class="persona" title="천하의 1/3을 차지; 나머지가 연합해 대항할 것">선두 세력</small>' : ''}<br><small class="${r.names ? 'cities' : ''}" style="color:var(--muted)">${esc(r.names) || (r.f.alive ? (r.f.guest ? `${esc(Game.fname(r.f.host))}에 의탁 중` : '') : '멸망')}</small></td><td class="num">${r.cities}</td><td class="num">${fmt(r.troops)}</td><td class="num">${fmt(r.gold)}</td><td class="num">${fmt(r.food)}</td><td class="num">${r.offs}</td><td class="num">${r.f.prestige || 0}</td></tr>`).join('')}</table>
      <div class="modal-actions"><button class="btn btn-gold" data-act="close">닫기</button></div>`, { close: closeModal });
  }

  // ---------- officer roster: filterable and sortable ----------
  const roster = { key: 'war', dir: -1, q: '', house: '' };
  function rosterTable(list, all) {
    const cols = [['name', '이름'], ['age', '나이'], ['ldr', '통솔'], ['war', '무력'], ['int', '지력'], ['pol', '정치'], ['chr', '매력'], ['loyalty', '충성'], ['city', '도시']];
    if (all) cols.push(['house', '세력']);
    const th = cols.map(([k, l]) => `<th data-act="sort" data-key="${k}" class="sortable${roster.key === k ? ' sorted' : ''}" title="${l} 기준 정렬">${l}${roster.key === k ? (roster.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('');
    if (!list.length) return `<table class="off"><tr>${th}${all ? '' : '<th></th>'}</tr></table><div class="hint">해당하는 장수가 없습니다.</div>`;
    return `<table class="off"><tr>${th}${all ? '' : '<th></th>'}</tr>${list.map((o) => `<tr class="${o.acted && !all ? 'acted' : ''}">
      <td class="n">${avatar(o)}${Game.isRuler(o) ? '<span class="crown">★</span> ' : ''}${rankTag(o)}${esc(o.name)}${itemBadge(o)}${skillTags(o)}</td><td class="num">${Game.age(o)}</td>
      <td class="num">${o.ldr}</td><td class="num">${o.war}</td><td class="num">${o.int}</td><td class="num">${o.pol}</td><td class="num">${o.chr}</td>
      <td class="num ${loyClass(o.loyalty)}">${Game.isRuler(o) ? '—' : o.loyalty}</td><td>${esc(Game.pname(o.city))}</td>
      ${all ? `<td><span class="chip" style="background:${Game.fac(o.faction).color}"></span> ${esc(Game.fname(o.faction))}</td>` : `<td>${o.acted ? '완료' : ''}</td>`}</tr>`).join('')}</table>`;
  }

  function showOfficers() {
    const S = Game.state();
    const all = S.observer;
    const base = () => Object.values(S.officers).filter((o) => !o.captive && (all ? o.faction : o.faction === S.player));
    const houses = all ? Object.values(S.factions).filter((f) => f.alive).sort((a, b) => a.name.localeCompare(b.name)) : [];
    const render = () => {
      const q = roster.q.trim().toLowerCase();
      const list = base().filter((o) => (!roster.house || o.faction === roster.house) &&
        (!q || o.name.toLowerCase().includes(q) || Game.pname(o.city).toLowerCase().includes(q) || (o.faction && Game.fname(o.faction).toLowerCase().includes(q))));
      const k = roster.key;
      const val = (o) => k === 'age' ? Game.age(o) : k === 'city' ? Game.pname(o.city) : k === 'house' ? Game.fname(o.faction) : k === 'loyalty' ? (Game.isRuler(o) ? 101 : o.loyalty) : o[k];
      list.sort((a, b) => { const va = val(a), vb = val(b); const c = typeof va === 'string' ? va.localeCompare(vb) : va - vb; return c * roster.dir || a.name.localeCompare(b.name); });
      $('#roster-body').innerHTML = rosterTable(list, all);
      $('#roster-count').textContent = `장수 ${list.length}명`;
    };
    openModal(`<h3>${all ? '천하의 장수' : `${esc(Game.fname(S.player))}의 장수`}</h3>
      <div class="roster-controls">
        <input type="text" id="roster-q" placeholder="이름·도시${all ? '·세력' : ''}로 검색…" value="${esc(roster.q)}">
        ${all ? `<select id="roster-house"><option value="">모든 세력</option>${houses.map((f) => `<option value="${f.id}" ${roster.house === f.id ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select>` : ''}
        <span id="roster-count" class="hint"></span>
      </div>
      <p class="hint">열 제목을 누르면 정렬, 다시 누르면 역순.</p>
      <div id="roster-body"></div>
      <div class="modal-actions"><button class="btn btn-gold" data-act="close">닫기</button></div>`, {
      close: closeModal,
      sort: (el) => {
        const k = el.dataset.key;
        if (roster.key === k) roster.dir = -roster.dir;
        else { roster.key = k; roster.dir = (k === 'name' || k === 'city' || k === 'house') ? 1 : -1; }
        render();
      },
      oninput: (e) => {
        if (e.target.id === 'roster-q') roster.q = e.target.value;
        if (e.target.id === 'roster-house') roster.house = e.target.value;
        render();
      },
    });
    if (!all) roster.house = '';
    render();
  }

  // ---------- statistics ----------
  function showStats() {
    const S = Game.state();
    const H = S.history;
    const ids = [...new Set(H.flatMap((h) => Object.keys(h.houses)))];
    const alive = Object.values(S.factions).filter((f) => f.alive && !f.raider);
    const chart = (key, title, maxOverride) => {
      if (H.length < 2) return `<div class="hint">${title}: 아직 연도가 부족합니다.</div>`;
      const W = 640, Hh = 220, padL = 36, padB = 24;
      const max = maxOverride || Math.max(1, ...H.flatMap((h) => Object.values(h.houses).map((x) => x[key])));
      const x = (i) => padL + (i / (H.length - 1)) * (W - padL - 10);
      const y = (v) => Hh - padB - (v / max) * (Hh - padB - 10);
      const lines = ids.map((id) => { const pts = H.map((h, i) => (h.houses[id] ? `${x(i).toFixed(1)},${y(h.houses[id][key]).toFixed(1)}` : null)); const segs = []; let cur = []; for (const p of pts) { if (p) cur.push(p); else { if (cur.length > 1) segs.push(cur); cur = []; } } if (cur.length > 1) segs.push(cur); const color = (S.factions[id] || {}).color || '#888'; return segs.map((sg) => `<polyline points="${sg.join(' ')}" fill="none" stroke="${color}" stroke-width="2" opacity="0.9"/>`).join(''); }).join('');
      const ticks = [0, 0.5, 1].map((t) => `<text x="${padL - 4}" y="${y(max * t) + 4}" text-anchor="end" class="ax">${fmt(max * t)}</text><line x1="${padL}" x2="${W - 10}" y1="${y(max * t)}" y2="${y(max * t)}" class="grid"/>`).join('');
      const years = H.map((h, i) => (i % Math.ceil(H.length / 8) === 0 || i === H.length - 1 ? `<text x="${x(i)}" y="${Hh - 6}" text-anchor="middle" class="ax">${h.year}</text>` : '')).join('');
      return `<div class="sec">${title}</div><svg class="chart" viewBox="0 0 ${W} ${Hh}">${ticks}${lines}${years}</svg>`;
    };
    const legend = alive.map((f) => `<span class="lg"><i style="background:${f.color}"></i>${esc(f.name)}</span>`).join(' ');
    const dead = Object.values(S.factions).filter((f) => !f.alive).length;
    openModal(`<h3>통계 — ${esc(Game.dateStr())}</h3>
      <div class="grid2">
        <div class="kv"><span>치른 전투</span><b>${fmt(S.stats.battles)}</b></div><div class="kv"><span>함락한 도시</span><b>${fmt(S.stats.captures)}</b></div>
        <div class="kv"><span>죽은 장수</span><b>${fmt(S.stats.deaths)}</b></div><div class="kv"><span>살아있는 장수</span><b>${Object.keys(S.officers).length}</b></div>
        <div class="kv"><span>건재한 세력</span><b>${alive.length}</b></div><div class="kv"><span>멸망한 세력</span><b>${dead}</b></div>
      </div>
      <div class="legend-bar" style="border:none;background:none;padding:4px 0">${legend}</div>
      ${chart('cities', '연도별 보유 도시', Object.keys(S.provinces).length)}
      ${chart('troops', '연도별 병력', )}
      <div class="modal-actions"><button class="btn btn-gold" data-act="close">닫기</button></div>`, { close: closeModal });
  }

  // ---------- encyclopaedia ----------
  function showWiki(focus) {
    const S = Game.state();
    const names = Object.keys(BIOS).sort();
    const entry = (n) => { const o = S.officers[n]; return `<div class="wiki-entry" id="wiki-${esc(n).replace(/\W/g, '_')}"><b>${esc(n)}</b> <span class="hint">${o ? `${esc(Game.fname(o.faction))}, ${Game.age(o)}세, ${esc(Game.pname(o.city))}` : '이 시대에 살아있지 않음'}</span><div>${esc(BIOS[n])}</div></div>`; };
    const events = EVENTS.filter((e) => !e.minor && !e.repeat).map((e) => `<div class="wiki-entry"><b>${esc(e.title)}</b> <span class="hint">${e.from[0]}–${e.to[0]}${S.eventsFired[e.id] ? ' · 발생함' : ''}</span></div>`).join('');
    const cities = Object.entries(CITY_NOTES).filter(([k, v]) => v && S.provinces[k]).map(([k, v]) => `<div class="wiki-entry"><b>${esc(Game.pname(k))}</b> <span class="hint">${esc(Game.fname(S.provinces[k].owner))}</span><div>${esc(v)}</div></div>`).join('');
    openModal(`<h3>사전</h3>
      <div class="roster-controls"><input type="text" id="wiki-q" placeholder="검색…"><span class="hint" id="wiki-count"></span></div>
      <div class="sec">인물</div><div id="wiki-people">${names.map(entry).join('')}</div>
      <div class="sec">도시</div><div id="wiki-cities">${cities}</div>
      <div class="sec">시대의 사건</div><div id="wiki-events">${events}</div>
      <div class="modal-actions"><button class="btn btn-gold" data-act="close">닫기</button></div>`, {
      close: closeModal,
      oninput: (e) => { if (e.target.id !== 'wiki-q') return; const q = e.target.value.toLowerCase(); let n = 0; $('#modal-box').querySelectorAll('.wiki-entry').forEach((el) => { const show = !q || el.innerText.toLowerCase().includes(q); el.hidden = !show; if (show) n++; }); $('#wiki-count').textContent = `${n}개 항목`; },
    });
    if (focus) { const el = document.getElementById('wiki-' + focus.replace(/\W/g, '_')); if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('wiki-focus'); } }
  }

  // ---------- help ----------
  function showHelp() {
    openModal(`<h3>도움말</h3>
      <div class="sec">단축키</div>
      <table class="overview">
        <tr><td><kbd>Space</kbd> / <kbd>Enter</kbd></td><td>월 넘기기</td><td><kbd>Tab</kbd></td><td>행동 대기 장수가 있는 도시 순회</td></tr>
        <tr><td><kbd>R</kbd></td><td>영토</td><td><kbd>F</kbd></td><td>장수</td></tr>
        <tr><td><kbd>D</kbd></td><td>외교</td><td><kbd>O</kbd></td><td>목표</td></tr>
        <tr><td><kbd>S</kbd></td><td>통계</td><td><kbd>L</kbd></td><td>사전</td></tr>
        <tr><td><kbd>M</kbd></td><td>메뉴 (저장·불러오기·무르기)</td><td><kbd>?</kbd></td><td>이 도움말</td></tr>
        <tr><td><kbd>+</kbd> / <kbd>−</kbd></td><td>확대/축소</td><td><kbd>방향키</kbd>, <kbd>Home</kbd></td><td>지도 이동·맞춤</td></tr>
        <tr><td><kbd>Esc</kbd></td><td>대화창·연대기·측면 패널 닫기</td><td><kbd>H</kbd></td><td>지도를 보기 위해 화면 숨기기/보이기</td></tr>
      </table>
      <div class="sec">화면</div>
      <p class="hint">지도가 화면을 채웁니다: 끌어서 이동, 휠·핀치로 확대; 축소하면 도시는 이름만 표시됩니다. 도시를 누르면 오른쪽에 패널이 열립니다; ×나 Esc로 닫고, 오른쪽 끝의 탭으로 다시 엽니다. 아래 띠는 최신 연대기를 보여주며, 누르면 전체 기록이 열립니다. ≡ 메뉴에 통계·사전·도움말·범례·저장·메인 메뉴가 있습니다.</p>
      <div class="sec">한 달</div>
      <p class="hint">도시의 각 장수는 한 달에 한 번 행동합니다. 농업·상업·축성·훈련은 도시를 키우고; 징병은 병력을 모으며(치안 30 이상 필요); 탐색은 금과 숨은 보물을 찾고; 선정은 치안을 회복하며; 사민은 비워진 땅에 사람을 데려오고; 관등 수여는 관직을 내리며; 계략은 이웃을 상대로 작동하고; 이동은 병력과 물자를 옮기며; 공격은 최대 3명의 지휘관을 전법과 함께(유능한 지휘관이면 계략도) 보냅니다. 각 도시의 수비 방침은 그 패널에서 정합니다. 외교·목표·보물·망명은 각자의 화면이 있습니다.</p>
      <div class="modal-actions"><button class="btn btn-gold" data-act="close">닫기</button></div>`, { close: closeModal });
  }

  function syncWatchOption() { const S = Game.state(); if (S && S.observer) Game.setOption('watchBattles', watchMode() !== 'skip'); }
  function showMenu() {
    openModal(`<h3>메뉴</h3>
      <div class="cmds">
        <button data-act="undo" class="wide" ${Game.canUndo() && !Game.state().observer ? '' : 'disabled'} title="이달에 한 모든 것을 되돌립니다">↶ 이달 무르기</button>
        <button data-act="save">빠른 저장</button>
        <button data-act="load" ${Game.hasSave() ? '' : 'disabled'}>빠른 불러오기</button>
        ${[1, 2, 3].map((n) => { const info = Game.slotInfo(n); return `<button data-act="save${n}">슬롯 ${n} 저장${info ? '' : ' (빈 칸)'}</button><button data-act="load${n}" ${info ? '' : 'disabled'} title="${info ? esc(info.label) : ''}">슬롯 ${n} 불러오기${info ? ': ' + esc(info.label) : ''}</button>`; }).join('')}
        <button class="wide" data-act="hist">${Game.getOption('historicalDeaths') ? '☑' : '☐'} 역사적 사망 재현</button>
        <button class="wide" data-act="tactical" title="헥스 전장에서 공성전을 하루씩 직접 전투; 끄면 전투가 즉시 결정됩니다">${Game.tacticalOn() ? '☑' : '☐'} 헥스맵 전술 전투</button>
        <button class="wide" data-act="watch" title="전투 보고에서 하루 단위 재연을 제공하도록 공성전을 기록">${Game.getOption('watchBattles') ? '☑' : '☐'} 재연용 전투 기록</button>
        <button class="wide" data-act="fog" title="전장에서 아군 주위 2헥스, 성벽·언덕·망루에서 3헥스가 보입니다; 숲·언덕·산의 유닛은 바로 옆에서만 보입니다">${Game.state().options && Game.state().options.fog === false ? '☐' : '☑'} 전투의 전장의 안개</button>
        <button class="wide btn-red" data-act="quit">시작 화면으로 (저장 안 한 진행은 사라짐)</button>
      </div>
      <div class="modal-actions"><button class="btn btn-gold" data-act="close">닫기</button></div>`, {
      close: closeModal,
      save: () => { Game.save(); closeModal(); toast('게임을 저장했습니다.'); },
      undo: () => { if (Game.undoMonth()) { closeModal(); selected = null; renderAll(); toast('이달이 다시 시작됩니다.'); } },
      save1: () => { Game.save(1); closeModal(); toast('슬롯 1에 저장했습니다.'); }, save2: () => { Game.save(2); closeModal(); toast('슬롯 2에 저장했습니다.'); }, save3: () => { Game.save(3); closeModal(); toast('슬롯 3에 저장했습니다.'); },
      load1: () => { if (Game.load(1)) { selected = null; closeModal(); renderAll(); toast('슬롯 1을 불러왔습니다.'); } }, load2: () => { if (Game.load(2)) { selected = null; closeModal(); renderAll(); toast('슬롯 2를 불러왔습니다.'); } }, load3: () => { if (Game.load(3)) { selected = null; closeModal(); renderAll(); toast('슬롯 3을 불러왔습니다.'); } },
      load: () => { if (Game.load()) { selected = null; closeModal(); renderAll(); toast('게임을 불러왔습니다.'); } else { closeModal(); toast('저장본이 예전 지도의 것이라 불러올 수 없습니다.'); } },
      quit: () => { closeModal(); backToMenu(); },
      hist: () => { Game.setOption('historicalDeaths', !Game.getOption('historicalDeaths')); renderLog(); showMenu(); },
      tactical: () => { Game.setOption('tactical', !Game.tacticalOn()); renderLog(); showMenu(); },
      watch: () => { Game.setOption('watchBattles', !Game.getOption('watchBattles')); renderLog(); showMenu(); },
      fog: () => { const S = Game.state(); S.options = S.options || {}; S.options.fog = S.options.fog === false; renderLog(); showMenu(); },
    });
  }


  // ---------- the battle screen ----------
  const BT = { city: null, sel: null, mode: null, replay: null, frame: 0, timer: null, asking: false };
  const UICTX = { officer: (n) => Game.off(n), skill: (n, k) => { const o = Game.off(n); return !!(o && Game.hasSkill(o, k)); } };
  const BT_S = (typeof window !== 'undefined' && window.innerWidth <= 640) ? 30 : 26;
  function initBattleScreen() {
    $('#bt-close').addEventListener('click', closeBattle);
    $('#bt-logtoggle').addEventListener('click', () => $('#battle-screen').classList.toggle('hide-log'));
    $('#bt-help').addEventListener('click', () => openModal(`<h3>전투하기</h3>
      <p class="hint"><b>기본.</b> 한 턴 = 하루. 내 유닛을 누른 뒤 → <b>초록 헥스</b>로 이동(하루 이동력 3; 언덕·숲·개울 2, 늪 3, 길 1), <b>빨간 적</b>을 눌러 공격, <b>금색 성문</b>에 충차를 댑니다. 성문은 성벽 수준에 따라 2~5회 충차(공격측이 벌목장을 점하면 1회 절약)나 수비군 붕괴로 열립니다. 성벽·성문·언덕 위 유닛은 2헥스 밖으로 반격 없이 활을 쏩니다. 사상자는 전력·지휘관·훈련·사기·지형에 좌우되고, 사기나 수가 무너지면 부대가 붕괴하며 장수가 생포될 수 있습니다.</p>
      <p class="hint"><b>진행.</b> 매일 공격측이 먼저 움직입니다. 양군 모두 식량을 먹습니다(공격측은 가져온 군량, 수비측은 도시). 지원 전령은 한 번 보낼 수 있고, 인접 아군 도시·동맹이 진군해 옵니다. 월말까지 결판 안 나면 다음 달로 이어지며, 일반 턴에 인접 도시에서 병력·군량을 더 보낼 수 있습니다. 도시 중심을 점령하거나 수비군을 전멸시키면 승리; 공격측은 언제든 철수할 수 있습니다.</p>
      <p class="hint"><b>일기토.</b> 장수가 있는 부대끼리 맞붙을 때 선봉 장수가 적장에게 일기토를 청할 수 있습니다(AI도 마찬가지, 사기를 조금 잃고 거절 가능). 패자의 병사는 사기를 잃고 패자는 부상·생포·전사합니다. <b>이간 서신.</b> 전장의 가장 지략 높은 장수가 흔들리는 적장(충성 70 미만, 군주·의형제 제외)에게 서신을 보낼 수 있습니다. 금·열세·낮은 사기가 도움이 되며, 넘어온 지휘관은 부대째 데려옵니다.</p>
      <p class="hint"><b>병종.</b> 보병은 전열을 지킵니다. 기병(♞)은 개활지 5헥스 이동, 평지·농지에서 돌격 시 +1/3, 숲·경사·늪에 약하고 성벽에 무력합니다. 궁병(➶)은 어디서든 2헥스(언덕 3) 사격하나 근접에 약합니다. 공성차(⚙)는 공성 특기 장수나 본국 벌목장이 있으면 쓰며, 성문 타격 2배·2헥스 밖 성벽 사격, 근접엔 무력합니다.</p>
      <p class="hint"><b>날씨·야전·화공.</b> 비는 길 밖 이동을 늦추고 활을 재웁니다; 북방 겨울엔 물이 얼어 군대가 얼음을 건너고 배가 묶입니다. 공격측은 야습을 명할 수 있습니다(타격↑, 활 불가, 사기 요동, 일부 길 잃음). 맑은 날 옆의 숲·농지·늪에 불을 지르면 사흘간 바람 따라 번지며 그 안의 적을 몰아내고 태웁니다. <b>전장의 안개.</b> 아군 주위 2헥스(성벽·성문·언덕·망루 3헥스)가 보이고, 숲·언덕·산의 유닛은 바로 옆에서만 보이며, 숨어서 기습하면 +1/3.</p>
      <p class="hint"><b>외성 시설·수군.</b> 광산·촌락·목장·벌목장·선착장·염전·망루·저자가 성 밖에 있습니다. 하루 끝에 그 위에 선 유닛이 점유하며(벌목장=성문 2회 돌파, 망루=거점, 목장=돌격 강화, 선착장=상륙), 공격측은 약탈해 파괴할 수 있습니다. 수군이 있는 도시는 강·바다로 온 군대의 다수, 육로군의 1/3을 승선시킵니다. 배는 바다·강에서 2헥스 사격, 강변 공격에 강하며, 성 밖 빈 해안에 상륙하면 그날이 끝나고 보병이 됩니다.</p>
      <div class="modal-actions"><button class="btn btn-gold" data-act="close">닫기</button></div>`, { close: closeModal }));
    $('#bt-map').addEventListener('click', (e) => {
      if (BT.replay) return;
      const B = Game.battleFor(BT.city); if (!B) return;
      const tok = e.target.closest('[data-unit]');
      if (tok) {
        const u = B.units.find((x) => x.id === +tok.dataset.unit); if (!u) return;
        if (u.side === Game.playerSideOf(B)) { BT.sel = u.id; BT.mode = null; renderBattle(); return; }
        if (BT.sel) {
          const su = B.units.find((x) => x.id === BT.sel); const doAttack = (opts) => { const r = Game.battleAttack(BT.city, BT.sel, u.id, opts); if (!r.ok) toast(r.msg); afterBattleAction(); };
          if (su && BATTLE.canChallenge(B, su, u, UICTX)) {
            const a = BATTLE.champion(B, su, UICTX), d = BATTLE.champion(B, u, UICTX);
            openModal(`<h3>${esc(u.officers[0] ? `${u.officers[0]}의 부대` : '적')} 공격</h3><p>${esc(a.name)} (무력 ${a.war})이(가) 먼저 말을 몰아 나가 양군이 맞붙기 전에 ${esc(d.name)} (무력 ${d.war})에게 일기토를 청할 수 있습니다. 패자의 병사는 사기를 잃고, 패자는 부상·생포·전사할 수 있습니다; 적은 응하지 않을 수 있으나 그 병사들이 수치를 느낍니다.</p>
              <div class="modal-actions"><button data-act="cancel">취소</button><button data-act="duel">⚔ 일기토 후 공격</button><button class="btn btn-gold" data-act="attack">공격</button></div>`, { cancel: closeModal, duel: () => { closeModal(); doAttack({ duel: true }); }, attack: () => { closeModal(); doAttack({}); } });
            return;
          }
          doAttack({});
        }
        return;
      }
      const hl = e.target.closest('.hl');
      if (hl && BT.sel) {
        const c = +hl.dataset.c, r = +hl.dataset.r;
        const res = hl.classList.contains('fire') ? Game.battleFire(BT.city, BT.sel, c, r) : hl.classList.contains('ram') ? Game.battleRam(BT.city, BT.sel, c, r) : Game.battleMove(BT.city, BT.sel, c, r);
        BT.mode = null; if (!res.ok) toast(res.msg); afterBattleAction();
      }
    });
    $('#bt-actions').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return; const act = b.dataset.act;
      if (BT.replay) { replayControl(act); return; }
      const B = Game.battleFor(BT.city); if (!B) { closeBattle(); return; }
      if (act === 'end') { const r = Game.battleEndDay(BT.city); afterBattleAction(r.msg !== 'challenge'); }
      else if (act === 'suborn') subornDialog();
      else if (act === 'fire') { BT.mode = BT.mode === 'fire' ? null : 'fire'; renderBattle(); }
      else if (act === 'night') { const r = Game.battleNight(BT.city); toast(r.msg); renderBattle(); }
      else if (act === 'sack') { const r = Game.battleSack(BT.city, BT.sel); if (!r.ok) toast(r.msg); afterBattleAction(); }
      else if (act === 'auto') { Game.battleEndDay(BT.city, true); afterBattleAction(true); }
      else if (act === 'month') { Game.battleAutoMonth(BT.city); afterBattleAction(true); }
      else if (act === 'msg') messengerDialog(BT.city, renderBattle);
      else if (act === 'withdraw') openModal(`<h3>철수할까요?</h3><p>${Game.playerSideOf(B) === 'A' ? '공성을 포기하고 군대는 가진 것을 챙겨 본거지로 돌아갑니다.' : '수비군이 밤을 틈타 빠져나가고 도시를 잃습니다.'}</p><div class="modal-actions"><button data-act="cancel">머무름</button><button class="btn btn-red" data-act="ok">철수</button></div>`, { cancel: closeModal, ok: () => { closeModal(); Game.battleWithdraw(BT.city); afterBattleAction(true); } });
    });
  }
  function afterBattleAction(dayEnded = false) {
    const B = Game.battleFor(BT.city);
    if (!B) {   // the battle ended: show the report
      const S = Game.state(); const i = S.notices.findIndex((x) => x.report && x.report.to === BT.city); const n = i >= 0 ? S.notices.splice(i, 1)[0] : null;
      closeBattle(); renderAll();
      if (n) showBattle(n.report, () => handleCaptives(renderAll)); else handleCaptives(renderAll);
      return;
    }
    if (dayEnded && B.dayInMonth < 30) Game.battleBeginDay(BT.city);
    if (!Game.battleFor(BT.city)) { afterBattleAction(); return; }
    renderBattle();
  }
  function openBattle(city) {
    const B = Game.battleFor(city); if (!B) return;
    BT.city = city; BT.sel = null; BT.mode = null; BT.replay = null;
    // a defending player decides before the first day whether to hold the walls or march out
    if (Game.playerSideOf(B) === 'D' && B.day === 0 && !B.lastBlood && !B.sallyAsked) {
      B.sallyAsked = true; $('#battle-screen').hidden = false; renderBattle();
      const go = (field) => { const r = Game.battleSally(city, field); closeModal(); if (!r.ok) toast(r.msg); openBattle(city); };
      openModal(`<h3>적이 ${esc(Game.pname(city))}에 접근합니다</h3><p>${esc(Game.fname(B.attF))}이(가) 병력 ${fmt(BATTLE.sideTroops(B, 'A'))}을(를) 이끌고 아군 ${fmt(BATTLE.sideTroops(B, 'D'))}에 맞서 진격해 옵니다. 지형과 석벽이 지켜주는 성벽을 사수하시겠습니까, 아니면 기병과 수적 기동을 살려 성 밖으로 나가 야전으로 맞서시겠습니까?</p>
        <div class="modal-actions"><button data-act="hold">성벽 사수</button><button class="btn btn-gold" data-act="field">⚔ 성 밖 출진</button></div>`, { hold: () => go(false), field: () => go(true) }, true);
      return;
    }
    if (Game.playerSideOf(B) && B.phase !== 'player' && !B.over && B.dayInMonth < 30) Game.battleBeginDay(city);
    if (!Game.battleFor(city)) { afterBattleAction(); return; }
    $('#battle-screen').hidden = false;
    renderBattle();
  }
  function closeBattle() { if (BT.timer) clearInterval(BT.timer); BT.timer = null; $('#battle-screen').hidden = true; BT.city = null; BT.replay = null; renderAll(); }
  const unitColor = (fid) => (fid && Game.state().factions[fid] ? Game.state().factions[fid].color : FREE_COLOR);
  function renderBattle() {
    const S = Game.state(); const B = Game.battleFor(BT.city); if (!B) return;
    const ps = Game.playerSideOf(B); const m = HEXMAPS[B.city];
    // the banner over the heart flies for whoever holds it: the defender until the besiegers stand on it, and back again if they are driven off
    const heartFid = (B.heartHolder || 'D') === 'A' ? B.attF : B.defF;
    const ownerOf = (id) => { const o = id === B.city ? heartFid : S.provinces[id] && S.provinces[id].owner; return o && S.factions[o] ? S.factions[o] : null; };
    const { svg, W, H } = HEXVIEW.render(B.city, BT_S, true, { tints: true, coords: false, ownerOf, ownerColor: (id) => { const f = ownerOf(id); return f ? f.color : FREE_COLOR; } });
    let extra = HEXVIEW.fireSvg(B.fires, B.burnt, BT_S);
    const sel = BT.sel ? B.units.find((u) => u.id === BT.sel) : null;
    if (sel && sel.side === ps && B.phase === 'player') {
      if (BT.mode === 'fire') extra += HEXVIEW.highlightSvg(BATTLE.fireTargets(B, sel), BT_S, 'fire');
      else {
        extra += HEXVIEW.highlightSvg(BATTLE.canReach(B, sel).map((d) => [d.c, d.r]), BT_S, 'move');
        if (!sel.acted) { extra += HEXVIEW.highlightSvg(BATTLE.targetsFor(B, sel).map((v) => [v.c, v.r]), BT_S, 'attack'); extra += HEXVIEW.highlightSvg(BATTLE.rammableFor(B, sel), BT_S, 'ram'); }
      }
    }
    if (B.fights && B.fights.length) extra += HEXVIEW.flashSvg(B.fights, BT_S);
    let fogged = [];
    if (ps && B.fog) for (let r = 0; r < m.h; r++) for (let c = 0; c < m.w; c++) if (!BATTLE.hexVisible(B, ps, c, r)) fogged.push([c, r]);
    // broken gates
    for (const [k, hits] of Object.entries(B.gates)) if (hits >= BATTLE.GATE_HITS) { const [c, r] = k.split(',').map(Number); const [cx, cy] = HEXVIEW.centre(c, r, BT_S); extra += `<text class="glyph" x="${cx}" y="${cy + 4}" text-anchor="middle" style="font-size:11px;fill:#ff8a7a">✕</text>`; }
    const units = B.units.filter((u) => !ps || u.side === ps || BATTLE.visibleTo(B, ps, u)).map((u) => ({ ...u, color: unitColor(u.fid) }));
    const pad = 96; const el = $('#bt-map'); el.setAttribute('viewBox', `${-pad} ${-40} ${W + 2 * pad} ${H + 80}`); el.innerHTML = svg + HEXVIEW.sitesSvg(B.sites, BT_S, (st) => unitColor(st.holder === 'A' ? B.attF : B.defF)) + extra + (fogged.length ? HEXVIEW.fogSvg(fogged, BT_S) : '') + HEXVIEW.unitsSvg(units, BT_S, BT.sel);
    $('#bt-title').textContent = `${Game.pname(B.city)} 공성전`; $('#bt-title').title = `성벽 ${B.walls || 0}: 성문은 충차 ${BATTLE.gateHits(B)}회 공격 시 파괴`;
    $('#bt-day').textContent = `${B.day}일째${B.dayInMonth ? ` (이달 ${B.dayInMonth}일)` : ''}${B.weather === 'rain' ? ' · ☔ 비' : B.weather === 'snow' ? ' · ❄ 눈' : ''}${B.night ? ' · 🌙 야간' : ''}${BATTLE.encircled(B) ? ' · 포위됨' : ''}${B.field ? ' · 야전' : ''}${B.over ? ' · 결판남' : B.phase === 'player' ? ' · 명령 대기' : ''}`;
    const eatA = Math.ceil(BATTLE.sideTroops(B, 'A') * BATTLE.FOOD_PER_MAN_DAY);
    $('#bt-food').textContent = `성벽 ${B.walls || 0} (충차 ${BATTLE.gateHits(B)}회) · 공격군 군량 ${fmt(Math.floor(B.att.food))} (${eatA ? Math.floor(B.att.food / eatA) : '∞'}일분) · 도시 군량 ${fmt(S.provinces[B.city].food)}`;
    const sideRow = (side, name) => { const us = BATTLE.sideUnits(B, side); const arriving = B.arrivals.filter((a) => a.side === side && !a.done); return `<div class="side"><span><span class="chip" style="background:${unitColor(side === 'A' ? B.attF : B.defF)}"></span> ${esc(name)}${ps === side ? ' (아군)' : ''}</span><b>${us.length}개 부대 · ${fmt(BATTLE.sideTroops(B, side))}${arriving.length ? ` · +${fmt(arriving.reduce((a, x) => a + x.troops, 0))} 지원군 (${Math.min(...arriving.map((x) => x.day))}일 도착)` : ''}</b></div>`; };
    $('#bt-sides').innerHTML = sideRow('A', Game.fname(B.attF)) + sideRow('D', B.defF ? Game.fname(B.defF) : '성내 민병');
    if (sel) { const t = BATTLE.terrainAt(B, sel.c, sel.r); $('#bt-unit').innerHTML = `<div class="u-name">${sel.officers.length ? sel.officers.map((n) => esc(n) + (B.wounded && B.wounded[n] ? ' <small class="hint">(부상)</small>' : '')).join(', ') : '지휘관 없는 부대'} <small class="hint">(${sel.side === 'A' ? Game.fname(sel.fid) : Game.fname(sel.fid)})</small></div><div>병력 ${fmt(sel.troops)} ${sel.naval ? '함선 탑승' : { cav: '기병', arc: '궁병', eng: '공성대' }[sel.kind] || '보병'}${sel.naval ? ` (함대 ${sel.fleet || 0})` : ''} · 사기 ${sel.morale} · 훈련 ${sel.training} · 지형 ${HEXVIEW.TERRAIN[t].name}${B.burnt && B.burnt[`${sel.c},${sel.r}`] ? ' (화재)' : ''}${BATTLE.defenceBonus(B, sel) ? ` (+${Math.round(BATTLE.defenceBonus(B, sel) * 100)}% 방어)` : ''}</div><div class="hint">${sel.side === ps ? `이동력 ${sel.mp} 남음 · ${sel.acted ? '오늘 교전함' : '교전 가능'}. 초록 헥스는 이동, 붉은 적군은 공격, 황금 성문은 충차 돌격.${sel.kind && sel.kind !== 'inf' && !sel.naval ? ' ' + BATTLE.KINDS[sel.kind].desc : ''}${sel.naval ? ' 함선은 바다·호수·강을 1포인트당 1헥스 항해하고 사거리 2헥스로 사격하며, 빈 해안에 상륙(행동 종료)할 수 있습니다.' : ''}${(() => { const tp = BATTLE.temperOf(B, sel, UICTX); const cmd = BATTLE.commanderOf(B, sel, UICTX); if (tp !== 'unled' && cmd) return ` <b>${BATTLE.TEMPERS[tp].label}</b> (${esc(cmd.name)}): ${BATTLE.TEMPERS[tp].desc}`; const pl = BATTLE.planOf(B, sel.side, UICTX); return pl !== 'unled' ? ` <b>지휘관 없음</b>: 총대장의 방침에 따라 <b>${BATTLE.TEMPERS[pl].label}</b>으로 싸웁니다.` : ''; })()}${(() => { const st = BATTLE.siteAt(B, sel.c, sel.r); return st ? ` ${SITE_TYPES[st.type].label} 위치${st.damaged ? ' (파괴됨)' : ''}, 점령 세력: ${st.holder === 'A' ? Game.fname(B.attF) : B.defF ? Game.fname(B.defF) : '도시'}.` : ''; })()}` : '적 부대입니다. 아군 부대를 선택해 공격하십시오.'}</div>`; }
    else $('#bt-unit').innerHTML = `<div class="hint">${ps ? (B.phase === 'player' ? '아군 부대를 클릭하여 명령을 내리십시오.' : '오늘의 행동이 끝났습니다. 하루를 종료하십시오.') : '공성전을 관전 중입니다.'}</div>`;
    const canAct = ps && !B.over && B.dayInMonth < 30;
    $('#bt-actions').innerHTML = ps ? `
      <button class="btn-gold" data-act="end" ${canAct ? '' : 'disabled'}>하루 종료 ▶</button>
      <button data-act="auto" ${canAct ? '' : 'disabled'} title="이날의 명령을 장수에게 맡깁니다">자동(하루)</button>
      <button data-act="month" ${canAct ? '' : 'disabled'} title="남은 달을 장수가 싸웁니다">월말까지 자동</button>
      <button data-act="msg" ${!B.over && !B[ps === 'A' ? 'att' : 'def'].asked ? '' : 'disabled'} title="인접 도시와 동맹에 지원을 요청">✉ 전령</button>
      <button data-act="suborn" ${canAct && B.phase === 'player' ? '' : 'disabled'} title="흔들리는 적장에게 서신과 금">✉ 회유</button>
      ${sel && sel.side === ps && BATTLE.fireTargets(B, sel).length ? `<button data-act="fire" class="${BT.mode === 'fire' ? 'mode' : ''}" title="이 유닛 옆의 숲·농지·늪에 불을 지릅니다(비·눈·야간 불가)">🔥 방화${BT.mode === 'fire' ? ': 헥스 선택' : ''}</button>` : ''}
      ${ps === 'A' && canAct ? `<button data-act="night" ${B.att.nightNext || B.night ? 'disabled' : ''} title="내일 군대가 어둠 속에 공격: 타격↑, 활 불가, 사기 요동, 일부 길 잃음">🌙 ${B.att.nightNext ? '야습 명령됨' : '야습'}</button>` : ''}
      ${sel && BATTLE.sackable(B, sel) && sel.side === ps ? `<button class="wide btn-red" data-act="sack" title="이 유닛이 선 외성 시설을 불태웁니다: 군대엔 약탈품, 도시엔 파괴">🔥 ${esc(SITE_TYPES[BATTLE.siteAt(B, sel.c, sel.r).type].label)} 약탈</button>` : ''}
      <button class="btn-red" data-act="withdraw" ${B.over ? 'disabled' : ''}>철수</button>${B.dayInMonth >= 30 && !B.over ? '<div class="hint wide" style="grid-column:span 2">이달 서른 날을 다 싸웠습니다. 지도에서 월을 넘기면 공성은 다음 달로 이어집니다.</div>' : ''}` : `<div class="hint" style="grid-column:span 2">AI 공성전 진행 중; 월말에 결판납니다.</div>`;
    if (B.pendingChallenge && ps && !BT.asking) {
      const cu = B.units.find((x) => x.id === B.pendingChallenge.u), cv = B.units.find((x) => x.id === B.pendingChallenge.v);
      const a = cu && BATTLE.champion(B, cu, UICTX), d = cv && BATTLE.champion(B, cv, UICTX);
      if (a && d) {
        BT.asking = true;
        const answer = (yes) => { BT.asking = false; const r = Game.battleAnswerChallenge(BT.city, yes); closeModal(); const B2 = Game.battleFor(BT.city); afterBattleAction(!!(B2 && B2.phase === 'idle') || r.msg === 'over'); };
        openModal(`<h3>일기토 신청!</h3><p>${esc(Game.fname(cu.fid))}의 ${esc(a.name)}(무력 ${a.war})이(가) 진 앞으로 나와 ${esc(d.name)}(무력 ${d.war})에게 일기토를 신청했습니다. 거절하면 아군 사기가 꺾이고, 수락하면 패자의 군대는 사기를 크게 잃으며 부상·포로·전사의 위험이 따릅니다.</p>
          <div class="modal-actions"><button data-act="no">거절</button><button class="btn btn-gold" data-act="yes">⚔ 수락</button></div>`, { no: () => answer(false), yes: () => answer(true) }, true);
      } else { Game.battleAnswerChallenge(BT.city, false); }
    }
    const byDay = {}; for (const l of B.log.slice(-160)) (byDay[l.day] = byDay[l.day] || []).push(l);
    $('#bt-log').innerHTML = Object.keys(byDay).sort((a, b) => b - a).map((d) => `<div class="day-head">${d}일째</div>` + byDay[d].map((l) => `<div class="${l.cls}">${esc(l.text)}</div>`).join('')).join('');
  }
  // raise an outstation: the kinds the ground allows, with cost and effect
  function siteDialog(pid) {
    const av = Game.availableSites(pid); const idle = Game.idleOfficers(pid); const p = Game.prov(pid);
    openModal(`<h3>${esc(Game.pname(pid))}의 외성 시설</h3><p class="hint">도시 외곽에 세우는 시설입니다. 매달 수입과 혜택을 주지만, 적이 성문 앞까지 침공하면 점령당하거나 약탈당할 수 있습니다. 국고: 금 ${fmt(p.gold)}.</p>
      <div class="sites-list">${av.map((a) => `<div class="kv"><span><span class="glyph">${a.glyph}</span>${esc(a.label)}${a.max > 1 ? ` (${a.have}/${a.max})` : ''}<br><small class="hint">${esc(a.desc)}</small></span><b>${a.ok ? `<button class="btn-sm ${p.gold >= a.cost ? 'btn-gold' : ''}" data-act="build" data-type="${a.type}" ${p.gold >= a.cost && idle.length ? '' : 'disabled'}>${a.cost}금</button>` : `<small class="hint">${a.have >= a.max ? '완공됨' : '건설 부지 없음'}</small>`}</b></div>`).join('')}</div>
      <div class="modal-actions"><button class="btn btn-gold" data-act="close">닫기</button></div>`, {
      close: closeModal,
      build: (el) => { const type = el.dataset.type; closeModal(); chooseOfficer(`${SITE_TYPES[type].label} 건설`, `${esc(SITE_TYPES[type].desc)} 비용: 금 ${SITE_TYPES[type].cost}. 장수가 공사를 감독합니다.`, idle, () => '', (n) => result(Game.buildSite(pid, n, type))); },
    }, true);
  }
  // letters across the lines: turn a wavering enemy officer, with gold to sweeten it
  function subornDialog() {
    const ts = Game.battleSubornTargets(BT.city); const gold = Game.battleGold(BT.city); const B = Game.battleFor(BT.city);
    if (!ts.length) { showResult('전장에서 회유할 수 있는 적장이 없습니다. (충성심이 높거나 군주이거나, 서신을 보낼 아군 장수가 없음)', renderBattle); return; }
    const refresh = () => { const g = Math.max(0, +$('#sb-gold').value || 0); const t = ts.find((x) => x.name === $('#sb-who').value); $('#sb-out').textContent = t ? `약 ${Math.round(Math.min(0.8, t.chance + g / 4000) * 100)}%` : ''; };
    openModal(`<h3>전장의 밀서와 회유</h3>
      <p class="hint">전장에 있는 아군 장수 중 가장 지모가 뛰어난 자가 흔들리는 적장에게 서신을 보냅니다. 부대장이 귀순하면 부대 전체가 아군으로 전향하며, 일반 장수는 홀로 귀순합니다. 금을 얹어주면 성공 확률이 오르며 전향 여부와 무관하게 소모됩니다. 각 장수에게는 한 번만 시도할 수 있습니다. 사용 가능 금: ${fmt(gold)} (${Game.playerSideOf(B) === 'A' ? '본거지' : '도시'}).</p>
      <div class="row"><label>대상 장수</label><select id="sb-who">${ts.map((t) => `<option value="${esc(t.name)}">${esc(t.name)} · 충성 ${t.loyalty}${t.lead ? ` · 지휘 병력 ${fmt(t.troops)}` : ''}</option>`).join('')}</select></div>
      <div class="row"><label>제시할 금</label><input type="number" id="sb-gold" min="0" max="${gold}" value="${Math.min(gold, 500)}"></div>
      <div class="row"><label>성공률</label><span id="sb-out"></span></div>
      <div class="modal-actions"><button data-act="cancel">취소</button><button class="btn btn-gold" data-act="ok">밀서 보내기</button></div>`, {
      cancel: closeModal, oninput: refresh,
      ok: () => { const t = ts.find((x) => x.name === $('#sb-who').value); const r = Game.battleSuborn(BT.city, t.unit, t.name, +$('#sb-gold').value); closeModal(); toast(r.msg); afterBattleAction(); },
    });
    refresh();
  }
  // ask for help: own neighbours with amounts, allies yes/no
  function messengerDialog(city, done) {
    const req = Game.battleRequests(city); if (!req || req.asked || (!req.own.length && !req.allies.length)) { if (done) done(); return; }
    openModal(`<h3>구원 요청 전령</h3><p class="hint">전령은 한 번만 파견할 수 있습니다. ${esc(Game.pname(city))} 인접한 아군 도시에서 병력과 군량을 보낼 수 있으며(${req.days}일 후 도착), 인접 동맹 세력에도 참전을 요청할 수 있습니다.</p>
      ${req.own.map((o, i) => `<div class="kv" style="align-items:center;gap:8px"><span>${esc(Game.pname(o.city))} <small class="hint">(병력 ${fmt(o.troops)}, 여유 ${fmt(o.spare)}, 군량 ${fmt(o.food)})</small></span><b><input type="number" id="mg-t${i}" min="0" max="${o.troops}" value="${Math.min(o.spare, Math.floor(o.troops * 0.5))}" style="width:80px"> 병력 <input type="number" id="mg-f${i}" min="0" max="${o.food}" value="${Math.min(o.food, 3000)}" style="width:80px"> 군량 <select id="mg-o${i}">${o.officers.length ? o.officers.map((n) => `<option>${esc(n)}</option>`).join('') : '<option value="">출진 가능 장수 없음</option>'}</select></b></div>`).join('')}
      ${req.allies.map((a, i) => `<label class="kv" style="cursor:pointer"><span><input type="checkbox" id="mg-a${i}" checked> ${esc(Game.pname(a.city))}의 ${esc(Game.fname(a.fid))}에게 요청 <small class="hint">(병력 ${fmt(a.troops)}, 관계 ${a.relation})</small></span></label>`).join('')}
      <div class="modal-actions"><button data-act="skip">전령 없음</button><button class="btn btn-gold" data-act="send">파견</button></div>`, {
      skip: () => { closeModal(); if (done) done(); },
      send: () => { const own = req.own.map((o, i) => ({ city: o.city, troops: +$(`#mg-t${i}`).value, food: +$(`#mg-f${i}`).value, officer: $(`#mg-o${i}`).value })).filter((x) => x.officer && x.troops > 0); const allies = req.allies.filter((a, i) => $(`#mg-a${i}`).checked).map((a) => a.fid); const r = Game.battleMessengers(city, { own, allies }); closeModal(); toast(r.msg); if (done) done(); },
    });
  }
  // from a neighbouring city during the month: men and grain for a battle nearby
  function reinforceDialog(fromId, city, after) {
    const S = Game.state(); const p = Game.prov(fromId); const idle = Game.idleOfficers(fromId).filter((o) => !Game.isRuler(o));
    openModal(`<h3>${esc(Game.pname(city))}에 구원군 파견</h3><p class="hint">${esc(Game.pname(fromId))}에서 출발한 부대는 열흘 안에 전장에 도착합니다. 병력을 보내려면 장수가 이끌어야 하며, 군량만 보낼 수도 있습니다.</p>
      <div class="kv"><span>파견 병력 (보유 ${fmt(p.troops)})</span><b><input type="number" id="rf-t" min="0" max="${p.troops}" value="${Math.floor(p.troops * 0.5)}" style="width:100px"></b></div>
      <div class="kv"><span>보급 군량 (보유 ${fmt(p.food)})</span><b><input type="number" id="rf-f" min="0" max="${p.food}" value="${Math.min(p.food, 5000)}" style="width:100px"></b></div>
      <div class="kv"><span>통솔 장수</span><b><select id="rf-o">${idle.map((o) => `<option>${esc(o.name)}</option>`).join('')}<option value="">없음 (군량만 수송)</option></select></b></div>
      <div class="modal-actions"><button data-act="cancel">취소</button><button class="btn btn-gold" data-act="ok">출진</button></div>`, {
      cancel: () => { closeModal(); if (after) after(); },
      ok: () => { const o = $('#rf-o').value; const r = Game.reinforceBattle(fromId, city, { troops: o ? +$('#rf-t').value : 0, food: +$('#rf-f').value, officers: o ? [o] : [] }); closeModal(); if (after) { renderAll(); showResult(r.msg, after); } else result(r); },
    });
  }
  // replay of an AI battle, frame by frame
  // how sieges are shown to an observer: offered in the reports, watched every one, or skipped
  const watchMode = () => { const sel = $('#watch-mode'); return sel ? sel.value : 'ask'; };
  function initWatchMode() {
    const sel = $('#watch-mode'); if (!sel) return;
    try { const saved = localStorage.getItem('rotk_watch'); if (saved && [...sel.options].some((o) => o.value === saved)) sel.value = saved; } catch (e) { /* ignore */ }
    const apply = () => { try { localStorage.setItem('rotk_watch', sel.value); } catch (e) { /* ignore */ } if (Game.state()) Game.setOption('watchBattles', sel.value !== 'skip'); };
    sel.addEventListener('change', apply);
  }
  const SPEEDS = [[1400, '½×'], [700, '1×'], [350, '2×'], [175, '4×'], [80, '8×']];
  BT.speed = 1; try { const raw = localStorage.getItem('rotk_replay_speed'); const sv = raw === null ? 1 : +raw; if (sv >= 0 && sv < SPEEDS.length) BT.speed = sv; } catch (e) { /* ignore */ }
  function replayTick() {
    const R = BT.replay; if (!R) return;
    if (BT.frame < R.replay.length - 1) { BT.frame++; renderReplay(); return; }
    clearInterval(BT.timer); BT.timer = null; renderReplay();
    if (BT.autoDone) setTimeout(() => { if (BT.replay === R) replayControl('done'); }, 900);   // in a sequence the next siege follows on its own
  }
  function startReplayTimer() { if (BT.timer) clearInterval(BT.timer); BT.timer = setInterval(replayTick, SPEEDS[BT.speed][0]); }
  function openReplay(R, done, autoDone = false) {
    BT.city = R.city; BT.replay = R; BT.frame = 0; BT.sel = null; BT.onDone = done; BT.autoDone = autoDone;
    $('#battle-screen').hidden = false; renderReplay();
    startReplayTimer();
  }
  // several sieges in a row: the observer's auto-advance waits until they are done
  function playReplays(reports, done) {
    if (!reports.length) { done(); return; }
    const wasAuto = !!autoTimer; if (wasAuto) { clearInterval(autoTimer); autoTimer = null; }
    let i = 0;
    BT.skipRest = false;
    const next = () => { if (BT.skipRest) i = reports.length; if (i >= reports.length) { if (wasAuto && $('#btn-auto').classList.contains('on')) startAutoTimer(); done(); return; } openReplay(reports[i++], next, true); };
    next();
  }
  function replayControl(act) {
    const R = BT.replay; if (!R) return;
    if (act === 'prev') BT.frame = Math.max(0, BT.frame - 1);
    else if (act === 'next') BT.frame = Math.min(R.replay.length - 1, BT.frame + 1);
    else if (act === 'play') { if (BT.timer) { clearInterval(BT.timer); BT.timer = null; } else startReplayTimer(); }
    else if (act === 'speed') { BT.speed = (BT.speed + 1) % SPEEDS.length; try { localStorage.setItem('rotk_replay_speed', String(BT.speed)); } catch (e) { /* ignore */ } if (BT.timer) startReplayTimer(); }
    else if (act === 'skip') { BT.frame = R.replay.length - 1; if (BT.timer) { clearInterval(BT.timer); BT.timer = null; } }
    else if (act === 'done') { const d = BT.onDone; BT.autoDone = false; closeBattle(); if (d) d(); return; }
    else if (act === 'skipall') { const d = BT.onDone; BT.autoDone = false; closeBattle(); BT.skipRest = true; if (d) d(); return; }
    renderReplay();
  }
  function renderReplay() {
    const R = BT.replay; const S = Game.state(); const f = R.replay[BT.frame]; if (!f) return;
    const heartFid = (f.heart || 'D') === 'A' ? R.attacker : R.defender;
    const ownerOf = (id) => { const o = id === R.city ? heartFid : S.provinces[id] && S.provinces[id].owner; return o && S.factions[o] ? S.factions[o] : null; };
    const { svg, W, H } = HEXVIEW.render(R.city, BT_S, true, { tints: true, ownerOf, ownerColor: (id) => { const o = ownerOf(id); return o ? o.color : FREE_COLOR; } });
    let extra = HEXVIEW.fireSvg(f.fires, f.burnt, BT_S) + (f.fights && f.fights.length ? HEXVIEW.flashSvg(f.fights, BT_S) : ''); for (const [k, hits] of Object.entries(f.gates || {})) if (hits >= BATTLE.GATE_HITS) { const [c, r] = k.split(',').map(Number); const [cx, cy] = HEXVIEW.centre(c, r, BT_S); extra += `<text class="glyph" x="${cx}" y="${cy + 4}" text-anchor="middle" style="font-size:11px;fill:#ff8a7a">✕</text>`; }
    const pad = 96; const el = $('#bt-map'); el.setAttribute('viewBox', `${-pad} ${-40} ${W + 2 * pad} ${H + 80}`); el.innerHTML = svg + extra + HEXVIEW.unitsSvg(f.units.map((u) => ({ ...u, color: unitColor(u.fid) })), BT_S, null);
    $('#bt-title').textContent = `${Game.pname(R.city)} 공성전 (재연)`; $('#bt-day').textContent = `${f.day}일째 (총 ${R.replay[R.replay.length - 1].day}일)${f.weather === 'rain' ? ' · ☔ 비' : f.weather === 'snow' ? ' · ❄ 눈' : ''}${f.night ? ' · 🌙 야간' : ''}`; $('#bt-food').textContent = '';
    $('#bt-sides').innerHTML = `<div class="side"><span><span class="chip" style="background:${unitColor(R.attacker)}"></span> ${esc(Game.fname(R.attacker))}</span><b>${fmt(f.units.filter((u) => u.side === 'A').reduce((a, u) => a + u.troops, 0))}</b></div><div class="side"><span><span class="chip" style="background:${unitColor(R.defender)}"></span> ${R.defender ? esc(Game.fname(R.defender)) : '성내 민병'}</span><b>${fmt(f.units.filter((u) => u.side === 'D').reduce((a, u) => a + u.troops, 0))}</b></div>`;
    $('#bt-unit').innerHTML = `<div class="hint">${esc(R.lines[R.lines.length - 1] ? R.lines[R.lines.length - 1].text : '')}</div>`;
    $('#bt-actions').innerHTML = `<button data-act="prev">◂ 하루 전</button><button data-act="next">다음 날 ▸</button><button data-act="play">${BT.timer ? '❚❚ 일시정지' : '▶ 재생'}</button><button data-act="speed" title="재생 속도">${SPEEDS[BT.speed][1]} 속도</button><button data-act="skip" title="공성전 결말까지 건너뛰기">▸▸ 결말까지</button><button class="btn-gold" data-act="done">${BT.autoDone ? '다음 ▸' : '완료'}</button>${BT.autoDone ? '<button data-act="skipall" title="이달의 남은 공성전 모두 건너뛰기">모두 건너뛰기</button>' : ''}`;
    $('#bt-log').innerHTML = (f.log || []).map((t) => `<div>${esc(t)}</div>`).join('') || '<div class="hint">조용한 하루였습니다.</div>';
  }

  // ---------- diplomacy ----------
  function treatyLabel(a, b) {
    const S = Game.state();
    const st = Game.treatyStatus(a, b);
    const d = S.diplomacy[a < b ? `${a}|${b}` : `${b}|${a}`];
    if (st === 'ceasefire') return `정전 (남은 기간 ${Math.max(0, d.until - S.turn)}개월)`;
    if (st === 'alliance') return `동맹 (남은 기간 ${Math.max(0, d.until - S.turn)}개월)`;
    return '조약 없음';
  }

  function showDiplomacy() {
    const S = Game.state();
    if (S.observer) return showDiplomacyObserver();
    const me = S.player;
    const rows = Object.values(S.factions).filter((f) => f.alive && f.id !== me)
      .map((f) => ({ f, cities: Game.factionProvinces(f.id).length, troops: Game.totalTroops(f.id), rel: Game.relation(me, f.id), st: Game.treatyStatus(me, f.id), border: Game.bordering(me, f.id), owed: Game.favorsOwed(me, f.id), owedMe: Game.favorsOwed(f.id, me) }))
      .sort((a, b) => (b.border ? 1 : 0) - (a.border ? 1 : 0) || b.cities - a.cities);
    const gold = Game.factionProvinces(me).reduce((s, p) => s + p.gold, 0);
    const envoys = Game.factionOfficers(me).filter((o) => !o.acted && !Game.isRuler(o) && Game.prov(o.city).owner === me).length;
    openModal(`<h3>외교 — ${esc(Game.fname(me))}</h3>
      <p class="hint">사신은 해당 도시의 금을 쓰고(정전 ${Game.DIP_COST.ceasefire}, 동맹 ${Game.DIP_COST.alliance}, 공동 출병 ${Game.DIP_COST.joint}) 그 장수의 한 달을 소모합니다. 사신으로 쓸 장수 ${envoys}명. 보유 금: ${fmt(gold)}.</p>
      <table class="dipl"><tr><th></th><th>세력</th><th>국력</th><th>관계</th><th>조약</th><th></th></tr>
      ${rows.map((r) => `<tr>
        <td><span class="chip" style="background:${r.f.color}"></span></td>
        <td>${esc(r.f.name)}${r.border ? ' <small style="color:var(--muted)">(인접)</small>' : ''}${(r.f.persona || []).length ? `<br><small class="persona">${esc((r.f.persona || []).join(', '))}</small>` : ''}${r.f.treachery > 0 ? ` <small class="persona" style="color:#e29a8f" title="조약을 깨거나 정전이 끝나자마자 공격한 전력">신의 없음 ×${r.f.treachery}</small>` : ''}</td>
        <td>${r.cities}개 도시 · ${fmt(r.troops)}</td>
        <td class="rel-${Game.relationWord(r.rel)}">${Game.relationWord(r.rel)} (${r.rel})</td>
        <td class="st-${r.st}">${treatyLabel(me, r.f.id)}${r.owed ? `<br><small style="color:#e29a8f" title="동맹의 전투에 출병한 데 대한 신세; 상대 전투에 출병하거나 400 이상 가치의 선물로 갚습니다">내가 신세 ${r.owed}회</small>` : r.owedMe ? `<br><small style="color:#9fd69f" title="내 전투에 출병해 준 데 대해 상대가 진 신세">상대가 신세 ${r.owedMe}회</small>` : ''}</td>
        <td class="acts">
          <button class="btn-sm" data-act="gift" data-f="${r.f.id}">선물</button>
          ${r.st === 'neutral' ? `<button class="btn-sm" data-act="cease" data-f="${r.f.id}">정전</button>` : ''}
          ${r.st !== 'alliance' ? `<button class="btn-sm" data-act="ally" data-f="${r.f.id}">동맹</button>` : `<button class="btn-sm" data-act="joint" data-f="${r.f.id}">공동 출병</button>${(S.diplomacy[me < r.f.id ? `${me}|${r.f.id}` : `${r.f.id}|${me}`].until - S.turn) <= 12 ? `<button class="btn-sm" data-act="ally" data-f="${r.f.id}">갱신</button>` : ''}`}
          ${r.st !== 'neutral' ? `<button class="btn-sm btn-red" data-act="break" data-f="${r.f.id}">파기</button>` : ''}
        </td></tr>`).join('')}</table>
      <div class="modal-actions"><button class="btn btn-gold" data-act="close">닫기</button></div>`, {
      close: closeModal,
      gift: (el) => giftDialog(el.dataset.f),
      cease: (el) => envoyDialog(el.dataset.f, 'ceasefire'),
      ally: (el) => envoyDialog(el.dataset.f, 'alliance'),
      joint: (el) => jointDialog(el.dataset.f),
      break: (el) => {
        const t = el.dataset.f;
        openModal(`<h3>${esc(Game.fname(t))}와(과)의 ${treatyLabel(me, t)}을(를) 파기할까요?</h3><p>${esc(Game.fname(t))}와(과)의 관계가 무너지고 다른 모든 세력이 당신을 낮게 볼 것입니다.</p>
          <div class="modal-actions"><button data-act="cancel">유지</button><button class="btn btn-red" data-act="ok">파기</button></div>`, {
          cancel: showDiplomacy,
          ok: () => { const r = Game.breakTreaty(me, t); showResult(r.msg, () => { renderAll(); showDiplomacy(); }); },
        });
      },
    });
  }

  function envoyList(me, target, type) {
    return Game.factionOfficers(me).filter((o) => !o.acted && !Game.isRuler(o) && Game.prov(o.city).owner === me)
      .sort((a, b) => (b.chr + b.pol) - (a.chr + a.pol));
  }

  function envoyDialog(target, type) {
    const S = Game.state(); const me = S.player;
    const list = envoyList(me, target, type);
    const desc = type === 'ceasefire'
      ? `<b>${esc(Game.fname(target))}</b>에게 ${Game.CEASEFIRE_MONTHS}개월 정전을 제안합니다. 약한 세력은 쉽게 받아들이고 강한 세력은 거의 응하지 않습니다. 성공은 사신의 <b>매력</b>·<b>정치</b>와 관계(${Game.relationWord(Game.relation(me, target))})에 좌우됩니다.`
      : `<b>${esc(Game.fname(target))}</b>에게 ${Game.ALLIANCE_MONTHS / 12}년 동맹을 제안합니다. 동맹은 서로 공격하지 않고 참전을 요청할 수 있으며, 유지 중인 동맹은 다음 기간으로 갱신됩니다. 우호 관계, 공동의 적, 당신의 국력이 모두 도움이 됩니다.`;
    const treasures = Game.houseItems(me);
    chooseOfficer(`사신 보내기 — ${type === 'ceasefire' ? '정전' : '동맹'}`, desc + (treasures.length ? `<div class="row" style="margin-top:8px"><label>선물</label><select id="env-item" style="flex:1"><option value="">— 없음 —</option>${treasures.map((it) => `<option value="${it.id}">${esc(it.name)} · 성공률 +${Math.round(Math.min(0.35, Game.itemValue(it) / 100) * 100)}%</option>`).join('')}</select></div><div class="hint">양보로 내건 보물은 상대가 수락하면 그 군주에게 넘어갑니다.</div>` : ''), list,
      (o) => `${Math.round(Game.acceptChance(me, target, type, o) * 100)}% · ${esc(Game.pname(o.city))} (${fmt(Game.prov(o.city).gold)}금)`,
      (n) => { const sel = $('#env-item'); const r = Game.proposeTreaty(me, target, type, n, sel && sel.value ? sel.value : null); if (!r.ok) { result(r); return; } renderAll(); showResult(r.msg, showDiplomacy); });
    if (!list.length) return;
    modalHandlers.cancel = showDiplomacy;
  }

  function jointDialog(ally) {
    const S = Game.state(); const me = S.player;
    const enemies = Object.values(S.factions).filter((f) => f.alive && f.id !== me && f.id !== ally && Game.bordering(ally, f.id) && Game.treatyStatus(ally, f.id) === 'neutral' && Game.treatyStatus(me, f.id) === 'neutral');
    if (!enemies.length) { showResult(`${Game.fname(ally)}은(는) 두 세력이 함께 칠 만한 세력과 국경을 맞대고 있지 않습니다.`, showDiplomacy); return; }
    openModal(`<h3>${esc(Game.fname(ally))}에게 참전 요청</h3>
      <p>동의하면 그들의 군대가 여섯 달 동안 그 적을 집중 공격합니다.</p>
      <div class="row"><label>대상</label><select id="jw-enemy" style="flex:1">${enemies.map((f) => `<option value="${f.id}">${esc(f.name)} — ${Game.factionProvinces(f.id).length}개 도시 · 병력 ${fmt(Game.totalTroops(f.id))}</option>`).join('')}</select></div>
      <div class="modal-actions"><button data-act="cancel">뒤로</button><button class="btn btn-gold" data-act="ok">사신 선택</button></div>`, {
      cancel: showDiplomacy,
      ok: () => {
        const enemy = $('#jw-enemy').value;
        const list = envoyList(me, ally, 'joint');
        chooseOfficer('사신 보내기 — 참전 요청', `<b>${esc(Game.fname(ally))}</b>에게 <b>${esc(Game.fname(enemy))}</b> 토벌 출병을 요청합니다.`, list,
          (o) => `${Math.round(Game.acceptChance(me, ally, 'joint', o) * 100)}% · ${esc(Game.pname(o.city))} (${fmt(Game.prov(o.city).gold)}금)`,
          (n) => { const r = Game.requestJointAttack(me, ally, enemy, n); if (!r.ok) { result(r); return; } renderAll(); showResult(r.msg, showDiplomacy); });
        if (list.length) modalHandlers.cancel = showDiplomacy;
      },
    });
  }

  function giftDialog(target) {
    const S = Game.state(); const me = S.player;
    const cities = Game.factionProvinces(me).filter((p) => p.gold > 0 || p.food > 0).sort((a, b) => b.gold - a.gold);
    if (!cities.length) { showResult('보낼 수 있는 금이나 군량이 없습니다.', showDiplomacy); return; }
    const owed = Game.favorsOwed(me, target);
    const refresh = () => {
      const g = Math.max(0, +$('#gf-gold').value || 0), fd = Math.max(0, +$('#gf-food').value || 0); const v = g + fd / 10;
      $('#gf-out').textContent = `관계 +${Math.min(20, 3 + Math.floor(v / 100))}${owed ? (v >= 400 ? ' · 진 신세를 갚습니다' : ' · 400 가치(금, 또는 1/10 가치 군량) 이상의 선물이면 신세를 갚습니다') : ''}`;
      $('#gf-gold').max = Game.prov($('#gf-city').value).gold; $('#gf-food').max = Game.prov($('#gf-city').value).food;
    };
    const treasures = Game.houseItems(me);
    openModal(`<h3>${esc(Game.fname(target))}에게 선물</h3>
      <p>현재 관계: <span class="rel-${Game.relationWord(Game.relation(me, target))}">${Game.relationWord(Game.relation(me, target))} (${Game.relation(me, target)})</span>. 선물은 사신이 필요 없습니다. 금과 군량은 관계를 최대 +20까지 올리며, 보물은 그 이상, 특히 옥새가 가장 크게 올립니다.${owed ? ` 아군의 전투에 출병해 준 신세가 ${owed}회 남아 있습니다. 400 가치의 선물을 보내면 1회를 갚습니다.` : ''}</p>
      ${treasures.length ? `<div class="row"><label>보물</label><select id="gf-item" style="flex:1"><option value="">— 금·군량만 보냄 —</option>${treasures.map((it) => `<option value="${it.id}">${esc(it.name)} (${esc(S.items[it.id].owner)} 소지) · 관계 +${Math.min(35, Game.itemValue(it))}</option>`).join('')}</select></div>` : ''}
      <div class="row"><label>보낼 도시</label><select id="gf-city">${cities.map((c) => `<option value="${c.id}">${esc(Game.pname(c.id))} (${fmt(c.gold)}금)</option>`).join('')}</select></div>
      <div class="row"><label>금</label><input type="number" id="gf-gold" min="0" value="${Math.min(owed ? 400 : 300, cities[0].gold)}"></div>
      <div class="row"><label>군량</label><input type="number" id="gf-food" min="0" value="0"></div>
      <div class="row"><label>효과</label><span id="gf-out"></span></div>
      <div class="modal-actions"><button data-act="cancel">뒤로</button><button class="btn btn-gold" data-act="ok">보내기</button></div>`, {
      cancel: showDiplomacy, oninput: refresh,
      ok: () => { const sel = $('#gf-item'); if (sel && sel.value) { const r = Game.giftItem(me, target, sel.value); if (!r.ok) { result(r); return; } renderAll(); showResult(r.msg, showDiplomacy); return; } const r = Game.sendGift(me, target, $('#gf-city').value, +$('#gf-gold').value, +$('#gf-food').value); if (!r.ok) { result(r); return; } renderAll(); showResult(r.msg, showDiplomacy); },
    });
    refresh();
  }

  // ---------- historical decisions ----------
  function handleDecisions(done) {
    const S = Game.state();
    const d = S.pendingDecisions[0];
    if (!d) { done(); return; }
    const ev = EVENTS.find((e) => e.id === d.id);
    if (!ev) { Game.decide(0, 0); handleDecisions(done); return; }
    openModal(`<h3>${esc(ev.title)}</h3>
      <p>${ev.decision.prompt(eventApiForUi(), S, d.ctx)}</p>
      <div class="modal-actions">${ev.decision.options.map((o, i) => `<button class="${i === 0 ? 'btn btn-gold' : ''}" data-act="opt" data-i="${i}">${esc(o.label)}</button>`).join('')}</div>`, {
      opt: (el) => { const r = Game.decide(0, +el.dataset.i); renderAll(); showResult(r.msg, () => handleDecisions(done)); },
    }, true);
  }
  // prompts only need names and the like; pass a small read-only helper set
  function eventApiForUi() { return { pname: Game.pname, fname: Game.fname, rulerOf: Game.rulerOf, factionProvinces: Game.factionProvinces, relation: Game.relation }; }

  function showObjectives() {
    const S = Game.state();
    const houses = S.observer ? Object.values(S.factions).filter((f) => f.alive && OBJECTIVES.some((o) => o.house === f.id)) : [S.factions[S.player]];
    const statusHtml = (ob) => {
      const st = Game.objectiveStatus(ob);
      const cls = st.state === 'done' ? 'good' : st.state === 'missed' ? 'bad' : st.state === 'future' ? 'sys' : '';
      const label = st.state === 'done' ? `✓ 달성 (${S.objectivesDone[`${ob.house}:${ob.id}`]})` : st.state === 'missed' ? `✗ 실패 (${ob.to}년한)` : st.state === 'future' ? `${ob.from}년부터` : `${st.progress ? st.progress + ' · ' : ''}${ob.to}년까지`;
      return `<div class="n ${cls}"><b>${esc(ob.title)}</b> <span class="hint">${label}</span><br>${esc(ob.desc)}</div>`;
    };
    const fired = EVENTS.filter((e) => S.eventsFired[e.id]).map((e) => esc(e.title)).join(', ');
    let body = '';
    for (const h of houses) {
      const list = OBJECTIVES.filter((o) => o.house === h.id);
      body += `<div class="sec"><span class="chip" style="background:${h.color}"></span> ${esc(h.name)} · 위세 ${h.prestige || 0}${h.hasEmperor ? ' · 👑 황제 옹립' : ''}</div>`;
      body += list.length ? `<div class="notices">${list.map(statusHtml).join('')}</div>` : '<div class="hint">이 세력은 정해진 운명이 없습니다. 스스로 천하를 도모하십시오.</div>';
    }
    openModal(`<h3>천하의 목표${S.observer ? '' : ''}</h3>
      <p class="hint">목표는 역사에 근거합니다. 완수하면 병력, 금, 장수나 위세를 얻습니다. 위세가 높으면 등용 확률과 충성도가 오르고 외교 사신의 설득력이 커집니다.</p>
      ${body}
      <div class="sec">천하의 보물</div>
      <table class="overview"><tr><th></th><th>보물</th><th>효과</th><th>소지자</th></tr>
      ${Game.ITEMS.map((it) => { const st = S.items[it.id]; const holder = st.owner && S.officers[st.owner] ? S.officers[st.owner] : null; const where = holder ? `${esc(holder.name)} <small style="color:var(--muted)">(${esc(Game.fname(holder.faction))})</small>` : (S.observer || (st.city && S.provinces[st.city].owner === S.player)) ? `<span class="hint">${esc(Game.pname(st.city))} 어딘가에 숨겨짐</span>` : '<span class="hint">소재 불명</span>'; return `<tr><td>${ITEM_ICON[it.type] || '✦'}</td><td>${esc(it.name)}</td><td><small>${esc(it.desc)}</small></td><td>${where}</td></tr>`; }).join('')}</table>
      <div class="sec">지금까지 발생한 사건</div><div class="hint">${fired || '아직 없음.'}</div>
      <div class="modal-actions"><button class="btn btn-gold" data-act="close">닫기</button></div>`, { close: closeModal });
  }

  function handleSuccession(done) {
    const S = Game.state();
    const ps = S.pendingSuccession;
    if (!ps || ps.fid !== S.player || !S.factions[S.player].alive) { done(); return; }
    const cands = ps.candidates.map(Game.off).filter((o) => o && o.faction === S.player && !o.captive);
    if (cands.length < 2) { S.pendingSuccession = null; done(); return; }
    const current = S.factions[S.player].ruler;
    openModal(`<h3>군주의 자리</h3>
      <p>군주가 서거했습니다. 임시로 <b>${esc(current)}</b>이(가) 자리를 맡았으나, 조정은 당신의 후계자 선택을 기다립니다. 군주의 <b>매력</b>은 모든 장수의 충성도를 지탱합니다.</p>
      ${pickList(cands, { extra: (o) => `충성 ${o.loyalty}${o.name === current ? ' · 유력 후계' : ''}` })}
      <div class="modal-actions"><button class="btn btn-gold" data-act="ok">후계자 확정</button></div>`, {
      ok: () => {
        const n = picked()[0] || current;
        const r = Game.chooseHeir(S.player, n);
        closeModal(); renderAll();
        showResult(r.ok ? r.msg : `${current}이(가) 군주 자리를 지킵니다.`, done);
      },
    }, true);
  }

  // an allied house next to a battle has asked for men; the battle waits on the answer until the month ends
  function handleAid(done) {
    const S = Game.state(); const a = (S.pendingAid || [])[0];
    if (!a) { done(); return; }
    const B = Game.battleFor(a.city); const from = Game.fac(a.from);
    if (!B || B.over || !from || !from.alive || (B.helpers && B.helpers[S.player])) { S.pendingAid.shift(); handleAid(done); return; }
    const owed = Game.favorsOwed(S.player, a.from), theyOwe = Game.favorsOwed(a.from, S.player);
    openModal(`<h3>${esc(from.name)}에서 온 파발</h3>
      <p>${esc(from.name)}이(가) ${esc(Game.pname(a.city))}에서 ${a.side === 'A' ? '공성 중이며' : '수성 중이며'} ${esc(Game.pname(a.fromCity))}에서 원군을 보내줄 것을 청합니다. ${owed ? `당신은 그들에게 ${owed}회의 빚(신세)이 있습니다. 거절하면 큰 대가를 치르게 됩니다.` : theyOwe ? `그들은 당신에게 ${theyOwe}회의 빚이 있습니다. 도우면 빚이 더 늘어납니다.` : '도우면 그들이 당신에게 빚을 지게 되며, 훗날 원군이나 선물로 보답받을 수 있습니다.'}</p>
      <div class="kv"><span>전황</span><b>공격군 ${fmt(BATTLE.sideTroops(B, 'A'))} · 수비군 ${fmt(BATTLE.sideTroops(B, 'D'))}</b></div>
      <div class="modal-actions"><button data-act="no">거절</button><button data-act="later">이달 내 결정</button><button class="btn btn-gold" data-act="yes">지원군 파견</button></div>`, {
      no: () => { const r = Game.declineAid(0); renderAll(); showResult(r.msg, () => handleAid(done)); },
      later: () => { closeModal(); done(); },
      yes: () => { closeModal(); reinforceDialog(a.fromCity, a.city, () => handleAid(done)); },
    }, true);
  }
  function handleProposals(done) {
    const S = Game.state();
    const pr = S.pendingProposals[0];
    if (!pr) { done(); return; }
    const from = Game.fac(pr.from);
    if (!from || !from.alive) { Game.respondProposal(0, false); handleProposals(done); return; }
    const rel = Game.relation(S.player, pr.from);
    const text = pr.type === 'ceasefire' ? `${Game.CEASEFIRE_MONTHS}개월 정전을 제안합니다. 만료될 때까지 서로를 공격할 수 없습니다.`
      : pr.type === 'alliance' ? `${Game.ALLIANCE_MONTHS / 12}년 동맹을 제안합니다. 동맹은 서로 공격하지 않으며 전쟁 시 서로를 부를 수 있습니다.`
      : pr.type === 'ransom' ? `사로잡힌 아군 장수 <b>${esc(pr.officer)}</b>의 몸값으로 <b>${fmt(pr.price)}금</b>을 요구합니다(가장 부유한 도시에서 지불). 거절하면 그의 운명은 상대에게 맡겨집니다.`
      : `<b>${esc(Game.fname(pr.enemy))}</b> 토벌 참전을 요청합니다. 동의하면 6개월 동안 출병 의무를 집니다.`;
    openModal(`<h3>${esc(from.name)}에서 온 사신</h3>
      <div class="captive-card"><div class="cn">${esc(pr.envoy)}</div><div class="cs">${esc(from.name)}의 사신 · ${Game.factionProvinces(pr.from).length}개 도시 · 병력 ${fmt(Game.totalTroops(pr.from))}<br>관계: <span class="rel-${Game.relationWord(rel)}">${Game.relationWord(rel)} (${rel})</span> · ${treatyLabel(S.player, pr.from)}</div></div>
      <p>${esc(from.name)}이(가) ${text}${pr.sweetener && S.items[pr.sweetener] && S.items[pr.sweetener].owner ? ` 호의의 증표로 사신이 <b>${esc(Game.itemData(pr.sweetener).name)}</b>을(를) 가져왔으며, 수락 시 당신의 차지가 됩니다.` : ''}</p>
      <div class="modal-actions"><button data-act="no">${pr.type === 'ransom' ? '거절' : '거절'}</button><button class="btn btn-gold" data-act="yes">${pr.type === 'ransom' ? `${fmt(pr.price)}금 지불` : '수락'}</button></div>`, {
      yes: () => { const r = Game.respondProposal(0, true); renderAll(); showResult(r.msg, () => handleProposals(done)); },
      no: () => { const r = Game.respondProposal(0, false); renderAll(); showResult(r.msg, () => handleProposals(done)); },
    }, true);
  }

  function showDiplomacyObserver() {
    const S = Game.state();
    const alive = Object.values(S.factions).filter((f) => f.alive);
    const pacts = Object.entries(S.diplomacy).filter(([k, d]) => d.status !== 'neutral' && k.split('|').every((f) => S.factions[f].alive));
    const rows = alive.map((f) => {
      const al = Game.allies(f.id).map(Game.fname);
      const cf = alive.filter((g) => g.id !== f.id && Game.treatyStatus(f.id, g.id) === 'ceasefire').map((g) => g.name);
      const foes = alive.filter((g) => g.id !== f.id && Game.relation(f.id, g.id) <= -40).map((g) => g.name);
      return `<tr><td><span class="chip" style="background:${f.color}"></span></td><td>${esc(f.name)}</td><td class="st-alliance">${esc(al.join(', ')) || '<span class="st-neutral">—</span>'}</td><td class="st-ceasefire">${esc(cf.join(', ')) || '<span class="st-neutral">—</span>'}</td><td class="rel-Hostile">${esc(foes.join(', ')) || '<span class="st-neutral">—</span>'}</td></tr>`;
    });
    openModal(`<h3>천하의 조약 현황 — ${esc(Game.dateStr())}</h3>
      <p class="hint">${alive.length}개 세력 간에 총 ${pacts.length}건의 조약 체결 중.</p>
      <table class="dipl"><tr><th></th><th>세력</th><th>동맹</th><th>정전</th><th>적대 세력</th></tr>${rows.join('')}</table>
      <div class="modal-actions"><button class="btn btn-gold" data-act="close">닫기</button></div>`, { close: closeModal });
  }

  // ---------- observer auto-play ----------
  let autoTimer = null;
  function autoInterval() { const v = parseInt($('#auto-speed').value, 10); return Number.isFinite(v) ? v : 600; }
  function startAutoTimer() {
    if (autoTimer) clearInterval(autoTimer);
    autoTimer = setInterval(() => {
      const S = Game.state();
      const notices = Game.endTurn();
      renderAll();
      if (S.over) { stopAuto(); showGameOver(); return; }
      const majors = notices.filter((n) => n.major);
      const reps = watchMode() === 'all' ? notices.filter((n) => n.report && n.report.replay && n.report.replay.length).map((n) => n.report) : [];
      if (reps.length) { playReplays(reps, () => { if (majors.length && $('#auto-pause').checked) { stopAuto(); showMajorEvents(majors); } }); return; }
      if (majors.length && $('#auto-pause').checked) { stopAuto(); showMajorEvents(majors); }
    }, autoInterval());
  }
  function showMajorEvents(majors) {
    openModal(`<h3>${esc(Game.dateStr())} — 천하의 격변</h3>
      <div class="notices">${majors.map((n) => `<div class="n ${n.cls}">${esc(n.text)}${n.report ? '<button class="btn-sm" data-act="rep">전투 보기</button>' : ''}</div>`).join('')}</div>
      <div class="modal-actions"><button data-act="close">계속 관전</button><button class="btn btn-gold" data-act="resume">▶▶ 자동 재개</button></div>`, {
      close: closeModal,
      resume: () => { closeModal(); toggleAuto(); },
      rep: () => { const r = majors.find((n) => n.report); if (r) showBattle(r.report, () => showMajorEvents(majors)); },
    }, true);
  }
  function toggleAuto() {
    if (autoTimer) { stopAuto(); return; }
    closeModal();
    startAutoTimer();
    $('#btn-auto').textContent = '■ 정지';
    $('#btn-auto').classList.add('on');
  }
  function initAutoSpeed() {
    const pause = $('#auto-pause');
    try { const savedP = localStorage.getItem('rotk_auto_pause'); if (savedP !== null) pause.checked = savedP === '1'; } catch (e) { /* ignore */ }
    pause.addEventListener('change', () => { try { localStorage.setItem('rotk_auto_pause', pause.checked ? '1' : '0'); } catch (e) { /* ignore */ } });
    const sel = $('#auto-speed');
    try { const saved = localStorage.getItem('rotk_auto_speed'); if (saved && [...sel.options].some((o) => o.value === saved)) sel.value = saved; } catch (e) { /* ignore */ }
    sel.addEventListener('change', () => {
      try { localStorage.setItem('rotk_auto_speed', sel.value); } catch (e) { /* ignore */ }
      if (autoTimer) startAutoTimer();   // apply the new pace at once
    });
  }
  function stopAuto() {
    if (autoTimer) clearInterval(autoTimer);
    autoTimer = null;
    const b = $('#btn-auto');
    if (b) { b.textContent = '▶▶ 자동'; b.classList.remove('on'); }
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', UI.init);
