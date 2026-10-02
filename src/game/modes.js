/**
 * modes.js — 게임 모드. 형제 게임(DailySudoku·DailyTrilateral)과 같은 스탠다드/익스텐디드에
 * 워드십만의 사자성어를 더해 세 가지를 둔다. 데일리 파일·저장 키·통계·공유 문구가 모드별로 따로다.
 */
import { FLEET, MAX_GUESSES } from './game.js';
import { DEFAULT_MIN_DECOYS } from './generator.js';

/**
 * 통계 '사용한 추측 수' 구간의 위쪽 끝 — 추측 한도에서 아래로 2번씩 6구간.
 * 30 → [20, 22, 24, 26, 28, 30] = '1~20번' '21~22번' … '29~30번' (대부분 한도 가까이에서 끝나므로 위쪽을 촘촘하게)
 */
const topBounds = (max, count = 6, step = 2) => Array.from({ length: count }, (_, i) => max - (count - 1 - i) * step);

export const MODES = {
  standard: {
    id: 'standard',
    label: '스탠다드',
    desc: '8×8 · 함선 6척 · 추측 30번',
    fleet: FLEET,
    maxGuesses: MAX_GUESSES,
    answersFile: null,          // answers-{2,3,4}.txt
    seedPrefix: 'daily',
    fileName: (date) => date,   // daily/<date>.json
    minDecoys: DEFAULT_MIN_DECOYS,
    gimmicks: false,
    distBounds: topBounds(MAX_GUESSES),
  },
  extended: {
    id: 'extended',
    label: '익스텐디드',
    desc: '매일 바뀌는 기믹 2개 · 추측 35번',
    fleet: FLEET,
    maxGuesses: 35,
    answersFile: null,          // 스탠다드와 같은 출제 풀
    seedPrefix: 'daily-extended',
    fileName: (date) => `extended-${date}`,
    minDecoys: DEFAULT_MIN_DECOYS,
    gimmicks: true,             // 그날의 기믹 2개 — src/game/gimmicks.js dailyGimmicks
    distBounds: topBounds(35),
  },
  idiom: {
    id: 'idiom',
    label: '사자성어',
    desc: '8×8 · 사자성어 함선 5척 · 추측 20번',
    fleet: [4, 4, 4, 4, 4],
    maxGuesses: 20,
    answersFile: 'answers-idiom.txt',  // 4글자 사자성어만
    seedPrefix: 'daily-idiom',
    fileName: (date) => `idiom-${date}`,
    // 2·3칸 함선이 없으니 4칸 미끼만 본다. 자연 발생은 판당 중앙값 7개 — 모자라면 생성기가 심는다
    minDecoys: { 2: 0, 3: 0, 4: 5 },
    gimmicks: false,
    distBounds: topBounds(20),
  },
};
export const MODE_IDS = Object.keys(MODES);
export const modeOf = (id) => MODES[id] ?? MODES.standard;
