// ============================================================
//  삼국시대 — Korea's Three Kingdoms. Scenario data.
//  Goguryeo, Baekje, Silla and the Gaya confederacy, with the Wa and
//  Malgal raiding the coasts and the north. An all-star setting: each
//  kingdom is led by its most famous king and served by its greatest
//  captains, drawn from across the whole of the era.
//  Content (kings, captains, capitals) researched from encykorea /
//  Korean Wikipedia; game stats are the designer's.
//
//  Two waves. OFFICERS below are the men and women of 554, the
//  scenario's opening year; their birth years are set so that they
//  stand at a playable age then (founders as venerable elders, the
//  kings of the day in their prime, rising captains in their
//  twenties). The seventh-century generation — Eulji, Yeon Gaesomun,
//  Kim Yu-sin, Gyebaek and the rest — were not yet born or still
//  children in 554, so they arrive through LATER_OFFICERS on their
//  debut years, joining the house they served when it still lives.
// ============================================================

const SCENARIO = {
  title: '삼국쟁패(三國爭霸)',
  year: 554,
  month: 1,
  intro:
    '고구려·백제·신라가 한반도의 패권을 다툰다. 북으로는 광개토대왕의 철기(鐵騎)가, ' +
    '남으로는 근초고왕의 수군과 진흥왕의 화랑이 일어선다. 가야는 두 큰 나라 사이에서 ' +
    '살길을 찾고, 왜와 말갈은 바다와 북방에서 노략질한다. 삼한을 하나로 통일하라.',
};

// x,y are pixel positions on the map canvas; see era.js MAP for the projection.
// The window is the Korean peninsula plus Liaodong / southern Manchuria.
// tier: 1 small town, 2 city, 3 major capital. dx/dy nudge the label in pixels.
const MAP = {
  W: 950, H: 1045, lon0: 122, lat1: 44, kx: 95, ky: 95,
  project(lon, lat) { return [(lon - this.lon0) * this.kx, (this.lat1 - lat) * this.ky]; },
};

const PROVINCES = [
  // Goguryeo — the north and Liaodong
  { id: 'pyongyang', name: '평양성', lon: 125.75, lat: 39.02, tier: 3, traits: ['river'] },
  { id: 'gungnae',   name: '국내성', lon: 126.19, lat: 41.12, dx: 28, tier: 3, traits: ['horses'] },
  { id: 'jolbon',    name: '졸본성', lon: 125.40, lat: 41.30, dx: -28, tier: 2, traits: ['horses'] },
  { id: 'yodong',    name: '요동성', lon: 123.17, lat: 41.27, tier: 2, traits: ['horses'] },
  { id: 'ansi',      name: '안시성', lon: 122.74, lat: 40.85, dy: 24, tier: 2, traits: ['horses'] },
  { id: 'sinseong',  name: '신성',   lon: 123.90, lat: 41.86, tier: 1, traits: ['horses'] },
  { id: 'buyeo',     name: '부여성', lon: 125.18, lat: 43.60, tier: 1, traits: ['horses'] },
  // Baekje — the west and south-west
  { id: 'wiryeseong', name: '위례성(한성)', lon: 127.09, lat: 37.52, dx: 20, tier: 3, traits: ['river', 'grain'] },
  { id: 'ungjin',    name: '웅진성', lon: 127.12, lat: 36.46, dx: -20, tier: 2, traits: ['river'] },
  { id: 'sabi',      name: '사비성', lon: 126.91, lat: 36.28, dx: -40, dy: 40, tier: 3, traits: ['river', 'grain'] },
  { id: 'wansan',    name: '완산주', lon: 127.15, lat: 35.82, dx: -60, dy: 60, tier: 2, traits: ['grain'] },
  { id: 'tamra',     name: '탐라(제주)', lon: 126.53, lat: 33.50, tier: 1, traits: ['coast'] },
  // Silla — the south-east
  { id: 'geumseong', name: '금성(경주)', lon: 129.22, lat: 35.83, tier: 3, traits: ['coast'] },
  { id: 'sabeol',    name: '사벌주', lon: 128.16, lat: 36.41, tier: 2, traits: ['grain'] },
  { id: 'samnyeon',  name: '삼년산성', lon: 127.73, lat: 36.49, dx: -40, dy: -50, tier: 1, traits: [] },
  { id: 'danghang',  name: '당항성', lon: 126.69, lat: 37.15, dx: -40, dy: -18, tier: 2, traits: ['coast', 'salt'] },
  { id: 'daeya',     name: '대야성', lon: 128.17, lat: 35.57, dx: 10, dy: 55, tier: 2, traits: [] },
  { id: 'siljik',    name: '실직(삼척)', lon: 129.17, lat: 37.45, tier: 1, traits: ['coast'] },
  // Gaya — the Nakdong valley
  { id: 'gimhae',    name: '김해(금관가야)', lon: 128.88, lat: 35.23, dx: 44, tier: 2, traits: ['coast', 'salt'] },
  { id: 'goryeong',  name: '고령(대가야)', lon: 128.26, lat: 35.73, dx: -45, dy: 20, tier: 2, traits: ['river'] },
  // Raiders
  { id: 'daema',     name: '대마도', lon: 129.30, lat: 34.20, tier: 1, traits: ['coast'] },
  { id: 'chaekseong', name: '책성', lon: 130.37, lat: 42.87, tier: 1, traits: ['horses'] },
];
for (const p of PROVINCES) { const [x, y] = MAP.project(p.lon, p.lat); p.x = Math.round(x + (p.dx || 0)); p.y = Math.round(y + (p.dy || 0)); }

