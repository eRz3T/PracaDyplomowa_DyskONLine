const express = require("express");
const db = require("./routes/db-config");
const app = express();
const cookie = require("cookie-parser");
const dotenv = require("dotenv").config();
const path = require('path');

const PORT = process.env.PORT || 3000; // Definicja PORTu

app.use("/js", express.static(path.join(__dirname, "public/js")));
app.use("/css", express.static(path.join(__dirname, "public/css")));
app.use(cookie());
app.use(express.json());

app.set("view engine", "ejs");
app.set("views", "./views");


db.connect((err) => {
    if (err) throw err;
    console.log("Połączono z bazą danych");
});


app.listen(PORT, () => {
    console.log(`Serwer działa na porcie ${PORT}`);
});
