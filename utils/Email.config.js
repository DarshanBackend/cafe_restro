import nodemailer from 'nodemailer'
import { config } from 'dotenv'; config();
import hbs from "nodemailer-express-handlebars";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER || "hit.kalathiyainfotech@gmail.com",
    pass: process.env.EMAIL_PASS || "hpxi bdfr epnd pata",
  },
});

transporter.use(
  "compile",
  hbs({
    viewEngine: {
      extname: ".hbs",
      layoutsDir: path.join(__dirname, "../emailTemplates"),
      defaultLayout: false,
    },
    viewPath: path.join(__dirname, "../emailTemplates"),
    extName: ".hbs",
  })
);

export default transporter;
