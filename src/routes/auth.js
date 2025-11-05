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

// Нууц үгийн энгийн бодлого (шаардвал чангалаарай)
function validatePassword(pw = "") {
  // Мин 8 тэмдэгт, том/жижиг үсэг, тоо, тусгай тэмдэгтээс дор хаяж 3-ыг агуулна
  const rules = [
    /[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/
  ];
  const passed = rules.reduce((acc, r) => acc + (r.test(pw) ? 1 : 0), 0);
  return typeof pw === 'string' && pw.length >= 8 && passed >= 3;
}


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
// LOGIN
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

    const result = await sql.query`
      SELECT TOP 1 * FROM Users WHERE username = ${username} AND companyId = ${companyId}
    `;
    if (!result.recordset.length) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const user = result.recordset[0];
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });

    // ✅ Хэрэв анхны нэвтрэлт буюу солиулах шаардлагатай бол
    if (user.mustChangePassword) {
      // Зөвхөн "нууц үг солих" ажиллагаанд зориулагдсан богино хугацаатай token
      const changeToken = jwt.sign(
        {
          userId: user.id,
          username: user.username,
          companyId: user.companyId,
          scope: 'password_change_only'
        },
        JWT_SECRET,
        { expiresIn: '15m' }
      );

      // Front-end энэ үед /password/change рүү чиглүүлнэ
      return res.status(200).json({
        requiresPasswordChange: true,
        changeToken,
        user: { username: user.username, companyId: user.companyId, projectName: user.projectName }
      });
    }

    // Энгийн тохиолдолд бүрэн эрхтэй token
    const token = jwt.sign(
      {
        userId: user.id,
        username: user.username,
        companyName: user.companyName,
        companyId: user.companyId,
        projectName: user.projectName
      },
      JWT_SECRET,
      { expiresIn: "2h" }
    );

    res.json({
      token,
      user: { username: user.username, projectName: user.projectName, companyId: user.companyId }
    });
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
router.post('/admin/reset-password', async (req, res) => {
  try {
    // Authentication: either admin JWT with payload.isAdmin === true
    // or a static admin key in header x-admin-key
    const adminKeyHeader = req.headers['x-admin-key'];
    const adminKeyOk = adminKeyHeader && process.env.ADMIN_API_KEY && adminKeyHeader === process.env.ADMIN_API_KEY;

    // try JWT auth if provided
    let isAdmin = false;
    const auth = req.headers.authorization;
    if (auth) {
      const token = auth.split(' ')[1];
      try {
        const payload = jwt.verify(token, JWT_SECRET);
        if (payload && payload.isAdmin) isAdmin = true;
      } catch (e) {
        // invalid token — ignore, will fallback to admin key
      }
    }

    if (!isAdmin && !adminKeyOk) {
      return res.status(403).json({ error: 'Admin credentials required' });
    }

    const { userId, username, companyId, tempPassword } = req.body;

    if (!tempPassword || typeof tempPassword !== 'string') {
      return res.status(400).json({ error: 'tempPassword (string) is required' });
    }

    await sql.connect(sqlConfig);

    let userQuery;
    if (userId) {
      userQuery = await sql.query`SELECT TOP 1 id, username, companyId, email FROM Users WHERE id = ${userId}`;
    } else if (username && companyId) {
      userQuery = await sql.query`SELECT TOP 1 id, username, companyId, email FROM Users WHERE username = ${username} AND companyId = ${companyId}`;
    } else {
      return res.status(400).json({ error: 'Provide userId OR (username and companyId)' });
    }

    if (!userQuery.recordset.length) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userQuery.recordset[0];

    // Hash the temp password
    const hashed = await bcrypt.hash(tempPassword, 10);

    // Update password, set mustChangePassword=1 so user must change on next login
    await sql.query`
      UPDATE Users
      SET password = ${hashed},
          mustChangePassword = 1,
          passwordChangedAt = NULL
      WHERE id = ${user.id}
    `;

    // Optional: log the admin reset (you may want an audit table; here we just reply)
    return res.json({ message: 'Temporary password set. Inform the user to login and change their password.' });
  } catch (e) {
    console.error('admin reset error', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

// Нууц үг солих — зөвхөн changeToken (scope=password_change_only) ашиглана
router.post('/password/change', async (req, res) => {
  try {
    const auth = req.headers.authorization;
    if (!auth) return res.status(401).json({ error: "No token" });
    const token = auth.split(" ")[1];

    let payload;
    try {
      payload = jwt.verify(token, JWT_SECRET);
    } catch {
      return res.status(401).json({ error: "Invalid or expired token" });
    }

    if (payload.scope !== 'password_change_only') {
      return res.status(403).json({ error: "Token scope not allowed for password change" });
    }

    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "currentPassword and newPassword are required" });
    }
    if (!validatePassword(newPassword)) {
      return res.status(400).json({ error: "Weak password. Use at least 8 chars and mix of cases/numbers/symbols." });
    }

    await sql.connect(sqlConfig);

    const q = await sql.query`
      SELECT TOP 1 id, password, mustChangePassword FROM Users WHERE id=${payload.userId} AND companyId=${payload.companyId}
    `;
    if (!q.recordset.length) return res.status(404).json({ error: "User not found" });

    const user = q.recordset[0];

    // Одоогийн нууц үг таарч буй эсэхийг шалгах
    const ok = await bcrypt.compare(currentPassword, user.password);
    if (!ok) return res.status(401).json({ error: "Current password is incorrect" });

    // Хэрэв аль хэдийн солиод mustChangePassword=0 болсон бол давхар хамгаалалт
    if (user.mustChangePassword === false || user.mustChangePassword === 0) {
      return res.status(409).json({ error: "Password already changed" });
    }

    const hashed = await bcrypt.hash(newPassword, 10);

    await sql.query`
      UPDATE Users
      SET password = ${hashed},
          mustChangePassword = 0,
          passwordChangedAt = SYSUTCDATETIME()
      WHERE id = ${payload.userId}
    `;

    // ✅ Дараагийн алхам: энгийн нэвтрэлт хийх (шинэ нууцтайгаа /login руу)
    return res.json({ message: "Password changed. Please login again." });
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
      SELECT id, username, email, companyName, companyId, createdAt, mustChangePassword
      FROM Users WHERE id=${req.user.userId}
    `;
    res.json(result.recordset[0] || null);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
module.exports = router;
