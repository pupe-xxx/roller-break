// ステージ制のパズルの外枠。ステージ選択・手を打つ・動きを見せる・結果を出す・星を保存する。
// ゲームごとの中身（ルールの呼び出しと描画）は GameDef の形で受け取る。
import { createSound } from '../kit/audio';
import { loadPlatform } from '../kit/platform';
import { createSave } from '../kit/save';
import { fitCanvas } from '../kit/scale';
import { t } from './i18n';

export type Status = 'playing' | 'cleared' | 'failed';

/** 1回の操作の結果。events と ms があれば、その時間をかけて動きを見せる */
export interface Step<S, E> {
  state: S;
  events?: E;
  ms?: number;
  sound?: 'tap' | 'hit' | 'miss';
}

export interface ToolButton {
  id: string;
  label: string;
  selected?: boolean;
  disabled?: boolean;
}

/** 動きを見せている間の情報。from は動く前の状態、t は 0 から 1 */
export interface Anim<S, E> {
  from: S;
  events: E;
  t: number;
}

/** ルールブックの1項目。from 番目（0 から数える）のステージまで進むと、読めるようになる */
export interface RuleEntry {
  from: number;
  title: string;
  text: string;
}

export interface GameDef<S, E> {
  /** セーブの名前。ゲームごとに違う名前にする */
  saveKey: string;
  title: string;
  /** 遊び方を1〜2行で */
  howto: string;
  view: { width: number; height: number };
  levelCount: number;
  start(level: number): S;
  status(state: S): Status;
  /** クリアした時の星の数（1〜3） */
  stars(state: S): number;
  /** 画面の上に出す残り回数など */
  counter(state: S): string;
  /** そのステージで出す一言。無ければ空文字 */
  hint(level: number): string;
  failText(state: S): string;
  buttons?(state: S): ToolButton[];
  press?(state: S, id: string): Step<S, E> | null;
  tap(state: S, x: number, y: number): Step<S, E> | null;
  /** ルールブックの中身。新しい項目があるステージに初めて入った時は、自動で開く */
  rules?: RuleEntry[];
  /** true なら「1手戻す」ボタンを出す */
  undoable?: boolean;
  /**
   * マウスを乗せている位置を知らせる（盤から出た時と、1手戻した時は x・y とも -1）。
   * 置く前の下見などに使う。描き直しが要る時は true を返す。指で触る端末では呼ばれない
   */
  hover?(state: S, x: number, y: number): boolean;
  draw(ctx: CanvasRenderingContext2D, state: S, anim: Anim<S, E> | null): void;
}

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

