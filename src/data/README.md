# 단어 데이터

`scripts/build-word-data.mjs`(= `npm run build-word-data`)가 만든다. 모든 파일은 한 줄에 한 단어, 가나다순.

| 파일 | 용도 | 개수 (2026-09-23 빌드) |
|---|---|---|
| `answers-2.txt` · `answers-3.txt` · `answers-4.txt` | **출제 풀** — 함명은 여기서만 뽑는다 | 2,145 · 737 · 739 |
| `guesses-2.txt` · `guesses-3.txt` · `guesses-4.txt` | **추측 허용 사전** — 플레이어 입력 단어 검사 | 82,316 · 163,558 · 48,429 (2026-09-24) |
| `compound-parts.txt` | **합성어 규칙 부품** — 상용 명사 1~3글자. 부품+부품인 3~4글자도 추측 허용 | 3,120 |
| `curated/answers-3-extra.txt` | 3글자 출제 풀 보강 (손으로 고름) | |
| `curated/answers-4-extra.txt` | 4글자 출제 풀 보강 (손으로 고름) | |
| `curated/blocklist.txt` | 출제 풀에서 뺄 단어 — 고유명사·부사류 (추측은 허용) | |

## 만드는 규칙

- **출제 풀** = 상용 어휘(CommonNouns)의 2~4글자 순한글 명사 + `curated/answers-*-extra.txt` − `curated/blocklist.txt`
  - 3글자 `-적` 관형 명사(간접적·경제적…)는 함명으로 밋밋해서 뺀다
- **추측 허용 사전** = CommonNouns ∪ AllNouns ∪ open-korean-text 일반 명사 ∪ open-korean-text 위키백과 표제어 명사 ∪ 출제 풀
  - 위키 표제어에는 고유명사도 섞여 있지만, 추측 사전의 역할은 "아무 음절이나 넣어 떠보기"를 막는 것뿐이라 넉넉한 편이 낫다
  - 목록에 없어도 **상용 명사 + 상용 명사**로 쪼개지는 3~4글자는 합성어로 인정 (`라면+집`, `택시+비`, `운동화+끈`) — `src/core/dictionary.js`

## 4글자를 손으로 보강한 이유

상용 어휘 목록의 4글자 명사는 124개뿐이라 함명이 금방 반복된다. 표준국어대사전 목록(AllNouns)의 4글자
8,634개를 전부 훑어 일상에서 바로 알아볼 단어(생활 복합어·널리 아는 사자성어)만 골랐다. AllNouns는
하이픈이 붙는 합성어(`고슴-도치`, `징검-다리` 등)가 대부분 빠져 있어서, `여름방학`·`고슴도치` 같은
일상 복합어는 따로 적어 넣었다 — 이것들은 추측 사전에도 자동으로 들어간다.

같은 이유로 **추측 사전에도 일상 합성어가 일부 빠져 있을 수 있다.** 플레이어가 "사전에 없는 단어"를
제보하면 `curated/` 목록에 넣고 다시 빌드한다.

## 출처 · 라이선스

- [han-dle/pd-korean-noun-list-for-wordles](https://github.com/han-dle/pd-korean-noun-list-for-wordles) — **CC0-1.0**
  - `CommonNouns` ← 국립국어원 한국어 학습용 어휘 목록
  - `AllNouns` ← 표준국어대사전 명사
- [open-korean-text](https://github.com/open-korean-text/open-korean-text) `noun/nouns.txt`, `noun/wikipedia_title_nouns.txt` — **Apache-2.0**
- `curated/*.txt` — 이 저장소에서 직접 작성
