export type GoogleUserType = {
  sub: string;
  name: string;
  given_name: string;
  family_name: string;
  picture: string;
  email: string;
  email_verified: boolean;
  locale: string;
};

export type EmailType = {
  email: string,
  isValidate: boolean,
  isActive: boolean
};