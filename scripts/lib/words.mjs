/** Node 스크립트용 — src/data/*.txt 를 읽어 출제 풀·추측 사전을 만든다 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WORD_LENGTHS, buildAnswerPool, buildGuessDictionary } from '../../src/core/dictionary.js';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'data');
const readTexts = (kind) => Object.fromEntries(
  WORD_LENGTHS.map((len) => [len, readFileSync(path.join(DATA_DIR, `${kind}-${len}.txt`), 'utf8')]),
);

export const loadAnswerPool = () => buildAnswerPool(readTexts('answers'));
export const loadGuessDictionary = () => buildGuessDictionary(readTexts('guesses'));
