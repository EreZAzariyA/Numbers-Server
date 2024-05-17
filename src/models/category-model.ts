import { Document, Schema, model } from "mongoose";

export interface ICategoryModel extends Document {
  user_id: Schema.Types.ObjectId;
  name: String;
};

const CategorySchema = new Schema<ICategoryModel>({
  user_id: {
    type: Schema.Types.ObjectId,
    index: true
  },
  name: {
    type: String,
    trim: true,
    required: [true, "Category name is missing"],
  },
}, {
  versionKey: false,
  autoIndex: true,
});

export const CategoryModel = model<ICategoryModel>('CategoryModel', CategorySchema, 'categories');