// Regional traits and their effects. (Era-agnostic: shared with every age.)
const TRAIT_INFO = {
  grain:    { label: '곡창',   desc: '기름진 땅: 농경 식량 +25%.' },
  horses:   { label: '기마의 땅', desc: '변경의 기병: 징집 +25%, 더 잘 훈련된 병사.' },
  salt:     { label: '소금과 교역', desc: '해안 염전과 시장: 금 수입 +20%.' },
  river:    { label: '강가 포구', desc: '큰 강가: 배를 만들 수 있다. 수군이 도하를 결정한다.' },
  coast:    { label: '바닷가',  desc: '바다에 면함: 배를 만들 수 있다. 수군이 해로와 도하를 결정한다.' },
};

// Roads: [from, to, type]. Types: plain, pass (mountains), river (great-river crossing), sea (coastal lane).
const ROADS = [
  ['ansi', 'yodong', 'plain'],
  ['yodong', 'sinseong', 'plain'],
  ['sinseong', 'gungnae', 'pass'],
  ['yodong', 'gungnae', 'pass'],
  ['gungnae', 'jolbon', 'plain'],
  ['gungnae', 'buyeo', 'plain'],
  ['buyeo', 'chaekseong', 'plain'],
  ['jolbon', 'pyongyang', 'pass'],
  ['gungnae', 'pyongyang', 'pass'],
  ['pyongyang', 'wiryeseong', 'river'],
  ['pyongyang', 'danghang', 'sea'],
  ['pyongyang', 'siljik', 'pass'],
  ['wiryeseong', 'ungjin', 'plain'],
  ['wiryeseong', 'danghang', 'plain'],
  ['ungjin', 'sabi', 'river'],
  ['sabi', 'wansan', 'plain'],
  ['sabi', 'samnyeon', 'pass'],
  ['wansan', 'tamra', 'sea'],
  ['wansan', 'daeya', 'pass'],
  ['wansan', 'goryeong', 'pass'],
  ['geumseong', 'sabeol', 'plain'],
  ['sabeol', 'samnyeon', 'pass'],
  ['sabeol', 'goryeong', 'plain'],
  ['geumseong', 'daeya', 'plain'],
  ['geumseong', 'siljik', 'pass'],
  ['geumseong', 'gimhae', 'plain'],
  ['daeya', 'goryeong', 'plain'],
  ['samnyeon', 'danghang', 'pass'],
  ['gimhae', 'goryeong', 'river'],
  ['gimhae', 'daema', 'sea'],
];

// Cities whose fields flood (used by the battle map generator for river plains).
const FLOOD_PLAIN = ['ungjin', 'sabi', 'gimhae', 'goryeong', 'wiryeseong'];

const FACTIONS = [
  { id: 'goguryeo', name: '고구려', ruler: '광개토대왕', color: '#2e5cb8', aggr: 1.3, cities: ['pyongyang', 'gungnae', 'jolbon', 'yodong', 'ansi', 'sinseong', 'buyeo'], emperor: true, persona: ['reckless', 'builder'], blurb: '만주와 한반도 북부를 호령하는 철기의 나라. 독자 연호 영락(永樂)을 쓰며 천하의 중심을 자처한다.' },
  { id: 'baekje',   name: '백제',   ruler: '근초고왕', color: '#c0392b', aggr: 1.1, cities: ['sabi', 'wiryeseong', 'ungjin', 'wansan', 'tamra'], persona: ['schemer', 'builder'], blurb: '한강 유역에서 일어나 바다 건너 왜·중국과 통하는 해상 강국. 근초고왕 대에 최전성기를 맞았다.' },
  { id: 'silla',    name: '신라',   ruler: '진흥왕',   color: '#27ae60', aggr: 1.0, cities: ['geumseong', 'sabeol', 'samnyeon', 'danghang', 'daeya', 'siljik'], persona: ['cautious', 'builder'], blurb: '사로 6촌에서 일어난 동남방의 나라. 화랑도와 율령으로 뒤늦게 일어나 한강 유역을 노린다.' },
  { id: 'gaya',     name: '가야',   ruler: '수로왕',   color: '#8e44ad', aggr: 0.5, cities: ['gimhae', 'goryeong'], persona: ['builder', 'cautious'], blurb: '낙동강 하류의 철과 바다로 번성한 연맹체. 백제와 신라 사이에서 독립을 지키려 애쓴다.' },
  { id: 'wae',      name: '왜',     ruler: '왜왕',     color: '#7f8c8d', aggr: 1.5, cities: ['daema'], raider: true, playable: false, persona: ['reckless', 'treacherous'], blurb: '바다 건너에서 남해안을 노략질하는 왜의 수군. 때로 백제와 손잡고 때로 신라를 친다.' },
  { id: 'malgal',   name: '말갈',   ruler: '말갈추장', color: '#795548', aggr: 1.5, cities: ['chaekseong'], raider: true, playable: false, persona: ['reckless', 'treacherous'], blurb: '북방 삼림의 말갈 부족. 고구려의 변경을 끊임없이 침노한다.' },
];

