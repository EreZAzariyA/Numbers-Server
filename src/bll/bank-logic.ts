import { CompanyTypes, ScraperCredentials, ScraperOptions, createScraper } from "israeli-bank-scrapers";
import moment from "moment";
import { UserModel } from "../models/user-model";
import jwt from "../utils/jwt";
import { Transaction } from "israeli-bank-scrapers/lib/transactions";
import { CategoryModel, ICategoryModel } from "../models/category-model";
import categoriesLogic from "./categories-logic";
import { InvoiceModel } from "../models/invoice-model";

class BankLogic {
  private lastMonth = moment().subtract('1', 'months').calendar();

  fetchBankData = async (details: any, user_id: string) => {
    const options: ScraperOptions = {
      companyId: CompanyTypes[details.companyId],
      startDate: new Date(this.lastMonth),
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
      let setOne: any = {
        'bank.lastConnection': new Date().valueOf(),
        'bank.details': {accountNumber: account.accountNumber, balance: account.balance},
      };
      let setTwo: any = {
        'bank.bankName': details.companyId,
        'bank.credentials': jwt.createNewToken(details),
      };
      if (details.save) {
        query = {
          '$set': {
            ...setOne,
            ...setTwo
          }
        };
      }
      if (!details.save) {
        query = { $unset: { ...setTwo } };
      }
  
      const user = await UserModel.findByIdAndUpdate(user_id, {...query}, { new: true }).exec();
      const userBank = user.bank;
      return {
        userBank,
        account
      };
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
};

const bankLogic = new BankLogic();
export default bankLogic;