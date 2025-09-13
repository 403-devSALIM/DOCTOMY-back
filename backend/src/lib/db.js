import mongoose from "mongoose";

export const connectdb = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI);
    console.log(`Database connected successfuly: ${conn.connection.host}`);
  } catch (error) {
    console.error("Error connecting to DB:", error.message);
    process.exit(1); // Exit process with failure
  }
};
