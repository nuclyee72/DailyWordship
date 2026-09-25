/**
 * BoardRenderer.js — N×N 해역 그리기(기본 8×8, '넓은 바다' 10×10) + 드래그로 박스 고르기.
 *
 * 구조
 *   .ws-board            N×N CSS grid(--ws-size). 칸 하나 = 정확히 1/N 폭이라 칸 중심 = (c + 0.5) / N
 *     .ws-cell × N²      칸 안의 둥근 타일(.ws-tile)이 초성·음절을 보여 준다
 *     svg.ws-overlay     그 위에 겹친 SVG(viewBox 0 0 N N). 함선 외곽선·선택 박스를 '캡슐'로 그린다 —
 *                        대각선 함선도 칸 테두리가 아니라 비스듬한 캡슐 하나로 감쌀 수 있다
 *
 * 입력 — 칸에서 누른 채 끌면 8방향 중 가장 가까운 쪽으로 스냅한 2~4칸 박스가 된다.
 * 드래그 없이 두 칸을 차례로 눌러도 된다(첫 칸 = 기준점, 둘째 칸 = 끝점).
 */
import { boardOf, DEFAULT_SIZE, MAX_BOX } from '../game/board.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const STEP_ANGLES = [
  { dr: 0, dc: 1 }, { dr: 1, dc: 1 }, { dr: 1, dc: 0 }, { dr: 1, dc: -1 },
  { dr: 0, dc: -1 }, { dr: -1, dc: -1 }, { dr: -1, dc: 0 }, { dr: -1, dc: 1 },
];

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

    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.svg.setAttribute('class', 'ws-overlay');
    this.svg.setAttribute('aria-hidden', 'true');
    this.shipLayer = document.createElementNS(SVG_NS, 'g');
    this.flashLayer = document.createElementNS(SVG_NS, 'g');
    this.selLayer = document.createElementNS(SVG_NS, 'g');
    this.svg.append(this.shipLayer, this.flashLayer, this.selLayer);
    this.cells = [];
    this.setSize(DEFAULT_SIZE);

    root.addEventListener('pointerdown', (e) => this.#onDown(e));
    root.addEventListener('pointermove', (e) => this.#onMove(e));
    root.addEventListener('pointerup', (e) => this.#onUp(e));
    root.addEventListener('pointercancel', () => { this.drag = null; });
  }

  /** 판 크기를 바꾼다 — 칸을 새로 만들고 CSS 변수 --ws-size(좌표 라벨·글자 크기가 따라감)를 맞춘다 */
  setSize(size) {
    if (this.geo?.size === size) return;
    this.geo = boardOf(size);
    this.anchor = null;
    this.drag = null;
    this.selection = null;
    (this.root.closest('.ws-board-wrap') ?? this.root).style.setProperty('--ws-size', String(size));
    this.svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
    this.cells = [];
    const frag = document.createDocumentFragment();
    for (let idx = 0; idx < this.geo.cellCount; idx++) {
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
      frag.appendChild(cell);
      this.cells.push({ cell, tile, main, order });
    }
    frag.appendChild(this.svg);
    this.root.replaceChildren(frag);
    this.shipLayer.replaceChildren();
    this.flashLayer.replaceChildren();
    this.selLayer.replaceChildren();
  }

  /**
   * @param {{ onsets: string[], revealed: (string|null)[], hit: boolean[], miss: boolean[],
   *   doneCells: Set<number>, doneShips: object[], answerShips?: object[], interactive: boolean,
   *   hidden?: boolean[], blocked?: (string|null)[], holes?: boolean[] }} view
   *   hidden — 초성이 가려진 잠긴 칸 / blocked — 이번 추측에 못 쓰는 칸 / holes — 판에 뚫린 칸 (익스텐디드 기믹)
   */
  render(view) {
    const { boxCells } = this.geo;
    this.interactive = view.interactive;
    this.root.classList.toggle('is-locked', !view.interactive);
    const answerAt = new Map();
    for (const ship of view.answerShips ?? []) boxCells(ship).forEach((idx, i) => answerAt.set(idx, ship.name[i]));

    this.cells.forEach(({ tile, main }, idx) => {
      const syl = view.revealed[idx];
      const done = view.doneCells.has(idx);
      const answer = !syl && answerAt.get(idx);
      const hidden = !syl && !answer && view.hidden?.[idx];
      tile.className = 'ws-tile';
      if (view.holes?.[idx]) { tile.classList.add('is-hole'); main.textContent = ''; return; }
      if (done) tile.classList.add('is-done');
      else if (syl) tile.classList.add('is-reveal');
      else if (answer) tile.classList.add('is-answer');
      else if (view.hit[idx]) tile.classList.add('is-hit');
      else if (view.miss[idx]) tile.classList.add('is-miss');
      if (hidden) tile.classList.add('is-hidden');
      if (view.blocked?.[idx]) tile.classList.add('is-blocked');
      main.textContent = syl || answer || (hidden ? '' : view.onsets[idx]);
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
    const cap = this.#capsule(box, 'ws-cap-flash');
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
    this.geo.boxCells(box).forEach((idx, i) => {
      this.cells[idx].tile.classList.add('is-selected');
      this.cells[idx].order.textContent = String(i + 1);
    });
    this.selLayer.appendChild(this.#capsule(box, preview ? 'ws-cap-select is-preview' : 'ws-cap-select'));
  }

  /** 박스를 감싸는 캡슐(둥근 사각형, 박스 방향으로 회전) */
  #capsule(box, cls) {
    const { boxCells, rowOf, colOf } = this.geo;
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
    const { size, idxOf } = this.geo;
    const rect = this.root.getBoundingClientRect();
    const c = Math.floor(((e.clientX - rect.left) / rect.width) * size);
    const r = Math.floor(((e.clientY - rect.top) / rect.height) * size);
    if (r < 0 || r >= size || c < 0 || c >= size) return null;
    return idxOf(r, c);
  }

  /** 시작 칸 기준, 포인터 방향을 8방향 중 하나로 스냅하고 1~3걸음(=2~4칸)으로 자른 끝 칸 */
  #snapEnd(start, e) {
    const { size, idxOf, rowOf, colOf } = this.geo;
    const rect = this.root.getBoundingClientRect();
    const cellPx = rect.width / size;
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
      if (r >= 0 && r < size && c >= 0 && c < size) return idxOf(r, c);
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
    this.#paintSelection(end === null ? null : this.geo.boxFromEndpoints(this.drag.start, end), { preview: true });
  }

  #onUp(e) {
    if (!this.drag) return;
    const { start, end } = this.drag;
    this.drag = null;
    if (end !== null) {
      this.setSelection(this.geo.boxFromEndpoints(start, end));
      return;
    }
    // 드래그 없이 탭 — 기준점이 있으면 기준점~이 칸으로 박스, 없으면 이 칸을 기준점으로
    const tapped = this.#cellAt(e) ?? start;
    if (this.anchor !== null && this.anchor !== tapped) {
      const box = this.geo.boxFromEndpoints(this.anchor, tapped);
      if (box) { this.setSelection(box); return; }
    }
    this.selection = null;
    this.anchor = this.anchor === tapped ? null : tapped;
    this.#paintSelection(null);
    this.onSelect(null);
  }
}
