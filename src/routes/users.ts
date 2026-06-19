import express, { NextFunction, Request, Response } from "express";
import { usersLogic } from "../bll";
import aiSettingsLogic, { type AiProvider } from "../bll/ai-settings";
import { ClientError } from "../models";
import { requireMatchingUserParam } from "../middlewares/require-user";

const router = express.Router();
router.param('user_id', requireMatchingUserParam);

router.get('/:user_id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user_id = req.params.user_id;
    const user = await usersLogic.fetchUserProfile(user_id);
    res.status(200).json(user);
  } catch (err: any) {
    next(err);
  }
});

router.put('/config/theme/:user_id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user_id = req.params.user_id;
    const theme = req.body.theme;
    const selectedTheme = await usersLogic.changeTheme(user_id, theme);
    res.status(200).json(selectedTheme);
  } catch (err: any) {
    next(err);
  }
});

router.put('/config/language/:user_id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user_id = req.params.user_id;
    const language = req.body.language;
    const selectedLang = await usersLogic.changeLang(user_id, language);
    res.status(200).json(selectedLang);
  } catch (err: any) {
    next(err);
  }
});

router.put('/config/pay-day/:user_id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user_id = req.params.user_id;
    const payDay = Number(req.body.payDay);
    if (!Number.isInteger(payDay) || payDay < 1 || payDay > 28) {
      throw new ClientError(400, 'payDay must be an integer between 1 and 28.');
    }
    const result = await usersLogic.changePayDay(user_id, payDay);
    res.status(200).json({ payDay: result });
  } catch (err: any) {
    next(err);
  }
});

router.get('/ai-settings/:user_id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user_id = req.params.user_id;
    const settings = await aiSettingsLogic.getSettings(user_id);
    res.status(200).json(settings);
  } catch (err: any) {
    next(err);
  }
});

router.get('/ai-settings/:user_id/health', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user_id = req.params.user_id;
    const health = await aiSettingsLogic.getProviderHealth(user_id);
    res.status(200).json(health);
  } catch (err: any) {
    next(err);
  }
});

router.get('/ai-settings/:user_id/ollama-models', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const models = await aiSettingsLogic.listOllamaModels();
    res.status(200).json({ models });
  } catch (err: any) {
    next(err);
  }
});

router.put('/ai-settings/:user_id/ollama-model', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user_id = req.params.user_id;
    const model = req.body.model as string;
    const settings = await aiSettingsLogic.updateOllamaModel(user_id, model);
    res.status(200).json(settings);
  } catch (err: any) {
    next(err);
  }
});

router.put('/ai-settings/:user_id/ollama-thinking', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user_id = req.params.user_id;
    const enabled = req.body.enabled === true;
    const settings = await aiSettingsLogic.updateOllamaThinking(user_id, enabled);
    res.status(200).json(settings);
  } catch (err: any) {
    next(err);
  }
});

router.put('/ai-settings/:user_id/provider', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user_id = req.params.user_id;
    const provider = req.body.provider as AiProvider;
    const settings = await aiSettingsLogic.updateProvider(user_id, provider);
    res.status(200).json(settings);
  } catch (err: any) {
    next(err);
  }
});

router.put('/ai-settings/:user_id/keys', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user_id = req.params.user_id;
    const provider = req.body.provider as 'gemini' | 'claude';
    const apiKey = req.body.apiKey as string;
    const settings = await aiSettingsLogic.upsertProviderKey(user_id, provider, apiKey);
    res.status(200).json(settings);
  } catch (err: any) {
    next(err);
  }
});

router.delete('/ai-settings/:user_id/keys/:provider', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user_id = req.params.user_id;
    const provider = req.params.provider as 'gemini' | 'claude';
    const settings = await aiSettingsLogic.removeProviderKey(user_id, provider);
    res.status(200).json(settings);
  } catch (err: any) {
    next(err);
  }
});

router.get('/ai-settings/:user_id/gemini-models', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user_id = req.params.user_id;
    const models = await aiSettingsLogic.listGeminiModels(user_id);
    res.status(200).json({ models });
  } catch (err: any) {
    next(err);
  }
});

router.get('/ai-settings/:user_id/claude-models', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user_id = req.params.user_id;
    const models = await aiSettingsLogic.listClaudeModels(user_id);
    res.status(200).json({ models });
  } catch (err: any) {
    next(err);
  }
});

router.put('/ai-settings/:user_id/model', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user_id = req.params.user_id;
    const provider = req.body.provider as 'gemini' | 'claude';
    const model = req.body.model as string;
    const settings = await aiSettingsLogic.updateProviderModel(user_id, provider, model);
    res.status(200).json(settings);
  } catch (err: any) {
    next(err);
  }
});

export default router;