// Officers: [name, LDR, WAR, INT, POL, CHR, faction (null = free), city, loyalty, birth year]
// The 554 generation. (Birth years are scenario-relative: see the header.)
const OFFICERS = [
  // 고구려
  ['광개토대왕', 96, 92, 80, 82, 95, 'goguryeo', 'pyongyang', 100, 519],
  ['장수왕',     88, 70, 88, 92, 86, 'goguryeo', 'pyongyang', 98, 514],
  ['소수림왕',   70, 50, 90, 95, 80, 'goguryeo', 'yodong', 95, 499],
  ['명림답부',   84, 80, 82, 78, 72, 'goguryeo', 'jolbon', 88, 496],
  ['을파소',     46, 32, 92, 95, 72, 'goguryeo', 'buyeo', 85, 497],
  ['고노자',     84, 83, 60, 50, 60, 'goguryeo', 'sinseong', 88, 509],
  ['괴유',       78, 92, 38, 34, 55, 'goguryeo', 'buyeo', 90, 512],
  ['온달',       82, 95, 55, 45, 76, 'goguryeo', 'gungnae', 92, 526],
  // 백제
  ['근초고왕',   92, 82, 85, 88, 90, 'baekje', 'sabi', 100, 509],
  ['성왕',       82, 70, 88, 90, 85, 'baekje', 'sabi', 97, 524],
  ['무령왕',     80, 72, 82, 88, 83, 'baekje', 'ungjin', 95, 499],
  ['고이왕',     76, 66, 85, 95, 82, 'baekje', 'wiryeseong', 95, 496],
  ['온조왕',     80, 72, 78, 85, 90, 'baekje', 'wiryeseong', 100, 494],
  ['목라근자',   85, 84, 72, 60, 70, 'baekje', 'wiryeseong', 85, 514],
  // 신라
  ['진흥왕',     88, 75, 85, 88, 88, 'silla', 'geumseong', 100, 522],
  ['이사부',     88, 82, 82, 80, 76, 'silla', 'samnyeon', 92, 514],
  ['거칠부',     70, 55, 90, 86, 72, 'silla', 'sabeol', 85, 516],
  ['법흥왕',     78, 62, 85, 92, 82, 'silla', 'geumseong', 96, 499],
  ['내물마립간', 76, 68, 78, 85, 78, 'silla', 'siljik', 90, 496],
  // 가야
  ['수로왕',     80, 75, 80, 85, 92, 'gaya', 'gimhae', 100, 494],
  ['구형왕',     66, 58, 70, 76, 70, 'gaya', 'gimhae', 88, 509],
  ['이뇌왕',     68, 60, 72, 76, 72, 'gaya', 'goryeong', 85, 512],
  ['우륵',       40, 25, 85, 70, 84, 'gaya', 'goryeong', 82, 519],
  ['허황옥',     36, 16, 80, 76, 94, 'gaya', 'gimhae', 92, 499],
  // 왜 / 말갈 (raiders)
  ['왜왕',       80, 78, 55, 55, 70, 'wae', 'daema', 100, 514],
  ['아리수',     72, 80, 45, 40, 55, 'wae', 'daema', 85, 524],
  ['말갈추장',   82, 84, 48, 45, 60, 'malgal', 'chaekseong', 100, 512],
  ['걸사비우',   76, 82, 50, 44, 58, 'malgal', 'chaekseong', 85, 522],
];

