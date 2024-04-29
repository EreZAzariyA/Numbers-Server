import bcrypt from "bcrypt";
import ClientError from "../models/client-error";

export const encryptPassword = async (password: string):Promise<String> => {
  const saltRounds = 10;

  try {
    const encryptedPassword = await bcrypt.hash(password, saltRounds);
    return encryptedPassword;
  } catch (error) {
    throw new ClientError(500, error.message);
  }
};

export const comparePassword = async (password: string, encryptedPassword: string):Promise<Boolean> => {
  try {
    const match = await bcrypt.compare(password, encryptedPassword);
    return match;
  } catch (error) {
    throw new ClientError(500, error.message);
  }
};