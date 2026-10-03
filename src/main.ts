// 入口。共通部分（kit）・ルール（game）・画面（ui）をつなぐ。
import { chooseMove } from './game/cpu';
import { applyMove, createInitialState, type State } from './game/rules';
import { createSound } from './kit/audio';
import { loadPlatform } from './kit/platform';
import { createRng } from './kit/rng';
import { createSave } from './kit/save';
import { fitCanvas } from './kit/scale';
import { cellAt, draw, VIEW } from './ui/render';

const CPU_DELAY_MS = 350;

async function start(): Promise<void> {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const status = document.getElementById('status') as HTMLElement;
  const muteButton = document.getElementById('mute') as HTMLButtonElement;
  const ctx = canvas.getContext('2d')!;

  const platform = await loadPlatform();
  await platform.init();

  const rng = createRng();
  const sound = createSound();
  const save = createSave('web-game-template.v1', { wins: 0, losses: 0, draws: 0, muted: false });
  const record = save.load();
  sound.setMuted(record.muted);

  let state: State = createInitialState();
  let busy = false; // CPU の番・広告の間は入力を受けない

  const render = () => {
    draw(ctx, state);
    const result = { p1: 'あなたの勝ち', p2: 'CPU の勝ち', draw: '引き分け' } as const;
    status.textContent = state.winner
      ? `${result[state.winner]} — クリックで次の対局（${record.wins}勝 ${record.losses}敗 ${record.draws}分）`
      : state.turn === 'p1' ? 'あなたの番' : 'CPU の番';
    muteButton.textContent = sound.muted ? '音: 切' : '音: 入';
  };

  const fit = fitCanvas(canvas, VIEW, render);

  const finishIfOver = () => {
    if (!state.winner) return;
    if (state.winner === 'p1') record.wins++;
    else if (state.winner === 'p2') record.losses++;
    else record.draws++;
    save.save(record);
    sound.tone(state.winner === 'p1' ? 880 : 220, 300);
    platform.gameplayStop();
  };

  const play = (index: number) => {
    const next = applyMove(state, index);
    if (next === state) return false;
    state = next;
    sound.tone(state.turn === 'p2' ? 520 : 390, 80);
    finishIfOver();
    render();
    return true;
  };

  const restart = async () => {
    busy = true;
    await platform.commercialBreak();
    state = createInitialState();
    busy = false;
    platform.gameplayStart();
    render();
  };

  canvas.addEventListener('pointerdown', (e) => {
    if (busy) return;
    if (state.winner) {
      void restart();
      return;
    }
    const { x, y } = fit.toLogical(e.clientX, e.clientY);
    const index = cellAt(x, y);
    if (index === null || !play(index) || state.winner) return;
    busy = true;
    setTimeout(() => {
      play(chooseMove(state, rng));
      busy = false;
    }, CPU_DELAY_MS);
  });

  muteButton.addEventListener('click', () => {
    sound.setMuted(!sound.muted);
    record.muted = sound.muted;
    save.save(record);
    render();
  });

  platform.loadingFinished();
  platform.gameplayStart();
  render();
}

void start();
