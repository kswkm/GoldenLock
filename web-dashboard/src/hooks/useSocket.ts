"use client";

import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";

export function useSocket(url = process.env.NEXT_PUBLIC_RELAY_URL || "http://localhost:4000", token?: string) {
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!token) return;
    const socket = io(url, {
      transports: ["websocket", "polling"],
      auth: token ? { token } : undefined,
    });
    socketRef.current = socket;
    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));
    return () => {
      socket.disconnect();
    };
  }, [url, token]);

  return { socket: socketRef, connected };
}