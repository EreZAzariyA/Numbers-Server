"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const client_error_1 = __importDefault(require("../models/client-error"));
function errorsHandler(err, request, response, next) {
    if (err instanceof Error && err.code === 11000) {
        if (err.keyValue['emails.email']) {
            response.status(err.status || 500).send("Email already exist, try to log-in");
            return;
        }
    }
    if (err instanceof Error) {
        response.status(err.status || 500).send('Some error, please contact us');
        console.error({ route: { [request.method]: request.path }, err: err.message });
        return;
    }
    if (err instanceof client_error_1.default) {
        response.status(err.status).send(err.message);
        return;
    }
    next();
}
;
exports.default = errorsHandler;
