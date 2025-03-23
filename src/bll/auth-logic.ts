import { googleClient } from "../dal";
import { IUserModel, ClientError, CredentialsModel, UserModel } from "../models";
import { comparePassword, encryptPassword } from "../utils/bcrypt-utils";
import google from "../utils/google";
import { ErrorMessages, MAX_LOGIN_ATTEMPTS, removeServicesFromUser } from "../utils/helpers";
import jwtService from "../utils/jwt";

const client = googleClient;

class AuthenticationLogic {
  signup = async (user: IUserModel): Promise<string> => {
    const newEncryptedPassword: string = await encryptPassword(user.services.password);
    user.services.password = newEncryptedPassword;

    const errors = user.validateSync();
    if (errors) {
      throw new ClientError(500, errors.message);
    }

    const savedUser = await user.save();
    const userWithoutServices = removeServicesFromUser(savedUser);
    const token = jwtService.getNewToken(userWithoutServices);
    return token;
  };

  signin = async (credentials: CredentialsModel): Promise<string> => {
    const user = await UserModel.findOne({ 'emails.email': credentials.email }).exec();
    if (!user) {
      throw new ClientError(400, ErrorMessages.INCORRECT_PASSWORD);
    }

    if (user.loginAttempts.attempts >= MAX_LOGIN_ATTEMPTS) {
      throw new ClientError(500, ErrorMessages.MAX_LOGIN_ATTEMPTS);
    }

    const passwordMatch = await comparePassword(credentials.password, user.services.password || '');
    if (!passwordMatch) {
      user.loginAttempts = {
        attempts: user.loginAttempts.attempts + 1 || 1,
        lastAttemptDate: new Date().valueOf()
      };
      await user.save({ validateBeforeSave: true });
      throw new ClientError(400, ErrorMessages.INCORRECT_PASSWORD);
    }

    user.loginAttempts = {
      attempts: 0,
      lastAttemptDate: new Date().valueOf()
    };
    await user.save({ validateBeforeSave: true });

    const userWithoutServices = removeServicesFromUser(user);
    const token = jwtService.getNewToken(userWithoutServices);

    return token;
  };

  google = async (credential: string, clientId: string): Promise<string> => {
    const loginTicket = await client.verifyIdToken({ idToken: credential, audience: clientId });
    const email = loginTicket.getPayload().email;

    if (!email) {
      throw new ClientError(400 ,'Some error while trying to get the user email')
    }

    const isSigned = await UserModel.exists({ 'emails.email': email }).exec();
    let user: IUserModel = null;

    if (isSigned) {
      user = await UserModel.findOne({ 'emails.email': email }).select('-services').exec();
    } else {
      const payload = loginTicket.getPayload();
      user = await google.createUserForGoogleAccounts(payload);
    }
    if (!user) {
      throw new ClientError(500, ErrorMessages.SOME_ERROR);
    }

    const userWithoutServices = removeServicesFromUser(user);
    const token = jwtService.getNewToken(userWithoutServices);
    return token;
  };
};

const authLogic = new AuthenticationLogic();
export default authLogic;