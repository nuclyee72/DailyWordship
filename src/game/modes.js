/**
 * modes.js — 게임 모드. 형제 게임(DailySudoku·DailyTrilateral)의 스탠다드/익스텐디드 자리에
 * 스탠다드/사자성어 두 가지를 둔다. 데일리 파일·저장 키·통계·공유 문구가 모드별로 따로다.
 */
import { FLEET, MAX_GUESSES } from './game.js';
import { DEFAULT_MIN_DECOYS } from './generator.js';

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
  },
};
export const MODE_IDS = Object.keys(MODES);
export const modeOf = (id) => MODES[id] ?? MODES.standard;
