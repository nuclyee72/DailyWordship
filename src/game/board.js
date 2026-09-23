/**
 * board.js — 8×8 보드 좌표와 '박스'(직선으로 이어진 2~4칸) 기하.
 *
 * 칸 번호 idx = r * 8 + c (r: 위→아래 0~7, c: 왼→오 0~7).
 * 방향은 네 가지이고, 읽는 방향이 하나로 고정돼 있다 (GDD §2).
 *   h  가로   좌→우
 *   v  세로   위→아래
 *   d  대각 ↘ 좌상→우하
 *   u  대각 ↗ 좌하→우상
 * 박스 { r, c, dir, len } 의 (r, c)는 읽기 시작 칸이다.
 */
export const SIZE = 8;
export const CELL_COUNT = SIZE * SIZE;
export const MIN_BOX = 2;
export const MAX_BOX = 4;

export const DIRS = {
  h: { dr: 0, dc: 1 },
  v: { dr: 1, dc: 0 },
  d: { dr: 1, dc: 1 },
  u: { dr: -1, dc: 1 },
};
export const DIR_KEYS = Object.keys(DIRS);

export const idxOf = (r, c) => r * SIZE + c;
export const rowOf = (idx) => Math.floor(idx / SIZE);
export const colOf = (idx) => idx % SIZE;
const inBounds = (r, c) => r >= 0 && r < SIZE && c >= 0 && c < SIZE;

/** 박스가 차지하는 칸 번호들 (읽는 순서). 보드를 벗어나면 null */
export function boxCells({ r, c, dir, len }) {
  const d = DIRS[dir];
  if (!d) return null;
  const cells = [];
  for (let i = 0; i < len; i++) {
    const rr = r + d.dr * i;
    const cc = c + d.dc * i;
    if (!inBounds(rr, cc)) return null;
    cells.push(idxOf(rr, cc));
  }
  return cells;
}

/**
 * 드래그 시작 칸 → 끝 칸을 박스로. 직선(가로·세로·정확한 대각)이 아니거나 길이가 2~4가 아니면 null.
 * 거꾸로 끌어도 고정된 읽기 방향으로 뒤집는다.
 */
export function boxFromEndpoints(a, b) {
  let r0 = rowOf(a), c0 = colOf(a), r1 = rowOf(b), c1 = colOf(b);
  const dr = r1 - r0;
  const dc = c1 - c0;
  if (!(dr === 0 || dc === 0 || Math.abs(dr) === Math.abs(dc))) return null;
  const len = Math.max(Math.abs(dr), Math.abs(dc)) + 1;
  if (len < MIN_BOX || len > MAX_BOX) return null;
  // 읽기 방향: 왼쪽 끝에서 시작, 세로면 위쪽 끝에서 시작
  if (dc < 0 || (dc === 0 && dr < 0)) { [r0, c0, r1, c1] = [r1, c1, r0, c0]; }
  const ndr = Math.sign(r1 - r0);
  const ndc = Math.sign(c1 - c0);
  const dir = ndc === 0 ? 'v' : ndr === 0 ? 'h' : ndr > 0 ? 'd' : 'u';
  return { r: r0, c: c0, dir, len };
}

/** 길이 len인 보드 위 모든 박스 */
export function allBoxes(len) {
  const out = [];
  for (const dir of DIR_KEYS) {
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const box = { r, c, dir, len };
        if (boxCells(box)) out.push(box);
      }
    }
  }
  return out;
}

export const sameBox = (a, b) => a.r === b.r && a.c === b.c && a.dir === b.dir && a.len === b.len;

/** 사람이 읽는 좌표 — 열 a~h, 행 1~8 (위가 1) */
export const cellLabel = (idx) => `${String.fromCharCode(97 + colOf(idx))}${rowOf(idx) + 1}`;
export const DIR_ARROW = { h: '→', v: '↓', d: '↘', u: '↗' };
export const boxLabel = (box) => `${cellLabel(idxOf(box.r, box.c))}${DIR_ARROW[box.dir]}`;
