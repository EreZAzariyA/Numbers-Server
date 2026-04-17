import { connect } from "mongoose";
import config from "../utils/config";

async function connectToMongoDB(): Promise<string> {
  try {
    const db = await connect(config.mongoConnectionString);
    return db.connections[0].name;
  } catch (err: any) {
    config.log.error({ err: err.message }, 'MongoDB connection failed');
    throw err;
  }
};

export default connectToMongoDB;
