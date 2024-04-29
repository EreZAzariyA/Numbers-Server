require('dotenv').config();

abstract class Config {
  public port: number = +process.env.PORT;
  public isProduction: boolean;
  public loginExpiresIn: string;
  public mongoConnectionString: string;
  public secretKey = process.env.SECRET_KEY || "SECRET_KEY";
  public corsUrls: string[];
};

class DevelopmentConfig extends Config {
  public constructor() {
    super();
    this.isProduction = false;
    this.loginExpiresIn = "3h";
    this.mongoConnectionString = "mongodb://127.0.0.1:27017/numbers";
    this.corsUrls = ['http://127.0.0.1:3000', 'http://localhost:3000'];
  };
};

class ProductionConfig extends Config {
  public constructor() {
    super();
    this.isProduction = true;
    this.loginExpiresIn = "30m";
    this.mongoConnectionString = process.env.MONGO_CONNECTION_STRING;
    this.corsUrls = ['https://ea-numbers.vercel.app', 'https://ea-numbers-test.vercel.app'];
  };
};

const config = process.env.NODE_ENV !== "production" ? new DevelopmentConfig() : new ProductionConfig();

export default config;
