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
  draw(ctx: CanvasRenderingContext2D, state: S, anim: Anim<S, E> | null): void;
}

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

export async function runGame<S, E>(def: GameDef<S, E>): Promise<void> {
  const canvas = el<HTMLCanvasElement>('game');
  const ctx = canvas.getContext('2d')!;
  const platform = await loadPlatform();
  await platform.init();

  const sound = createSound();
  const save = createSave(def.saveKey, { stars: [] as number[], muted: false });
  const record = save.load();
  sound.setMuted(record.muted);

  let level = 0;
  let state = def.start(0);
  let anim: Anim<S, E> | null = null;
  let busy = false; // 動きを見せている間・広告の間は入力を受けない

  const starsOf = (i: number) => record.stars[i] ?? 0;
  /** クリアした一番先のステージの、2つ先まで遊べる（1つ詰まっても先へ進める） */
  const unlocked = (i: number) => {
    let frontier = 0;
    for (let k = 0; k < def.levelCount; k++) if (starsOf(k) > 0) frontier = k + 1;
    return i <= frontier + 1;
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
    el('select').hidden = true;
    el('result').hidden = true;
    busy = false;
    platform.gameplayStart();
    render();
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

  el('retryBtn').addEventListener('click', () => {
    if (!busy) void play(level, false);
  });
  el('menuBtn').addEventListener('click', () => {
    if (!busy) showSelect();
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

  platform.loadingFinished();
  render();
  showSelect();
}
