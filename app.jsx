/* global React, ReactDOM, Chart */

const {
  initializeApp,
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithCustomToken,
  signInAnonymously,
  onAuthStateChanged,
  getFirestore,
  collection,
  doc,
  addDoc,
  setDoc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  where,
  updateDoc,
  deleteDoc,
  serverTimestamp
} = window.firebaseMod || {};

// Config sources per requirements
let firebaseConfig = {};
try {
  if (typeof window.__firebase_config !== 'undefined') {
    firebaseConfig = JSON.parse(window.__firebase_config);
  }
} catch (e) {
  console.warn('Failed to parse __firebase_config; will use provided config.');
}

if (!firebaseConfig || !firebaseConfig.apiKey) {
  firebaseConfig = {
    apiKey: "AIzaSyA3ffgbHNANs-qbSCGYzfFLF5picwkH8Mo",
    authDomain: "chronos-deck-app.firebaseapp.com",
    projectId: "chronos-deck-app",
    storageBucket: "chronos-deck-app.firebasestorage.app",
    messagingSenderId: "366992061685",
    appId: "1:366992061685:web:c7ac78730403b1f2a181bc",
    measurementId: "G-W75DXVT2DK"
  };
}

const appId = typeof window.__app_id !== 'undefined' ? window.__app_id : 'default-app-id';
const GEMINI_API_KEY = 'AIzaSyDgsq5UyHx9d53NT-waZxrmbD-YvBqJCCA';
const GEMINI_MODEL = 'gemini-2.5-flash-preview-09-2025';

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Optional initial token / anonymous per requirement
(async () => {
  try {
    if (typeof window.__initial_auth_token !== 'undefined') {
      await signInWithCustomToken(auth, window.__initial_auth_token);
    } else {
      // Sign in anonymously but the UI will still require Google Sign-In to access features
      await signInAnonymously(auth);
    }
  } catch (e) {
    console.warn('Initial auth attempt failed:', e);
  }
})();

// Utils
const useAuthState = () => {
  const [user, setUser] = React.useState(auth.currentUser);
  React.useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return () => unsub();
  }, []);
  return user;
};

const path = {
  subjectsCol: (uid) => collection(db, 'artifacts', appId, 'users', uid, 'subjects'),
  tasksCol: (uid) => collection(db, 'artifacts', appId, 'users', uid, 'tasks'),
  decksCol: (uid) => collection(db, 'artifacts', appId, 'users', uid, 'decks'),
  cardsCol: (uid, deckId) => collection(db, 'artifacts', appId, 'users', uid, 'decks', deckId, 'cards'),
  sessionsCol: (uid) => collection(db, 'artifacts', appId, 'users', uid, 'studySessions'),
  quizHistoryCol: (uid) => collection(db, 'artifacts', appId, 'users', uid, 'quizHistory')
};

// Notification helper
function scheduleNotification(title, body, whenMs) {
  if (!('Notification' in window)) return;
  Notification.requestPermission().then((perm) => {
    if (perm === 'granted') {
      const delay = Math.max(0, whenMs - Date.now());
      setTimeout(() => {
        new Notification(title, { body });
      }, delay);
    }
  });
}

// Gemini API helpers
async function geminiGenerateQuiz(cards) {
  const items = cards.map(c => ({ term: c.term, definition: c.definition }));
  const prompt = `You are a helpful study assistant. Based on the following terms and definitions, generate 5 multiple-choice questions. You MUST return *only* a valid JSON array in this format: [{"question": "...", "options": ["A", "B", "C", "D"], "correctAnswer": "A"}, ...]\n\nData: ${JSON.stringify(items)}`;

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }]
    })
  });
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('\n') || '';
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    // Attempt to extract JSON array
    const match = text.match(/\[\s*{[\s\S]*}\s*\]/);
    parsed = match ? JSON.parse(match[0]) : [];
  }
  return Array.isArray(parsed) ? parsed : [];
}

async function geminiChat(message, history = []) {
  const prompt = message;
  const contents = [
    ...history.map(h => ({ role: h.role, parts: [{ text: h.text }] })),
    { role: 'user', parts: [{ text: prompt }] }
  ];
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents })
  });
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('\n') || '';
  return text.trim();
}

function LoginPage() {
  const provider = React.useMemo(() => new GoogleAuthProvider(), []);

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, provider);
    } catch (e) {
      alert('Login failed: ' + e.message);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50">
      <div className="bg-white shadow-lg rounded-xl p-8 w-full max-w-md text-center">
        <h1 className="text-2xl font-semibold mb-4">The Chronos-Deck</h1>
        <p className="text-gray-600 mb-6">AI Study Dashboard</p>
        <button onClick={handleLogin} className="w-full py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
          Login with Google
        </button>
      </div>
    </div>
  );
}

