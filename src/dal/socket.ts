import { Server as SocketServer , Socket } from "socket.io";
import { Server as HttpServer } from "http";

const options = {
  cors: {
    origin: "*"
  }
};

class SocketIo {
  socket: SocketServer;

  initSocketIo = (httpServer: HttpServer) => {
    this.socket = new SocketServer(httpServer, options);
    console.log('Socket IO is running...');
    

    this.socket.sockets.on("connection", (socket) => {
      console.log("One client has been connected...");

      socket.on("disconnect", () => {
        console.log("One client has been disconnected...");
      });
    });

    this.socket.of("/admin").on("connection", (socket) => {
      console.log('admin-connected');
    });
  };
};

export const socketIo = new SocketIo();