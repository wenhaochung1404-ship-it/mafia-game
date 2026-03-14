import express from "express";
import { createServer as createViteServer } from "vite";
import { WebSocketServer, WebSocket } from "ws";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import { fileURLToPath } from "url";
import { GameState, Player, Role, Phase, ClientMessage, ServerMessage } from "./src/types";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Game state storage
  const rooms = new Map<string, GameState>();
  const playerSockets = new Map<string, WebSocket>();

  // API routes go here
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", rooms: rooms.size });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  const wss = new WebSocketServer({ server });

  wss.on("connection", (ws) => {
    let currentPlayerId: string | null = null;
    let currentRoomId: string | null = null;

    ws.on("close", () => {
      if (currentPlayerId && currentRoomId) {
        playerSockets.delete(currentPlayerId);
        const state = rooms.get(currentRoomId);
        if (state) {
          const player = state.players.find(p => p.id === currentPlayerId);
          if (player) {
            player.isOnline = false;
            broadcastToRoom(currentRoomId, { type: "UPDATE_STATE", state });
          }
        }
      }
    });

    ws.on("message", async (data) => {
      const message: ClientMessage = JSON.parse(data.toString());

      switch (message.type) {
        case "PING": {
          sendToPlayer(ws, { type: "PONG" });
          break;
        }
        case "CREATE_ROOM": {
          const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
          const playerId = uuidv4();
          currentPlayerId = playerId;
          currentRoomId = roomId;
          playerSockets.set(playerId, ws);

          const players: Player[] = [
            { id: playerId, name: message.playerName, isAlive: true, isAI: false, isOnline: true }
          ];

          // Fill with AI players if needed
          for (let i = 1; i < message.playerCount; i++) {
            players.push({
              id: uuidv4(),
              name: `AI Player ${i}`,
              isAlive: true,
              isAI: true,
              isOnline: true
            });
          }

          const state: GameState = {
            roomId,
            players,
            phase: "Lobby",
            dayCount: 1,
            language: message.language || 'en',
            logs: [`Room ${roomId} created by ${message.playerName}`]
          };

          rooms.set(roomId, state);
          sendToPlayer(ws, { type: "INIT_STATE", state, playerId });
          break;
        }

        case "JOIN_ROOM": {
          const state = rooms.get(message.roomId);
          if (!state) {
            sendToPlayer(ws, { type: "ERROR", message: "Room not found" });
            return;
          }

          // Find an empty slot or replace an AI
          const aiPlayer = state.players.find(p => p.isAI);
          if (!aiPlayer) {
            sendToPlayer(ws, { type: "ERROR", message: "Room is full" });
            return;
          }

          const playerId = aiPlayer.id;
          currentPlayerId = playerId;
          currentRoomId = message.roomId;
          playerSockets.set(playerId, ws);

          aiPlayer.name = message.playerName;
          aiPlayer.isAI = false;
          aiPlayer.isOnline = true;

          state.logs.push(`${message.playerName} joined the room`);
          broadcastToRoom(message.roomId, { type: "UPDATE_STATE", state });
          sendToPlayer(ws, { type: "INIT_STATE", state, playerId });
          break;
        }

        case "RECONNECT": {
          const state = rooms.get(message.roomId);
          if (!state) {
            sendToPlayer(ws, { type: "ERROR", message: "Room not found" });
            return;
          }

          const player = state.players.find(p => p.id === message.playerId);
          if (!player) {
            sendToPlayer(ws, { type: "ERROR", message: "Player not found in this room" });
            return;
          }

          currentPlayerId = message.playerId;
          currentRoomId = message.roomId;
          playerSockets.set(message.playerId, ws);
          player.isOnline = true;

          broadcastToRoom(message.roomId, { type: "UPDATE_STATE", state });
          sendToPlayer(ws, { type: "INIT_STATE", state, playerId: message.playerId });
          break;
        }

        case "START_GAME": {
          if (!currentRoomId) return;
          const state = rooms.get(currentRoomId);
          if (!state || state.phase !== "Lobby") return;

          assignRoles(state);
          state.phase = "Night";
          state.logs.push("Game started! It is now Night Phase.");
          broadcastToRoom(currentRoomId, { type: "UPDATE_STATE", state });
          
          // Process AI night actions
          processAINightActions(state);
          break;
        }

        case "SUBMIT_ACTION": {
          if (!currentRoomId || !currentPlayerId) return;
          const state = rooms.get(currentRoomId);
          if (!state || state.phase !== "Night") return;

          const player = state.players.find(p => p.id === currentPlayerId);
          if (!player || !player.isAlive) return;

          player.target = message.targetId;
          
          // Check if all special roles have acted
          if (checkAllNightActionsDone(state)) {
            transitionToDay(state);
          } else {
            broadcastToRoom(currentRoomId, { type: "UPDATE_STATE", state });
          }
          break;
        }

        case "SUBMIT_VOTE": {
          if (!currentRoomId || !currentPlayerId) return;
          const state = rooms.get(currentRoomId);
          if (!state || state.phase !== "Voting") return;

          const player = state.players.find(p => p.id === currentPlayerId);
          if (!player || !player.isAlive) return;

          player.vote = message.targetId;

          if (state.players.filter(p => p.isAlive && !p.isAI).every(p => p.vote)) {
            // AI players vote
            processAIVotes(state);
            processVotingResults(state);
          } else {
            broadcastToRoom(currentRoomId, { type: "UPDATE_STATE", state });
          }
          break;
        }

        case "SEND_CHAT": {
          if (!currentRoomId || !currentPlayerId) return;
          const state = rooms.get(currentRoomId);
          if (!state) return;

          const player = state.players.find(p => p.id === currentPlayerId);
          if (!player) return;

          broadcastToRoom(currentRoomId, { 
            type: "CHAT_MESSAGE", 
            sender: player.name, 
            message: message.message 
          });

          if (state.phase === "Discussion") {
            // Trigger AI response
            handleAIDiscussion(state, player.name, message.message);
          }
          break;
        }
      }
    });
  });

  function sendToPlayer(ws: WebSocket, message: ServerMessage) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  function broadcastToRoom(roomId: string, message: ServerMessage) {
    const state = rooms.get(roomId);
    if (!state) return;

    state.players.forEach(player => {
      const ws = playerSockets.get(player.id);
      if (ws) sendToPlayer(ws, message);
    });
  }

  function assignRoles(state: GameState) {
    const playerCount = state.players.length;
    const mafiaCount = Math.floor(playerCount / 4) || 1;
    const roles: Role[] = [];

    for (let i = 0; i < mafiaCount; i++) roles.push("Mafia");
    roles.push("Doctor");
    roles.push("Detective");
    while (roles.length < playerCount) roles.push("Villager");

    // Shuffle roles
    for (let i = roles.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [roles[i], roles[j]] = [roles[j], roles[i]];
    }

    state.players.forEach((player, i) => {
      player.role = roles[i];
    });
  }

  function checkAllNightActionsDone(state: GameState): boolean {
    const aliveSpecialRoles = state.players.filter(p => 
      p.isAlive && !p.isAI && (p.role === "Mafia" || p.role === "Doctor" || p.role === "Detective")
    );
    return aliveSpecialRoles.every(p => p.target);
  }

  function processAINightActions(state: GameState) {
    state.players.filter(p => p.isAlive && p.isAI).forEach(p => {
      const aliveOthers = state.players.filter(other => other.id !== p.id && other.isAlive);
      if (aliveOthers.length === 0) return;

      if (p.role === "Mafia") {
        // Target a non-mafia
        const targets = aliveOthers.filter(other => other.role !== "Mafia");
        p.target = targets[Math.floor(Math.random() * targets.length)]?.id;
      } else if (p.role === "Doctor") {
        // Target anyone alive
        p.target = state.players.filter(other => other.isAlive)[Math.floor(Math.random() * state.players.filter(other => other.isAlive).length)]?.id;
      } else if (p.role === "Detective") {
        // Target anyone alive other than self
        p.target = aliveOthers[Math.floor(Math.random() * aliveOthers.length)]?.id;
      }
    });

    // If all players are AI, transition immediately
    if (state.players.filter(p => p.isAlive && !p.isAI).length === 0 || checkAllNightActionsDone(state)) {
      transitionToDay(state);
    }
  }

  function transitionToDay(state: GameState) {
    const mafiaVotes = new Map<string, number>();
    state.players.filter(p => p.isAlive && p.role === "Mafia").forEach(p => {
      if (p.target) mafiaVotes.set(p.target, (mafiaVotes.get(p.target) || 0) + 1);
    });

    let victimId: string | undefined;
    let maxVotes = 0;
    mafiaVotes.forEach((count, id) => {
      if (count > maxVotes) {
        maxVotes = count;
        victimId = id;
      }
    });

    const doctor = state.players.find(p => p.isAlive && p.role === "Doctor");
    const savedId = doctor?.target;

    const detective = state.players.find(p => p.isAlive && p.role === "Detective");
    const investigatedId = detective?.target;
    const investigatedRole = state.players.find(p => p.id === investigatedId)?.role;

    state.lastNightResult = { victimId, savedId, investigatedId, investigatedRole };

    if (victimId && victimId !== savedId) {
      const victim = state.players.find(p => p.id === victimId);
      if (victim) {
        victim.isAlive = false;
        state.logs.push(`Night results: ${victim.name} was eliminated.`);
      }
    } else if (victimId && victimId === savedId) {
      state.logs.push("Night results: The Mafia attacked, but the Doctor saved the target!");
    } else {
      state.logs.push("Night results: Nothing happened last night.");
    }

    // Reset targets
    state.players.forEach(p => p.target = undefined);

    if (checkWinCondition(state)) return;

    state.phase = "Day";
    broadcastToRoom(state.roomId, { type: "UPDATE_STATE", state });

    // Auto transition to discussion after 3 seconds
    setTimeout(() => {
      state.phase = "Discussion";
      state.logs.push("Discussion phase started. Talk to find the Mafia!");
      broadcastToRoom(state.roomId, { type: "UPDATE_STATE", state });
      startAIDiscussion(state);
    }, 3000);
  }

  async function startAIDiscussion(state: GameState) {
    const aliveAIs = state.players.filter(p => p.isAlive && p.isAI);
    if (aliveAIs.length === 0) return;

    const lang = state.language === 'zh' ? 'Chinese' : 'English';

    // Pick a random AI to start
    const aiPlayer = aliveAIs[Math.floor(Math.random() * aliveAIs.length)];
    const prompt = `You are playing a Mafia game as ${aiPlayer.name}. Your role is ${aiPlayer.role}. 
    The current state of the game: ${JSON.stringify(state.players.map(p => ({ name: p.name, isAlive: p.isAlive })))}.
    Last night results: ${JSON.stringify(state.lastNightResult)}.
    Write a short, realistic chat message (max 20 words) for the discussion phase in ${lang}. 
    If you are Mafia, try to blend in or subtly accuse others. 
    If you are Villager/Doctor/Detective, try to find the Mafia based on who is alive.
    Only output the message text in ${lang}.`;

    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt
      });
      const text = response.text || "I'm not sure who it is yet.";
      broadcastToRoom(state.roomId, { type: "CHAT_MESSAGE", sender: aiPlayer.name, message: text });
    } catch (e) {
      console.error("AI Discussion Error", e);
    }

    // Transition to voting after some time
    setTimeout(() => {
      const currentState = rooms.get(state.roomId);
      if (currentState && currentState.phase === "Discussion") {
        currentState.phase = "Voting";
        currentState.logs.push("Voting phase started. Cast your votes!");
        broadcastToRoom(state.roomId, { type: "UPDATE_STATE", state: currentState });
      }
    }, 30000); // Increased to 30 seconds
  }

  async function handleAIDiscussion(state: GameState, sender: string, message: string) {
    const aliveAIs = state.players.filter(p => p.isAlive && p.isAI);
    if (aliveAIs.length === 0) return;

    // 30% chance for an AI to respond
    if (Math.random() > 0.3) return;

    const lang = state.language === 'zh' ? 'Chinese' : 'English';

    const aiPlayer = aliveAIs[Math.floor(Math.random() * aliveAIs.length)];
    const prompt = `You are ${aiPlayer.name} in a Mafia game. Role: ${aiPlayer.role}.
    ${sender} just said: "${message}".
    Respond to this message briefly (max 15 words) in ${lang}. 
    Game context: ${JSON.stringify(state.players.filter(p => p.isAlive).map(p => p.name))} are alive.
    Only output the message text in ${lang}.`;

    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt
      });
      const text = response.text || "Interesting point.";
      broadcastToRoom(state.roomId, { type: "CHAT_MESSAGE", sender: aiPlayer.name, message: text });
    } catch (e) {
      console.error("AI Response Error", e);
    }
  }

  function processAIVotes(state: GameState) {
    state.players.filter(p => p.isAlive && p.isAI).forEach(p => {
      const aliveOthers = state.players.filter(other => other.id !== p.id && other.isAlive);
      if (aliveOthers.length === 0) return;

      if (p.role === "Mafia") {
        const targets = aliveOthers.filter(other => other.role !== "Mafia");
        p.vote = targets[Math.floor(Math.random() * targets.length)]?.id;
      } else {
        p.vote = aliveOthers[Math.floor(Math.random() * aliveOthers.length)]?.id;
      }
    });
  }

  function processVotingResults(state: GameState) {
    const votes = new Map<string, number>();
    state.players.filter(p => p.isAlive).forEach(p => {
      if (p.vote) votes.set(p.vote, (votes.get(p.vote) || 0) + 1);
    });

    let executedId: string | undefined;
    let maxVotes = 0;
    votes.forEach((count, id) => {
      if (count > maxVotes) {
        maxVotes = count;
        executedId = id;
      }
    });

    if (executedId) {
      const executed = state.players.find(p => p.id === executedId);
      if (executed) {
        executed.isAlive = false;
        state.logs.push(`Voting results: ${executed.name} was executed. They were a ${executed.role}.`);
      }
    } else {
      state.logs.push("Voting results: No one was executed.");
    }

    // Reset votes
    state.players.forEach(p => p.vote = undefined);

    if (checkWinCondition(state)) return;

    state.dayCount++;
    state.phase = "Night";
    state.logs.push(`Day ${state.dayCount} ends. It is now Night Phase.`);
    broadcastToRoom(state.roomId, { type: "UPDATE_STATE", state });
    processAINightActions(state);
  }

  function checkWinCondition(state: GameState): boolean {
    const aliveMafia = state.players.filter(p => p.isAlive && p.role === "Mafia").length;
    const aliveVillagers = state.players.filter(p => p.isAlive && p.role !== "Mafia").length;

    if (aliveMafia === 0) {
      state.winner = "Villagers";
      state.phase = "GameOver";
      state.logs.push("Villagers Win! All Mafia members have been eliminated.");
      broadcastToRoom(state.roomId, { type: "UPDATE_STATE", state });
      return true;
    }

    if (aliveMafia >= aliveVillagers) {
      state.winner = "Mafia";
      state.phase = "GameOver";
      state.logs.push("Mafia Wins! They have taken over the village.");
      broadcastToRoom(state.roomId, { type: "UPDATE_STATE", state });
      return true;
    }

    return false;
  }
}

startServer();
