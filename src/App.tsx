import React, { useState, useEffect, useRef } from 'react';
import { Mic, Send, Trash2, Edit2, Trophy, History, Activity, AlertCircle, UserPlus, Users, X, Search, BarChart3, PieChart, TrendingUp, Calendar, Zap, Clock } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { functions, httpsCallable, db } from './firebase';
import { collection, onSnapshot, addDoc, deleteDoc, updateDoc, doc, query, orderBy } from 'firebase/firestore';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart as RePieChart, Pie, Cell, LineChart, Line, AreaChart, Area
} from 'recharts';

// --- Types ---

type Category = 'A' | 'B' | 'C' | 'D' | 'E' | 'Master' | 'Kids';

interface Player {
  id: string;
  fullName: string;
  nicknames: string[];
  email: string;
  category: Category;
}

interface Match {
  id: string;
  player1: string; // Stores fullName
  score1: number;
  player2: string; // Stores fullName
  score2: number;
  timestamp: number;
}

interface PlayerStats {
  name: string;
  nicknames: string[];
  category: string;
  rating: number;
  wins: number;
  losses: number;
  matchesPlayed: number;
}

// --- Constants ---

const INITIAL_RATING = 1200;
const K_FACTOR = 32;
const CATEGORIES: Category[] = ['A', 'B', 'C', 'D', 'E', 'Master', 'Kids'];
// @ts-ignore
const APP_VERSION = __APP_VERSION__;

// --- Helper Functions ---

const generateId = () => Math.random().toString(36).substr(2, 9);

const calculateElo = (ratingA: number, ratingB: number, actualScoreA: number) => {
  const expectedScoreA = 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
  return Math.round(ratingA + K_FACTOR * (actualScoreA - expectedScoreA));
};

const computeRankings = (matches: Match[], players: Player[]): PlayerStats[] => {
  const stats: Record<string, PlayerStats> = {};

  // Initialize all registered players
  players.forEach(p => {
    stats[p.fullName] = {
      name: p.fullName,
      nicknames: p.nicknames,
      category: p.category,
      rating: INITIAL_RATING,
      wins: 0,
      losses: 0,
      matchesPlayed: 0,
    };
  });

  // Sort matches by timestamp
  const sortedMatches = [...matches].sort((a, b) => a.timestamp - b.timestamp);

  const getPlayer = (name: string) => {
    // If player was deleted but match exists, we might need a fallback or just ignore
    // For this app, we'll create a ghost entry if missing (shouldn't happen if integrity is kept)
    if (!stats[name]) {
      stats[name] = {
        name,
        nicknames: ['Desconhecido'],
        category: '?',
        rating: INITIAL_RATING,
        wins: 0,
        losses: 0,
        matchesPlayed: 0,
      };
    }
    return stats[name];
  };

  for (const match of sortedMatches) {
    const p1 = getPlayer(match.player1);
    const p2 = getPlayer(match.player2);

    let actualScoreP1 = 0.5;
    if (match.score1 > match.score2) {
      actualScoreP1 = 1;
      p1.wins++;
      p2.losses++;
    } else if (match.score2 > match.score1) {
      actualScoreP1 = 0;
      p2.wins++;
      p1.losses++;
    }

    const newRatingP1 = calculateElo(p1.rating, p2.rating, actualScoreP1);
    const newRatingP2 = calculateElo(p2.rating, p1.rating, 1 - actualScoreP1);

    p1.rating = newRatingP1;
    p2.rating = newRatingP2;

    p1.matchesPlayed++;
    p2.matchesPlayed++;
  }

  return Object.values(stats).sort((a, b) => b.rating - a.rating);
};

// --- Main Component ---

