const jwt = require("jsonwebtoken");
const db = require("../routes/db-config");
const bcryptjs = require("bcryptjs");

const login = async (req, res) => {
    const { email, password } = req.body
    if (!email || !password) return res.json({status: "error", error: "Podaj swój email i hasło"});
    else {
        db.query('Select email FROM users WHERE email = ?', [email], async (Err, result) => {
            if (Err) throw Err;
            if (!result[0] || !await bcrypt.compare(password, result[0].password)) return res.json({status: "error",
                error: "Niepoprawne hasło lub email"})
                else {
                    const token = jwt.sign({ id: result[0].id }, process.env.JWT_SECRET, {
                        expiresIn:process.env.JWT_EXPIRES,
                        httpOnly:true
                    })
                    const cookieOptions = {
                        expiresIn: new Date(Date.now() + process.env.COOKIE_EXPIRES * 24 * 60 * 1000),
                        httpOnly:true
                    }
                    res.cookie("userRegistered", token, cookieOptions);
                    return res.json({status: "success", success: "Użytkownik został zalogowany"})
                }
        })
    }
}
module.exports = login;