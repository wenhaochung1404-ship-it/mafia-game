import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Users, 
  Shield, 
  Search, 
  Skull, 
  MessageSquare, 
  Send, 
  Play, 
  Plus, 
  LogIn,
  AlertCircle,
  Moon,
  Sun,
  Trophy,
  Languages
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { GameState, Player, Role, Phase, ClientMessage, ServerMessage } from './types';
import { translations, Language } from './translations';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function App() {
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [playerName, setPlayerName] = useState('');
  const [roomId, setRoomId] = useState('');
  const [playerCount, setPlayerCount] = useState(4);
  const [chatMessage, setChatMessage] = useState('');
  const [chats, setChats] = useState<{ sender: string; message: string; isSystem?: boolean }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<{ targetId: string; type: 'SUBMIT_ACTION' | 'SUBMIT_VOTE'; actionName: string; targetName: string } | null>(null);
  const [language, setLanguage] = useState<Language>(() => (localStorage.getItem('mafia_lang') as Language) || 'en');
  const [copied, setCopied] = useState(false);
  
  const t = translations[language];
  
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomFromUrl = params.get('room');
    if (roomFromUrl) {
      setRoomId(roomFromUrl.toUpperCase());
    }

    const savedPlayerId = localStorage.getItem('mafia_player_id');
    const savedRoomId = localStorage.getItem('mafia_room_id');
    const savedPlayerName = localStorage.getItem('mafia_player_name');
    
    if (savedPlayerName) setPlayerName(savedPlayerName);

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${window.location.host}`);
    
    socket.onopen = () => {
      console.log('Connected to server');
      setWs(socket);
      
      // Attempt to reconnect if we have saved state
      if (savedPlayerId && savedRoomId) {
        socket.send(JSON.stringify({ 
          type: 'RECONNECT', 
          roomId: savedRoomId, 
          playerId: savedPlayerId 
        }));
      }
    };

    socket.onmessage = (event) => {
      const message: ServerMessage = JSON.parse(event.data);
      switch (message.type) {
        case 'INIT_STATE':
          setGameState(message.state);
          setPlayerId(message.playerId);
          localStorage.setItem('mafia_player_id', message.playerId);
          localStorage.setItem('mafia_room_id', message.state.roomId);
          localStorage.setItem('mafia_player_name', playerName || message.state.players.find(p => p.id === message.playerId)?.name || '');
          break;
        case 'UPDATE_STATE':
          setGameState(message.state);
          break;
        case 'CHAT_MESSAGE':
          setChats(prev => [...prev, { sender: message.sender, message: message.message, isSystem: message.isSystem }]);
          break;
        case 'ERROR':
          if (message.message === 'Room not found') {
            setError(t.errorRoomNotFound);
            localStorage.removeItem('mafia_room_id');
            localStorage.removeItem('mafia_player_id');
          } else {
            setError(message.message);
          }
          setTimeout(() => setError(null), 3000);
          break;
      }
    };

    return () => socket.close();
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chats]);

  const sendMessage = (msg: ClientMessage) => {
    ws?.send(JSON.stringify(msg));
  };

  const handleCreateRoom = () => {
    if (!playerName) return setError(t.errorName);
    localStorage.setItem('mafia_player_name', playerName);
    sendMessage({ type: 'CREATE_ROOM', playerName, playerCount, language });
  };

  const handleJoinRoom = () => {
    if (!playerName || !roomId) return setError(t.errorJoin);
    localStorage.setItem('mafia_player_name', playerName);
    sendMessage({ type: 'JOIN_ROOM', roomId, playerName });
  };

  const copyInviteLink = () => {
    if (!gameState) return;
    const url = `${window.location.origin}?room=${gameState.roomId}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleLeaveRoom = () => {
    localStorage.removeItem('mafia_room_id');
    localStorage.removeItem('mafia_player_id');
    window.location.reload();
  };

  const toggleLanguage = () => {
    const newLang = language === 'en' ? 'zh' : 'en';
    setLanguage(newLang);
    localStorage.setItem('mafia_lang', newLang);
  };

  const handleSendChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatMessage.trim()) return;
    sendMessage({ type: 'SEND_CHAT', message: chatMessage });
    setChatMessage('');
  };

  const translateLog = (log: string) => {
    if (language === 'en') return log;
    
    // Simple mapping for common server logs
    if (log.includes('Room') && log.includes('created by')) {
      const parts = log.split(' ');
      return `房间 ${parts[1]} 由 ${parts[4]} 创建`;
    }
    if (log.includes('joined the room')) {
      return `${log.split(' ')[0]} 加入了房间`;
    }
    if (log.includes('Game started!')) {
      return "游戏开始！现在是夜晚阶段。";
    }
    if (log.includes('Night results:')) {
      if (log.includes('was eliminated')) {
        return `夜晚结果：${log.split(' ')[2]} 被杀害了。`;
      }
      if (log.includes('Doctor saved the target')) {
        return "夜晚结果：狼人发动了袭击，但医生救下了目标！";
      }
      if (log.includes('Nothing happened')) {
        return "夜晚结果：昨晚平安无事。";
      }
    }
    if (log.includes('Discussion phase started')) {
      return "讨论阶段开始。找出狼人！";
    }
    if (log.includes('Voting phase started')) {
      return "投票阶段开始。请投出你的一票！";
    }
    if (log.includes('Voting results:')) {
      if (log.includes('was executed')) {
        const parts = log.split(' ');
        const role = parts[parts.length - 1].replace('.', '');
        const translatedRole = t[role.toLowerCase() as keyof typeof t] || role;
        return `投票结果：${parts[2]} 被处决了。他们的身份是 ${translatedRole}。`;
      }
      if (log.includes('No one was executed')) {
        return "投票结果：没有人被处决。";
      }
    }
    if (log.includes('ends. It is now Night Phase')) {
      const day = log.match(/Day (\d+)/)?.[1];
      return `第 ${day} 天结束。现在是夜晚阶段。`;
    }
    if (log.includes('Villagers Win!')) {
      return "村民获胜！所有狼人已被消灭。";
    }
    if (log.includes('Mafia Wins!')) {
      return "狼人获胜！他们占领了村庄。";
    }

    return log;
  };

  const me = gameState?.players.find(p => p.id === playerId);
  const isAlive = me?.isAlive;

  if (!gameState) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] text-white flex items-center justify-center p-4 font-sans">
        <div className="absolute top-4 right-4">
          <button 
            onClick={toggleLanguage}
            className="flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl px-4 py-2 transition-all"
          >
            <Languages className="w-4 h-4" />
            <span className="text-xs font-bold uppercase">{language === 'en' ? '中文' : 'English'}</span>
          </button>
        </div>
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md bg-[#151619] border border-white/10 rounded-2xl p-8 shadow-2xl"
        >
          <div className="flex flex-col items-center mb-8">
            <div className="w-16 h-16 bg-red-600 rounded-full flex items-center justify-center mb-4 shadow-[0_0_20px_rgba(220,38,38,0.5)]">
              <Skull className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-3xl font-bold tracking-tighter uppercase italic">{t.appName}</h1>
            <p className="text-white/50 text-sm mt-1">{t.tagline}</p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-mono uppercase tracking-widest text-white/40 mb-1.5">{t.yourName}</label>
              <input 
                type="text" 
                value={playerName}
                onChange={e => setPlayerName(e.target.value)}
                placeholder={t.enterAlias}
                className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:border-red-600/50 transition-colors"
              />
            </div>

            <div className="grid grid-cols-2 gap-4 pt-4">
              <button 
                onClick={handleCreateRoom}
                className="flex flex-col items-center justify-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl p-4 transition-all group"
              >
                <Plus className="w-6 h-6 text-red-500 group-hover:scale-110 transition-transform" />
                <span className="text-xs font-bold uppercase tracking-wider">{t.create}</span>
              </button>
              <button 
                onClick={() => setRoomId('JOIN')} // Just a placeholder to show join UI
                className="flex flex-col items-center justify-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl p-4 transition-all group"
              >
                <LogIn className="w-6 h-6 text-blue-500 group-hover:scale-110 transition-transform" />
                <span className="text-xs font-bold uppercase tracking-wider">{t.join}</span>
              </button>
            </div>

            {roomId === 'JOIN' && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="space-y-4 pt-4">
                  <input 
                    type="text" 
                    value={roomId === 'JOIN' ? '' : roomId}
                    onChange={e => setRoomId(e.target.value.toUpperCase())}
                    placeholder={t.roomId.toUpperCase()}
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:border-blue-600/50 transition-colors text-center font-mono text-xl tracking-widest"
                  />
                <button 
                  onClick={handleJoinRoom}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl transition-colors shadow-lg shadow-blue-600/20"
                >
                  {t.enterRoom}
                </button>
              </motion.div>
            )}

            {roomId !== 'JOIN' && (
              <div className="pt-4">
                <label className="block text-xs font-mono uppercase tracking-widest text-white/40 mb-1.5">{t.playersRange}</label>
                <input 
                  type="range" 
                  min="4" 
                  max="16" 
                  value={playerCount}
                  onChange={e => setPlayerCount(parseInt(e.target.value))}
                  className="w-full accent-red-600"
                />
                <div className="flex justify-between text-[10px] font-mono text-white/30 mt-1">
                  <span>4 {t.players.toUpperCase()}</span>
                  <span className="text-white font-bold">{playerCount} {t.players.toUpperCase()}</span>
                  <span>16 {t.players.toUpperCase()}</span>
                </div>
              </div>
            )}
          </div>

          <AnimatePresence>
            {error && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="mt-4 p-3 bg-red-900/20 border border-red-500/30 rounded-xl flex items-center gap-2 text-red-400 text-xs"
              >
                <AlertCircle className="w-4 h-4" />
                {error}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white flex flex-col font-sans overflow-hidden">
      {/* Status Dashboard */}
      <header className="bg-[#151619] border-b border-white/10 p-4 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-4">
          <div className="flex flex-col">
            <span className="text-[10px] font-mono uppercase tracking-widest text-white/40">{t.phase}</span>
            <div className="flex items-center gap-2">
              {gameState.phase === 'Night' ? <Moon className="w-4 h-4 text-indigo-400" /> : <Sun className="w-4 h-4 text-yellow-400" />}
              <span className="font-bold uppercase italic tracking-tight">{t[gameState.phase.toLowerCase() as keyof typeof t] || gameState.phase}</span>
            </div>
          </div>
          <div className="w-px h-8 bg-white/10" />
          <div className="flex flex-col">
            <span className="text-[10px] font-mono uppercase tracking-widest text-white/40">{t.alive}</span>
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-emerald-400" />
              <span className="font-bold">{gameState.players.filter(p => p.isAlive).length} / {gameState.players.length}</span>
            </div>
          </div>
          <div className="w-px h-8 bg-white/10" />
          <div className="flex flex-col">
            <span className="text-[10px] font-mono uppercase tracking-widest text-white/40">{t.roles}</span>
            <div className="flex items-center gap-2 text-[10px] font-mono">
              <span className="text-red-500" title={t.mafia}>M:{gameState.players.filter(p => p.role === 'Mafia').length}</span>
              <span className="text-emerald-400" title={t.doctor}>Doc:1</span>
              <span className="text-blue-400" title={t.detective}>Det:1</span>
              <span className="text-white/60" title={t.villagers}>V:{gameState.players.filter(p => p.role === 'Villager').length}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button 
            onClick={toggleLanguage}
            className="flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl px-3 py-1.5 transition-all mr-2"
          >
            <Languages className="w-3.5 h-3.5" />
            <span className="text-[10px] font-bold uppercase">{language === 'en' ? '中文' : 'EN'}</span>
          </button>
          <button 
            onClick={handleLeaveRoom}
            className="text-[10px] font-mono uppercase tracking-widest text-white/40 hover:text-red-400 transition-colors mr-2"
          >
            {t.leaveGame}
          </button>
          <div className="flex flex-col items-end">
            <span className="text-[10px] font-mono uppercase tracking-widest text-white/40">{t.yourRole}</span>
            <span className={cn(
              "font-bold uppercase italic tracking-tight",
              me?.role === 'Mafia' ? "text-red-500" : 
              me?.role === 'Doctor' ? "text-emerald-400" : 
              me?.role === 'Detective' ? "text-blue-400" : "text-white/80"
            )}>
              {me?.role ? t[me.role.toLowerCase() as keyof typeof t] : t.spectator}
            </span>
          </div>
          <div className={cn(
            "w-10 h-10 rounded-full flex items-center justify-center border",
            me?.role === 'Mafia' ? "bg-red-900/20 border-red-500/30" : "bg-white/5 border-white/10"
          )}>
            {me?.role === 'Mafia' ? <Skull className="w-5 h-5 text-red-500" /> : 
             me?.role === 'Doctor' ? <Shield className="w-5 h-5 text-emerald-400" /> :
             me?.role === 'Detective' ? <Search className="w-5 h-5 text-blue-400" /> : <Users className="w-5 h-5 text-white/40" />}
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        {/* Player List */}
        <section className="w-full lg:w-80 bg-black/20 border-r border-white/10 overflow-y-auto p-4 space-y-3">
          <h2 className="text-[10px] font-mono uppercase tracking-widest text-white/30 mb-4 px-2">{t.players}</h2>
          {gameState.players.map(player => (
            <motion.div 
              key={player.id}
              layout
              className={cn(
                "p-3 rounded-xl border transition-all flex items-center justify-between",
                !player.isAlive ? "bg-black/40 border-white/5 opacity-50 grayscale" : 
                player.id === playerId ? "bg-white/5 border-white/20 shadow-lg" : "bg-white/5 border-transparent"
              )}
            >
              <div className="flex items-center gap-3">
                <div className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold",
                  !player.isAlive ? "bg-white/5 text-white/20" : "bg-white/10 text-white/80"
                )}>
                  {player.name[0].toUpperCase()}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{player.name}</span>
                    {player.id === playerId && <span className="text-[8px] bg-white/10 px-1 rounded text-white/40">{t.you}</span>}
                    {player.isAI && <span className="text-[8px] bg-blue-500/20 text-blue-400 px-1 rounded">{t.ai}</span>}
                  </div>
                  {!player.isOnline && player.isAlive && !player.isAI && (
                    <span className="text-[8px] text-white/30 font-mono uppercase">{t.offline}</span>
                  )}
                  {!player.isAlive && <span className="text-[10px] text-red-500/70 font-mono uppercase">{t.eliminated}</span>}
                </div>
              </div>

              {/* Action Buttons */}
              {isAlive && player.isAlive && player.id !== playerId && (
                <div className="flex gap-2">
                  {gameState.phase === 'Night' && (
                    <>
                      {me?.role === 'Mafia' && (
                        <button 
                          onClick={() => setPendingAction({ targetId: player.id, type: 'SUBMIT_ACTION', actionName: t.eliminate, targetName: player.name })}
                          className={cn("p-2 rounded-lg transition-colors", me.target === player.id ? "bg-red-600 text-white" : "bg-white/5 hover:bg-red-600/20 text-red-400")}
                          title={t.eliminate}
                        >
                          <Skull className="w-4 h-4" />
                        </button>
                      )}
                      {me?.role === 'Doctor' && (
                        <button 
                          onClick={() => setPendingAction({ targetId: player.id, type: 'SUBMIT_ACTION', actionName: t.save, targetName: player.name })}
                          className={cn("p-2 rounded-lg transition-colors", me.target === player.id ? "bg-emerald-600 text-white" : "bg-white/5 hover:bg-emerald-600/20 text-emerald-400")}
                          title={t.save}
                        >
                          <Shield className="w-4 h-4" />
                        </button>
                      )}
                      {me?.role === 'Detective' && (
                        <button 
                          onClick={() => setPendingAction({ targetId: player.id, type: 'SUBMIT_ACTION', actionName: t.investigate, targetName: player.name })}
                          className={cn("p-2 rounded-lg transition-colors", me.target === player.id ? "bg-blue-600 text-white" : "bg-white/5 hover:bg-blue-600/20 text-blue-400")}
                          title={t.investigate}
                        >
                          <Search className="w-4 h-4" />
                        </button>
                      )}
                    </>
                  )}
                  {gameState.phase === 'Voting' && (
                    <button 
                      onClick={() => setPendingAction({ targetId: player.id, type: 'SUBMIT_VOTE', actionName: t.voteFor, targetName: player.name })}
                      className={cn("p-2 rounded-lg transition-colors", me.vote === player.id ? "bg-yellow-600 text-white" : "bg-white/5 hover:bg-yellow-600/20 text-yellow-400")}
                      title={t.voteFor}
                    >
                      <AlertCircle className="w-4 h-4" />
                    </button>
                  )}
                </div>
              )}
            </motion.div>
          ))}
        </section>

        {/* Main Game Area */}
        <section className="flex-1 flex flex-col overflow-hidden relative">
          {/* Game Logs / Events */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            <AnimatePresence mode="popLayout">
              {gameState.phase === 'Lobby' && (
                  <div className="flex flex-col items-center justify-center text-center space-y-6">
                    <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center border border-white/10">
                      <Users className="w-10 h-10 text-white/20" />
                    </div>
                    <div>
                      <h2 className="text-2xl font-bold tracking-tight">{t.waitingForPlayers}</h2>
                      <p className="text-white/40 mt-2">{t.roomId}: <span className="font-mono text-white font-bold tracking-widest">{gameState.roomId}</span></p>
                    </div>
                    
                    <div className="flex flex-col gap-3 w-full max-w-xs">
                      <button 
                        onClick={copyInviteLink}
                        className={cn(
                          "w-full px-6 py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2 border",
                          copied ? "bg-emerald-600/20 border-emerald-500/30 text-emerald-400" : "bg-white/5 border-white/10 text-white/70 hover:bg-white/10"
                        )}
                      >
                        <LogIn className="w-4 h-4 rotate-90" />
                        {copied ? t.inviteCopied : t.copyInvite}
                      </button>

                      {gameState.players[0].id === playerId && (
                        <button 
                          onClick={() => sendMessage({ type: 'START_GAME' })}
                          className="w-full bg-red-600 hover:bg-red-700 text-white px-8 py-3 rounded-xl font-bold transition-all shadow-xl shadow-red-600/20 flex items-center justify-center gap-2"
                        >
                          <Play className="w-5 h-5" />
                          {t.startGame}
                        </button>
                      )}
                    </div>
                  </div>
              )}

              {gameState.phase === 'GameOver' && (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="h-full flex flex-col items-center justify-center text-center space-y-6"
                >
                  <div className={cn(
                    "w-24 h-24 rounded-full flex items-center justify-center border shadow-2xl",
                    gameState.winner === 'Mafia' ? "bg-red-900/20 border-red-500/30 text-red-500" : "bg-emerald-900/20 border-emerald-500/30 text-emerald-500"
                  )}>
                    <Trophy className="w-12 h-12" />
                  </div>
                  <div>
                    <h2 className="text-4xl font-black uppercase italic tracking-tighter">{(gameState.winner === 'Mafia' ? t.mafia : t.villager) + ' ' + t.win}</h2>
                    <p className="text-white/40 mt-2">{t.concluded}</p>
                  </div>
                  <button 
                    onClick={() => window.location.reload()}
                    className="bg-white/10 hover:bg-white/20 text-white px-8 py-3 rounded-xl font-bold transition-all"
                  >
                    {t.playAgain}
                  </button>
                </motion.div>
              )}

              {gameState.phase !== 'Lobby' && gameState.phase !== 'GameOver' && (
                <div className="space-y-4">
                  {/* Role Specific Instructions */}
                  {gameState.phase === 'Night' && isAlive && (
                    <motion.div 
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={cn(
                        "p-6 rounded-2xl border shadow-2xl flex flex-col items-center text-center gap-4",
                        me?.role === 'Mafia' ? "bg-red-900/20 border-red-500/30" :
                        me?.role === 'Doctor' ? "bg-emerald-900/20 border-emerald-500/30" :
                        me?.role === 'Detective' ? "bg-blue-900/20 border-blue-500/30" : "bg-white/5 border-white/10"
                      )}
                    >
                      <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center">
                        {me?.role === 'Mafia' ? <Skull className="w-6 h-6 text-red-500" /> : 
                         me?.role === 'Doctor' ? <Shield className="w-6 h-6 text-emerald-400" /> :
                         me?.role === 'Detective' ? <Search className="w-6 h-6 text-blue-400" /> : <Moon className="w-6 h-6 text-white/40" />}
                      </div>
                      <div>
                        <h3 className="text-lg font-bold uppercase italic tracking-tight">
                          {me?.role === 'Mafia' ? t.mafiaEliminate : 
                           me?.role === 'Doctor' ? t.doctorProtect : 
                           me?.role === 'Detective' ? t.detectiveInvestigate : t.nightFalls}
                        </h3>
                        <p className="text-sm text-white/60 mt-1">
                          {me?.role === 'Mafia' ? t.mafiaDesc : 
                           me?.role === 'Doctor' ? t.doctorDesc : 
                           me?.role === 'Detective' ? t.detectiveDesc : t.villagerDesc}
                        </p>
                      </div>
                      {me?.role !== 'Villager' && !me?.target && (
                        <div className="text-[10px] font-mono uppercase tracking-widest text-white/30 animate-pulse">
                          {t.selectTarget}
                        </div>
                      )}
                      {me?.target && (
                        <div className="text-xs font-bold text-white/90 bg-white/10 px-3 py-1 rounded-full">
                          {t.targetSelected}: {gameState.players.find(p => p.id === me.target)?.name}
                        </div>
                      )}
                    </motion.div>
                  )}

                  {gameState.logs.slice(-5).map((log, i) => (
                    <motion.div 
                      key={i}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="p-4 bg-white/5 border border-white/10 rounded-xl text-sm text-white/70"
                    >
                      {translateLog(log)}
                    </motion.div>
                  ))}
                </div>
              )}
            </AnimatePresence>
          </div>

          {/* Chat Interface */}
          <div className="h-80 lg:h-96 bg-[#151619] border-t border-white/10 flex flex-col">
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {chats.map((chat, i) => (
                <div key={i} className={cn("flex flex-col", chat.isSystem ? "items-center" : "items-start")}>
                  {!chat.isSystem && <span className="text-[10px] font-mono text-white/30 uppercase mb-0.5">{chat.sender}</span>}
                  <div className={cn(
                    "px-3 py-2 rounded-2xl text-sm max-w-[80%]",
                    chat.isSystem ? "bg-white/5 text-white/40 italic text-xs" : 
                    chat.sender === playerName ? "bg-red-600 text-white rounded-tr-none self-end" : "bg-white/10 text-white/90 rounded-tl-none"
                  )}>
                    {chat.message}
                  </div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
            
            <form onSubmit={handleSendChat} className="p-4 bg-black/20 border-t border-white/10 flex gap-2">
              <input 
                type="text" 
                value={chatMessage}
                onChange={e => setChatMessage(e.target.value)}
                placeholder={isAlive ? t.typeMessage : t.spectatorsNoChat}
                disabled={!isAlive && gameState.phase !== 'Lobby'}
                className="flex-1 bg-black/40 border border-white/10 rounded-xl px-4 py-2 focus:outline-none focus:border-red-600/50 transition-colors text-sm"
              />
              <button 
                type="submit"
                disabled={!isAlive && gameState.phase !== 'Lobby'}
                className="bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:hover:bg-red-600 text-white p-2 rounded-xl transition-colors"
              >
                <Send className="w-5 h-5" />
              </button>
            </form>
          </div>
        </section>
      </main>

      {/* Confirmation Modal */}
      <AnimatePresence>
        {pendingAction && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="w-full max-w-sm bg-[#151619] border border-white/10 rounded-2xl p-6 shadow-2xl"
            >
              <h3 className="text-xl font-bold uppercase italic tracking-tight mb-2">{t.confirmAction}</h3>
              <p className="text-white/60 text-sm mb-6">
                {t.confirmPrompt} <span className="text-white font-bold underline decoration-red-500">{pendingAction.actionName}</span> <span className="text-white font-bold">{pendingAction.targetName}</span>?
              </p>
              
              <div className="flex gap-3">
                <button 
                  onClick={() => setPendingAction(null)}
                  className="flex-1 bg-white/5 hover:bg-white/10 text-white font-bold py-3 rounded-xl transition-colors"
                >
                  {t.cancel}
                </button>
                <button 
                  onClick={() => {
                    sendMessage({ type: pendingAction.type, targetId: pendingAction.targetId });
                    setPendingAction(null);
                  }}
                  className={cn(
                    "flex-1 text-white font-bold py-3 rounded-xl transition-colors shadow-lg",
                    pendingAction.actionName === t.eliminate ? "bg-red-600 hover:bg-red-700 shadow-red-600/20" :
                    pendingAction.actionName === t.save ? "bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/20" :
                    pendingAction.actionName === t.investigate ? "bg-blue-600 hover:bg-blue-700 shadow-blue-600/20" :
                    "bg-yellow-600 hover:bg-yellow-700 shadow-yellow-600/20"
                  )}
                >
                  {t.confirm}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
