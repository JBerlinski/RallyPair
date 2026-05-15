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

// rooms: { roomCode: { navigator, driver, createdAt, navigatorPending, deleteTimer } }
const rooms = new Map();

const GRACE_MS = 2 * 60 * 1000;   // 2 min grace before destroying room
const STALE_MS = 60 * 60 * 1000;  // 1 h max lifetime

function generateRoomCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function cleanupStaleRooms() {
  const now = Date.now();
  for (const [code, room] of rooms.entries()) {
    if (now - room.createdAt > STALE_MS) {
      clearTimeout(room.deleteTimer);
      rooms.delete(code);
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

    rooms.set(code, {
      navigator: socket.id,
      driver: null,
      createdAt: Date.now(),
      navigatorPending: false,
      deleteTimer: null,
    });

    socket.join(code);
    socket.data.roomCode = code;
    socket.data.role = 'navigator';

    console.log(`[room_created] ${code} by ${socket.id}`);
    callback({ ok: true, roomCode: code });
  });

  // Navigator reconnects and reclaims their room (within grace period)
  socket.on('rejoin_navigator', ({ roomCode }, callback) => {
    const room = rooms.get(roomCode);
    if (!room) {
      return callback({ ok: false, error: 'Room expired' });
    }

    clearTimeout(room.deleteTimer);
    room.deleteTimer = null;
    room.navigatorPending = false;
    room.navigator = socket.id;

    socket.join(roomCode);
    socket.data.roomCode = roomCode;
    socket.data.role = 'navigator';

    const hasDriver = !!room.driver;
    if (hasDriver) socket.to(roomCode).emit('navigator_rejoined');

    console.log(`[navigator_rejoined] ${roomCode} hasDriver=${hasDriver}`);
    callback({ ok: true, roomCode, hasDriver });
  });

  // Driver joins a room
  socket.on('join_room', ({ roomCode }, callback) => {
    const room = rooms.get(roomCode);
    if (!room) return callback({ ok: false, error: 'Room not found' });
    if (room.driver) return callback({ ok: false, error: 'Room already has a driver' });

    room.driver = socket.id;
    socket.join(roomCode);
    socket.data.roomCode = roomCode;
    socket.data.role = 'driver';

    socket.to(roomCode).emit('driver_joined');
    console.log(`[driver_joined] ${roomCode} driver=${socket.id}`);
    callback({ ok: true, roomCode });
  });

  // Driver reconnects to an existing room
  socket.on('rejoin_driver', ({ roomCode }, callback) => {
    const room = rooms.get(roomCode);
    if (!room) return callback({ ok: false, error: 'Room not found' });

    room.driver = socket.id;
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
    socket.to(roomCode).emit('route_update', payload);
    console.log(`[route_update] room=${roomCode}`);
  });

  // Driver sends GPS position to navigator
  socket.on('send_position', (payload) => {
    const { roomCode, role } = socket.data;
    if (!roomCode || role !== 'driver') return;
    socket.to(roomCode).emit('position_update', payload);
  });

  socket.on('disconnect', () => {
    const { roomCode, role } = socket.data;
    if (!roomCode) return;

    const room = rooms.get(roomCode);
    if (!room) return;

    if (role === 'navigator') {
      // Start grace period — don't destroy immediately so navigator can rejoin
      room.navigatorPending = true;
      room.deleteTimer = setTimeout(() => {
        if (rooms.has(roomCode)) {
          io.to(roomCode).emit('room_closed', { reason: 'navigator_disconnected' });
          rooms.delete(roomCode);
          console.log(`[room_expired] ${roomCode}`);
        }
      }, GRACE_MS);

      socket.to(roomCode).emit('navigator_reconnecting');
      console.log(`[navigator_disconnected] ${roomCode} — grace ${GRACE_MS / 1000}s`);

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
