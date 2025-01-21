import { connect, Mongoose } from "mongoose";
import config from "../utils/config";

// async function connectToMongoDB(): Promise<Mongoose> {
//   let db: Mongoose = null;
//   try {
//     if (!db) {
//       db = await connect(config.mongoConnectionString);
//     }
//     return db;
//   } catch (err: any) {
//     console.log(err);
//   }
// };


const uri = process.env.NEXT_ATLAS_URI;
const options = {
    useUnifiedTopology: true,
    useNewUrlParser: true,
};
let mongoClient: Mongoose = null;

async function connectToMongoDB() {
  try {
      if (mongoClient) {
          return mongoClient;
      }
      if (process.env.NODE_ENV === "development") {
          if (!global._mongoClient) {
              mongoClient = await connect(config.mongoConnectionString);
              global._mongoClient = mongoClient;
          } else {
              mongoClient = global._mongoClient;
          }
      } else {
          mongoClient = await connect(config.mongoConnectionString);
      }
      return mongoClient;
  } catch (e) {
      console.error(e);
  }
}

export default connectToMongoDB;