// Skills, keyed by officer name. (SKILL_INFO is era-agnostic.)
const SKILL_INFO = {
  cavalry:   { label: '기병',   desc: '기병을 이끈다: 공격 +8%, 기마의 땅이나 언 강에서 +15%.' },
  naval:     { label: '수군',   desc: '배의 명수: 강·바다 도하 손실 절반, 더 잘 싸운다.' },
  siege:     { label: '공성',   desc: '공성술: 이 장수가 공격을 이끌면 적 성벽이 30% 덜 친다.' },
  stratagem: { label: '계략',   desc: '계책 성공률 공수 모두 60% 증가.' },
  guardian:  { label: '수성',   desc: '성벽을 지킨다: 수비 시 +10%.' },
  admin:     { label: '내정',   desc: '개발·안정이 1.5배 빠르고, 태수 보너스 2배.' },
  orator:    { label: '변설',   desc: '설득: 장수 등용 +15%, 사신 제안 +8%, 안정 향상.' },
};
const OFFICER_SKILLS = {
  '광개토대왕': ['cavalry', 'admin'], '을지문덕': ['stratagem', 'guardian'], '연개소문': ['cavalry', 'stratagem'],
  '온달': ['cavalry'], '양만춘': ['guardian', 'siege'], '소수림왕': ['admin', 'orator'], '을파소': ['admin'], '괴유': ['cavalry'], '고노자': ['cavalry'],
  '연남생': ['cavalry'], '연남건': ['cavalry', 'guardian'],
  '근초고왕': ['cavalry', 'admin'], '계백': ['guardian'], '흑치상지': ['cavalry', 'guardian'], '성충': ['stratagem', 'admin'], '고이왕': ['admin'], '무령왕': ['naval', 'admin'],
  '의자왕': ['guardian'], '복신': ['stratagem'], '부여풍': ['naval'], '도침': ['orator'],
  '김유신': ['cavalry', 'stratagem'], '이사부': ['naval', 'cavalry'], '거칠부': ['admin'], '진흥왕': ['admin'], '태종무열왕': ['orator', 'admin'], '선덕여왕': ['orator'],
  '관창': ['cavalry'], '김인문': ['orator', 'naval'], '검모잠': ['guardian'],
  '수로왕': ['orator', 'naval'], '허황옥': ['orator', 'naval'], '우륵': ['orator'],
  '말갈추장': ['cavalry'], '왜왕': ['naval'],
};

const OFFICER_TIES = {
  bonds: [
    ['수로왕', '허황옥'],
    ['태종무열왕', '김유신', '문무왕'],
    ['온조왕', '고이왕', '근초고왕'],
  ],
  enemies: [['계백', '김유신'], ['관창', '계백']],
  rivals: [['연개소문', '온달']],
};

// Ruler titles, by tier. (Numbers era-agnostic; names localised.)
const TITLES = [
  { tier: 0, name: '성주',   prestige: 0,  cities: 0,  slots: 2 },
  { tier: 1, name: '태수',   prestige: 15, cities: 3,  slots: 4 },
  { tier: 2, name: '대공',   prestige: 35, cities: 8,  slots: 8 },
  { tier: 3, name: '왕',     prestige: 55, cities: 12, slots: 16 },
  { tier: 4, name: '태왕',   prestige: 70, cities: 18, slots: 99 },
];
const RANKS = ['', '당주', '장군', '대장군'];
const RANK_COST = [0, 300, 800, 2000];

// Outstations raised outside a city's walls. (Era-agnostic.)
const SITE_TYPES = {
  mine:    { label: '광산',   glyph: '⛏', cost: 800, hexes: 'm',    near: [2, 6], max: 1, gold: 120, desc: '구리와 철: 월 +120금, 성벽 축조비 1/5 절감. 약탈하면 금.' },
  village: { label: '촌락',   glyph: '⌂', cost: 400, hexes: 'a',    near: [2, 6], max: 3, food: 600, desc: '농촌: 월 +600 식량(곡창에선 1/4 더), 인구 증가 촉진. 약탈당하면 식량과 민심 손실.' },
  pasture: { label: '목장',   glyph: '♞', cost: 600, hexes: 'p',    near: [2, 4], max: 1, desc: '말을 기른다: 병사가 더 훈련된 채 오고, 평지 돌격이 강해진다. 약탈하면 말.' },
  lumber:  { label: '벌목장', glyph: '♣', cost: 400, hexes: 'f',    near: [2, 6], max: 1, desc: '목재: 성벽·배 비용 3/10 절감. 공격 시 공성기 제작.' },
  docks:   { label: '선착장', glyph: '⚓', cost: 600, hexes: 'pafh', near: [2, 5], max: 1, gold: 80, water: true, desc: '물가 부두: 월 +80금, 조선 2배. 수군이 손실 없이 상륙.' },
  salt:    { label: '염전',   glyph: '✶', cost: 700, hexes: 'pa',   near: [2, 6], max: 1, gold: 200, coast: true, desc: '바다 소금: 월 +200금. 약탈자에게 좋은 먹잇감.' },
  tower:   { label: '망루',   glyph: '♜', cost: 500, hexes: 'h',    near: [2, 3], max: 1, desc: '성 곁 언덕의 봉화 요새: 첩자를 절반 잡고, 전투에서 거점(+25% 수비).' },
  market:  { label: '저자',   glyph: '⚖', cost: 500, hexes: 'pa',   near: [2, 3], max: 1, gold: 100, road: true, desc: '성문 밖 길가 저자: 월 +100금. 약탈하면 금.' },
};
const SITE_ORDER = ['mine', 'docks', 'village', 'salt', 'market', 'pasture', 'lumber', 'tower'];

