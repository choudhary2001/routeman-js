const mongoose = require('mongoose');

const { Schema } = mongoose;

const ProductSchema = new Schema(
  {
    name: { type: String, required: [true, 'Product name is required'] },
    description: String,
    price: { type: Number, required: true, min: 0 },
    category: {
      type: String,
      enum: ['electronics', 'books', 'clothing', 'home'],
      required: true,
    },
    stock: { type: Number, default: 0 },
    tags: [String],
    isActive: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = mongoose.models.Product || mongoose.model('Product', ProductSchema);
