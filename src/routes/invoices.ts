import express, { NextFunction, Request, Response } from "express";
import invoicesLogic from "../bll/invoices-logic";

const router = express.Router();

router.get("/:user_id", async (req: Request, res: Response, next: NextFunction) => {  
  try {
    const user_id = req.params.user_id;
    const invoices = await invoicesLogic.fetchInvoicesByUserId(user_id);
    res.status(201).json(invoices);
  } catch (err: any) {
    next(err);
  }
});

router.post("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const invoice = req.body;
    const addedInvoice = await invoicesLogic.newInvoice(invoice);
    res.status(201).json(addedInvoice);
  } catch (err: any) {
    next(err);
  }
});

router.put("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const invoiceToUpdate = req.body;
    const updatedInvoice = await invoicesLogic.updateInvoice(invoiceToUpdate);
    res.status(201).json(updatedInvoice);
  } catch (err: any) {
    next(err);
  }
});

router.delete("/:invoice_id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const invoice_id = req.params.invoice_id;
    await invoicesLogic.removeInvoice(invoice_id);
    res.sendStatus(200);
  } catch (err: any) {
    next(err);
  }
});

export default router;