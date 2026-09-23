/**
 * BoardRenderer.js — 8×8 해역 그리기 + 드래그로 박스 고르기.
 *
 * 구조
 *   .ws-board            8×8 CSS grid. 칸 하나 = 정확히 1/8 폭이라 칸 중심 = (c + 0.5) / 8
 *     .ws-cell × 64      칸 안의 둥근 타일(.ws-tile)이 초성·음절을 보여 준다
 *     svg.ws-overlay     그 위에 겹친 SVG(viewBox 0 0 8 8). 함선 외곽선·선택 박스를 '캡슐'로 그린다 —
 *                        대각선 함선도 칸 테두리가 아니라 비스듬한 캡슐 하나로 감쌀 수 있다
 *
 * 입력 — 칸에서 누른 채 끌면 8방향 중 가장 가까운 쪽으로 스냅한 2~4칸 박스가 된다.
 * 드래그 없이 두 칸을 차례로 눌러도 된다(첫 칸 = 기준점, 둘째 칸 = 끝점).
 */
import { SIZE, CELL_COUNT, boxCells, boxFromEndpoints, idxOf, rowOf, colOf, MAX_BOX } from '../game/board.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const STEP_ANGLES = [
  { dr: 0, dc: 1 }, { dr: 1, dc: 1 }, { dr: 1, dc: 0 }, { dr: 1, dc: -1 },
  { dr: 0, dc: -1 }, { dr: -1, dc: -1 }, { dr: -1, dc: 0 }, { dr: -1, dc: 1 },
];

/** 볼록 껍질 (monotone chain) — 일직선 위의 점은 뺀다 */
function convexHull(points) {
  const pts = [...new Map(points.map((p) => [`${p[0]},${p[1]}`, p])).values()]
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list) => {
    const out = [];
    for (const p of list) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(pts), ...half([...pts].reverse())];
}

