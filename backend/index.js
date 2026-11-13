const express = require('express');
const http = require('http');
const crypto = require('crypto');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  maxHttpBufferSize: 4e6, // roadbooks carry the full route geometry
});

// rooms: code → { navigator, driver, token, roadbook, lastActivity, ttlTimer }
const rooms = new Map();

const TTL_MS = 60 * 60 * 1000; // 60 min inactivity TTL
const MAX_ROUTE_POINTS = 60000;
const MAX_NOTES = 5000;

function generateRoomCode() {
  return crypto.randomInt(100000, 1000000).toString();
}

function touch(room, code) {
  clearTimeout(room.ttlTimer);
  room.lastActivity = Date.now();
  room.ttlTimer = setTimeout(() => {
    if (rooms.get(code) !== room) return;
    io.to(code).emit('room_closed', { reason: 'ttl_expired' });
    io.in(code).socketsLeave(code);
    rooms.delete(code);
    console.log(`[room_ttl] ${code} expired after inactivity`);
  }, TTL_MS);
}

const noop = () => {};
// Clients may omit the payload, in which case the acknowledgement arrives first.
const ack = (...args) => args.find((a) => typeof a === 'function') || noop;
const isCode = (c) => typeof c === 'string' && /^\d{6}$/.test(c);
const isNum = (n) => typeof n === 'number' && Number.isFinite(n);

function validRoadbook(rb) {
  return rb && typeof rb === 'object'
    && Array.isArray(rb.coords) && rb.coords.length >= 2 && rb.coords.length <= MAX_ROUTE_POINTS
    && Array.isArray(rb.notes) && rb.notes.length <= MAX_NOTES
    && Array.isArray(rb.waypoints);
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok', rooms: rooms.size });
});

io.on('connection', (socket) => {
  // Returns the room only when this socket really holds the given role in it.
  function roomFor(role) {
    const { roomCode, role: r } = socket.data;
    if (!roomCode || r !== role) return null;
    const room = rooms.get(roomCode);
    if (!room || room[role] !== socket.id) return null;
    return room;
  }

  function enter(room, code, role) {
    const previous = room[role];
    if (previous && previous !== socket.id) {
      // Slot taken over (reconnect from the same phone, or a new device).
      const old = io.sockets.sockets.get(previous);
      if (old) { old.leave(code); old.data.roomCode = null; old.emit('replaced'); }
    }
    room[role] = socket.id;
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.role = role;
    touch(room, code);
  }

  // Navigator creates a room
  socket.on('create_room', (callback) => {
    const cb = ack(callback);
    let code;
    let attempts = 0;
    do { code = generateRoomCode(); attempts++; } while (rooms.has(code) && attempts < 100);
    if (rooms.has(code)) return cb({ ok: false, error: 'No free room codes' });

    const room = {
      navigator: null, driver: null,
      token: crypto.randomBytes(16).toString('hex'),
      roadbook: null, lastActivity: Date.now(), ttlTimer: null,
    };
    rooms.set(code, room);
    enter(room, code, 'navigator');
    console.log(`[room_created] ${code}`);
    cb({ ok: true, roomCode: code, token: room.token });
  });

  // Navigator reconnects and reclaims the slot — only with the token issued at creation
  socket.on('rejoin_navigator', (payload, callback) => {
    const cb = ack(payload, callback);
    const { roomCode, token } = payload || {};
    const room = isCode(roomCode) ? rooms.get(roomCode) : null;
    if (!room) return cb({ ok: false, error: 'Room expired' });
    if (room.token !== token) return cb({ ok: false, error: 'Forbidden' });

    enter(room, roomCode, 'navigator');
    const hasDriver = !!room.driver;
    if (hasDriver) socket.to(roomCode).emit('navigator_rejoined');
    console.log(`[navigator_rejoined] ${roomCode} hasDriver=${hasDriver}`);
    cb({ ok: true, roomCode, hasDriver, hasRoadbook: !!room.roadbook });
  });

  // Driver joins (or rejoins) by code and immediately receives the current roadbook
  function joinAsDriver(payload, callback) {
    const cb = ack(payload, callback);
    const { roomCode } = payload || {};
    const room = isCode(roomCode) ? rooms.get(roomCode) : null;
    if (!room) return cb({ ok: false, error: 'Room not found' });

    enter(room, roomCode, 'driver');
    socket.to(roomCode).emit('driver_joined');
    console.log(`[driver_joined] ${roomCode}`);
    cb({ ok: true, roomCode, roadbook: room.roadbook, hasNavigator: !!room.navigator });
  }
  socket.on('join_room', joinAsDriver);
  socket.on('rejoin_driver', joinAsDriver);

  // Navigator publishes a full roadbook (route geometry + pacenotes)
  socket.on('set_roadbook', (roadbook, callback) => {
    const cb = ack(roadbook, callback);
    const room = roomFor('navigator');
    if (!room) return cb({ ok: false, error: 'Not in a room' });
    if (roadbook !== null && !validRoadbook(roadbook)) return cb({ ok: false, error: 'Bad roadbook' });
    room.roadbook = roadbook;
    touch(room, socket.data.roomCode);
    socket.to(socket.data.roomCode).emit('roadbook', roadbook);
    cb({ ok: true });
  });

  // Navigator edits pacenotes only — geometry is not resent
  socket.on('update_notes', (payload, callback) => {
    const cb = ack(payload, callback);
    const room = roomFor('navigator');
    const { routeId, notes } = payload || {};
    if (!room || !room.roadbook) return cb({ ok: false, error: 'No roadbook' });
    if (room.roadbook.id !== routeId || !Array.isArray(notes) || notes.length > MAX_NOTES) {
      return cb({ ok: false, error: 'Bad notes' });
    }
    room.roadbook = { ...room.roadbook, notes };
    touch(room, socket.data.roomCode);
    socket.to(socket.data.roomCode).emit('notes_update', { routeId, notes });
    cb({ ok: true });
  });

  // Navigator starts the countdown on both screens
  socket.on('start_countdown', (payload) => {
    const room = roomFor('navigator');
    if (!room) return;
    const seconds = Math.min(10, Math.max(3, Math.round(Number(payload?.seconds) || 5)));
    io.to(socket.data.roomCode).emit('countdown', { seconds });
  });

  // Driver sends GPS position (+ progress along the route) to navigator
  socket.on('send_position', (payload) => {
    const room = roomFor('driver');
    if (!room || !payload || !isNum(payload.lat) || !isNum(payload.lng)) return;
    touch(room, socket.data.roomCode);
    socket.to(socket.data.roomCode).volatile.emit('position_update', payload);
  });

  socket.on('disconnect', () => {
    const { roomCode, role } = socket.data;
    const room = roomCode ? rooms.get(roomCode) : null;
    // Ignore sockets whose slot was already taken over by a newer connection.
    if (!room || room[role] !== socket.id) return;
    room[role] = null;
    socket.to(roomCode).emit(role === 'navigator' ? 'navigator_reconnecting' : 'driver_disconnected');
    console.log(`[${role}_disconnected] ${roomCode}`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`RallyPair backend listening on port ${PORT}`);
});
