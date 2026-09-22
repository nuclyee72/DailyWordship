/* WordShip prototype — UI (v0.6 조작 개편)
 *
 * 조작 원칙
 *   1) 함선을 먼저 고른다 — 보드에서 직접 클릭하거나 함대 목록에서. Tab 으로 순환.
 *   2) 행동을 고른다 (1~4 또는 버튼).
 *   3) 보드가 할 수 있는 곳을 초록으로 알려준다. 거기만 누르면 된다.
 *   4) 단어는 입력창이 후보를 회색으로 제안한다. 그냥 Enter 치면 그 후보로 실행.
 *
 * 탐지는 방향 버튼만 누르면 끝난다. 발사 원점(그 방향으로 가장 앞선 타일)은 자동으로 고른다.
 */
(function (WS) {
  'use strict';

  var X = WS.game, B = WS.BALANCE, C = X.C;
  var $ = function (id) { return document.getElementById(id); };

  var G = {
    st: null,
    sandbox: false,
    control: 'P1',
    bot: { P1: false, P2: true },
    paused: false,
    speed: 1,
    lastTick: 0,
    setupPlayer: 'P1',
    setupLen: null,
    sel: { shipId: null, act: null, a: null, b: null },
    cand: '',           // 현재 박스의 추천 단어 (입력창 placeholder)
    hl: null,           // 클릭 가능한 칸 (Set)
    rng: null,          // 사거리 표시 칸 (Set)
    moves: null,        // 이동 후보 캐시
    msg: '', err: false,
    cells: null, gridFor: null
  };

  var COST = { move: B.cost.move, scan: B.cost.scan, identify: B.cost.identify, fire: B.cost.fire };
  var ACTNAME = { move: '이동', scan: '탐지', identify: '식별', fire: '포격' };

  /* ── 게임 ─────────────────────────────────────────────── */
  function newGame() {
    var seed = $('seed').value.trim();
    var dict = $('dictSel').value === 'stub' ? WS.dict.stub : WS.dict.permissive;
    G.st = X.createGame({ seed: seed || undefined, dict: dict });
    $('seed').value = G.st.seed;
    G.setupPlayer = 'P1'; G.setupLen = null;
    G.paused = false; G.gridFor = null;
    resetSel();
    say('준비 페이즈 — 「양측 자동 배치 → 전투 시작」이 가장 빠릅니다.');
    paint();
  }
  function resetSel() { G.sel = { shipId: null, act: null, a: null, b: null }; G.cand = ''; G.hl = G.rng = G.moves = null; }
  function clearTarget() { G.sel.a = G.sel.b = null; G.cand = ''; $('word').value = ''; computeHL(); }
  function say(m, err) { G.msg = m; G.err = !!err; }
  function viewer() { return G.st.phase === 'SETUP' ? G.setupPlayer : G.control; }
  function selShip() { return G.sel.shipId ? G.st.ships[G.sel.shipId] : null; }

  /* ── 시계 ──────────────────────────────────────────────── */
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
    var st = G.st, sh = selShip();
    if (!sh) return '함선을 먼저 고르세요 (보드에서 아군 함선 클릭, 또는 Tab)';
    if (sh.sunk) return '침몰한 함선입니다';
    var cd = X.cooldownLeft(st, sh);
    if (cd > 0) return '쿨타임 ' + (cd / 1000).toFixed(1) + '초 남음';
    if (st.ap[G.control] < COST[act]) return 'AP 부족 — ' + COST[act] + ' 필요, ' + st.ap[G.control] + ' 보유';
    if (act === 'move' && sh.identified) return '식별당한 함선은 이동할 수 없습니다 (영구)';
    return null;
  }

  /* ── 클릭 가능 칸 계산 ─────────────────────────────────── */
  function computeHL() {
    G.hl = null; G.rng = null;
    var st = G.st, s = G.sel, sh = selShip();
    if (st.phase !== 'BATTLE' || !sh || sh.sunk || !s.act) return;
    var set = new Set(), i;

    if (s.act === 'move') {
      if (sh.identified) return;
      G.moves = X.findMoves(st, sh);
      if (s.a == null) {
        G.moves.forEach(function (m) { set.add(m.cells[0]); set.add(m.cells[m.cells.length - 1]); });
      } else {
        G.moves.forEach(function (m) {
          var f = m.cells[0], l = m.cells[m.cells.length - 1];
          if (f === s.a) set.add(l); else if (l === s.a) set.add(f);
        });
      }
      G.hl = set;
    } else if (s.act === 'fire') {
      var r = X.fireRange(sh.len);
      for (i = 0; i < X.N; i++) if (X.shipDist(st, sh, i) <= r) set.add(i);
      G.rng = set;
    } else if (s.act === 'identify') {
      var kn = st.kn[G.control];
      for (i = 0; i < X.N; i++) if (X.shipDist(st, sh, i) <= B.identify.range && kn.onset[i]) set.add(i);
      G.rng = set;
      if (s.a != null) {
        var ends = new Set(), p0 = X.xy(s.a);
        [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
          for (var L = B.identify.minLen; L <= B.identify.maxLen; L++) {
            var ex = p0.x + d[0] * (L - 1), ey = p0.y + d[1] * (L - 1);
            if (!X.inB(ex, ey)) continue;
            var box = X.lineBox(s.a, X.idx(ex, ey));
            if (box.every(function (c) { return set.has(c); })) ends.add(X.idx(ex, ey));
          }
        });
        G.hl = ends;
      }
    }
  }

  /* ── 선택 ──────────────────────────────────────────────── */
  function pickShip(id, quiet) {
    var sh = G.st.ships[id];
    if (!sh || sh.owner !== G.control) return;
    G.sel.shipId = id; G.sel.a = G.sel.b = null; G.cand = ''; $('word').value = '';
    computeHL();
    if (!quiet) {
      var cd = X.cooldownLeft(G.st, sh);
      say('L' + sh.len + ' 「' + sh.name.join('') + '」 HP ' + sh.hp + '/' + sh.maxHp +
        (sh.identified ? ' · 식별당함(이동 불가)' : '') + (cd > 0 ? ' · 쿨 ' + (cd / 1000).toFixed(1) + 's' : '') +
        (G.sel.act ? ' — ' + ACTNAME[G.sel.act] + ' 대상을 고르세요' : ' — 행동을 고르세요 (1~4)'));
    }
  }
  function cycleShip() {
    var list = X.fleetOf(G.st, G.control).filter(function (s) { return !s.sunk; });
    if (!list.length) return;
    var at = list.findIndex(function (s) { return s.id === G.sel.shipId; });
    // 쿨타임이 끝난 다음 함선을 우선
    for (var k = 1; k <= list.length; k++) {
      var c = list[(at + k) % list.length];
      if (X.cooldownLeft(G.st, c) <= 0) return pickShip(c.id);
    }
    pickShip(list[(at + 1) % list.length].id);
  }

  function setAct(act) {
    var w = why(act);
    G.sel.act = act; G.sel.a = G.sel.b = null; G.cand = ''; $('word').value = '';
    computeHL();
    if (w) { say(ACTNAME[act] + ' — ' + w, true); return; }
    var tips = {
      move: '초록 칸 두 곳을 눌러 목적지를 정하세요 (박스 ' + selShip().len + '칸). 그다음 단어.',
      scan: '방향 버튼을 누르면 즉시 발사됩니다. 원점은 자동으로 잡습니다.',
      identify: '파란 범위 안에서 3~4칸 박스를 잡고, 적 함명을 추측해 입력하세요.',
      fire: '파란 범위 안 아무 칸이나 누르면 즉시 발사됩니다.'
    };
    say(ACTNAME[act] + ' (AP ' + COST[act] + ') — ' + tips[act]);
  }

  /* ── 보드 클릭 ─────────────────────────────────────────── */
  function onCell(i) {
    var st = G.st;
    if (st.phase === 'OVER') return;

    if (st.phase === 'SETUP') return onSetupCell(i);

    var p = G.control, s = G.sel;
    var occ = st.tiles[i].occupant;
    var mineHere = occ && st.ships[occ].owner === p;
    var boxing = (s.act === 'move' || s.act === 'identify');

    // 박스를 잡는 중이 아니면, 아군 함선 클릭 = 선택 변경
    if (mineHere && !boxing) { pickShip(occ); return paint(); }

    if (!s.act) { say('행동을 고르세요 (1 이동 / 2 탐지 / 3 식별 / 4 포격)', true); return paint(); }
    var w = why(s.act);
    if (w) { say(ACTNAME[s.act] + ' — ' + w, true); return paint(); }

    if (s.act === 'scan') { say('탐지는 방향 버튼을 누르세요. 보드 클릭은 필요 없습니다.', true); return paint(); }

    if (s.act === 'fire') {
      if (G.rng && !G.rng.has(i)) { say('사거리 밖입니다 (최대 ' + X.fireRange(selShip().len) + '칸)', true); return paint(); }
      return exec(X.fire(st, p, s.shipId, i));
    }

    // move / identify — 박스 양 끝을 찍는다
    if (s.a == null) {
      if (G.hl && !G.hl.has(i) && s.act === 'move') { say('그 칸에서 시작하는 합법 이동이 없습니다. 초록 칸을 고르세요.', true); return paint(); }
      if (G.rng && !G.rng.has(i) && s.act === 'identify') { say('식별 사거리(7칸) 밖이거나 초성 미판명 칸입니다.', true); return paint(); }
      s.a = i; computeHL();
      say('반대쪽 끝 칸을 고르세요.' + (G.hl && G.hl.size ? ' (초록 ' + G.hl.size + '곳)' : ' — 가능한 칸이 없으면 Esc'));
      return paint();
    }
    if (G.hl && !G.hl.has(i)) {
      if (i === s.a) { clearTarget(); say('시작 칸 취소.'); return paint(); }
      s.a = i; computeHL(); say('시작 칸을 다시 잡았습니다. 반대쪽 끝을 고르세요.');
      return paint();
    }
    s.b = i;
    var cells = X.lineBox(s.a, s.b);
    G.cand = X.nameFor(st, cells) || '';
    var onsets = cells.map(function (c) { return st.wreck[c] ? st.wreck[c] : st.tiles[c].onset; }).join('');
    $('word').value = '';
    $('word').placeholder = G.cand || '단어';
    $('word').focus();
    say('초성 ' + onsets + ' — 단어를 입력하고 Enter.' + (G.cand ? ' (빈칸으로 Enter 치면 「' + G.cand + '」)' : ''));
    paint();
  }

  function onSetupCell(i) {
    var st = G.st;
    if (!G.setupLen) { say('배치할 함선 길이를 먼저 고르세요.', true); return paint(); }
    if (G.sel.a == null) { G.sel.a = i; say('끝 칸을 클릭하세요 (길이 ' + G.setupLen + ').'); return paint(); }
    var cells = X.lineBox(G.sel.a, i);
    if (!cells || cells.length !== G.setupLen) {
      G.sel.a = i; say('직선 ' + G.setupLen + '칸이 아닙니다. 시작 칸을 다시 잡았습니다.', true); return paint();
    }
    G.sel.b = i;
    G.cand = X.nameFor(st, cells) || '';
    $('setupWord').value = ''; $('setupWord').placeholder = G.cand || '함명';
    $('setupWord').focus();
    say('초성 ' + cells.map(function (c) { return st.tiles[c].onset; }).join('') +
      ' — 함명을 입력하고 Enter.' + (G.cand ? ' (빈칸이면 「' + G.cand + '」)' : ''));
    paint();
  }

  function doExec() {
    var st = G.st, s = G.sel;
    var cells = boxCells();
    if (!cells || cells.length < 2) { say('보드에서 박스를 먼저 잡으세요.', true); return paint(); }
    var word = $('word').value.trim() || G.cand;
    if (!word) { say('단어를 입력하세요.', true); return paint(); }
    var r = s.act === 'move'
      ? X.move(st, G.control, s.shipId, cells, word)
      : X.identify(st, G.control, s.shipId, cells, word);
    exec(r);
  }

  function exec(res) {
    if (!res.ok) { say('거부 — ' + res.reason, true); paint(); return; }
    say(res.msg || '완료');
    G.sel.a = G.sel.b = null; G.cand = '';
    $('word').value = ''; $('word').placeholder = '단어';
    computeHL();
    paint();
  }

  function boxCells() {
    var s = G.sel;
    if (s.a == null) return null;
    if (s.b == null) return [s.a];
    return X.lineBox(s.a, s.b);
  }

  /** 탐지 원점 — 그 방향으로 가장 앞선 자기 타일 (사거리를 최대한 뽑는다) */
  function scanOrigin(sh, dirKey) {
    var d = X.DIRS[dirKey];
    return sh.tiles.reduce(function (best, t) {
      var a = X.xy(t), b = X.xy(best);
      return (a.x * d[0] + a.y * d[1]) > (b.x * d[0] + b.y * d[1]) ? t : best;
    }, sh.tiles[0]);
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
    var selSet = new Set(boxCells() || []);
    var pickSet = (sh && !sh.sunk && st.phase === 'BATTLE') ? new Set(sh.tiles) : null;
    var dep = X.deployRange(v), setup = st.phase === 'SETUP';

    for (var i = 0; i < X.N; i++) {
      var t = X.projectTile(st, v, i, omni), c = G.cells[i], cls = 'cell', txt = '';
      if (t.onsetKnown) cls += ' known';
      if (t.syl) { txt = t.syl; cls += ' syl'; } else if (t.onset) txt = t.onset;

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
      s.innerHTML = '<span class="over">★ ' + st.winner + ' 승리 — ' +
        (st.winReason === 'LANDING' ? '상륙' : '적 함대 전멸') + '</span><span>' +
        (st.t / 1000).toFixed(0) + '초</span><span>시드 ' + st.seed + '</span>';
      return;
    }
    if (st.phase === 'SETUP') {
      s.innerHTML = '<span>준비 페이즈</span><span>배치 중 <b>' + G.setupPlayer + '</b></span><span>' +
        X.fleetOf(st, G.setupPlayer).length + ' / ' + X.fleetSpec().length + '척</span>' +
        '<span>시드 ' + st.seed + '</span>';
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
      var hl = l.text.indexOf('★') >= 0 || l.text.indexOf('침몰') >= 0 || l.text.indexOf('⚠') >= 0;
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
    $('board').onclick = function (e) { var c = e.target.closest('.cell'); if (c) onCell(+c.dataset.i); };

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
        say('조작 대상 → ' + G.control);
        paint();
      };
    });
    $('bot1').onchange = function () { G.bot.P1 = this.checked; };
    $('bot2').onchange = function () { G.bot.P2 = this.checked; };

    // 준비 페이즈
    $('setupFleet').onclick = function (e) {
      var d = e.target.closest('[data-len]'); if (!d) return;
      G.setupLen = +d.dataset.len; G.sel.a = G.sel.b = null; G.cand = '';
      say('시작 칸을 클릭하세요 (길이 ' + G.setupLen + ', 파란 구역 안).');
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
      var name = $('setupWord').value.trim() || G.cand;
      var r = X.placeShip(G.st, G.setupPlayer, G.setupLen, cells, name);
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
      say('전투 시작. 함선을 고르고 행동을 누르세요 (1 이동 / 2 탐지 / 3 식별 / 4 포격, Tab 함선 전환).');
      paint();
    };

    // 전투
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
      var w = why('scan');
      if (w) { say('탐지 — ' + w, true); return paint(); }
      exec(X.scan(G.st, G.control, sh.id, scanOrigin(sh, d.dataset.dir), d.dataset.dir));
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
      if (e.key === ' ') { e.preventDefault(); $('btnPause').onclick(); }
      // 탐지 방향: WASD / QEZC
      var dirs = { w: 'N', s: 'S', a: 'Wd', d: 'E', q: 'NW', e: 'NE', z: 'SW', c: 'SE' };
      var dk = dirs[String(e.key).toLowerCase()];
      if (dk && G.sel.act === 'scan') {
        var sh = selShip();
        if (sh) { var wy = why('scan'); if (wy) say('탐지 — ' + wy, true); else exec(X.scan(G.st, G.control, sh.id, scanOrigin(sh, dk), dk)); }
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
