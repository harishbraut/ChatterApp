import mongoose from "mongoose";

export async function connectToDatabase() {
  const mongoUri =
    process.env.MONGODB_URI ||
    `mongodb://${process.env.MONGODB || "127.0.0.1:27017"}/chatterApp`;
  try {
    await mongoose.connect(mongoUri);
    console.log("MongoDB connected using mongoose");
  } catch (err) {
    console.log(err);
  }
}
