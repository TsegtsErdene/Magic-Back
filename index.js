const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
dotenv.config();

const fileRoutes = require("./src/routes/files");
const authRoutes = require("./src/routes/auth");
const categoriesRoutes = require("./src/routes/categories");
const templateRoutes = require("./src/routes/templates");
const reportRoutes = require("./src/routes/report");
const dashboardRoutes = require("./src/routes/dashboard");
const dynamicsRoutes = require("./src/routes/dynamics");

const app = express();

// CORS тохиргоо - production болон development origin-уудыг зөвшөөрөх
const corsOptions = {
  origin: [
    "http://localhost:5173",
    "http://localhost:3000",
    "http://192.168.1.7:5173",
    "https://audit.magicgroup.mn",
    "https://auditcustomer.magicgroup.mn",
    "https://magicgroup.mn"
  ],
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
};
app.use(cors(corsOptions));
app.use(express.json({ encoding: "utf-8" }));
app.use(express.urlencoded({ extended: true, encoding: "utf-8" }));

// File routes
app.use("/api/files", fileRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/categories", categoriesRoutes);
app.use("/api/templates", templateRoutes);
app.use("/api/report", reportRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/dynamics", dynamicsRoutes);

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
});

// 404 handler - бусад бүх route-д
app.use((req, res) => {
  res.status(404).json({ error: "Not found", path: req.path });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
