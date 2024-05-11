import { SupportedCompanies } from "./helpers";

export type ScraperCredentialsTypes = {
  [SupportedCompanies.discount]: {
    id: string;
    password: string;
    num: string;
  },
  [SupportedCompanies.behatsdaa]: {
    id: string,
    password: string
  },
};

export type NewScraperCredentialsTypes = {
  [SupportedCompanies.discount]: {
    name: 'Bank Discount',
    loginFields: ['id', 'password', 'num']
  }
  [SupportedCompanies.behatsdaa]: {
    name: 'Behatsdaa',
    loginFields: ['id', 'password']
  }
}

// const SCRAPERS = {
//   [CompanyTypes.hapoalim]: {
//     name: 'Bank Hapoalim',
//     loginFields: ['userCode', PASSWORD_FIELD]
//   },
//   [CompanyTypes.hapoalimBeOnline]: {
//     // TODO remove in Major version
//     name: 'Bank Hapoalim',
//     loginFields: ['userCode', PASSWORD_FIELD]
//   },
//   [CompanyTypes.leumi]: {
//     name: 'Bank Leumi',
//     loginFields: ['username', PASSWORD_FIELD]
//   },
//   [CompanyTypes.mizrahi]: {
//     name: 'Mizrahi Bank',
//     loginFields: ['username', PASSWORD_FIELD]
//   },
//   [CompanyTypes.discount]: {
//     name: 'Discount Bank',
//     loginFields: ['id', PASSWORD_FIELD, 'num']
//   },
//   [CompanyTypes.mercantile]: {
//     name: 'Mercantile Bank',
//     loginFields: ['id', PASSWORD_FIELD, 'num']
//   },
//   [CompanyTypes.otsarHahayal]: {
//     name: 'Bank Otsar Hahayal',
//     loginFields: ['username', PASSWORD_FIELD]
//   },
//   [CompanyTypes.leumiCard]: {
//     // TODO remove in Major version
//     name: 'Leumi Card',
//     loginFields: ['username', PASSWORD_FIELD]
//   },
//   [CompanyTypes.max]: {
//     name: 'Max',
//     loginFields: ['username', PASSWORD_FIELD]
//   },
//   [CompanyTypes.visaCal]: {
//     name: 'Visa Cal',
//     loginFields: ['username', PASSWORD_FIELD]
//   },
//   [CompanyTypes.isracard]: {
//     name: 'Isracard',
//     loginFields: ['id', 'card6Digits', PASSWORD_FIELD]
//   },
//   [CompanyTypes.amex]: {
//     name: 'Amex',
//     loginFields: ['id', 'card6Digits', PASSWORD_FIELD]
//   },
//   [CompanyTypes.union]: {
//     name: 'Union',
//     loginFields: ['username', PASSWORD_FIELD]
//   },
//   [CompanyTypes.beinleumi]: {
//     name: 'Beinleumi',
//     loginFields: ['username', PASSWORD_FIELD]
//   },
//   [CompanyTypes.massad]: {
//     name: 'Massad',
//     loginFields: ['username', PASSWORD_FIELD]
//   },
//   [CompanyTypes.yahav]: {
//     name: 'Bank Yahav',
//     loginFields: ['username', 'nationalID', PASSWORD_FIELD]
//   },
//   [CompanyTypes.beyahadBishvilha]: {
//     name: 'Beyahad Bishvilha',
//     loginFields: ['id', PASSWORD_FIELD]
//   },
//   [CompanyTypes.oneZero]: {
//     name: 'One Zero',
//     loginFields: ['email', PASSWORD_FIELD, 'otpCodeRetriever', 'phoneNumber', 'otpLongTermToken']
//   },

// };