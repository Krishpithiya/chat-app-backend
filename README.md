# ChatApp — Real-Time Private Text Chat (MERN)

A private, real-time **text-only** messaging application (V1) built with MongoDB,
Express, React, and Node.js, using Socket.IO for real-time delivery.

You control the users, chats, group membership, and permissions — there is no
public sign-up wall other than the app itself, and every action is
authorized on the backend, not just hidden in the UI.

> **Scope note:** This is V1 — text messaging only. No image/file/audio/video
> messages or calls. The data models and API are structured so that media
> support can be added later without a rewrite (see "Future Media Roadmap"
> at the bottom).

---

## 1. Tech Stack

**Frontend:** React 18, Vite, React Router, Axios, Socket.IO Client, Context API, plain CSS (dark theme design system)

**Backend:** Node.js, Express, MongoDB + Mongoose, Socket.IO, JWT (http-only cookies), bcryptjs, helmet, express-rate-limit, cors, cookie-parser

---

## 2. Architecture

```
chat-app/
├── client/                  # React + Vite frontend
│   └── src/
│       ├── components/      # Sidebar, Chat, Group, common UI
│       ├── pages/           # Login, Register, Home, ChatPage, Profile, Settings
│       ├── layouts/         # MainLayout (responsive split view)
│       ├── context/         # AuthContext, SocketContext, ChatContext
│       ├── hooks/           # useAuth, useSocket, useChats, useMessages, useTyping, usePresence
│       ├── services/        # axios-based REST clients
│       └── socket/          # socket.io-client singleton
│
├── server/                  # Express + Socket.IO backend
│   └── src/
│       ├── config/          # env loader, MongoDB connection
│       ├── models/          # User, Chat, Message (Mongoose schemas)
│       ├── controllers/     # auth, user, chat, message
│       ├── middleware/      # JWT auth, error handler, rate limiting
│       ├── routes/          # REST endpoints
│       ├── services/        # tokenService, chatAccessService (shared authorization)
│       ├── socket/          # Socket.IO server, auth middleware, event handlers
│       ├── app.js           # Express app (no listen call — testable)
│       └── server.js        # boots Mongo + HTTP + Socket.IO
│
├── .env.example              # documents all env vars (both apps)
└── README.md
```

### Real-time flow

```
Client logs in  →  JWT set as http-only cookie
     ↓
Client connects Socket.IO (cookie sent automatically)
     ↓
Server verifies JWT on the socket connection (socketAuth.js)
     ↓
Client opens a chat → emits "chat:join" with chatId
     ↓
Server re-checks DB membership before letting the socket join room `chat:<id>`
     ↓
REST "send message" call persists to MongoDB, then the server emits
"message:new" to everyone in that room
```

**Security principle used throughout:** the backend *never* trusts a
client-supplied user id, chat id, or role. Every protected route and every
socket event re-derives the current user from the verified JWT and
re-checks chat membership / admin status against MongoDB before acting.

---

## 3. Prerequisites

