require('dotenv').config();
import { name, version } from '../../package.json';
import Logger from 'bunyan';
import { ENV_TYPE, getLogger, getLogLevel } from './helpers';

abstract class Config {
  public port: number = +process.env.PORT;
  public isProduction: boolean;
  public loginExpiresIn: number;
  public refreshTokenExpiresIn: number;
  public mongoConnectionString: string;
  public redisUrl: string;
  public secretKey: string;
  public corsUrls: string[];
  public log: Logger;
  public enablePatternPersistence: boolean;
};

class DevelopmentConfig extends Config {
  public constructor() {
    super();
    this.isProduction = false;
    this.loginExpiresIn = 30 * 60 * 60;
    this.refreshTokenExpiresIn = 7 * 24 * 60 * 60; // 7 days — outlives the 30h access token
    this.mongoConnectionString = "mongodb://127.0.0.1:27017/numbers";
    this.redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    this.corsUrls = ['http://127.0.0.1:3000', 'http://localhost:3000'];
    this.log = getLogger(name, version, getLogLevel(ENV_TYPE.DEVELOPMENT));
    this.secretKey = 'secret';
    this.enablePatternPersistence = process.env.ENABLE_PATTERN_PERSISTENCE === 'true';
  };
};

class ProductionConfig extends Config {
  public constructor() {
    super();
    this.isProduction = true;
    this.loginExpiresIn = 15 * 60;
    this.refreshTokenExpiresIn = 7 * 24 * 60 * 60;
    this.mongoConnectionString = process.env.MONGO_CONNECTION_STRING;
    this.redisUrl = process.env.REDIS_URL;
    this.corsUrls = ['http://localhost:3000', 'https://ea-numbers.vercel.app', 'https://ea-numbers-test.vercel.app'];
    this.log = getLogger(name, version, getLogLevel(ENV_TYPE.PRODUCTION));
    this.secretKey = process.env.SECRET_KEY;
    this.enablePatternPersistence = process.env.ENABLE_PATTERN_PERSISTENCE === 'true';
  };
};

const config = process.env.NODE_ENV === "production" ? new ProductionConfig() : new DevelopmentConfig();
export default config;
