# ChatterApp

A lightweight real-time, room-based chat app built with **Socket.IO**, **Express**, and **MongoDB**. Anyone can join a named room, chat live with everyone else in it, and every message is persisted so an admin can watch every room live from a separate dashboard.

## Features

**Chat**
- **Room-based chat** — join any room by name; messages, typing indicators, and the connected-users list are all scoped to that room only.
- **Live presence** — see who's currently in your room, get notified when someone joins or leaves, and see a "user is typing..." indicator in real time.
- **Leave Room** — cleanly exit a room and notify everyone still in it.
- **No signup required** — pick a name and a room, you're in.
- **Persistent history** — every message, every room, and every join event is saved to MongoDB, so nothing is lost when the server restarts.

**Admin dashboard**
- **Password-protected**, credentials from environment variables (no database record involved in auth).
- **Live, not polled** — a dedicated, authenticated Socket.IO channel (`/admin`) pushes every message and join/leave event to the dashboard the instant it happens.
- **One box per room**, arranged 2 per row, sized to fit exactly 2 rows (4 rooms) on screen at once — more rooms scroll the grid, not the page.
- **Real room names** — each box header is whatever name a user actually typed when joining, never a fixed label.
- **Bold usernames** — every line reads `Username: message` (or `Username: joined the chat` / `left the chat`), name always bold.

**Design**
- Old-Facebook-style visual language: light grey canvas, white content cards, thin grey borders.
- Blue for primary actions (Send, Join Chat, Login, Refresh), red for exits (Leave Room, Logout).
- Fully boxy — zero border-radius anywhere, no rounded corners.

**Deployment-ready**
- Served entirely from one Express process (static files + REST API + WebSockets on the same origin) — no separate frontend host needed.
- Reads `PORT` from the environment so it works on any host that assigns its own port (Render, Heroku, etc.).

## Architecture

```mermaid
flowchart LR
    subgraph Clients
        U1["User's Browser<br/>(index.html)"]
        U2["Another User's Browser<br/>(index.html)"]
        A["Admin's Browser<br/>(admin.html)"]
    end

    subgraph Server["Node.js Server (app.js)"]
        IO["Socket.IO default namespace<br/>(chat events)"]
        ADMIN_NS["Socket.IO /admin namespace<br/>(live feed, Basic-Auth gated)"]
        API["Express REST API<br/>(/admin/messages, /admin/joins)"]
        STATIC["Static file serving<br/>(src/ui, src/styles)"]
    end

    DB[("MongoDB Atlas<br/>messages · rooms · roomjoins")]

    U1 <-->|WebSocket| IO
    U2 <-->|WebSocket| IO
    U1 -.->|GET /, GET /styles/*| STATIC
    A -->|GET /admin.html| STATIC
    A -->|HTTPS + Basic Auth, once on login| API
    A <-->|WebSocket, auth on connect| ADMIN_NS

    IO -->|writes| DB
    API -->|reads| DB
    IO -.->|live push| ADMIN_NS
```

## How a chat message travels

```mermaid
sequenceDiagram
    participant Alice as Alice's Browser
    participant Server as Socket.IO Server
    participant Bob as Bob's Browser
    participant Admin as Admin's Browser
    participant DB as MongoDB

    Alice->>Server: newUser {userName: "Alice", room: "1"}
    Server->>DB: upsert Room("1"), insert RoomJoin
    Server-->>Alice: currentUsers (already in "1")
    Server-->>Bob: userJoined "Alice" (if Bob is in room "1")
    Server-->>Admin: adminUserJoined {room: "1", userName: "Alice"}

    Alice->>Server: chatMessage {message: "hi"}
    Server-->>Bob: broadcastedMessage {userName: "Alice", message: "hi"}
    Server-->>Admin: adminMessage {room: "1", userName: "Alice", message: "hi"}
    Server->>DB: insert Message {room: "1", userName: "Alice", message: "hi"}

    Note over Server,DB: Broadcasts happen immediately;<br/>saving to MongoDB never blocks the live chat or the admin feed.
```

## What the admin sees

