// 入口。外枠（ui/shell）に、このゲームの中身（ui/game）を渡して始める。
import './ui/style.css';
import { game, rollerImageReady } from './ui/game';
import { runGame } from './ui/shell';

// キャラの絵を読み込んでから始める（最初の盤から絵で描くため）
void rollerImageReady.then(() => runGame(game));
