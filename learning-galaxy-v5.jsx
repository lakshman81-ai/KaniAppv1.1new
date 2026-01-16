import React, { useState, useEffect, useCallback } from 'react';

// ============ MOBILE-COMPATIBLE STORAGE ============
const storage = {
  get: async (key) => {
    try {
      if (window.storage?.get) return await window.storage.get(key);
      const value = localStorage.getItem(key);
      return value ? { value } : null;
    } catch (e) { return null; }
  },
  set: async (key, value) => {
    try {
      if (window.storage?.set) return await window.storage.set(key, value);
      localStorage.setItem(key, value);
    } catch (e) { }
  }
};

// ============ GOOGLE SHEETS CONFIG ============
const DEFAULT_SETTINGS = {
  mathSheetUrl: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQr3nlml1JTPMR4ROfCKarFSayMFxYyOwZO-v_A0INlG1oMloM5wm0wltURipcy0A/pub?output=csv',
  englishSheetUrl: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRses_Y74IwZ6nFvmwMygKruq0HgQZZmOEYSdf3sE0pInXXByyU0uSf8KPY8Z6Giw/pub?output=csv',
  selectedMathWorksheet: '1',
  selectedEnglishWorksheet: '1',
  defaultDifficulty: 'None',
  soundEnabled: true,
  settingsSheetUrl: ''
};

// ============ ROBUST CSV PARSER (RFC 4180 compliant) ============
const parseCSV = (csv) => {
  if (!csv || typeof csv !== 'string') return [];

  // Parse a single CSV row with proper quote handling
  const parseRow = (row) => {
    const values = [];
    let current = '';
    let inQuotes = false;
    let i = 0;

    while (i < row.length) {
      const char = row[i];
      const nextChar = row[i + 1];

      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          // Escaped quote (doubled quotes within quoted field)
          current += '"';
          i += 2; // Skip both quotes
          continue;
        } else {
          // Toggle quote state
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        // End of field
        values.push(cleanValue(current));
        current = '';
      } else {
        // Regular character
        current += char;
      }
      i++;
    }

    // Push the last value
    values.push(cleanValue(current));
    return values;
  };

  // Clean and trim a CSV value
  const cleanValue = (value) => {
    // Trim whitespace
    value = value.trim();

    // Remove surrounding quotes if present
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }

    return value;
  };

  try {
    // Split into lines, but handle newlines within quoted fields
    const rows = [];
    let currentRow = '';
    let inQuotes = false;

    for (let i = 0; i < csv.length; i++) {
      const char = csv[i];
      const nextChar = csv[i + 1];

      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          currentRow += '""';
          i++; // Skip next quote
        } else {
          inQuotes = !inQuotes;
          currentRow += char;
        }
      } else if ((char === '\n' || char === '\r') && !inQuotes) {
        // End of row (only if not inside quotes)
        if (currentRow.trim()) {
          rows.push(currentRow);
        }
        currentRow = '';
        // Handle \r\n
        if (char === '\r' && nextChar === '\n') i++;
      } else {
        currentRow += char;
      }
    }

    // Don't forget last row
    if (currentRow.trim()) {
      rows.push(currentRow);
    }

    if (rows.length < 2) return [];

    // Parse header row
    const headers = parseRow(rows[0]).map(h => h.toLowerCase());

    // Parse data rows
    return rows.slice(1).map(row => {
      const values = parseRow(row);
      const obj = {};
      headers.forEach((h, i) => {
        obj[h] = values[i] || '';
      });
      return obj;
    }).filter(obj => {
      // Filter out empty rows
      return Object.values(obj).some(v => v.trim());
    });

  } catch (e) {
    console.error('CSV parsing error:', e);
    return [];
  }
};

// ============ DATA FETCHING HOOK WITH CACHE ============
const CACHE_DURATION = 60 * 60 * 1000; // 1 hour in milliseconds

const getCacheKey = (url) => `sheet-cache-${btoa(url).substring(0, 50)}`;

const getCachedData = (url) => {
  try {
    const cacheKey = getCacheKey(url);
    const cached = localStorage.getItem(cacheKey);
    if (!cached) return null;

    const { data, timestamp } = JSON.parse(cached);
    const age = Date.now() - timestamp;

    // Return cached data if less than 1 hour old
    if (age < CACHE_DURATION) {
      return data;
    }

    // Clear expired cache
    localStorage.removeItem(cacheKey);
    return null;
  } catch (e) {
    return null;
  }
};

const setCachedData = (url, data) => {
  try {
    const cacheKey = getCacheKey(url);
    const cacheEntry = { data, timestamp: Date.now() };
    localStorage.setItem(cacheKey, JSON.stringify(cacheEntry));
  } catch (e) {
    // Ignore cache write errors (quota exceeded, etc.)
  }
};

// ============ ERROR HELPERS ============
const getErrorDetails = (error) => {
  const errorMessage = error.message || String(error);

  // Network/CORS errors
  if (errorMessage.includes('Failed to fetch') || errorMessage.includes('NetworkError')) {
    return {
      title: 'Network Error',
      message: errorMessage,
      hints: [
        'Check your internet connection',
        'Try disabling VPN or proxy if enabled',
        'Firewall might be blocking the connection'
      ]
    };
  }

  // HTTP errors
  if (errorMessage.includes('HTTP 404')) {
    return {
      title: 'Sheet Not Found',
      message: 'Google Sheet not found or not published',
      hints: [
        'Verify the Sheet URL in Settings',
        'Ensure the Sheet is published to web',
        'Check: File → Share → Publish to web → CSV'
      ]
    };
  }

  if (errorMessage.includes('HTTP 403')) {
    return {
      title: 'Access Denied',
      message: 'Cannot access the Google Sheet',
      hints: [
        'Sheet must be published to web (not just shared)',
        'Go to File → Share → Publish to web',
        'Select "Comma-separated values (.csv)" format'
      ]
    };
  }

  if (errorMessage.includes('HTTP 500') || errorMessage.includes('HTTP 503')) {
    return {
      title: 'Server Error',
      message: 'Google Sheets is temporarily unavailable',
      hints: [
        'This is a temporary issue with Google',
        'Try again in a few minutes',
        'Check Google Workspace Status'
      ]
    };
  }

  // CORS errors
  if (errorMessage.includes('CORS') || errorMessage.includes('cross-origin')) {
    return {
      title: 'Security Error',
      message: 'Cannot load data due to browser security',
      hints: [
        'Ensure Sheet is published as CSV',
        'URL must end with "?output=csv"',
        'Try a different browser if issue persists'
      ]
    };
  }

  // Parse errors
  if (errorMessage.includes('parse') || errorMessage.includes('JSON')) {
    return {
      title: 'Data Format Error',
      message: 'Sheet data is not in valid CSV format',
      hints: [
        'Check for special characters in questions',
        'Ensure CSV format is correct',
        'Try re-publishing the Sheet'
      ]
    };
  }

  // Generic error
  return {
    title: 'Connection Error',
    message: errorMessage,
    hints: [
      'Check your internet connection',
      'Verify the Sheet URL in Settings',
      'Contact support if issue persists'
    ]
  };
};

