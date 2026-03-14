export type Role = 'Mafia' | 'Doctor' | 'Detective' | 'Villager';
export type Phase = 'Lobby' | 'Night' | 'Day' | 'Discussion' | 'Voting' | 'GameOver';

export interface Player {
  id: string;
  name: string;
  role?: Role;
  isAlive: boolean;
  isAI: boolean;
  isOnline?: boolean;
  vote?: string; // ID of the player voted for
  target?: string; // ID of the player targeted (for Mafia/Doctor/Detective)
}

export interface GameState {
  roomId: string;
  players: Player[];
  phase: Phase;
  dayCount: number;
  lastNightResult?: {
    victimId?: string;
    savedId?: string;
    investigatedId?: string;
    investigatedRole?: Role;
  };
  winner?: 'Mafia' | 'Villagers';
  logs: string[];
  language?: 'en' | 'zh';
}

export type ServerMessage = 
  | { type: 'INIT_STATE'; state: GameState; playerId: string }
  | { type: 'UPDATE_STATE'; state: GameState }
  | { type: 'CHAT_MESSAGE'; sender: string; message: string; isSystem?: boolean }
  | { type: 'ERROR'; message: string }
  | { type: 'PONG' };

export type ClientMessage = 
  | { type: 'JOIN_ROOM'; roomId: string; playerName: string }
  | { type: 'CREATE_ROOM'; playerName: string; playerCount: number; language?: 'en' | 'zh' }
  | { type: 'RECONNECT'; roomId: string; playerId: string }
  | { type: 'SUBMIT_ACTION'; targetId: string }
  | { type: 'SUBMIT_VOTE'; targetId: string }
  | { type: 'SEND_CHAT'; message: string }
  | { type: 'START_GAME' }
  | { type: 'PING' };
