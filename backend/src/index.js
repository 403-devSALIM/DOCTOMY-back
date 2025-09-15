
import express from "express" ; 
import "dotenv/config" ; 
import authRouter from "./routes/authRoutes.js"
import {connectdb} from "./lib/db.js"
import bookRoute from "./routes/bookroute.js"
import cors from "cors" ; 
import job from "./lib/cron.js";

job.start();



const app = express();
const PORT  = process.env.PORT

app.use(express.json());
app.use(cors());

app.use("/api/auth" , authRouter)

app.use("/api/book" , bookRoute)
app.listen(PORT , ()=>{
    console.log(`server is runnig on port ${PORT}`);
    connectdb();
})