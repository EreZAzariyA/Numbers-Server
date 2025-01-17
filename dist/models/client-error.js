"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class ClientError {
    constructor(status, message) {
        this.status = status;
        this.message = message;
    }
    ;
}
;
exports.default = ClientError;
