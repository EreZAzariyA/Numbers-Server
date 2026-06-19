import { TokenPayload } from "google-auth-library";
import ClientError from "../models/client-error";
import { IUserModel, UserModel } from "../models/user-model";

const FIRST_NAME_MAX_LENGTH = 20;
const FALLBACK_FIRST_NAME = "User";

// Google's given_name can be empty or longer than our schema allows, so derive a
// first name that always satisfies the User schema constraints.
const resolveFirstName = (payload: TokenPayload): string => {
  const candidate =
    payload.given_name?.trim() ||
    payload.name?.trim() ||
    payload.email?.split("@")[0]?.trim() ||
    FALLBACK_FIRST_NAME;
  return candidate.slice(0, FIRST_NAME_MAX_LENGTH);
};

const createUserForGoogleAccounts = (payload: TokenPayload): Promise<IUserModel> => {
  const user = new UserModel({
    emails: {
      email: payload.email,
      isValidate: payload.email_verified
    },
    profile: {
      first_name: resolveFirstName(payload),
      last_name: (payload.family_name || '').slice(0, FIRST_NAME_MAX_LENGTH),
      image_url: payload.picture || ''
    },
    services: {
      google: { ...payload }
    }
  });

  const errors = user.validateSync();
  if (errors) {
    const firstError = Object.values(errors.errors)[0];
    throw new ClientError(400, firstError?.message ?? 'Invalid Google account details');
  }

  return user.save();
};

export default {
  createUserForGoogleAccounts
};
