import { Document, Schema, model } from "mongoose";
import { EmailType, GoogleUserType } from "../utils/types";
import { Languages, ThemeColors } from "../utils/helpers";

const EmailSchema = new Schema<EmailType>({
  email: {
    type: String,
    required: [true, "Email is missing"],
    unique: true,
    trim: true,
  },
  isValidate: {
    type: Boolean,
    default: false,
  },
  isActive: {
    type: Boolean,
    default: true,
  }
}, { _id: false });

const GoogleUserSchema = new Schema<GoogleUserType>({
  sub: String,
  name: String,
  given_name: String,
  family_name: String,
  picture: String,
  email: {
    type: String,
    unique: true,
    sparse: true
  },
  email_verified: {
    type: Boolean,
  },
  locale: String
}, { _id: false, autoIndex: true });

export interface IUserModel extends Document {
  profile: {
    first_name: string;
    last_name: string;
    image_url?: string
  };
  services: {
    password: string,
    google: GoogleUserType
  };
  emails: [EmailType];
  config: {
    'theme-color': string,
    lang: string
  };
  loginAttempts: {
    lastAttemptDate: number,
    attempts: number
  };
  createdAt: Date;
  updatedAt: Date;
};

export const UserSchema = new Schema<IUserModel>({
  profile:{
    first_name: {
      type: String,
      trim: true,
      required: [true, "First name is missing"],
      minLength: [3, "First name is to short"],
      maxLength: [20, "First name is to long"],
    },
    last_name: {
      type: String,
      trim: true,
    },
    image_url: {
      type: String,
      trim: true,
    },
  },
  services:{
    password: {
      type: String,
      trim: true,
    },
    google: GoogleUserSchema
  },
  emails: [EmailSchema],
  config: {
    'theme-color': {
      type: String,
      default: ThemeColors.LIGHT
    },
    lang: {
      type: String,
      default: Languages.EN
    },
  },
  loginAttempts: {
    lastAttemptDate: Number,
    attempts: {
      type: Number,
      default: 0
    }
  }
}, {
  versionKey: false,
  autoIndex: true,
  timestamps: true,
});

export const UserModel = model('userModel', UserSchema, 'users');