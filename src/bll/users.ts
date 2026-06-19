import { IUserModel, UserModel } from "../models/user-model";
import { Languages, ThemeColors } from "../utils/helpers";
import cacheService from "../utils/cache-service";
import { ClientError } from "../models";

class UsersLogic {
  fetchUserProfile = async (user_id: string):Promise<IUserModel> => {
    return UserModel.findById(user_id).select('-services').exec();
  };

  changeTheme = async (user_id: string, theme: string) => {
    const res = await UserModel.findByIdAndUpdate(user_id, {
      $set: {
        'config.theme-color': theme
      }
    }, { new: true }).exec();
    const selectedTheme = res.config?.['theme-color'] || ThemeColors.LIGHT;
    await cacheService.del(`user-profile:${user_id}`);
    return selectedTheme;
  };

  changeLang = async (user_id: string, lang: string): Promise<string> => {
    const res = await UserModel.findByIdAndUpdate(user_id, {
      $set: {
        'config.lang': lang
      }
    }, { new: true }).select('config.lang').exec();

    const selectedLang = res.config?.lang || Languages.EN;
    await cacheService.del(`user-profile:${user_id}`);
    return selectedLang;
  };

  changePayDay = async (user_id: string, payDay: number): Promise<number> => {
    const clamped = Math.min(Math.max(1, Math.floor(payDay)), 28);
    const res = await UserModel.findByIdAndUpdate(user_id, {
      $set: { 'config.payDay': clamped }
    }, { new: true }).select('config.payDay').exec();
    if (!res) throw new ClientError(404, 'User not found.');
    await cacheService.del(`user-profile:${user_id}`);
    return res.config.payDay ?? clamped;
  };
};

const usersLogic = new UsersLogic;
export default usersLogic;