// Random generated-officer name pools (Korean).
const SURNAMES = ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임', '한', '오', '서', '신', '권', '황', '안', '송', '전', '홍', '고', '문', '양', '손', '배', '백', '허', '유', '남', '심', '노', '하', '곽', '성', '차', '주', '우', '구', '민', '류'];
const GIVEN = ['수', '진', '덕', '무', '문', '충', '현', '웅', '용', '경', '식', '랑', '보', '성', '명', '원', '건', '흥', '달', '순', '민', '정', '길', '효', '량', '선', '지', '근', '춘', '서', '비', '모', '을', '도', '화', '위', '복', '산'];

// Treasures. owner starts with it; city hides it to be found by Search.
const ITEMS = [
  { id: 'chiljido',  name: '칠지도(七支刀)',   type: 'weapon', bonus: { war: 4 }, owner: '근초고왕', desc: '백제가 왜왕에게 하사한 일곱 가지 칼. 무력 +4.' },
  { id: 'gayageum',  name: '가야금',           type: 'book',   bonus: { int: 3 }, owner: '우륵',     desc: '우륵이 지은 열두 곡의 가야금. 지력 +3.' },
  { id: 'cheonma',   name: '천리마',           type: 'horse',  bonus: { ldr: 4 }, owner: '온달',     desc: '하루 천 리를 달리는 명마. 통솔 +4, 일기토와 탈출에 유리.' },
  { id: 'yeongnak',  name: '영락대왕 금인(金印)', type: 'seal', bonus: {},         owner: '광개토대왕', desc: '독자 연호 영락을 새긴 금인. 위세를 더한다.' },
  { id: 'gaema',     name: '개마갑주(鎧馬甲冑)', type: 'armour', bonus: { war: 2 }, guard: true, owner: null, city: 'gungnae', desc: '말까지 갑옷으로 두른 고구려 중장기병의 갑주. 무력 +2, 일기토에서 죽지 않는다.' },
  { id: 'geumgwan',  name: '신라 금관(金冠)',   type: 'seal',   bonus: {}, prestige: 5, owner: null, city: 'geumseong', desc: '서라벌의 금관. 차지한 가문의 위세가 오른다. 위세 +5.' },
  { id: 'hwandudaedo', name: '환두대도(環頭大刀)', type: 'weapon', bonus: { war: 3 }, owner: null, city: 'sabi', desc: '고리자루 큰 칼. 백제 무사의 상징. 무력 +3.' },
  { id: 'gaya-sword', name: '가야 단조검',      type: 'weapon', bonus: { war: 2 }, owner: null, city: 'gimhae', desc: '낙동강 하류의 좋은 쇠로 벼린 가야의 검. 무력 +2.' },
];

// Officers who die in history at a given year [name, year, month, cause].
// Only dates after the 554 opening can fire; the all-star elders of 554
// (founders and kings of old) are left to live out their evening years.
const HISTORICAL_DEATHS = [
  ['진흥왕',   576, 7,  '병으로 서라벌의 궁중에서, 순수비의 비문을 남기고'],
  ['온달',     590, 8,  '한강 수복전 중 아차산성 아래에서 화살을 맞고'],
  ['을지문덕', 618, 6,  '살수의 공명을 뒤로 하고 병으로'],
  ['선덕여왕', 647, 2,  '병으로 서라벌의 궁중에서, 첨성대를 남기고'],
  ['성충',     656, 3,  '의자왕을 간하다 옥중에서'],
  ['계백',     660, 7,  '황산벌에서 오천 결사대와 함께 싸우다'],
  ['의자왕',   660, 11, '당으로 압송된 뒤 객지에서'],
  ['태종무열왕', 661, 6, '백제 정벌의 대업을 문무왕에게 남기고 병으로'],
  ['복신',     663, 7,  '부흥군의 내분 속에 부여풍에게 처형되어'],
  ['도침',     663, 7,  '부흥군의 내분 속에 목숨을 잃고'],
  ['연개소문', 666, 1,  '병으로 평양에서, 세 아들을 남기고'],
  ['검모잠',   672, 4,  '고구려 부흥을 이루지 못하고 오골성에서'],
  ['김유신',   673, 7, '삼국통일의 위업을 뒤로 하고 병으로'],
  ['문무왕',   681, 7,  '통일 신라의 기틀을 다지고 병으로'],
  ['흑치상지', 689, 9,  '당의 조정에서 객사하여'],
  ['김인문',   694, 4,  '당에 머물며 신라와 당 사이를 잇다 객사하여'],
];
// Officers of the seventh century, arriving on their debut years.
// [name, LDR, WAR, INT, POL, CHR, born, debut year, city, house to join]
// If the house they served still lives and holds a city they join it at
// once; otherwise they wait there as free talents for whoever holds the town.
const LATER_OFFICERS = [
  ['을지문덕',   98, 88, 95, 78, 88, 550, 595, 'pyongyang', 'goguryeo'],
  ['연개소문',   92, 86, 85, 88, 80, 594, 630, 'gungnae',   'goguryeo'],
  ['선덕여왕',   70, 40, 88, 90, 90, 580, 632, 'geumseong', 'silla'],
  ['양만춘',     90, 85, 82, 60, 78, 600, 640, 'ansi',      'goguryeo'],
  ['김유신',     95, 92, 85, 80, 90, 595, 640, 'geumseong', 'silla'],
  ['태종무열왕', 82, 65, 90, 95, 92, 603, 640, 'geumseong', 'silla'],
  ['성충',       58, 42, 90, 86, 74, 600, 640, 'sabi',      'baekje'],
  ['의자왕',     78, 76, 70, 66, 72, 599, 641, 'sabi',      'baekje'],
  ['김인문',     78, 74, 80, 78, 82, 629, 651, 'geumseong', 'silla'],
  ['계백',       88, 96, 66, 50, 84, 620, 655, 'wansan',    'baekje'],
  ['연남생',     85, 82, 78, 75, 72, 634, 655, 'gungnae',   'goguryeo'],
  ['문무왕',     85, 72, 85, 88, 85, 626, 655, 'geumseong', 'silla'],
  ['흑치상지',   90, 90, 72, 62, 78, 630, 658, 'wansan',    'baekje'],
  ['연남건',     82, 84, 70, 68, 66, 636, 659, 'pyongyang', 'goguryeo'],
  ['관창',       70, 82, 50, 40, 82, 645, 660, 'daeya',     'silla'],
  ['복신',       72, 68, 80, 76, 70, 615, 660, 'sabi',      'baekje'],
  ['부여풍',     70, 72, 68, 64, 68, 625, 661, 'ungjin',    'baekje'],
  ['도침',       55, 40, 82, 80, 72, 620, 661, 'ungjin',    'baekje'],
  ['검모잠',     78, 80, 65, 60, 66, 630, 668, 'ansi',      'goguryeo'],
];
const SCENARIO_CREATED = [];

