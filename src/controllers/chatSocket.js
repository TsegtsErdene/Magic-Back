import { Server } from 'socket.io';

export function initChatSocket(httpServer) {
  const io = new Server(httpServer, { cors: { origin: '*' } });

  // room: conversationId, userId гэх мэтээр сегментлэх боломжтой
  io.on('connection', (socket) => {
    socket.on('chat:join', ({ conversationId }) => {
      if (!conversationId) return;
      socket.join(conversationId);
      socket.emit('chat:joined', { conversationId });
    });
  });

  // гаднаас дуудах helper — Flow #2 webhook ирэхэд дуудна
  function pushMessage({ conversationId, from, text, ts }) {
    io.to(conversationId).emit('chat:newMessage', { from, text, ts });
  }

  return { io, pushMessage };
}
