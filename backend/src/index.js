
import express from "express" ; 
import "dotenv/config" ; 
import authRouter from "./routes/authRoutes.js"
import {connectdb} from "./lib/db.js"
const app = express();
const PORT  = process.env.PORT

app.use(express.json());


app.use("/api/auth" , authRouter)
app.listen(PORT , ()=>{
    console.log(`server is runnig on port ${PORT}`);
    connectdb();
})