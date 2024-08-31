import { createClient } from 'redis';

const redisUrl = `redis://localhost:6379`;

const redisClient = createClient({
  url: redisUrl,
});

const connectRedis = async (): Promise<void> => {
  try {
    await redisClient.connect();
    console.log('Redis client connected...');
  } catch (err: any) {
    throw new Error(`[utils/connectRedis] Error: ${err.message}`);
  }
};

connectRedis();

redisClient.on('error', (err: any) => console.log({ err }));

export default redisClient;