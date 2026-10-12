// ============================================================
//  삼국시대 — scripted history and house objectives.
//  EVENTS는 지도 위의 형세(when)가 허락할 때만 발동한다: 연도는
//  역사의 때를, 조건은 그 시대의 처지를 가리킨다. 플레이어의
//  가문은 결정(decision)을 직접 고르고, AI는 가중치(ai)로 고른다.
//  OBJECTIVES는 각 가문의 역사적 지향을 hold 조건으로 담은 묶음이다.
// ============================================================

// 병력을 특정 도시에 모은다. 그 도시가 우리 땅이 아니면 첫 도시에 둔다.
const muster = (E, S, fid, cityId, n) => {
  const p = S.provinces[cityId] && S.provinces[cityId].owner === fid
    ? S.provinces[cityId]
    : E.factionProvinces(fid)[0];
  if (p) p.troops += n;
};
const alive = (S, fid) => !!(S.factions[fid] && S.factions[fid].alive && !S.factions[fid].guest);
const serves = (S, name, fid) => !!(S.officers[name] && S.officers[name].faction === fid && !S.officers[name].captive);
const holds = (S, fid, cityId) => S.provinces[cityId] && S.provinces[cityId].owner === fid;

const EVENTS = [
  // ---------------------------------------------------------- 관산성과 6세기
  {
    id: 'gwansan-campaign', title: '관산성의 북진',
    from: [554, 1], to: [557, 12],
    when: (E, S) => {
      if (!alive(S, 'baekje') || !alive(S, 'goguryeo')) return null;
      if (!serves(S, '성왕', 'baekje')) return null;
      if (!holds(S, 'goguryeo', 'pyongyang')) return null;
      return {};
    },
    apply: (E, S) => {
      muster(E, S, 'baekje', 'ungjin', 5000);
      E.prestige('baekje', 8);
      E.shiftRelation('baekje', 'goguryeo', -25);
      return '성왕이 신라 진흥왕과 손잡고 옛 한강 땅 회복에 나선다. 백제군이 웅진을 앞세워 관산성 방면으로 북진하고, 고구려와의 칼끝이 다시 선다. 웅진 병력 +5000, 위세 +8.';
    },
  },
  {
    id: 'jinheung-tour', minor: true, title: '진흥왕의 순수비',
    from: [555, 1], to: [561, 12],
    when: (E, S) => {
      if (!alive(S, 'silla')) return null;
      if (!holds(S, 'silla', 'samnyeon') || !holds(S, 'silla', 'sabeol')) return null;
      return {};
    },
    apply: (E, S) => {
      E.prestige('silla', 8);
      E.gold('silla', 2000);
      return '진흥왕이 새로 얻은 북방 땅을 두루 돌아보고 북한산과 마운령에 순수비를 세운다. 신라의 위세가 천하에 떨친다. 위세 +8, 금 +2000.';
    },
  },
  {
    id: 'isabu-gaya', title: '이사부의 대가야 정벌',
    from: [562, 1], to: [566, 12],
    when: (E, S) => {
      if (!alive(S, 'silla') || !alive(S, 'gaya')) return null;
      if (!serves(S, '이사부', 'silla')) return null;
      if (!holds(S, 'silla', 'daeya')) return null;
      if (S.provinces.goryeong.owner !== 'gaya') return null;
      return {};
    },
    apply: (E, S) => {
      muster(E, S, 'silla', 'daeya', 4000);
      E.prestige('silla', 8);
      E.shiftRelation('silla', 'gaya', -25);
      return '이사부가 대야성을 발판 삼아 고령의 대가야를 친다. 낙동강 상류에 신라의 깃발이 오르고, 가야 연맹이 흔들린다. 대야성 병력 +4000, 위세 +8.';
    },
  },
  // ---------------------------------------------------------- 7세기의 전쟁
  {
    id: 'salsu-triumph', title: '살수의 개선',
    from: [612, 1], to: [615, 12],
    when: (E, S) => {
      if (!alive(S, 'goguryeo')) return null;
      if (!serves(S, '을지문덕', 'goguryeo')) return null;
      if (!holds(S, 'goguryeo', 'yodong') || !holds(S, 'goguryeo', 'ansi') || !holds(S, 'goguryeo', 'sinseong')) return null;
      return {};
    },
    apply: (E, S) => {
      E.prestige('goguryeo', 15);
      E.troops('goguryeo', 6000);
      E.gold('goguryeo', 2000);
      return '을지문덕이 살수에서 북방의 백만 대군을 수공과 매복으로 무너뜨리고 개선한다. 요동 방벽은 굳건하고 평양의 위세는 하늘을 찌른다. 병력 +6000, 위세 +15, 금 +2000.';
    },
  },
  {
    id: 'cheolli-wall', title: '천리장성의 축성',
    from: [631, 1], to: [634, 12],
    when: (E, S) => {
      if (!alive(S, 'goguryeo')) return null;
      if (!holds(S, 'goguryeo', 'yodong') || !holds(S, 'goguryeo', 'ansi')) return null;
      const seat = E.factionProvinces('goguryeo')[0];
      if (!seat || seat.gold < 2000) return null;
      return {};
    },
    apply: (E, S) => {
      E.gold('goguryeo', -2000);
      muster(E, S, 'goguryeo', 'yodong', 2000);
      muster(E, S, 'goguryeo', 'ansi', 2000);
      E.prestige('goguryeo', 8);
      return '고구려가 요동에서 압록강 어귀까지 천 리의 장성을 쌓는다. 국고는 비지만 변경의 성벽마다 병사가 들어찬다. 금 −2000, 요동·안시 병력 각 +2000, 위세 +8.';
    },
  },
  {
    id: 'seondeok-tower', minor: true, title: '첨성대의 건립',
    from: [632, 1], to: [635, 12],
    when: (E, S) => {
      if (!alive(S, 'silla')) return null;
      if (!serves(S, '선덕여왕', 'silla')) return null;
      if (!holds(S, 'silla', 'geumseong')) return null;
      return {};
    },
    apply: (E, S) => {
      E.prestige('silla', 5);
      E.gold('silla', 1000);
      return '선덕여왕이 서라벌에 돌을 쌓아 하늘을 보는 대를 세운다. 백성의 마음이 모이고 사방에서 조공이 온다. 위세 +5, 금 +1000.';
    },
  },
  {
    id: 'yeon-takes-power', title: '연개소문의 집권',
    from: [642, 1], to: [646, 12],
    when: (E, S) => {
      if (!alive(S, 'goguryeo')) return null;
      if (!serves(S, '연개소문', 'goguryeo')) return null;
      if (!holds(S, 'goguryeo', 'gungnae') || !holds(S, 'goguryeo', 'pyongyang')) return null;
      return {};
    },
    decision: {
      house: 'goguryeo',
      prompt: (E, S) => '연개소문이 정변으로 대막리지에 올라 고구려의 전권을 쥔다. 북방의 당이 호시탐탐 노리는 이때, 새 집권자에게 무엇을 맡길 것인가.',
      options: [
        { label: '개혁과 북방 강화', ai: 0.75, apply: (E, S) => {
          muster(E, S, 'goguryeo', 'gungnae', 5000);
          E.prestige('goguryeo', 10);
          E.shiftRelation('goguryeo', 'baekje', -10);
          E.shiftRelation('goguryeo', 'silla', -10);
          return '연개소문이 율령을 다잡고 북방 요새에 병사를 채운다. 고구려는 철옹성이 되지만 이웃 나라들은 그 위세를 경계한다. 국내성 병력 +5000, 위세 +10.';
        } },
        { label: '기존 질서를 지킨다', ai: 0.25, apply: (E) => {
          E.prestige('goguryeo', 3);
          return '연개소문은 전권을 쥐되 옛 대신들과 타협한다. 나라는 조용하지만 북방의 먹구름은 그대로다. 위세 +3.';
        } },
      ],
    },
  },
  {
    id: 'ansi-defense', title: '안시성의 항전',
    from: [645, 1], to: [648, 12],
    when: (E, S) => {
      if (!alive(S, 'goguryeo')) return null;
      if (!serves(S, '양만춘', 'goguryeo')) return null;
      if (!holds(S, 'goguryeo', 'ansi')) return null;
      return {};
    },
    apply: (E, S) => {
      muster(E, S, 'goguryeo', 'ansi', 5000);
      E.prestige('goguryeo', 10);
      return '북방의 대군이 안시성을 겹겹이 에워싸도 양만춘은 성을 버리지 않는다. 성안의 병사들은 서로를 돌아보며 버티고, 포위는 풀린다. 안시성 병력 +5000, 위세 +10.';
    },
  },
  {
    id: 'chunchoo-alliance', title: '김춘추의 나당동맹',
    from: [648, 1], to: [654, 12],
    when: (E, S) => {
      if (!alive(S, 'silla')) return null;
      if (!serves(S, '태종무열왕', 'silla')) return null;
      if (!holds(S, 'silla', 'geumseong')) return null;
      if (!alive(S, 'baekje') && !alive(S, 'goguryeo')) return null;
      return {};
    },
    decision: {
      house: 'silla',
      prompt: (E, S) => '김춘추가 바다 건너 당에 가서 손을 잡자고 청한다. 백제와 고구려를 함께 칠 동맹이냐, 홀로 서는 자존이냐.',
      options: [
        { label: '당과 손잡고 남북을 친다', ai: 0.7, apply: (E, S) => {
          E.prestige('silla', 10);
          E.troops('silla', 6000);
          if (alive(S, 'baekje')) E.shiftRelation('silla', 'baekje', -30);
          if (alive(S, 'goguryeo')) E.shiftRelation('silla', 'goguryeo', -30);
          return '나당동맹이 맺어진다. 당의 군세가 바다를 건너오고 신라군은 백제와 고구려를 향해 창을 겨눈다. 병력 +6000, 위세 +10.';
        } },
        { label: '홀로 서는 길을 간다', ai: 0.3, apply: (E) => {
          E.prestige('silla', 5);
          E.gold('silla', 2000);
          return '신라는 외세의 힘을 빌리지 않고 스스로 일어선다. 당은 섭섭해하지만 국고는 두둑해진다. 위세 +5, 금 +2000.';
        } },
      ],
    },
  },
  // ---------------------------------------------------------- 660년대의 결전
  {
    id: 'hwangsan-stand', title: '황산벌의 결사대',
    from: [660, 1], to: [661, 12],
    when: (E, S) => {
      if (!alive(S, 'baekje') || !alive(S, 'silla')) return null;
      if (!holds(S, 'baekje', 'sabi')) return null;
      if (!E.bordering('silla', 'baekje')) return null;
      return { hero: serves(S, '계백', 'baekje') };
    },
    apply: (E, S, ctx) => {
      muster(E, S, 'baekje', 'wansan', 6000);
      E.prestige('baekje', 12);
      E.shiftRelation('silla', 'baekje', -30);
      return ctx.hero
        ? '계백이 오천 결사대를 모아 황산벌에 나선다. 처자식을 먼저 보내고 돌아오지 않을 싸움에 든다. 온 나라가 그 뒤에 선다. 완산주 병력 +6000, 위세 +12.'
        : '신라 대군이 밀려오자 백제의 장정들이 황산벌에 모여 결사대로 선다. 나라의 마지막 힘이 한 벌판에 모인다. 완산주 병력 +6000, 위세 +12.';
    },
  },
  {
    id: 'imjon-resistance', title: '임존성의 부흥군',
    from: [660, 1], to: [663, 12],
    when: (E, S) => {
      if (!alive(S, 'baekje')) return null;
      if (E.factionProvinces('baekje').length > 2) return null;
      return {};
    },
    apply: (E, S) => {
      const seat = E.factionProvinces('baekje')[0];
      muster(E, S, 'baekje', seat ? seat.id : 'ungjin', 4000);
      E.prestige('baekje', 8);
      return '사비가 함락되어도 백제의 불씨는 꺼지지 않는다. 유민과 패잔병이 임존성에 모여 부흥의 깃발을 든다. 병력 +4000, 위세 +8.';
    },
  },
  {
    id: 'unification-banner', title: '삼국통일의 기치',
    from: [667, 1], to: [690, 12],
    when: (E, S) => {
      if (!alive(S, 'silla') || !alive(S, 'goguryeo')) return null;
      if (!holds(S, 'silla', 'geumseong') || !holds(S, 'silla', 'sabi')) return null;
      return {};
    },
    apply: (E, S) => {
      E.prestige('silla', 15);
      E.troops('silla', 8000);
      E.shiftRelation('silla', 'goguryeo', -30);
      return '백제를 넘어선 신라의 군세가 평양을 압박한다. 나당연합군의 깃발 아래 삼국통일의 기치가 오른다. 병력 +8000, 위세 +15.';
    },
  },
];

