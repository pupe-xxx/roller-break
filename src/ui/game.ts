// このゲームの画面。盤を描き、タップを発射に直して、外枠（shell）に渡す。
import { DIRS, boardCells, dirTo, hexOf, inBoard, keyOf, type Hex } from '../game/hex';
import { LEVELS, PLATE_INTRO_AT, PUSH_INTRO_AT } from '../game/levels';
import { createState, fire, lightLeft, starsOf, type Level, type Shot, type ShotResult, type State, type TireKind } from '../game/rules';
import { solveFrom } from '../game/solve';
import { centerOf, hexAt, hexPath, layoutFor, type HexLayout } from './hexview';
import { t } from './i18n';
import type { Anim, GameDef, RuleEntry } from './shell';

// 論理サイズ。描画はすべてこの座標で書く（実際の大きさは kit/scale が合わせる）
const VIEW = { width: 720, height: 720 } as const;
const COLORS = {
  bg: '#0a111b', cell: '#16243a', grid: '#22344f', aim: 'rgba(255,224,130,0.5)',
  wall: '#7d8fa3', wallEdge: '#4a5a6e', wall2: '#dfe7ef', target: '#ff3d3d', targetRing: '#ffffff',
  plate: '#26c6da', plateDark: '#0b3238',
  roller: '#ffd54f', rollerIdle: '#8d7f58', rollerDark: '#2b2410', skin: '#ffe0b2', select: '#ffe082', tire: '#263238',
} as const;

// 画面の言葉では「転師」と言わず、「キャラ」と言う（初めての人には何のことか分からないため）
const HINTS: Record<number, [ja: string, en: string]> = {
  0: ['黄色いキャラがあなた。キャラのまっすぐ先をタップすると、タイヤを転がして的を倒す', 'The yellow character is you. Tap a cell in a straight line from it to roll a tire at a target'],
  1: ['壁は、軽いタイヤ1発で1段削れる。先に壁をどかそう', 'A light tire chips one layer off a wall. Clear the wall first'],
  2: ['重いタイヤは的を貫いて進む。壁は、何段あっても1発で壊す', 'A heavy tire rolls straight through targets, and smashes a wall of any thickness in one shot'],
  [PUSH_INTRO_AT]: ['仲間の向こう側（点線の枠）をタップすると、仲間にタイヤが当たり、1マス押されて動く。キャラをタップすると、撃つ人が替わる', 'Tap beyond your partner (the dashed frame) to hit them with a tire and push them one cell. Tap a character to switch who fires'],
  [PLATE_INTRO_AT]: ['水色の板に当たると、矢印の向きへ曲がる。当たるたびに板の向きが入れ替わる', 'A tire turns at a cyan plate, following its arrow. The plate flips each time it is hit'],
};

// ルールブックの動く絵に使う、小さな盤。ステージとは別に作る（ステージの答えを、先に見せないため）
const DEMOS = {
  basic: { radius: 2, rollers: [[-1, 0]], targets: [[1, 0], [-1, 2]], walls: [], heavy: 0, par: 2 },
  wall: { radius: 2, rollers: [[-2, 1]], targets: [[1, 1]], walls: [[0, 1, 2]], heavy: 0, par: 3 },
  heavy: { radius: 2, rollers: [[-2, 0]], targets: [[-1, 0], [1, 0]], walls: [[2, 0, 2]], heavy: 1, par: 1 },
  push: { radius: 2, rollers: [[0, 2], [0, 0]], targets: [[2, -1]], walls: [], heavy: 0, par: 2 },
  plate: { radius: 2, rollers: [[2, -1]], targets: [[0, -2], [-2, 1]], walls: [], plates: [[0, -1, -1]], heavy: 0, par: 2 },
} satisfies Record<string, Level>;