export async function runGame<S, E>(def: GameDef<S, E>): Promise<void> {
  const canvas = el<HTMLCanvasElement>('game');
  const ctx = canvas.getContext('2d')!;
  const platform = await loadPlatform();
  await platform.init();

  const sound = createSound();
  const save = createSave(def.saveKey, { stars: [] as number[], muted: false, seenRules: [] as number[] });
  const record = save.load();
  sound.setMuted(record.muted);

  let level = 0;
  let state = def.start(0);
  let anim: Anim<S, E> | null = null;
  let busy = false; // 動きを見せている間・広告の間は入力を受けない
  let history: S[] = []; // 1手戻すために、変わる前の状態を積んでおく

  const starsOf = (i: number) => record.stars[i] ?? 0;
  // テストプレイ用。手元で動かした時（npm run dev）は、最初から全ステージを遊べる。
  // 鍵のかかり方を見たい時は、番地の後ろに ?lock を付ける。
  // 公開用のビルドでは import.meta.env.DEV が false になり、この行ごと消える（星の記録は変えない）
  const unlockAll = import.meta.env.DEV && !new URLSearchParams(location.search).has('lock');
  /** クリアした一番先のステージの、2つ先まで遊べる（1つ詰まっても先へ進める） */
  const unlocked = (i: number) => unlockAll || i <= frontier() + 1;
  /** クリアした一番先のステージの、次のステージ */
  const frontier = () => {
    let next = 0;
    for (let k = 0; k < def.levelCount; k++) if (starsOf(k) > 0) next = k + 1;
    return next;
  };

  /**
   * ルールブックを開く。読めるのは、今いるステージか、進んだ一番先のステージまでに出てきた項目。
   * fresh に入っている項目（今のステージで初めて出てきたもの）には、NEW の印を付けて先頭に出す。
   */
  const showRules = (fresh: RuleEntry[] = []) => {
    const reached = Math.max(level, frontier());
    const known = (def.rules ?? []).filter((rule) => rule.from <= reached && !fresh.includes(rule));
    const box = el('rulesList');
    box.replaceChildren();
    for (const rule of [...fresh, ...known]) {
      const item = document.createElement('div');
      item.className = fresh.includes(rule) ? 'rule new' : 'rule';
      const title = document.createElement('h3');
      title.textContent = rule.title;
      const text = document.createElement('p');
      text.textContent = rule.text;
      item.append(title, text);
      box.append(item);
    }
    box.scrollTop = 0;
    el('rules').hidden = false;
  };
  const starText = (n: number) => '★'.repeat(n) + '☆'.repeat(3 - n);

  const renderTools = () => {
    const box = el('tools');
    box.replaceChildren();
    for (const b of def.buttons?.(state) ?? []) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = b.label;
      button.disabled = !!b.disabled;
      button.classList.toggle('selected', !!b.selected);
      button.addEventListener('click', () => {
        if (busy || def.status(state) !== 'playing') return;
        const step = def.press?.(state, b.id);
        if (step) run(step);
      });
      box.append(button);
    }
  };

  const render = () => {
    def.draw(ctx, state, anim);
    el('stageLabel').textContent = `${t('ステージ', 'Stage')} ${level + 1}`;
    el('counter').textContent = def.counter(state);
    el('hint').textContent = def.hint(level);
    el('muteBtn').textContent = sound.muted ? '🔇' : '🔊';
    el<HTMLButtonElement>('undoBtn').disabled = history.length === 0 || def.status(state) !== 'playing';
    renderTools();
  };

  const fit = fitCanvas(canvas, def.view, () => def.draw(ctx, state, anim));

  const showSelect = () => {
    platform.gameplayStop();
    el('result').hidden = true;
    const box = el('levels');
    box.replaceChildren();
    for (let i = 0; i < def.levelCount; i++) {
      const button = document.createElement('button');
      button.type = 'button';
      button.disabled = !unlocked(i);
      button.innerHTML = `<b>${i + 1}</b><span>${unlocked(i) ? starText(starsOf(i)) : '🔒'}</span>`;
      button.addEventListener('click', () => void play(i, false));
      box.append(button);
    }
    const total = record.stars.reduce((sum, n) => sum + (n ?? 0), 0);
    el('total').textContent = `★ ${total} / ${def.levelCount * 3}`;
    el('select').hidden = false;
  };

  const play = async (i: number, withBreak: boolean) => {
    busy = true;
    if (withBreak) await platform.commercialBreak();
    level = i;
    state = def.start(i);
    anim = null;
    history = [];
    el('select').hidden = true;
    el('result').hidden = true;
    busy = false;
    platform.gameplayStart();
    render();
    // 新しいルールが出てくるステージに初めて入った時は、ルールブックを開いて見せる
    const fresh = (def.rules ?? []).filter((rule) => rule.from === i);
    record.seenRules ??= [];
    if (fresh.length > 0 && !record.seenRules.includes(i)) {
      record.seenRules.push(i);
      save.save(record);
      showRules(fresh);
    }
  };

  const showResult = () => {
    platform.gameplayStop();
    const cleared = def.status(state) === 'cleared';
    const stars = cleared ? def.stars(state) : 0;
    if (cleared) {
      record.stars[level] = Math.max(starsOf(level), stars);
      save.save(record);
      [660, 880, 1100].slice(0, stars).forEach((hz, i) => setTimeout(() => sound.tone(hz, 180), i * 140));
    } else {
      sound.tone(180, 400);
    }
    const hasNext = level + 1 < def.levelCount;
    el('resultTitle').textContent = cleared ? t('クリア！', 'Cleared!') : t('失敗', 'Failed');
    el('resultStars').textContent = cleared ? starText(stars) : '';
    el('resultNote').textContent = cleared
      ? stars === 3 ? t('最少の手数です', 'Best possible!') : t('もっと少ない手数で解けます', 'It can be done in fewer moves')
      : def.failText(state);
    el('resultNext').hidden = !(cleared && hasNext);
    el('result').classList.toggle('failed', !cleared);
    el('result').hidden = false;
  };

  const settle = (next: S) => {
    state = next;
    anim = null;
    busy = false;
    render();
    if (def.status(state) !== 'playing') {
      busy = true;
      setTimeout(() => {
        busy = false;
        showResult();
      }, 350);
    }
  };

  function run(step: Step<S, E>): void {
    if (step.sound === 'tap') sound.tone(520, 60);
    else if (step.sound === 'hit') sound.tone(740, 120);
    else if (step.sound === 'miss') sound.tone(240, 120);
    // 状態が変わる手だけ積む（駒の種類を選ぶ・下見するだけの操作は積まない）
    if (step.state !== state) history.push(state);
    if (step.events === undefined || !step.ms) {
      settle(step.state);
      return;
    }
    busy = true;
    const from = state, events = step.events, ms = step.ms;
    const began = performance.now();
    const frame = (now: number) => {
      // 最初のコマの時刻は began より前のことがあるので、0 より小さくしない
      const p = Math.max(0, Math.min(1, (now - began) / ms));
      if (p >= 1) {
        settle(step.state);
        return;
      }
      anim = { from, events, t: p };
      def.draw(ctx, step.state, anim);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (busy || def.status(state) !== 'playing') return;
    const { x, y } = fit.toLogical(e.clientX, e.clientY);
    const step = def.tap(state, x, y);
    if (step) run(step);
  });

  // マウスを乗せた位置を知らせる。指で触る端末には「乗せる」が無いので、マウスの時だけ
  const hoverAt = (x: number, y: number) => {
    if (!busy && def.status(state) === 'playing' && def.hover?.(state, x, y)) def.draw(ctx, state, anim);
  };
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    const { x, y } = fit.toLogical(e.clientX, e.clientY);
    hoverAt(x, y);
  });
  canvas.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse') hoverAt(-1, -1);
  });

  el('undoBtn').hidden = !def.undoable;
  el('undoBtn').addEventListener('click', () => {
    if (busy || def.status(state) !== 'playing') return;
    const before = history.pop();
    if (before === undefined) return;
    state = before;
    def.hover?.(state, -1, -1);
    sound.tone(420, 60);
    render();
  });

  el('retryBtn').addEventListener('click', () => {
    if (!busy) void play(level, false);
  });
  el('menuBtn').addEventListener('click', () => {
    if (!busy) showSelect();
  });
  el('rulesBtn').hidden = !def.rules?.length;
  el('rulesBtn').addEventListener('click', () => {
    if (!busy) showRules();
  });
  el('rulesClose').addEventListener('click', () => {
    el('rules').hidden = true;
  });
  el('muteBtn').addEventListener('click', () => {
    sound.setMuted(!sound.muted);
    record.muted = sound.muted;
    save.save(record);
    render();
  });
  // やり直しと次のステージの前が、広告を出す区切り
  el('resultRetry').addEventListener('click', () => void play(level, true));
  el('resultNext').addEventListener('click', () => void play(level + 1, true));
  el('resultMenu').addEventListener('click', showSelect);

  document.title = def.title;
  el('title').textContent = def.title;
  el('howto').textContent = def.howto;
  el('resultRetry').textContent = t('もう一度', 'Retry');
  el('resultNext').textContent = t('次へ', 'Next');
  el('resultMenu').textContent = t('ステージ選択', 'Stages');
  el('rulesTitle').textContent = t('ルール', 'Rules');
  el('rulesClose').textContent = t('閉じる', 'Close');

  platform.loadingFinished();
  render();
  showSelect();
}
