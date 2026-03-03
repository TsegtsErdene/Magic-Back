// routes/auth.js
const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const sql = require("mssql");

const sqlConfig = require("../config/sqlConfig");

const JWT_SECRET = process.env.JWT_SECRET || "secret-key"; // .env-д байрлуул

// ✔️ Жижиг туслах функцууд
const normalize = (s) => (typeof s === "string" ? s.trim() : s);

// Нууц үгийн энгийн бодлого (шаардвал чангалаарай)
function validatePassword(pw = "") {
  // Мин 8 тэмдэгт, том/жижиг үсэг, тоо, тусгай тэмдэгтээс дор хаяж 3-ыг агуулна
  const rules = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/];
  const passed = rules.reduce((acc, r) => acc + (r.test(pw) ? 1 : 0), 0);
  return typeof pw === "string" && pw.length >= 8 && passed >= 3;
}

// ==========================
// БҮРТГЭЛ (REGISTER)
// ==========================
router.post("/register", async (req, res) => {
  try {
    let {
      userNameEN,
      userPassword,
      userEmail,
      companyGUID,
      userGUID,
      activeStatus,
      companyId,
    } = req.body;

    userNameEN = normalize(userNameEN);
    userPassword = normalize(userPassword);
    userEmail = normalize(userEmail);
    companyId = normalize(companyId);
    companyGUID = normalize(companyGUID);
    userGUID = normalize(userGUID);
    activeStatus = normalize(activeStatus);

    if (
      !userNameEN ||
      !userPassword ||
      !companyGUID ||
      !userGUID ||
      !activeStatus
    ) {
      return res.status(400).json({
        error:
          "userNameEN, userPassword, companyGUID, userGUID, activeStatus are required",
      });
    }

    const hashed = await bcrypt.hash(userPassword, 10);
    await sql.connect(sqlConfig);

    // ⚠️ Нэг компанид ижил username давхцахгүй байхыг шалгана
    const dup = await sql.query`
      SELECT TOP 1 id FROM Users WHERE userEmail=${userEmail} AND companyGUID=${companyGUID}`;
    if (dup.recordset.length) {
      return res
        .status(409)
        .json({ error: "This username already exists in the company." });
    }

    await sql.query`
      INSERT INTO Users (userNameEN, userPassword, userEmail, companyGUID, userGUID, activeStatus, companyId)
      VALUES (${userNameEN}, ${hashed}, ${userEmail || null}, ${companyGUID}, ${userGUID}, ${activeStatus}, ${companyId || null})
    `;

    await sql.query`
      INSERT INTO UserCompanyAccess (userGUID, companyGUID, companyRole)
      VALUES (${userGUID}, ${companyGUID}, 'Member')
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
router.post("/login", async (req, res) => {
  try {
    let { email, password } = req.body;
    email = normalize(email);
    password = normalize(password);

    if (!email || !password) {
      return res.status(400).json({ error: "email and password are required" });
    }

    await sql.connect(sqlConfig);

    // 1️⃣ User identity
    const userQ = await sql.query`
      SELECT TOP 1 userGUID, userEmail, userPassword, mustChangePassword
      FROM Users
      WHERE userEmail = ${email}
    `;
    if (!userQ.recordset.length) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const user = userQ.recordset[0];
    const ok = await bcrypt.compare(password, user.userPassword);
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });

    // 2️⃣ Password change flow
    if (user.mustChangePassword) {
      const changeToken = jwt.sign(
        { userGUID: user.userGUID, scope: "password_change_only" },
        JWT_SECRET,
        { expiresIn: "15m" },
      );

      return res.json({
        requiresPasswordChange: true,
        changeToken,
      });
    }

    // 3️⃣ Companies this user can access
    const companiesQ = await sql.query`
      SELECT
        c.companyGUID,
        c.companyName,
        uca.companyRole
      FROM UserCompanyAccess uca
      JOIN Companies c ON c.companyGUID = uca.companyGUID
      WHERE uca.userGUID = ${user.userGUID}
    `;

    return res.json({
      userGUID: user.userGUID,
      companies: companiesQ.recordset,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Company Login
router.post("/login/company", async (req, res) => {
  try {
    const { userGUID, companyGUID } = req.body;

    if (!userGUID || !companyGUID) {
      return res
        .status(400)
        .json({ error: "userGUID and companyGUID required" });
    }

    await sql.connect(sqlConfig);

    const accessQ = await sql.query`
      SELECT companyRole
      FROM UserCompanyAccess
      WHERE userGUID = ${userGUID}
        AND companyGUID = ${companyGUID}
    `;
    if (!accessQ.recordset.length) {
      return res.status(403).json({ error: "No access to this company" });
    }

    const token = jwt.sign(
      {
        userGUID,
        companyGUID,
        companyRole: accessQ.recordset[0].companyRole,
      },
      JWT_SECRET,
      { expiresIn: "2h" },
    );

    res.json({ token });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==========================
// ХЭРЭГЛЭГЧ БАЙГАА ЭСЭХ (Optional helper)
// ==========================
router.post("/check", async (req, res) => {
  try {
    let { username, companyGUID } = req.body;
    username = normalize(username);
    companyGUID = normalize(companyGUID);

    if (!username || !companyGUID) {
      return res
        .status(400)
        .json({ error: "username, companyGUID are required" });
    }

    await sql.connect(sqlConfig);
    const result = await sql.query`
      SELECT TOP 1 id FROM Users WHERE userEmail=${username} AND companyGUID=${companyGUID}`;
    if (!result.recordset.length) return res.json({ res: "User Not found" });

    return res.json({ res: "User found" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// routes get project

router.get("/projects", authMiddleware, async (req, res) => {
  try {
    const { userGUID, companyGUID } = req.user; // JWT-с companyGUID-г авна

    if (!companyGUID) {
      return res.status(400).json({ error: "companyGUID not found in token" });
    }

    await sql.connect(sqlConfig);

    const projects = await sql.query`
      SELECT projectGUID, projectName
      FROM Projects
      WHERE companyGUID = ${companyGUID}
    `;

    const newToken = jwt.sign(
      {
        userGUID,
        companyGUID,
        projectGUID: projects.recordset[0].projectGUID, // ⭐ хамгийн чухал
      },
      JWT_SECRET,
      { expiresIn: "2h" },
    );

    return res.json({
      data: projects.recordset,
      token: newToken, // ⭐ шинэ JWT
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch projects" });
  }
});

// routes/auth.js
router.post("/select-project", authMiddleware, async (req, res) => {
  try {
    const { projectGUID } = req.body;
    const { userGUID, companyGUID } = req.user;
    // console.log(projectGUID)

    if (!projectGUID) {
      return res.status(400).json({ error: "projectGUID is required" });
    }

    /* await sql.connect(sqlConfig);

    // 🔐 UserProjectAccess шалгах
    const access = await sql.query`
      SELECT accessRole
      FROM UserProjectAccess
      WHERE userGUID = ${userGUID}
        AND projectGUID = ${projectGUID}
    `;

    if (!access.recordset.length) {
      return res.status(403).json({ error: 'No access to this project' });
    }

    const role = access.recordset[0].accessRole;
    */

    // 🆕 ШИНЭ JWT (project орсон)
    const newToken = jwt.sign(
      {
        userGUID,
        companyGUID,
        projectGUID,
      },
      JWT_SECRET,
      { expiresIn: "2h" },
    );

    res.json({ token: newToken });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to select project" });
  }
});

router.post("/admin/reset-password", async (req, res) => {
  try {
    // Authentication: either admin JWT with payload.isAdmin === true
    // or a static admin key in header x-admin-key
    const adminKeyHeader = req.headers["x-admin-key"];
    const adminKeyOk =
      adminKeyHeader &&
      process.env.ADMIN_API_KEY &&
      adminKeyHeader === process.env.ADMIN_API_KEY;

    // try JWT auth if provided
    let isAdmin = false;
    const auth = req.headers.authorization;
    if (auth) {
      const token = auth.split(" ")[1];
      try {
        const payload = jwt.verify(token, JWT_SECRET);
        if (payload && payload.isAdmin) isAdmin = true;
      } catch (e) {
        // invalid token — ignore, will fallback to admin key
      }
    }

    if (!isAdmin && !adminKeyOk) {
      return res.status(403).json({ error: "Admin credentials required" });
    }

    const { userGUID, tempPassword, companyGUID } = req.body;

    if (!tempPassword || typeof tempPassword !== "string") {
      return res
        .status(400)
        .json({ error: "tempPassword (string) is required" });
    }

    await sql.connect(sqlConfig);

    let userQuery;
    if (userGUID) {
      userQuery =
        await sql.query`SELECT TOP 1 userNameEN, companyId, userEmail, userGUID FROM Users WHERE userGUID = ${userGUID}`;
    } else {
      return res
        .status(400)
        .json({ error: "Provide userId OR (username and companyId)" });
    }

    if (!userQuery.recordset.length) {
      return res.status(404).json({ error: "User not found" });
    }

    if (companyGUID) {
      const existingAccess = await sql.query`
        SELECT * FROM UserCompanyAccess WHERE userGUID = ${userGUID} AND companyGUID = ${companyGUID}
      `;
      if (existingAccess.recordset.length === 0) {
        await sql.query`
      INSERT INTO UserCompanyAccess (userGUID, companyGUID, companyRole)
      VALUES (${userGUID}, ${companyGUID}, 'Member')`;
      }
    
    }

     

    const user = userQuery.recordset[0];

    // Hash the temp password
    const hashed = await bcrypt.hash(tempPassword, 10);

    // Update password, set mustChangePassword=1 so user must change on next login
    await sql.query`
      UPDATE Users
      SET userPassword = ${hashed},
          mustChangePassword = 1,
          passwordChangedAt = NULL
      WHERE userGUID = ${user.userGUID}
    `;

    // Optional: log the admin reset (you may want an audit table; here we just reply)
    return res.json({
      message:
        "Temporary password set. Inform the user to login and change their password.",
    });
  } catch (e) {
    console.error("admin reset error", e);
    res.status(500).json({ error: e.message || "Server error" });
  }
});

// Нууц үг солих — зөвхөн changeToken (scope=password_change_only) ашиглана
router.post("/password/change", async (req, res) => {
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

    if (payload.scope !== "password_change_only") {
      return res
        .status(403)
        .json({ error: "Token scope not allowed for password change" });
    }

    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res
        .status(400)
        .json({ error: "currentPassword and newPassword are required" });
    }
    if (!validatePassword(newPassword)) {
      return res.status(400).json({
        error:
          "Weak password. Use at least 8 chars and mix of cases/numbers/symbols.",
      });
    }

    await sql.connect(sqlConfig);

    const q = await sql.query`
      SELECT TOP 1 id, userPassword, mustChangePassword FROM Users WHERE userGUID=${payload.userGUID}
    `;
    if (!q.recordset.length)
      return res.status(404).json({ error: "User not found" });

    const user = q.recordset[0];

    // Одоогийн нууц үг таарч буй эсэхийг шалгах
    const ok = await bcrypt.compare(currentPassword, user.userPassword);
    if (!ok)
      return res.status(401).json({ error: "Current password is incorrect" });

    // Хэрэв аль хэдийн солиод mustChangePassword=0 болсон бол давхар хамгаалалт
    if (user.mustChangePassword === false || user.mustChangePassword === 0) {
      return res.status(409).json({ error: "Password already changed" });
    }

    const hashed = await bcrypt.hash(newPassword, 10);

    await sql.query`
      UPDATE Users
      SET userPassword = ${hashed},
          mustChangePassword = 0,
          passwordChangedAt = SYSUTCDATETIME()
      WHERE userGUID = ${payload.userGUID}
    `;

    // ✅ Дараагийн алхам: энгийн нэвтрэлт хийх (шинэ нууцтайгаа /login руу)
    return res.json({ message: "Password changed. Please login again." });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==========================
// Нууц үг солих (нэвтэрсэн хэрэглэгч)
// ==========================
router.post("/change-password", async (req, res) => {
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

    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword) {
      return res
        .status(400)
        .json({ error: "oldPassword and newPassword are required" });
    }
    if (newPassword.length < 6) {
      return res
        .status(400)
        .json({ error: "Нууц үг хамгийн багадаа 6 тэмдэгт байх ёстой" });
    }

    await sql.connect(sqlConfig);

    const q = await sql.query`
      SELECT TOP 1 id, password FROM Users WHERE id=${payload.userId}
    `;
    if (!q.recordset.length)
      return res.status(404).json({ error: "User not found" });

    const user = q.recordset[0];

    // Одоогийн нууц үг таарч буй эсэхийг шалгах
    const ok = await bcrypt.compare(oldPassword, user.password);
    if (!ok)
      return res.status(401).json({ error: "Одоогийн нууц үг буруу байна" });

    const hashed = await bcrypt.hash(newPassword, 10);

    await sql.query`
      UPDATE Users
      SET password = ${hashed},
          passwordChangedAt = SYSUTCDATETIME()
      WHERE id = ${payload.userId}
    `;

    return res.json({ message: "Нууц үг амжилттай солигдлоо" });
  } catch (e) {
    console.error("change-password error", e);
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
router.get("/me", authMiddleware, async (req, res) => {
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
