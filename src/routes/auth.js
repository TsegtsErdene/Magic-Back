const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sql = require('mssql');

// SQL config-г import хийнэ
const sqlConfig = require('../config/sqlConfig'); // Жишээ, өөрийн config файлаас

const JWT_SECRET = process.env.JWT_SECRET || "secret-key"; // .env дээр хадгал!

// --------------------------
// БҮРТГЭЛ
// --------------------------
router.post('/register', async (req, res) => {
  const { username, password, email, companyName, companyId } = req.body;
  if (!username || !password || !companyName || !companyId) {
    return res.status(400).json({ error: 'username, password, companyName, companyId are required' });
  }
  const hashed = await bcrypt.hash(password, 10);
  try {
    await sql.connect(sqlConfig);
    await sql.query`
      INSERT INTO Users (username, password, email, companyName, companyId)
      VALUES (${username}, ${hashed}, ${email || null}, ${companyName}, ${companyId})
    `;
    res.json({ message: "User registered" });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// --------------------------
// НЭВТРЭЛТ (LOGIN)
// --------------------------
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'username, password required' });
  try {
    await sql.connect(sqlConfig);
    const result = await sql.query`SELECT * FROM Users WHERE username=${username}`;
    if (!result.recordset.length) return res.status(401).json({ error: "Invalid credentials" });

    const user = result.recordset[0];
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });

    // JWT үүсгэнэ
    const token = jwt.sign(
      { userId: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: "2h" }
    );
    res.json({ token });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --------------------------
// JWT Middleware
// --------------------------
function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: "No token" });
  const token = auth.split(" ")[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

// --------------------------
// Хэрэглэгчийн мэдээлэл авах
// --------------------------
router.get('/me', authMiddleware, async (req, res) => {
  await sql.connect(sqlConfig);
  const result = await sql.query`
    SELECT id, username, email, companyName, companyId, createdAt FROM Users WHERE id=${req.user.userId}
  `;
  res.json(result.recordset[0]);
});

module.exports = router;
