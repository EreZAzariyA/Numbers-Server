import ClientError from "../models/client-error";
import { IInvoiceModel, InvoiceModel } from "../models/invoice-model";

class InvoicesLogic {
  fetchInvoicesByUserId = async (user_id: string): Promise<IInvoiceModel[]> => {
    return InvoiceModel.find({user_id: user_id}).exec();
  };

  newInvoice = async (invoice: IInvoiceModel):Promise<IInvoiceModel> => {
    if (!invoice.user_id) {
      throw new ClientError(500, 'User id is missing');
    }
    const newInvoice = new InvoiceModel({
      user_id: invoice.user_id,
      date: invoice.date,
      category_id: invoice.category_id,
      description: invoice.description,
      amount: invoice.amount
    });
    const errors = newInvoice.validateSync();
    if (errors) {
      throw new ClientError(500, errors.message);
    }
    return newInvoice.save();
  };

  updateInvoice = async (invoice: IInvoiceModel): Promise<IInvoiceModel> => {
    const updatedInvoice = await InvoiceModel.findByIdAndUpdate(invoice._id, {
      $set: {
        date: invoice.date,
        category_id: invoice.category_id,
        description: invoice.description,
        amount: invoice.amount
      }
    }, { new: true }).exec();

    const errors = updatedInvoice.validateSync();
    if (errors) {
      console.log(errors);
      
      throw new ClientError(500, errors.message);
    }

    return updatedInvoice.save();
  };

  removeInvoice = async (invoiceId: string): Promise<void> => {
    await InvoiceModel.findByIdAndDelete(invoiceId).exec();
    return;
  };
};

const invoicesLogic = new InvoicesLogic();
export default invoicesLogic;