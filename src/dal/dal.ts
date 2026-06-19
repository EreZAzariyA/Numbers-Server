import { connect, connection } from "mongoose";
import config from "../utils/config";
import { setMongoStatus } from "../utils/runtime-status";

let mongoListenersBound = false;

const bindMongoListeners = (): void => {
  if (mongoListenersBound) {
    return;
  }

  mongoListenersBound = true;

  connection.on('connected', () => {
    setMongoStatus('up', connection.name || null);
  });

  connection.on('disconnected', () => {
    setMongoStatus('down');
  });
};

async function connectToMongoDB(): Promise<string> {
  bindMongoListeners();

  try {
    const db = await connect(config.mongoConnectionString);
    setMongoStatus('up', db.connections[0].name);
    return db.connections[0].name;
  } catch (err: any) {
    setMongoStatus('down');
    config.log.error({ err: err.message }, 'MongoDB connection failed');
    throw err;
  }
};

export default connectToMongoDB;
