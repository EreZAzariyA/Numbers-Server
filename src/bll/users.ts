import { Languages, ThemeColors } from "../models/theme-model";
import { IUserModel, UserModel } from "../models/user-model";

class UsersLogic {
  getUserById = async (user_id: string):Promise<IUserModel> => {
    return UserModel.findById(user_id).select('-services').exec();
  };

  changeTheme = async (user_id: string, theme: string) => {
    const res = await UserModel.findByIdAndUpdate(user_id, {
      $set: {
        'config.theme-color': theme
      }
    }, { new: true }).exec();
    const selectedTheme = res.config?.['theme-color'] || ThemeColors.LIGHT;
    return selectedTheme;
  };

  changeLang = async (user_id: string, lang: string): Promise<string> => {
    const res = await UserModel.findByIdAndUpdate(user_id, {
      $set: {
        'config.lang': lang
      }
    }, { new: true }).select('config.lang').exec();

    const selectedLang = res.config?.lang || Languages.EN;
    return selectedLang;
  };
};

const usersLogic = new UsersLogic;
export default usersLogic;