// Starting diplomacy between houses.
const INITIAL_RELATIONS = [
  ['goguryeo', 'baekje', -60],
  ['goguryeo', 'silla', -50],
  ['baekje', 'silla', -30],
  ['silla', 'gaya', -20],
  ['baekje', 'gaya', 10],
  ['goguryeo', 'malgal', -40],
  ['baekje', 'wae', 20],
  ['silla', 'wae', -50],
];

const baseRoster = (fid) => OFFICERS.filter((o) => o[6] === fid).map((o) => o[0]);

// Scenarios: the base 554 scenario plus historical bookmarks.
const SCENARIOS = [
  { id: '554', title: '삼국쟁패(三國爭霸)', year: 554, month: 1, base: true,
    intro: SCENARIO.intro },
  {
    id: '642',
    title: '연개소문 정변(淵蓋蘇文政變)',
    year: 642,
    month: 1,
    intro:
      '연개소문이 정변을 일으켜 권력을 장악하고 당의 침략에 맞서 북방을 굳건히 지킨다. ' +
      '백제 의자왕은 대야성을 함락시키며 신라를 거세게 압박하고, 위기에 몰린 신라는 선덕여왕과 김유신을 중심으로 결전을 준비한다. ' +
      '삼국의 대립이 극에 달한 가운데 백제는 바다 건너 왜와 손을 잡는다.',
    emperor: 'goguryeo',
    houses: {
      goguryeo: {
        ruler: '연개소문',
        cities: ['pyongyang', 'gungnae', 'jolbon', 'yodong', 'ansi', 'sinseong', 'buyeo'],
        officers: ['연개소문', '양만춘'],
      },
      baekje: {
        ruler: '의자왕',
        cities: ['sabi', 'ungjin', 'wiryeseong', 'wansan', 'tamra', 'daeya'],
        officers: ['의자왕', '성충'],
      },
      silla: {
        ruler: '선덕여왕',
        cities: ['geumseong', 'sabeol', 'samnyeon', 'danghang', 'siljik', 'gimhae', 'goryeong'],
        officers: ['선덕여왕', '김유신', '태종무열왕'],
      },
      wae: {
        ruler: '왜왕',
        cities: ['daema'],
        officers: ['왜왕', '아리수'],
      },
      malgal: {
        ruler: '말갈추장',
        cities: ['chaekseong'],
        officers: ['말갈추장', '걸사비우'],
      },
    },
    relations: [
      ['goguryeo', 'silla', -60],
      ['baekje', 'silla', -70],
      ['goguryeo', 'baekje', -50],
      ['baekje', 'wae', 40],
      ['silla', 'wae', -50],
      ['goguryeo', 'malgal', -40],
    ],
    treaties: [],
  },
  {
    id: '660',
    title: '백제 멸망전(百濟滅亡戰)',
    year: 660,
    month: 1,
    intro:
      '나당연합군이 수륙 양면으로 백제를 침공하자 신라의 태종무열왕과 김유신이 당항성을 통해 대군을 이끈다. ' +
      '사비와 웅진에 고립된 백제는 의자왕과 계백의 결사대가 최후의 항전을 펼치며 왜와의 동맹에 희망을 건다. ' +
      '북방에서는 연개소문의 고구려가 정세를 주시하며 삼국의 운명이 결판나려 한다.',
    emperor: 'goguryeo',
    houses: {
      goguryeo: {
        ruler: '연개소문',
        cities: ['pyongyang', 'gungnae', 'jolbon', 'yodong', 'ansi', 'sinseong', 'buyeo'],
        officers: ['연개소문', '양만춘'],
      },
      baekje: {
        ruler: '의자왕',
        cities: ['sabi', 'ungjin', 'wiryeseong', 'wansan', 'tamra'],
        officers: ['의자왕', '계백', '흑치상지', '성충'],
      },
      silla: {
        ruler: '태종무열왕',
        cities: ['geumseong', 'sabeol', 'samnyeon', 'danghang', 'daeya', 'siljik', 'gimhae', 'goryeong'],
        officers: ['태종무열왕', '김유신', '관창', '문무왕'],
      },
      wae: {
        ruler: '왜왕',
        cities: ['daema'],
        officers: ['왜왕', '아리수'],
      },
      malgal: {
        ruler: '말갈추장',
        cities: ['chaekseong'],
        officers: ['말갈추장', '걸사비우'],
      },
    },
    relations: [
      ['baekje', 'silla', -90],
      ['goguryeo', 'silla', -70],
      ['baekje', 'wae', 60],
      ['silla', 'wae', -60],
      ['goguryeo', 'baekje', -30],
      ['goguryeo', 'malgal', -40],
    ],
    treaties: [['baekje', 'wae', 'alliance']],
  },
];

