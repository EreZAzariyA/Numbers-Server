import { Document, Schema, model } from "mongoose";
import { Languages, ThemeColors, ThemeType } from "./theme-model";

class Details {
  accountNumber: string;
  balance: number;
};

export interface BalanceHistoryModel {
  balance: number;
  date: number;
};

export class BankDetails {
  _id: string;
  bankName: string;
  credentials: string;
  details: Details;
  lastConnection: number;
  balanceHistory?: BalanceHistoryModel[];
};

export interface IUserModel extends Document {
  profile: {
    first_name: string;
    last_name: string;
    image_url?: string
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
  bank?: BankDetails[];
  loginAttempts?: {
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
      required: [true, "Last name is missing"],
      minLength: [3, "Last name is to short"],
      maxLength: [20, "Last name is to long"],
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
    bankName: String,
    credentials: String,
    details: {
      accountNumber: {
        type: String,
        unique: true
      },
      balance: Number
    },
    lastConnection: Number,
    balanceHistory: [{
      balance: Number,
      date: Number,
    }]
  }],
  loginAttempts: {
    lastAttemptDate: Number,
    attempts: Number
  }
}, {
  versionKey: false,
  autoIndex: true,
  timestamps: true,
});

export const UserModel = model('userModel', UserSchema, 'users');