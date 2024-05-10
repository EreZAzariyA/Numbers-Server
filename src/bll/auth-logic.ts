import { CredentialRequest } from "google-auth-library";
import ClientError from "../models/client-error";
import CredentialsModel from "../models/credentials-model";
import { IUserModel, UserModel } from "../models/user-model";
import { comparePassword, encryptPassword } from "../utils/bcrypt-utils";
import jwt from "../utils/jwt";
import google from "../utils/google";
import { ErrorMessages, MAX_LOGIN_ATTEMPTS } from "../utils/helpers";

class AuthenticationLogic {
  private loginAttempts = 0;

  signup = async (user: IUserModel): Promise<string> => {
    const newEncryptedPassword: string = await encryptPassword(user.services.password);
    user.services.password = newEncryptedPassword;

    const errors = user.validateSync();
    if (errors) {
      throw new ClientError(500, errors.message);
    }

    const savedUser = await user.save();
    const token = jwt.getNewToken(savedUser.toObject());
    return token;
  };

  signin = async (credentials: CredentialsModel): Promise<string> => {
    const user = await UserModel.findOne({
      'emails.email': credentials.email
    }).exec();

    if (!user) {
      throw new ClientError(500, ErrorMessages.INCORRECT_PASSWORD);
    }

    if (user.loginAttempts.attempts >= MAX_LOGIN_ATTEMPTS) {
      throw new ClientError(500, ErrorMessages.MAX_LOGIN_ATTEMPTS);
    }

    const passwordMatch = await comparePassword(credentials.password, user.services.password);
    if (!passwordMatch) {
      user.loginAttempts = {
        attempts: user.loginAttempts.attempts + 1,
        lastAttemptDate: new Date().valueOf()
      };
      await user.save({ validateBeforeSave: true });
      throw new ClientError(500, ErrorMessages.INCORRECT_PASSWORD);
    }

    user.loginAttempts = {
      attempts: 0,
      lastAttemptDate: new Date().valueOf()
    };
    await user.save({ validateBeforeSave: true });

    const loggedUser = user.toObject();
    const { services, ...restOfUser } = loggedUser;
    const token = jwt.getNewToken(restOfUser);
    return token;
  };

  google = async (userDetailsByGoogle: CredentialRequest): Promise<string> => {
    const email = await google.getUserEmailFromGoogleToken(userDetailsByGoogle.access_token);
    const isSigned = await UserModel.exists({'emails.email': email}).exec();

    let user: IUserModel = null;
    if (isSigned) {
      user = await UserModel.findOne({'emails.email': email}).select('-services').exec();
    } else {
      const payload = await google.getGoogleDetails(userDetailsByGoogle.access_token);
      user = await google.createUserForGoogleAccounts(payload);
    }

    const token = jwt.getNewToken(user.toObject());
    return token;
  };
};

const authLogic = new AuthenticationLogic();
export default authLogic;