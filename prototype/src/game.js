/* WordShip prototype — 게임 엔진 (v0.4 실시간)
 * 보드 / 상태 / 지식 3종 / 행동 4종 / 승리 판정
 *
 * 핵심 원칙 (GDD §3)
 *   타일은 초성만 갖는다. 음절은 함선이 가져오거나(함명) 침몰이 각인한다(잔해).
 *   지식은 (타일 × 관찰자) 쌍마다 따로 존재한다.
 *
 * v0.4 — 턴제 폐지
 *   AP는 시간에 따라 차오른다(엘릭서 방식). 양측이 동시에 행동한다.
 *   "함선당 턴 1행동"은 함선별 쿨타임으로 대체된다.
 *   시간은 advance(st, dtMs)로만 흐른다 — 엔진 안에 실제 타이머는 없다.
 */
(function (WS) {
  'use strict';

  var B = WS.BALANCE;
  var H = WS.hangul;
  var W = B.board.w, HT = B.board.h, N = W * HT;

  var C_UNKNOWN = 0, C_CONTACT = 1, C_CLEAR = 2, C_GHOST = 3;

  var DIRS = {
    N:  [0, 1],  S:  [0, -1], E:  [1, 0],  Wd: [-1, 0],
    NE: [1, 1],  NW: [-1, 1], SE: [1, -1], SW: [-1, -1]
  };

  /* ── 좌표 ──────────────────────────────────────────────── */
  function idx(x, y) { return y * W + x; }
  function xy(i) { return { x: i % W, y: Math.floor(i / W) }; }
  function inB(x, y) { return x >= 0 && x < W && y >= 0 && y < HT; }
  function cheb(a, b) { var A = xy(a), C = xy(b); return Math.max(Math.abs(A.x - C.x), Math.abs(A.y - C.y)); }
  function other(p) { return p === 'P1' ? 'P2' : 'P1'; }

  function viewRow(player, y) { return player === 'P1' ? y + 1 : HT - y; }
  function landingY(player) { return player === 'P1' ? HT - 1 : 0; }
  function deployRange(player) {
    return player === 'P1' ? [0, B.board.deployRows - 1] : [HT - B.board.deployRows, HT - 1];
  }
  function label(player, i) {
    var p = xy(i);
    return String.fromCharCode(97 + p.x) + viewRow(player, p.y);
  }

  function neighbors1(i) {
    var p = xy(i), out = [];
    for (var dx = -1; dx <= 1; dx++) for (var dy = -1; dy <= 1; dy++) {
      if (!dx && !dy) continue;
      if (inB(p.x + dx, p.y + dy)) out.push(idx(p.x + dx, p.y + dy));
    }
    return out;
  }

  function lineBox(a, b) {
    var A = xy(a), C = xy(b);
    if (A.x !== C.x && A.y !== C.y) return null;
    var n = Math.max(Math.abs(C.x - A.x), Math.abs(C.y - A.y)) + 1;
    var dx = Math.sign(C.x - A.x), dy = Math.sign(C.y - A.y);
    var cells = [];
    for (var k = 0; k < n; k++) cells.push(idx(A.x + dx * k, A.y + dy * k));
    return cells;
  }
  function isLine(cells) {
    if (!cells || cells.length < 2) return false;
    var box = lineBox(cells[0], cells[cells.length - 1]);
    return !!box && box.length === cells.length && box.every(function (c, k) { return c === cells[k]; });
  }

  /* ── 보드 생성 (초성만) ─────────────────────────────────── */
  function genBoard(rand) {
    var minorKeys = Object.keys(B.MINOR_W);
    var minorTotal = minorKeys.reduce(function (s, k) { return s + B.MINOR_W[k]; }, 0);
    function pickMinor() {
      var r = rand() * minorTotal;
      for (var k = 0; k < minorKeys.length; k++) { r -= B.MINOR_W[minorKeys[k]]; if (r <= 0) return minorKeys[k]; }
      return minorKeys[0];
    }
    function pickMajor() { return B.MAJOR[Math.floor(rand() * B.MAJOR.length)]; }

    var tiles = new Array(N);
    for (var i = 0; i < N; i++) {
      var minor = rand() >= B.onset.majorRatio;
      tiles[i] = { onset: minor ? pickMinor() : pickMajor(), tier: minor ? 'MINOR' : 'MAJOR', occupant: null };
    }
    var y, x, run, t;
    for (y = 0; y < HT; y++) { run = 0; for (x = 0; x < W; x++) { t = tiles[idx(x, y)];
      if (t.tier === 'MINOR') { run++; if (run > B.gen.maxMinorRun) { t.tier = 'MAJOR'; t.onset = pickMajor(); run = 0; } } else run = 0; } }
    for (x = 0; x < W; x++) { run = 0; for (y = 0; y < HT; y++) { t = tiles[idx(x, y)];
      if (t.tier === 'MINOR') { run++; if (run > B.gen.maxMinorRun) { t.tier = 'MAJOR'; t.onset = pickMajor(); run = 0; } } else run = 0; } }
    return tiles;
  }

  function emptyKnowledge() {
    return {
      onset: new Uint8Array(N),
      contact: new Uint8Array(N),
      exposed: new Uint8Array(N),
      shipName: {}
    };
  }

  /* ── 게임 생성 ─────────────────────────────────────────── */
  function createGame(opts) {
    opts = opts || {};
    var seed = opts.seed == null ? String(Math.floor(Math.random() * 1e9)) : String(opts.seed);
    var rand = WS.rng.mulberry32(WS.rng.hashSeed(seed));
    var st = {
      seed: seed, rand: rand,
      W: W, H: HT, N: N,
      dict: opts.dict || WS.dict.permissive,
      tiles: opts.onsets
        ? opts.onsets.map(function (o) { return { onset: o, tier: B.MAJOR.indexOf(o) >= 0 ? 'MAJOR' : 'MINOR', occupant: null }; })
        : genBoard(rand),
      wreck: new Array(N).fill(null),
      ships: {}, shipOrder: [],
      kn: { P1: emptyKnowledge(), P2: emptyKnowledge() },
      phase: 'SETUP',
      t: 0,                                          // 경과 시간 (ms)
      ap: { P1: B.ap.start, P2: B.ap.start },
      apAccum: { P1: 0, P2: 0 },
      winner: null, winReason: null,
      log: []
    };
    ['P1', 'P2'].forEach(function (p) {
      var r = deployRange(p);
      for (var y = r[0]; y <= r[1]; y++) for (var x = 0; x < W; x++) st.kn[p].onset[idx(x, y)] = 1;
    });
    return st;
  }

  /** 로그. forPlayer가 있으면 그 플레이어만 볼 수 있는 정보다. */
  function logm(st, text, forPlayer) {
    st.log.push({ t: st.t, text: text, forPlayer: forPlayer || null });
    return text;
  }

  /* ── 시간 진행 (엔진의 유일한 시계) ─────────────────────── */
  function advance(st, dtMs) {
    if (st.phase !== 'BATTLE' || dtMs <= 0) return;
    st.t += dtMs;
    ['P1', 'P2'].forEach(function (p) {
      if (st.ap[p] >= B.ap.max) { st.apAccum[p] = 0; return; }
      st.apAccum[p] += dtMs;
      while (st.apAccum[p] >= B.ap.regenMs && st.ap[p] < B.ap.max) {
        st.apAccum[p] -= B.ap.regenMs;
        st.ap[p]++;
      }
      if (st.ap[p] >= B.ap.max) st.apAccum[p] = 0;
    });
  }
  function cooldownLeft(st, sh) { return Math.max(0, (sh.cdUntil || 0) - st.t); }

  /* ── 관측 ──────────────────────────────────────────────── */
  function observe(st, player, i) {
    var k = st.kn[player];
    k.onset[i] = 1;
    var occ = st.tiles[i].occupant;
    if (occ) {
      var sh = st.ships[occ];
      if (sh.owner !== player) {
        k.contact[i] = C_CONTACT;
        st.kn[other(player)].exposed[i] = 1;
      }
    } else {
      k.contact[i] = (k.contact[i] === C_CONTACT) ? C_GHOST : C_CLEAR;
    }
  }

  function effSyllable(st, i) {
    if (st.wreck[i]) return st.wreck[i];
    var occ = st.tiles[i].occupant;
    if (!occ) return null;
    var sh = st.ships[occ];
    return sh.name[sh.tiles.indexOf(i)];
  }
  function knownSyllableAt(st, player, i) {
    if (st.wreck[i]) return st.wreck[i];
    var occ = st.tiles[i].occupant;
    if (!occ) return null;
    var sh = st.ships[occ];
    if (sh.owner === player) return sh.name[sh.tiles.indexOf(i)];
    var kn = st.kn[player].shipName[occ];
    return kn ? kn[sh.tiles.indexOf(i)] : null;
  }

  function shipDist(st, sh, i) {
    return sh.tiles.reduce(function (m, t) { return Math.min(m, cheb(t, i)); }, 99);
  }
  function specOf(len) { return B.ships.filter(function (x) { return x.len === len; })[0]; }
  function fireRange(len) { var s = specOf(len); return s ? s.fireRange : 0; }
  function moveCooldown(len) { return B.cooldown.movePerLen * len; }

  /* ── 배치 ──────────────────────────────────────────────── */
  function fleetSpec() {
    var out = [];
    B.ships.forEach(function (s) { for (var i = 0; i < s.count; i++) out.push({ len: s.len, hp: s.hp }); });
    return out;
  }

  function validateWord(st, player, cells, word) {
    var chars = Array.from(word || '');
    if (chars.length !== cells.length) return '단어 길이가 박스 길이(' + cells.length + ')와 다름';
    for (var i = 0; i < chars.length; i++) {
      if (!H.isSyllable(chars[i])) return '완성형 한글만 입력 가능: ' + chars[i];
      var wr = st.wreck[cells[i]];
      if (wr) {
        if (chars[i] !== wr) return (i + 1) + '번째 칸은 잔해 — 정확히 「' + wr + '」여야 함 (초성만으로는 불가)';
      } else if (H.onsetOf(chars[i]) !== st.tiles[cells[i]].onset) {
        return (i + 1) + '번째 글자 초성 불일치 — 「' + st.tiles[cells[i]].onset + '」 필요, 「' + H.onsetOf(chars[i]) + '」 입력됨';
      }
    }
    if (!st.dict.has(word)) return '사전에 없는 단어: ' + word;
    return null;
  }

  var COMMON_JUNG = [0, 1, 4, 5, 8, 13, 18, 20];   // ㅏ ㅐ ㅓ ㅔ ㅗ ㅜ ㅡ ㅣ

  function nameFor(st, cells) {
    var pattern = cells.map(function (c) { return st.wreck[c] || st.tiles[c].onset; });
    var needExact = cells.map(function (c) { return !!st.wreck[c]; });
    if (st.dict.words) {
      var cands = st.dict.words.filter(function (w) {
        var ch = Array.from(w);
        if (ch.length !== cells.length) return false;
        return ch.every(function (c, k) { return needExact[k] ? c === pattern[k] : H.onsetOf(c) === pattern[k]; });
      });
      return cands.length ? cands[Math.floor(st.rand() * cands.length)] : null;
    }
    // 허용 사전에서 합성할 때는 흔한 모음만 쓴다.
    // 21개 전부 쓰면 「쎠쵀즤바」 같은 글자가 나와 게임이 고장난 것처럼 보인다.
    return cells.map(function (c, k) {
      return needExact[k] ? pattern[k] : H.compose(pattern[k], COMMON_JUNG[Math.floor(st.rand() * COMMON_JUNG.length)], 0);
    }).join('');
  }

  function placeShip(st, player, len, cells, name) {
    if (st.phase !== 'SETUP') return { ok: false, reason: '준비 페이즈가 아님' };
    if (!specOf(len)) return { ok: false, reason: '없는 함선 길이: ' + len };
    if (!cells || cells.length !== len) return { ok: false, reason: '칸 수가 함선 길이와 다름' };
    if (!isLine(cells)) return { ok: false, reason: '직선 연속 배치가 아님' };
    var r = deployRange(player);
    for (var i = 0; i < cells.length; i++) {
      var p = xy(cells[i]);
      if (p.y < r[0] || p.y > r[1]) return { ok: false, reason: '자기 배치 구역(1~10행) 밖' };
      if (st.tiles[cells[i]].occupant) return { ok: false, reason: '다른 함선과 겹침' };
    }
    var werr = validateWord(st, player, cells, name);
    if (werr) return { ok: false, reason: '함명 오류 — ' + werr };

    var id = player + '-' + (st.shipOrder.length + 1) + '-L' + len;
    var spec = specOf(len);
    var sh = {
      id: id, owner: player, len: len, hp: spec.hp, maxHp: spec.hp,
      tiles: cells.slice(), name: Array.from(name),
      identified: false, sunk: false, cdUntil: 0
    };
    st.ships[id] = sh; st.shipOrder.push(id);
    cells.forEach(function (c) { st.tiles[c].occupant = id; });
    return { ok: true, ship: sh };
  }

  function fleetOf(st, player) {
    return st.shipOrder.map(function (i) { return st.ships[i]; }).filter(function (s) { return s.owner === player; });
  }

  function autoPlace(st, player) {
    var specs = fleetSpec(), placed = 0;
    for (var s = 0; s < specs.length; s++) {
      var ok = false;
      for (var attempt = 0; attempt < 4000 && !ok; attempt++) {
        var r = deployRange(player);
        var horiz = st.rand() < 0.5;
        var len = specs[s].len;
        var x0 = Math.floor(st.rand() * (horiz ? W - len + 1 : W));
        var y0 = r[0] + Math.floor(st.rand() * ((r[1] - r[0] + 1) - (horiz ? 0 : len - 1)));
        var cells = [];
        for (var k = 0; k < len; k++) cells.push(idx(horiz ? x0 + k : x0, horiz ? y0 : y0 + k));
        if (cells.some(function (c) { return st.tiles[c].occupant; })) continue;
        var nm = nameFor(st, cells);
        if (!nm) continue;
        if (placeShip(st, player, len, cells, nm).ok) { ok = true; placed++; }
      }
      if (!ok) return { ok: false, reason: '자동 배치 실패 (길이 ' + specs[s].len + ') — 사전에 맞는 단어를 못 찾음', placed: placed };
    }
    return { ok: true, placed: placed };
  }

  function setupComplete(st) {
    var n = fleetSpec().length;
    return fleetOf(st, 'P1').length === n && fleetOf(st, 'P2').length === n;
  }
  function startBattle(st) {
    if (!setupComplete(st)) return { ok: false, reason: '양측 ' + fleetSpec().length + '척 배치가 끝나지 않음' };
    st.phase = 'BATTLE';
    st.t = 0;
    st.ap = { P1: B.ap.start, P2: B.ap.start };
    st.apAccum = { P1: 0, P2: 0 };
    st.shipOrder.forEach(function (id) { st.ships[id].cdUntil = 0; });
    logm(st, '전투 시작 — 실시간. AP는 ' + (B.ap.regenMs / 1000) + '초마다 1씩, 최대 ' + B.ap.max);
    return { ok: true };
  }

  /* ── 행동 공통 ─────────────────────────────────────────── */
  function canAct(st, player, shipId, cost) {
    if (st.phase !== 'BATTLE') return '전투 중이 아님';
    if (st.ap[player] < cost) return 'AP 부족 (' + st.ap[player] + ' 보유 / ' + cost + ' 필요)';
    if (shipId) {
      var sh = st.ships[shipId];
      if (!sh) return '함선을 찾을 수 없음';
      if (sh.owner !== player) return '자기 함선이 아님';
      if (sh.sunk) return '침몰한 함선';
      var cd = cooldownLeft(st, sh);
      if (cd > 0) return '쿨타임 ' + (cd / 1000).toFixed(1) + '초 남음';
    }
    return null;
  }
  function spend(st, player, sh, cost, cdMs) {
    st.ap[player] -= cost;
    if (sh) sh.cdUntil = st.t + cdMs;
  }
  function fail(r) { return { ok: false, reason: r }; }
  function secs(st) { return (st.t / 1000).toFixed(1) + 's'; }

  function endGame(st, winner, reason) {
    st.phase = 'OVER'; st.winner = winner; st.winReason = reason;
    logm(st, '★ ' + winner + ' 승리 — ' + (reason === 'LANDING' ? '상륙' : reason === 'ANNIHILATION' ? '적 함대 전멸' : reason));
  }

  function checkLanding(st, player, sh) {
    var ty = landingY(player);
    var on = sh.tiles.filter(function (t) { return xy(t).y === ty; });
    if (!on.length) return false;
    if (B.win.landingNeedsFullShip && on.length !== sh.len) return false;
    endGame(st, player, 'LANDING');
    return true;
  }

  function sink(st, sh) {
    sh.sunk = true; sh.hp = 0;
    for (var i = 0; i < sh.tiles.length; i++) {
      var t = sh.tiles[i];
      st.wreck[t] = sh.name[i];
      st.tiles[t].occupant = null;
      ['P1', 'P2'].forEach(function (p) {
        st.kn[p].onset[t] = 1;
        st.kn[p].contact[t] = C_UNKNOWN;
        st.kn[p].exposed[t] = 0;
      });
    }
    ['P1', 'P2'].forEach(function (p) { delete st.kn[p].shipName[sh.id]; });
    logm(st, '침몰: ' + sh.id + ' 「' + sh.name.join('') + '」 → 각인');   // 공개
    if (!fleetOf(st, sh.owner).some(function (s) { return !s.sunk; })) endGame(st, other(sh.owner), 'ANNIHILATION');
  }

  /* ── 이동 (§9.1) ───────────────────────────────────────── */
  function actionMove(st, player, shipId, cells, word) {
    var err = canAct(st, player, shipId, B.cost.move); if (err) return fail(err);
    var sh = st.ships[shipId];
    if (sh.identified) return fail('식별당함 — 이동 불가 (해제 수단 없음)');
    if (!cells || cells.length !== sh.len) return fail('단어 박스 길이가 함선 길이(' + sh.len + ')와 달라야 함');
    if (!isLine(cells)) return fail('직선 연속 박스가 아님');

    if (B.move.banSameCells && cells.length === sh.tiles.length &&
        cells.every(function (c) { return sh.tiles.indexOf(c) >= 0; }))
      return fail('자기 자리로는 이동할 수 없음');

    var k = st.kn[player], i;
    for (i = 0; i < cells.length; i++) if (!k.onset[cells[i]]) return fail('초성 미판명 칸 포함: ' + label(player, cells[i]));
    if (!cells.some(function (c) { return shipDist(st, sh, c) <= 1; })) return fail('현재 위치로부터 1칸 이내의 칸을 포함해야 함');

    var werr = validateWord(st, player, cells, word); if (werr) return fail(werr);

    for (i = 0; i < cells.length; i++) {
      var o = st.tiles[cells[i]].occupant;
      if (o && o !== shipId && st.ships[o].owner === player) return fail('아군 함선과 겹침');
    }
    var hit = cells.filter(function (c) { var o = st.tiles[c].occupant; return o && st.ships[o].owner !== player; });

    spend(st, player, sh, B.cost.move, moveCooldown(sh.len));

    if (hit.length) {
      hit.forEach(function (c) { k.contact[c] = C_CONTACT; st.kn[other(player)].exposed[c] = 1; });
      return { ok: true, collided: true, msg: logm(st, '충돌 — 이동 실패. 적함 발견: ' + hit.map(function (c) { return label(player, c); }).join(', '), player) };
    }

    sh.tiles.forEach(function (t) { st.tiles[t].occupant = null; });
    sh.tiles = cells.slice();
    sh.name = Array.from(word);
    sh.tiles.forEach(function (t) { st.tiles[t].occupant = shipId; });
    delete st.kn[other(player)].shipName[shipId];   // 함명 교체 → 상대가 해독한 음절 전부 소멸

    var seen = new Set();
    sh.tiles.forEach(function (t) { seen.add(t); neighbors1(t).forEach(function (n) { seen.add(n); }); });
    seen.forEach(function (s) { observe(st, player, s); });

    var msg = logm(st, '이동: ' + shipId + ' → 「' + word + '」 ' + label(player, cells[0]) + '-' + label(player, cells[cells.length - 1]) +
      ' (' + seen.size + '칸 판명, 쿨 ' + (moveCooldown(sh.len) / 1000) + 's)', player);
    var landed = checkLanding(st, player, sh);
    return { ok: true, msg: msg, landed: landed, revealed: seen.size };
  }

  /* ── 탐지 (§9.2) ───────────────────────────────────────── */
  function actionScan(st, player, shipId, fromIdx, dirKey) {
    var err = canAct(st, player, shipId, B.cost.scan); if (err) return fail(err);
    var sh = st.ships[shipId];
    if (sh.tiles.indexOf(fromIdx) < 0) return fail('자기 함선이 점유한 타일을 골라야 함');
    var d = DIRS[dirKey]; if (!d) return fail('방향 오류');

    spend(st, player, sh, B.cost.scan, B.cooldown.scan);
    var p = xy(fromIdx), n = 0;
    for (var s = 1; s <= B.scan.length; s++) {
      var nx = p.x + d[0] * s, ny = p.y + d[1] * s;
      if (!inB(nx, ny)) break;
      observe(st, player, idx(nx, ny)); n++;
    }
    return { ok: true, revealed: n, msg: logm(st, '탐지: ' + label(player, fromIdx) + ' ' + dirKey + ' ' + n + '칸 판명', player) };
  }

  /* ── 식별 (§9.3) ───────────────────────────────────────── */
  function actionIdentify(st, player, shipId, cells, word) {
    var err = canAct(st, player, shipId, B.cost.identify); if (err) return fail(err);
    var sh = st.ships[shipId];
    if (!cells || cells.length < B.identify.minLen || cells.length > B.identify.maxLen)
      return fail('식별 박스는 ' + B.identify.minLen + '~' + B.identify.maxLen + '칸');
    if (!isLine(cells)) return fail('직선 연속 박스가 아님');

    var k = st.kn[player], i;
    for (i = 0; i < cells.length; i++) {
      if (!k.onset[cells[i]]) return fail('초성 미판명 칸 포함: ' + label(player, cells[i]));
      if (shipDist(st, sh, cells[i]) > B.identify.range) return fail('사거리 초과 — ' + label(player, cells[i]) + ' (최대 ' + B.identify.range + '칸)');
    }
    var werr = validateWord(st, player, cells, word); if (werr) return fail(werr);

    spend(st, player, sh, B.cost.identify, B.cooldown.identify);
    var chars = Array.from(word);
    var hitShips = new Set(), learned = [], decoded = [];

    for (i = 0; i < cells.length; i++) {
      var c = cells[i], occ = st.tiles[c].occupant;
      if (occ && st.ships[occ].owner !== player) {
        hitShips.add(occ);
        k.contact[c] = C_CONTACT;
        st.kn[other(player)].exposed[c] = 1;
        if (chars[i] === effSyllable(st, c)) {
          learnSyllable(st, player, occ, c, chars[i]);
          learned.push(label(player, c) + '=' + chars[i]);
        }
      } else if (!occ) {
        k.contact[c] = (k.contact[c] === C_CONTACT) ? C_GHOST : C_CLEAR;
      }
    }
    hitShips.forEach(function (id) {
      var tgt = st.ships[id];
      var wasNew = !tgt.identified;
      tgt.identified = true;
      if (fullyDecoded(st, player, id)) {
        tgt.tiles.forEach(function (t) { k.contact[t] = C_CONTACT; st.kn[other(player)].exposed[t] = 1; });
        decoded.push(id);
      }
      if (wasNew) logm(st, '⚠ 아군 ' + id + ' 식별당함 — 이동 불가, 피해 3배', tgt.owner);
    });

    var msg = logm(st, '식별: 「' + word + '」 ' + label(player, cells[0]) + '-' + label(player, cells[cells.length - 1]) +
      ' → ' + (hitShips.size ? hitShips.size + '척 식별' : '적함 없음') +
      (learned.length ? ' / 해독 ' + learned.join(',') : '') +
      (decoded.length ? ' / 완전해독 ' + decoded.join(',') : ''), player);
    return { ok: true, msg: msg, hits: hitShips.size, learned: learned.length, decoded: decoded.length };
  }

  function learnSyllable(st, player, shipId, cellIdx, syl) {
    var sh = st.ships[shipId], k = st.kn[player];
    if (!k.shipName[shipId]) k.shipName[shipId] = new Array(sh.len).fill(null);
    var pos = sh.tiles.indexOf(cellIdx);
    if (pos >= 0) k.shipName[shipId][pos] = syl;
  }
  function fullyDecoded(st, player, shipId) {
    var kn = st.kn[player].shipName[shipId];
    return !!kn && kn.every(function (x) { return x !== null; });
  }

  /* ── 포격 (§9.4) ───────────────────────────────────────── */
  function actionFire(st, player, shipId, target) {
    var err = canAct(st, player, shipId, B.cost.fire); if (err) return fail(err);
    var sh = st.ships[shipId];
    var rng = fireRange(sh.len);
    if (shipDist(st, sh, target) > rng) return fail('사거리 초과 (길이 ' + sh.len + ' → ' + rng + '칸)');
    var occ = st.tiles[target].occupant;
    if (occ && st.ships[occ].owner === player) return fail('아군 함선은 조준 불가');

    spend(st, player, sh, B.cost.fire, B.cooldown.fire);
    var k = st.kn[player];
    var dmg = B.damage.base;
    var known = knownSyllableAt(st, player, target);
    if (known) dmg += B.damage.precisionBonus;

    var msg, visible = false;
    if (occ) {
      var tgt = st.ships[occ];
      if (tgt.identified) dmg *= B.damage.identifiedMult;
      tgt.hp -= dmg;
      k.contact[target] = C_CONTACT;
      st.kn[other(player)].exposed[target] = 1;

      // 피해·체력은 식별당한 함선만 사수에게 보인다 (§9.4)
      visible = tgt.identified || !B.reveal.enemyHpOnlyWhenIdentified;
      msg = visible
        ? '포격 ' + label(player, target) + ' 명중 — ' + dmg + '피해' + (known ? ' (정밀)' : '') +
          (tgt.identified ? ' (식별 3배)' : '') + ' → ' + tgt.id + ' HP ' + Math.max(0, tgt.hp) + '/' + tgt.maxHp
        : '포격 ' + label(player, target) + ' 명중 — 피해량 불명 (식별해야 보임)';
      logm(st, msg, player);
      logm(st, '피격: 아군 ' + tgt.id + ' −' + dmg + ' → HP ' + Math.max(0, tgt.hp) + '/' + tgt.maxHp, tgt.owner);
      if (tgt.hp <= 0) sink(st, tgt);
    } else {
      k.contact[target] = (k.contact[target] === C_CONTACT) ? C_GHOST : C_CLEAR;
      msg = logm(st, '포격 ' + label(player, target) + ' 빗나감', player);
    }
    var rc = recoil(st, player, sh);
    if (rc != null) {
      logm(st, '  └ 반동: 내 위치 ' + label(player, rc) + ' 노출됨', player);
      logm(st, '적 포격 관측 — ' + label(other(player), rc) + ' 에서 발사됨', other(player));
    }
    return { ok: true, msg: msg, dmg: occ ? dmg : 0, dmgVisible: visible, hit: !!occ, recoil: rc };
  }

  function recoil(st, player, sh) {
    var opp = other(player);
    var cand = sh.tiles.filter(function (t) { return st.kn[opp].contact[t] !== C_CONTACT; });
    if (!cand.length) return null;
    var pick = cand[Math.floor(st.rand() * cand.length)];
    st.kn[opp].contact[pick] = C_CONTACT;
    st.kn[player].exposed[pick] = 1;
    return pick;
  }

  /* ── 합법 이동 탐색 ────────────────────────────────────── */
  function findMoves(st, sh) {
    var k = st.kn[sh.owner], out = [], seen = new Set();
    var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    var anchors = new Set();
    sh.tiles.forEach(function (t) { anchors.add(t); neighbors1(t).forEach(function (n) { anchors.add(n); }); });
    anchors.forEach(function (a) {
      var p = xy(a);
      dirs.forEach(function (d, di) {
        for (var off = 0; off < sh.len; off++) {
          var sx = p.x - d[0] * off, sy = p.y - d[1] * off;
          var ex = sx + d[0] * (sh.len - 1), ey = sy + d[1] * (sh.len - 1);
          if (!inB(sx, sy) || !inB(ex, ey)) continue;
          var key = sx + ',' + sy + ',' + di;
          if (seen.has(key)) continue; seen.add(key);
          var cells = [];
          for (var q = 0; q < sh.len; q++) cells.push(idx(sx + d[0] * q, sy + d[1] * q));
          if (cells.every(function (c) { return sh.tiles.indexOf(c) >= 0; })) continue;   // 자기 자리
          if (!cells.every(function (c) { return k.onset[c]; })) continue;
          if (!cells.some(function (c) { return shipDist(st, sh, c) <= 1; })) continue;
          if (cells.some(function (c) { var o = st.tiles[c].occupant; return o && o !== sh.id; })) continue;
          var nm = nameFor(st, cells);
          if (!nm) continue;
          out.push({ cells: cells, word: nm });
        }
      });
    });
    return out;
  }
  function hasLegalMove(st, shipId) {
    var sh = st.ships[shipId];
    if (sh.sunk || sh.identified) return false;
    return findMoves(st, sh).length > 0;
  }

  /* ── 뷰 투영 ───────────────────────────────────────────── */
  function projectTile(st, viewer, i, omniscient) {
    var k = st.kn[viewer], t = st.tiles[i];
    var occ = t.occupant, sh = occ ? st.ships[occ] : null;
    var mine = sh && sh.owner === viewer;
    var syl = null;
    if (st.wreck[i]) syl = st.wreck[i];
    else if (mine || (omniscient && sh)) syl = sh.name[sh.tiles.indexOf(i)];
    else if (sh) { var kn = k.shipName[occ]; if (kn) syl = kn[sh.tiles.indexOf(i)]; }

    // 적 체력은 식별당한 함선만 보인다
    var seenEnemy = sh && !mine && (omniscient || k.contact[i] === C_CONTACT);
    var enemyState = null;
    if (seenEnemy && (sh.identified || omniscient || !B.reveal.enemyHpOnlyWhenIdentified))
      enemyState = { hp: sh.hp, maxHp: sh.maxHp, len: sh.len, identified: sh.identified };

    return {
      idx: i,
      onsetKnown: omniscient ? true : !!k.onset[i],
      onset: (omniscient || k.onset[i]) ? t.onset : null,
      tier: t.tier,
      syl: syl,
      wreck: !!st.wreck[i],
      contact: omniscient ? (sh && !mine ? C_CONTACT : k.contact[i]) : k.contact[i],
      exposed: !!k.exposed[i],
      mine: mine ? { id: sh.id, len: sh.len, hp: sh.hp, maxHp: sh.maxHp, identified: sh.identified,
                     cd: cooldownLeft(st, sh) } : null,
      enemy: (omniscient && sh && !mine) ? { id: sh.id, len: sh.len, hp: sh.hp, identified: sh.identified } : null,
      enemyState: enemyState,
      enemyIdentified: !!(seenEnemy && sh.identified)
    };
  }

  WS.game = {
    C: { UNKNOWN: C_UNKNOWN, CONTACT: C_CONTACT, CLEAR: C_CLEAR, GHOST: C_GHOST },
    DIRS: DIRS, W: W, H: HT, N: N,
    idx: idx, xy: xy, inB: inB, cheb: cheb, other: other,
    viewRow: viewRow, landingY: landingY, deployRange: deployRange, label: label,
    lineBox: lineBox, isLine: isLine, neighbors1: neighbors1,
    createGame: createGame, placeShip: placeShip, autoPlace: autoPlace,
    fleetSpec: fleetSpec, fleetOf: fleetOf, setupComplete: setupComplete, startBattle: startBattle,
    advance: advance, cooldownLeft: cooldownLeft, secs: secs,
    move: actionMove, scan: actionScan, identify: actionIdentify, fire: actionFire,
    endGame: endGame, hasLegalMove: hasLegalMove, findMoves: findMoves,
    observe: observe, effSyllable: effSyllable, knownSyllableAt: knownSyllableAt,
    shipDist: shipDist, fireRange: fireRange, moveCooldown: moveCooldown, specOf: specOf,
    validateWord: validateWord, nameFor: nameFor,
    projectTile: projectTile, sink: sink, fullyDecoded: fullyDecoded
  };

})(window.WS = window.WS || {});
