"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('dotenv').config();
class Config {
    constructor() {
        this.port = +process.env.PORT;
        this.secretKey = process.env.SECRET_KEY || "SECRET_KEY";
    }
}
;
class DevelopmentConfig extends Config {
    constructor() {
        super();
        this.isProduction = false;
        this.loginExpiresIn = "3h";
        this.mongoConnectionString = "mongodb://127.0.0.1:27017/numbers";
    }
    ;
}
;
class ProductionConfig extends Config {
    constructor() {
        super();
        this.isProduction = true;
        this.loginExpiresIn = "30m";
        this.mongoConnectionString = process.env.MONGO_CONNECTION_STRING;
    }
    ;
}
;
const config = process.env.NODE_ENV !== "production" ? new DevelopmentConfig() : new ProductionConfig();
exports.default = config;