// ルールブック。from 番目のステージまで進むと読めるようになる。
// scope が 'general' の項目は「ゲーム全体のルール」、ほかは「ステージのルール」に入る
const RULES: RuleEntry[] = [
  {
    from: 0,
    title: t('タイヤを転がす', 'Rolling a tire'),
    text: t(
      '黄色いキャラがあなた。点線の先をタップすると、タイヤを転がして的を倒す。赤い的を全部倒すとクリア。',
      'The yellow character is you. Tap along a dotted line to roll a tire and knock down a target. Knock down every red target to clear the stage.',
    ),
    demo: demoOf(DEMOS.basic),
  },
  {
    from: 1,
    title: t('壁', 'Walls'),
    text: t(
      'タイヤは壁で止まる。軽いタイヤは、1発で壁を1段削る。中に明るい六角形がある壁は2段。',
      'A tire stops at a wall. A light tire chips off one layer per shot. A wall with a bright hexagon inside has two layers.',
    ),
    demo: demoOf(DEMOS.wall),
  },
  {
    from: 2,
    title: t('重いタイヤ', 'Heavy tires'),
    text: t(
      '下のボタンで選ぶ。的を貫いて進み、壁は何段あっても1発で壊す（壁では止まる）。',
      'Pick it with the button below. It rolls straight through targets and smashes a wall of any thickness in one shot (and stops there).',
    ),
    demo: demoOf(DEMOS.heavy),
  },
  {
    from: PUSH_INTRO_AT,
    title: t('仲間を押す', 'Pushing a partner'),
    text: t(
      '仲間の向こう側（点線の枠）をタップすると、タイヤが当たって、仲間が1マス動く。先がふさがっていると動かない。キャラをタップすると、撃つ人が替わる。',
      'Tap beyond your partner (the dashed frame) to hit them with a tire and push them one cell. They do not move if that cell is blocked. Tap a character to switch who fires.',
    ),
    demo: demoOf(DEMOS.push),
  },
  {
    from: PLATE_INTRO_AT,
    title: t('向きを変える板', 'Turning plates'),
    text: t(
      '水色の板に当たったタイヤは、矢印の向きへ曲がる。当たるたびに、矢印が逆向きになる。',
      'A tire that hits a cyan plate turns the way its arrow points. The arrow flips each time the plate is hit.',
    ),
    demo: demoOf(DEMOS.plate),
  },
  {
    from: 0,
    scope: 'general',
    title: t('星', 'Stars'),
    text: t(
      '右上の「★3 は ○ 発」が、一番少ない発射数。その数でクリアすると ★3、1発多いと ★2。',
      'The ★3 number at the top is the fewest shots possible. Clear in that many for ★3; one more gives ★2.',
    ),
  },
  {
    from: 0,
    scope: 'general',
    title: t('タイヤの数と失敗', 'Tires and failing'),
    text: t(
      '下のボタンの数が、持っているタイヤ。使い切っても的が残ると失敗。当てられる物が無くなった時も失敗。',
      'The buttons below show how many tires you have. If you use them all and a target is still standing, you fail. You also fail when nothing can be hit any more.',
    ),
  },
  {
    from: 0,
    scope: 'general',
    title: t('ステージ', 'Stages'),
    text: t('クリアした一番先のステージの、2つ先まで遊べる。', 'You can play up to two stages past the furthest one you have cleared.'),
  },
  {
    from: 0,
    scope: 'general',
    title: t('上のボタン', 'Buttons at the top'),
    text: t(
      '☰ ステージ選択　↶ 1手戻す　↻ 最初からやり直す　？ ルール　🔊 音',
      '☰ stages   ↶ undo one shot   ↻ restart   ？ rules   🔊 sound',
    ),
  },
  {
    from: 0,
    scope: 'general',
    title: t('詰まった時', 'When you are stuck'),
    text: t(
      '同じステージで 2 回失敗すると、下に「ヒント」が出る。次の1手を白い線で教える。何度でも使える。4 回失敗すると「飛ばす」が出る。集めた星を 3 つ払って、次のステージへ進む。',
      'Fail a stage twice and a Hint button appears below. It shows the next shot as a white line, as often as you like. Fail four times and a Skip button appears: pay 3 of your stars to move on.',
    ),
  },
];

let levelIndex = 0;
/** 見せているヒント。その盤面のままの間だけ見せる（撃つ・戻す・やり直すで盤面が替わると消える） */
let hint: { state: State; shot: Shot } | null = null;
let selected = 0;
let kind: TireKind = 'light';

