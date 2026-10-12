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
  /** 'general' は、星やボタンなど、ゲーム全体の決まり。書かなければ、ステージの中のルール */
  scope?: 'general';
  /** 動く絵。ms は、開いてからの時間。def.view の座標で描く（外枠が小さく縮めて見せる） */
  demo?(ctx: CanvasRenderingContext2D, ms: number): void;
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
  /** ルールブックの中身。新しい項目があるステージに初めて入った時は、その項目だけを自動で見せる */
  rules?: RuleEntry[];
  /**
   * ヒント。今の盤面から、次に打つとよい1手を盤の上に見せる準備をして、画面に出す一言を返す
   * （見せ方はゲーム側の draw が決める）。これがあるゲームでは、何度か失敗すると「ヒント」のボタンが出る
   */
  showHint?(state: S): string;
  /** true なら「1手戻す」ボタンを出す */
  undoable?: boolean;
  /**
   * ステージを区切りに分ける。blockSize 個ずつ区切り、k 番目（0 から数える）の区切りは、
   * 集めた星の合計が blockStars × k に届くと開く。書かなければ区切らない
   */
  blocks?: { blockSize: number; blockStars: number };
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
  const save = createSave(def.saveKey, {
    stars: [] as number[],
    muted: false,
    seenRules: [] as number[],
    /** ステージごとの、失敗した回数 */
    fails: [] as number[],
    /** ステージごとの、ヒントを使った回数 */
    hintsUsed: [] as number[],
  });
  const record = save.load();
  // 前の版の保存には無い項目を補う
  record.seenRules ??= [];
  record.fails ??= [];
  record.hintsUsed ??= [];
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
  const earned = () => record.stars.reduce((sum, n) => sum + (n ?? 0), 0);
  // 区切り。区切りが無いゲームは、全部で1つの区切りとして扱う
  const blockSize = def.blocks?.blockSize ?? def.levelCount;
  const blockOf = (i: number) => Math.floor(i / blockSize);
  /** k 番目の区切りを開くのに要る、星の合計 */
  const blockNeed = (k: number) => (def.blocks?.blockStars ?? 0) * k;
  const blockOpen = (k: number) => earned() >= blockNeed(k);
  /** その区切りの中で、クリアした一番先のステージの、次のステージ */
  const frontier = (k: number) => {
    let next = k * blockSize;
    for (let i = k * blockSize; i < Math.min((k + 1) * blockSize, def.levelCount); i++) if (starsOf(i) > 0) next = i + 1;
    return next;
  };
  /** 区切りが開いていて、その区切りの中でクリアした一番先のステージの、2つ先まで遊べる（1つ詰まっても先へ進める） */
  const unlocked = (i: number) => unlockAll || (blockOpen(blockOf(i)) && i <= frontier(blockOf(i)) + 1);

  // 詰まった時の助け。同じステージで HINT_EVERY 回失敗するたびに、ヒントが1回分増える
  // （一度に何回も使えると、ヒントの通りに撃つだけで解けてしまう。詰まるほど助けが増える）。
  // 手元で確かめる時は、番地の後ろに ?help を付けると、最初から何回でも使える
  const HINT_EVERY = 2;
  const helpAll = import.meta.env.DEV && new URLSearchParams(location.search).has('help');
  const failsOf = (i: number) => record.fails[i] ?? 0;
  /** 今のステージで、あと何回ヒントを使えるか */
  const hintsLeft = () => (helpAll ? Infinity : Math.floor(failsOf(level) / HINT_EVERY) - (record.hintsUsed[level] ?? 0));
  const hintOpen = () => !!def.showHint && (helpAll || failsOf(level) >= HINT_EVERY);
  /** 広告を見てもらう。広告の無い版（GitHub Pages・手元）では、そのまま通す */
  const reward = async () => platform.name === 'none' || (await platform.rewardedBreak());

  // ルールブックの動く絵。開いている間だけ、1つの繰り返しで全部を描き直す
  const DEMO_PX = 300;
  let demos: { ctx: CanvasRenderingContext2D; draw: (ctx: CanvasRenderingContext2D, ms: number) => void }[] = [];
  let demoFrame = 0;
  const stopDemos = () => {
    cancelAnimationFrame(demoFrame);
    demos = [];
  };
  const listRules = (list: RuleEntry[]) => {
    stopDemos();
    const box = el('rulesList');
    box.replaceChildren();
    for (const rule of list) {
      const item = document.createElement('div');
      item.className = 'rule';
      if (rule.demo) {
        const pic = document.createElement('canvas');
        const ratio = Math.min(2, window.devicePixelRatio || 1);
        pic.width = Math.round(DEMO_PX * ratio);
        pic.height = Math.round((DEMO_PX * ratio * def.view.height) / def.view.width);
        const picCtx = pic.getContext('2d')!;
        picCtx.scale(pic.width / def.view.width, pic.height / def.view.height);
        demos.push({ ctx: picCtx, draw: rule.demo });
        item.append(pic);
      }
      const title = document.createElement('h3');
      title.textContent = rule.title;
      const text = document.createElement('p');
      text.textContent = rule.text;
      item.append(title, text);
      box.append(item);
    }
    box.scrollTop = 0;
    if (demos.length === 0) return;
    const began = performance.now();
    const frame = (now: number) => {
      for (const demo of demos) demo.draw(demo.ctx, Math.max(0, now - began));
      demoFrame = requestAnimationFrame(frame);
    };
    demoFrame = requestAnimationFrame(frame);
  };

  /**
   * ルールブックを開く。fresh（今のステージで初めて出てきた項目）を渡した時は、それだけを見せる。
   * 渡さない時は、今いるステージか、進んだ一番先のステージまでに出てきた項目を、
   * 「ステージのルール」と「ゲーム全体のルール」に分けて見せる。
   */
  let rulesTab: 'stage' | 'general' = 'stage';
  const showRules = (fresh: RuleEntry[] = []) => {
    const all = def.rules ?? [];
    const isNew = fresh.length > 0;
    el('rulesTitle').textContent = isNew ? t('新しいルール', 'New rule') : t('ルール', 'Rules');
    el('rulesTabs').hidden = isNew || !all.some((rule) => rule.scope === 'general');
    el('rulesTabStage').classList.toggle('selected', rulesTab === 'stage');
    el('rulesTabGeneral').classList.toggle('selected', rulesTab === 'general');
    if (isNew) listRules(fresh);
    else {
      let reached = level;
      for (let i = 0; i < def.levelCount; i++) if (unlocked(i)) reached = Math.max(reached, i);
      listRules(all.filter((rule) => rule.from <= reached && (rule.scope === 'general') === (rulesTab === 'general')));
    }
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
    if (hintOpen()) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'help';
      const left = hintsLeft();
      button.disabled = left <= 0;
      const count = left === Infinity ? '∞' : String(left);
      button.textContent = button.disabled
        ? t(`💡 ヒント あと0回（${HINT_EVERY}回失敗で1回増える）`, `💡 Hint ×0 (fail ${HINT_EVERY} more times for one)`)
        : t(`💡 ヒント あと${count}回`, `💡 Hint ×${count}`);
      button.addEventListener('click', () => void useHint());
      box.append(button);
    }
  };

  const useHint = async () => {
    if (busy || def.status(state) !== 'playing' || !def.showHint || hintsLeft() <= 0) return;
    busy = true;
    const ok = await reward();
    busy = false;
    if (!ok) return;
    const text = def.showHint(state);
    record.hintsUsed[level] = (record.hintsUsed[level] ?? 0) + 1;
    save.save(record);
    def.draw(ctx, state, anim);
    el('hint').textContent = text;
    renderTools();
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
      // 区切りの頭に、見出しを出す。閉じている区切りには、開くのに要る星の数を書く
      if (def.blocks && i % blockSize === 0) {
        const k = blockOf(i);
        const head = document.createElement('h2');
        head.className = 'block';
        const range = `${i + 1}〜${Math.min(i + blockSize, def.levelCount)}`;
        head.textContent =
          blockOpen(k) || unlockAll
            ? t(`ステージ ${range}`, `Stages ${range}`)
            : t(`🔒 ステージ ${range}（★${blockNeed(k)} で開く）`, `🔒 Stages ${range} (opens at ★${blockNeed(k)})`);
        box.append(head);
      }
      const button = document.createElement('button');
      button.type = 'button';
      button.disabled = !unlocked(i);
      const mark = !unlocked(i) ? '🔒' : starText(starsOf(i));
      button.innerHTML = `<b>${i + 1}</b><span>${mark}</span>`;
      button.addEventListener('click', () => void play(i, false));
      box.append(button);
    }
    el('total').textContent = `★ ${earned()} / ${def.levelCount * 3}`;
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
    // 新しいルールが出てくるステージに初めて入った時は、その新しいルールだけを見せる
    const fresh = (def.rules ?? []).filter((rule) => rule.from === i && rule.scope !== 'general');
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
      record.fails[level] = failsOf(level) + 1;
      save.save(record);
      sound.tone(180, 400);
    }
    const hasNext = level + 1 < def.levelCount && unlocked(level + 1);
    // 次の区切りがまだ閉じている時は、あと幾つ星が要るかを書く
    const nextBlock = blockOf(level) + 1;
    const blocked = cleared && !!def.blocks && level + 1 === nextBlock * blockSize && level + 1 < def.levelCount && !blockOpen(nextBlock);
    el('resultTitle').textContent = cleared ? t('クリア！', 'Cleared!') : t('失敗', 'Failed');
    el('resultStars').textContent = cleared ? starText(stars) : '';
    el('resultNote').textContent = cleared
      ? (stars === 3 ? t('最少の手数です', 'Best possible!') : t('もっと少ない手数で解けます', 'It can be done in fewer moves')) +
        (blocked ? t(`　次のステージは ★${blockNeed(nextBlock)} で開く（今 ★${earned()}）`, `  The next stages open at ★${blockNeed(nextBlock)} (you have ★${earned()})`) : '')
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
  el('selectRules').hidden = !def.rules?.length;
  el('selectRules').addEventListener('click', () => showRules());
  for (const [id, tab] of [['rulesTabStage', 'stage'], ['rulesTabGeneral', 'general']] as const) {
    el(id).addEventListener('click', () => {
      rulesTab = tab;
      showRules();
    });
  }
  el('rulesClose').addEventListener('click', () => {
    stopDemos();
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
  el('selectRules').textContent = t('？ ルール', '? Rules');
  el('rulesTabStage').textContent = t('ステージのルール', 'Stage rules');
  el('rulesTabGeneral').textContent = t('ゲーム全体のルール', 'Game rules');
  // マウスを乗せた時に、ボタンの名前を出す
  el('menuBtn').title = t('ホーム（ステージ選択）', 'Home (stages)');
  el('undoBtn').title = t('1手戻す', 'Undo one move');
  el('retryBtn').title = t('最初からやり直す', 'Restart the stage');
  el('rulesBtn').title = t('ルール', 'Rules');
  el('muteBtn').title = t('音を出す・消す', 'Sound on / off');
  el('rulesClose').textContent = t('閉じる', 'Close');

  platform.loadingFinished();
  render();
  showSelect();
}
