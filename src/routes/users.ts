import express, { NextFunction, Request, Response } from "express";
import { usersLogic } from "../bll";
import aiSettingsLogic, { type AiProvider } from "../bll/ai-settings";

const router = express.Router();

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

router.get('/ai-settings/:user_id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user_id = req.params.user_id;
    const settings = await aiSettingsLogic.getSettings(user_id);
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

export default router;
