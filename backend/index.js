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

// rooms: { roomCode: { navigator: socketId, driver: socketId, createdAt: Date } }
const rooms = new Map();

function generateRoomCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function cleanupStaleRooms() {
  const ONE_HOUR = 60 * 60 * 1000;
  const now = Date.now();
  for (const [code, room] of rooms.entries()) {
    if (now - room.createdAt > ONE_HOUR) {
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
    do {
      code = generateRoomCode();
      attempts++;
    } while (rooms.has(code) && attempts < 100);

    rooms.set(code, {
      navigator: socket.id,
      driver: null,
      createdAt: Date.now(),
    });

    socket.join(code);
    socket.data.roomCode = code;
    socket.data.role = 'navigator';

    console.log(`[room_created] ${code} by ${socket.id}`);
    callback({ ok: true, roomCode: code });
  });

  // Driver joins a room
  socket.on('join_room', ({ roomCode }, callback) => {
    const room = rooms.get(roomCode);
    if (!room) {
      return callback({ ok: false, error: 'Room not found' });
    }
    if (room.driver) {
      return callback({ ok: false, error: 'Room already has a driver' });
    }

    room.driver = socket.id;
    socket.join(roomCode);
    socket.data.roomCode = roomCode;
    socket.data.role = 'driver';

    // Notify navigator that driver joined
    socket.to(roomCode).emit('driver_joined');

    console.log(`[driver_joined] ${roomCode} driver=${socket.id}`);
    callback({ ok: true, roomCode });
  });

  // Navigator sends destination/waypoints to driver
  socket.on('send_route', (payload) => {
    const { roomCode, role } = socket.data;
    if (!roomCode || role !== 'navigator') return;

    // relay to everyone else in the room (the driver)
    socket.to(roomCode).emit('route_update', payload);
    console.log(`[route_update] room=${roomCode}`);
  });

  // Driver sends GPS position back to navigator (optional telemetry)
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
      // Navigator left — notify driver and destroy room
      socket.to(roomCode).emit('room_closed', { reason: 'navigator_disconnected' });
      rooms.delete(roomCode);
      console.log(`[room_closed] ${roomCode} (navigator left)`);
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
