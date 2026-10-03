// 毎フレーム進める仕組み。動き続けるゲーム（アクションなど）で使う。
// ルールは「決まった刻み」（既定は 1/60 秒）でだけ進める。
// 画面の更新間隔は端末ごとに違うが、刻みが同じなら同じ入力で同じ結果になるので、
// テストと動作記録がそのまま使える。

export interface Stepper {
  /**
   * 前回からの経過時間（ミリ秒）を渡すと、ルールを何回進めるかを返す。
   * alpha は次の刻みまでの進み具合（0 以上 1 未満）。動きを滑らかに描く時に使う。
   */
  advance(elapsedMs: number): { steps: number; alpha: number };
  reset(): void;
}

/**
 * 経過時間を刻みの回数に直す。画面に触れないので、テストや画面なしの実行でも使える。
 * maxSteps を超える分は捨てる（タブを離れて戻った時に、溜まった時間を一気に進めないため）。
 */
export function createStepper(stepMs: number = 1000 / 60, maxSteps: number = 5): Stepper {
  if (!(stepMs > 0)) throw new Error('createStepper: stepMs は正の数にする');
  let rest = 0;
  return {
    advance(elapsedMs) {
      rest += Math.max(0, elapsedMs);
      let steps = Math.floor(rest / stepMs);
      if (steps > maxSteps) {
        steps = maxSteps;
        rest = 0;
      } else {
        rest -= steps * stepMs;
      }
      return { steps, alpha: rest / stepMs };
    },
    reset() {
      rest = 0;
    },
  };
}

export interface LoopOptions {
  /** ルールを1回進める刻み（ミリ秒）。既定は 1000/60 */
  stepMs?: number;
  /** 1回の描画で進める刻みの上限。既定は 5 */
  maxSteps?: number;
  /** ルールを1刻み進める。stepMs はいつも同じ値 */
  update(stepMs: number): void;
  /** 描画。alpha は次の刻みまでの進み具合（0 以上 1 未満） */
  render(alpha: number): void;
}

export interface Loop {
  start(): void;
  /** 止める。もう一度 start すると、止めていた間の時間は進めずに再開する */
  stop(): void;
  readonly running: boolean;
}

export function createLoop(opts: LoopOptions): Loop {
  const stepMs = opts.stepMs ?? 1000 / 60;
  const stepper = createStepper(stepMs, opts.maxSteps);
  let handle = 0;
  let last = 0;
  let running = false;

  const frame = (now: number) => {
    if (!running) return;
    const { steps, alpha } = stepper.advance(now - last);
    last = now;
    for (let i = 0; i < steps && running; i++) opts.update(stepMs);
    opts.render(alpha);
    if (running) handle = requestAnimationFrame(frame);
  };

  return {
    start() {
      if (running) return;
      running = true;
      stepper.reset();
      last = performance.now();
      handle = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      cancelAnimationFrame(handle);
    },
    get running() {
      return running;
    },
  };
}
