import { TokenPayload } from "google-auth-library";
import ClientError from "../models/client-error";
import { IUserModel, UserModel } from "../models/user-model";
import { googleClient } from "../dal/google";

const getUserEmailFromGoogleToken = async (token: string): Promise<string> => {
  const google = googleClient;
  const userinfo = await google.getTokenInfo(token);
  return userinfo.email;
};

const getGoogleDetails = async (token: string): Promise<TokenPayload> => {
  if (!token) {
    throw new Error('Access token not found');
  }
  const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  if (!response.ok) {
    throw new ClientError(response.status,'Failed to fetch user details');
  }
  const userDetails = await response.json();
  return userDetails;
};

const createUserForGoogleAccounts = (payload: TokenPayload): Promise<IUserModel> => {
  const user = new UserModel({
    emails: {
      email: payload.email,
      isValidate: payload.email_verified
    },
    profile: {
      first_name: payload.given_name,
      last_name: payload.family_name,
      image_url: payload.picture
    },
    services: {
      google: { ...payload }
    }
  });

  const errors = user.validateSync();
  if (errors) {
    throw new ClientError(500, errors.message);
  };

  return user.save();
};

export default {
  getUserEmailFromGoogleToken,
  getGoogleDetails,
  createUserForGoogleAccounts
};