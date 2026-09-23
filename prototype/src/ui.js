/* WordShip prototype — UI (v0.7 드래그 조작)
 *
 * 방향: 최종적으로 버튼을 없애고 보드 위에서 마우스+키보드만으로 다 되게 한다.
 * 지금은 과도기 — 드래그를 주 조작으로 넣고 버튼은 남겨 둔다.
 *
 * 이동   함선 본체/테두리에서 드래그 시작 → 끌면 박스 미리보기 → 놓으면 단어 입력
 * 탐지   함선 타일에서 8방향 중 하나로 드래그 → 놓으면 즉시 실행 (끄는 동안 획득 칸 미리보기)
 * 식별   함선 선택 없음. 사거리 안 아무 칸에서 드래그 → 놓으면 단어 입력
 * 포격   목표 칸 클릭 → 즉시
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
    sel: { shipId: null, act: null, a: null, b: null },
    drag: null,          // { from, cur, cells, dir }
    cand: '', hl: null, rng: null, moves: null, preview: null,
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
    G.cand = ''; G.hl = G.rng = G.moves = G.preview = G.drag = null;
  }
  function clearTarget() {
    G.sel.a = G.sel.b = null; G.cand = ''; G.preview = null; G.drag = null;
    $('word').value = ''; $('word').placeholder = '단어'; computeHL();
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
  function why(act) {
    var st = G.st;
    if (st.ap[G.control] < COST[act]) return 'AP 부족 — ' + COST[act] + ' 필요, ' + st.ap[G.control] + ' 보유';
    if (act === 'identify') {
      var any = X.fleetOf(st, G.control).some(function (s) { return !s.sunk && X.cooldownLeft(st, s) <= 0; });
      return any ? null : '쓸 수 있는 함선이 없음 (전부 쿨타임)';
    }
    var sh = selShip();
    if (!sh) return '함선을 먼저 고르세요 (보드에서 아군 함선 클릭, 또는 Tab)';
    if (sh.sunk) return '침몰한 함선입니다';
    var cd = X.cooldownLeft(st, sh);
    if (cd > 0) return '쿨타임 ' + (cd / 1000).toFixed(1) + '초 남음';
    if (act === 'move' && sh.identified) return '식별당한 함선은 이동할 수 없습니다 (영구)';
    return null;
  }

  /* ── 방향/박스 스냅 ────────────────────────────────────── */
  function snapDir8(dx, dy) {
    if (!dx && !dy) return null;
    var ax = Math.abs(dx), ay = Math.abs(dy), sx = Math.sign(dx), sy = Math.sign(dy);
    if (ax > ay * 2) return sx > 0 ? 'E' : 'Wd';
    if (ay > ax * 2) return sy > 0 ? 'N' : 'S';
    return sy > 0 ? (sx > 0 ? 'NE' : 'NW') : (sx > 0 ? 'SE' : 'SW');
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

  /* ── 클릭 가능 칸 ──────────────────────────────────────── */
  function computeHL() {
    G.hl = null; G.rng = null;
    var st = G.st, s = G.sel, i;
    if (st.phase !== 'BATTLE' || !s.act) return;
    var set = new Set();

    if (s.act === 'identify') {
      // 함선 선택 없음 — 어느 함선이든 사거리 안 + 초성 판명된 칸이 시작점
      var kn = st.kn[G.control];
      var live = X.fleetOf(st, G.control).filter(function (x) { return !x.sunk; });
      for (i = 0; i < X.N; i++) {
        if (!kn.onset[i]) continue;
        if (live.some(function (sh) { return X.shipWithin(st, sh, i, B.identify.range); })) set.add(i);
      }
      G.rng = set;
      if (s.a == null) G.hl = set;
      return;
    }

    var sh = selShip();
    if (!sh || sh.sunk) return;

    if (s.act === 'move') {
      if (sh.identified) return;
      // 시작 가능 = 함선 본체 + 테두리
      for (i = 0; i < X.N; i++) if (X.shipWithin(st, sh, i, B.move.adjacency)) set.add(i);
      G.rng = set;
      if (s.a == null) {
        G.moves = X.findMoves(st, sh);
        var starts = new Set();
        G.moves.forEach(function (m) { starts.add(m.cells[0]); });
        G.hl = starts;
      }
    } else if (s.act === 'scan') {
      G.hl = new Set(sh.tiles);
    } else if (s.act === 'fire') {
      var r = X.fireRange(sh.len);
      for (i = 0; i < X.N; i++) if (X.shipWithin(st, sh, i, r)) set.add(i);
      G.rng = set;
    }
  }

  /* ── 선택 ──────────────────────────────────────────────── */
  function pickShip(id, quiet) {
    var sh = G.st.ships[id];
    if (!sh || sh.owner !== G.control) return;
    G.sel.shipId = id; G.sel.a = G.sel.b = null; G.cand = ''; G.preview = null;
    $('word').value = ''; computeHL();
    if (!quiet) {
      var cd = X.cooldownLeft(G.st, sh);
      say('L' + sh.len + ' 「' + sh.name.join('') + '」 HP ' + sh.hp + '/' + sh.maxHp +
        (sh.identified ? ' · 식별당함(이동 불가)' : '') + (cd > 0 ? ' · 쿨 ' + (cd / 1000).toFixed(1) + 's' : '') +
        (G.sel.act ? ' — ' + ACTNAME[G.sel.act] : ' — 행동을 고르세요 (1~4)'));
    }
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

  var TIPS = {
    move: '함선 본체나 테두리(초록)에서 드래그해 목적지를 정하세요. 놓으면 단어 입력.',
    scan: '함선 타일에서 원하는 방향으로 드래그 → 놓으면 즉시 탐지. (방향 버튼도 가능)',
    identify: '함선을 고를 필요 없습니다. 파란 범위 안에서 드래그해 3~4칸 박스를 잡으세요.',
    fire: '파란 범위 안 아무 칸이나 누르면 즉시 발사됩니다.'
  };
  function setAct(act) {
    G.sel.act = act; G.sel.a = G.sel.b = null; G.cand = ''; G.preview = null; G.drag = null;
    $('word').value = ''; $('word').placeholder = '단어';
    computeHL();
    var w = why(act);
    if (w) { say(ACTNAME[act] + ' — ' + w, true); return; }
    say(ACTNAME[act] + ' (AP ' + COST[act] + ') — ' + TIPS[act]);
  }

  /* ── 드래그 ────────────────────────────────────────────── */
  function dragStartOK(i) {
    var st = G.st, s = G.sel;
    if (st.phase !== 'BATTLE' || !s.act) return false;
    if (s.act === 'fire') return false;
    if (s.act === 'identify') return !!(G.rng && G.rng.has(i));
    var sh = selShip(); if (!sh) return false;
    if (s.act === 'scan') return sh.tiles.indexOf(i) >= 0;
    if (s.act === 'move') return X.shipWithin(st, sh, i, B.move.adjacency);
    return false;
  }

  function onDown(i) {
    var st = G.st;
    if (st.phase === 'SETUP') { G.drag = { from: i, cur: i, setup: true }; return; }
    if (!dragStartOK(i)) return;
    G.drag = { from: i, cur: i };
    G.sel.a = i; G.sel.b = null; G.preview = null;
    computeHL(); paint();
  }

  function onMove(i) {
    if (!G.drag || G.drag.cur === i) return;
    G.drag.cur = i;
    updatePreview();
    paint();
  }

  function updatePreview() {
    var d = G.drag, st = G.st;
    G.preview = null; d.cells = null; d.dir = null;
    if (!d || d.cur === d.from) return;

    if (st.phase === 'SETUP') {
      var box = snapBox(d.from, d.cur, G.setupLen || 3);
      if (box) { d.cells = box; G.preview = new Set(box); }
      return;
    }
    var a = X.xy(d.from), b = X.xy(d.cur);
    if (G.sel.act === 'scan') {
      var dir = snapDir8(b.x - a.x, b.y - a.y);
      if (!dir) return;
      d.dir = dir;
      var dd = X.DIRS[dir], cells = [];
      for (var s = 1; s <= B.scan.length; s++) {
        var nx = a.x + dd[0] * s, ny = a.y + dd[1] * s;
        if (!X.inB(nx, ny)) break;
        cells.push(X.idx(nx, ny));
      }
      d.cells = cells; G.preview = new Set(cells);
      return;
    }
    var len = G.sel.act === 'move'
      ? (selShip() ? selShip().len : 3)
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
      else if (d.from === d.cur) onSetupClick(d.from);
      G.preview = null; return paint();
    }

    if (d.from === d.cur) {           // 제자리 클릭 — 앵커만 잡고 대기
      G.preview = null; computeHL();
      say(G.sel.act === 'scan' ? '이 타일에서 방향으로 드래그하거나 방향 버튼을 누르세요.'
        : '끌어서 박스를 잡거나, 반대쪽 끝 칸을 클릭하세요.');
      return paint();
    }
    if (!d.cells) { G.preview = null; return paint(); }

    if (G.sel.act === 'scan') {
      G.preview = null;
      return exec(X.scan(st, G.control, G.sel.shipId, d.from, d.dir));
    }
    G.sel.a = d.cells[0]; G.sel.b = d.cells[d.cells.length - 1];
    G.preview = null;
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

  /* ── 클릭 (드래그 없이 두 번 찍는 방식도 유지) ─────────── */
  function onClick(i) {
    var st = G.st;
    if (st.phase === 'OVER' || st.phase === 'SETUP') return;
    var p = G.control, s = G.sel;
    var occ = st.tiles[i].occupant;
    var mineHere = occ && st.ships[occ].owner === p;

    if (!s.act) {
      if (mineHere) { pickShip(occ); return paint(); }
      say('행동을 고르세요 (1 이동 / 2 탐지 / 3 식별 / 4 포격)', true); return paint();
    }
    if (s.act === 'fire') {
      if (mineHere) { pickShip(occ); return paint(); }
      var w = why('fire'); if (w) { say('포격 — ' + w, true); return paint(); }
      if (G.rng && !G.rng.has(i)) { say('사거리 밖입니다 (최대 ' + X.fireRange(selShip().len) + '칸)', true); return paint(); }
      return exec(X.fire(st, p, s.shipId, i));
    }
    if (s.act === 'scan') {
      if (mineHere) { pickShip(occ); G.sel.a = i; computeHL(); return paint(); }
      say('탐지는 자기 함선 타일에서 방향으로 드래그하세요.', true); return paint();
    }
    // move / identify — 두 번째 클릭이면 박스 확정
    if (s.a != null && i !== s.a) {
      var len = s.act === 'move' ? (selShip() ? selShip().len : 0) : dragLen(s.a, i, B.identify.minLen, B.identify.maxLen);
      var box = snapBox(s.a, i, len);
      if (box) { s.b = box[box.length - 1]; commitBox(box); return paint(); }
    }
    if (s.act === 'move' && mineHere) { pickShip(occ); return paint(); }
    if (dragStartOK(i)) { s.a = i; s.b = null; computeHL(); say('끌거나, 반대쪽 끝 칸을 클릭하세요.'); return paint(); }
    say(s.act === 'move' ? '함선 본체나 테두리(초록)에서 시작해야 합니다.' : '사거리 밖이거나 초성 미판명 칸입니다.', true);
    paint();
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
        var t = mk('span', 't'), bar = mk('i', 'hb'), inner = mk('b', '');
        bar.appendChild(inner); el.appendChild(t); el.appendChild(bar);
        frag.appendChild(el);
        G.cells[id] = { el: el, txt: t, bar: bar, fill: inner };
      }
    });
    board.appendChild(frag);
    G.gridFor = v;
  }

  function paint() {
    var st = G.st; if (!st) return;
    var v = viewer();
    if (G.gridFor !== v || !G.cells) buildGrid();
    var omni = G.sandbox, sh = selShip();
    var selSet = new Set(G.preview ? [] : (boxCells() || []));
    var pickSet = (sh && !sh.sunk && st.phase === 'BATTLE') ? new Set(sh.tiles) : null;
    var dep = X.deployRange(v), setup = st.phase === 'SETUP';

    for (var i = 0; i < X.N; i++) {
      var t = X.projectTile(st, v, i, omni), c = G.cells[i], cls = 'cell', txt = '';
      if (t.onsetKnown) cls += ' known';
      if (t.syl) { txt = t.syl; cls += t.stale ? ' syl stale' : ' syl'; } else if (t.onset) txt = t.onset;

      if (t.wreck) cls += ' wreck';
      else if (t.mine) { cls += ' mine'; if (t.mine.cd > 0) cls += ' cd'; }
      else if (t.enemy) cls += ' enemy';
      else if (t.contact === C.CONTACT) cls += ' contact';
      else if (t.contact === C.GHOST) { cls += ' ghost'; if (!txt) txt = '?'; }

      if (t.exposed) cls += ' exposed';
      if ((t.mine && t.mine.identified) || t.enemyIdentified || (t.enemy && t.enemy.identified)) cls += ' ident';
      if (X.viewRow(v, X.xy(i).y) === B.win.landingRow) cls += ' landing';
      if (setup) { var yy2 = X.xy(i).y; if (yy2 >= dep[0] && yy2 <= dep[1]) cls += ' zone'; }
      if (G.rng && G.rng.has(i)) cls += ' rng';
      if (G.hl && G.hl.has(i)) cls += ' hl';
      if (pickSet && pickSet.has(i)) cls += ' pick';
      if (G.preview && G.preview.has(i)) cls += ' prev';
      if (selSet.has(i)) cls += ' sel';
      if (G.sel.a === i) cls += ' anchor';

      var hp = t.mine ? t.mine : (t.enemyState || null);
      if (hp) { c.bar.style.display = 'block'; c.fill.style.width = Math.max(0, (hp.hp / hp.maxHp) * 100) + '%'; }
      else c.bar.style.display = 'none';
      if (c.el.className !== cls) c.el.className = cls;
      if (c.txt.textContent !== txt) c.txt.textContent = txt;
    }
    $('viewLabel').textContent = v + ' 시점 — 25행(상륙 목표)이 위쪽';
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
    var act = G.sel.act;
    $('dirRow').classList.toggle('hidden', act !== 'scan');
    $('wordRow').classList.toggle('hidden', !(act === 'move' || act === 'identify'));
    Array.prototype.forEach.call(document.querySelectorAll('.acts button'), function (b) {
      b.classList.toggle('on', b.dataset.act === act);
      b.classList.toggle('dim', !!why(b.dataset.act));
    });
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

  function scanOrigin(sh, dirKey) {
    var d = X.DIRS[dirKey];
    return sh.tiles.reduce(function (best, t) {
      var a = X.xy(t), b = X.xy(best);
      return (a.x * d[0] + a.y * d[1]) > (b.x * d[0] + b.y * d[1]) ? t : best;
    }, sh.tiles[0]);
  }

  /* ── 바인딩 ────────────────────────────────────────────── */
  function bind() {
    $('btnNew').onclick = newGame;
    $('seed').onkeydown = function (e) { if (e.key === 'Enter') newGame(); };
    $('omni').onchange = function () { G.sandbox = this.checked; lastLogLen = -1; paint(); };

    var board = $('board');
    var moved = false;
    board.onmousedown = function (e) {
      if (e.button !== 0) return;
      var c = e.target.closest('.cell'); if (!c) return;
      e.preventDefault(); moved = false;
      onDown(+c.dataset.i);
    };
    board.onmousemove = function (e) {
      if (!G.drag) return;
      var c = e.target.closest('.cell'); if (!c) return;
      var i = +c.dataset.i;
      if (i !== G.drag.from) moved = true;
      onMove(i);
    };
    document.onmouseup = function () {
      if (!G.drag) return;
      var same = G.drag.from === G.drag.cur;
      if (same && !moved) { var f = G.drag.from; G.drag = null; G.preview = null;
        if (G.st.phase === 'SETUP') onSetupClick(f); else onClick(f); return; }
      onUp();
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
      say('전투 시작. 함선을 고르고 행동(1~4)을 누른 뒤 보드에서 드래그하세요.');
      paint();
    };

    Array.prototype.forEach.call(document.querySelectorAll('.acts button'), function (b) {
      b.onclick = function () { setAct(b.dataset.act); paint(); };
    });
    $('fleet').onclick = function (e) {
      var d = e.target.closest('[data-ship]'); if (!d) return;
      pickShip(d.dataset.ship); paint();
    };
    $('dirRow').onclick = function (e) {
      var d = e.target.closest('[data-dir]'); if (!d) return;
      var sh = selShip();
      if (!sh) { say('함선을 먼저 고르세요.', true); return paint(); }
      var w = why('scan'); if (w) { say('탐지 — ' + w, true); return paint(); }
      var from = (G.sel.a != null && sh.tiles.indexOf(G.sel.a) >= 0) ? G.sel.a : scanOrigin(sh, d.dataset.dir);
      exec(X.scan(G.st, G.control, sh.id, from, d.dataset.dir));
    };
    $('btnSuggest').onclick = function () {
      if (!G.cand) { say('먼저 보드에서 박스를 잡으세요.', true); return paint(); }
      $('word').value = G.cand; paint();
    };
    $('word').onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); doExec(); } };
    $('btnExec').onclick = doExec;
    $('btnCancel').onclick = function () { clearTarget(); say('선택 취소.'); paint(); };

    $('btnTests').onclick = runTests;
    $('btnCloseTests').onclick = function () { $('testsOverlay').classList.add('hidden'); };

    document.onkeydown = function (e) {
      if (e.target && e.target.tagName === 'INPUT') return;
      if (G.st.phase !== 'BATTLE') return;
      var map = { '1': 'move', '2': 'scan', '3': 'identify', '4': 'fire' };
      if (map[e.key]) { setAct(map[e.key]); return paint(); }
      if (e.key === 'Tab') { e.preventDefault(); cycleShip(); return paint(); }
      if (e.key === 'Escape') { clearTarget(); say('선택 취소.'); return paint(); }
      if (e.key === ' ') { e.preventDefault(); $('btnPause').onclick(); return; }
      var dirs = { w: 'N', s: 'S', a: 'Wd', d: 'E', q: 'NW', e: 'NE', z: 'SW', c: 'SE' };
      var dk = dirs[String(e.key).toLowerCase()];
      if (dk && G.sel.act === 'scan') {
        var sh = selShip(); if (!sh) return;
        var w = why('scan');
        if (w) say('탐지 — ' + w, true);
        else {
          var from = (G.sel.a != null && sh.tiles.indexOf(G.sel.a) >= 0) ? G.sel.a : scanOrigin(sh, dk);
          exec(X.scan(G.st, G.control, sh.id, from, dk));
        }
        paint();
      }
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
