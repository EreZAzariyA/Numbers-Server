import { Document, model, Schema } from "mongoose";

export interface ICategoryModel extends Document {
  name: string;
  amount: number;
};

export const CategorySchema = new Schema<ICategoryModel>({
  name: {
    type: String,
    trim: true,
    required: [true, "Category name is missing"],
  },
  amount: {
    type: Number,
    trim: true,
    required: [true, "Expected spent amount is missing"],
    default: 0
  },
}, {
  versionKey: false,
});

export const CategoryModel = model<ICategoryModel>('Category', CategorySchema);