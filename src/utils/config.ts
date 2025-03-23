require('dotenv').config();
import { name, version } from '../../package.json';
import Logger from 'bunyan';
import { ENV_TYPE, getLogger, getLogLevel } from './helpers';

abstract class Config {
  public port: number = +process.env.PORT;
  public isProduction: boolean;
  public loginExpiresIn: number;
  public mongoConnectionString: string;
  public secretKey: string;
  public corsUrls: string[];
  public log: Logger;
};

class DevelopmentConfig extends Config {
  public constructor() {
    super();
    this.isProduction = false;
    this.loginExpiresIn = 30 * 60 * 60;
    this.mongoConnectionString = "mongodb://127.0.0.1:27017/numbers";
    this.corsUrls = ['http://127.0.0.1:3000', 'http://localhost:3000'];
    this.log = getLogger(name, version, getLogLevel(ENV_TYPE.DEVELOPMENT));
    this.secretKey = 'secret';
  };
};

class ProductionConfig extends Config {
  public constructor() {
    super();
    this.isProduction = true;
    this.loginExpiresIn = 30 * 60;
    this.mongoConnectionString = process.env.MONGO_CONNECTION_STRING;
    this.corsUrls = ['http://localhost:3000', 'https://ea-numbers.vercel.app', 'https://ea-numbers-test.vercel.app'];
    this.log = getLogger(name, version, getLogLevel(ENV_TYPE.PRODUCTION));
    this.secretKey = process.env.SECRET_KEY;
  };
};

const config = process.env.NODE_ENV === "production" ? new ProductionConfig() : new DevelopmentConfig();
export default config;