"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.socketIo = void 0;
const socket_io_1 = require("socket.io");
const options = {
    cors: {
        origin: "*"
    }
};
class SocketIo {
    constructor() {
        this.initSocketIo = (httpServer) => {
            this.socket = new socket_io_1.Server(httpServer, options);
            console.log('Socket IO is running...');
            this.socket.sockets.on("connection", (socket) => {
                console.log("One client has been connected...");
                socket.on("disconnect", () => {
                    console.log("One client has been disconnected...");
                });
            });
            this.socket.of("/admin").on("connection", () => {
                console.log('admin-connected');
            });
        };
    }
}
;
exports.socketIo = new SocketIo();