export default function App() {
  const [matches, setMatches] = useState<Match[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);

  // Firestore Sync
  useEffect(() => {
    // Sync Matches
    const q = query(collection(db, "matches"), orderBy("timestamp", "asc"));
    const unsubscribeMatches = onSnapshot(q, (snapshot) => {
      const ms = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Match));
      setMatches(ms);
    });

    // Sync Players
    const unsubscribePlayers = onSnapshot(collection(db, "players"), (snapshot) => {
      const ps = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Player));
      setPlayers(ps);
    });

    return () => {
      unsubscribeMatches();
      unsubscribePlayers();
    };
  }, []);

  const [inputText, setInputText] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPlayerModal, setShowPlayerModal] = useState(false);
  const [matchToDelete, setMatchToDelete] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'ranking' | 'players' | 'dashboard'>('ranking');
  const [isWatch, setIsWatch] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    const checkWatch = () => {
      // Smartwatches usually have small viewports.
      // Logical width < 300 is common for Apple Watch, Galaxy Watch, etc.
      setIsWatch(window.innerWidth > 0 && window.innerWidth < 460);
    };
    checkWatch();
    window.addEventListener('resize', checkWatch);
    return () => window.removeEventListener('resize', checkWatch);
  }, []);
  const [playerToEdit, setPlayerToEdit] = useState<Player | null>(null);

  // New Player Form State
  const [newPlayerName, setNewPlayerName] = useState('');
  const [newPlayerNick, setNewPlayerNick] = useState(''); // Comma separated for input
  const [newPlayerEmail, setNewPlayerEmail] = useState('');
  const [newPlayerCategory, setNewPlayerCategory] = useState<Category>('C');

  // Derived state
  const rankings = computeRankings(matches, players);
  const recentMatches = [...matches].sort((a, b) => b.timestamp - a.timestamp).slice(0, 5);

  // LocalStorage effects removed in favor of Firestore sync

  // Speech Recognition
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = false;
      recognitionRef.current.lang = 'pt-BR'; // Portuguese

      recognitionRef.current.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        setInputText(transcript);
        setIsListening(false);
        handleProcessMatch(transcript);
      };

      recognitionRef.current.onerror = (event: any) => {
        console.error('Speech recognition error', event.error);
        setIsListening(false);
        setError('Erro no reconhecimento de voz. Tente digitar.');
      };

      recognitionRef.current.onend = () => {
        setIsListening(false);
      };
    }
  }, [players]); // Re-bind if players change? Not strictly necessary for recognition object but good practice if we used grammar lists

  const toggleListening = () => {
    if (!recognitionRef.current) {
      setError('Reconhecimento de voz não suportado neste navegador.');
      return;
    }
    if (isListening) {
      recognitionRef.current.stop();
    } else {
      setError(null);
      recognitionRef.current.start();
      setIsListening(true);
    }
  };

  // Gemini Processing
  const handleProcessMatch = async (text: string) => {
    if (!text.trim()) return;
    if (players.length < 2) {
      setError("Cadastre pelo menos 2 jogadores antes de registrar partidas.");
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      // Create a context string of registered players
      const playersList = players.map(p => `- ${p.fullName} (Apelidos: ${p.nicknames.join(', ')})`).join('\n');

      const processMatch = httpsCallable(functions, 'processMatch');
      const response = await processMatch({ text, playersList });
      const result = response.data as any;

      if (!result.valid) {
        throw new Error("Não entendi ou jogadores não encontrados. Use nomes cadastrados (ex: 'Koba 3 Vini 1').");
      }

      if (result.player1 === result.player2) {
        throw new Error("Os jogadores devem ser pessoas diferentes.");
      }

      // Add match to Firestore
      const newMatch = {
        player1: result.player1,
        score1: result.score1,
        player2: result.player2,
        score2: result.score2,
        timestamp: result.matchDate ? new Date(result.matchDate).getTime() : Date.now(),
      };

      await addDoc(collection(db, "matches"), newMatch);

      setInputText('');
      if (isWatch) {
        setSuccessMessage(`Registrado: ${result.player1} ${result.score1}x${result.score2} ${result.player2}`);
        setTimeout(() => setSuccessMessage(null), 5000);
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Erro ao processar. Tente novamente.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRegisterPlayer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPlayerName.trim() || !newPlayerNick.trim()) return;

    const nicknameArray = Array.from(new Set(newPlayerNick.split(',').map(n => n.trim()).filter(n => n !== '')));

    // Check duplicates (excluding current player if editing)
    const otherPlayers = playerToEdit ? players.filter(p => p.id !== playerToEdit.id) : players;

    if (otherPlayers.some(p => p.fullName.toLowerCase() === newPlayerName.toLowerCase())) {
      alert("Jogador com este nome já existe!");
      return;
    }

    try {
      if (playerToEdit) {
        // Update existing player
        const playerRef = doc(db, "players", playerToEdit.id);
        await updateDoc(playerRef, {
          fullName: newPlayerName.trim(),
          nicknames: nicknameArray,
          email: newPlayerEmail.trim(),
          category: newPlayerCategory
        });
      } else {
        // Create new player
        await addDoc(collection(db, "players"), {
          fullName: newPlayerName.trim(),
          nicknames: nicknameArray,
          email: newPlayerEmail.trim(),
          category: newPlayerCategory,
        });
      }
      resetPlayerForm();
    } catch (e) {
      console.error("Error saving player: ", e);
      alert("Erro ao salvar jogador");
    }
  };

  const resetPlayerForm = () => {
    setNewPlayerName('');
    setNewPlayerNick('');
    setNewPlayerEmail('');
    setNewPlayerCategory('C');
    setPlayerToEdit(null);
    setShowPlayerModal(false);
  };

  const openEditPlayer = (player: Player) => {
    setPlayerToEdit(player);
    setNewPlayerName(player.fullName);
    setNewPlayerNick(player.nicknames.join(', '));
    setNewPlayerEmail(player.email);
    setNewPlayerCategory(player.category);
    setShowPlayerModal(true);
  };

  const handleDeletePlayer = async (id: string) => {
    if (confirm("Tem certeza que deseja excluir este jogador? Isso não apagará as partidas dele, mas ele não aparecerá mais no ranking.")) {
      try {
        await deleteDoc(doc(db, "players", id));
      } catch (e) {
        console.error("Error deleting player: ", e);
      }
    }
  };

  const handleDeleteMatch = (id: string) => {
    setMatchToDelete(id);
  };

  const confirmDeleteMatch = async () => {
    if (matchToDelete) {
      try {
        await deleteDoc(doc(db, "matches", matchToDelete));
        setMatchToDelete(null);
      } catch (e) {
        console.error("Error deleting match: ", e);
      }
    }
  };

  const handleEditMatch = async (match: Match) => {
    setInputText(`${match.player1} ${match.score1} ${match.player2} ${match.score2}`);
    // Ideally we would update, but deleting and re-recording is the established flow here for simplicity
    try {
      await deleteDoc(doc(db, "matches", match.id));
    } catch (e) {
      console.error("Error deleting match for edit: ", e);
    }
  };

  if (isWatch) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4 text-center overflow-hidden">
        <div className="mb-2">
          <div className="flex items-center justify-center gap-1 mb-1">
            <Trophy className="w-4 h-4 text-yellow-500" />
            <span className="text-white font-bold text-xs tracking-widest uppercase">PongRank</span>
          </div>
        </div>

        <button
          onClick={toggleListening}
          disabled={isProcessing}
          className={`
            relative w-24 h-24 rounded-full flex items-center justify-center transition-all duration-300 active:scale-90
            ${isListening
              ? 'bg-red-500 shadow-[0_0_30px_rgba(239,68,68,0.5)] animate-pulse'
              : isProcessing
                ? 'bg-indigo-400 cursor-not-allowed'
                : 'bg-indigo-600 shadow-[0_0_20px_rgba(79,70,229,0.3)] hover:bg-indigo-500'}
          `}
        >
          {isProcessing ? (
            <div className="w-8 h-8 border-4 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            <Mic className={`w-10 h-10 text-white ${isListening ? 'scale-110' : ''}`} />
          )}
        </button>

        <div className="mt-4 h-12 flex flex-col items-center justify-center">
          <AnimatePresence mode="wait">
            {isListening && (
              <motion.p
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="text-indigo-300 text-[10px] font-medium animate-bounce"
              >
                Ouvindo...
              </motion.p>
            )}
            {isProcessing && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-slate-400 text-[10px]"
              >
                Processando...
              </motion.p>
            )}
            {successMessage && (
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                className="text-green-400 text-[10px] font-bold leading-tight px-2"
              >
                {successMessage}
              </motion.div>
            )}
            {error && !isListening && !isProcessing && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-red-400 text-[9px] px-2"
              >
                {error}
              </motion.p>
            )}
            {!isListening && !isProcessing && !successMessage && !error && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-slate-500 text-[10px]"
              >
                Toque para falar
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans selection:bg-indigo-100 selection:text-indigo-900">
      <div className="max-w-6xl mx-auto p-4 md:p-8">

        {/* Header */}
        <motion.header
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-10 flex flex-col md:flex-row items-center justify-between gap-4"
        >
          <div className="flex items-center gap-3">
            <div className="p-3 bg-indigo-600 rounded-2xl shadow-lg">
              <Trophy className="w-8 h-8 text-white" />
            </div>
            <div>
              <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-slate-900">
                Pong<span className="text-indigo-600">Rank</span>
              </h1>
              <p className="text-slate-500 text-sm md:text-base">Ranking de Tênis de Mesa</p>
            </div>
          </div>

          <div className="flex items-center gap-2 bg-white p-1 rounded-2xl shadow-sm border border-slate-100">
            <button
              onClick={() => setActiveTab('ranking')}
              className={`px-4 py-2 rounded-xl font-medium transition-all ${activeTab === 'ranking' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}
            >
              Ranking
            </button>
            <button
              onClick={() => setActiveTab('players')}
              className={`px-4 py-2 rounded-xl font-medium transition-all ${activeTab === 'players' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}
            >
              Jogadores
            </button>
            <button
              onClick={() => setActiveTab('dashboard')}
              className={`px-4 py-2 rounded-xl font-medium transition-all ${activeTab === 'dashboard' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}
            >
              Dashboard
            </button>
          </div>

          <button
            onClick={() => setShowPlayerModal(true)}
            className="flex items-center gap-2 bg-white text-indigo-600 px-4 py-2 rounded-xl font-medium shadow-sm border border-indigo-100 hover:bg-indigo-50 transition-colors"
          >
            <UserPlus className="w-5 h-5" />
            Novo Jogador
          </button>
        </motion.header>

        {activeTab === 'ranking' ? (
          <>
            {/* Input Section */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.1 }}
              className="max-w-3xl mx-auto mb-12 relative z-10"
            >
              <div className="bg-white rounded-2xl shadow-xl p-2 flex items-center border border-slate-100 focus-within:ring-4 focus-within:ring-indigo-100 transition-all duration-300">
                <input
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleProcessMatch(inputText)}
                  placeholder="Ex: 'Koba 3 Vini 1' ou 'Sarah venceu Tom 3 a 0'"
                  className="flex-1 bg-transparent border-none focus:ring-0 text-lg px-4 py-3 placeholder:text-slate-400"
                  disabled={isProcessing}
                />

                <div className="flex items-center gap-2 pr-2">
                  <button
                    onClick={toggleListening}
                    className={`p-3 rounded-xl transition-all duration-200 ${isListening
                      ? 'bg-red-100 text-red-600 animate-pulse'
                      : 'hover:bg-slate-100 text-slate-500 hover:text-indigo-600'
                      }`}
                    title="Comando de Voz"
                  >
                    <Mic className="w-6 h-6" />
                  </button>

                  <button
                    onClick={() => handleProcessMatch(inputText)}
                    disabled={isProcessing || !inputText.trim()}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white p-3 rounded-xl shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95"
                  >
                    {isProcessing ? (
                      <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      <Send className="w-6 h-6" />
                    )}
                  </button>
                </div>
              </div>

              <AnimatePresence>
                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="absolute top-full left-0 right-0 mt-3 flex items-center justify-center gap-2 text-red-500 bg-red-50 p-3 rounded-xl text-sm font-medium border border-red-100 shadow-sm"
                  >
                    <AlertCircle className="w-4 h-4" />
                    {error}
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>

            {/* Content Grid */}
            <div className="grid lg:grid-cols-12 gap-8">

              {/* Rankings Column */}
              <div className="lg:col-span-8 space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
                  <div className="flex items-center gap-3">
                    <Activity className="w-6 h-6 text-indigo-600" />
                    <h2 className="text-2xl font-bold text-slate-800">Classificação</h2>
                  </div>

                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Buscar jogador..."
                      className="pl-9 pr-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-sm w-full sm:w-64"
                    />
                  </div>
                </div>

                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                  {rankings.length === 0 ? (
                    <div className="p-12 text-center text-slate-400">
                      <Users className="w-16 h-16 mx-auto mb-4 opacity-20" />
                      <p className="text-lg">Nenhum jogador registrado.</p>
                      <button onClick={() => setShowPlayerModal(true)} className="text-indigo-600 font-medium hover:underline mt-2">
                        Cadastre o primeiro jogador
                      </button>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left">
                        <thead className="bg-slate-50 text-slate-500 text-xs uppercase font-semibold tracking-wider border-b border-slate-100">
                          <tr>
                            <th className="px-6 py-4">#</th>
                            <th className="px-6 py-4">Jogador</th>
                            <th className="px-6 py-4">Categoria</th>
                            <th className="px-6 py-4 text-right">Rating</th>
                            <th className="px-6 py-4 text-center">V / D</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                          {rankings
                            .filter(player =>
                              player.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                              player.nicknames.some(n => n.toLowerCase().includes(searchQuery.toLowerCase()))
                            )
                            .map((player, index) => (
                              <motion.tr
                                key={player.name}
                                initial={{ opacity: 0, x: -20 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: index * 0.05 }}
                                className="hover:bg-indigo-50/30 transition-colors group"
                              >
                                <td className="px-6 py-4">
                                  <span className={`
                                  inline-flex items-center justify-center w-8 h-8 rounded-full font-bold text-sm
                                  ${index === 0 ? 'bg-yellow-100 text-yellow-700' :
                                      index === 1 ? 'bg-slate-100 text-slate-700' :
                                        index === 2 ? 'bg-orange-100 text-orange-800' : 'text-slate-400'}
                                `}>
                                    {index + 1}
                                  </span>
                                </td>
                                <td className="px-6 py-4">
                                  <div className="font-bold text-slate-900">{player.name}</div>
                                  <div className="text-xs text-slate-500">"{player.nicknames.join(', ')}"</div>
                                </td>
                                <td className="px-6 py-4">
                                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-800">
                                    {player.category}
                                  </span>
                                </td>
                                <td className="px-6 py-4 text-right font-mono text-indigo-600 font-bold text-lg">
                                  {player.rating}
                                </td>
                                <td className="px-6 py-4 text-center text-sm">
                                  <span className="text-green-600 font-bold">{player.wins}</span>
                                  <span className="mx-1 text-slate-300">/</span>
                                  <span className="text-red-500 font-bold">{player.losses}</span>
                                </td>
                              </motion.tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>

              {/* Recent Matches Column */}
              <div className="lg:col-span-4 space-y-6">
                <div className="flex items-center gap-3 mb-4">
                  <History className="w-6 h-6 text-indigo-600" />
                  <h2 className="text-2xl font-bold text-slate-800">Últimos Jogos</h2>
                </div>

                <div className="space-y-3">
                  <AnimatePresence mode='popLayout'>
                    {recentMatches.length === 0 ? (
                      <div className="bg-white rounded-2xl p-8 text-center text-slate-400 border border-slate-200 border-dashed">
                        <p>Sem histórico recente.</p>
                      </div>
                    ) : (
                      recentMatches.map((match) => (
                        <motion.div
                          key={match.id}
                          layout
                          initial={{ opacity: 0, scale: 0.9 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.9 }}
                          className="bg-white rounded-xl p-4 shadow-sm border border-slate-200 hover:shadow-md transition-shadow group relative"
                        >
                          <div className="flex items-center justify-between mb-3">
                            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
                              {new Date(match.timestamp).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                            </span>
                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                onClick={() => handleEditMatch(match)}
                                className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                                title="Editar (Excluir e Recarregar)"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleDeleteMatch(match.id)}
                                className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                title="Excluir"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>

                          <div className="flex items-center justify-between">
                            <div className={`flex-1 flex flex-col items-start ${match.score1 > match.score2 ? 'font-bold text-slate-900' : 'text-slate-500'}`}>
                              <span className="text-base leading-tight">{match.player1}</span>
                            </div>
                            <div className="flex items-center gap-2 px-3">
                              <span className={`text-xl font-mono ${match.score1 > match.score2 ? 'text-indigo-600' : 'text-slate-300'}`}>{match.score1}</span>
                              <span className="text-slate-300 text-xs">-</span>
                              <span className={`text-xl font-mono ${match.score2 > match.score1 ? 'text-indigo-600' : 'text-slate-300'}`}>{match.score2}</span>
                            </div>
                            <div className={`flex-1 flex flex-col items-end ${match.score2 > match.score1 ? 'font-bold text-slate-900' : 'text-slate-500'}`}>
                              <span className="text-base leading-tight text-right">{match.player2}</span>
                            </div>
                          </div>
                        </motion.div>
                      ))
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </div>
          </>
        ) : activeTab === 'players' ? (
          /* Player Management Tab */
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
              <div className="flex items-center gap-3">
                <Users className="w-6 h-6 text-indigo-600" />
                <h2 className="text-2xl font-bold text-slate-800">Gestão de Jogadores</h2>
              </div>

              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Buscar por nome ou apelido..."
                  className="pl-9 pr-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-sm w-full sm:w-64"
                />
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-slate-50 text-slate-500 text-xs uppercase font-semibold tracking-wider border-b border-slate-100">
                    <tr>
                      <th className="px-6 py-4">Nome</th>
                      <th className="px-6 py-4">Apelidos</th>
                      <th className="px-6 py-4">Email</th>
                      <th className="px-6 py-4">Categoria</th>
                      <th className="px-6 py-4 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {players
                      .filter(p =>
                        p.fullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                        p.nicknames.some(n => n.toLowerCase().includes(searchQuery.toLowerCase()))
                      )
                      .map((player) => (
                        <tr key={player.id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-6 py-4 font-bold text-slate-900">{player.fullName}</td>
                          <td className="px-6 py-4 text-sm text-slate-500">{player.nicknames.join(', ')}</td>
                          <td className="px-6 py-4 text-sm text-slate-500">{player.email || '-'}</td>
                          <td className="px-6 py-4">
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700">
                              {player.category}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <div className="flex justify-end gap-2">
                              <button
                                onClick={() => openEditPlayer(player)}
                                className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleDeletePlayer(player.id)}
                                className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          </motion.div>
        ) : (
          /* Dashboard Tab */
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-8"
          >
            {/* Stats Overview */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: 'Total de Partidas', value: matches.length, icon: Activity, color: 'bg-blue-50 text-blue-600' },
                { label: 'Jogadores Ativos', value: players.length, icon: Users, color: 'bg-purple-50 text-purple-600' },
                { label: 'Sets Jogados', value: matches.reduce((acc, m) => acc + m.score1 + m.score2, 0), icon: Zap, color: 'bg-yellow-50 text-yellow-600' },
                { label: 'Média Sets/Jogo', value: matches.length ? (matches.reduce((acc, m) => acc + m.score1 + m.score2, 0) / matches.length).toFixed(1) : 0, icon: TrendingUp, color: 'bg-green-50 text-green-600' },
              ].map((stat, i) => (
                <div key={i} className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                  <div className={`w-10 h-10 ${stat.color} rounded-xl flex items-center justify-center mb-3`}>
                    <stat.icon className="w-6 h-6" />
                  </div>
                  <div className="text-2xl font-bold text-slate-900">{stat.value}</div>
                  <div className="text-xs text-slate-500 font-medium uppercase tracking-wider">{stat.label}</div>
                </div>
              ))}
            </div>

            <div className="grid lg:grid-cols-2 gap-8">
              {/* Matches per Day Chart */}
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                <div className="flex items-center gap-2 mb-6">
                  <Calendar className="w-5 h-5 text-indigo-600" />
                  <h3 className="font-bold text-slate-800">Atividade Recente (Partidas/Dia)</h3>
                </div>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={(() => {
                      const last7Days = [...Array(7)].map((_, i) => {
                        const d = new Date();
                        d.setDate(d.getDate() - i);
                        return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
                      }).reverse();

                      const counts = matches.reduce((acc: any, m) => {
                        const date = new Date(m.timestamp).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
                        acc[date] = (acc[date] || 0) + 1;
                        return acc;
                      }, {});

                      return last7Days.map(date => ({ date, partidas: counts[date] || 0 }));
                    })()}>
                      <defs>
                        <linearGradient id="colorPartidas" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.1} />
                          <stop offset="95%" stopColor="#4f46e5" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 12 }} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 12 }} />
                      <Tooltip
                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                      />
                      <Area type="monotone" dataKey="partidas" stroke="#4f46e5" strokeWidth={3} fillOpacity={1} fill="url(#colorPartidas)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Category Distribution */}
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                <div className="flex items-center gap-2 mb-6">
                  <PieChart className="w-5 h-5 text-indigo-600" />
                  <h3 className="font-bold text-slate-800">Distribuição por Categoria</h3>
                </div>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <RePieChart>
                      <Pie
                        data={CATEGORIES.map(cat => ({
                          name: cat,
                          value: players.filter(p => p.category === cat).length
                        })).filter(d => d.value > 0)}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={80}
                        paddingAngle={5}
                        dataKey="value"
                      >
                        {['#4f46e5', '#7c3aed', '#2563eb', '#0891b2', '#059669', '#d97706', '#dc2626'].map((color, index) => (
                          <Cell key={`cell-${index}`} fill={color} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </RePieChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* Curiosities & Top Stats */}
            <div className="grid md:grid-cols-3 gap-6">
              {/* Most Common Score */}
              <div className="bg-gradient-to-br from-indigo-600 to-violet-700 p-6 rounded-2xl text-white shadow-lg">
                <div className="flex items-center gap-2 mb-4 opacity-80">
                  <Zap className="w-5 h-5" />
                  <span className="text-sm font-bold uppercase tracking-wider">Placar Mais Comum</span>
                </div>
                <div className="text-4xl font-black mb-1">
                  {(() => {
                    const scores = matches.map(m => {
                      const s = [m.score1, m.score2].sort((a, b) => b - a);
                      return `${s[0]}-${s[1]}`;
                    });
                    const counts: any = {};
                    scores.forEach(s => counts[s] = (counts[s] || 0) + 1);
                    return Object.entries(counts).sort((a: any, b: any) => b[1] - a[1])[0]?.[0] || 'N/A';
                  })()}
                </div>
                <p className="text-indigo-100 text-sm">O resultado que mais se repete nas mesas.</p>
              </div>

              {/* Biggest Rivalry */}
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                <div className="flex items-center gap-2 mb-4 text-slate-400">
                  <Users className="w-5 h-5" />
                  <span className="text-sm font-bold uppercase tracking-wider">Maior Rivalidade</span>
                </div>
                <div className="text-xl font-bold text-slate-900 mb-1">
                  {(() => {
                    const rivalries: any = {};
                    matches.forEach(m => {
                      const key = [m.player1, m.player2].sort().join(' vs ');
                      rivalries[key] = (rivalries[key] || 0) + 1;
                    });
                    const top = Object.entries(rivalries).sort((a: any, b: any) => b[1] - a[1])[0];
                    return top ? top[0] : 'N/A';
                  })()}
                </div>
                <p className="text-slate-500 text-sm">A dupla que mais se enfrentou.</p>
              </div>

              {/* Most Dominant Player */}
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                <div className="flex items-center gap-2 mb-4 text-slate-400">
                  <Trophy className="w-5 h-5" />
                  <span className="text-sm font-bold uppercase tracking-wider">Mais Dominante</span>
                </div>
                <div className="text-xl font-bold text-slate-900 mb-1">
                  {rankings[0]?.name || 'N/A'}
                </div>
                <p className="text-slate-500 text-sm">O jogador com o maior rating atual.</p>
              </div>
            </div>
          </motion.div>
        )}
      </div>

      {/* Player Registration Modal */}
      <AnimatePresence>
        {showPlayerModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
            >
              <div className="flex items-center justify-between p-6 border-b border-slate-100">
                <h3 className="text-xl font-bold text-slate-900">{playerToEdit ? 'Editar Jogador' : 'Novo Jogador'}</h3>
                <button onClick={resetPlayerForm} className="text-slate-400 hover:text-slate-600">
                  <X className="w-6 h-6" />
                </button>
              </div>

              <form onSubmit={handleRegisterPlayer} className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Nome Completo</label>
                  <input
                    required
                    type="text"
                    value={newPlayerName}
                    onChange={e => setNewPlayerName(e.target.value)}
                    className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                    placeholder="Ex: Vinicius Silva"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Apelidos (separados por vírgula)</label>
                  <input
                    required
                    type="text"
                    value={newPlayerNick}
                    onChange={e => setNewPlayerNick(e.target.value)}
                    className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                    placeholder="Ex: Vini, Vinão, Silva"
                  />
                  <p className="text-[10px] text-slate-400 mt-1">A IA usará esses nomes para identificar o jogador por voz.</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
                  <input
                    type="email"
                    value={newPlayerEmail}
                    onChange={e => setNewPlayerEmail(e.target.value)}
                    className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                    placeholder="email@exemplo.com"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Categoria</label>
                  <select
                    value={newPlayerCategory}
                    onChange={e => setNewPlayerCategory(e.target.value as Category)}
                    className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none bg-white"
                  >
                    {CATEGORIES.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>

                <div className="pt-4">
                  <button
                    type="submit"
                    className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-xl shadow-lg hover:shadow-xl transition-all active:scale-95"
                  >
                    Cadastrar Jogador
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {matchToDelete && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden p-6 text-center"
            >
              <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Trash2 className="w-6 h-6 text-red-600" />
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-2">Excluir Partida?</h3>
              <p className="text-slate-500 mb-6">Esta ação não pode ser desfeita.</p>

              <div className="flex gap-3">
                <button
                  onClick={() => setMatchToDelete(null)}
                  className="flex-1 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-xl transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={confirmDeleteMatch}
                  className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-medium rounded-xl shadow-lg hover:shadow-xl transition-all active:scale-95"
                >
                  Excluir
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      <footer className="w-full text-center py-4 text-xs text-slate-400">
        v{APP_VERSION}
      </footer>
    </div>
  );
}