- Node.js 18+ and npm
- A MongoDB instance — either:
  - Local MongoDB (`mongod` running on `localhost:27017`), or
  - A free [MongoDB Atlas](https://www.mongodb.com/atlas) cluster (get a connection string)

---

## 4. Installation & Running Locally

### 4.1 Backend

```bash
cd server
npm install
cp .env.example .env
```

Edit `server/.env`:

```env
PORT=5000
NODE_ENV=development
MONGODB_URI=mongodb://127.0.0.1:27017/chat-app
JWT_SECRET=replace_with_a_long_random_string
JWT_EXPIRES_IN=7d
COOKIE_NAME=chat_token
CLIENT_URL=http://localhost:5173
```

Generate a strong `JWT_SECRET` quickly with:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Start MongoDB if running locally (`mongod`), then:

```bash
npm run dev      # nodemon, auto-restarts on changes
# or
npm start        # plain node
```

You should see:
```
[db] MongoDB connected: 127.0.0.1/chat-app
[server] Listening on port 5000 (development)
[server] Accepting client requests from http://localhost:5173
```

Health check: open `http://localhost:5000/api/health` → `{"success":true,"data":{"status":"ok", ...}}`

### 4.2 Frontend

In a second terminal:

```bash
cd client
npm install
cp .env.example .env
```

`client/.env` (defaults already work for local dev):
```env
VITE_API_URL=http://localhost:5000/api
VITE_SOCKET_URL=http://localhost:5000
```

```bash
npm run dev
```

Open `http://localhost:5173`. Register two different accounts (e.g. in a
normal window and an incognito window) to test real-time chat between two
users.

---

## 5. Environment Variables Reference

| Variable | Where | Description |
|---|---|---|
| `PORT` | server | Port the Express/Socket.IO server listens on |
| `NODE_ENV` | server | `development` or `production` (affects cookie `secure`/`sameSite`) |
| `MONGODB_URI` | server | MongoDB connection string |
| `JWT_SECRET` | server | Secret used to sign JWTs — keep this private, never commit it |
| `JWT_EXPIRES_IN` | server | Token lifetime, e.g. `7d` |
| `COOKIE_NAME` | server | Name of the http-only auth cookie |
| `CLIENT_URL` | server | Frontend origin, used for CORS + Socket.IO CORS |
| `VITE_API_URL` | client | Base URL of the backend REST API |
| `VITE_SOCKET_URL` | client | Base URL of the backend Socket.IO server |

---

## 6. Database Models (summary)

**User**: name, username (unique), email (unique), passwordHash, profileImage
(reserved), bio, isOnline, lastSeen, blockedUsers[], timestamps.

**Chat**: type (`private`|`group`), name, image (reserved), description,
createdBy, admins[], members[], lastMessage, unreadCounts (per-user map),
timestamps. Private chats are deduplicated — there is always exactly one
private chat between any two users.

**Message**: chatId, senderId, type (`text` only in V1), text, deliveredTo[],
readBy[], replyTo, editedAt, deletedFor[] (per-user hide), deletedForEveryone,
timestamps.

Indexes: `Chat.members`, `Chat.type+members`, `Message.chatId+createdAt`,
plus unique indexes on `User.username`/`User.email`.

---

## 7. REST API

All responses follow `{ success: true, data: {...} }` or
`{ success: false, message: "..." }`. Auth uses an http-only cookie, so the
frontend never touches the raw JWT.

```
POST   /api/auth/register        { name, username, email, password }
POST   /api/auth/login           { emailOrUsername, password }
POST   /api/auth/logout
GET    /api/auth/me

GET    /api/users/search?q=john
GET    /api/users/:userId
POST   /api/users/:userId/block
DELETE /api/users/:userId/block
GET    /api/users/me/blocked

GET    /api/chats
POST   /api/chats                { type: 'private', userId } | { type: 'group', name, memberIds }
GET    /api/chats/:chatId
PATCH  /api/chats/:chatId        { name?, description? }        (admin only)
POST   /api/chats/:chatId/members        { userId }              (admin only)
DELETE /api/chats/:chatId/members/:userId                        (admin only)
POST   /api/chats/:chatId/admins         { userId }               (admin only, promote)
DELETE /api/chats/:chatId/admins/:userId                          (admin only, demote)
POST   /api/chats/:chatId/leave
POST   /api/chats/:chatId/read

GET    /api/chats/:chatId/messages?before=<id>&limit=30
POST   /api/chats/:chatId/messages       { text, replyTo? }
PATCH  /api/messages/:messageId          { text }                 (owner only)
DELETE /api/messages/:messageId?scope=me|everyone
```

## 8. Socket.IO Events

```
chat:join      { chatId }         → ack { success, message? }   (server verifies membership)
chat:leave     { chatId }
message:new                       ← broadcast on new message
message:edited                    ← broadcast on edit
message:deleted                   ← broadcast on delete-for-everyone
message:delivered { chatId, messageId }  →  and ← broadcast
message:read      { chatId, messageId }  →  and ← broadcast
typing:start / typing:stop { chatId }    →  and ← broadcast (not persisted)
presence:update    ← { userId, isOnline, lastSeen }
chat:updated       ← group metadata / membership changed, client re-syncs
```

---

## 9. How to Test What Was Built

### Quick manual test (2 users, 2 browsers/tabs)

1. Start backend (`server`) and frontend (`client`) as above.
2. Open `http://localhost:5173` in a normal window → **Register User A**.
3. Open the same URL in an **incognito/private window** → **Register User B**
   (separate cookie jar = separate session).
4. As **User A**: click **+ New chat → Direct message**, search for User B's
   name/username, click it. A private chat opens.
5. As **User A**: type a message and hit Enter. It should appear instantly
   in **User B's** window (real-time, no refresh) with an unread badge on
   the sidebar if that chat isn't open.
6. As **User B**: open the chat — the unread badge should clear and User A
   should see the tick marks change from sent → delivered → read.
7. Start typing in either window (without sending) — the other window
   should show "`Name is typing...`" and it should disappear ~2s after you
   stop.
8. Refresh either browser — messages should persist (loaded from MongoDB).
9. Test **edit**: hover a message you sent → ⋮ → Edit → change text → Enter.
   The other user sees "Edited" appear live.
10. Test **delete for me** vs **delete for everyone** and confirm the
    difference between windows.
11. Test **reply**: hover a message → ⋮ → Reply, type a response, send —
    confirm the quoted preview appears above the new message.
12. Close one browser tab entirely (or log out) — the other user's chat
    header should update to "Last seen just now" after a few seconds.

### Groups

1. **+ New chat → New group**, name it, select 2+ members, create.
2. Send a message — all members should receive it in real time.
3. Open **Group info** (header "Info" button, admin only by default =
   creator): try **Add member**, **Remove member**, **Make admin**,
   **Remove admin**, **Rename**.
4. Log in as a **non-admin member** in another window and confirm the admin
   actions are not available/are rejected if attempted via API directly.
5. **Leave group** as a non-creator member and confirm the group disappears
   from that user's chat list but remains for everyone else.

### Security checks (do these with curl/Postman, not just the UI)

These confirm the backend enforces rules even if the frontend is bypassed:

```bash
# 1. Try fetching messages for a chat you're not a member of (expect 403)
curl -i http://localhost:5000/api/chats/<someone_elses_chat_id>/messages \
  -H "Cookie: chat_token=<your_token>"

# 2. Try promoting yourself to admin in a group you didn't create, as a
#    normal member (expect 403 "Only group admins can perform this action")
curl -i -X POST http://localhost:5000/api/chats/<chatId>/admins \
  -H "Content-Type: application/json" -H "Cookie: chat_token=<your_token>" \
  -d '{"userId":"<yourOwnId>"}'

# 3. Try editing someone else's message (expect 403)
curl -i -X PATCH http://localhost:5000/api/messages/<their_message_id> \
  -H "Content-Type: application/json" -H "Cookie: chat_token=<your_token>" \
  -d '{"text":"hacked"}'
```

For the Socket.IO layer, open your browser console while logged in as
User A and try:
```js
// This should fail (ack.success === false) unless A is really a member
window.socket?.emit?.('chat:join', { chatId: '<someone_elses_private_chat_id>' }, console.log)
```
(You can expose the socket for testing via `getSocket()` from
`src/socket/socket.js` in a dev console if desired — it isn't attached to
`window` by default for production hygiene.)

### Automated / checklist testing

Follow the full checklist in the original spec:
- Auth: register x2, login, logout, invalid login
- Private chat: search, start, duplicate prevention
- Messaging: send/receive instantly, persistence after refresh, replies
- Typing start/stop
- Presence: online, disconnect, last seen updates
- Read/delivery tick progression
- Non-member cannot access/send/fetch a chat's data
- Non-admin cannot perform admin actions
- Group create/add/remove/promote/demote/leave/send

---

## 10. Production Considerations

- Set `NODE_ENV=production` so cookies are sent with `secure: true` and
  `sameSite: 'none'` (required if frontend and backend are on different
  domains over HTTPS).
- Put the backend behind HTTPS (e.g. via a reverse proxy/load balancer) —
  http-only secure cookies require it.
- Use a managed MongoDB (Atlas) with authentication and IP allow-listing.
- Rotate `JWT_SECRET` and store it in a secrets manager, not in source control.
- Tighten `express-rate-limit` values for your expected traffic.
- Consider horizontal scaling: Socket.IO needs a shared adapter (e.g.
  `@socket.io/redis-adapter`) if you run more than one server instance,
  so that room broadcasts reach sockets connected to other instances.
- Add structured logging/monitoring before exposing this to real users.

---

## 11. Future Media Roadmap (not implemented in V1)

The schema and API were deliberately kept extendable:
- `Message.type` already accepts an enum — adding `image | file | audio | video`
  plus an `attachments[]` field is additive, not a breaking change.
- `User.profileImage` and `Chat.image` fields already exist and are simply
  unpopulated placeholders today.
- When media is added, a dedicated upload route + storage service (S3-compatible
  or similar) can be introduced without touching the existing text-message
  code paths.

---

## 12. Known Simplifications (by design, per the V1 spec)

- No file/image/audio/video upload of any kind.
- No push notifications — real-time delivery only works while the app/tab is open.
- Blocking prevents starting *new* private chats between blocked pairs; it
  does not retroactively hide chat history from an already-existing chat.
- No automated test suite is included — testing is manual/curl-based as
  described above, per the checklist in the original spec.
