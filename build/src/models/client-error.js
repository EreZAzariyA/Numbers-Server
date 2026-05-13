"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class ClientError {
    constructor(status, message, payload) {
        this.status = status;
        this.message = message;
        this.payload = payload;
    }
    ;
}
;
exports.default = ClientError;
