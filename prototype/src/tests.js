/* WordShip prototype — 자가 검증 (v0.4 실시간)
 * 0단계의 목표는 "규칙이 의도대로 발동하는가"다. 이 파일이 그 답이다.
 * 밸런스는 보지 않는다. 오직 규칙의 발동 여부만 본다.
 */
(function (WS) {
  'use strict';

  var X = WS.game, Hg = WS.hangul, B = WS.BALANCE;
  var C = X.C;
  var TESTS = [];

  function test(name, fn) { TESTS.push({ name: name, fn: fn }); }
  function assert(c, m) { if (!c) throw new Error(m || 'assert 실패'); }
  function eq(a, b, m) {
    if (a !== b) throw new Error((m ? m + ' — ' : '') + '기대 ' + JSON.stringify(b) + ', 실제 ' + JSON.stringify(a));
  }
  function fails(res, frag) {
    assert(!res.ok, '거부되어야 하는데 통과함');
    if (frag) assert(res.reason.indexOf(frag) >= 0, '거부 사유가 다름: ' + res.reason);
  }

  /* ── 테스트 도구 ───────────────────────────────────────── */
  function bg(seed) {
    var st = X.createGame({ seed: seed || 't', onsets: new Array(X.N).fill('ㄱ'), dict: WS.dict.permissive });
    st.phase = 'BATTLE'; st.t = 100000; st.ap = { P1: 99, P2: 99 };
    return st;
  }
  function revealAll(st, p) { for (var i = 0; i < X.N; i++) st.kn[p].onset[i] = 1; }
  function line(x, y, len, horiz) {
    var c = []; for (var k = 0; k < len; k++) c.push(X.idx(horiz ? x + k : x, horiz ? y : y + k)); return c;
  }
  function forceShip(st, player, len, cells, name) {
    var spec = X.specOf(len) || { hp: 3 };
    var id = player + '-' + (st.shipOrder.length + 1) + '-L' + len;
    var sh = {
      id: id, owner: player, len: len, hp: spec.hp, maxHp: spec.hp,
      tiles: cells.slice(), name: Array.from(name), identified: false, sunk: false, cdUntil: 0
    };
    st.ships[id] = sh; st.shipOrder.push(id);
    cells.forEach(function (c) { st.tiles[c].occupant = id; });
    return sh;
  }
  /** 쿨타임·AP를 즉시 회복 (규칙 하나만 보려고 할 때) */
  function ready(st) {
    st.ap = { P1: 99, P2: 99 };
    st.shipOrder.forEach(function (id) { st.ships[id].cdUntil = 0; });
  }

  /* ══ 함대 구성 (v0.4) ══════════════════════════════════ */

  test('함대 — 4칸 3척 + 3칸 5척 = 8척 27칸 (5칸 폐지)', function () {
    var spec = X.fleetSpec();
    eq(spec.length, 8, '함선 수');
    eq(spec.filter(function (s) { return s.len === 5; }).length, 0, '5칸 함선이 남아 있음');
    eq(spec.filter(function (s) { return s.len === 4; }).length, 3, '4칸 함선 수');
    eq(spec.filter(function (s) { return s.len === 3; }).length, 5, '3칸 함선 수');
    eq(spec.reduce(function (a, s) { return a + s.len; }, 0), 27, '총 점유 칸');
    eq(X.specOf(4).hp, 10, '4칸 HP'); eq(X.specOf(3).hp, 6, '3칸 HP');
    eq(B.identify.maxLen, 4, '식별 박스 최대 길이가 5로 남아 있음');
    return '8척 / 27칸 / 식별 3~4칸';
  });

  /* ══ 거리 (v0.6 — 유클리드) ════════════════════════════ */

  test('거리 — 유클리드(직선). 대각선이 직선보다 멀다', function () {
    var o = X.idx(0, 0);
    eq(X.dist(o, X.idx(3, 0)), 3, '가로 3칸');
    eq(X.dist(o, X.idx(0, 3)), 3, '세로 3칸');
    eq(X.dist(o, X.idx(3, 4)).toFixed(3), '5.000', '3:4:5 직각삼각형');
    var diag = X.dist(o, X.idx(3, 3));
    assert(Math.abs(diag - 4.2426) < 0.001, '대각 3칸 = 3√2 이어야 하는데 ' + diag);
    assert(diag > 3, '대각선이 직선과 같은 값 — 체비쇼프가 남아 있음');
    return '(3,3) → ' + diag.toFixed(3) + ' (체비쇼프였다면 3)';
  });

  test('거리 — 포격 범위가 원형이다 (대각 구석이 잘린다)', function () {
    var st = bg(); revealAll(st, 'P1');
    var me = forceShip(st, 'P1', 3, line(1, 1, 3, true), '가기고');   // 사거리 3
    assert(X.fire(st, 'P1', me.id, X.idx(1, 4)).ok, '정면 3칸이 막힘');   // 거리 3
    ready(st);
    // (6,4) 는 (3,1) 로부터 대각 3칸 = 4.24 → 체비쇼프였다면 통과했을 자리
    eq(X.cheb === undefined, true, 'cheb 가 아직 노출돼 있음');
    fails(X.fire(st, 'P1', me.id, X.idx(6, 4)), '사거리');
    return '대각 구석 (6,4) 차단';
  });

  test('거리 — 이동 인접은 대각선도 인정 (반지름 1.5)', function () {
    eq(B.move.adjacency, 1.5, '인접 반지름');
    var st = bg(); revealAll(st, 'P1');
    var sh = forceShip(st, 'P1', 3, line(3, 3, 3, true), '가기고');
    // 대각으로만 닿는 박스: (6,4),(7,4),(8,4) — (6,4)가 (5,3)의 대각
    assert(X.move(st, 'P1', sh.id, line(6, 4, 3, true), '구게괴').ok, '대각 인접 이동이 막힘');
    return '√2 < 1.5 → 8방향 인접 유지';
  });

  /* ══ 보드 생성 ═════════════════════════════════════════ */

  test('보드 — 250칸 전부 유효한 초성을 갖는다', function () {
    var st = X.createGame({ seed: 'gen-1' });
    eq(st.tiles.length, 250, '칸 수');
    assert(st.tiles.every(function (t) { return Hg.CHO.indexOf(t.onset) >= 0; }), '초성이 아닌 값 발견');
    return '250칸';
  });

  test('보드 — 타일은 음절을 갖지 않는다', function () {
    var st = X.createGame({ seed: 'gen-2' });
    assert(st.tiles.every(function (t) { return t.syllable === undefined; }), '타일에 음절 필드가 있음');
    assert(st.wreck.every(function (w) { return w === null; }), '초기 잔해가 있음');
    return '음절 없음 확인';
  });

  test('보드 — MINOR 초성 비율이 대략 8:2', function () {
    var ratios = [];
    for (var s = 0; s < 6; s++) {
      var st = X.createGame({ seed: 'ratio-' + s });
      ratios.push(st.tiles.filter(function (t) { return t.tier === 'MINOR'; }).length / X.N);
    }
    var avg = ratios.reduce(function (a, b) { return a + b; }, 0) / ratios.length;
    assert(avg > 0.10 && avg < 0.30, '평균 비율 이상: ' + avg.toFixed(3));
    return '평균 ' + (avg * 100).toFixed(1) + '%';
  });

  test('보드 — MINOR 초성 3연속 없음 (데드존 방지)', function () {
    for (var s = 0; s < 6; s++) {
      var st = X.createGame({ seed: 'run-' + s });
      var y, x, run;
      for (y = 0; y < X.H; y++) { run = 0; for (x = 0; x < X.W; x++) {
        run = st.tiles[X.idx(x, y)].tier === 'MINOR' ? run + 1 : 0;
        assert(run <= B.gen.maxMinorRun, '가로 연속 ' + run); } }
      for (x = 0; x < X.W; x++) { run = 0; for (y = 0; y < X.H; y++) {
        run = st.tiles[X.idx(x, y)].tier === 'MINOR' ? run + 1 : 0;
        assert(run <= B.gen.maxMinorRun, '세로 연속 ' + run); } }
    }
    return '6개 시드 통과';
  });

  test('보드 — 같은 시드는 같은 보드 (결정론)', function () {
    var a = X.createGame({ seed: 'det' }), b = X.createGame({ seed: 'det' });
    assert(a.tiles.every(function (t, i) { return t.onset === b.tiles[i].onset; }), '시드가 같은데 보드가 다름');
    return 'OK';
  });

  /* ══ 준비 페이즈 ═══════════════════════════════════════ */

  test('준비 — 자기 배치 구역 10×10 초성이 공개된다', function () {
    var st = X.createGame({ seed: 'setup-1' });
    var n1 = 0, i;
    for (i = 0; i < X.N; i++) if (st.kn.P1.onset[i]) n1++;
    eq(n1, 100, 'P1 공개 칸');
    assert(!st.kn.P1.onset[X.idx(0, 12)], 'P1이 중립 해역을 알고 있음');
    return 'P1/P2 각 100칸';
  });

  test('준비 — 자동 배치 8척 27칸, 구역 안, 함명 초성 일치', function () {
    var st = X.createGame({ seed: 'auto-1' });
    assert(X.autoPlace(st, 'P1').ok, 'P1 자동 배치 실패');
    assert(X.autoPlace(st, 'P2').ok, 'P2 자동 배치 실패');
    eq(X.fleetOf(st, 'P1').length, 8, 'P1 함선 수');
    var occ = 0, i;
    for (i = 0; i < X.N; i++) if (st.tiles[i].occupant) occ++;
    eq(occ, 54, '양측 점유 칸 합계 (27 × 2)');
    X.fleetOf(st, 'P1').forEach(function (s) {
      s.tiles.forEach(function (t) { assert(X.xy(t).y <= 9, 'P1 함선이 구역 밖'); });
      eq(s.name.length, s.len, s.id + ' 함명 길이');
      s.tiles.forEach(function (t, k) { eq(Hg.onsetOf(s.name[k]), st.tiles[t].onset, s.id + ' 함명 초성'); });
    });
    return '8척 × 2, 27칸 × 2';
  });

  test('준비 — 배치 구역 밖은 거부', function () {
    var st = X.createGame({ seed: 'setup-2' });
    var cells = line(0, 12, 3, true);
    fails(X.placeShip(st, 'P1', 3, cells, X.nameFor(st, cells)), '배치 구역');
    return 'OK';
  });

  test('준비 — 함명 초성이 타일과 다르면 거부', function () {
    var st = X.createGame({ seed: 'x', onsets: new Array(X.N).fill('ㄱ') });
    fails(X.placeShip(st, 'P1', 3, line(0, 0, 3, true), '나나나'), '초성 불일치');
    assert(X.placeShip(st, 'P1', 3, line(0, 0, 3, true), '가기고').ok, '올바른 함명이 거부됨');
    return 'OK';
  });

  /* ══ AP · 쿨타임 (v0.4 핵심) ═══════════════════════════ */

  test('AP — 시간이 지나면 차오른다 (엘릭서 방식)', function () {
    var st = bg(); st.ap = { P1: 0, P2: 0 }; st.apAccum = { P1: 0, P2: 0 };
    X.advance(st, B.ap.regenMs - 1);
    eq(st.ap.P1, 0, '회복 시점 이전');
    X.advance(st, 1);
    eq(st.ap.P1, 1, '1회 회복');
    X.advance(st, B.ap.regenMs * 3);
    eq(st.ap.P1, 4, '3회 추가 회복');
    eq(st.ap.P2, 4, '양측 동시 회복');
    return B.ap.regenMs / 1000 + '초당 1';
  });

  test('AP — 최대 10에서 멈춘다', function () {
    var st = bg(); st.ap = { P1: 0, P2: 0 }; st.apAccum = { P1: 0, P2: 0 };
    X.advance(st, B.ap.regenMs * 50);
    eq(st.ap.P1, B.ap.max, '상한');
    eq(st.apAccum.P1, 0, '상한에서 누적이 남음');
    return '최대 ' + B.ap.max;
  });

  test('AP — 이동은 3, 식별은 2, 탐지·포격은 1', function () {
    eq(B.cost.move, 3, '이동 비용');
    eq(B.cost.identify, 2); eq(B.cost.scan, 1); eq(B.cost.fire, 1);
    var st = bg(); revealAll(st, 'P1'); st.ap.P1 = 3;
    var sh = forceShip(st, 'P1', 3, line(3, 3, 3, true), '가기고');
    assert(X.move(st, 'P1', sh.id, line(3, 4, 3, true), '구게괴').ok);
    eq(st.ap.P1, 0, '이동 후 AP');
    return '3 / 2 / 1 / 1';
  });

  test('AP — 부족하면 거부', function () {
    var st = bg(); revealAll(st, 'P1'); st.ap.P1 = 2;
    var sh = forceShip(st, 'P1', 3, line(3, 3, 3, true), '가기고');
    fails(X.move(st, 'P1', sh.id, line(3, 4, 3, true), '구게괴'), 'AP 부족');
    return 'OK';
  });

  test('쿨타임 — 행동 후 그 함선만 잠기고, 시간이 지나면 풀린다', function () {
    var st = bg();
    var a = forceShip(st, 'P1', 3, line(0, 0, 3, true), '가기고');
    var b = forceShip(st, 'P1', 3, line(0, 2, 3, true), '가기고');
    assert(X.scan(st, 'P1', a.id, a.tiles[0], 'E').ok);
    fails(X.scan(st, 'P1', a.id, a.tiles[0], 'N'), '쿨타임');
    assert(X.scan(st, 'P1', b.id, b.tiles[0], 'E').ok, '다른 함선까지 잠김');
    X.advance(st, B.cooldown.scan);
    assert(X.scan(st, 'P1', a.id, a.tiles[0], 'N').ok, '쿨타임이 안 풀림');
    return '탐지 ' + B.cooldown.scan / 1000 + 's';
  });

  test('쿨타임 — 이동 쿨은 함선 길이에 비례 (3칸 9s / 4칸 12s)', function () {
    eq(X.moveCooldown(3), 9000); eq(X.moveCooldown(4), 12000);
    var st = bg(); revealAll(st, 'P1');
    var sh = forceShip(st, 'P1', 4, line(3, 3, 4, true), '가기고구');
    assert(X.move(st, 'P1', sh.id, line(3, 4, 4, true), '구게괴규').ok);
    eq(X.cooldownLeft(st, sh), 12000, '4칸 이동 쿨');
    X.advance(st, 11999);
    fails(X.move(st, 'P1', sh.id, line(3, 5, 4, true), '기고구게'), '쿨타임');
    X.advance(st, 1);
    assert(X.move(st, 'P1', sh.id, line(3, 5, 4, true), '기고구게').ok);
    return '9s / 12s';
  });

  test('실시간 — 양측이 동시에 행동할 수 있다 (턴 없음)', function () {
    var st = bg();
    eq(st.current, undefined, 'current 턴 필드가 남아 있음');
    var a = forceShip(st, 'P1', 3, line(0, 0, 3, true), '가기고');
    var b = forceShip(st, 'P2', 3, line(0, 20, 3, true), '가기고');
    assert(X.scan(st, 'P1', a.id, a.tiles[0], 'E').ok, 'P1 행동 실패');
    assert(X.scan(st, 'P2', b.id, b.tiles[0], 'E').ok, 'P2 행동 실패 — 턴 제약이 남아 있음');
    return '동시 행동 OK';
  });

  /* ══ 이동 ══════════════════════════════════════════════ */

  test('이동 — 단어 길이가 함선 길이와 다르면 거부', function () {
    var st = bg(); revealAll(st, 'P1');
    var sh = forceShip(st, 'P1', 3, line(3, 3, 3, true), '가기고');
    fails(X.move(st, 'P1', sh.id, line(3, 4, 4, true), '가기고구'), '함선 길이');
    return 'OK';
  });

  test('이동 — 초성 불일치 단어 거부', function () {
    var st = bg(); revealAll(st, 'P1');
    var sh = forceShip(st, 'P1', 3, line(3, 3, 3, true), '가기고');
    fails(X.move(st, 'P1', sh.id, line(3, 4, 3, true), '가나고'), '초성 불일치');
    return 'OK';
  });

  test('이동 — 초성 미판명 칸이 있으면 거부', function () {
    var st = bg();
    var sh = forceShip(st, 'P1', 3, line(3, 3, 3, true), '가기고');
    fails(X.move(st, 'P1', sh.id, line(3, 12, 3, true), '가기고'), '초성 미판명');
    return 'OK';
  });

  test('이동 — 박스 시작 칸이 함선에 붙어 있어야 한다', function () {
    var st = bg(); revealAll(st, 'P1');
    var sh = forceShip(st, 'P1', 3, line(3, 3, 3, true), '가기고');
    fails(X.move(st, 'P1', sh.id, line(3, 9, 3, true), '구게괴'), '시작 칸');
    // 시작 칸이 테두리면 끝 칸은 아무리 멀어도 된다
    assert(X.move(st, 'P1', sh.id, [X.idx(3, 4), X.idx(3, 5), X.idx(3, 6)], '구게괴').ok, '테두리 시작이 막힘');
    return '시작=테두리 / 끝=제한 없음';
  });

  test('이동 — 자기 자리로는 이동 불가 (뒤집기도 금지)', function () {
    var st = bg(); revealAll(st, 'P1');
    var sh = forceShip(st, 'P1', 3, line(3, 3, 3, true), '가기고');
    fails(X.move(st, 'P1', sh.id, line(3, 3, 3, true), '구게괴'), '자기 자리');
    var rev = line(3, 3, 3, true).slice().reverse();
    fails(X.move(st, 'P1', sh.id, rev, '괴게구'), '자기 자리');
    ready(st);
    assert(X.move(st, 'P1', sh.id, line(4, 3, 3, true), '구게괴').ok, '한 칸 밀기는 되어야 함');
    return '동일 칸 집합 금지';
  });

  test('이동 — 같은 함명 재사용은 허용', function () {
    var st = bg(); revealAll(st, 'P1');
    var sh = forceShip(st, 'P1', 3, line(3, 3, 3, true), '가기고');
    assert(X.move(st, 'P1', sh.id, line(3, 4, 3, true), '구게괴').ok);
    ready(st);
    assert(X.move(st, 'P1', sh.id, line(3, 5, 3, true), '구게괴').ok, '같은 함명이 거부됨');
    eq(sh.name.join(''), '구게괴');
    return '중복 함명 OK';
  });

  test('이동 — 같은 함명을 두 척이 동시에 가질 수 있다', function () {
    var st = bg(); revealAll(st, 'P1');
    var a = forceShip(st, 'P1', 3, line(0, 0, 3, true), '가기고');
    var b = forceShip(st, 'P1', 3, line(0, 4, 3, true), '구게괴');
    assert(X.move(st, 'P1', b.id, line(0, 5, 3, true), '가기고').ok, '중복 함명 거부됨');
    eq(a.name.join(''), b.name.join(''), '함명이 같지 않음');
    return '동일 함명 2척 OK';
  });

  test('이동 — 성공 시 함명이 교체된다 (핵심 규칙)', function () {
    var st = bg(); revealAll(st, 'P1');
    var sh = forceShip(st, 'P1', 3, line(3, 3, 3, true), '가기고');
    var r = X.move(st, 'P1', sh.id, line(3, 4, 3, true), '구게괴');
    assert(r.ok, r.reason);
    eq(sh.name.join(''), '구게괴', '새 함명');
    eq(st.tiles[X.idx(3, 3)].occupant, null, '옛 칸 점유 해제');
    eq(st.tiles[X.idx(3, 4)].occupant, sh.id, '새 칸 점유');
    return '가기고 → 구게괴';
  });

  test('이동 — 상대의 해독 정보는 옛 자리에 낡은 채로 남는다', function () {
    var st = bg(); revealAll(st, 'P1'); revealAll(st, 'P2');
    var sh = forceShip(st, 'P1', 3, line(3, 3, 3, true), '가기고');
    st.kn.P2.shipName[sh.id] = ['가', '기', '고'];
    assert(X.move(st, 'P1', sh.id, line(3, 4, 3, true), '구게괴').ok);
    eq(st.kn.P2.shipName[sh.id], undefined, '함선에 묶인 지식은 끊겨야 함');
    eq(st.kn.P2.staleSyl[X.idx(3, 3)], '가', '옛 자리에 낡은 정보가 안 남음');
    eq(st.kn.P2.staleSyl[X.idx(5, 3)], '고', '옛 자리 3');
    var v = X.projectTile(st, 'P2', X.idx(3, 3), false);
    eq(v.syl, '가', '화면에 안 보임'); eq(v.stale, true, '낡음 표시가 없음');
    return '즉시 삭제 아님 — 옛 자리에 잔류';
  });

  test('이동 — 낡은 정보는 다시 관측하면 폐기된다', function () {
    var st = bg(); revealAll(st, 'P1'); revealAll(st, 'P2');
    var sh = forceShip(st, 'P1', 3, line(3, 3, 3, true), '가기고');
    var eye = forceShip(st, 'P2', 3, line(3, 1, 3, false), '가가가');   // (3,1)(3,2)(3,3)? 겹치니 다른 자리
    eye.tiles.forEach(function (t) { st.tiles[t].occupant = null; });
    eye.tiles = [X.idx(8, 1), X.idx(8, 2), X.idx(8, 3)];
    eye.tiles.forEach(function (t) { st.tiles[t].occupant = eye.id; });
    st.kn.P2.shipName[sh.id] = ['가', '기', '고'];
    assert(X.move(st, 'P1', sh.id, line(3, 4, 3, true), '구게괴').ok);
    eq(st.kn.P2.staleSyl[X.idx(5, 3)], '고', '잔류 확인');
    X.observe(st, 'P2', X.idx(5, 3));
    eq(st.kn.P2.staleSyl[X.idx(5, 3)], undefined, '재관측했는데 낡은 정보가 남음');
    return '재관측 → 폐기';
  });

  test('이동 — 주변 1칸이 자동 판명된다 (5×3 = 15칸)', function () {
    var st = bg();
    var sh = forceShip(st, 'P1', 3, line(3, 3, 3, true), '가기고');
    for (var i = 0; i < X.N; i++) st.kn.P1.onset[i] = 0;
    line(3, 4, 3, true).forEach(function (c) { st.kn.P1.onset[c] = 1; });
    var r = X.move(st, 'P1', sh.id, line(3, 4, 3, true), '구게괴');
    assert(r.ok, r.reason);
    eq(r.revealed, 15, '판명 칸 수');
    return '15칸';
  });

  test('충돌 — 적함과 겹치면 양쪽 다 침몰한다', function () {
    var st = bg(); revealAll(st, 'P1');
    var sh = forceShip(st, 'P1', 3, line(3, 3, 3, true), '가기고');
    var foe = forceShip(st, 'P2', 3, line(3, 4, 3, true), '구게괴');
    forceShip(st, 'P1', 3, line(0, 0, 3, true), '가가가');   // 전멸 방지
    forceShip(st, 'P2', 3, line(9, 20, 1, true).concat([X.idx(9, 21), X.idx(9, 22)]), '가가가');
    st.ap.P1 = 5;
    var r = X.move(st, 'P1', sh.id, line(3, 4, 3, true), '구게괴');
    assert(r.ok && r.sunkSelf, '동반 침몰 결과가 아님');
    assert(sh.sunk, '이동한 함선이 살아 있음');
    assert(foe.sunk, '충돌당한 함선이 살아 있음');
    eq(st.ap.P1, 2, 'AP 소모');
    return '양쪽 침몰';
  });

  test('충돌 — 겹친 칸의 글자는 이동한 함선의 것으로 고정된다', function () {
    var st = bg(); revealAll(st, 'P1');
    var sh = forceShip(st, 'P1', 3, line(3, 3, 3, true), '가기고');
    var foe = forceShip(st, 'P2', 4, line(2, 4, 4, true), '나나나나');  // ㄴ 은 보드와 무관, 각인 비교용
    foe.name = Array.from('가나다라');
    forceShip(st, 'P1', 3, line(0, 0, 3, true), '가가가');
    forceShip(st, 'P2', 3, line(9, 20, 1, true).concat([X.idx(9, 21), X.idx(9, 22)]), '가가가');
    // 이동 박스 (3,4)(4,4)(5,4) 는 적함의 (3,4)(4,4)(5,4) 와 겹친다 (적함은 x2~x5)
    var r = X.move(st, 'P1', sh.id, line(3, 4, 3, true), '구게괴');
    assert(r.ok && r.sunkSelf, r.reason || '동반 침몰이 아님');
    eq(st.wreck[X.idx(3, 4)], '구', '겹친 칸이 이동한 함선 글자가 아님');
    eq(st.wreck[X.idx(4, 4)], '게', '겹친 칸 2');
    eq(st.wreck[X.idx(5, 4)], '괴', '겹친 칸 3');
    eq(st.wreck[X.idx(2, 4)], '가', '안 겹친 칸은 적함 글자여야 함');
    return '겹친 칸 = 구게괴 / 안 겹친 칸 = 가';
  });

  /* ══ 탐지 ══════════════════════════════════════════════ */

  test('탐지 — 방향으로 정확히 5칸 판명', function () {
    var st = bg();
    var sh = forceShip(st, 'P1', 3, line(3, 12, 3, false), '가기고');
    var r = X.scan(st, 'P1', sh.id, X.idx(3, 12), 'E');
    assert(r.ok, r.reason);
    eq(r.revealed, 5, '판명 칸 수');
    assert(st.kn.P1.onset[X.idx(8, 12)], '5번째 칸 미판명');
    assert(!st.kn.P1.onset[X.idx(9, 12)], '6번째 칸까지 판명됨');
    return '5칸 (시작 타일 제외)';
  });

  test('탐지 — 보드 밖으로 나가면 사거리 손실', function () {
    var st = bg();
    var sh = forceShip(st, 'P1', 3, line(5, 20, 3, false), '가기고');
    var r = X.scan(st, 'P1', sh.id, X.idx(5, 22), 'N');
    assert(r.ok, r.reason);
    eq(r.revealed, 2, 'y23,y24 두 칸만 남음');
    return '2칸 (클리핑)';
  });

  test('탐지 — 자기 함선 타일에서만 가능', function () {
    var st = bg();
    var sh = forceShip(st, 'P1', 3, line(3, 3, 3, true), '가기고');
    fails(X.scan(st, 'P1', sh.id, X.idx(7, 7), 'N'), '점유한 타일');
    return 'OK';
  });

  /* ══ 식별 ══════════════════════════════════════════════ */

  test('식별 — 적함이 있으면 IDENTIFIED 부여', function () {
    var st = bg(); revealAll(st, 'P1');
    var me = forceShip(st, 'P1', 3, line(1, 1, 3, true), '가기고');
    var foe = forceShip(st, 'P2', 3, line(1, 3, 3, true), '가기고');
    var r = X.identify(st, 'P1', line(1, 3, 3, true), '구게괴');
    assert(r.ok, r.reason);
    assert(foe.identified, '식별당함이 안 붙음');
    eq(r.hits, 1, '식별된 함선 수');
    return 'IDENTIFIED 부여';
  });

  test('식별 — 음절은 칸별로 독립 판정된다 (부분 적중)', function () {
    var st = bg(); revealAll(st, 'P1');
    var me = forceShip(st, 'P1', 3, line(1, 1, 3, true), '가기고');
    var foe = forceShip(st, 'P2', 3, line(1, 3, 3, true), '가기고');
    var r = X.identify(st, 'P1', line(1, 3, 3, true), '가구고');
    assert(r.ok, r.reason);
    eq(r.learned, 2, '해독된 음절 수');
    var kn = st.kn.P1.shipName[foe.id];
    eq(kn[0], '가'); eq(kn[1], null, '틀린 음절이 기록됨'); eq(kn[2], '고');
    return '3칸 중 2칸 해독';
  });

  test('식별 — 함명 완전 해독 시 함선 실루엣이 공개된다', function () {
    var st = bg(); revealAll(st, 'P1');
    var me = forceShip(st, 'P1', 3, line(1, 1, 3, true), '가기고');
    var foe = forceShip(st, 'P2', 3, line(1, 3, 3, true), '구게괴');
    var r = X.identify(st, 'P1', line(1, 3, 3, true), '구게괴');
    assert(r.ok, r.reason);
    eq(r.decoded, 1, '완전 해독 수');
    foe.tiles.forEach(function (t) { eq(st.kn.P1.contact[t], C.CONTACT, '실루엣 미공개'); });
    return '실루엣 공개';
  });

  test('식별 — 박스는 3~4칸 (5칸 거부)', function () {
    var st = bg(); revealAll(st, 'P1');
    var me = forceShip(st, 'P1', 3, line(1, 1, 3, true), '가기고');
    fails(X.identify(st, 'P1', line(1, 3, 5, true), '가기고구게'), '3~4칸');
    ready(st);
    assert(X.identify(st, 'P1', line(1, 3, 4, true), '가기고구').ok, '4칸이 거부됨');
    return 'OK';
  });

  test('식별 — 적함이 없으면 빈 칸으로 확정된다', function () {
    var st = bg(); revealAll(st, 'P1');
    var me = forceShip(st, 'P1', 3, line(1, 1, 3, true), '가기고');
    var r = X.identify(st, 'P1', line(1, 3, 3, true), '구게괴');
    assert(r.ok, r.reason);
    eq(r.hits, 0, '없는 적함이 잡힘');
    eq(st.kn.P1.contact[X.idx(1, 3)], C.CLEAR, '빈 칸 확정이 안 됨');
    return '빈 칸 확정';
  });

  test('식별 — 사거리 7 초과 거부', function () {
    var st = bg(); revealAll(st, 'P1');
    var me = forceShip(st, 'P1', 3, line(1, 1, 3, true), '가기고');
    fails(X.identify(st, 'P1', line(1, 12, 3, true), '구게괴'), '사거리');
    return 'OK';
  });

  test('식별 — 함선을 고르지 않는다 (함대 전체 사거리 기준)', function () {
    var st = bg(); revealAll(st, 'P1');
    var far = forceShip(st, 'P1', 3, line(0, 0, 3, true), '가기고');      // 멀리
    var near = forceShip(st, 'P1', 3, line(1, 10, 3, true), '가기고');    // 박스 근처
    forceShip(st, 'P2', 3, line(1, 12, 3, true), '구게괴');
    var r = X.identify(st, 'P1', line(1, 12, 3, true), '구게괴');
    assert(r.ok, r.reason);
    eq(r.by, near.id, '가장 가까운 함선이 담당해야 함');
    assert(X.cooldownLeft(st, near) > 0, '담당 함선에 쿨타임이 안 걸림');
    eq(X.cooldownLeft(st, far), 0, '엉뚱한 함선이 잠김');
    return '담당 = ' + near.id;
  });

  test('식별 — 시작 칸만 사거리 안이면 된다 (끝 칸은 제한 없음)', function () {
    var st = bg(); revealAll(st, 'P1');
    forceShip(st, 'P1', 3, line(1, 1, 3, true), '가기고');
    // 시작 (1,8) 은 거리 7 이내, 끝 (1,10) 은 7 밖
    assert(X.identify(st, 'P1', [X.idx(1, 8), X.idx(1, 9), X.idx(1, 10)], '구게괴').ok, '끝 칸이 멀다고 막힘');
    ready(st);
    fails(X.identify(st, 'P1', [X.idx(1, 12), X.idx(1, 13), X.idx(1, 14)], '구게괴'), '시작 칸');
    return 'OK';
  });

  test('식별당함 — 이동이 영구 봉쇄된다 (해제 수단 없음, §13-5)', function () {
    var st = bg(); revealAll(st, 'P1');
    var sh = forceShip(st, 'P1', 3, line(3, 3, 3, true), '가기고');
    sh.identified = true;
    fails(X.move(st, 'P1', sh.id, line(3, 4, 3, true), '구게괴'), '이동 불가');
    X.advance(st, 600000);                       // 10분이 지나도
    fails(X.move(st, 'P1', sh.id, line(3, 4, 3, true), '구게괴'), '이동 불가');
    assert(sh.identified, '시간 경과로 풀림');
    eq(X.evade, undefined, '회피 기동 행동이 남아 있음');
    return '영구 지속 확인';
  });

  test('식별당함 — 탐지·포격은 여전히 가능', function () {
    var st = bg(); revealAll(st, 'P1');
    var sh = forceShip(st, 'P1', 3, line(1, 1, 3, true), '가기고');
    forceShip(st, 'P2', 3, line(1, 3, 3, true), '구게괴');
    sh.identified = true;
    assert(X.scan(st, 'P1', sh.id, sh.tiles[0], 'N').ok, '탐지가 막힘');
    ready(st);
    assert(X.fire(st, 'P1', sh.id, X.idx(1, 3)).ok, '포격이 막힘');
    return '이동만 봉쇄';
  });

  /* ══ 포격 ══════════════════════════════════════════════ */

  test('포격 — 피해 계산 1 / 2(정밀) / 3(식별) / 6(식별+정밀)', function () {
    var st = bg(); revealAll(st, 'P1');
    var me = forceShip(st, 'P1', 3, line(1, 1, 3, true), '가기고');
    var foe = forceShip(st, 'P2', 3, line(1, 3, 3, true), '구게괴');
    var target = X.idx(1, 3);
    function hit() { ready(st); foe.hp = 100; X.fire(st, 'P1', me.id, target); return 100 - foe.hp; }

    delete st.kn.P1.shipName[foe.id]; foe.identified = false;
    eq(hit(), 1, '기본');
    st.kn.P1.shipName[foe.id] = ['구', null, null];
    eq(hit(), 2, '정밀');
    delete st.kn.P1.shipName[foe.id]; foe.identified = true;
    eq(hit(), 3, '식별');
    st.kn.P1.shipName[foe.id] = ['구', null, null];
    eq(hit(), 6, '식별+정밀');
    return '1 / 2 / 3 / 6';
  });

  test('포격 — 피해량은 식별당한 함선만 보인다 (§13-6)', function () {
    var st = bg(); revealAll(st, 'P1');
    var me = forceShip(st, 'P1', 3, line(1, 1, 3, true), '가기고');
    var foe = forceShip(st, 'P2', 3, line(1, 3, 3, true), '구게괴');
    foe.hp = 50;
    var r1 = X.fire(st, 'P1', me.id, X.idx(1, 3));
    assert(r1.ok && r1.hit, '명중이 아님');
    eq(r1.dmgVisible, false, '식별 전인데 피해가 보임');
    assert(r1.msg.indexOf('불명') >= 0, '피해량이 노출됨: ' + r1.msg);
    ready(st); foe.identified = true;
    var r2 = X.fire(st, 'P1', me.id, X.idx(1, 3));
    eq(r2.dmgVisible, true, '식별 후인데 피해가 안 보임');
    assert(r2.msg.indexOf('HP') >= 0, 'HP가 안 나옴: ' + r2.msg);
    return '불명 → 공개';
  });

  test('포격 — 적 체력 바는 식별당한 함선만 투영된다', function () {
    var st = bg(); revealAll(st, 'P1');
    var me = forceShip(st, 'P1', 3, line(1, 1, 3, true), '가기고');
    var foe = forceShip(st, 'P2', 3, line(1, 3, 3, true), '구게괴');
    st.kn.P1.contact[X.idx(1, 3)] = C.CONTACT;
    var v1 = X.projectTile(st, 'P1', X.idx(1, 3), false);
    eq(v1.enemyState, null, '식별 전인데 체력이 보임');
    foe.identified = true;
    var v2 = X.projectTile(st, 'P1', X.idx(1, 3), false);
    assert(v2.enemyState && v2.enemyState.hp === foe.hp, '식별 후 체력이 안 보임');
    return 'null → HP';
  });

  test('포격 — 미지 칸에도 쏠 수 있다 (맹목 사격)', function () {
    var st = bg();
    var me = forceShip(st, 'P1', 3, line(1, 11, 3, true), '가기고');
    assert(!st.kn.P1.onset[X.idx(1, 13)], '이미 판명된 칸');
    var r = X.fire(st, 'P1', me.id, X.idx(1, 13));
    assert(r.ok, r.reason);
    return 'OK';
  });

  test('포격 — 사거리는 함선 길이를 따른다 (3→3, 4→5)', function () {
    eq(X.fireRange(3), 3); eq(X.fireRange(4), 5);
    var st = bg(); revealAll(st, 'P1');
    var me = forceShip(st, 'P1', 3, line(1, 1, 3, true), '가기고');
    fails(X.fire(st, 'P1', me.id, X.idx(1, 6)), '사거리');
    assert(X.fire(st, 'P1', me.id, X.idx(1, 4)).ok);
    return 'OK';
  });

  test('포격 — 반동으로 내 위치 한 칸이 노출된다', function () {
    var st = bg(); revealAll(st, 'P1');
    var me = forceShip(st, 'P1', 3, line(1, 1, 3, true), '가기고');
    forceShip(st, 'P2', 3, line(1, 3, 3, true), '구게괴');
    eq(me.tiles.filter(function (t) { return st.kn.P2.contact[t] === C.CONTACT; }).length, 0, '사전 노출');
    var r = X.fire(st, 'P1', me.id, X.idx(1, 3));
    assert(r.ok, r.reason);
    eq(me.tiles.filter(function (t) { return st.kn.P2.contact[t] === C.CONTACT; }).length, 1, '반동 노출 칸 수');
    return '1칸 노출';
  });

  test('포격 — 아군은 피격되지 않는다 (§13-7)', function () {
    var st = bg();
    var a = forceShip(st, 'P1', 3, line(1, 1, 3, true), '가기고');
    var b = forceShip(st, 'P1', 3, line(1, 3, 3, true), '구게괴');
    fails(X.fire(st, 'P1', a.id, X.idx(1, 3)), '아군');
    eq(b.hp, b.maxHp, '아군이 피해를 입음');
    return 'OK';
  });

  /* ══ 침몰 · 잔해 ═══════════════════════════════════════ */

  test('침몰 — 함명이 타일에 각인되고 점유가 풀린다', function () {
    var st = bg(); revealAll(st, 'P1');
    var me = forceShip(st, 'P1', 3, line(1, 1, 3, true), '가기고');
    var foe = forceShip(st, 'P2', 3, line(1, 3, 3, true), '구게괴');
    forceShip(st, 'P2', 3, line(7, 20, 3, true), '가가가');
    foe.hp = 1;
    assert(X.fire(st, 'P1', me.id, X.idx(1, 3)).ok);
    assert(foe.sunk, '침몰하지 않음');
    eq(st.wreck[X.idx(1, 3)], '구', '각인 1');
    eq(st.wreck[X.idx(2, 3)], '게', '각인 2');
    eq(st.wreck[X.idx(3, 3)], '괴', '각인 3');
    eq(st.tiles[X.idx(1, 3)].occupant, null, '점유가 남음');
    assert(st.kn.P2.onset[X.idx(1, 3)], '잔해가 양측 공개가 아님');
    return '구/게/괴 각인';
  });

  test('잔해 — 정확한 음절을 강제한다 (도시락 불가, 다슬기 가능)', function () {
    var st = bg(); revealAll(st, 'P1');
    var me = forceShip(st, 'P1', 3, line(1, 1, 3, true), '가기고');
    var foe = forceShip(st, 'P2', 3, line(1, 3, 3, true), '구게괴');
    forceShip(st, 'P2', 3, line(7, 20, 3, true), '가가가');
    foe.hp = 1;
    assert(X.fire(st, 'P1', me.id, X.idx(1, 3)).ok);
    ready(st);
    assert(X.move(st, 'P1', me.id, line(1, 2, 3, true), '기고구').ok, '중간 이동 실패');
    ready(st);
    fails(X.move(st, 'P1', me.id, line(1, 3, 3, true), '구게구'), '잔해');
    assert(X.move(st, 'P1', me.id, line(1, 3, 3, true), '구게괴').ok, '정확한 음절인데 거부됨');
    return '초성만 맞는 단어 거부 확인';
  });

  /* ══ 승리 조건 ═════════════════════════════════════════ */

  test('상륙 — 타일 하나라도 25행 진입 시 즉시 승리 (§13-11)', function () {
    var st = bg(); revealAll(st, 'P1');
    var sh = forceShip(st, 'P1', 3, line(4, 21, 3, false), '가기고');
    forceShip(st, 'P2', 3, line(0, 15, 3, true), '가가가');
    var r = X.move(st, 'P1', sh.id, line(4, 22, 3, false), '구게괴');
    assert(r.ok, r.reason);
    assert(r.landed, '상륙 판정이 안 됨');
    eq(sh.tiles.filter(function (t) { return X.xy(t).y === 24; }).length, 1, '한 칸만 걸쳤는지');
    eq(st.phase, 'OVER'); eq(st.winner, 'P1'); eq(st.winReason, 'LANDING');
    return '1칸 진입 → 즉시 승리';
  });

  test('상륙 — P2는 절대 y=0 이 목표', function () {
    eq(X.landingY('P1'), 24); eq(X.landingY('P2'), 0);
    var st = bg(); revealAll(st, 'P2');
    var sh = forceShip(st, 'P2', 3, line(4, 1, 3, false), '가기고');
    var r = X.move(st, 'P2', sh.id, line(4, 0, 3, false), '구게괴');
    assert(r.ok, r.reason);
    eq(st.winner, 'P2'); eq(st.winReason, 'LANDING');
    return 'P2 상륙 승리';
  });

  test('상륙 — 25행에 닿지 않으면 승리하지 않는다', function () {
    var st = bg(); revealAll(st, 'P1');
    var sh = forceShip(st, 'P1', 3, line(4, 20, 3, false), '가기고');
    var r = X.move(st, 'P1', sh.id, line(4, 21, 3, false), '구게괴');
    assert(r.ok && !r.landed, '상륙이 잘못 판정됨');
    eq(st.phase, 'BATTLE');
    return 'OK';
  });

  test('상륙 — 쿨타임이 속도를 제한한다 (§13-12)', function () {
    // 3칸 함선이 y9 → y24 를 가려면 최소 5회 이동. 쿨 9s + AP 3(7.5s) 이 병목.
    var st = bg(); revealAll(st, 'P1');
    st.t = 0; st.ap.P1 = 0; st.apAccum.P1 = 0;
    var sh = forceShip(st, 'P1', 3, line(4, 7, 3, false), '가기고');   // y7,8,9
    var moves = 0, guard = 0;
    while (st.phase === 'BATTLE' && guard++ < 4000) {
      X.advance(st, 100);
      var top = Math.max.apply(null, sh.tiles.map(function (t) { return X.xy(t).y; }));
      var dest = line(4, top - 1, 3, false);                            // 2칸 전진
      if (dest.some(function (c) { return !X.inB(X.xy(c).x, X.xy(c).y); })) break;
      var r = X.move(st, 'P1', sh.id, dest, X.nameFor(st, dest));
      if (r.ok) moves++;
    }
    assert(st.winner === 'P1', '상륙에 실패');
    assert(st.t >= 40000, '너무 빨리 상륙함: ' + (st.t / 1000).toFixed(1) + 's');
    return moves + '회 이동 / ' + (st.t / 1000).toFixed(1) + '초 소요';
  });

  test('전멸 — 마지막 함선 침몰 시 승리', function () {
    var st = bg(); revealAll(st, 'P1');
    var me = forceShip(st, 'P1', 3, line(1, 1, 3, true), '가기고');
    var foe = forceShip(st, 'P2', 3, line(1, 3, 3, true), '구게괴');
    foe.hp = 1;
    assert(X.fire(st, 'P1', me.id, X.idx(1, 3)).ok);
    eq(st.phase, 'OVER'); eq(st.winner, 'P1'); eq(st.winReason, 'ANNIHILATION');
    return 'P1 전멸 승리';
  });

  /* ══ 지식 레이어 ═══════════════════════════════════════ */

  test('지식 — 접촉은 상대에게도 미러링된다 (피탐)', function () {
    var st = bg();
    var me = forceShip(st, 'P1', 3, line(1, 1, 3, true), '가기고');
    forceShip(st, 'P2', 3, line(1, 3, 3, true), '구게괴');
    assert(X.scan(st, 'P1', me.id, X.idx(1, 1), 'N').ok);
    eq(st.kn.P1.contact[X.idx(1, 3)], C.CONTACT, '탐지한 쪽 접촉');
    eq(st.kn.P2.exposed[X.idx(1, 3)], 1, '탐지당한 쪽 피탐 표시');
    return '양측 기록 확인';
  });

  test('지식 — 적이 떠난 자리는 GHOST(?)가 된다', function () {
    var st = bg(); revealAll(st, 'P1'); revealAll(st, 'P2');
    var me = forceShip(st, 'P1', 3, line(1, 1, 3, true), '가기고');
    var foe = forceShip(st, 'P2', 3, line(1, 3, 3, true), '구게괴');
    assert(X.scan(st, 'P1', me.id, X.idx(1, 1), 'N').ok);
    eq(st.kn.P1.contact[X.idx(1, 3)], C.CONTACT);
    assert(X.move(st, 'P2', foe.id, line(1, 4, 3, true), '기고구').ok, '적 이동 실패');
    ready(st);
    assert(X.scan(st, 'P1', me.id, X.idx(1, 1), 'N').ok);
    eq(st.kn.P1.contact[X.idx(1, 3)], C.GHOST, 'GHOST가 안 됨');
    return 'CONTACT → GHOST';
  });

  test('지식 — 초성은 영구, 함명은 휘발성', function () {
    var st = bg(); revealAll(st, 'P1'); revealAll(st, 'P2');
    var foe = forceShip(st, 'P2', 3, line(1, 3, 3, true), '구게괴');
    st.kn.P1.shipName[foe.id] = ['구', '게', '괴'];
    assert(X.move(st, 'P2', foe.id, line(1, 4, 3, true), '기고구').ok);
    assert(st.kn.P1.onset[X.idx(1, 3)], '초성 지식이 사라짐');
    eq(st.kn.P1.shipName[foe.id], undefined, '함명 지식이 남음');
    return '초성 영구 / 함명 소멸';
  });

  test('지식 — 로그는 행위자에게만 보인다', function () {
    var st = bg(); revealAll(st, 'P1');
    var me = forceShip(st, 'P1', 3, line(1, 1, 3, true), '가기고');
    assert(X.scan(st, 'P1', me.id, X.idx(1, 1), 'N').ok);
    var mine = st.log.filter(function (l) { return l.forPlayer === 'P1'; });
    var theirs = st.log.filter(function (l) { return l.forPlayer === 'P2'; });
    assert(mine.length > 0, 'P1 로그가 없음');
    eq(theirs.length, 0, '탐지가 상대 로그에 남음');
    return 'P1 ' + mine.length + '건 / P2 0건';
  });

  /* ══ 통합 — 실제로 한 판이 끝나는가 ════════════════════ */

  /* 봇 — 실시간에서는 AP 관리가 전부다.
   * 이동이 3 AP인데 탐지·포격이 1 AP라, 탐욕적으로 굴리면 싼 행동이 AP를 계속 빨아
   * 이동에 필요한 3을 영영 못 모은다. 그래서 이동분을 먼저 떼어 두고 남는 것만 쓴다.
   */
  function depth(p, t) { var y = X.xy(t).y; return p === 'P1' ? y : (X.H - 1 - y); }
  function shipDepth(p, sh) {
    return sh.tiles.reduce(function (m, t) { return Math.max(m, depth(p, t)); }, -1);
  }

  function botAct(st, p) {
    if (st.phase !== 'BATTLE') return;
    var alive = X.fleetOf(st, p).filter(function (s) { return !s.sunk; });
    var ready = alive.filter(function (s) { return X.cooldownLeft(st, s) <= 0; });
    if (!ready.length) return;
    var ap = st.ap[p], kn = st.kn[p], i;

    // 선봉 = 가장 전진한(이동 가능한) 함선
    var van = ready.filter(function (s) { return !s.identified; })
                   .sort(function (a, b) { return shipDepth(p, b) - shipDepth(p, a); })[0];

    // ① 전진 이동 — 최우선. AP 3을 항상 이것에 먼저 배정한다
    if (van && ap >= B.cost.move) {
      var d0 = shipDepth(p, van);
      var fwd = X.findMoves(st, van)
        .map(function (m) { return { m: m, d: m.cells.reduce(function (x, c) { return Math.max(x, depth(p, c)); }, -1) }; })
        .filter(function (o) { return o.d > d0; })
        .sort(function (a, b) { return b.d - a.d; });
      if (fwd.length && X.move(st, p, van.id, fwd[0].m.cells, fwd[0].m.word).ok) return;
    }

    // ② 선봉 앞을 탐지 — 이동분 3을 남겨두고 남는 AP로만
    if (van && ap >= B.cost.move + B.cost.scan) {
      var tip = van.tiles.reduce(function (best, t) { return depth(p, t) > depth(p, best) ? t : best; }, van.tiles[0]);
      if (X.scan(st, p, van.id, tip, p === 'P1' ? 'N' : 'S').ok) return;
    }

    // ③ 여유가 넉넉할 때만 교전
    if (ap >= B.cost.move + B.cost.identify) {
      var sh = ready[Math.floor(st.rand() * ready.length)];
      var targets = [];
      for (i = 0; i < X.N; i++) if (kn.contact[i] === C.CONTACT && X.shipWithin(st, sh, i, X.fireRange(sh.len))) targets.push(i);
      if (targets.length) {
        if (st.rand() < 0.35) {
          var c0 = targets[Math.floor(st.rand() * targets.length)];
          var box = X.lineBox(c0, c0 + 2);
          if (box && box.length === 3 && box.every(function (c) { return kn.onset[c] && X.shipWithin(st, sh, c, B.identify.range); })) {
            var w = X.nameFor(st, box);
            if (w && X.identify(st, p, box, w).ok) return;
          }
        }
        if (X.fire(st, p, sh.id, targets[Math.floor(st.rand() * targets.length)]).ok) return;
      }
      // 교전 대상이 없으면 아무 함선이나 전방 탐지
      X.scan(st, p, sh.id, sh.tiles[Math.floor(st.rand() * sh.tiles.length)], p === 'P1' ? 'N' : 'S');
    }
  }
  WS.botAct = botAct;

  function playOut(seed, maxMs) {
    var st = X.createGame({ seed: seed });
    if (!X.autoPlace(st, 'P1').ok || !X.autoPlace(st, 'P2').ok) throw new Error('자동 배치 실패 @' + seed);
    var s = X.startBattle(st);
    if (!s.ok) throw new Error(s.reason);
    var STEP = 200;
    while (st.phase === 'BATTLE' && st.t < (maxMs || 900000)) {
      X.advance(st, STEP);
      botAct(st, 'P1'); botAct(st, 'P2');
    }
    return { st: st, secs: st.t / 1000 };
  }
  WS.playOut = playOut;

  test('통합 — 랜덤 봇 실시간 대국이 결착까지 간다', function () {
    var r = playOut('smoke-1', 900000);
    assert(r.st.phase === 'OVER', '15분 안에 결착나지 않음 (크래시는 아님)');
    return r.secs.toFixed(0) + '초 / ' + r.st.winner + ' 승 (' + r.st.winReason + ')';
  });

  test('통합 — 10개 시드 연속 대국에서 예외 없음', function () {
    var res = { LANDING: 0, ANNIHILATION: 0, none: 0 }, total = 0;
    for (var s = 0; s < 10; s++) {
      var r = playOut('multi-' + s, 900000);
      total += r.secs;
      if (r.st.winner) res[r.st.winReason]++; else res.none++;
    }
    return '평균 ' + (total / 10).toFixed(0) + '초 · 상륙 ' + res.LANDING + ' / 전멸 ' + res.ANNIHILATION + ' / 미결착 ' + res.none;
  });

  test('통합 — 대국 종료 후 불변식이 유지된다', function () {
    var r = playOut('invariant-1', 900000);
    var st = r.st, i;
    var occCount = 0;
    for (i = 0; i < X.N; i++) if (st.tiles[i].occupant) {
      occCount++;
      var sh = st.ships[st.tiles[i].occupant];
      assert(sh && !sh.sunk, '침몰한 함선이 칸을 점유 중');
      assert(sh.tiles.indexOf(i) >= 0, '함선 tiles와 보드 점유 불일치');
    }
    var expect = 0;
    st.shipOrder.forEach(function (id) { var s = st.ships[id]; if (!s.sunk) expect += s.len; });
    eq(occCount, expect, '점유 칸 수 불일치');
    st.shipOrder.forEach(function (id) {
      var s = st.ships[id];
      eq(s.name.length, s.len, s.id + ' 함명 길이');
      if (!s.sunk) s.tiles.forEach(function (t, k) {
        if (st.wreck[t]) return;
        eq(Hg.onsetOf(s.name[k]), st.tiles[t].onset, s.id + ' 함명/타일 초성 불일치');
      });
    });
    var onWreck = 0;
    for (i = 0; i < X.N; i++) {
      if (!st.wreck[i]) continue;
      var o = st.tiles[i].occupant;
      if (!o) continue;
      onWreck++;
      var s2 = st.ships[o];
      eq(s2.name[s2.tiles.indexOf(i)], st.wreck[i], '잔해 위 함선 음절이 각인과 불일치');
    }
    // AP 상한
    assert(st.ap.P1 <= B.ap.max && st.ap.P2 <= B.ap.max, 'AP가 상한을 넘음');
    assert(st.ap.P1 >= 0 && st.ap.P2 >= 0, 'AP가 음수');
    return occCount + '칸 점유 · 잔해 위 ' + onWreck + '칸 · 불변식 OK';
  });

  /* ── 실행 ──────────────────────────────────────────────── */
  function runAll() {
    var out = [], pass = 0, fail = 0;
    TESTS.forEach(function (t) {
      var t0 = performance.now();
      try {
        var detail = t.fn();
        pass++;
        out.push({ ok: true, name: t.name, detail: detail || '', ms: performance.now() - t0 });
      } catch (e) {
        fail++;
        out.push({ ok: false, name: t.name, detail: e && e.message ? e.message : String(e), ms: performance.now() - t0 });
      }
    });
    return { results: out, pass: pass, fail: fail, total: TESTS.length };
  }

  WS.tests = { runAll: runAll, list: TESTS };

})(window.WS = window.WS || {});
