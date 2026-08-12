# Ramo 🔍

**AI-generated escape rooms. Every game is different. One of you is a traitor.**

Ramo is a real-time multiplayer escape room game where puzzles are generated fresh by AI for every playthrough — no two games are ever the same. Players work together against the clock to solve a sequence of AI-crafted puzzles (ciphers, logic deduction, math, anagrams), while one randomly assigned player is secretly the traitor.

Built as a full-stack portfolio project to demonstrate real-time systems, AI integration, and production-style engineering decisions — not just CRUD.

---

## 🎮 How It Works

1. **Create or join a room** using a 6-character room code
2. **Wait for players** — need at least 2 to start
3. **Start the game** — one player is randomly and secretly assigned as the traitor
4. **Solve 5 AI-generated puzzles** as a team, racing against a 10-minute timer
5. **Escape in time** to win, or run out of time and the case goes cold

---

## 🛠️ Tech Stack

**Frontend**
- Angular (standalone components, new `@if`/`@for` control flow)
- Angular Material
- Socket.io Client
- SCSS (custom "case file" design system)

**Backend**
- NestJS
- PostgreSQL + TypeORM
- Socket.io (real-time multiplayer sync)
- Groq API (Llama 3.3 70B) — AI puzzle generation

---

## ✨ Key Engineering Decisions

A few things worth highlighting beyond "it works":

- **Server-authoritative timer** — the countdown runs on the backend and is broadcast to all clients every second, rather than trusting each browser's own clock. Keeps every player perfectly in sync and prevents tampering.
- **AI prompt engineering for variety** — early versions of the puzzle generator kept defaulting to the same overused riddles (e.g. "I am always coming but never arrive"). The prompt explicitly bans specific overused answers and forces a mix of puzzle categories (cipher, math, logic deduction, anagram, spatial) so every game feels genuinely different.
- **Answer normalization** — since the AI doesn't always format answers consistently (`"3:15"` vs `"315"`), submitted and stored answers are both normalized (lowercase, punctuation stripped) before comparison, so players aren't penalized for reasonable formatting differences.
- **Reconnect resilience** — if a player's browser tab is closed or loses connection mid-game (laptop sleep, network drop) and reconnects later, the client automatically resyncs with the server's current state (current puzzle or final outcome) instead of showing a frozen, stale screen.
- **Double-start protection** — starting a game twice for the same room (e.g. a double-click) no longer regenerates a duplicate puzzle set; it detects the existing puzzles and resends the current one instead.
- **Direct-link edge case** — opening a game/room URL in a fresh tab (e.g. a copied link) without going through the join flow no longer creates a "ghost" player with no identity. The app detects the missing session and redirects to Home with the room code pre-filled.

---

## 📂 Project Structure

```
ramo/
├── ramo-backend/     # NestJS API + Socket.io gateway
└── ramo-frontend/    # Angular client
```

---

## 🚀 Running Locally

### Backend
```bash
cd ramo-backend
npm install
# Create a .env file (see below)
npm run start:dev
```

**`.env` (backend)**
```env
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=your_postgres_password
DB_NAME=ramo
GROQ_API_KEY=your_groq_api_key
```

> Groq API keys are free — no credit card required. Get one at [console.groq.com](https://console.groq.com).

### Frontend
```bash
cd ramo-frontend
npm install
ng serve
```

Visit `http://localhost:4200`. The backend runs on `http://localhost:3000`.

---

## 🧠 Known Behavior & Limitations

Documented deliberately rather than left as silent gotchas:

- **Traitor identity is currently broadcast to all players** (not sent privately to just the traitor's socket), since the backend doesn't yet maintain a reliable `playerId → socketId` mapping. Acceptable for demo purposes; flagged as a fix for a production version.
- **No minimum player enforcement mid-game** — if players leave after a game has started, the game continues for whoever remains. Only the initial "start game" action requires 2+ players.
- **Puzzle difficulty is AI-judged**, not deterministically balanced — occasional puzzles may be easier or harder than intended since difficulty scaling is prompt-guided rather than rule-based.

---

## 🗺️ Possible Future Directions

- Location-based / outdoor mode using real-world landmarks (Google Maps integration)
- Voice-based AI Game Master narration
- Additional themes beyond Heist (Horror, Comedy, Sci-fi)
- Private per-player traitor assignment via proper socket-to-player mapping
- Persistent player stats / leaderboard

---

## 👤 Author

Built by Nirav Prajapati — Full Stack Developer (Angular + NestJS), Melbourne, Australia.