function Sidebar({ view, setView, user }) {
  const item = (key, label) => (
    <button
      onClick={() => setView(key)}
      className={`w-full text-left px-3 py-2 rounded-md mb-1 ${view === key ? 'bg-blue-100 text-blue-700' : 'hover:bg-gray-100'}`}
    >{label}</button>
  );
  return (
    <div className="w-64 border-r bg-white p-3 space-y-2">
      <div className="mb-2">
        <div className="font-semibold">{user?.displayName || 'Guest'}</div>
        <div className="text-xs text-gray-500">{user?.email || (user?.isAnonymous ? 'Anonymous' : '')}</div>
      </div>
      {item('dashboard', 'Dashboard')}
      {item('tasks', 'To-Do List')}
      {item('focus', 'Focus Timer')}
      {item('decks', 'Decks')}
      <button onClick={() => auth.signOut()} className="mt-4 w-full py-2 bg-gray-200 rounded-md hover:bg-gray-300">Sign out</button>
    </div>
  );
}

function SubjectsManager({ userId }) {
  const [subjects, setSubjects] = React.useState([]);
  const [name, setName] = React.useState('');
  const [color, setColor] = React.useState('#22c55e');

  React.useEffect(() => {
    if (!userId) return;
    const unsub = onSnapshot(path.subjectsCol(userId), (snap) => {
      setSubjects(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, [userId]);

  const addSubject = async () => {
    if (!name.trim()) return;
    await addDoc(path.subjectsCol(userId), { name, color });
    setName('');
  };
  const removeSubject = async (id) => {
    await deleteDoc(doc(db, 'artifacts', appId, 'users', userId, 'subjects', id));
  };

  return (
    <div className="bg-white rounded-lg shadow p-4">
      <h3 className="font-semibold mb-3">Subjects</h3>
      <div className="flex gap-2 mb-3">
        <input className="flex-1 border rounded px-2 py-1" placeholder="Subject name" value={name} onChange={e => setName(e.target.value)} />
        <input type="color" value={color} onChange={e => setColor(e.target.value)} />
        <button className="px-3 py-1 bg-blue-600 text-white rounded" onClick={addSubject}>Add</button>
      </div>
      <div className="flex flex-wrap gap-2">
        {subjects.map(s => (
          <div key={s.id} className="flex items-center gap-2 border rounded px-2 py-1">
            <span className="w-3 h-3 rounded" style={{ background: s.color }}></span>
            <span>{s.name}</span>
            <button className="text-red-600 text-xs" onClick={() => removeSubject(s.id)}>Delete</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function TasksPage({ userId }) {
  const [tasks, setTasks] = React.useState([]);
  const [subjects, setSubjects] = React.useState([]);
  const [taskName, setTaskName] = React.useState('');
  const [subjectTag, setSubjectTag] = React.useState('');
  const [dueDate, setDueDate] = React.useState('');

  React.useEffect(() => {
    if (!userId) return;
    const unsubTasks = onSnapshot(path.tasksCol(userId), (snap) => {
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setTasks(items);
    });
    const unsubSubjects = onSnapshot(path.subjectsCol(userId), (snap) => {
      const subs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setSubjects(subs);
    });
    return () => { unsubTasks(); unsubSubjects(); };
  }, [userId]);

  const addTask = async () => {
    if (!taskName.trim() || !subjectTag) return;
    const docRef = await addDoc(path.tasksCol(userId), {
      taskName,
      subjectTag,
      dueDate,
      isComplete: false
    });
    if (dueDate) {
      const whenMs = new Date(dueDate).getTime();
      scheduleNotification('Task Due', `${taskName} (${subjectTag})`, whenMs);
    }
    setTaskName(''); setSubjectTag(''); setDueDate('');
  };

  const toggleComplete = async (t) => {
    await updateDoc(doc(db, 'artifacts', appId, 'users', userId, 'tasks', t.id), {
      isComplete: !t.isComplete
    });
  };
  const removeTask = async (id) => {
    await deleteDoc(doc(db, 'artifacts', appId, 'users', userId, 'tasks', id));
  };
  const updateTask = async (t, field, value) => {
    await updateDoc(doc(db, 'artifacts', appId, 'users', userId, 'tasks', t.id), { [field]: value });
  };

  return (
    <div className="p-4">
      <div className="bg-white rounded-lg shadow p-4 mb-4">
        <h2 className="font-semibold mb-3">Add Task</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          <input className="border rounded px-2 py-1" placeholder="Task name" value={taskName} onChange={e => setTaskName(e.target.value)} />
          <select className="border rounded px-2 py-1" value={subjectTag} onChange={e => setSubjectTag(e.target.value)}>
            <option value="">Select subject</option>
            {subjects.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
          </select>
          <input className="border rounded px-2 py-1" type="datetime-local" value={dueDate} onChange={e => setDueDate(e.target.value)} />
          <button className="bg-blue-600 text-white rounded px-3" onClick={addTask}>Add</button>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-4">
        <h2 className="font-semibold mb-3">Tasks</h2>
        <div className="space-y-2">
          {tasks.map(t => (
            <div key={t.id} className="flex items-center gap-2 border rounded p-2">
              <input type="checkbox" checked={t.isComplete} onChange={() => toggleComplete(t)} />
              <input className="flex-1 border rounded px-2 py-1" value={t.taskName} onChange={e => updateTask(t, 'taskName', e.target.value)} />
              <span className="text-xs text-gray-500">{t.subjectTag}</span>
              <input className="border rounded px-2 py-1 text-xs" type="datetime-local" value={t.dueDate || ''} onChange={e => updateTask(t, 'dueDate', e.target.value)} />
              <button className="text-red-600" onClick={() => removeTask(t.id)}>Delete</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function FocusTimer({ userId }) {
  const [subjects, setSubjects] = React.useState([]);
  const [selected, setSelected] = React.useState('');
  const [seconds, setSeconds] = React.useState(25 * 60);
  const [running, setRunning] = React.useState(false);
  const [isBreak, setIsBreak] = React.useState(false);

  React.useEffect(() => {
    if (!userId) return;
    const unsub = onSnapshot(path.subjectsCol(userId), (snap) => {
      setSubjects(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, [userId]);

  React.useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setSeconds(s => s - 1), 1000);
    return () => clearInterval(timer);
  }, [running]);

  React.useEffect(() => {
    if (seconds <= 0 && running) {
      setRunning(false);
      if (!isBreak) {
        // log study session
        addDoc(path.sessionsCol(userId), { subject: selected, duration: 25, timestamp: new Date() });
        scheduleNotification('Session complete', `25-minute ${selected} session finished`, Date.now());
        setIsBreak(true);
        setSeconds(5 * 60);
      } else {
        setIsBreak(false);
        setSeconds(25 * 60);
      }
    }
  }, [seconds, running, isBreak, selected, userId]);

  const start = () => {
    if (!selected) { alert('Select a subject'); return; }
    setRunning(true);
  };
  const stop = () => setRunning(false);
  const reset = () => { setRunning(false); setIsBreak(false); setSeconds(25 * 60); };

  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');

  return (
    <div className="p-4">
      <div className="bg-white rounded-lg shadow p-4 max-w-md">
        <h2 className="font-semibold mb-2">Focus Hub</h2>
        <select className="border rounded px-2 py-1 w-full mb-3" value={selected} onChange={e => setSelected(e.target.value)}>
          <option value="">Select subject</option>
          {subjects.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
        </select>
        <div className="text-4xl font-mono text-center mb-3">{mm}:{ss}</div>
        <div className="text-center text-sm mb-3">{isBreak ? 'Break (5 min)' : 'Work (25 min)'}</div>
        <div className="flex gap-2">
          <button className="flex-1 bg-blue-600 text-white rounded py-2" onClick={start}>Start</button>
          <button className="flex-1 bg-gray-200 rounded py-2" onClick={stop}>Pause</button>
          <button className="flex-1 bg-gray-200 rounded py-2" onClick={reset}>Reset</button>
        </div>
      </div>
    </div>
  );
}

function DecksPage({ userId }) {
  const [decks, setDecks] = React.useState([]);
  const [deckName, setDeckName] = React.useState('');
  const [activeDeck, setActiveDeck] = React.useState(null);
  const [cards, setCards] = React.useState([]);
  const [term, setTerm] = React.useState('');
  const [definition, setDefinition] = React.useState('');
  const [quiz, setQuiz] = React.useState(null);
  const [answers, setAnswers] = React.useState({});

  React.useEffect(() => {
    if (!userId) return;
    const unsub = onSnapshot(path.decksCol(userId), (snap) => {
      setDecks(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, [userId]);

  React.useEffect(() => {
    if (!userId || !activeDeck) { setCards([]); return; }
    const unsub = onSnapshot(path.cardsCol(userId, activeDeck.id), (snap) => {
      setCards(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, [userId, activeDeck]);

  const addDeck = async () => {
    if (!deckName.trim()) return;
    const ref = await addDoc(path.decksCol(userId), { deckName });
    setDeckName('');
  };
  const removeDeck = async (id) => {
    await deleteDoc(doc(db, 'artifacts', appId, 'users', userId, 'decks', id));
    if (activeDeck?.id === id) setActiveDeck(null);
  };

  const addCard = async () => {
    if (!activeDeck || !term.trim() || !definition.trim()) return;
    await addDoc(path.cardsCol(userId, activeDeck.id), { term, definition });
    setTerm(''); setDefinition('');
  };
  const updateCard = async (c, field, value) => {
    await updateDoc(doc(db, 'artifacts', appId, 'users', userId, 'decks', activeDeck.id, 'cards', c.id), { [field]: value });
  };
  const removeCard = async (id) => {
    await deleteDoc(doc(db, 'artifacts', appId, 'users', userId, 'decks', activeDeck.id, 'cards', id));
  };

  const generateQuiz = async () => {
    const q = await geminiGenerateQuiz(cards);
    setQuiz(q);
    setAnswers({});
  };

  const submitQuiz = async () => {
    if (!quiz || !activeDeck) return;
    let correct = 0;
    quiz.forEach((q, idx) => {
      if (answers[idx] === q.correctAnswer) correct++;
    });
    const scoreStr = `${correct}/${quiz.length}`;
    await addDoc(path.quizHistoryCol(userId), {
      deckName: activeDeck.deckName,
      score: scoreStr,
      timestamp: new Date()
    });
    alert(`Quiz submitted. Score: ${scoreStr}`);
  };

  return (
    <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="bg-white rounded-lg shadow p-4">
        <h2 className="font-semibold mb-3">Decks</h2>
        <div className="flex gap-2 mb-3">
          <input className="flex-1 border rounded px-2 py-1" placeholder="Deck name" value={deckName} onChange={e => setDeckName(e.target.value)} />
          <button className="bg-blue-600 text-white rounded px-3" onClick={addDeck}>Add</button>
        </div>
        <div className="space-y-2">
          {decks.map(d => (
            <div key={d.id} className={`flex items-center justify-between border rounded p-2 ${activeDeck?.id === d.id ? 'bg-blue-50' : ''}`}>
              <button className="text-left" onClick={() => setActiveDeck(d)}>{d.deckName}</button>
              <button className="text-red-600" onClick={() => removeDeck(d.id)}>Delete</button>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-4">
        <h2 className="font-semibold mb-3">Cards {activeDeck ? `– ${activeDeck.deckName}` : ''}</h2>
        {activeDeck ? (
          <>
            <div className="flex gap-2 mb-3">
              <input className="flex-1 border rounded px-2 py-1" placeholder="Term" value={term} onChange={e => setTerm(e.target.value)} />
              <input className="flex-1 border rounded px-2 py-1" placeholder="Definition" value={definition} onChange={e => setDefinition(e.target.value)} />
              <button className="bg-blue-600 text-white rounded px-3" onClick={addCard}>Add</button>
            </div>
            <div className="space-y-2 mb-4">
              {cards.map(c => (
                <div key={c.id} className="grid grid-cols-3 gap-2 border rounded p-2 items-center">
                  <input className="border rounded px-2 py-1" value={c.term} onChange={e => updateCard(c, 'term', e.target.value)} />
                  <input className="border rounded px-2 py-1" value={c.definition} onChange={e => updateCard(c, 'definition', e.target.value)} />
                  <button className="text-red-600" onClick={() => removeCard(c.id)}>Delete</button>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <button className="bg-secondary text-white rounded px-3 py-2" onClick={generateQuiz}>Generate AI Quiz</button>
            </div>

            {quiz && (
              <div className="mt-4">
                <h3 className="font-semibold mb-2">Quiz</h3>
                <div className="space-y-3">
                  {quiz.map((q, idx) => (
                    <div key={idx} className="border rounded p-2">
                      <div className="font-medium mb-2">{q.question}</div>
                      <div className="grid grid-cols-2 gap-2">
                        {q.options.map(opt => (
                          <label key={opt} className="flex items-center gap-2 border rounded px-2 py-1">
                            <input type="radio" name={`q${idx}`} value={opt} checked={answers[idx] === opt} onChange={() => setAnswers(a => ({ ...a, [idx]: opt }))} />
                            <span>{opt}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <button className="mt-3 bg-blue-600 text-white rounded px-3 py-2" onClick={submitQuiz}>Submit Quiz</button>
              </div>
            )}
          </>
        ) : (
          <div className="text-gray-500">Select a deck to manage cards and generate quizzes.</div>
        )}
      </div>
    </div>
  );
}

function Dashboard({ userId }) {
  const [sessions, setSessions] = React.useState([]);
  const [quizHistory, setQuizHistory] = React.useState([]);
  const chartRef = React.useRef(null);
  const chartInstance = React.useRef(null);

  React.useEffect(() => {
    if (!userId) return;
    const unsubS = onSnapshot(path.sessionsCol(userId), (snap) => {
      setSessions(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    const unsubQ = onSnapshot(path.quizHistoryCol(userId), (snap) => {
      setQuizHistory(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return () => { unsubS(); unsubQ(); };
  }, [userId]);

  React.useEffect(() => {
    const agg = sessions.reduce((acc, s) => {
      acc[s.subject] = (acc[s.subject] || 0) + (s.duration || 0);
      return acc;
    }, {});
    const labels = Object.keys(agg);
    const data = Object.values(agg);
    if (chartInstance.current) {
      chartInstance.current.destroy();
    }
    if (labels.length && chartRef.current) {
      chartInstance.current = new Chart(chartRef.current, {
        type: 'bar',
        data: {
          labels,
          datasets: [{ label: 'Total Study Time (min)', data, backgroundColor: '#38bdf8' }]
        },
        options: { responsive: true, maintainAspectRatio: false }
      });
    }
  }, [sessions]);

  return (
    <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="bg-white rounded-lg shadow p-4 h-80">
        <h2 className="font-semibold mb-2">Total Study Time by Subject</h2>
        <canvas ref={chartRef}></canvas>
      </div>
      <div className="bg-white rounded-lg shadow p-4">
        <h2 className="font-semibold mb-2">Recent Quiz Scores</h2>
        <div className="space-y-2">
          {quizHistory.map(q => (
            <div key={q.id} className="border rounded p-2 flex justify-between">
              <span>{q.deckName}</span>
              <span className="font-mono">{q.score}</span>
            </div>
          ))}
        </div>
      </div>
      <SubjectsManager userId={userId} />
    </div>
  );
}

function AIHelper() {
  const [open, setOpen] = React.useState(false);
  const [input, setInput] = React.useState('');
  const [messages, setMessages] = React.useState([]); // { role: 'user'|'model', text }

  const send = async () => {
    if (!input.trim()) return;
    const history = messages.map(m => ({ role: m.role === 'user' ? 'user' : 'model', text: m.text }));
    const reply = await geminiChat(input, history);
    setMessages(m => [...m, { role: 'user', text: input }, { role: 'model', text: reply }]);
    setInput('');
  };

  return (
    <div className="fixed bottom-4 right-4">
      {!open && (
        <button className="rounded-full bg-secondary text-white px-4 py-3 shadow" onClick={() => setOpen(true)}>AI Helper</button>
      )}
      {open && (
        <div className="w-80 h-96 bg-white rounded-lg shadow flex flex-col">
          <div className="flex items-center justify-between p-2 border-b">
            <div className="font-semibold">AI Helper</div>
            <button onClick={() => setOpen(false)} className="text-gray-500">✕</button>
          </div>
          <div className="flex-1 overflow-auto p-2 space-y-2">
            {messages.map((m, i) => (
              <div key={i} className={`p-2 rounded ${m.role === 'user' ? 'bg-blue-50' : 'bg-gray-50'}`}>{m.text}</div>
            ))}
          </div>
          <div className="p-2 border-t flex gap-2">
            <input className="flex-1 border rounded px-2 py-1" placeholder="Ask anything..." value={input} onChange={e => setInput(e.target.value)} />
            <button className="bg-blue-600 text-white rounded px-3" onClick={send}>Send</button>
          </div>
        </div>
      )}
    </div>
  );
}

function App() {
  const user = useAuthState();
  const [view, setView] = React.useState('dashboard');

  // Treat anonymous as not fully logged in for UI gate
  if (!user || user.isAnonymous) {
    return <LoginPage />;
  }

  const userId = user.uid;

  return (
    <div className="flex min-h-screen">
      <Sidebar view={view} setView={setView} user={user} />
      <div className="flex-1 p-4">
        {view === 'dashboard' && <Dashboard userId={userId} />}
        {view === 'tasks' && <TasksPage userId={userId} />}
        {view === 'focus' && <FocusTimer userId={userId} />}
        {view === 'decks' && <DecksPage userId={userId} />}
      </div>
      <AIHelper />
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);