"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require('dotenv').config();
const package_json_1 = require("../../package.json");
const helpers_1 = require("./helpers");
class Config {
    constructor() {
        this.port = +process.env.PORT;
    }
}
;
class DevelopmentConfig extends Config {
    constructor() {
        super();
        this.isProduction = false;
        this.loginExpiresIn = 30 * 60 * 60;
        this.refreshTokenExpiresIn = 7 * 24 * 60 * 60; // 7 days — outlives the 30h access token
        this.mongoConnectionString = "mongodb://127.0.0.1:27017/numbers";
        this.redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
        this.corsUrls = ['http://127.0.0.1:3000', 'http://localhost:3000'];
        this.log = (0, helpers_1.getLogger)(package_json_1.name, package_json_1.version, (0, helpers_1.getLogLevel)(helpers_1.ENV_TYPE.DEVELOPMENT));
        this.secretKey = 'secret';
        this.enablePatternPersistence = process.env.ENABLE_PATTERN_PERSISTENCE === 'true';
    }
    ;
}
;
class ProductionConfig extends Config {
    constructor() {
        super();
        this.isProduction = true;
        this.loginExpiresIn = 15 * 60;
        this.refreshTokenExpiresIn = 7 * 24 * 60 * 60;
        this.mongoConnectionString = process.env.MONGO_CONNECTION_STRING;
        this.redisUrl = process.env.REDIS_URL;
        this.corsUrls = ['http://localhost:3000', 'https://ea-numbers.vercel.app', 'https://ea-numbers-test.vercel.app'];
        this.log = (0, helpers_1.getLogger)(package_json_1.name, package_json_1.version, (0, helpers_1.getLogLevel)(helpers_1.ENV_TYPE.PRODUCTION));
        this.secretKey = process.env.SECRET_KEY;
        this.enablePatternPersistence = process.env.ENABLE_PATTERN_PERSISTENCE === 'true';
    }
    ;
}
;
const config = process.env.NODE_ENV === "production" ? new ProductionConfig() : new DevelopmentConfig();
exports.default = config;
