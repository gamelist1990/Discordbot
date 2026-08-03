import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import styles from './OthelloPage.module.css';

type Disc = 'black' | 'white';
type Cell = Disc | null;
type Difficulty = 'easy' | 'normal' | 'hard';

type RankingEntry = {
  userId: string;
  username: string;
  avatar: string | null;
  rating: number;
  wins: number;
  losses: number;
  draws: number;
  games: number;
  position: number;
  tier: {
    key: string;
    label: string;
    color: string;
  };
};

const directions = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1], [0, 1],
  [1, -1], [1, 0], [1, 1],
];

const createBoard = (): Cell[] => {
  const board: Cell[] = Array.from({ length: 64 }, () => null);
  board[27] = 'white';
  board[28] = 'black';
  board[35] = 'black';
  board[36] = 'white';
  return board;
};

const other = (disc: Disc): Disc => disc === 'black' ? 'white' : 'black';

const getFlips = (board: Cell[], index: number, player: Disc): number[] => {
  if (board[index] !== null) return [];
  const row = Math.floor(index / 8);
  const column = index % 8;
  const flips: number[] = [];

  directions.forEach(([dr, dc]) => {
    let r = row + dr;
    let c = column + dc;
    const line: number[] = [];

    while (r >= 0 && r < 8 && c >= 0 && c < 8) {
      const target = r * 8 + c;
      if (board[target] === other(player)) {
        line.push(target);
      } else {
        if (board[target] === player && line.length) flips.push(...line);
        break;
      }
      r += dr;
      c += dc;
    }
  });

  return flips;
};

const OthelloPage: React.FC = () => {
  const { guildId = '' } = useParams();
  const [board, setBoard] = useState<Cell[]>(createBoard);
  const [turn, setTurn] = useState<Disc>('black');
  const [difficulty, setDifficulty] = useState<Difficulty>('normal');
  const [lastMove, setLastMove] = useState<number | null>(null);
  const [ranking, setRanking] = useState<RankingEntry[]>([]);
  const [mode, setMode] = useState<'bot' | 'ranked'>('bot');

  const validMoves = useMemo(
    () => board.map((_, index) => getFlips(board, index, turn).length > 0),
    [board, turn]
  );
  const black = board.filter((cell) => cell === 'black').length;
  const white = board.filter((cell) => cell === 'white').length;

  useEffect(() => {
    if (!guildId) return;
    fetch(`/api/game-rankings/${guildId}/othello/leaderboard?limit=10`, {
      credentials: 'include',
    })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((data) => setRanking(data.leaderboard || []))
      .catch(() => setRanking([]));
  }, [guildId]);

  const reset = () => {
    setBoard(createBoard());
    setTurn('black');
    setLastMove(null);
  };

  const play = (index: number) => {
    const flips = getFlips(board, index, turn);
    if (!flips.length) return;

    const next = board.slice();
    next[index] = turn;
    flips.forEach((flip) => { next[flip] = turn; });
    setBoard(next);
    setTurn(other(turn));
    setLastMove(index);
  };

  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <div>
          <span className={styles.eyebrow}>CORE PANEL GAME</span>
          <h1>オセロ アリーナ</h1>
          <p>番号付き盤面で迷わず対戦。Bot戦で練習し、ランクマッチでレーティングを競えます。</p>
        </div>
        <div className={styles.score}>
          <div><span className={`${styles.disc} ${styles.black}`} /><strong>{black}</strong></div>
          <div><span className={`${styles.disc} ${styles.white}`} /><strong>{white}</strong></div>
        </div>
      </header>

      <main className={styles.grid}>
        <section className={styles.gameCard}>
          <div className={styles.controls}>
            <div className={styles.segmented}>
              <button className={mode === 'bot' ? styles.active : ''} onClick={() => setMode('bot')}>Bot戦</button>
              <button className={mode === 'ranked' ? styles.active : ''} onClick={() => setMode('ranked')}>ランクマッチ</button>
            </div>
            {mode === 'bot' ? (
              <select value={difficulty} onChange={(event) => setDifficulty(event.target.value as Difficulty)}>
                <option value="easy">Easy</option>
                <option value="normal">Normal</option>
                <option value="hard">Hard</option>
              </select>
            ) : (
              <span className={styles.searching}>人間 vs 人間 マッチング</span>
            )}
            <button className={styles.resetButton} onClick={reset}>最初から</button>
          </div>

          <div className={styles.turnBanner}>
            <span className={`${styles.disc} ${turn === 'black' ? styles.black : styles.white}`} />
            {turn === 'black' ? '黒' : '白'}のターン
          </div>

          <div className={styles.board} role="grid" aria-label="番号付きオセロ盤">
            {board.map((cell, index) => (
              <button
                key={index}
                type="button"
                className={`${styles.cell} ${validMoves[index] ? styles.available : ''} ${lastMove === index ? styles.lastMove : ''}`}
                onClick={() => play(index)}
                disabled={!validMoves[index]}
                aria-label={`${index + 1}番${cell ? ` ${cell}` : ''}`}
              >
                <span className={styles.cellNumber}>{index + 1}</span>
                {cell ? <span className={`${styles.piece} ${cell === 'black' ? styles.black : styles.white}`} /> : null}
              </button>
            ))}
          </div>
          <p className={styles.boardHint}>薄く光る番号が現在置ける場所です。Discord 側でも同じ番号のボタンを選択します。</p>
        </section>

        <aside className={styles.side}>
          <section className={styles.panel}>
            <span className={styles.eyebrow}>OTHELLO RANK</span>
            <h2>トッププレイヤー</h2>
            <div className={styles.rankList}>
              {ranking.length ? ranking.map((entry) => (
                <div className={styles.rankRow} key={entry.userId}>
                  <strong className={styles.position}>{entry.position}</strong>
                  {entry.avatar
                    ? <img src={entry.avatar} alt="" />
                    : <span className={styles.avatarFallback}>{entry.username.slice(0, 1)}</span>}
                  <div>
                    <strong>{entry.username}</strong>
                    <span style={{ color: entry.tier.color }}>{entry.tier.label} · {entry.rating}</span>
                  </div>
                  <small>{entry.wins}勝</small>
                </div>
              )) : <p className={styles.empty}>最初のランク戦結果を待っています。</p>}
            </div>
          </section>

          <section className={styles.panel}>
            <h2>ルール</h2>
            <ul>
              <li>Bot戦: Easy / Normal / Hard</li>
              <li>ランク戦: 人間 vs 人間のみ</li>
              <li>勝敗は汎用ゲームランキングAPIへ記録</li>
              <li>Discordの盤面は画像と移動アニメーションで更新</li>
            </ul>
          </section>
        </aside>
      </main>
    </div>
  );
};

export default OthelloPage;