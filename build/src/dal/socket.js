"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.socketIo = void 0;
const socket_io_1 = require("socket.io");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const config_1 = __importDefault(require("../utils/config"));
class SocketIo {
    constructor() {
        this.initSocketIo = (httpServer) => {
            this.socket = new socket_io_1.Server(httpServer, {
                cors: {
                    origin: config_1.default.corsUrls,
                    credentials: true,
                }
            });
            this.socket.use((socket, next) => {
                var _a;
                const token = (_a = socket.handshake.auth) === null || _a === void 0 ? void 0 : _a.token;
                if (!token) {
                    return next(new Error('Authentication required'));
                }
                try {
                    const decoded = jsonwebtoken_1.default.verify(token, config_1.default.secretKey);
                    socket.data.userId = decoded._id;
                    next();
                }
                catch (err) {
                    next(new Error('Invalid token'));
                }
            });
            this.socket.on("connection", (socket) => {
                const userId = socket.data.userId;
                if (userId) {
                    socket.join(`user:${userId}`);
                }
                config_1.default.log.info(`Socket connected: user ${userId}`);
                socket.on("disconnect", () => {
                    config_1.default.log.info(`Socket disconnected: user ${userId}`);
                });
            });
            config_1.default.log.info('Socket.IO initialized');
        };
        this.emitToUser = (userId, event, data) => {
            if (!this.socket)
                return;
            this.socket.to(`user:${userId}`).emit(event, data);
        };
    }
}
;
exports.socketIo = new SocketIo();
