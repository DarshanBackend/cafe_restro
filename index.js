import express from 'express';
import { config } from 'dotenv';
import cors from 'cors';
import log from './utils/logger.js';
import connectDB from './db/connectDB.js';
import indexRouter from './routes/index.route.js';
import morgan from 'morgan';

//.env 
config();
const PORT = process.env.PORT || 8000;
const DB_URL = process.env.DB_URL

const app = express();
connectDB(DB_URL);
//middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan("dev"))
app.use(cors());

//home route
app.get("/", async (req, res) => {
  return res.send("<h2>congratulations Cafe & Restro Api's Is Woring </h2>")
});

// Global Response Formatting Middleware
app.use((req, res, next) => {
  const originalJson = res.json;
  res.json = function (obj) {
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      if (obj.success !== undefined) {
        
        if (obj.message === undefined) {
          obj.message = obj.success ? "Success" : "Failed";
        }

        if (obj.data !== undefined && obj.result === undefined) {
          obj.result = obj.data;
          delete obj.data;
        }

        if (obj.result === undefined && obj.success) {
           obj.result = [];
        }

        if (obj.result !== undefined) {
          if (!Array.isArray(obj.result)) {
            obj.result = [obj.result];
          }
          obj.length = obj.result.length;
        }
      }
    }
    return originalJson.call(this, obj);
  };
  next();
});

app.use("/api", indexRouter);

app.listen(PORT, (err) => {
  if (err) {
    console.error("Error During Port Listen!!");
  }
  log.success(`Application Running Successfull On PORT : ${PORT}`);
});
