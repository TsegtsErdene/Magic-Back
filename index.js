const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
dotenv.config();

const fileRoutes = require('./src/routes/files');
const authRoutes = require('./src/routes/auth');
const categoriesRoutes = require('./src/routes/categories');

const app = express();
app.use(cors());
app.use(express.json());

// File routes
app.use('/api/files', fileRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/categories', categoriesRoutes);
app.use("/", (req, res) => {
    res.status(200).send("ok");
  });

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