export class BoardRenderer {
  /**
   * @param {HTMLElement} root  .ws-board
   * @param {{ onSelect: (box: object|null) => void }} handlers
   */
  constructor(root, { onSelect }) {
    this.root = root;
    this.onSelect = onSelect;
    this.interactive = true;
    this.anchor = null;       // 탭 두 번 방식의 첫 칸
    this.drag = null;         // { start, moved }
    this.selection = null;    // 현재 박스

    this.cells = [];
    for (let idx = 0; idx < CELL_COUNT; idx++) {
      const cell = document.createElement('div');
      cell.className = 'ws-cell';
      cell.dataset.idx = String(idx);
      const tile = document.createElement('div');
      tile.className = 'ws-tile';
      const main = document.createElement('span');
      main.className = 'ws-tile-main';
      const order = document.createElement('span');
      order.className = 'ws-tile-order';
      tile.append(main, order);
      cell.appendChild(tile);
      root.appendChild(cell);
      this.cells.push({ cell, tile, main, order });
    }

    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.svg.setAttribute('class', 'ws-overlay');
    this.svg.setAttribute('viewBox', `0 0 ${SIZE} ${SIZE}`);
    this.svg.setAttribute('aria-hidden', 'true');
    this.shipLayer = document.createElementNS(SVG_NS, 'g');
    this.flashLayer = document.createElementNS(SVG_NS, 'g');
    this.selLayer = document.createElementNS(SVG_NS, 'g');
    this.svg.append(this.shipLayer, this.flashLayer, this.selLayer);
    root.appendChild(this.svg);

    root.addEventListener('pointerdown', (e) => this.#onDown(e));
    root.addEventListener('pointermove', (e) => this.#onMove(e));
    root.addEventListener('pointerup', (e) => this.#onUp(e));
    root.addEventListener('pointercancel', () => { this.drag = null; });
  }

  /**
   * @param {{ onsets: string[], revealed: (string|null)[], hit: boolean[], miss: boolean[],
   *   doneCells: Set<number>, doneShips: object[], answerShips?: object[], interactive: boolean }} view
   */
  render(view) {
    this.interactive = view.interactive;
    this.root.classList.toggle('is-locked', !view.interactive);
    const answerAt = new Map();
    for (const ship of view.answerShips ?? []) boxCells(ship).forEach((idx, i) => answerAt.set(idx, ship.name[i]));

    this.cells.forEach(({ tile, main }, idx) => {
      const syl = view.revealed[idx];
      const done = view.doneCells.has(idx);
      const answer = !syl && answerAt.get(idx);
      tile.className = 'ws-tile';
      if (done) tile.classList.add('is-done');
      else if (syl) tile.classList.add('is-reveal');
      else if (answer) tile.classList.add('is-answer');
      else if (view.hit[idx]) tile.classList.add('is-hit');
      else if (view.miss[idx]) tile.classList.add('is-miss');
      main.textContent = syl || answer || view.onsets[idx];
      tile.classList.toggle('is-syllable', !!(syl || answer));
    });

    this.shipLayer.replaceChildren(
      ...view.doneShips.map((s) => this.#capsule(s, 'ws-cap-done')),
      ...(view.answerShips ?? []).map((s) => this.#capsule(s, 'ws-cap-answer')),
    );
    if (!view.interactive) this.setSelection(null, { silent: true });
  }

  /** 선택 박스 표시 (null이면 해제) */
  setSelection(box, { silent = false } = {}) {
    this.selection = box;
    this.anchor = null;
    this.#paintSelection(box);
    if (!silent) this.onSelect(box);
  }

  /** 기록 목록에서 누른 추측 박스를 잠깐 깜빡여 보여 준다 */
  flash(box) {
    const cap = this.#band(box, 'ws-band-flash');
    this.flashLayer.replaceChildren(cap);
    clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => cap.remove(), 1600);
  }

  // ── 내부 ──

  #paintSelection(box, { preview = false } = {}) {
    this.cells.forEach(({ tile, order }) => { tile.classList.remove('is-selected', 'is-anchor'); order.textContent = ''; });
    this.selLayer.replaceChildren();
    if (this.anchor !== null && !box) this.cells[this.anchor].tile.classList.add('is-anchor');
    if (!box) return;
    boxCells(box).forEach((idx, i) => {
      this.cells[idx].tile.classList.add('is-selected');
      this.cells[idx].order.textContent = String(i + 1);
    });
    this.selLayer.appendChild(this.#band(box, preview ? 'ws-band-select is-preview' : 'ws-band-select'));
  }

  /**
   * 박스의 칸(정사각형)들을 끈으로 두른 모양 — 칸 네 모서리 전부의 볼록 껍질.
   * 가로·세로는 직사각형, 대각선은 계단 모서리를 잇는 육각형이 된다.
   */
  #band(box, cls) {
    const pts = [];
    for (const idx of boxCells(box)) {
      const x = colOf(idx);
      const y = rowOf(idx);
      pts.push([x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]);
    }
    const poly = document.createElementNS(SVG_NS, 'polygon');
    poly.setAttribute('points', convexHull(pts).map(([x, y]) => `${x},${y}`).join(' '));
    poly.setAttribute('class', `ws-band ${cls}`);
    return poly;
  }

  /** 박스를 감싸는 캡슐(둥근 사각형, 박스 방향으로 회전) */
  #capsule(box, cls) {
    const cells = boxCells(box);
    const a = cells[0];
    const b = cells[cells.length - 1];
    const x1 = colOf(a) + 0.5, y1 = rowOf(a) + 0.5;
    const x2 = colOf(b) + 0.5, y2 = rowOf(b) + 0.5;
    const len = Math.hypot(x2 - x1, y2 - y1);
    const angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
    const thick = 0.9;
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x', String(-thick / 2));
    rect.setAttribute('y', String(-thick / 2));
    rect.setAttribute('width', String(len + thick));
    rect.setAttribute('height', String(thick));
    rect.setAttribute('rx', String(thick / 2));
    rect.setAttribute('transform', `translate(${x1} ${y1}) rotate(${angle})`);
    rect.setAttribute('class', `ws-cap ${cls}`);
    return rect;
  }

  #cellAt(e) {
    const rect = this.root.getBoundingClientRect();
    const c = Math.floor(((e.clientX - rect.left) / rect.width) * SIZE);
    const r = Math.floor(((e.clientY - rect.top) / rect.height) * SIZE);
    if (r < 0 || r >= SIZE || c < 0 || c >= SIZE) return null;
    return idxOf(r, c);
  }

  /** 시작 칸 기준, 포인터 방향을 8방향 중 하나로 스냅하고 1~3걸음(=2~4칸)으로 자른 끝 칸 */
  #snapEnd(start, e) {
    const rect = this.root.getBoundingClientRect();
    const cellPx = rect.width / SIZE;
    const sx = rect.left + (colOf(start) + 0.5) * cellPx;
    const sy = rect.top + (rowOf(start) + 0.5) * cellPx;
    const dx = e.clientX - sx;
    const dy = e.clientY - sy;
    const dist = Math.hypot(dx, dy);
    if (dist < cellPx * 0.55) return null;
    const sector = ((Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) % 8) + 8) % 8;
    const { dr, dc } = STEP_ANGLES[sector];
    const stepPx = cellPx * (dr && dc ? Math.SQRT2 : 1);
    let steps = Math.max(1, Math.min(MAX_BOX - 1, Math.round(dist / stepPx)));
    while (steps > 0) {
      const r = rowOf(start) + dr * steps;
      const c = colOf(start) + dc * steps;
      if (r >= 0 && r < SIZE && c >= 0 && c < SIZE) return idxOf(r, c);
      steps--;
    }
    return null;
  }

  #onDown(e) {
    if (!this.interactive || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const idx = this.#cellAt(e);
    if (idx === null) return;
    e.preventDefault();
    this.root.setPointerCapture?.(e.pointerId);
    this.drag = { start: idx, end: null };
  }

  #onMove(e) {
    if (!this.drag) return;
    const end = this.#snapEnd(this.drag.start, e);
    if (end === this.drag.end) return;
    this.drag.end = end;
    this.#paintSelection(end === null ? null : boxFromEndpoints(this.drag.start, end), { preview: true });
  }

  #onUp(e) {
    if (!this.drag) return;
    const { start, end } = this.drag;
    this.drag = null;
    if (end !== null) {
      this.setSelection(boxFromEndpoints(start, end));
      return;
    }
    // 드래그 없이 탭 — 기준점이 있으면 기준점~이 칸으로 박스, 없으면 이 칸을 기준점으로
    const tapped = this.#cellAt(e) ?? start;
    if (this.anchor !== null && this.anchor !== tapped) {
      const box = boxFromEndpoints(this.anchor, tapped);
      if (box) { this.setSelection(box); return; }
    }
    this.selection = null;
    this.anchor = this.anchor === tapped ? null : tapped;
    this.#paintSelection(null);
    this.onSelect(null);
  }
}
