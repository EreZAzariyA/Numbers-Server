import express, { NextFunction, Request, Response } from "express";
import jwt from "../utils/jwt";
import agentChatLogic from "../bll/agent-chat";

const router = express.Router();

// Send a single message — backend owns the full history
router.post("/chat", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = jwt.getUserFromToken(req);
    const { message, language = 'en', requestId } = req.body;
    const response = await agentChatLogic.chat(String(user._id), message, language, requestId);
    res.status(200).json(response);
  } catch (err: any) {
    next(err);
  }
});

// Load persisted chat history for the current user
router.get("/history", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = jwt.getUserFromToken(req);
    const history = await agentChatLogic.loadHistory(String(user._id));
    res.status(200).json(history);
  } catch (err: any) {
    next(err);
  }
});

// Clear the user's chat history
router.delete("/history", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = jwt.getUserFromToken(req);
    await agentChatLogic.clearHistory(String(user._id));
    res.status(200).json({ ok: true });
  } catch (err: any) {
    next(err);
  }
});

router.post("/actions/:actionId/confirm", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = jwt.getUserFromToken(req);
    const { actionId } = req.params;
    const { language = 'en' } = req.body ?? {};
    const response = await agentChatLogic.confirmPendingAction(String(user._id), actionId, language);
    res.status(200).json(response);
  } catch (err: any) {
    next(err);
  }
});

router.post("/actions/:actionId/cancel", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = jwt.getUserFromToken(req);
    const { actionId } = req.params;
    const { language = 'en' } = req.body ?? {};
    const response = await agentChatLogic.cancelPendingAction(String(user._id), actionId, language);
    res.status(200).json(response);
  } catch (err: any) {
    next(err);
  }
});

export default router;
