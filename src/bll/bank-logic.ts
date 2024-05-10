import { CompanyTypes, ScraperCredentials, ScraperOptions, createScraper } from "israeli-bank-scrapers";
import moment from "moment";
import { UserModel } from "../models/user-model";
import jwt from "../utils/jwt";
import { Transaction, TransactionStatuses } from "israeli-bank-scrapers/lib/transactions";
import { CategoryModel, ICategoryModel } from "../models/category-model";
import categoriesLogic from "./categories-logic";
import { InvoiceModel } from "../models/invoice-model";
import ClientError from "../models/client-error";
import { SupportedCompanies } from "../utils/helpers";

class BankLogic {
  private lastYear = moment().subtract('1', 'years').calendar();

  fetchBankData = async (details: any, user_id: string) => {
    const user = await UserModel.findById(user_id).exec();
    if (!user) {
      throw new ClientError(500, 'user not found');
    }

    if (!SupportedCompanies[details.companyId]) {
      throw new ClientError(500, `Company ${details.companyId} is not supported`);
    }

    const options: ScraperOptions = {
      companyId: CompanyTypes[details.companyId],
      startDate: new Date(this.lastYear),
      combineInstallments: false,
      showBrowser: false,
    };

    const credentials: ScraperCredentials = {
      id: details.id,
      password: details.password,
      num: details.num
    };

    const scraper = createScraper(options);
    const scrapeResult = await scraper.scrape(credentials);

    if (scrapeResult.success) {
      const account = scrapeResult.accounts[0];

      let query: any;
      const setOne = {
        'lastConnection': new Date().valueOf(),
        'details': {
          accountNumber: account.accountNumber,
          balance: account.balance
        },
      };
      const { exp, ...rest } = details;
      const setTwo = {
        'bankName': SupportedCompanies[details.companyId],
        'credentials': jwt.createNewToken(rest),
      };

      if (details.save) {
        query = {
          $push: {
            bank: {
              ...setOne,
              ...setTwo
            }
          }
        };
      }
      if (details.save === false) {
        query = { $unset: { ...setTwo } };
      }

      try {
        const user = await UserModel.findByIdAndUpdate(user_id, query, { new: true }).select('-services').exec();
        const userBank = user?.bank;
        return {
          userBank,
          account,
          newUserToken: jwt.createNewToken(user.toObject())
        };
      } catch (err: any) {
        throw new ClientError(500, err.message);
      }
    }
    else {
      throw new Error(scrapeResult.errorType);
    }
  };

  importTransactions = async (invoices: Transaction[], user_id: string) => {
    let defCategory: ICategoryModel = await CategoryModel.findOne({ user_id, name: 'Others' }).exec();
    if (!defCategory) {
      const category = new CategoryModel({name: 'Others', user_id});
      defCategory = await categoriesLogic.addNewCategory(category);
    }

    const invoicesToInsert = [];
    for (const trans of invoices) {
      const isExist = await InvoiceModel.findOne({ user_id, description: trans.description }).exec();
      if (!isExist) {
        let invoice = new InvoiceModel({
          date: trans.date,
          description: trans.description || '',
          amount: trans.originalAmount || trans.chargedAmount,
          status: trans.status || TransactionStatuses.Completed,
          user_id: user_id,
        });

        if (!trans.category) {
          invoice.category_id = defCategory._id;
        } else {
          invoice.category_id = trans.category;
        }
  
        invoicesToInsert.push(invoice);
      }
    }

    const inserted = await InvoiceModel.insertMany(invoicesToInsert);
    return inserted;
  };

  // connectBank = async () => {
  //   var request = require("request");

  //   var options = { method: 'POST',
  //     url: 'https://api.discountbank.co.il/prod/d/psd2/v1.0.6/consent/token',
  //     qs: { client_id: '0c0442a1-9ffd-440b-9168-656f42baac1f' },
  //     headers: 
  //      { accept: 'application/json',
  //        'content-type': 'application/x-www-form-urlencoded' },
  //     form: 
  //      { grant_type: 'client_credentials',
  //        client_id: '318364478',
  //        code: 'vomikuorumakawde',
  //        code_verifier: 'pacazoma' } };
    
  //   request(options, function (error, response, body) {
  //     if (error) return console.error('Failed: %s', error.message);
    
  //     console.log('Success: ', body);
  //   });
  // }
};

const bankLogic = new BankLogic();
export default bankLogic;