const OBJECTIVES = [
  { id: 'gg-hangang', house: 'goguryeo', title: '한강 유역 장악', desc: '위례성(한성)과 당항성을 차지하라.', from: 554, to: 668, hold: ['wiryeseong', 'danghang'],
    reward: (E, S) => { E.troops('goguryeo', 8000); E.prestige('goguryeo', 10); return '한강 유역의 장정이 고구려 깃발 아래 모여든다. 병력 +8000, 위세 +10.'; } },
  { id: 'gg-yodong', house: 'goguryeo', title: '요동의 방벽', desc: '요동성·안시성·신성을 굳게 지켜라.', from: 554, to: 668, hold: ['yodong', 'ansi', 'sinseong'],
    reward: (E, S) => { E.gold('goguryeo', 4000); E.prestige('goguryeo', 10); return '요동 방벽이 굳건해져 변경의 공물이 평양으로 모인다. 금 +4000, 위세 +10.'; } },

  { id: 'bj-hanseong', house: 'baekje', title: '옛 도읍의 회복', desc: '위례성과 웅진성을 차지하라.', from: 554, to: 668, hold: ['wiryeseong', 'ungjin'],
    reward: (E, S) => { E.troops('baekje', 6000); E.prestige('baekje', 10); return '한성의 옛 백성이 돌아와 군문에 든다. 병력 +6000, 위세 +10.'; } },
  { id: 'bj-gaya', house: 'baekje', title: '낙동강의 맹주', desc: '김해(금관가야)와 고령(대가야)을 차지하라.', from: 554, to: 668, hold: ['gimhae', 'goryeong'],
    reward: (E, S) => { E.gold('baekje', 4000); E.food('baekje', 30000); E.prestige('baekje', 10); return '가야의 철과 바다가 백제의 것이 된다. 금 +4000, 식량 +30000, 위세 +10.'; } },

  { id: 'sl-hangang', house: 'silla', title: '한강 진출', desc: '위례성·당항성·삼년산성을 차지하라.', from: 554, to: 668, hold: ['wiryeseong', 'danghang', 'samnyeon'],
    reward: (E, S) => { E.troops('silla', 6000); E.prestige('silla', 15); return '한강 유역을 얻은 신라의 위세가 천하에 떨친다. 병력 +6000, 위세 +15.'; } },
  { id: 'sl-gaya', house: 'silla', title: '가야 병합', desc: '대야성·고령(대가야)·김해(금관가야)를 차지하라.', from: 554, to: 668, hold: ['daeya', 'goryeong', 'gimhae'],
    reward: (E, S) => { E.gold('silla', 4000); E.prestige('silla', 15); return '낙동강 유역이 신라에 복속되어 조공이 끊이지 않는다. 금 +4000, 위세 +15.'; } },

  { id: 'gy-guard', house: 'gaya', title: '낙동강 연맹의 수호', desc: '김해·고령·대야성을 차지하라.', from: 554, to: 668, hold: ['gimhae', 'goryeong', 'daeya'],
    reward: (E, S) => { E.troops('gaya', 4000); E.gold('gaya', 3000); E.prestige('gaya', 15); return '철의 연맹이 굳게 뭉쳐 외적을 막아낸다. 병력 +4000, 금 +3000, 위세 +15.'; } },
];

// DESTINY: where each house's ambition points it, by period. The AI weighs
// these cities more heavily when it chooses what to take. (from/to span the
// whole era here, since the one scenario is a single year.)
const DESTINY = {
  goguryeo: [
    { from: 1, to: 700, targets: ['wiryeseong', 'danghang', 'ungjin', 'samnyeon', 'siljik'] },
  ],
  baekje: [
    { from: 1, to: 700, targets: ['wiryeseong', 'danghang', 'samnyeon', 'daeya', 'goryeong', 'geumseong'] },
  ],
  silla: [
    { from: 1, to: 700, targets: ['daeya', 'goryeong', 'gimhae', 'samnyeon', 'danghang', 'wiryeseong'] },
  ],
  gaya: [
    { from: 1, to: 700, targets: ['daeya', 'sabeol', 'wansan'] },
  ],
};