import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { BACKEND_URL } from '../config';

export function useSocket() {
  const socketRef = useRef(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const socket = io(BACKEND_URL, {
      transports: ['websocket'],
      reconnectionAttempts: 5,
      reconnectionDelay: 2000,
    });

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    socketRef.current = socket;
    return () => socket.disconnect();
  }, []);

  return { socket: socketRef.current, connected, socketRef };
}