// ============ NETWORK RETRY UTILITY ============
const fetchWithRetry = async (url, maxRetries = 3) => {
  let lastError;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return await response.text();
    } catch (error) {
      lastError = error;

      // Don't retry on last attempt
      if (attempt < maxRetries - 1) {
        // Exponential backoff: 1s, 2s, 4s
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
};

const useSheetData = (url, gameType) => {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [retryTrigger, setRetryTrigger] = useState(0);
  const [fromCache, setFromCache] = useState(false);

  useEffect(() => {
    if (!url) { setLoading(false); return; }

    // Try to load from cache first
    const cached = getCachedData(url);
    if (cached) {
      const parsed = parseCSV(cached);
      const filtered = gameType ? parsed.filter(row => row.game_type === gameType) : parsed;
      setData(filtered);
      setFromCache(true);
      setLoading(false);

      // Still fetch in background to update cache (with retry)
      fetchWithRetry(url)
        .then(csv => {
          setCachedData(url, csv);
          const parsed = parseCSV(csv);
          const filtered = gameType ? parsed.filter(row => row.game_type === gameType) : parsed;
          setData(filtered);
          setFromCache(false);
        })
        .catch(() => {
          // Silently fail background update, already have cached data
        });
      return;
    }

    // No cache - fetch normally with retry
    setLoading(true);
    setError(null);
    setFromCache(false);
    fetchWithRetry(url)
      .then(csv => {
        setCachedData(url, csv);
        const parsed = parseCSV(csv);
        const filtered = gameType ? parsed.filter(row => row.game_type === gameType) : parsed;
        setData(filtered);
        setLoading(false);
      })
      .catch(err => { setError(err.message); setLoading(false); });
  }, [url, gameType, retryTrigger]);

  const retry = () => setRetryTrigger(prev => prev + 1);

  return { data, loading, error, retry, fromCache };
};

// ============ SHARED COMPONENTS ============
const StarIcon = ({ className = "w-5 h-5" }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
  </svg>
);

const DifficultyBadge = ({ difficulty }) => {
  const colors = { Easy: 'bg-green-500', Medium: 'bg-yellow-500', Hard: 'bg-red-500' };
  return <span className={`${colors[difficulty] || 'bg-gray-500'} text-white text-xs px-2 py-1 rounded-full font-bold`}>{difficulty}</span>;
};

const LoadingSpinner = () => (
  <div className="flex flex-col items-center justify-center">
    <div className="w-12 h-12 border-4 border-purple-500 border-t-transparent rounded-full animate-spin mb-4"></div>
    <p className="text-white">Loading questions...</p>
  </div>
);

const Header = ({ timer, streak, stars, onBack, formatTime, difficulty }) => (
  <div className="absolute top-4 left-4 right-4 flex justify-between items-center z-20">
    <div className="flex items-center gap-4">
      <button onClick={onBack} className="w-10 h-10 rounded-full bg-gray-900/80 flex items-center justify-center text-white hover:bg-gray-700 transition-colors cursor-pointer">←</button>
      <div className="flex items-center bg-gray-900/80 rounded-lg p-2 backdrop-blur">
        <div>
          <div className="text-xl font-bold text-white">{formatTime(timer)}</div>
          <div className="text-xs text-blue-300">TIMER</div>
        </div>
        <div className="ml-3 border-l border-gray-600 pl-3">
          <div className="text-xl font-bold text-orange-400">{streak}</div>
          <div className="text-xs text-orange-300">STREAK</div>
        </div>
        {difficulty && <div className="ml-3 border-l border-gray-600 pl-3"><DifficultyBadge difficulty={difficulty} /></div>}
      </div>
    </div>
    <div className="flex items-center gap-2">
      <div className="bg-yellow-500 text-white px-3 py-1 rounded-l-full font-bold flex items-center gap-1"><StarIcon className="w-4 h-4" /></div>
      <div className="bg-gray-200 text-gray-800 px-4 py-1 rounded-r-full font-bold min-w-16 text-center">{stars}</div>
    </div>
  </div>
);

const GameOverScreen = ({ stars, streak, onRestart, onBack, onSaveScore, playerName, setPlayerName, scoreSaved }) => (
  <div className="text-center bg-gray-900/80 p-8 rounded-2xl backdrop-blur max-w-sm mx-4 relative z-30">
    <h2 className="text-4xl font-bold text-white mb-2">Game Over!</h2>
    <div className="flex items-center justify-center gap-2 mb-4">
      <StarIcon className="w-10 h-10 text-yellow-400" />
      <span className="text-5xl font-bold text-yellow-400">{stars}</span>
    </div>
    <p className="text-purple-300 mb-6">Best Streak: {streak}</p>
    {!scoreSaved && (
      <div className="mb-6">
        <input type="text" placeholder="Enter your name" value={playerName} onChange={(e) => setPlayerName(e.target.value)}
          className="px-4 py-2 rounded-lg bg-gray-700 text-white border border-gray-600 focus:border-yellow-500 focus:outline-none w-full mb-2" maxLength={20} />
        <button onClick={onSaveScore} disabled={!playerName.trim()}
          className="bg-yellow-500 text-white px-4 py-2 rounded-lg font-bold hover:bg-yellow-400 disabled:opacity-50 w-full cursor-pointer">Save Score</button>
      </div>
    )}
    {scoreSaved && <p className="text-green-400 mb-6">✓ Score saved!</p>}
    <div className="flex gap-4 justify-center">
      <button onClick={onBack} className="bg-gray-600 text-white px-6 py-3 rounded-full font-bold hover:bg-gray-500 cursor-pointer">HOME</button>
      <button onClick={onRestart} className="bg-gradient-to-r from-orange-500 to-yellow-500 text-white px-6 py-3 rounded-full font-bold hover:scale-105 transition-transform cursor-pointer">PLAY AGAIN</button>
    </div>
  </div>
);

const SpaceBackground = ({ children, variant = 'default' }) => {
  const [bubbles] = useState(() => Array.from({ length: 30 }, (_, i) => ({
    id: i, x: Math.random() * 100, y: Math.random() * 100, size: Math.random() * 3 + 1, duration: Math.random() * 3 + 2
  })));
  const gradients = {
    default: 'linear-gradient(180deg, #1a0a2e 0%, #2d1b4e 50%, #4a2c7a 100%)',
    english: 'linear-gradient(180deg, #0a1628 0%, #1e3a5f 50%, #2d5a87 100%)',
    grammar: 'linear-gradient(180deg, #1a1a2e 0%, #2e1f5e 50%, #4a3c7a 100%)',
    vocabulary: 'linear-gradient(180deg, #1a2a1a 0%, #2e4e2e 50%, #3a6a3a 100%)',
    comprehension: 'linear-gradient(180deg, #0a2020 0%, #1e4a4a 50%, #2d6a6a 100%)',
    math: 'linear-gradient(180deg, #1a0a2e 0%, #2d1b4e 50%, #4a2c7a 100%)'
  };
  return (
    <div className="relative w-full h-screen overflow-hidden" style={{ background: gradients[variant] }}>
      <div className="pointer-events-none absolute inset-0">
        {bubbles.map(bubble => (
          <div key={bubble.id} className="absolute rounded-full bg-white opacity-60"
            style={{ left: `${bubble.x}%`, top: `${bubble.y}%`, width: bubble.size, height: bubble.size, animation: `twinkle ${bubble.duration}s ease-in-out infinite` }} />
        ))}
      </div>
      <div className="relative z-10 h-full">{children}</div>
      <style>{`
        @keyframes twinkle { 0%, 100% { opacity: 0.3; } 50% { opacity: 1; } }
        @keyframes float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
        @keyframes slideIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes shake { 0%, 100% { transform: translateX(0); } 25% { transform: translateX(-5px); } 75% { transform: translateX(5px); } }
      `}</style>
    </div>
  );
};

const formatTime = (s) => `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;

// ============ GENERIC GAME COMPONENT (Sheet-Integrated) ============
const SheetBasedGame = ({ onBack, difficulty, onGameEnd, settings, gameId, title, icon, color, variant, questionType }) => {
  const isMath = ['space-math', 'alien-invasion', 'bubble-pop', 'planet-hopper', 'fraction-frenzy', 'time-warp', 'money-master', 'geometry-galaxy'].includes(gameId);
  const sheetUrl = isMath ? settings.mathSheetUrl : settings.englishSheetUrl;
  const { data: allQuestions, loading, error, retry } = useSheetData(sheetUrl, gameId);

  const [stars, setStars] = useState(0);
  const [timer, setTimer] = useState(difficulty === 'Hard' ? 30 : difficulty === 'Medium' ? 40 : 50);
  const [gameActive, setGameActive] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const [currentQ, setCurrentQ] = useState(null);
  const [streak, setStreak] = useState(0);
  const [maxStreak, setMaxStreak] = useState(0);
  const [feedback, setFeedback] = useState(null);
  const [playerName, setPlayerName] = useState('');
  const [scoreSaved, setScoreSaved] = useState(false);
  const [usedIndices, setUsedIndices] = useState(new Set());

  const questions = allQuestions.filter(q => !q.difficulty || q.difficulty === difficulty || difficulty === 'All');

  const getNextQuestion = useCallback(() => {
    if (questions.length === 0) return null;
    let available = questions.filter((_, i) => !usedIndices.has(i));
    if (available.length === 0) { setUsedIndices(new Set()); available = questions; }
    const idx = Math.floor(Math.random() * available.length);
    const realIdx = questions.indexOf(available[idx]);
    setUsedIndices(prev => new Set([...prev, realIdx]));
    return available[idx];
  }, [questions, usedIndices]);

  const generateQuestion = useCallback(() => {
    const q = getNextQuestion();
    if (q) setCurrentQ(q);
  }, [getNextQuestion]);

  useEffect(() => {
    // Only start timer if game is active AND a question is loaded
    if (gameActive && timer > 0 && currentQ) {
      const interval = setInterval(() => setTimer(t => t - 1), 1000);
      return () => clearInterval(interval);
    } else if (timer === 0 && gameActive) {
      setGameActive(false);
      setGameOver(true);
    }
  }, [gameActive, timer, currentQ]);

  const startGame = () => {
    setStars(0);
    setTimer(difficulty === 'Hard' ? 30 : difficulty === 'Medium' ? 40 : 50);
    setStreak(0);
    setMaxStreak(0);
    setUsedIndices(new Set());
    setGameActive(true);
    setGameOver(false);
    setScoreSaved(false);
    setPlayerName('');
    generateQuestion();
  };

  const handleAnswer = (selected, correct) => {
    if (!gameActive || feedback) return;
    const isCorrect = selected === correct;
    if (isCorrect) {
      const mult = difficulty === 'Hard' ? 2 : difficulty === 'Medium' ? 1.5 : 1;
      setStars(s => s + Math.floor((15 + streak * 3) * mult));
      setStreak(s => { const n = s + 1; setMaxStreak(m => Math.max(m, n)); return n; });
      setFeedback({ correct: true });
    } else {
      setStreak(0);
      setFeedback({ correct: false, answer: correct });
    }
    setTimeout(() => { setFeedback(null); generateQuestion(); }, 800);
  };

  const handleSaveScore = async () => {
    if (!playerName.trim()) return;
    await onGameEnd(gameId, playerName, stars, maxStreak);
    setScoreSaved(true);
  };

  // Render question based on game type
  const renderQuestion = () => {
    if (!currentQ) return <p className="text-white">No questions available</p>;

    // Math equations (space-math, alien-invasion, bubble-pop)
    if (['space-math', 'alien-invasion', 'bubble-pop'].includes(gameId)) {
      const options = [currentQ.option1, currentQ.option2, currentQ.option3, currentQ.option4].filter(Boolean);
      return (
        <div className="w-full max-w-lg">
          <div className="bg-gray-900/80 rounded-2xl p-6 backdrop-blur mb-6 text-center">
            <div className="text-white text-4xl font-bold mb-2">
              {currentQ.num1} {currentQ.operation} {currentQ.num2} = ?
            </div>
            {currentQ.hint && <p className="text-gray-400 text-sm">{currentQ.hint}</p>}
          </div>
          <div className="grid grid-cols-2 gap-3 relative z-20">
            {options.map((opt, i) => (
              <button key={i} onClick={() => handleAnswer(opt, currentQ.answer)}
                className={`p-4 rounded-xl text-2xl font-bold transition-all cursor-pointer ${feedback ? (opt === currentQ.answer ? 'bg-green-500 text-white' : 'bg-gray-700 text-gray-400')
                  : `bg-gradient-to-r ${color} text-white hover:scale-105`
                  }`}>{opt}</button>
            ))}
          </div>
        </div>
      );
    }

    // Sequences (planet-hopper)
    if (gameId === 'planet-hopper') {
      // New format: num1 = "2 4 6 ? 10", answer = "8"
      const seqParts = currentQ.num1 ? currentQ.num1.split(' ') : [];
      const options = [currentQ.option1, currentQ.option2, currentQ.option3, currentQ.option4].filter(Boolean);
      return (
        <div className="w-full max-w-lg">
          <div className="flex justify-center gap-2 mb-6 flex-wrap">
            {seqParts.map((part, i) => (
              <div key={i} className={`w-14 h-14 rounded-full flex items-center justify-center text-lg font-bold text-white shadow-lg border-4 border-white/30 ${part === '?' ? 'bg-gray-600' : 'bg-gradient-to-b from-purple-400 to-purple-600'
                }`} style={{ animation: 'float 3s ease-in-out infinite' }}>
                {part}
              </div>
            ))}
          </div>
          <p className="text-white text-center mb-4">Find the missing number!</p>
          {currentQ.hint && <p className="text-gray-400 text-sm text-center mb-4">{currentQ.hint}</p>}
          <div className="grid grid-cols-2 gap-3 relative z-20">
            {options.map((opt, i) => (
              <button key={i} onClick={() => handleAnswer(opt, currentQ.answer)}
                className={`p-4 rounded-xl text-xl font-bold transition-all cursor-pointer ${feedback ? (opt === currentQ.answer ? 'bg-green-500 text-white' : 'bg-gray-700 text-gray-400')
                  : 'bg-gradient-to-r from-purple-500 to-pink-500 text-white hover:scale-105'
                  }`}>{opt}</button>
            ))}
          </div>
        </div>
      );
    }

    // Grammar
    if (gameId === 'grammar-galaxy') {
      const options = [currentQ.option1, currentQ.option2, currentQ.option3, currentQ.option4].filter(Boolean);
      return (
        <div className="w-full max-w-lg">
          <div className="bg-gray-900/80 rounded-2xl p-6 backdrop-blur mb-6">
            <div className="text-xs text-purple-400 mb-2">{currentQ.text2}</div>
            <div className="text-white text-2xl font-medium text-center">"{currentQ.text1}"</div>
          </div>
          <p className="text-purple-200 text-center mb-4">Choose the correct word:</p>
          <div className="grid grid-cols-2 gap-3 relative z-20">
            {options.map((opt, i) => (
              <button key={i} onClick={() => handleAnswer(opt, currentQ.answer)}
                className={`p-4 rounded-xl text-lg font-bold transition-all cursor-pointer ${feedback ? (opt === currentQ.answer ? 'bg-green-500 text-white' : 'bg-gray-700 text-gray-400')
                  : 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white hover:scale-105'
                  }`}>{opt}</button>
            ))}
          </div>
        </div>
      );
    }

    // Word class
    if (gameId === 'word-class-warp') {
      const categories = ['noun', 'verb', 'adjective', 'adverb'];
      const icons = { noun: '📦', verb: '🏃', adjective: '🎨', adverb: '⚡' };
      const colors_map = { noun: 'from-red-500 to-orange-500', verb: 'from-green-500 to-emerald-500', adjective: 'from-blue-500 to-purple-500', adverb: 'from-yellow-500 to-amber-500' };
      return (
        <div className="w-full max-w-lg">
          <div className="bg-gray-900/80 rounded-2xl p-8 backdrop-blur mb-8 text-center">
            <div className="text-4xl font-bold text-white" style={{ animation: 'float 2s ease-in-out infinite' }}>{currentQ.text1}</div>
          </div>
          <div className="grid grid-cols-2 gap-4 relative z-20">
            {categories.map(cat => (
              <button key={cat} onClick={() => handleAnswer(cat, currentQ.answer)}
                className={`p-6 rounded-2xl text-white font-bold text-lg transition-all hover:scale-105 cursor-pointer bg-gradient-to-br ${colors_map[cat]} ${feedback && cat === currentQ.answer ? 'ring-4 ring-green-400' : ''
                  }`}>
                <div className="text-3xl mb-2">{icons[cat]}</div>
                {cat.charAt(0).toUpperCase() + cat.slice(1)}
              </button>
            ))}
          </div>
        </div>
      );
    }

    // Punctuation
    if (gameId === 'punctuation-pop') {
      const marks = ['.', '?', '!', ','];
      return (
        <div className="w-full max-w-lg">
          <div className="bg-gray-900/80 rounded-2xl p-6 backdrop-blur mb-6">
            <div className="text-white text-2xl font-medium text-center">
              {currentQ.text1}<span className="text-yellow-400 text-3xl animate-pulse">_</span>
            </div>
          </div>
          <div className="flex justify-center gap-4 relative z-20">
            {marks.map(mark => (
              <button key={mark} onClick={() => handleAnswer(mark, currentQ.answer)}
                className={`w-16 h-16 rounded-full text-3xl font-bold transition-all hover:scale-110 cursor-pointer ${feedback && mark === currentQ.answer ? 'bg-green-500 text-white' : 'bg-gradient-to-b from-pink-400 to-rose-500 text-white'
                  }`}>{mark}</button>
            ))}
          </div>
        </div>
      );
    }

    // Tenses
    if (gameId === 'tense-traveler') {
      const options = [currentQ.option1, currentQ.option2, currentQ.option3, currentQ.option4].filter(Boolean);
      const tenseColors = { past: 'from-amber-600 to-orange-700', present: 'from-green-500 to-emerald-600', future: 'from-blue-500 to-indigo-600' };
      const tenseIcons = { past: '⏪', present: '▶️', future: '⏩' };
      return (
        <div className="w-full max-w-lg">
          <div className={`bg-gradient-to-r ${tenseColors[currentQ.text2] || 'from-gray-500 to-gray-600'} rounded-2xl p-4 mb-4 text-center`}>
            <div className="text-3xl mb-1">{tenseIcons[currentQ.text2] || '🕐'}</div>
            <div className="text-white text-xl font-bold">{(currentQ.text2 || 'TENSE').toUpperCase()}</div>
          </div>
          <div className="bg-gray-900/80 rounded-2xl p-6 backdrop-blur mb-6 text-center">
            <div className="text-gray-400 text-sm mb-2">Convert this verb:</div>
            <div className="text-white text-4xl font-bold">{currentQ.text1}</div>
          </div>
          <div className="grid grid-cols-2 gap-3 relative z-20">
            {options.map((opt, i) => (
              <button key={i} onClick={() => handleAnswer(opt, currentQ.answer)}
                className={`p-4 rounded-xl text-lg font-bold transition-all cursor-pointer ${feedback ? (opt === currentQ.answer ? 'bg-green-500 text-white' : 'bg-gray-700 text-gray-400')
                  : 'bg-gradient-to-r from-teal-600 to-emerald-600 text-white hover:scale-105'
                  }`}>{opt}</button>
            ))}
          </div>
        </div>
      );
    }

    // Synonyms & Antonyms
    if (gameId === 'synonym-stars' || gameId === 'antonym-asteroids') {
      const options = [currentQ.answer, currentQ.option2, currentQ.option3, currentQ.option4].filter(Boolean).sort(() => Math.random() - 0.5);
      const isSynonym = gameId === 'synonym-stars';
      return (
        <div className="w-full max-w-lg">
          <div className="bg-gray-900/80 rounded-2xl p-6 backdrop-blur mb-6 text-center">
            <div className="text-green-300 text-sm mb-2">Find {isSynonym ? 'a word that means the same as' : 'the OPPOSITE of'}:</div>
            <div className="text-white text-4xl font-bold">{currentQ.text1}</div>
          </div>
          <div className="grid grid-cols-2 gap-3 relative z-20">
            {options.map((opt, i) => (
              <button key={i} onClick={() => handleAnswer(opt, currentQ.answer)}
                className={`p-4 rounded-xl text-lg font-bold transition-all cursor-pointer ${feedback ? (opt === currentQ.answer ? 'bg-green-500 text-white' : 'bg-gray-700 text-gray-400')
                  : `bg-gradient-to-r ${isSynonym ? 'from-yellow-500 to-orange-500' : 'from-red-500 to-orange-500'} text-white hover:scale-105`
                  }`}>{opt}</button>
            ))}
          </div>
        </div>
      );
    }

    // Story comprehension
    if (gameId === 'story-nebula') {
      // Format: text1=title, text2=story, category=question, answer=correct answer, option1-4=all options
      const options = [currentQ.option1, currentQ.option2, currentQ.option3, currentQ.option4].filter(Boolean);
      const questionText = currentQ.category || currentQ.answer; // Fallback for old format
      const correctAnswer = currentQ.answer;

      return (
        <div className="w-full max-w-2xl">
          <div className="bg-gray-900/80 rounded-2xl p-4 backdrop-blur mb-4 max-h-40 overflow-y-auto">
            <h3 className="text-yellow-400 font-bold mb-2">📖 {currentQ.text1}</h3>
            <p className="text-white text-sm leading-relaxed">{currentQ.text2}</p>
          </div>
          <div className="bg-teal-900/60 rounded-2xl p-4 mb-4">
            <div className="text-white text-lg font-medium">❓ {questionText}</div>
          </div>
          <div className="grid grid-cols-1 gap-2 relative z-20">
            {options.map((opt, i) => (
              <button key={i} onClick={() => handleAnswer(opt, correctAnswer)}
                className={`p-3 rounded-xl text-left font-medium transition-all cursor-pointer ${feedback ? (opt === correctAnswer ? 'bg-green-500 text-white' : 'bg-gray-700 text-gray-400')
                  : 'bg-teal-600 text-white hover:bg-teal-500'
                  }`}>{opt}</button>
            ))}
          </div>
        </div>
      );
    }

    // Inference
    if (gameId === 'inference-investigator') {
      const options = [currentQ.option1, currentQ.option2, currentQ.option3, currentQ.option4].filter(Boolean);
      return (
        <div className="w-full max-w-lg">
          <div className="bg-gray-900/80 rounded-2xl p-6 backdrop-blur mb-4">
            <div className="text-3xl mb-3 text-center">🔍</div>
            <div className="text-white text-lg leading-relaxed text-center italic">"{currentQ.text1}"</div>
          </div>
          <div className="bg-violet-900/60 rounded-2xl p-4 mb-4">
            <div className="text-white text-lg font-medium text-center">{currentQ.text2}</div>
          </div>
          <div className="grid grid-cols-1 gap-2 relative z-20">
            {options.map((opt, i) => (
              <button key={i} onClick={() => handleAnswer(opt, currentQ.answer)}
                className={`p-3 rounded-xl text-left font-medium transition-all cursor-pointer ${feedback ? (opt === currentQ.answer ? 'bg-green-500 text-white' : 'bg-gray-700 text-gray-400')
                  : 'bg-violet-600 text-white hover:bg-violet-500'
                  }`}>{opt}</button>
            ))}
          </div>
        </div>
      );
    }

    // Fractions
    if (gameId === 'fraction-frenzy') {
      // New format: num1 = text description, num2 = operation type, answer = correct answer
      const options = [currentQ.option1, currentQ.option2, currentQ.option3, currentQ.option4].filter(Boolean);
      return (
        <div className="w-full max-w-lg">
          <div className="bg-gray-900/80 rounded-2xl p-6 backdrop-blur mb-6 text-center">
            <div className="text-yellow-400 text-sm mb-2 capitalize">{currentQ.num2}</div>
            <div className="text-white text-2xl font-bold mb-4">{currentQ.num1}</div>
            {currentQ.hint && <p className="text-gray-400 text-sm">{currentQ.hint}</p>}
          </div>
          <div className="grid grid-cols-2 gap-3 relative z-20">
            {options.map((opt, i) => (
              <button key={i} onClick={() => handleAnswer(opt, currentQ.answer)}
                className={`p-4 rounded-xl text-2xl font-bold transition-all cursor-pointer ${feedback ? (opt === currentQ.answer ? 'bg-green-500 text-white' : 'bg-gray-700 text-gray-400')
                  : 'bg-gradient-to-r from-amber-500 to-orange-500 text-white hover:scale-105'
                  }`}>{opt}</button>
            ))}
          </div>
        </div>
      );
    }

    // Time
    if (gameId === 'time-warp') {
      const options = [currentQ.option1, currentQ.option2, currentQ.option3, currentQ.option4].filter(Boolean);
      const hour = parseInt(currentQ.num1) || 3;
      const minute = parseInt(currentQ.num2) || 0;
      return (
        <div className="w-full max-w-lg">
          <div className="bg-gray-900/80 rounded-2xl p-6 backdrop-blur mb-6 text-center">
            <div className="text-blue-400 text-sm mb-2">{currentQ.operation === 'read' ? 'Read the Clock' : 'Calculate Duration'}</div>
            {currentQ.operation === 'read' && (
              <svg viewBox="0 0 100 100" className="w-32 h-32 mx-auto">
                <circle cx="50" cy="50" r="45" fill="#1f2937" stroke="#fbbf24" strokeWidth="3" />
                {[...Array(12)].map((_, i) => {
                  const angle = (i * 30 - 90) * Math.PI / 180;
                  return <text key={i} x={50 + 35 * Math.cos(angle)} y={50 + 35 * Math.sin(angle) + 4} fill="white" fontSize="10" textAnchor="middle">{i === 0 ? 12 : i}</text>;
                })}
                <line x1="50" y1="50" x2={50 + 20 * Math.cos(((hour % 12) * 30 + minute * 0.5 - 90) * Math.PI / 180)} y2={50 + 20 * Math.sin(((hour % 12) * 30 + minute * 0.5 - 90) * Math.PI / 180)} stroke="#ef4444" strokeWidth="4" strokeLinecap="round" />
                <line x1="50" y1="50" x2={50 + 30 * Math.cos((minute * 6 - 90) * Math.PI / 180)} y2={50 + 30 * Math.sin((minute * 6 - 90) * Math.PI / 180)} stroke="#3b82f6" strokeWidth="3" strokeLinecap="round" />
              </svg>
            )}
            {currentQ.operation === 'duration' && <div className="text-white text-xl">From {currentQ.num1} to {currentQ.num2}</div>}
          </div>
          <div className="grid grid-cols-2 gap-3 relative z-20">
            {options.map((opt, i) => (
              <button key={i} onClick={() => handleAnswer(opt, currentQ.answer)}
                className={`p-4 rounded-xl text-lg font-bold transition-all cursor-pointer ${feedback ? (opt === currentQ.answer ? 'bg-green-500 text-white' : 'bg-gray-700 text-gray-400')
                  : 'bg-gradient-to-r from-blue-500 to-indigo-500 text-white hover:scale-105'
                  }`}>{opt}</button>
            ))}
          </div>
        </div>
      );
    }

    // Money
    if (gameId === 'money-master') {
      // New format: num1 = text description like "2 quarters + 1 dime", num2 = operation type, answer = correct value
      const options = [currentQ.option1, currentQ.option2, currentQ.option3, currentQ.option4].filter(Boolean);
      const isChange = currentQ.num2 === 'change';
      return (
        <div className="w-full max-w-lg">
          <div className="bg-gray-900/80 rounded-2xl p-6 backdrop-blur mb-6 text-center">
            <div className="text-green-400 text-sm mb-2">{isChange ? '💵 Make Change' : '🪙 Count the Coins'}</div>
            <div className="text-white text-2xl font-bold mb-4">{currentQ.num1}</div>
            {currentQ.hint && <p className="text-gray-400 text-sm">{currentQ.hint}</p>}
          </div>
          <div className="grid grid-cols-2 gap-3 relative z-20">
            {options.map((opt, i) => (
              <button key={i} onClick={() => handleAnswer(opt, currentQ.answer)}
                className={`p-4 rounded-xl text-2xl font-bold transition-all cursor-pointer ${feedback ? (opt === currentQ.answer ? 'bg-green-500 text-white' : 'bg-gray-700 text-gray-400')
                  : 'bg-gradient-to-r from-green-500 to-emerald-500 text-white hover:scale-105'
                  }`}>{opt}</button>
            ))}
          </div>
        </div>
      );
    }

    // Geometry
    if (gameId === 'geometry-galaxy') {
      const options = [currentQ.option1, currentQ.option2, currentQ.option3, currentQ.option4].filter(Boolean);
      return (
        <div className="w-full max-w-lg">
          <div className="bg-gray-900/80 rounded-2xl p-6 backdrop-blur mb-6 text-center">
            <div className="text-pink-400 text-sm mb-2">{currentQ.operation}</div>
            {currentQ.operation === 'identify' && <div className="text-8xl mb-4">{currentQ.text1 === 'triangle' ? '△' : currentQ.text1 === 'square' ? '□' : currentQ.text1 === 'circle' ? '○' : currentQ.text1 === 'rectangle' ? '▭' : currentQ.text1 === 'pentagon' ? '⬠' : '⬡'}</div>}
            {currentQ.operation === 'sides' && <div className="text-white text-2xl mb-4">How many sides does a {currentQ.text1} have?</div>}
            {(currentQ.operation === 'perimeter' || currentQ.operation === 'area') && (
              <>
                <div className="text-white text-xl mb-4">{currentQ.operation === 'perimeter' ? 'Perimeter' : 'Area'} of square with side {currentQ.num1}?</div>
                <div className="w-20 h-20 bg-pink-500/30 border-4 border-pink-400 mx-auto flex items-center justify-center text-white text-lg font-bold">{currentQ.num1}</div>
              </>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3 relative z-20">
            {options.map((opt, i) => (
              <button key={i} onClick={() => handleAnswer(opt, currentQ.answer)}
                className={`p-4 rounded-xl text-lg font-bold transition-all cursor-pointer ${feedback ? (opt === currentQ.answer ? 'bg-green-500 text-white' : 'bg-gray-700 text-gray-400')
                  : 'bg-gradient-to-r from-pink-500 to-purple-500 text-white hover:scale-105'
                  }`}>{opt}</button>
            ))}
          </div>
        </div>
      );
    }

    // Default fallback
    return <p className="text-white">Question type not supported</p>;
  };

  if (loading) return <SpaceBackground variant={variant}><div className="flex items-center justify-center h-full"><LoadingSpinner /></div></SpaceBackground>;
  if (error) {
    const errorDetails = getErrorDetails({ message: error });
    return (
      <SpaceBackground variant={variant}>
        <div className="flex flex-col items-center justify-center h-full px-4">
          <div className="bg-gray-900/80 rounded-2xl p-8 backdrop-blur max-w-md text-center">
            <div className="text-6xl mb-4">⚠️</div>
            <h2 className="text-2xl font-bold text-white mb-3">{errorDetails.title}</h2>
            <p className="text-red-400 mb-4 text-sm">{errorDetails.message}</p>

            <div className="bg-gray-800/50 rounded-lg p-4 mb-6 text-left">
              <p className="text-yellow-400 text-xs font-bold mb-2">💡 Try these solutions:</p>
              <ul className="text-gray-300 text-xs space-y-1">
                {errorDetails.hints.map((hint, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="text-yellow-400 mt-0.5">•</span>
                    <span>{hint}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex gap-3 justify-center">
              <button onClick={onBack} className="bg-gray-600 text-white px-6 py-3 rounded-full font-bold hover:bg-gray-500 transition-colors cursor-pointer">
                ← Back
              </button>
              <button onClick={retry} className="bg-gradient-to-r from-blue-500 to-blue-600 text-white px-6 py-3 rounded-full font-bold hover:scale-105 transition-transform cursor-pointer">
                🔄 Retry
              </button>
            </div>
          </div>
        </div>
      </SpaceBackground>
    );
  }

  return (
    <SpaceBackground variant={variant}>
      <Header timer={timer} streak={streak} stars={stars} onBack={onBack} formatTime={formatTime} difficulty={difficulty} />
      <div className="flex flex-col items-center justify-center h-full pt-20 px-4">
        {!gameActive && !gameOver && (
          <div className="text-center">
            <h1 className="text-5xl font-bold text-white mb-2">{icon} {title}</h1>
            <DifficultyBadge difficulty={difficulty} />
            <p className="text-gray-300 my-4">{questions.length} questions loaded from Google Sheets</p>
            <button onClick={startGame} disabled={questions.length === 0}
              className={`bg-gradient-to-r ${color} text-white px-8 py-4 rounded-full text-xl font-bold hover:scale-105 transition-transform shadow-lg cursor-pointer disabled:opacity-50`}>
              {questions.length > 0 ? 'START GAME' : 'No Questions Available'}
            </button>
          </div>
        )}
        {gameOver && <GameOverScreen stars={stars} streak={maxStreak} onRestart={startGame} onBack={onBack} onSaveScore={handleSaveScore} playerName={playerName} setPlayerName={setPlayerName} scoreSaved={scoreSaved} />}
        {gameActive && renderQuestion()}
        {feedback && <div className={`mt-4 text-center text-xl font-bold ${feedback.correct ? 'text-green-400' : 'text-red-400'}`}>{feedback.correct ? '✓ Correct!' : `✗ Answer: ${feedback.answer}`}</div>}
      </div>
    </SpaceBackground>
  );
};

// ============ GAME CONFIGS ============
const MATH_GAMES = [
  { id: 'space-math', title: 'Space Math', icon: '🚀', color: 'from-orange-500 to-yellow-500', difficulty: 'Easy', description: 'Solve equations!' },
  { id: 'alien-invasion', title: 'Alien Invasion', icon: '👾', color: 'from-green-500 to-cyan-500', difficulty: 'Hard', description: 'Zap aliens!' },
  { id: 'bubble-pop', title: 'Bubble Pop', icon: '🫧', color: 'from-cyan-500 to-blue-500', difficulty: 'Easy', description: 'Pop answers!' },
  { id: 'planet-hopper', title: 'Planet Hopper', icon: '🪐', color: 'from-purple-500 to-pink-500', difficulty: 'Medium', description: 'Complete sequences!' },
  { id: 'fraction-frenzy', title: 'Fraction Frenzy', icon: '🍕', color: 'from-amber-500 to-orange-500', difficulty: 'Medium', description: 'Master fractions!' },
  { id: 'time-warp', title: 'Time Warp', icon: '⏰', color: 'from-blue-500 to-indigo-500', difficulty: 'Easy', description: 'Tell time!' },
  { id: 'money-master', title: 'Money Master', icon: '💰', color: 'from-green-500 to-emerald-500', difficulty: 'Medium', description: 'Count money!' },
  { id: 'geometry-galaxy', title: 'Geometry Galaxy', icon: '📐', color: 'from-pink-500 to-purple-500', difficulty: 'Medium', description: 'Learn shapes!' },
];

const GRAMMAR_GAMES = [
  { id: 'grammar-galaxy', title: 'Grammar Galaxy', icon: '🛸', color: 'from-purple-500 to-indigo-500', difficulty: 'Medium', description: 'Fix grammar!' },
  { id: 'word-class-warp', title: 'Word Class Warp', icon: '🌟', color: 'from-pink-500 to-purple-500', difficulty: 'Easy', description: 'Sort words!' },
  { id: 'punctuation-pop', title: 'Punctuation Pop', icon: '✨', color: 'from-pink-500 to-rose-500', difficulty: 'Easy', description: 'Add punctuation!' },
  { id: 'tense-traveler', title: 'Tense Traveler', icon: '⏰', color: 'from-emerald-500 to-teal-500', difficulty: 'Medium', description: 'Verb tenses!' },
];

const VOCABULARY_GAMES = [
  { id: 'synonym-stars', title: 'Synonym Stars', icon: '⭐', color: 'from-yellow-500 to-orange-500', difficulty: 'Easy', description: 'Find synonyms!' },
  { id: 'antonym-asteroids', title: 'Antonym Asteroids', icon: '☄️', color: 'from-red-500 to-orange-500', difficulty: 'Easy', description: 'Find opposites!' },
];

const COMPREHENSION_GAMES = [
  { id: 'story-nebula', title: 'Story Nebula', icon: '📖', color: 'from-indigo-500 to-purple-500', difficulty: 'Medium', description: 'Read stories!' },
  { id: 'inference-investigator', title: 'Inference Investigator', icon: '🔍', color: 'from-violet-500 to-purple-500', difficulty: 'Hard', description: 'Make inferences!' },
];

const ALL_GAMES = [...MATH_GAMES, ...GRAMMAR_GAMES, ...VOCABULARY_GAMES, ...COMPREHENSION_GAMES];

// ============ SETTINGS PAGE ============
const SettingsPage = ({ settings, setSettings, onBack }) => {
  const [localSettings, setLocalSettings] = useState(settings);
  const [urlErrors, setUrlErrors] = useState({ math: '', english: '' });

  const validateGoogleSheetUrl = (url) => {
    if (!url || !url.trim()) return 'URL is required';

    // Check if it's a valid Google Sheets published CSV URL
    const googleSheetsPattern = /^https:\/\/docs\.google\.com\/spreadsheets\/d\/(e\/)?[\w-]+\/pub\?output=csv/;

    if (!googleSheetsPattern.test(url)) {
      return 'Invalid Google Sheets URL. Must be a published CSV link (File → Share → Publish to web → CSV)';
    }

    return '';
  };

  const handleMathUrlChange = (url) => {
    setLocalSettings({ ...localSettings, mathSheetUrl: url });
    setUrlErrors({ ...urlErrors, math: validateGoogleSheetUrl(url) });
  };

  const handleEnglishUrlChange = (url) => {
    setLocalSettings({ ...localSettings, englishSheetUrl: url });
    setUrlErrors({ ...urlErrors, english: validateGoogleSheetUrl(url) });
  };

  const handleSave = async () => {
    // Validate before saving
    const mathError = validateGoogleSheetUrl(localSettings.mathSheetUrl);
    const englishError = validateGoogleSheetUrl(localSettings.englishSheetUrl);

    if (mathError || englishError) {
      setUrlErrors({ math: mathError, english: englishError });
      return;
    }

    setSettings(localSettings);
    try { await storage.set('learning-galaxy-settings', JSON.stringify(localSettings)); } catch (e) { }

    // Save to Google Sheets if URL is provided
    if (localSettings.settingsSheetUrl && localSettings.settingsSheetUrl.trim()) {
      try {
        const settingsData = {
          timestamp: new Date().toISOString(),
          mathSheetUrl: localSettings.mathSheetUrl,
          englishSheetUrl: localSettings.englishSheetUrl,
          defaultDifficulty: localSettings.defaultDifficulty,
          soundEnabled: localSettings.soundEnabled
        };

        await fetch(localSettings.settingsSheetUrl, {
          method: 'POST',
          mode: 'no-cors',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(settingsData)
        });
      } catch (e) {
        console.error('Failed to save settings to Google Sheets:', e);
      }
    }

    onBack();
  };

  const handleReset = () => {
    setLocalSettings(DEFAULT_SETTINGS);
    setUrlErrors({ math: '', english: '' });
  };

  const isValid = !validateGoogleSheetUrl(localSettings.mathSheetUrl) && !validateGoogleSheetUrl(localSettings.englishSheetUrl);

  return (
    <SpaceBackground>
      <div className="flex flex-col items-center h-full px-4 py-8 overflow-y-auto">
        <button onClick={onBack} className="absolute top-4 left-4 w-10 h-10 rounded-full bg-gray-900/80 flex items-center justify-center text-white hover:bg-gray-700 z-20 cursor-pointer">←</button>
        <h1 className="text-4xl font-bold text-white mb-8 pt-8">⚙️ Settings</h1>
        <div className="w-full max-w-lg space-y-6 relative z-20">
          <div className="bg-gray-900/80 rounded-2xl p-6 backdrop-blur">
            <h2 className="text-xl font-bold text-white mb-4">🔢 Math Questions Sheet</h2>
            <textarea value={localSettings.mathSheetUrl} onChange={(e) => handleMathUrlChange(e.target.value)}
              className={`w-full px-4 py-3 rounded-lg bg-gray-700 text-white border ${urlErrors.math ? 'border-red-500' : 'border-gray-600'} focus:border-yellow-500 focus:outline-none text-xs font-mono resize-none`} rows={3} />
            {urlErrors.math && <p className="text-red-400 text-xs mt-2">⚠️ {urlErrors.math}</p>}
          </div>
          <div className="bg-gray-900/80 rounded-2xl p-6 backdrop-blur">
            <h2 className="text-xl font-bold text-white mb-4">📚 English Questions Sheet</h2>
            <textarea value={localSettings.englishSheetUrl} onChange={(e) => handleEnglishUrlChange(e.target.value)}
              className={`w-full px-4 py-3 rounded-lg bg-gray-700 text-white border ${urlErrors.english ? 'border-red-500' : 'border-gray-600'} focus:border-yellow-500 focus:outline-none text-xs font-mono resize-none`} rows={3} />
            {urlErrors.english && <p className="text-red-400 text-xs mt-2">⚠️ {urlErrors.english}</p>}
          </div>
          <div className="bg-gray-900/80 rounded-2xl p-6 backdrop-blur">
            <h2 className="text-xl font-bold text-white mb-4">🎯 Default Difficulty</h2>
            <select value={localSettings.defaultDifficulty} onChange={(e) => setLocalSettings({ ...localSettings, defaultDifficulty: e.target.value })}
              className="w-full px-4 py-2 rounded-lg bg-gray-700 text-white border border-gray-600 cursor-pointer">
              <option value="None">None (Let me choose each time)</option>
              <option value="Easy">Easy</option>
              <option value="Medium">Medium</option>
              <option value="Hard">Hard</option>
            </select>
            <p className="text-gray-400 text-xs mt-2">When "None" is selected, you can choose difficulty before each game. Otherwise, only the selected difficulty will be available.</p>
          </div>
          <div className="bg-gray-900/80 rounded-2xl p-6 backdrop-blur">
            <h2 className="text-xl font-bold text-white mb-4">📊 Settings Sync Sheet (Optional)</h2>
            <textarea value={localSettings.settingsSheetUrl} onChange={(e) => setLocalSettings({ ...localSettings, settingsSheetUrl: e.target.value })}
              placeholder="Enter Google Apps Script Web App URL to save settings..."
              className="w-full px-4 py-3 rounded-lg bg-gray-700 text-white border border-gray-600 focus:border-yellow-500 focus:outline-none text-xs font-mono resize-none" rows={2} />
            <p className="text-gray-400 text-xs mt-2">Settings will be automatically saved to this Google Sheet when you click Save.</p>
          </div>
          <div className="flex gap-3">
            <button onClick={handleReset} className="flex-1 bg-gray-600 text-white px-6 py-4 rounded-full text-lg font-bold hover:bg-gray-500 transition-colors cursor-pointer">🔄 Reset</button>
            <button onClick={handleSave} disabled={!isValid}
              className="flex-1 bg-gradient-to-r from-green-500 to-emerald-500 text-white px-6 py-4 rounded-full text-lg font-bold hover:scale-105 transition-transform shadow-lg cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100">
              💾 Save
            </button>
          </div>
        </div>
      </div>
    </SpaceBackground>
  );
};

// ============ NAVIGATION COMPONENTS ============
const DifficultySelector = ({ game, onSelect, onBack }) => {
  const gameInfo = ALL_GAMES.find(g => g.id === game);
  return (
    <SpaceBackground variant="math">
      <div className="flex flex-col items-center justify-center h-full px-4">
        <button onClick={onBack} className="absolute top-4 left-4 w-10 h-10 rounded-full bg-gray-900/80 flex items-center justify-center text-white hover:bg-gray-700 z-20 cursor-pointer">←</button>
        <div className="text-6xl mb-4">{gameInfo?.icon}</div>
        <h1 className="text-4xl font-bold text-white mb-8">{gameInfo?.title}</h1>
        <div className="flex flex-col gap-4 w-full max-w-xs relative z-20">
          {['Easy', 'Medium', 'Hard'].map(diff => (
            <button key={diff} onClick={() => onSelect(diff)}
              className={`p-4 rounded-2xl text-left transition-all hover:scale-105 cursor-pointer ${diff === 'Easy' ? 'bg-gradient-to-r from-green-500 to-green-600' : diff === 'Medium' ? 'bg-gradient-to-r from-yellow-500 to-orange-500' : 'bg-gradient-to-r from-red-500 to-red-600'}`}>
              <div className="text-xl font-bold text-white">{diff}</div>
            </button>
          ))}
        </div>
      </div>
    </SpaceBackground>
  );
};

const GameTilesPage = ({ title, icon, games, onSelectGame, onBack, totalStars, variant }) => (
  <SpaceBackground variant={variant}>
    <div className="flex flex-col items-center h-full px-4 py-8 overflow-y-auto">
      <button onClick={onBack} className="absolute top-4 left-4 w-10 h-10 rounded-full bg-gray-900/80 flex items-center justify-center text-white hover:bg-gray-700 z-20 cursor-pointer">←</button>
      <div className="text-center mb-8 pt-8">
        <h1 className="text-4xl font-bold text-white mb-2">{icon} {title}</h1>
        <div className="flex items-center justify-center gap-2 mt-4 bg-gray-900/60 px-4 py-2 rounded-full">
          <StarIcon className="w-5 h-5 text-yellow-400" />
          <span className="text-yellow-400 font-bold">{totalStars} Stars</span>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-4xl w-full pb-8 relative z-20">
        {games.map((game, i) => (
          <button key={game.id} onClick={() => onSelectGame(game.id)}
            className={`bg-gradient-to-br ${game.color} p-4 rounded-2xl shadow-xl text-left transition-all hover:scale-105 cursor-pointer`}
            style={{ animation: `slideIn 0.3s ease-out ${i * 0.05}s both` }}>
            <div className="text-3xl mb-2">{game.icon}</div>
            <h3 className="text-sm font-bold text-white mb-1">{game.title}</h3>
            <p className="text-white/80 text-xs">{game.description}</p>
          </button>
        ))}
      </div>
    </div>
  </SpaceBackground>
);

const EnglishLandingPage = ({ onSelectCategory, onBack, totalStars }) => (
  <SpaceBackground variant="english">
    <div className="flex flex-col items-center justify-center h-full px-4">
      <button onClick={onBack} className="absolute top-4 left-4 w-10 h-10 rounded-full bg-gray-900/80 flex items-center justify-center text-white hover:bg-gray-700 z-20 cursor-pointer">←</button>
      <h1 className="text-5xl font-bold text-white mb-8">📚 English Galaxy</h1>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-4xl w-full relative z-20">
        {[
          { id: 'grammar', icon: '✏️', title: 'Grammar', color: 'from-purple-600 to-indigo-700', count: GRAMMAR_GAMES.length },
          { id: 'vocabulary', icon: '📖', title: 'Vocabulary', color: 'from-green-600 to-emerald-700', count: VOCABULARY_GAMES.length },
          { id: 'comprehension', icon: '🔍', title: 'Comprehension', color: 'from-teal-600 to-cyan-700', count: COMPREHENSION_GAMES.length },
        ].map(cat => (
          <button key={cat.id} onClick={() => onSelectCategory(cat.id)} className={`bg-gradient-to-br ${cat.color} p-6 rounded-3xl shadow-2xl hover:scale-105 transition-all text-left cursor-pointer`}>
            <div className="text-5xl mb-3">{cat.icon}</div>
            <h2 className="text-2xl font-bold text-white mb-1">{cat.title}</h2>
            <p className="text-white/70 text-sm">{cat.count} games</p>
          </button>
        ))}
      </div>
    </div>
  </SpaceBackground>
);

const MainLandingPage = ({ onSelectSubject, totalStars, onOpenLeaderboard, onOpenSettings, leaderboard = [] }) => {
  // Time-based greeting
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return { text: 'Good Morning', emoji: '🌅' };
    if (hour < 17) return { text: 'Good Afternoon', emoji: '☀️' };
    return { text: 'Good Evening', emoji: '🌙' };
  };
  const greeting = getGreeting();

  // Calculate achievements
  const totalGames = leaderboard.length;
  const bestStreak = leaderboard.reduce((max, g) => Math.max(max, g.streak || 0), 0);

  // Floating elements for fun animation
  const floatingItems = ['🚀', '⭐', '🌍', '🛸', '💫', '🌟'];

  return (
    <SpaceBackground>
      {/* Settings button - top right */}
      <button onClick={onOpenSettings} className="absolute top-4 right-4 w-12 h-12 rounded-full bg-gray-900/80 flex items-center justify-center text-2xl hover:bg-gray-700 z-30 cursor-pointer transition-all hover:scale-110">
        ⚙️
      </button>

      {/* Floating decorations */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
        {floatingItems.map((item, i) => (
          <div key={i} className="absolute text-4xl opacity-40"
            style={{
              left: `${10 + i * 15}%`,
              top: `${20 + (i % 3) * 25}%`,
              animation: `float ${3 + i * 0.5}s ease-in-out infinite`,
              animationDelay: `${i * 0.3}s`
            }}>
            {item}
          </div>
        ))}
      </div>

      <div className="flex flex-col items-center justify-center min-h-full px-4 py-6 relative z-10">
        {/* Mascot and Greeting */}
        <div className="text-center mb-4">
          <div className="text-7xl mb-2" style={{ animation: 'float 2s ease-in-out infinite' }}>🤖</div>
          <p className="text-lg text-purple-200">{greeting.emoji} {greeting.text}, Explorer!</p>
        </div>

        {/* Title */}
        <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold mb-2 text-center">
          <span className="bg-gradient-to-r from-yellow-300 via-pink-400 to-purple-500 bg-clip-text text-transparent drop-shadow-lg">
            Learning Galaxy
          </span>
        </h1>
        <p className="text-sm sm:text-base text-purple-300 mb-4">Fun learning for Grade 3-4! 🎮</p>

        {/* Stats Cards - Mobile friendly row */}
        <div className="flex flex-wrap justify-center gap-2 sm:gap-3 mb-6 relative z-20">
          <div className="flex items-center gap-2 bg-gradient-to-r from-yellow-500/20 to-orange-500/20 border border-yellow-500/50 px-3 py-2 rounded-full">
            <span className="text-xl">⭐</span>
            <span className="text-yellow-300 font-bold text-sm sm:text-base">{totalStars}</span>
          </div>
          <div className="flex items-center gap-2 bg-gradient-to-r from-green-500/20 to-emerald-500/20 border border-green-500/50 px-3 py-2 rounded-full">
            <span className="text-xl">🎮</span>
            <span className="text-green-300 font-bold text-sm sm:text-base">{totalGames} played</span>
          </div>
          <div className="flex items-center gap-2 bg-gradient-to-r from-orange-500/20 to-red-500/20 border border-orange-500/50 px-3 py-2 rounded-full">
            <span className="text-xl">🔥</span>
            <span className="text-orange-300 font-bold text-sm sm:text-base">{bestStreak} streak</span>
          </div>
        </div>

        {/* Subject Cards - Responsive grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-md sm:max-w-2xl relative z-20 mb-6">
          <button onClick={() => onSelectSubject('math')}
            className="bg-gradient-to-br from-purple-500 via-purple-600 to-indigo-700 p-6 sm:p-8 rounded-3xl shadow-2xl hover:scale-105 transition-all text-left cursor-pointer border-2 border-purple-400/30 group">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-5xl sm:text-6xl mb-2 group-hover:scale-110 transition-transform">🔢</div>
                <h2 className="text-2xl sm:text-3xl font-bold text-white mb-1">Math</h2>
                <p className="text-purple-200 text-sm">{MATH_GAMES.length} fun games!</p>
              </div>
              <div className="text-4xl opacity-50 group-hover:opacity-100 transition-opacity">→</div>
            </div>
          </button>
          <button onClick={() => onSelectSubject('english')}
            className="bg-gradient-to-br from-blue-500 via-blue-600 to-cyan-700 p-6 sm:p-8 rounded-3xl shadow-2xl hover:scale-105 transition-all text-left cursor-pointer border-2 border-blue-400/30 group">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-5xl sm:text-6xl mb-2 group-hover:scale-110 transition-transform">📚</div>
                <h2 className="text-2xl sm:text-3xl font-bold text-white mb-1">English</h2>
                <p className="text-blue-200 text-sm">{GRAMMAR_GAMES.length + VOCABULARY_GAMES.length + COMPREHENSION_GAMES.length} fun games!</p>
              </div>
              <div className="text-4xl opacity-50 group-hover:opacity-100 transition-opacity">→</div>
            </div>
          </button>
        </div>

        {/* Leaderboard Button */}
        <button onClick={onOpenLeaderboard}
          className="flex items-center gap-3 bg-gradient-to-r from-amber-500 to-yellow-500 px-6 py-3 rounded-full font-bold text-white hover:scale-105 transition-all shadow-lg cursor-pointer">
          <span className="text-2xl">🏆</span>
          <span>View Leaderboard</span>
        </button>
      </div>
    </SpaceBackground>
  );
};

const Leaderboard = ({ onBack, leaderboard }) => {
  const [filter, setFilter] = useState('all');
  const filtered = filter === 'all' ? leaderboard : leaderboard.filter(s => filter === 'math' ? MATH_GAMES.find(g => g.id === s.game) : !MATH_GAMES.find(g => g.id === s.game));
  const sorted = [...filtered].sort((a, b) => b.stars - a.stars).slice(0, 10);

  return (
    <SpaceBackground>
      <div className="flex flex-col items-center h-full pt-8 px-4 overflow-y-auto">
        <button onClick={onBack} className="absolute top-4 left-4 w-10 h-10 rounded-full bg-gray-900/80 flex items-center justify-center text-white hover:bg-gray-700 z-20 cursor-pointer">←</button>
        <h1 className="text-4xl font-bold text-white mb-6">🏆 Leaderboard</h1>
        <div className="flex gap-2 mb-6 relative z-20">
          {['all', 'math', 'english'].map(f => (
            <button key={f} onClick={() => setFilter(f)} className={`px-4 py-2 rounded-full font-bold capitalize cursor-pointer ${filter === f ? 'bg-yellow-500 text-white' : 'bg-gray-700 text-gray-300'}`}>{f}</button>
          ))}
        </div>
        <div className="w-full max-w-md bg-gray-900/80 rounded-2xl p-4 backdrop-blur relative z-20">
          {sorted.length === 0 ? <p className="text-center text-gray-400 py-8">No scores yet!</p> : (
            <div className="space-y-2">
              {sorted.map((score, i) => {
                const gameInfo = ALL_GAMES.find(g => g.id === score.game);
                return (
                  <div key={i} className={`flex items-center gap-3 p-3 rounded-lg ${i === 0 ? 'bg-yellow-500/20' : 'bg-gray-800/50'}`}>
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold ${i === 0 ? 'bg-yellow-500 text-black' : 'bg-gray-700 text-white'}`}>{i + 1}</div>
                    <div className="flex-1"><div className="text-white font-bold">{score.name}</div><div className="text-gray-400 text-xs">{gameInfo?.title}</div></div>
                    <div className="flex items-center gap-1 text-yellow-400 font-bold"><StarIcon className="w-4 h-4" />{score.stars}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </SpaceBackground>
  );
};

