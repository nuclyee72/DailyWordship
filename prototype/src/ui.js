/* WordShip prototype — UI (v0.8 모드리스 조작)
 *
 * 행동 버튼이 없다. 무슨 행동인지는 '어디서 드래그를 시작했는가'가 결정한다.
 *
 *   ┌ 함선 선택됨 ────────────────────────────────────────────┐
 *   │ 함선 타일 드래그      → 탐지                              │
 *   │ 초록 테두리 드래그    → 이동                              │
 *   │ 붉은 사거리 안 클릭   → 포격 목표 지정 → 「포격」 버튼     │
 *   │ 사거리 밖 클릭        → 선택 취소                         │
 *   └──────────────────────────────────────────────────────────┘
 *   ┌ 선택 없음 ──────────────────────────────────────────────┐
 *   │ 함선 타일 드래그      → 탐지                              │
 *   │ 그 외 타일 드래그     → 식별                              │
 *   │ 함선 클릭             → 선택                              │
 *   └──────────────────────────────────────────────────────────┘
 *
 * 그래서 '함선 본체 = 탐지', '테두리 = 이동' 으로 채널이 갈린다.
 * 이동 시작 칸에서 본체가 빠진 것은 이 때문이다 (엔진은 여전히 허용한다).
 */
(function (WS) {
  'use strict';

  var X = WS.game, B = WS.BALANCE, C = X.C;
  var $ = function (id) { return document.getElementById(id); };

  var G = {
    st: null, sandbox: false, control: 'P1',
    bot: { P1: false, P2: true },
    paused: false, speed: 1, lastTick: 0,
    setupPlayer: 'P1', setupLen: null,
    sel: { shipId: null, act: null, a: null, b: null },   // act 는 드래그가 끝나야 정해진다
    drag: null,          // { from, cur, act, shipId, cells, dir }
    fireAt: null,        // 지정된 포격 목표 칸
    cand: '', hl: null, preview: null,
    ovl: { move: null, fire: null, ident: null },   // 선택 상태에 따라 보이는 오버레이
    msg: '', err: false, cells: null, gridFor: null
  };

  var COST = { move: B.cost.move, scan: B.cost.scan, identify: B.cost.identify, fire: B.cost.fire };
  var ACTNAME = { move: '이동', scan: '탐지', identify: '식별', fire: '포격' };

  /* ── 게임 ─────────────────────────────────────────────── */
  function newGame() {
    var seed = $('seed').value.trim();
    var dict = $('dictSel').value === 'stub' ? WS.dict.stub : WS.dict.permissive;
    G.st = X.createGame({ seed: seed || undefined, dict: dict });
    $('seed').value = G.st.seed;
    G.setupPlayer = 'P1'; G.setupLen = null; G.paused = false; G.gridFor = null;
    resetSel();
    say('준비 페이즈 — 「양측 자동 배치 → 전투 시작」이 가장 빠릅니다.');
    paint();
  }
  function resetSel() {
    G.sel = { shipId: null, act: null, a: null, b: null };
    G.fireAt = null;
    G.cand = ''; G.hl = G.preview = G.drag = null;
    G.ovl = { move: null, fire: null, ident: null };
  }
  /** 잡아 둔 단어 박스만 버린다 (함선 선택은 유지) */
  function clearBox() {
    G.sel.act = null; G.sel.a = G.sel.b = null;
    G.cand = ''; G.preview = null; G.drag = null;
    $('word').value = ''; $('word').placeholder = '단어';
  }
  function clearTarget() { clearBox(); G.fireAt = null; computeHL(); }
  /** 함선 선택 해제 — 이 상태에서 드래그하면 식별이다 */
  function deselect(msg) {
    G.sel.shipId = null; G.fireAt = null; clearBox(); computeHL();
    if (msg) say(msg);
  }
  function say(m, err) { G.msg = m; G.err = !!err; }
  function viewer() { return G.st.phase === 'SETUP' ? G.setupPlayer : G.control; }
  function selShip() { return G.sel.shipId ? G.st.ships[G.sel.shipId] : null; }

  function tick() {
    var st = G.st; if (!st) return;
    var now = performance.now(), dt = Math.min(400, now - G.lastTick);
    G.lastTick = now;
    if (st.phase === 'BATTLE' && !G.paused) {
      X.advance(st, dt * G.speed);
      if (G.bot.P1) WS.botAct(st, 'P1');
      if (G.bot.P2) WS.botAct(st, 'P2');
    }
    paint();
  }

  /* ── 행동 가능 여부 ────────────────────────────────────── */
  function why(act, sh) {
    var st = G.st;
    if (st.phase !== 'BATTLE') return '전투 중이 아님';
    if (st.ap[G.control] < COST[act]) return 'AP 부족 — ' + COST[act] + ' 필요, ' + st.ap[G.control] + ' 보유';
    if (act === 'identify') {
      var any = X.fleetOf(st, G.control).some(function (s) { return !s.sunk && X.cooldownLeft(st, s) <= 0; });
      return any ? null : '쓸 수 있는 함선이 없음 (전부 쿨타임)';
    }
    sh = sh || selShip();
    if (!sh) return '함선을 먼저 고르세요 (보드에서 아군 함선 클릭, 또는 Tab)';
    if (sh.sunk) return '침몰한 함선입니다';
    var cd = X.cooldownLeft(st, sh);
    if (cd > 0) return '쿨타임 ' + (cd / 1000).toFixed(1) + '초 남음';
    if (act === 'move' && sh.identified) return '식별당한 함선은 이동할 수 없습니다 (영구)';
    return null;
  }

  /* ── 방향/박스 스냅 ────────────────────────────────────── */
  /** 탐지는 4방위뿐이다 (v0.8에서 대각 폐지). 가장 많이 끈 축으로 스냅한다. */
  function snapDir4(dx, dy) {
    if (!dx && !dy) return null;
    if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'E' : 'Wd';
    return dy > 0 ? 'N' : 'S';
  }
  /** from 에서 cur 방향으로 len 칸 직선 박스. 보드를 벗어나면 null */
  function snapBox(from, cur, len) {
    var a = X.xy(from), b = X.xy(cur);
    var dx = b.x - a.x, dy = b.y - a.y;
    if (!dx && !dy) return null;
    var d = Math.abs(dx) >= Math.abs(dy) ? [Math.sign(dx), 0] : [0, Math.sign(dy)];
    var ex = a.x + d[0] * (len - 1), ey = a.y + d[1] * (len - 1);
    if (!X.inB(ex, ey)) return null;
    return X.lineBox(from, X.idx(ex, ey));
  }
  function dragLen(from, cur, lo, hi) {
    var a = X.xy(from), b = X.xy(cur);
    var n = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) + 1;
    return Math.max(lo, Math.min(hi, n));
  }

  /* ── 사거리 오버레이 + 클릭 가능 칸 ─────────────────────
   * 오버레이는 선택 상태가 정한다.
   *   함선 선택됨 → 초록 테두리(이동 시작 칸) + 붉은 칠(포격 사거리)
   *   선택 없음   → 파란 칠(식별 시작 가능 칸)
   * 색이 겹쳐도 섞이지 않도록 채널을 나눈다 — 사거리는 배경 틴트, 이동은 링.
   */
  var STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  /** 테두리 칸 중 실제로 합법 이동 박스를 시작할 수 있는 칸 (난수를 쓰지 않는다) */
  function moveStarts(sh, ring) {
    var st = G.st, k = st.kn[sh.owner], out = new Set();
    ring.forEach(function (r) {
      var p = X.xy(r);
      for (var di = 0; di < STEPS.length; di++) {
        var d = STEPS[di], cells = [], ok = true;
        for (var q = 0; q < sh.len; q++) {
          var nx = p.x + d[0] * q, ny = p.y + d[1] * q;
          if (!X.inB(nx, ny)) { ok = false; break; }
          var c = X.idx(nx, ny);
          if (!k.onset[c]) { ok = false; break; }            // 초성 미판명
          var o = st.tiles[c].occupant;
          if (o && o !== sh.id && st.ships[o].owner === sh.owner) { ok = false; break; }
          cells.push(c);
        }
        if (!ok) continue;
        if (cells.every(function (c) { return sh.tiles.indexOf(c) >= 0; })) continue;   // 자기 자리
        if (!X.canName(st, cells)) continue;
        out.add(r); return;
      }
    });
    return out;
  }

  function computeHL() {
    G.hl = null;
    G.ovl = { move: null, fire: null, ident: null };
    var st = G.st, i;
    if (!st || st.phase !== 'BATTLE') return;
    var sh = selShip();

    if (sh && !sh.sunk) {
      // 아군 함선이 깔고 앉은 칸은 테두리에서 뺀다 — 본체 드래그는 '탐지'로 예약돼 있다
      var mine = new Set();
      X.fleetOf(st, G.control).forEach(function (s) {
        if (!s.sunk) s.tiles.forEach(function (t) { mine.add(t); });
      });
      var ring = new Set(), fire = new Set(), r = X.fireRange(sh.len);
      for (i = 0; i < X.N; i++) {
        if (X.shipWithin(st, sh, i, r)) fire.add(i);
        if (!mine.has(i) && X.shipWithin(st, sh, i, B.move.adjacency)) ring.add(i);
      }
      G.ovl.fire = fire;
      if (!sh.identified) { G.ovl.move = ring; G.hl = moveStarts(sh, ring); }
      return;
    }

    // 선택 없음 — 식별 시작 가능 칸 (함대 전체 사거리 기준)
    var kn = st.kn[G.control], set = new Set();
    var live = X.fleetOf(st, G.control).filter(function (x) { return !x.sunk; });
    if (!live.length) return;
    for (i = 0; i < X.N; i++) {
      if (!kn.onset[i]) continue;
      if (live.some(function (x) { return X.shipWithin(st, x, i, B.identify.range); })) set.add(i);
    }
    G.ovl.ident = set;
  }

  /* ── 선택 ──────────────────────────────────────────────── */
  function pickShip(id, quiet) {
    var sh = G.st.ships[id];
    if (!sh || sh.owner !== G.control || sh.sunk) return;
    G.sel.shipId = id; G.fireAt = null; clearBox(); computeHL();
    if (quiet) return;
    var cd = X.cooldownLeft(G.st, sh);
    say('L' + sh.len + ' 「' + sh.name.join('') + '」 HP ' + sh.hp + '/' + sh.maxHp +
      ' · 포격 ' + X.fireRange(sh.len) + '칸' +
      (sh.identified ? ' · 식별당함(이동 불가)' : '') + (cd > 0 ? ' · 쿨 ' + (cd / 1000).toFixed(1) + 's' : '') +
      ' — 초록 테두리 드래그=이동, 함선 위 드래그=탐지, 붉은 칸 클릭=포격 목표');
  }
  function cycleShip() {
    var list = X.fleetOf(G.st, G.control).filter(function (s) { return !s.sunk; });
    if (!list.length) return;
    var at = list.findIndex(function (s) { return s.id === G.sel.shipId; });
    for (var k = 1; k <= list.length; k++) {
      var c = list[(at + k) % list.length];
      if (X.cooldownLeft(G.st, c) <= 0) return pickShip(c.id);
    }
    pickShip(list[(at + 1) % list.length].id);
  }

  /* ── 드래그 ────────────────────────────────────────────
   * 누른 칸 하나가 행동을 결정한다. 모드 버튼이 없는 이유다.
   */
  function dragIntent(i) {
    var st = G.st, p = G.control;
    var occ = st.tiles[i].occupant;
    // ① 아군 함선 타일 → 탐지. 선택 여부와 무관하며, 누른 칸의 함선이 쏜다
    if (occ && st.ships[occ].owner === p && !st.ships[occ].sunk)
      return { act: 'scan', shipId: occ };
    var sh = selShip();
    // ② 함선 선택됨 → 초록 테두리에서만 이동
    if (sh && !sh.sunk)
      return (G.ovl.move && G.ovl.move.has(i)) ? { act: 'move', shipId: sh.id } : null;
    // ③ 선택 없음 → 식별
    return (G.ovl.ident && G.ovl.ident.has(i)) ? { act: 'identify', shipId: null } : null;
  }

  function onDown(i) {
    var st = G.st;
    if (st.phase === 'SETUP') { G.drag = { from: i, cur: i }; return; }
    if (st.phase !== 'BATTLE') return;
    var it = dragIntent(i);
    if (!it) return;
    G.drag = { from: i, cur: i, act: it.act, shipId: it.shipId, cells: null, dir: null };
    G.preview = null;
    paint();
  }

  function onMove(i) {
    if (!G.drag || G.drag.cur === i) return;
    G.drag.cur = i;
    updatePreview();
    paint();
  }

  function updatePreview() {
    var d = G.drag, st = G.st;
    G.preview = null;
    if (!d) return;
    d.cells = null; d.dir = null;
    if (d.cur === d.from) return;

    if (st.phase === 'SETUP') {
      var box = snapBox(d.from, d.cur, G.setupLen || 3);
      if (box) { d.cells = box; G.preview = new Set(box); }
      return;
    }
    if (d.act === 'scan') {
      var a = X.xy(d.from), b = X.xy(d.cur);
      var dir = snapDir4(b.x - a.x, b.y - a.y);
      if (!dir) return;
      d.dir = dir;
      d.cells = X.scanCells(d.from, dir);
      G.preview = new Set(d.cells);
      return;
    }
    var sh = d.shipId ? st.ships[d.shipId] : null;
    var len = d.act === 'move'
      ? (sh ? sh.len : 3)
      : dragLen(d.from, d.cur, B.identify.minLen, B.identify.maxLen);
    var box2 = snapBox(d.from, d.cur, len);
    if (box2) { d.cells = box2; G.preview = new Set(box2); }
  }

  function onUp() {
    var d = G.drag; G.drag = null;
    if (!d) return;
    var st = G.st;

    if (st.phase === 'SETUP') {
      if (d.cells) { G.sel.a = d.cells[0]; G.sel.b = d.cells[d.cells.length - 1]; commitSetupBox(d.cells); }
      G.preview = null; return paint();
    }
    G.preview = null;
    if (!d.cells) return paint();

    if (d.act === 'scan') return exec(X.scan(st, G.control, d.shipId, d.from, d.dir));

    G.sel.act = d.act;
    if (d.act === 'move') G.sel.shipId = d.shipId;
    G.fireAt = null;
    G.sel.a = d.cells[0]; G.sel.b = d.cells[d.cells.length - 1];
    commitBox(d.cells);
    paint();
  }

  function commitBox(cells) {
    var st = G.st;
    G.cand = X.nameFor(st, cells) || '';
    var onsets = cells.map(function (c) { return st.wreck[c] ? st.wreck[c] : st.tiles[c].onset; }).join('');
    $('word').value = '';
    $('word').placeholder = G.cand || '단어';
    $('word').focus();
    say('초성 ' + onsets + ' (' + cells.length + '칸) — 단어를 입력하고 Enter.' +
      (G.cand ? ' 빈칸으로 Enter 치면 「' + G.cand + '」' : ''));
  }
  function commitSetupBox(cells) {
    var st = G.st;
    if (cells.length !== G.setupLen) { say('길이 ' + G.setupLen + '칸이 아닙니다.', true); return; }
    G.cand = X.nameFor(st, cells) || '';
    $('setupWord').value = ''; $('setupWord').placeholder = G.cand || '함명';
    $('setupWord').focus();
    say('초성 ' + cells.map(function (c) { return st.tiles[c].onset; }).join('') +
      ' — 함명을 입력하고 Enter.' + (G.cand ? ' (빈칸이면 「' + G.cand + '」)' : ''));
  }

  /* ── 클릭 (드래그하지 않고 뗀 경우) ─────────────────────
   *   아군 함선        → 선택
   *   사거리 안 빈칸   → 포격 목표 지정 (같은 칸을 다시 누르면 발사)
   *   사거리 밖        → 선택 취소
   */
  function onClick(i) {
    var st = G.st, p = G.control;
    if (st.phase !== 'BATTLE') return paint();
    var occ = st.tiles[i].occupant;
    if (occ && st.ships[occ].owner === p && !st.ships[occ].sunk) { pickShip(occ); return paint(); }

    var sh = selShip();
    if (sh && !sh.sunk) {
      if (G.ovl.fire && G.ovl.fire.has(i)) {
        if (G.fireAt === i) return fireNow();
        G.fireAt = i; clearBox();
        say('포격 목표 ' + X.label(p, i) + ' — 「포격」 버튼(또는 같은 칸 한 번 더)으로 발사. AP ' + COST.fire);
        return paint();
      }
      deselect('포격 사거리 밖 — 선택을 풀었습니다. 이제 타일을 드래그하면 식별입니다.');
      return paint();
    }

    if (G.sel.a != null) { clearBox(); say('식별 박스 취소.'); return paint(); }
    say(G.ovl.ident && G.ovl.ident.has(i)
      ? '여기서 드래그하면 식별(3~4칸)입니다. 아군 함선을 클릭하면 선택됩니다.'
      : '아군 함선을 클릭해 고르거나, 파란 범위 안에서 드래그해 식별하세요.');
    paint();
  }

  function fireNow() {
    var sh = selShip();
    if (!sh) { say('함선을 먼저 고르세요.', true); return paint(); }
    if (G.fireAt == null) { say('붉게 칠한 사거리 안에서 목표 칸을 클릭하세요.', true); return paint(); }
    var w = why('fire', sh); if (w) { say('포격 — ' + w, true); return paint(); }
    var t = G.fireAt; G.fireAt = null;
    exec(X.fire(G.st, G.control, sh.id, t));
  }

  function onSetupClick(i) {
    if (!G.setupLen) { say('배치할 함선 길이를 먼저 고르세요.', true); return paint(); }
    if (G.sel.a == null || G.sel.b != null) { G.sel.a = i; G.sel.b = null; say('끝 칸을 클릭하거나 끌어 주세요.'); return paint(); }
    var box = snapBox(G.sel.a, i, G.setupLen);
    if (!box) { G.sel.a = i; say('직선 ' + G.setupLen + '칸이 아닙니다.', true); return paint(); }
    G.sel.b = box[box.length - 1]; commitSetupBox(box); paint();
  }

  function boxCells() {
    var s = G.sel;
    if (s.a == null) return null;
    if (s.b == null) return [s.a];
    return X.lineBox(s.a, s.b);
  }

  function doExec() {
    var st = G.st, s = G.sel, cells = boxCells();
    if (!cells || cells.length < 2) { say('보드에서 박스를 먼저 잡으세요.', true); return paint(); }
    var word = $('word').value.trim() || G.cand;
    if (!word) { say('단어를 입력하세요.', true); return paint(); }
    exec(s.act === 'move'
      ? X.move(st, G.control, s.shipId, cells, word)
      : X.identify(st, G.control, cells, word));
  }

  function exec(res) {
    if (!res.ok) { say('거부 — ' + res.reason, true); paint(); return; }
    say(res.msg || '완료');
    if (res.sunkSelf) G.sel.shipId = null;
    clearTarget();
    paint();
  }

  /* ── 렌더 ──────────────────────────────────────────────── */
  function mk(tag, cls) { var e = document.createElement(tag); if (cls) e.className = cls; return e; }

  function buildGrid() {
    var v = viewer(), board = $('board');
    board.style.setProperty('--cols', X.W);
    board.innerHTML = '';
    G.cells = new Array(X.N);
    var frag = document.createDocumentFragment(), i;
    frag.appendChild(mk('div', 'hdr'));
    for (i = 0; i < X.W; i++) { var h = mk('div', 'hdr'); h.textContent = String.fromCharCode(97 + i); frag.appendChild(h); }
    var ys = [];
    if (v === 'P1') { for (i = X.H - 1; i >= 0; i--) ys.push(i); }
    else { for (i = 0; i < X.H; i++) ys.push(i); }
    ys.forEach(function (yy) {
      var rh = mk('div', 'rowh'); rh.textContent = X.viewRow(v, yy); frag.appendChild(rh);
      for (var xx = 0; xx < X.W; xx++) {
        var id = X.idx(xx, yy), el = mk('div', 'cell');
        el.dataset.i = id;
        var t = mk('span', 't'), bar = mk('i', 'hb'), inner = mk('b', ''), mark = mk('i', 'mk'),
            hull = mk('i', 'hull');
        bar.appendChild(inner);
        el.appendChild(t); el.appendChild(bar); el.appendChild(mark); el.appendChild(hull);
        frag.appendChild(el);
        G.cells[id] = { el: el, txt: t, bar: bar, fill: inner, mk: mark, hull: hull, hullCls: '' };
      }
    });
    board.appendChild(frag);
    G.gridFor = v;
    // 보드가 화면보다 길면 스크롤이 생긴다. 맨 위는 '상대 끝'이라 내 함대가 안 보인다 —
    // 두 시점 모두 자기 1행이 아래쪽이므로, 새로 그릴 때마다 아래로 붙여 둔다.
    var sc = board.parentNode;
    if (sc && sc.scrollTop != null) sc.scrollTop = sc.scrollHeight;
  }

  /* 함선 테두리 — 같은 함선이 아닌 쪽에만 선을 긋는다.
   * 배가 나란히 붙어도 어디까지가 한 척인지 보인다.
   * 화면 위/아래는 시점에 따라 y 방향이 뒤집히므로 up 으로 보정한다. */
  var HSIDE = ['hT', 'hB', 'hL', 'hR'];
  function hullClass(hullId, i, up) {
    var h = hullId[i], p = X.xy(i), cls = 'hull on';
    var n = [[0, up], [0, -up], [-1, 0], [1, 0]];
    for (var k = 0; k < 4; k++) {
      var nx = p.x + n[k][0], ny = p.y + n[k][1];
      if (!X.inB(nx, ny) || hullId[X.idx(nx, ny)] !== h) cls += ' ' + HSIDE[k];
    }
    return cls;
  }

  function paint() {
    var st = G.st; if (!st) return;
    var v = viewer();
    if (G.gridFor !== v || !G.cells) buildGrid();
    var omni = G.sandbox, sh = selShip();
    var selSet = new Set(G.preview ? [] : (boxCells() || []));
    var dep = X.deployRange(v), setup = st.phase === 'SETUP';
    var anchor = G.drag ? G.drag.from : null;
    // 선택된 함선은 테두리를 노랗게 물들여 표시한다 (윤곽선을 겹치지 않는다)
    var pickSet = (sh && !sh.sunk && st.phase === 'BATTLE') ? new Set(sh.tiles) : null;
    var up = (v === 'P1') ? 1 : -1;
    var i;

    // 1단계 — 투영해 두고, 어느 칸이 어느 함선인지 모은다 (테두리 계산용)
    var proj = new Array(X.N), hullId = new Array(X.N);
    for (i = 0; i < X.N; i++) {
      var pt = proj[i] = X.projectTile(st, v, i, omni);
      hullId[i] = pt.mine ? pt.mine.id : (pt.enemy ? pt.enemy.id : null);
    }

    // 2단계 — 렌더
    for (i = 0; i < X.N; i++) {
      var t = proj[i], c = G.cells[i], cls = 'cell', txt = '';
      if (t.onsetKnown) cls += ' known';
      if (t.syl) { txt = t.syl; cls += t.stale ? ' syl stale' : ' syl'; } else if (t.onset) txt = t.onset;

      if (t.wreck) cls += ' wreck';
      else if (t.mine) { cls += ' mine'; if (t.mine.cd > 0) cls += ' cd'; }
      else if (t.enemy) cls += ' enemy';
      else if (t.contact === C.CONTACT) cls += ' contact';
      else if (t.contact === C.GHOST) { cls += ' ghost'; if (!txt) txt = '?'; }

      var marked = (t.mine && t.mine.identified) || t.enemyIdentified || (t.enemy && t.enemy.identified);
      if (X.viewRow(v, X.xy(i).y) === B.win.landingRow) cls += ' landing';
      if (setup) { var yy2 = X.xy(i).y; if (yy2 >= dep[0] && yy2 <= dep[1]) cls += ' zone'; }
      // 사거리 — 배경 틴트 (겹쳐도 구분되도록 포격=붉은, 식별=파란)
      if (G.ovl.fire && G.ovl.fire.has(i)) cls += ' rFire';
      if (G.ovl.ident && G.ovl.ident.has(i)) cls += ' rIdent';
      // 이동 테두리 — 링 (채널이 달라 사거리와 같이 보여도 안 섞인다)
      if (G.ovl.move && G.ovl.move.has(i)) cls += ' rMove';
      if (G.hl && G.hl.has(i)) cls += ' hl';
      if (pickSet && pickSet.has(i)) cls += ' pick';
      if (G.preview && G.preview.has(i)) cls += ' prev';
      if (selSet.has(i)) cls += ' sel';
      if (anchor === i) cls += ' anchor';

      var hp = t.mine ? t.mine : (t.enemyState || null);
      if (hp) { c.bar.style.display = 'block'; c.fill.style.width = Math.max(0, (hp.hp / hp.maxHp) * 100) + '%'; }
      else c.bar.style.display = 'none';

      var hc = hullId[i] ? hullClass(hullId, i, up) : 'hull';
      if (c.hullCls !== hc) { c.hull.className = hc; c.hullCls = hc; }

      var mkc = 'mk' + (t.exposed ? ' ex' : '') + (marked ? ' id' : '') + (G.fireAt === i ? ' tgt' : '');
      if (c.mk.className !== mkc) c.mk.className = mkc;
      if (c.el.className !== cls) c.el.className = cls;
      if (c.txt.textContent !== txt) c.txt.textContent = txt;
    }
    $('viewLabel').textContent = v + ' 시점 — ' + B.win.landingRow + '행(상륙 목표)이 위쪽';
    renderStatus(); renderPanels(); renderLog();
  }

  function apPips(n) {
    var s = '';
    for (var i = 0; i < B.ap.max; i++) s += '<i class="pip' + (i < n ? ' on' : '') + '"></i>';
    return '<span class="pips">' + s + '</span>';
  }

  function renderStatus() {
    var st = G.st, s = $('status');
    $('clockRow').classList.toggle('hidden', st.phase !== 'BATTLE');
    if (st.phase === 'OVER') {
      s.innerHTML = '<span class="over">' + (st.winReason === 'DRAW' ? '무승부 — 양측 전멸'
        : '★ ' + st.winner + ' 승리 — ' + (st.winReason === 'LANDING' ? '상륙' : '적 함대 전멸')) +
        '</span><span>' + (st.t / 1000).toFixed(0) + '초</span><span>시드 ' + st.seed + '</span>';
      return;
    }
    if (st.phase === 'SETUP') {
      s.innerHTML = '<span>준비 페이즈</span><span>배치 중 <b>' + G.setupPlayer + '</b></span><span>' +
        X.fleetOf(st, G.setupPlayer).length + ' / ' + X.fleetSpec().length + '척</span><span>시드 ' + st.seed + '</span>';
      return;
    }
    var me = G.control;
    s.innerHTML = '<span>⏱ <b>' + (st.t / 1000).toFixed(1) + 's</b></span>' +
      '<span>' + me + ' AP <b>' + st.ap[me] + '</b>' + apPips(st.ap[me]) + '</span>' +
      (G.sandbox ? '<span class="d">' + X.other(me) + ' AP ' + st.ap[X.other(me)] + '</span>' : '') +
      (G.paused ? '<span class="over">일시정지</span>' : '');
  }

  function renderPanels() {
    var st = G.st, setup = st.phase === 'SETUP';
    $('setupPanel').classList.toggle('hidden', !setup);
    $('battlePanel').classList.toggle('hidden', setup || st.phase === 'OVER');
    $('hint').textContent = G.msg;
    $('hint').classList.toggle('err', G.err);
    if (setup) { renderSetupFleet(); $('btnStart').disabled = !X.setupComplete(st); return; }
    renderFleet();
    var sh = selShip(), act = G.sel.act, picked = !!(sh && !sh.sunk);

    $('modeTag').className = 'mode' + (picked ? ' on' : '');
    $('modeTag').textContent = picked
      ? '선택 L' + sh.len + ' 「' + sh.name.join('') + '」 — 테두리 드래그=이동 · 함선 위 드래그=탐지 · 붉은 칸 클릭=포격'
      : '선택 없음 — 함선 클릭=선택 · 함선 위 드래그=탐지 · 파란 칸 드래그=식별';

    $('fireRow').classList.toggle('hidden', !picked);
    $('btnFire').disabled = !(picked && G.fireAt != null);
    $('fireAt').textContent = G.fireAt == null
      ? '목표 미지정 — 붉은 칸을 클릭하세요'
      : '목표 ' + X.label(G.control, G.fireAt);
    $('wordRow').classList.toggle('hidden', !((act === 'move' || act === 'identify') && G.sel.b != null));
    $('wordTag').textContent = act === 'move' ? '이동 단어' : '식별 — 적 함명 추측';
  }

  function renderSetupFleet() {
    var st = G.st, p = G.setupPlayer, have = {}, html = '';
    X.fleetOf(st, p).forEach(function (s) { have[s.len] = (have[s.len] || 0) + 1; });
    B.ships.forEach(function (spec) {
      var placed = have[spec.len] || 0;
      html += '<div class="ship' + (G.setupLen === spec.len ? ' sel' : '') + (placed >= spec.count ? ' done' : '') +
        '" data-len="' + spec.len + '"><span>길이 ' + spec.len + '</span><span class="d">HP ' + spec.hp +
        ' · 사거리 ' + spec.fireRange + ' · 이동쿨 ' + (X.moveCooldown(spec.len) / 1000) + 's</span>' +
        '<span class="hp">' + placed + ' / ' + spec.count + '</span></div>';
    });
    X.fleetOf(st, p).forEach(function (s) {
      html += '<div class="ship done"><span>L' + s.len + '</span><span class="nm">' + s.name.join('') +
        '</span><span class="hp">' + X.label(p, s.tiles[0]) + '</span></div>';
    });
    $('setupFleet').innerHTML = html;
  }

  function renderFleet() {
    var st = G.st, p = G.control, html = '';
    X.fleetOf(st, p).forEach(function (s) {
      var cd = X.cooldownLeft(st, s);
      var cls = 'ship' + (G.sel.shipId === s.id ? ' sel' : '') + (s.sunk ? ' sunk' : '') + (cd > 0 ? ' cool' : '');
      html += '<div class="' + cls + '" data-ship="' + s.id + '"><span>L' + s.len + '</span>' +
        '<span class="nm">' + (s.sunk ? '—' : s.name.join('')) + '</span>' +
        (s.identified ? '<span class="bad">식별당함</span>' : '') +
        '<span class="hp">' + (s.sunk ? '침몰' : 'HP ' + s.hp + '/' + s.maxHp + ' · ' + X.label(p, s.tiles[0]) +
          (cd > 0 ? ' · 쿨 ' + (cd / 1000).toFixed(1) + 's' : ' · 대기')) + '</span></div>';
    });
    $('fleet').innerHTML = html;
  }

  var lastLogLen = -1, lastLogFor = null;
  function renderLog() {
    var st = G.st, who = G.control, key = G.sandbox ? 'ALL' : who;
    if (st.log.length === lastLogLen && key === lastLogFor) return;
    lastLogLen = st.log.length; lastLogFor = key;
    var rows = st.log.filter(function (l) { return G.sandbox || !l.forPlayer || l.forPlayer === who; });
    var el = $('log');
    el.innerHTML = rows.slice(-200).map(function (l) {
      var hl = l.text.indexOf('★') >= 0 || l.text.indexOf('침몰') >= 0 || l.text.indexOf('충돌') >= 0 || l.text.indexOf('!') === 0;
      return '<div' + (hl ? ' class="hl"' : '') + '><span class="ts">' + (l.t / 1000).toFixed(1) + 's</span> ' +
        (l.forPlayer ? '<span class="who">' + l.forPlayer + '</span> ' : '') + esc(l.text) + '</div>';
    }).join('');
    el.scrollTop = el.scrollHeight;
  }
  function esc(s) { return String(s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }

  /* ── 바인딩 ────────────────────────────────────────────── */
  function bind() {
    $('btnNew').onclick = newGame;
    $('seed').onkeydown = function (e) { if (e.key === 'Enter') newGame(); };
    $('omni').onchange = function () { G.sandbox = this.checked; lastLogLen = -1; paint(); };

    /* 누름은 드래그가 될 수도, 클릭이 될 수도 있다. 어느 쪽이든 press 가 먼저 잡는다 —
     * onDown 이 드래그를 시작하지 않은 칸(사거리 안 빈칸 등)에서도 클릭이 살아 있어야 한다. */
    var board = $('board'), press = null;
    board.onmousedown = function (e) {
      if (e.button !== 0) return;
      var c = e.target.closest('.cell'); if (!c) return;
      e.preventDefault();
      press = { from: +c.dataset.i, moved: false };
      onDown(press.from);
    };
    board.onmousemove = function (e) {
      if (!press) return;
      var c = e.target.closest('.cell'); if (!c) return;
      var i = +c.dataset.i;
      if (i !== press.from) press.moved = true;
      if (G.drag) onMove(i);
    };
    document.onmouseup = function () {
      if (!press) return;
      var f = press.from, moved = press.moved;
      press = null;
      if (moved) return onUp();
      G.drag = null; G.preview = null;
      if (G.st.phase === 'SETUP') onSetupClick(f); else onClick(f);
    };

    $('btnPause').onclick = function () {
      G.paused = !G.paused;
      this.textContent = G.paused ? '▶ 재개' : '⏸ 일시정지';
      paint();
    };
    Array.prototype.forEach.call(document.querySelectorAll('.sp'), function (b) {
      b.onclick = function () {
        G.speed = +b.dataset.sp;
        Array.prototype.forEach.call(document.querySelectorAll('.sp'), function (o) { o.classList.toggle('on', o === b); });
      };
    });
    Array.prototype.forEach.call(document.querySelectorAll('.pc'), function (b) {
      b.onclick = function () {
        G.control = b.dataset.pc; resetSel(); lastLogLen = -1; G.gridFor = null;
        Array.prototype.forEach.call(document.querySelectorAll('.pc'), function (o) { o.classList.toggle('on', o === b); });
        say('조작 대상 → ' + G.control); paint();
      };
    });
    $('bot1').onchange = function () { G.bot.P1 = this.checked; };
    $('bot2').onchange = function () { G.bot.P2 = this.checked; };

    $('setupFleet').onclick = function (e) {
      var d = e.target.closest('[data-len]'); if (!d) return;
      G.setupLen = +d.dataset.len; G.sel.a = G.sel.b = null; G.cand = '';
      say('배치 구역(파랑) 안에서 드래그하거나 두 칸을 클릭하세요. 길이 ' + G.setupLen);
      paint();
    };
    $('btnAuto1').onclick = function () { autoPlace('P1'); };
    $('btnAuto2').onclick = function () { autoPlace('P2'); };
    $('btnAutoAll').onclick = function () { autoPlace('P1'); autoPlace('P2'); };
    $('btnSuggest2').onclick = function () {
      if (!G.cand) { say('먼저 보드에서 박스를 잡으세요.', true); return paint(); }
      $('setupWord').value = G.cand; paint();
    };
    $('setupWord').onkeydown = function (e) { if (e.key === 'Enter') $('btnPlace').onclick(); };
    $('btnPlace').onclick = function () {
      var cells = boxCells();
      if (!cells || cells.length !== G.setupLen) { say('보드에서 박스를 잡으세요.', true); return paint(); }
      var r = X.placeShip(G.st, G.setupPlayer, G.setupLen, cells, $('setupWord').value.trim() || G.cand);
      if (!r.ok) { say('배치 거부 — ' + r.reason, true); return paint(); }
      $('setupWord').value = ''; $('setupWord').placeholder = '함명';
      G.sel.a = G.sel.b = null; G.cand = '';
      say('배치: L' + r.ship.len + ' 「' + r.ship.name.join('') + '」');
      advanceSetup(); paint();
    };
    $('btnStart').onclick = function () {
      var r = X.startBattle(G.st);
      if (!r.ok) { say(r.reason, true); return paint(); }
      resetSel(); G.lastTick = performance.now(); G.paused = false; G.gridFor = null;
      var first = X.fleetOf(G.st, G.control).filter(function (s) { return !s.sunk; })[0];
      if (first) pickShip(first.id, true);
      say('전투 시작. 함선을 클릭해 고르고, 초록 테두리를 드래그하면 이동입니다.');
      paint();
    };

    $('fleet').onclick = function (e) {
      var d = e.target.closest('[data-ship]'); if (!d) return;
      pickShip(d.dataset.ship); paint();
    };
    $('btnFire').onclick = fireNow;
    $('btnSuggest').onclick = function () {
      if (!G.cand) { say('먼저 보드에서 박스를 잡으세요.', true); return paint(); }
      $('word').value = G.cand; paint();
    };
    $('word').onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); doExec(); } };
    $('btnExec').onclick = doExec;
    $('btnCancel').onclick = function () { deselect('선택 취소 — 드래그하면 식별입니다.'); paint(); };

    $('btnTests').onclick = runTests;
    $('btnCloseTests').onclick = function () { $('testsOverlay').classList.add('hidden'); };

    /* 행동 단축키(1~4)와 방향키(WASD·QEZC)는 v0.8에서 없앴다 —
     * 모드가 사라졌고 탐지 방향은 드래그가 정한다. */
    document.onkeydown = function (e) {
      if (e.target && e.target.tagName === 'INPUT') return;
      if (G.st.phase !== 'BATTLE') return;
      if (e.key === 'Tab') { e.preventDefault(); cycleShip(); return paint(); }
      if (e.key === 'Escape') { deselect('선택 취소 — 드래그하면 식별입니다.'); return paint(); }
      if (e.key === ' ') { e.preventDefault(); $('btnPause').onclick(); return; }
      if (e.key === 'Enter' && G.fireAt != null) { e.preventDefault(); fireNow(); }
    };
  }

  function autoPlace(p) {
    if (X.fleetOf(G.st, p).length >= X.fleetSpec().length) { say(p + '는 이미 배치 완료.', true); return paint(); }
    var r = X.autoPlace(G.st, p);
    say(r.ok ? p + ' 자동 배치 완료' : p + ' 자동 배치 실패 — ' + r.reason, !r.ok);
    advanceSetup(); paint();
  }
  function advanceSetup() {
    var st = G.st, n = X.fleetSpec().length;
    if (X.fleetOf(st, G.setupPlayer).length >= n && G.setupPlayer === 'P1' && X.fleetOf(st, 'P2').length < n) {
      G.setupPlayer = 'P2'; G.setupLen = null; G.gridFor = null;
      say('P1 배치 완료. 이제 P2를 배치하세요.');
    }
  }

  function runTests() {
    var was = G.paused; G.paused = true;
    var r = WS.tests.runAll();
    G.paused = was;
    $('testSummary').innerHTML = '<span class="' + (r.fail ? 'f' : 'p') + '">' +
      r.pass + ' / ' + r.total + ' 통과' + (r.fail ? ' · ' + r.fail + ' 실패' : '') + '</span>';
    $('testList').innerHTML = r.results.map(function (t) {
      return '<div><span class="' + (t.ok ? 'p' : 'f') + '">' + (t.ok ? 'PASS' : 'FAIL') + '</span> ' +
        esc(t.name) + (t.detail ? ' <span class="d">:: ' + esc(t.detail) + '</span>' : '') + '</div>';
    }).join('');
    $('testsOverlay').classList.remove('hidden');
  }

  window.addEventListener('DOMContentLoaded', function () {
    bind(); newGame();
    G.lastTick = performance.now();
    setInterval(tick, 100);
  });
  WS.ui = G;

})(window.WS = window.WS || {});