const layoutOf = (state: State): HexLayout => layoutFor(state.radius, { x: 0, y: 0, ...VIEW });

function drawBoard(ctx: CanvasRenderingContext2D, layout: HexLayout, state: State): void {
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, VIEW.width, VIEW.height);
  for (const [q, r] of boardCells(state.radius)) {
    const { x, y } = centerOf(layout, [q, r]);
    hexPath(ctx, x, y, layout.size, 0.96);
    // マスは1色にする（2色に塗り分けると、壁や狙いの線と見分けにくい）
    ctx.fillStyle = COLORS.cell;
    ctx.fill();
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

/** 選んでいる転師が、今のタイヤで dir の向きに撃った時の結果。タイヤが通るマスは、盤の中の分だけ返す */
function aimOf(state: State, dir: number): { shot: ShotResult; cells: Hex[] } | null {
  const shot = fire(state, { roller: selected, dir, kind });
  if (!shot) return null;
  return { shot, cells: shot.path.filter(([q, r]) => inBoard(q, r, state.radius)) };
}

/**
 * 選んでいるキャラから撃って、何かが起きる線だけを見せる（何も起きない向きは描かない。線が多いと見づらいため）。
 * 線は、今選んでいるタイヤが通る道に沿って、止まる所まで引く。当たる物には輪を付ける。
 */
function drawAim(ctx: CanvasRenderingContext2D, layout: HexLayout, state: State): void {
  const from = state.rollers[selected];
  if (from === undefined) return;
  const start = centerOf(layout, hexOf(from));
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = COLORS.aim;
  for (let dir = 0; dir < DIRS.length; dir++) {
    const aim = aimOf(state, dir);
    if (!aim || !aim.shot.changed || aim.cells.length === 0) continue;
    const { shot, cells } = aim;
    ctx.lineWidth = 3;
    ctx.setLineDash([2, 9]);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    for (const cell of cells) {
      const { x, y } = centerOf(layout, cell);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    // 当たる物（最後に止まる壁か仲間と、倒れる的）に輪を付ける
    const marks = shot.hitAt.map((k) => shot.path[k]);
    if (shot.end === 'wall' || shot.end === 'roller') marks.push(cells[cells.length - 1]);
    for (const cell of marks) {
      const { x, y } = centerOf(layout, cell);
      hexPath(ctx, x, y, layout.size, 0.9);
      ctx.lineWidth = 4;
      ctx.stroke();
    }
    // 仲間が押される時は、動く先のマスを点線の枠で見せる
    if (shot.pushed >= 0) {
      const { x, y } = centerOf(layout, hexOf(shot.state.rollers[shot.pushed]));
      hexPath(ctx, x, y, layout.size, 0.7);
      ctx.lineWidth = 3;
      ctx.setLineDash([6, 8]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}

/** ヒントの1手。撃つキャラからタイヤの通る道を、太い白い線で見せる */
function drawHint(ctx: CanvasRenderingContext2D, layout: HexLayout, state: State, shot: Shot): void {
  const result = fire(state, shot);
  if (!result) return;
  const cells = result.path.filter(([q, r]) => inBoard(q, r, state.radius));
  const start = centerOf(layout, hexOf(state.rollers[shot.roller]));
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  for (const cell of cells) {
    const { x, y } = centerOf(layout, cell);
    ctx.lineTo(x, y);
  }
  ctx.stroke();
  hexPath(ctx, start.x, start.y, layout.size, 1);
  ctx.lineWidth = 6;
  ctx.stroke();
  // 最後のマスに矢じり
  const last = cells[cells.length - 1];
  const before = cells.length > 1 ? centerOf(layout, cells[cells.length - 2]) : start;
  if (last) {
    const end = centerOf(layout, last);
    const angle = Math.atan2(end.y - before.y, end.x - before.x);
    const head = layout.size * 0.42;
    ctx.beginPath();
    ctx.moveTo(end.x + Math.cos(angle) * head * 0.6, end.y + Math.sin(angle) * head * 0.6);
    ctx.lineTo(end.x + Math.cos(angle + 2.5) * head, end.y + Math.sin(angle + 2.5) * head);
    ctx.lineTo(end.x + Math.cos(angle - 2.5) * head, end.y + Math.sin(angle - 2.5) * head);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  }
}

/** 向きを変える板。丸い矢印が、曲げる向き（左回りか右回りか）を表す */
function drawPlate(ctx: CanvasRenderingContext2D, layout: HexLayout, cell: Hex, turn: number): void {
  const { x, y } = centerOf(layout, cell);
  const size = layout.size;
  hexPath(ctx, x, y, size, 0.84);
  ctx.fillStyle = COLORS.plateDark;
  ctx.fill();
  ctx.strokeStyle = COLORS.plate;
  ctx.lineWidth = 4;
  ctx.stroke();
  // 画面では、左へ曲げる（turn = 1）が左回り
  const ccw = turn > 0;
  const radius = size * 0.36;
  const a0 = -Math.PI * 0.5, sweep = Math.PI * 1.4;
  const a1 = ccw ? a0 - sweep : a0 + sweep;
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(4, size * 0.11);
  ctx.beginPath();
  ctx.arc(x, y, radius, a0, a1, ccw);
  ctx.stroke();
  // 矢じり。弧の終わりで、進む向きを指す
  const tx = x + Math.cos(a1) * radius, ty = y + Math.sin(a1) * radius;
  const heading = a1 + (ccw ? -Math.PI / 2 : Math.PI / 2);
  const head = size * 0.24;
  ctx.beginPath();
  ctx.moveTo(tx + Math.cos(heading) * head, ty + Math.sin(heading) * head);
  ctx.lineTo(tx + Math.cos(heading + 2.3) * head, ty + Math.sin(heading + 2.3) * head);
  ctx.lineTo(tx + Math.cos(heading - 2.3) * head, ty + Math.sin(heading - 2.3) * head);
  ctx.closePath();
  ctx.fillStyle = COLORS.plate;
  ctx.fill();
}

function drawWall(ctx: CanvasRenderingContext2D, layout: HexLayout, cell: Hex, stage: number): void {
  const { x, y } = centerOf(layout, cell);
  hexPath(ctx, x, y, layout.size, 0.84);
  ctx.fillStyle = COLORS.wall;
  ctx.fill();
  ctx.strokeStyle = COLORS.wallEdge;
  ctx.lineWidth = 4;
  ctx.stroke();
  if (stage >= 2) {
    hexPath(ctx, x, y, layout.size, 0.52);
    ctx.fillStyle = COLORS.wall2;
    ctx.fill();
  }
}

function drawTarget(ctx: CanvasRenderingContext2D, layout: HexLayout, cell: Hex): void {
  const { x, y } = centerOf(layout, cell);
  // 白いふちを付けて、暗い盤の上でも一目で見つかるようにする
  [0.66, 0.56, 0.36, 0.17].forEach((scale, i) => {
    ctx.beginPath();
    ctx.arc(x, y, layout.size * scale, 0, Math.PI * 2);
    ctx.fillStyle = i % 2 === 0 ? COLORS.targetRing : COLORS.target;
    ctx.fill();
  });
}

/**
 * 操作するキャラ。帽子をかぶった人が、タイヤを抱えている絵で描く（的・壁・板とは形で見分けられる）。
 * 選んでいるキャラは明るい色で、足もとに光る台が付く。選んでいないキャラは色を落とす。
 */
function drawRoller(ctx: CanvasRenderingContext2D, layout: HexLayout, cell: Hex, active: boolean): void {
  const { x, y } = centerOf(layout, cell);
  const u = layout.size;
  const body = active ? COLORS.roller : COLORS.rollerIdle;
  if (active) {
    hexPath(ctx, x, y, u, 0.92);
    ctx.fillStyle = 'rgba(255,213,79,0.22)';
    ctx.fill();
    ctx.strokeStyle = COLORS.select;
    ctx.lineWidth = 4;
    ctx.stroke();
  }
  ctx.lineJoin = 'round';
  ctx.strokeStyle = COLORS.rollerDark;
  ctx.lineWidth = 3;
  // 体
  ctx.beginPath();
  ctx.moveTo(x - u * 0.36, y + u * 0.56);
  ctx.quadraticCurveTo(x - u * 0.4, y - u * 0.02, x, y - u * 0.04);
  ctx.quadraticCurveTo(x + u * 0.4, y - u * 0.02, x + u * 0.36, y + u * 0.56);
  ctx.closePath();
  ctx.fillStyle = body;
  ctx.fill();
  ctx.stroke();
  // 頭
  ctx.beginPath();
  ctx.arc(x, y - u * 0.28, u * 0.24, 0, Math.PI * 2);
  ctx.fillStyle = active ? COLORS.skin : '#b8a58a';
  ctx.fill();
  ctx.stroke();
  // 帽子
  ctx.beginPath();
  ctx.arc(x, y - u * 0.32, u * 0.25, Math.PI, 0);
  ctx.lineTo(x + u * 0.36, y - u * 0.32);
  ctx.lineTo(x - u * 0.25, y - u * 0.32);
  ctx.closePath();
  ctx.fillStyle = body;
  ctx.fill();
  ctx.stroke();
  // 抱えているタイヤ
  ctx.beginPath();
  ctx.arc(x, y + u * 0.3, u * 0.2, 0, Math.PI * 2);
  ctx.fillStyle = COLORS.tire;
  ctx.fill();
  ctx.strokeStyle = active ? '#ffffff' : '#9aa7b3';
  ctx.lineWidth = 3;
  ctx.stroke();
}

function drawTire(ctx: CanvasRenderingContext2D, layout: HexLayout, x: number, y: number, heavy: boolean): void {
  ctx.beginPath();
  ctx.arc(x, y, layout.size * (heavy ? 0.46 : 0.34), 0, Math.PI * 2);
  ctx.fillStyle = COLORS.tire;
  ctx.fill();
  ctx.strokeStyle = heavy ? COLORS.select : COLORS.roller;
  ctx.lineWidth = heavy ? 8 : 5;
  ctx.stroke();
}

function draw(ctx: CanvasRenderingContext2D, state: State, anim: Anim<State, ShotResult> | null): void {
  // 動きを見せている間は、撃つ前の盤の上でタイヤを動かす
  const shown = anim ? anim.from : state;
  const layout = layoutOf(shown);
  drawBoard(ctx, layout, shown);

  const path = anim?.events.path ?? [];
  const progress = anim ? anim.t * path.length : 0;
  const passed = new Set((anim?.events.hitAt ?? []).filter((i) => progress >= i + 0.5).map((i) => keyOf(...path[i])));

  for (const [key, stage] of Object.entries(shown.walls)) drawWall(ctx, layout, hexOf(key), stage);
  for (const [key, turn] of Object.entries(shown.plates)) drawPlate(ctx, layout, hexOf(key), turn);
  for (const key of shown.targets) if (!passed.has(key)) drawTarget(ctx, layout, hexOf(key));
  if (!anim && state.status === 'playing') drawAim(ctx, layout, shown);
  shown.rollers.forEach((key, i) => drawRoller(ctx, layout, hexOf(key), i === selected && shown.status === 'playing'));
  if (!anim && hint && hint.state === state) drawHint(ctx, layout, state, hint.shot);

  if (anim) {
    const from = hexOf(shown.rollers[selected]);
    const index = Math.min(path.length - 1, Math.floor(progress));
    const a = centerOf(layout, index === 0 ? from : path[index - 1]);
    const b = centerOf(layout, path[index]);
    const f = Math.min(1, progress - index);
    drawTire(ctx, layout, a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, kindShown === 'heavy');
  }
}

/** 動きを見せている間のタイヤの種類（撃った後に選択が切り替わることがあるので、別に持つ） */
let kindShown: TireKind = 'light';

/** タップする所の印。白い点と、広がる輪 */
function drawTap(ctx: CanvasRenderingContext2D, layout: HexLayout, cell: Hex, ms: number): void {
  const { x, y } = centerOf(layout, cell);
  const pulse = (ms % 600) / 600;
  ctx.beginPath();
  ctx.arc(x, y, layout.size * 0.2, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, layout.size * (0.25 + 0.45 * pulse), 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(255,255,255,${1 - pulse})`;
  ctx.lineWidth = 8;
  ctx.stroke();
}

/**
 * ルールブックの動く絵。小さな盤を、一番少ない撃ち方の通りに撃って見せ、終わったら最初から繰り返す。
 * 遊ぶ時と同じ draw で描くので、見た目はステージと同じになる。
 */
function demoOf(level: Level): (ctx: CanvasRenderingContext2D, ms: number) => void {
  // 場面を順に並べたもの。1つの場面は「何 ms の間、どう描くか」
  let scenes: { ms: number; paint(ctx: CanvasRenderingContext2D, at: number): void }[] | null = null;
  const paint = (ctx: CanvasRenderingContext2D, state: State, anim: Anim<State, ShotResult> | null, who: number, tire: TireKind): void => {
    // draw は、今選んでいるキャラとタイヤを見て描く。遊んでいる途中の選択を壊さないように、描いたら戻す
    const keep = { selected, kind, kindShown, hint };
    selected = who;
    kind = tire;
    kindShown = tire;
    hint = null;
    draw(ctx, state, anim);
    ({ selected, kind, kindShown, hint } = keep);
    if (level.heavy === 0) return;
    // どちらのタイヤを選んでいるかを、下に書く
    ctx.font = '700 40px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = tire === 'heavy' ? COLORS.select : '#cfd8dc';
    ctx.fillText(tire === 'heavy' ? t('重いタイヤ', 'Heavy tire') : t('軽いタイヤ', 'Light tire'), VIEW.width / 2, VIEW.height - 40);
  };
  const build = () => {
    const list: NonNullable<typeof scenes> = [];
    let state = createState(level);
    let who = 0;
    for (const shot of solveFrom(state, state.limit)?.shots ?? []) {
      const before = state;
      const result = fire(before, shot);
      if (!result) break;
      const layout = layoutOf(before);
      if (shot.roller !== who) {
        // 撃つ人を替える所。替える先のキャラをタップする
        const from = who;
        list.push({ ms: 900, paint: (ctx, at) => { paint(ctx, before, null, from, shot.kind); drawTap(ctx, layout, hexOf(before.rollers[shot.roller]), at); } });
        who = shot.roller;
      }
      // 狙う所。押す時は仲間の向こう側、ほかはタイヤが最後に通るマスをタップする
      const inside = result.path.filter(([q, r]) => inBoard(q, r, before.radius));
      const tapAt = result.pushed >= 0 ? hexOf(result.state.rollers[result.pushed]) : inside[inside.length - 1];
      list.push({ ms: 1300, paint: (ctx, at) => { paint(ctx, before, null, shot.roller, shot.kind); if (tapAt && at > 600) drawTap(ctx, layout, tapAt, at); } });
      const roll = 110 * result.path.length + 150;
      list.push({ ms: roll, paint: (ctx, at) => paint(ctx, result.state, { from: before, events: result, t: at / roll }, shot.roller, shot.kind) });
      state = result.state;
    }
    const last = state, lastWho = who;
    list.push({ ms: 1500, paint: (ctx) => paint(ctx, last, null, lastWho, 'light') });
    return list;
  };
  return (ctx, ms) => {
    scenes ??= build();
    let at = ms % scenes.reduce((sum, scene) => sum + scene.ms, 0);
    for (const scene of scenes) {
      if (at < scene.ms) return scene.paint(ctx, at);
      at -= scene.ms;
    }
  };
}

/** まだタイヤは残っているが、どう撃っても盤が変わらない（当てられる物が無い）。この先は倒しきれないので、失敗にする */
const stuckOf = new WeakMap<State, boolean>();
function stuck(state: State): boolean {
  if (state.status !== 'playing') return false;
  let known = stuckOf.get(state);
  if (known === undefined) {
    const tires: TireKind[] = ['light', 'heavy'];
    known = !state.rollers.some((_, roller) => DIRS.some((_, dir) => tires.some((tire) => fire(state, { roller, dir, kind: tire })?.changed)));
    stuckOf.set(state, known);
  }
  return known;
}

export const game: GameDef<State, ShotResult> = {
  // ステージの並びを変えたら番号を上げる（前の並びの星が、別のステージに付いてしまうため）
  saveKey: 'roller-break.v3',
  title: 'ROLLER BREAK',
  howto: t('黄色いキャラを操作して、タイヤを転がし、的を全部倒そう。少ない発射数で倒すほど星が増える。', 'Guide the yellow characters, roll tires, and knock down every target. Fewer shots earn more stars.'),
  view: VIEW,
  levelCount: LEVELS.length,
  rules: RULES,
  undoable: true,
  showHint(state) {
    const best = solveFrom(state, state.limit - state.shots);
    if (!best || best.shots.length === 0) {
      hint = null;
      return t('ここからは倒しきれない。↶ で戻すか、↻ でやり直そう', 'It cannot be cleared from here. Undo with ↶ or restart with ↻');
    }
    const shot = best.shots[0];
    hint = { state, shot };
    // その手を撃てるように、キャラとタイヤを選んでおく
    selected = shot.roller;
    kind = shot.kind;
    return shot.kind === 'heavy'
      ? t('白い線の通りに、重いタイヤで撃つ（線の先のマスをタップ）', 'Fire a HEAVY tire along the white line (tap a cell on it)')
      : t('白い線の通りに、軽いタイヤで撃つ（線の先のマスをタップ）', 'Fire a light tire along the white line (tap a cell on it)');
  },

  start(level) {
    levelIndex = level;
    hint = null;
    selected = 0;
    kind = 'light';
    return createState(LEVELS[level]);
  },
  status: (state) => (stuck(state) ? 'failed' : state.status),
  stars: starsOf,
  counter: (state) => {
    return t(`★3 は ${state.par} 発`, `★3: ${state.par} shots`);
  },
  hint: (level) => {
    const hint = HINTS[level];
    return hint ? t(...hint) : '';
  },
  failText: (state) => (state.status === 'failed' ? t('タイヤを使い切りました', 'Out of tires') : t('当てられる物が、もうありません', 'Nothing left that a tire can hit')),

  buttons(state) {
    // 持っているタイヤの数を、ボタンに書く。軽いタイヤと重いタイヤを合わせた数が、あと撃てる数
    const light = lightLeft(state);
    const lightButton = { id: 'light', label: t(`軽いタイヤ ×${light}`, `Light tire ×${light}`), selected: kind === 'light', disabled: light === 0 };
    if (LEVELS[levelIndex].heavy === 0) return [lightButton];
    const heavy = state.heavyLeft;
    return [lightButton, { id: 'heavy', label: t(`重いタイヤ ×${heavy}`, `Heavy tire ×${heavy}`), selected: kind === 'heavy', disabled: heavy === 0 }];
  },
  press(state, id) {
    kind = (id === 'heavy' && state.heavyLeft > 0) || lightLeft(state) === 0 ? 'heavy' : 'light';
    return { state, sound: 'tap' };
  },

  tap(state, x, y) {
    const cell = hexAt(layoutOf(state), x, y);
    if (!inBoard(cell[0], cell[1], state.radius)) return null;
    const roller = state.rollers.indexOf(keyOf(cell[0], cell[1]));
    if (roller >= 0) {
      selected = roller;
      return { state, sound: 'tap' };
    }
    // まっすぐ先のマスのほか、板で曲がった先のマスをタップしても、その線で撃つ
    let dir = dirTo(hexOf(state.rollers[selected]), cell);
    if (dir < 0) dir = DIRS.findIndex((_, d) => aimOf(state, d)?.cells.some(([q, r]) => q === cell[0] && r === cell[1]));
    if (dir < 0) return null;
    const result = fire(state, { roller: selected, dir, kind });
    if (!result) return null;
    kindShown = kind;
    // 撃った種類のタイヤが無くなったら、残っている方に切り替える
    if (result.state.heavyLeft === 0) kind = 'light';
    else if (lightLeft(result.state) === 0) kind = 'heavy';
    return { state: result.state, events: result, ms: 70 * result.path.length + 120, sound: result.changed ? 'hit' : 'miss' };
  },

  draw,
};
