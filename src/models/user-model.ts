import { Document, Schema, model } from "mongoose";
import { Languages, ThemeColors, ThemeType } from "./theme-model";

export interface IUserModel extends Document {
  profile: {
    first_name: string;
    last_name: string;
    image?: string
  };
  services: {
    password: string,
    google?: any
  };
  emails: [{
    email: string,
    isValidate: boolean,
    isActive: boolean
  }];
  config?: {
    'theme-color': ThemeType,
    lang: string
  };
  bank?: [{
    bankName: string
    credentials: string,
    details: object,
    lastConnection: number
  }];
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
      required: [true, "Last name is missing"],
      minLength: [3, "Last name is to short"],
      maxLength: [20, "Last name is to long"],
    },
    image: {
      type: String,
      trim: true,
    },
  },
  services:{
    password: {
      type: String,
      trim: true,
    },
    google: Object
  },
  emails: [{
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
    },
    _id: false
  }],
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
  bank: [{
    bankName: {
      type: String,
      required: [true, "Bank is missing"],
    },
    credentials: {
      type: String,
      required: [true, "Credentials is missing"],
    },
    details: {
      type: Object
    },
    lastConnection: Number
  }]
}, {
  versionKey: false,
  autoIndex: true,
  timestamps: true,
});

export const UserModel = model('userModel', UserSchema, 'users');