/** Node 스크립트용 — src/data/*.txt 를 읽어 출제 풀·추측 사전을 만든다 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WORD_LENGTHS, buildAnswerPool, buildGuessDictionary } from '../../src/core/dictionary.js';
import { modeOf } from '../../src/game/modes.js';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'data');
const read = (name) => readFileSync(path.join(DATA_DIR, name), 'utf8');
const readTexts = (kind) => Object.fromEntries(WORD_LENGTHS.map((len) => [len, read(`${kind}-${len}.txt`)]));

/** 모드별 출제 풀 — 스탠다드는 2~4글자, 사자성어는 4글자 사자성어만 */
export const loadAnswerPool = (modeId = 'standard') => {
  const mode = modeOf(modeId);
  return mode.answersFile ? buildAnswerPool({ 4: read(mode.answersFile) }) : buildAnswerPool(readTexts('answers'), read('answers-simple.txt'));
};
export const loadGuessDictionary = () => buildGuessDictionary(readTexts('guesses'), read('compound-parts.txt'));
