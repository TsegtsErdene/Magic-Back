// routes/auth.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sql = require('mssql');

const sqlConfig = require('../config/sqlConfig');

const JWT_SECRET = process.env.JWT_SECRET || "secret-key"; // .env-д байрлуул

// ✔️ Жижиг туслах функцууд
const normalize = (s) => (typeof s === 'string' ? s.trim() : s);

// ==========================
// БҮРТГЭЛ (REGISTER)
// ==========================
router.post('/register', async (req, res) => {
  try {
    let { username, password, email, companyName, companyId, projectName } = req.body;

    username = normalize(username);
    password = normalize(password);
    email = normalize(email);
    companyName = normalize(companyName);
    companyId = normalize(companyId);
    projectName = normalize(projectName);

    if (!username || !password || !companyName || !companyId || !projectName) {
      return res.status(400).json({ error: 'username, password, companyName, companyId, projectName are required' });
    }

    const hashed = await bcrypt.hash(password, 10);

    await sql.connect(sqlConfig);

    // ⚠️ Нэг компанид ижил username давхцахгүй байхыг шалгана
    const dup = await sql.query`
      SELECT TOP 1 id FROM Users WHERE companyId = ${companyId} AND username = ${username}
    `;
    if (dup.recordset.length) {
      return res.status(409).json({ error: 'This username already exists in the company.' });
    }

    await sql.query`
      INSERT INTO Users (username, password, email, companyName, companyId, projectName)
      VALUES (${username}, ${hashed}, ${email || null}, ${companyName}, ${companyId}, ${projectName})
    `;

    res.json({ message: "User registered" });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ==========================
// НЭВТРЭЛТ (LOGIN) — companyId шаардана
// ==========================
router.post('/login', async (req, res) => {
  try {
    let { username, password, companyId } = req.body;

    username = normalize(username);
    password = normalize(password);
    companyId = normalize(companyId);

    if (!username || !password || !companyId) {
      return res.status(400).json({ error: 'username, password, companyId are required' });
    }

    await sql.connect(sqlConfig);

    // ✅ Тухайн компанийн хүрээнд хэрэглэгчийг хайна
    const result = await sql.query`
      SELECT TOP 1 * FROM Users WHERE username = ${username} AND companyId = ${companyId}
    `;
    if (!result.recordset.length) {
      // Аль нэг буруу үед generic алдаа буцаана
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const user = result.recordset[0];
    console.log(user);

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });

    const token = jwt.sign(
      {
        userId: user.id,
        username: user.username,
        companyName: user.companyName,
        companyId: user.companyId, // ⬅️ JWT-д companyId багтана
        projectName: user.projectName
      },
      JWT_SECRET,
      { expiresIn: "2h" }
    );

    res.json({ token, user: { username: user.username, projectName: user.projectName, companyId: user.companyId } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==========================
// ХЭРЭГЛЭГЧ БАЙГАА ЭСЭХ (Optional helper)
// ==========================
router.post('/check', async (req, res) => {
  try {
    let { username, companyId, projectName } = req.body;
    username = normalize(username);
    companyId = normalize(companyId);
    projectName = normalize(projectName)

    if (!username || !companyId || !projectName) {
      return res.status(400).json({ error: 'username, companyId, projectName are required' });
    }

    await sql.connect(sqlConfig);
    const result = await sql.query`
      SELECT TOP 1 id FROM Users WHERE username=${username} AND companyId=${companyId} AND projectName=${projectName}
    `;
    if (!result.recordset.length) return res.json({ res: "User Not found" });

    return res.json({ res: "User found" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==========================
// JWT Middleware
// ==========================
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

// ==========================
// Хэрэглэгчийн мэдээлэл авах
// ==========================
router.get('/me', authMiddleware, async (req, res) => {
  try {
    await sql.connect(sqlConfig);
    const result = await sql.query`
      SELECT id, username, email, companyName, companyId, createdAt FROM Users WHERE id=${req.user.userId}
    `;
    res.json(result.recordset[0] || null);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
