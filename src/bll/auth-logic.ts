import { CredentialRequest } from "google-auth-library";
import ClientError from "../models/client-error";
import CredentialsModel from "../models/credentials-model";
import { IUserModel, UserModel } from "../models/user-model";
import { comparePassword, encryptPassword } from "../utils/bcrypt-utils";
import jwt from "../utils/jwt";
import google from "../utils/google";

class AuthenticationLogic {
  signup = async (user: IUserModel): Promise<string> => {
    const newEncryptedPassword: String = await encryptPassword(user.services.password);
    const userToSave = new UserModel({
      ...user,
      services: {
        password: newEncryptedPassword
      }
    });

    const errors = userToSave.validateSync();
    if (errors) {
      throw new ClientError(500, errors.message);
    }
    const savedUser = await userToSave.save();
    const token = jwt.getNewToken(savedUser.toObject());
    return token;
  };

  signin = async (credentials: CredentialsModel): Promise<string> => {
    const user: IUserModel = await UserModel.findOne({
      'emails.email': credentials.email
    }).exec();

    if (!user) throw new ClientError(500, "Email or password are incorrect");
    if (user) {
      const passwordMatch = await comparePassword(credentials.password, user.services.password);
      if (passwordMatch) {
        const loggedUser = user.toObject();
        const { services, ...restOfUser } = loggedUser;
        const token = jwt.getNewToken(restOfUser);
        return token;
      } else {
        throw new ClientError(500, "Email or password are incorrect");
      }
    }
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