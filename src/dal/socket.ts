import { Server as SocketServer } from "socket.io";
import { Server as HttpServer } from "http";
import jwt from "jsonwebtoken";
import config from "../utils/config";
import { IUserModel } from "../models";

class SocketIo {
  socket: SocketServer;

  initSocketIo = (httpServer: HttpServer) => {
    this.socket = new SocketServer(httpServer, {
      cors: {
        origin: config.corsUrls,
        credentials: true,
      }
    });

    this.socket.use((socket, next) => {
      const token = socket.handshake.auth?.token;
      if (!token) {
        return next(new Error('Authentication required'));
      }

      try {
        const decoded = jwt.verify(token, config.secretKey) as IUserModel;
        socket.data.userId = decoded._id;
        next();
      } catch (err) {
        next(new Error('Invalid token'));
      }
    });

    this.socket.on("connection", (socket) => {
      const userId = socket.data.userId;
      if (userId) {
        socket.join(`user:${userId}`);
      }
      config.log.info(`Socket connected: user ${userId}`);

      socket.on("disconnect", () => {
        config.log.info(`Socket disconnected: user ${userId}`);
      });
    });

    config.log.info('Socket.IO initialized');
  };

  emitToUser = (userId: string, event: string, data: any) => {
    if (!this.socket) return;
    this.socket.to(`user:${userId}`).emit(event, data);
  };
};

export const socketIo = new SocketIo();
