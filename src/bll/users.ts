import { IUserModel, UserModel } from "../models/user-model";

class UsersLogic {

  getUserById = async (user_id: string):Promise<IUserModel> => {
    return UserModel.findById(user_id).select('-services').exec();
  };

  changeTheme = async (user_id: string, theme: string) => {
    await UserModel.findByIdAndUpdate(user_id, {
      $set: {
        'config.theme-color': theme
      }
    }).exec();
  };

  changeLang = async (user_id: string, lang: string) => {
    await UserModel.findByIdAndUpdate(user_id, {
      $set: {
        'config.lang': lang
      }
    }).exec();
  };
};

const usersLogic = new UsersLogic;
export default usersLogic;