// ============ MAIN APP ============
const LearningGalaxy = () => {
  const [currentSubject, setCurrentSubject] = useState(null);
  const [englishCategory, setEnglishCategory] = useState(null);
  const [currentGame, setCurrentGame] = useState(null);
  const [selectedDifficulty, setSelectedDifficulty] = useState(null);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [leaderboard, setLeaderboard] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);

  useEffect(() => {
    const loadData = async () => {
      try {
        const lb = await storage.get('learning-galaxy-leaderboard');
        if (lb?.value) setLeaderboard(JSON.parse(lb.value));
        const st = await storage.get('learning-galaxy-settings');
        if (st?.value) setSettings(JSON.parse(st.value));
      } catch (e) { }
    };
    loadData();
  }, []);

  const handleGameEnd = async (game, name, stars, streak) => {
    const updated = [...leaderboard, { game, name, stars, streak, date: new Date().toISOString() }];
    setLeaderboard(updated);
    try { await storage.set('learning-galaxy-leaderboard', JSON.stringify(updated)); } catch (e) { }
  };

  const totalStars = leaderboard.reduce((sum, e) => sum + e.stars, 0);
  const handleBackToHome = () => { setCurrentSubject(null); setEnglishCategory(null); setCurrentGame(null); setSelectedDifficulty(null); };

  if (showSettings) return <SettingsPage settings={settings} setSettings={setSettings} onBack={() => setShowSettings(false)} />;
  if (showLeaderboard) return <Leaderboard onBack={() => setShowLeaderboard(false)} leaderboard={leaderboard} />;

  if (currentGame && selectedDifficulty) {
    const gameInfo = ALL_GAMES.find(g => g.id === currentGame);
    const variant = MATH_GAMES.find(g => g.id === currentGame) ? 'math' : GRAMMAR_GAMES.find(g => g.id === currentGame) ? 'grammar' : VOCABULARY_GAMES.find(g => g.id === currentGame) ? 'vocabulary' : 'comprehension';
    return <SheetBasedGame onBack={handleBackToHome} difficulty={selectedDifficulty} onGameEnd={handleGameEnd} settings={settings} gameId={currentGame} title={gameInfo?.title} icon={gameInfo?.icon} color={gameInfo?.color} variant={variant} />;
  }

  // Check if default difficulty is set (not "None")
  if (currentGame && settings.defaultDifficulty !== 'None') {
    // Auto-select the default difficulty and go directly to game
    const gameInfo = ALL_GAMES.find(g => g.id === currentGame);
    const variant = MATH_GAMES.find(g => g.id === currentGame) ? 'math' : GRAMMAR_GAMES.find(g => g.id === currentGame) ? 'grammar' : VOCABULARY_GAMES.find(g => g.id === currentGame) ? 'vocabulary' : 'comprehension';
    return <SheetBasedGame onBack={handleBackToHome} difficulty={settings.defaultDifficulty} onGameEnd={handleGameEnd} settings={settings} gameId={currentGame} title={gameInfo?.title} icon={gameInfo?.icon} color={gameInfo?.color} variant={variant} />;
  }

  if (currentGame) return <DifficultySelector game={currentGame} onSelect={setSelectedDifficulty} onBack={() => setCurrentGame(null)} />;
  if (currentSubject === 'english' && englishCategory) {
    const games = englishCategory === 'grammar' ? GRAMMAR_GAMES : englishCategory === 'vocabulary' ? VOCABULARY_GAMES : COMPREHENSION_GAMES;
    return <GameTilesPage title={englishCategory.charAt(0).toUpperCase() + englishCategory.slice(1)} icon={englishCategory === 'grammar' ? '✏️' : englishCategory === 'vocabulary' ? '📖' : '🔍'} games={games} onSelectGame={setCurrentGame} onBack={() => setEnglishCategory(null)} totalStars={totalStars} variant={englishCategory} />;
  }
  if (currentSubject === 'english') return <EnglishLandingPage onSelectCategory={setEnglishCategory} onBack={handleBackToHome} totalStars={totalStars} />;
  if (currentSubject === 'math') return <GameTilesPage title="Math Galaxy" icon="🔢" games={MATH_GAMES} onSelectGame={setCurrentGame} onBack={handleBackToHome} totalStars={totalStars} variant="math" />;

  return <MainLandingPage onSelectSubject={setCurrentSubject} totalStars={totalStars} onOpenLeaderboard={() => setShowLeaderboard(true)} onOpenSettings={() => setShowSettings(true)} leaderboard={leaderboard} />;
};

export default LearningGalaxy;
