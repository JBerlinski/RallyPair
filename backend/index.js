const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

// rooms: { roomCode: { navigator, driver, lastActivity, ttlTimer } }
const rooms = new Map();

const TTL_MS   = 60 * 60 * 1000;  // 60 min inactivity TTL
const STALE_MS = 4 * 60 * 60 * 1000;  // 4 h absolute ceiling

function generateRoomCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function resetTTL(room, code) {
  clearTimeout(room.ttlTimer);
  room.lastActivity = Date.now();
  room.ttlTimer = setTimeout(() => {
    if (rooms.has(code)) {
      io.to(code).emit('room_closed', { reason: 'ttl_expired' });
      rooms.delete(code);
      console.log(`[room_ttl] ${code} expired after inactivity`);
    }
  }, TTL_MS);
}

function cleanupStaleRooms() {
  const now = Date.now();
  for (const [code, room] of rooms.entries()) {
    if (now - room.lastActivity > STALE_MS) {
      clearTimeout(room.ttlTimer);
      rooms.delete(code);
      console.log(`[room_stale] ${code} removed`);
    }
  }
}

setInterval(cleanupStaleRooms, 10 * 60 * 1000);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', rooms: rooms.size });
});

io.on('connection', (socket) => {
  console.log(`[connect] ${socket.id}`);

  // Navigator creates a room
  socket.on('create_room', (callback) => {
    let code;
    let attempts = 0;
    do { code = generateRoomCode(); attempts++; }
    while (rooms.has(code) && attempts < 100);

    const room = {
      navigator: socket.id,
      driver: null,
      lastActivity: Date.now(),
      ttlTimer: null,
    };
    rooms.set(code, room);
    resetTTL(room, code);

    socket.join(code);
    socket.data.roomCode = code;
    socket.data.role = 'navigator';

    console.log(`[room_created] ${code} by ${socket.id}`);
    callback({ ok: true, roomCode: code });
  });

  // Navigator reconnects and reclaims their slot
  socket.on('rejoin_navigator', ({ roomCode }, callback) => {
    const room = rooms.get(roomCode);
    if (!room) return callback({ ok: false, error: 'Room expired' });

    room.navigator = socket.id;
    resetTTL(room, roomCode);

    socket.join(roomCode);
    socket.data.roomCode = roomCode;
    socket.data.role = 'navigator';

    const hasDriver = !!room.driver;
    if (hasDriver) socket.to(roomCode).emit('navigator_rejoined');

    console.log(`[navigator_rejoined] ${roomCode} hasDriver=${hasDriver}`);
    callback({ ok: true, roomCode, hasDriver });
  });

  // Driver joins a room — replaces occupant if slot taken (handles rejoin by code)
  socket.on('join_room', ({ roomCode }, callback) => {
    const room = rooms.get(roomCode);
    if (!room) return callback({ ok: false, error: 'Room not found' });

    room.driver = socket.id;
    resetTTL(room, roomCode);

    socket.join(roomCode);
    socket.data.roomCode = roomCode;
    socket.data.role = 'driver';

    socket.to(roomCode).emit('driver_joined');
    console.log(`[driver_joined] ${roomCode} driver=${socket.id}`);
    callback({ ok: true, roomCode });
  });

  // Driver reconnects via remembered room code
  socket.on('rejoin_driver', ({ roomCode }, callback) => {
    const room = rooms.get(roomCode);
    if (!room) return callback({ ok: false, error: 'Room not found' });

    room.driver = socket.id;
    resetTTL(room, roomCode);

    socket.join(roomCode);
    socket.data.roomCode = roomCode;
    socket.data.role = 'driver';

    socket.to(roomCode).emit('driver_joined');
    console.log(`[driver_rejoined] ${roomCode} driver=${socket.id}`);
    callback({ ok: true, roomCode });
  });

  // Navigator sends route to driver
  socket.on('send_route', (payload) => {
    const { roomCode, role } = socket.data;
    if (!roomCode || role !== 'navigator') return;
    const room = rooms.get(roomCode);
    if (room) resetTTL(room, roomCode);
    socket.to(roomCode).emit('route_update', payload);
    console.log(`[route_update] room=${roomCode}`);
  });

  // Driver sends GPS position to navigator
  socket.on('send_position', (payload) => {
    const { roomCode, role } = socket.data;
    if (!roomCode || role !== 'driver') return;
    const room = rooms.get(roomCode);
    if (room) resetTTL(room, roomCode);
    socket.to(roomCode).emit('position_update', payload);
  });

  socket.on('disconnect', () => {
    const { roomCode, role } = socket.data;
    if (!roomCode) return;

    const room = rooms.get(roomCode);
    if (!room) return;

    if (role === 'navigator') {
      room.navigator = null;
      socket.to(roomCode).emit('navigator_reconnecting');
      console.log(`[navigator_disconnected] ${roomCode} — TTL continues`);
    } else if (role === 'driver') {
      room.driver = null;
      socket.to(roomCode).emit('driver_disconnected');
      console.log(`[driver_disconnected] room=${roomCode}`);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`RallyPair backend listening on port ${PORT}`);
});
