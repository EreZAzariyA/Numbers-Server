import { Document, Schema, model } from "mongoose";
import { Languages, ThemeColors, ThemeType } from "./theme-model";
import { AccountInfoType, CardsPastOrFutureDebitType, PastOrFutureDebitType } from "israeli-bank-scrapers-by-e.a/lib/transactions";

class Details {
  accountNumber: string;
  balance: number;
};

export class BankDetails {
  _id: string;
  bankName: string;
  credentials: string;
  details: Details;
  lastConnection: number;
  extraInfo?: AccountInfoType;
  pastOrFutureDebits?: PastOrFutureDebitType[];
  cardsPastOrFutureDebit: CardsPastOrFutureDebitType;
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
  bank?: [BankDetails];
  loginAttempts?: {
    lastAttemptDate: number,
    attempts: number
  };
  createdAt: Date;
  updatedAt: Date;
};

const EmailSchema = new Schema({
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
  bank: [{
    bankName: String,
    credentials: String,
    details: {
      accountNumber: {
        type: String,
        unique: true,
        sparse: true
      },
      balance: Number
    },
    lastConnection: Number,
    extraInfo: Object,
    pastOrFutureDebits: [{
      debitMonth: String,
      monthlyNumberOfTransactions: Number,
      monthlyNISDebitSum: Number,
      monthlyUSDDebitSum: Number,
      monthlyEURDebitSum: Number,
    }],
    cardsPastOrFutureDebit: Object,
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