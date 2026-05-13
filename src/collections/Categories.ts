import { Document, model, Schema } from "mongoose";
import { CategorySchema, ICategoryModel } from "../models/category-model";

export interface ICategories extends Document {
  user_id: Schema.Types.ObjectId;
  categories: ICategoryModel[];
};

const CategoriesSchema = new Schema<ICategories>({
  user_id: {
    type: Schema.Types.ObjectId,
    required: [true, 'User id is missing'],
    unique: true,
  },
  categories: {
    type: [CategorySchema],
    default: [],
  }
}, {
  versionKey: false,
  autoIndex: true,
  timestamps: true
});

export const Categories = model<ICategories>('Categories', CategoriesSchema, 'categories');
