"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
);

const PLAYER_NAMES = ["Courtney", "Chris", "Mags", "Alex"];

export default function Home() {
  const [screen, setScreen] = useState("home");
  const [room, setRoom] = useState(null);
  const [players, setPlayers] = useState([]);
  const [rounds, setRounds] = useState([]);
  const [answers, setAnswers] = useState([]);
  const [gameRound, setGameRound] = useState(null);
  const [name, setName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [me, setMe] = useState(null);

  const [selectedAnswer, setSelectedAnswer] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [revealedAnswer, setRevealedAnswer] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

const currentRound = gameRound;
useEffect(() => {
  async function loadGameRound() {
    if (!room || room.current_round < 1) {
      setGameRound(null);
      return;
    }

    const { data, error } = await supabase.rpc("get_game_round", {
      p_room_id: room.id,
      p_round_number: room.current_round,
    });

    if (error) {
      console.error("ROUND LOAD ERROR:", error);
      return;
    }

    setGameRound(Array.isArray(data) ? data[0] : data);
  }

  loadGameRound();
}, [room?.id, room?.current_round]);
  const roundAnswers = useMemo(() => {
    if (!room) return [];
    return answers.filter(
      (a) =>
        a.room_id === room.id &&
        a.round_number === room.current_round
    );
  }, [answers, room]);

  const everyoneAnswered =
    players.length > 0 && roundAnswers.length >= players.length;

  useEffect(() => {
    loadRounds();
  }, []);

  async function loadRounds() {
    const { data, error } = await supabase
      .from("rounds")
      .select("*")
      .order("round_number");

    if (error) {
      console.error(error);
      return;
    }

    setRounds(data || []);
  }

  function makeCode() {
    return String(Math.floor(1000 + Math.random() * 9000));
  }

  async function createRoom() {
    setLoading(true);
    setMessage("");

    try {
      let createdRoom = null;

      for (let attempt = 0; attempt < 5; attempt++) {
        const code = makeCode();

        const { data, error } = await supabase
          .from("rooms")
          .insert({
            code,
            status: "lobby",
            current_round: 0,
          })
          .select()
          .single();

        if (!error) {
          createdRoom = data;
          break;
        }
      }

      if (!createdRoom) {
        throw new Error("Couldn't create a room. Try again.");
      }

      const { data: player, error: playerError } = await supabase
        .from("players")
        .insert({
          room_id: createdRoom.id,
          name: "Courtney",
          is_host: true,
        })
        .select()
        .single();

      if (playerError) throw playerError;

      // Build a fresh secret 10-round game for this room
const { error: buildGameError } = await supabase.rpc("build_game", {
  p_room_id: createdRoom.id,
});

if (buildGameError) {
  console.error("BUILD GAME ERROR:", buildGameError);
  throw new Error("Couldn't generate the game rounds.");
}

      setRoom(createdRoom);
      setMe(player);
      setName("Courtney");
      setPlayers([player]);
      setRoomCode(createdRoom.code);
      setScreen("lobby");

      subscribeToRoom(createdRoom.id);
    } catch (err) {
      console.error(err);
      setMessage(err.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  async function joinRoom() {
    setLoading(true);
    setMessage("");

    try {
      const cleanName = name.trim();
      const cleanCode = roomCode.trim();

      if (!cleanName) throw new Error("Choose your name.");
      if (!cleanCode) throw new Error("Enter the room code.");

      const { data: foundRoom, error: roomError } = await supabase
        .from("rooms")
        .select("*")
        .eq("code", cleanCode)
        .single();

      if (roomError || !foundRoom) {
        throw new Error("That room doesn't exist.");
      }

      if (foundRoom.status !== "lobby") {
        throw new Error("That game has already started.");
      }

      const { data: existing } = await supabase
        .from("players")
        .select("*")
        .eq("room_id", foundRoom.id)
        .eq("name", cleanName)
        .maybeSingle();

      let player = existing;

      if (!player) {
        const { data, error } = await supabase
          .from("players")
          .insert({
            room_id: foundRoom.id,
            name: cleanName,
            is_host: false,
          })
          .select()
          .single();

        if (error) throw error;
        player = data;
      }

      setRoom(foundRoom);
      setMe(player);
      setScreen("lobby");

      await refreshGame(foundRoom.id);
      subscribeToRoom(foundRoom.id);
    } catch (err) {
      console.error(err);
      setMessage(err.message || "Couldn't join the room.");
    } finally {
      setLoading(false);
    }
  }

  async function refreshGame(roomId) {
    const [
      { data: latestRoom },
      { data: latestPlayers },
      { data: latestAnswers },
    ] = await Promise.all([
      supabase.from("rooms").select("*").eq("id", roomId).single(),
      supabase
        .from("players")
        .select("*")
        .eq("room_id", roomId)
        .order("joined_at"),
      supabase.from("answers").select("*").eq("room_id", roomId),
    ]);

    if (latestRoom) {
      setRoom(latestRoom);

      if (latestRoom.status === "playing") {
        setScreen("game");
      }

      if (latestRoom.status === "finished") {
        setScreen("results");
      }
    }

    setPlayers(latestPlayers || []);
    setAnswers(latestAnswers || []);
  }

  function subscribeToRoom(roomId) {
    supabase
      .channel(`game-${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "rooms",
          filter: `id=eq.${roomId}`,
        },
        () => refreshGame(roomId)
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "players",
          filter: `room_id=eq.${roomId}`,
        },
        () => refreshGame(roomId)
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "answers",
          filter: `room_id=eq.${roomId}`,
        },
        () => refreshGame(roomId)
      )
      .subscribe();
  }

  async function startGame() {
    if (!room || !me?.is_host) return;

    if (players.length < 2) {
      setMessage("We need at least 2 players before starting.");
      return;
    }

    setMessage("");
    setSelectedAnswer("");
    setRevealed(false);

    const { error } = await supabase
      .from("rooms")
      .update({
        status: "playing",
        current_round: 1,
      })
      .eq("id", room.id);

    if (error) {
      setMessage(error.message);
      return;
    }

    await refreshGame(room.id);
    setScreen("game");
  }

async function submitAnswer(answer) {
  if (!room || !me || !currentRound) return;

  const alreadyAnswered = roundAnswers.some(
    (a) => a.player_id === me.id
  );

  if (alreadyAnswered) return;

  setSelectedAnswer(answer);

  const { error } = await supabase.from("answers").insert({
    room_id: room.id,
    player_id: me.id,
    round_number: currentRound.round_number,
    answer,
    is_correct: false,
    points_awarded: 0,
  });

  if (error) {
    console.error(error);
    setMessage(error.message);
    return;
  }

  await refreshGame(room.id);
}

async function revealAnswer() {
  if (!everyoneAnswered || !me?.is_host || !room || !currentRound) return;

  const { data: correctAnswer, error } = await supabase.rpc(
    "reveal_and_score_round",
    {
      p_room_id: room.id,
      p_round_number: currentRound.round_number,
    }
  );

  if (error) {
    console.error("REVEAL ERROR:", error);
    setMessage(error.message);
    return;
  }

  if (!correctAnswer) {
    setMessage("Waiting for everyone to answer...");
    return;
  }
setRevealedAnswer(correctAnswer);
  setRevealed(true);
  await refreshGame(room.id);
}

  async function nextRound() {
    if (!me?.is_host || !room) return;

    if (room.current_round >= 10) {
      await supabase
        .from("rooms")
        .update({ status: "finished" })
        .eq("id", room.id);

      await refreshGame(room.id);
      setScreen("results");
      return;
    }

    setSelectedAnswer("");
    setRevealed(false);
setRevealedAnswer("");
    await supabase
      .from("rooms")
      .update({
        current_round: room.current_round + 1,
      })
      .eq("id", room.id);

    await refreshGame(room.id);
  }

  function answerForPlayer(playerId) {
    return roundAnswers.find((a) => a.player_id === playerId);
  }

  function resetLocalGame() {
    window.location.reload();
  }

  if (screen === "home") {
    return (
      <main className="shell">
        <section className="hero">
          <div className="eyebrow">FUN FRIDAY PRESENTS</div>

          <h1>
            <span className="ai">AI</span>
            <span className="or"> OR </span>
            <span className="real">REAL?</span>
          </h1>

          <p className="subtitle">
            Can you tell what actually exists and what a robot completely
            made up?
          </p>

          <div className="home-grid">
            <div className="panel">
              <div className="icon">👑</div>
              <h2>Host the chaos</h2>
              <p>
                Courtney creates the room and controls the rounds.
              </p>

              <button
                className="primary"
                onClick={createRoom}
                disabled={loading}
              >
                {loading ? "CREATING..." : "CREATE GAME"}
              </button>
            </div>

            <div className="panel">
              <div className="icon">🤖</div>
              <h2>Join the game</h2>

              <label>Your name</label>

              <select
                value={name}
                onChange={(e) => setName(e.target.value)}
              >
                <option value="">Choose player...</option>

                {PLAYER_NAMES.map((playerName) => (
                  <option key={playerName} value={playerName}>
                    {playerName}
                  </option>
                ))}
              </select>

              <label>Room code</label>

              <input
                value={roomCode}
                onChange={(e) =>
                  setRoomCode(
                    e.target.value.replace(/\D/g, "").slice(0, 4)
                  )
                }
                placeholder="0000"
                inputMode="numeric"
              />

              <button
                className="secondary"
                onClick={joinRoom}
                disabled={loading}
              >
                JOIN GAME
              </button>
            </div>
          </div>

          {message && <div className="error">{message}</div>}

          <div className="footer-note">
            GOOD IMAGES. BAD DECISIONS. SAME TEAM.
          </div>
        </section>
      </main>
    );
  }

  if (screen === "lobby") {
    return (
      <main className="shell">
        <section className="game-card lobby">
          <div className="eyebrow">THE LOBBY</div>

          <h1>
            ROOM <span className="real">{room?.code}</span>
          </h1>

          <p className="subtitle">
            Send the code to Chris, Mags and Alex.
          </p>

          <div className="player-grid">
            {PLAYER_NAMES.map((playerName) => {
              const joined = players.find(
                (p) => p.name === playerName
              );

              return (
                <div
                  className={`player-card ${joined ? "joined" : ""}`}
                  key={playerName}
                >
                  <div className="avatar">
                    {playerName.charAt(0)}
                  </div>

                  <strong>{playerName}</strong>

                  <span>
                    {joined
                      ? joined.is_host
                        ? "HOST 👑"
                        : "READY ✓"
                      : "WAITING..."}
                  </span>
                </div>
              );
            })}
          </div>

          {me?.is_host ? (
            <button className="primary big" onClick={startGame}>
              START GAME
            </button>
          ) : (
            <div className="waiting">
              Waiting for Courtney to start the chaos...
            </div>
          )}

          {message && <div className="error">{message}</div>}
        </section>
      </main>
    );
  }

  if (screen === "game" && currentRound) {
    const myAnswer = answerForPlayer(me?.id);
    const displayAnswer = myAnswer?.answer || selectedAnswer;

    return (
      <main className="shell">
        <section className="game-card">
          <div className="topbar">
            <div>
              <div className="eyebrow">
                ROUND {currentRound.round_number} OF 10
              </div>

              <h2>{currentRound.title}</h2>
            </div>

            <div className="room-pill">
              ROOM {room.code}
            </div>
          </div>

          <div className="progress">
            {rounds.map((r) => (
              <span
                key={r.round_number}
                className={
                  r.round_number <= room.current_round
                    ? "active"
                    : ""
                }
              />
            ))}
          </div>

          <div className="round-layout">
            <div className="question-panel">
              <div className="category">
                {currentRound.category}
              </div>

              <h3>{currentRound.prompt}</h3>

              {currentRound.media_url ? (
                <img
                  className="round-image"
                  src={currentRound.media_url}
                  alt="AI or Real challenge"
                />
              ) : (
                <div className="media-placeholder">
                  <div>👀</div>
                  <strong>IMAGE COMING NEXT</strong>
                  <span>
                    We'll add the deceptive round images after the
                    multiplayer app is live.
                  </span>
                </div>
              )}

              <div className="answer-buttons">
                <button
                  className={`real-button ${
                    displayAnswer === "REAL" ||
                    displayAnswer === "A"
                      ? "chosen"
                      : ""
                  }`}
                  onClick={() =>
                    submitAnswer(
                      currentRound.round_number === 10
                        ? "A"
                        : "REAL"
                    )
                  }
                  disabled={!!myAnswer}
                >
                  {currentRound.round_number === 10
                    ? "IMAGE A"
                    : "📸 REAL"}
                </button>

                <button
                  className={`ai-button ${
                    displayAnswer === "AI" ||
                    displayAnswer === "B"
                      ? "chosen"
                      : ""
                  }`}
                  onClick={() =>
                    submitAnswer(
                      currentRound.round_number === 10
                        ? "B"
                        : "AI"
                    )
                  }
                  disabled={!!myAnswer}
                >
                  {currentRound.round_number === 10
                    ? "IMAGE B"
                    : "🤖 AI"}
                </button>
              </div>
            </div>

            <aside className="score-panel">
              <h3>LIVE SCOREBOARD</h3>

              {[...players]
                .sort((a, b) => b.score - a.score)
                .map((player) => {
                  const answer = answerForPlayer(player.id);

                  return (
                    <div className="score-row" key={player.id}>
                      <div>
                        <strong>{player.name}</strong>
                        <small>
                          {answer
                            ? revealed
                              ? answer.answer
                              : "LOCKED IN ✓"
                            : "THINKING..."}
                        </small>
                      </div>

                      <b>{player.score}</b>
                    </div>
                  );
                })}

              <div className="answered-count">
                {roundAnswers.length}/{players.length} ANSWERED
              </div>
            </aside>
          </div>

          {revealed && (
            <div className="reveal">
              <div className="reveal-label">
                THE ANSWER IS
              </div>

              <div className="reveal-answer">
                {revealedAnswer === "REAL" ? "📸 REAL" : "🤖 AI"}
              </div>

              <p>{currentRound.explanation}</p>

              <div className="reveal-players">
                {players.map((player) => {
                  const answer = answerForPlayer(player.id);

                  return (
                    <span
                      key={player.id}
                      className={
                        answer?.is_correct
                          ? "correct"
                          : "wrong"
                      }
                    >
                      {player.name}: {answer?.answer}{" "}
                      {answer?.is_correct ? "✓" : "✕"}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          <div className="host-controls">
            {me?.is_host && !revealed && (
              <button
                className="primary"
                onClick={revealAnswer}
                disabled={!everyoneAnswered}
              >
                {everyoneAnswered
                  ? "REVEAL ANSWER"
                  : `WAITING FOR ${
                      players.length - roundAnswers.length
                    }`}
              </button>
            )}

            {me?.is_host && revealed && (
              <button className="primary" onClick={nextRound}>
                {room.current_round === 10
                  ? "SEE FINAL SCORES 🏆"
                  : "NEXT ROUND →"}
              </button>
            )}

            {!me?.is_host && !revealed && (
              <div className="waiting">
                {myAnswer
                  ? "Answer locked. Waiting for everyone else..."
                  : "Choose wisely 👀"}
              </div>
            )}

            {!me?.is_host && revealed && (
              <div className="waiting">
                Waiting for Courtney to unleash the next round...
              </div>
            )}
          </div>
        </section>
      </main>
    );
  }

  if (screen === "results") {
    const leaderboard = [...players].sort(
      (a, b) => b.score - a.score
    );

    const winner = leaderboard[0];

    return (
      <main className="shell">
        <section className="game-card results">
          <div className="trophy">🏆</div>

          <div className="eyebrow">
            FUN FRIDAY CHAMPION
          </div>

          <h1>{winner?.name || "THE WINNER"}</h1>

          <p className="subtitle">
            Apparently the least easily fooled by robots.
          </p>

          <div className="final-board">
            {leaderboard.map((player, index) => (
              <div className="final-row" key={player.id}>
                <span>
                  {index === 0
                    ? "👑"
                    : index === 1
                    ? "🥈"
                    : index === 2
                    ? "🥉"
                    : "💀"}
                </span>

                <strong>{player.name}</strong>

                <b>{player.score} pts</b>
              </div>
            ))}
          </div>

          {me?.is_host && (
            <button
              className="primary big"
              onClick={resetLocalGame}
            >
              PLAY AGAIN
            </button>
          )}

          <div className="footer-note">
            SAME TEAM. DIFFERENT BRAINROT.
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="shell">
      <div className="waiting">Loading the chaos...</div>
    </main>
  );
}