// ------------------------------------------------------------------
//  Encyclopaedia: short biographies, city notes, event flavour.
// ------------------------------------------------------------------
const BIOS = {
  '광개토대왕': '만 열여덟에 즉위해 독자 연호 영락을 세우고 백제를 굴복시켰으며 후연·거란·숙신을 쳐 만주 벌판을 호령한 고구려 최대의 정복군주.',
  '장수왕': '아흔아홉 해를 살며 평양으로 천도하고 남진하여 백제 한성을 함락, 고구려의 최전성기를 이끈 임금.',
  '을지문덕': '살수에서 수나라 삼십만 별동대를 수공과 매복으로 궤멸시킨 구국의 명장.',
  '연개소문': '정변으로 대막리지에 올라 권력을 쥐고 당 태종의 침략에 맞서 강력한 항전을 이끈 지도자.',
  '온달': '바보 온달이라 불렸으나 평원왕의 사위가 되어 후주군을 격퇴하고, 한강 수복전 중 아차산성에서 전사한 맹장.',
  '소수림왕': '불교를 받아들이고 태학을 세워 고구려를 율령국가로 이끈 임금.',
  '양만춘': '안시성 성주로 당 태종의 대군을 끝까지 막아내 요동 방어선을 지킨 명장.',
  '명림답부': '고구려의 좌가려(左加麗). 한(漢)과의 전쟁에서 군을 거느리고 출전한 초기 고구려의 대신.',
  '을파소': '고국천왕의 국상. 진대법으로 흉년에 곡식을 나누어 백성을 구한 명재상.',
  '고노자': '미천왕의 장수. 서안평을 함락해 요동 진출의 길을 연 맹장.',
  '괴유': '고구려 초기의 용맹한 장수로 북방 개척에 앞장섰다.',
  '근초고왕': '마한을 아우르고 고구려 평양성을 쳐 고국원왕을 전사시켰으며, 바다 건너 왜·동진과 통한 백제의 전성기 군주.',
  '온조왕': '주몽의 아들로 하남 위례성에 백제를 세운 시조.',
  '고이왕': '율령을 반포하고 관등제를 정비해 백제를 율령국가의 기틀 위에 올린 임금.',
  '무령왕': '웅진 시대 백제를 중흥시키고 양·왜와 활발히 교류한 임금. 무령왕릉이 그의 위세를 전한다.',
  '의자왕': '백제의 마지막 왕. 황산벌의 패전 뒤 사비성이 함락되며 나라와 운명을 함께했다.',
  '목라근자': '근초고왕의 장수. 평양성 공격의 선봉에 서서 고구려의 고국원왕을 전사시킨 맹장.',
  '성충': '의자왕의 좌평. 나라의 위태로움을 간하다 옥중에서 죽은 충신.',
  '성왕': '사비로 천도하고 국호를 남부여로 고쳤으며 한강을 일시 회복했으나 관산성에서 전사한 임금.',
  '계백': '황산벌에서 오천 결사대로 신라 오만 대군에 맞서 끝까지 싸우다 전사한 백제 최후의 명장.',
  '흑치상지': '백제 멸망 뒤 임존성에서 삼만 유민을 모아 부흥운동을 이끈 장수.',
  '김유신': '황산벌의 승리와 백제·고구려 정벌을 지휘하여 삼국통일 전쟁을 총괄한 신라 최고의 명장.',
  '진흥왕': '화랑도를 정비하고 한강 유역과 대가야를 정복해 신라 최대 판도를 이루고 순수비를 세운 임금.',
  '이사부': '우산국을 복속하고 대가야를 토벌한 명장이자 정치가.',
  '거칠부': '국사 편찬을 건의하고 진흥왕을 보좌해 율령 정비에 힘쓴 신라의 문신.',
  '관창': '황산벌에서 홀로 적진에 거듭 뛰어들어 전사함으로써 신라군의 사기를 끌어올린 소년 화랑.',
  '연남생': '연개소문의 맏아들. 아우 남건과의 다툼 끝에 당에 투항해 고구려 멸망의 길을 열었다.',
  '연남건': '연개소문의 둘째 아들. 형 남생을 몰아내고 평양을 지켰으나 나당연합군에 나라를 잃었다.',
  '부여풍': '백제 왕자. 부흥군이 추대해 임존성에 섰으나 나당군에 패해 고구려로 달아났다.',
  '복신': '백제 부흥운동의 주역. 부여풍을 왕으로 세웠으나 내분 끝에 목숨을 잃었다.',
  '도침': '주류성의 승려 출신 부흥군 지도자. 복신과 함께 백제 재건을 꾀했다.',
  '검모잠': '고구려 부흥운동의 지도자. 오골성에서 군을 일으켰으나 뜻을 이루지 못했다.',
  '김인문': '태종무열왕의 아들로 당에 머물며 나당 사이를 이은 신라의 외교관.',
  '태종무열왕': '진골 최초의 임금 김춘추. 나당동맹을 성사시켜 백제를 멸하고 통일의 기틀을 놓았다.',
  '문무왕': '나당연합으로 백제와 고구려를 멸하고 삼국통일을 완성한 임금.',
  '법흥왕': '율령을 반포하고 불교를 공인했으며 금관가야를 병합해 신라의 기틀을 다진 임금.',
  '내물마립간': '마립간 칭호를 처음 쓰고 김씨 왕위 세습을 확립한 신라의 임금.',
  '선덕여왕': '신라 최초의 여왕. 첨성대와 황룡사 구층탑을 세워 국난을 신앙으로 넘고자 했다.',
  '수로왕': '구지봉 설화의 주인공이자 금관가야를 세운 시조.',
  '구형왕': '금관가야의 마지막 왕. 신라 법흥왕에게 항복해 가야의 한 시대가 막을 내렸다.',
  '이뇌왕': '대가야의 왕으로 낙동강 상류 가야 연맹의 한 축을 지켰다.',
  '허황옥': '바다를 건너와 수로왕의 왕비가 된 금관가야의 시조모.',
  '우륵': '가실왕의 명으로 가야금과 열두 곡을 지은 악성.',
};
const CITY_NOTES = {
  pyongyang: '대동강가의 고구려 수도. 장수왕이 국내성에서 이곳으로 천도해 남진의 거점으로 삼았다.',
  gungnae: '압록강 중류 집안의 평지 도성. 사백여 년간 고구려의 중심이었다.',
  jolbon: '주몽이 나라를 세운 첫 도읍. 험준한 오녀산성의 천연 요새.',
  yodong: '요하 동쪽의 큰 성. 중국으로 통하는 서쪽 관문이자 여러 차례 공방의 무대.',
  ansi: '당 태종의 대군을 물리친 요동의 전략 요새.',
  buyeo: '북방 송화강 유역, 부여의 옛 터이자 말갈·물길에 면한 변경.',
  wiryeseong: '한강가의 백제 첫 도읍. 온조왕 이래 오백 년, 장수왕에게 함락될 때까지의 왕성.',
  ungjin: '한성 함락 뒤 문주왕이 천도한 금강가의 산성(공산성).',
  sabi: '성왕이 천도한 백제 말기의 수도. 부소산성과 함께 최후의 방어 거점이었다.',
  wansan: '호남의 곡창을 낀 백제 남방의 거점.',
  tamra: '남쪽 바다의 섬나라. 백제에 조공한 탐라.',
  geumseong: '서라벌의 월성. 신라 천년의 심장부.',
  sabeol: '낙동강 상류의 곡창, 신라 서북 방어의 요지(상주).',
  samnyeon: '보은의 석축 산성. 백제·고구려를 견제하고 한강 진출의 발판이 되었다.',
  danghang: '서해로 당과 직접 통하기 위한 신라의 해상 관문.',
  daeya: '합천의 요새. 백제와 신라가 다툰 서부 국경의 길목.',
  siljik: '동해안 북쪽의 신라 변경(삼척).',
  gimhae: '낙동강 하구, 철과 바다로 번성한 금관가야의 왕도.',
  goryeong: '후기 가야연맹의 맹주 대가야의 궁성.',
  daema: '현해탄의 섬. 왜의 수군이 남해안을 노리는 전진기지.',
  chaekseong: '두만강 유역 북옥저의 옛 땅, 말갈이 드나드는 북방 요새.',
};
const HISTORY_NOTES = {
  '554-1': '백제 성왕이 한강을 되찾고자 신라와 맞선다. 삼국의 패권 다툼이 절정에 이른다.',
};
