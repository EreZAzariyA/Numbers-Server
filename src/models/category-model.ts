import { Document, Schema, model } from "mongoose";

export interface ICategoryModel extends Document {
  // _id: Schema.Types.ObjectId;
  user_id: String;
  name: String;
};

const CategorySchema = new Schema<ICategoryModel>({
  // _id: Schema.Types.ObjectId,
  user_id: Schema.Types.ObjectId,
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