```mermaid
flowchart TD
    L["Admin opens /admin.html<br/>and enters ADMIN_USERNAME / ADMIN_PASSWORD"]
    L --> AUTH{"Valid credentials?"}
    AUTH -- No --> ERR["Login rejected"]
    AUTH -- Yes --> H["GET /admin/messages + /admin/joins<br/>(seeds each room's box with history)"]
    H --> WS["Connects to the /admin Socket.IO namespace<br/>(same credentials, verified again on the socket)"]
    WS --> D["Grid of room boxes, 2 per row,<br/>4 fit on screen, updates live"]
```

## Tech stack

| Layer | Technology |
|---|---|
| Real-time transport | Socket.IO (default namespace for chat, `/admin` namespace for the live dashboard feed) |
| Web server | Express (serves the API, the static UI, and the Socket.IO endpoint from one process) |
| Database | MongoDB (Atlas or local), via Mongoose |
| Frontend | Plain HTML/CSS/JS (no framework, no build step) |
| Auth (admin only) | HTTP Basic Auth for the REST API; the same credentials re-verified on the `/admin` socket connection |

## Data model

| Collection | Fields | Written when |
|---|---|---|
| `messages` | `room`, `userName`, `message`, `timestamp` | Every chat message sent |
| `rooms` | `name`, `createdAt`, `lastActiveAt` | A room is created or re-joined |
| `roomjoins` | `room`, `userName`, `joinedAt` | Every time a user joins a room |

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `MONGODB_URI` | Yes (or `MONGODB` for local) | Full MongoDB connection string, e.g. `mongodb+srv://user:pass@cluster/chatterApp?retryWrites=true&w=majority`. Takes priority over `MONGODB`. |
| `MONGODB` | No | Fallback host:port used only if `MONGODB_URI` is unset, e.g. `127.0.0.1:27017`. |
| `ADMIN_USERNAME` | Yes | Username for `/admin.html`. |
| `ADMIN_PASSWORD` | Yes | Password for `/admin.html`. Pick something real — not `12345`. |
| `PORT` | No | Port to listen on. Most hosts (Render included) set this automatically; defaults to `3000` locally. |

## Running it locally

1. Install dependencies:
   ```
   npm install
   ```
2. Create a `.env` file with your own values (see [Environment variables](#environment-variables) above).
3. Start the server:
   ```
   npm start
   ```
4. Visit `http://localhost:3000/` to chat.
5. Visit `http://localhost:3000/admin.html` for the live admin dashboard.

Optional: `node seed-temp-data.mjs` inserts a few sample rooms/messages/joins into whatever database `.env` points at, useful for seeing the admin dashboard populated without opening two browser tabs yourself.

## Deploying to Render

This app is a single Node process serving everything (static files, REST API, and WebSockets) on one port, which is exactly what Render's Web Service expects.

1. Push this project to a GitHub/GitLab repo (make sure `.env` is **not** committed — it's already in `.gitignore`).
2. On [Render](https://render.com), create a **New Web Service** and connect that repo.
3. Configure it:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Environment:** Node
4. Add environment variables in Render's dashboard (Settings → Environment) — do **not** put real secrets in `.env` in the repo:
   - `MONGODB_URI`
   - `ADMIN_USERNAME`
   - `ADMIN_PASSWORD`
   - (Don't set `PORT` — Render provides it automatically and the app already reads `process.env.PORT`.)
5. In MongoDB Atlas, go to **Network Access** and allow `0.0.0.0/0`. Render's outbound IPs aren't static on standard plans, so a specific-IP allowlist will intermittently break the connection — this is the single most common deployment issue with this app.
6. Deploy. Once live, open `https://<your-service>.onrender.com/` to chat and `.../admin.html` for the dashboard.

## Project layout

```
ChatterApp/
├── server.js                     # entry point - loads env, starts the HTTP+Socket.IO server on process.env.PORT
├── seed-temp-data.mjs            # optional: inserts sample rooms/messages/joins for local testing
├── src/
│   ├── app.js                    # Express app: static file serving, Socket.IO event handlers, admin REST API + live namespace
│   ├── configs/db.config.js      # MongoDB connection
│   ├── schemas/                  # Mongoose models: Message, Room, RoomJoin
│   ├── ui/
│   │   ├── index.html            # the chat client (served at /)
│   │   └── admin.html            # the admin dashboard (served at /admin.html)
│   └── styles/style.css          # shared styling for both UIs (served at /styles/style.css)
```
