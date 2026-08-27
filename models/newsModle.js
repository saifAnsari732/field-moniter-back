const mongoose = require("mongoose");

const NewsSchema = new mongoose.Schema(
 {
  newsTitle: String,
  content: String,
  category: String,
  reporterName: String,
  state: String,
  city: String,
  tags: String,
  featuredImage: String,
  sourceLink: String,
  keywords: String,

  published: {
    type: Boolean,
    default: false
  },

  date: {
    type: Date,
    default: Date.now
  }
}
);

module.exports = mongoose.model("News", NewsSchema);