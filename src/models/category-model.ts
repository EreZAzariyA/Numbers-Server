import { Document, Schema, model } from "mongoose";

export interface ICategoryModel extends Document {
  user_id: Schema.Types.ObjectId;
  name: string;
  expectedSpent: number;
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
  expectedSpent: {
    type: Number,
    trim: true,
    required: [true, "Expected spent amount is missing"],
    default: 0
  },
}, {
  versionKey: false,
  autoIndex: true,
});

export const CategoryModel = model<ICategoryModel>('CategoryModel', CategorySchema, 'categories');