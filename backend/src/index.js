
import express from "express" ; 
import "dotenv/config" ; 
import authRouter from "./routes/authRoutes.js"
import prisma from "./lib/prisma.js"

import userRoutes from "./routes/userRoutes.js"
import uploadRoutes from "./routes/uploadRoutes.js"
import cors from "cors" ; 
import job from "./lib/cron.js";

job.start();



const app = express();
const PORT  = process.env.PORT

app.use(express.json());
app.use(cors());

app.use("/api/auth" , authRouter)
app.use("/api/users", userRoutes)
app.use("/api/upload", uploadRoutes)

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Global error handler:", err.message);
  res.status(err.status || 500).json({
    message: err.message || "Internal Server Error",
    error: err.name || "Error"
  });
});

app.listen(PORT , ()=>{
    console.log(`server is runnig on port ${PORT}`);
    // Prisma connects automatically on first query
})