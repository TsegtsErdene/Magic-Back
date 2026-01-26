const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const {
  getEmailsByEntity,
  getEmailsByEmailAddress,
  getEmailById,
  getAccounts,
  getContacts,
  replyToEmail,
  forwardEmail
} = require('../controllers/dynamicsEmails');
const {
  getMyActivities,
  getActivityById
} = require('../controllers/dynamicsActivities');
const {
  getProjectsByCompany
} = require('../controllers/dynamicsProjects');
const {
  getProjectHistoryByCompany
} = require('../controllers/dynamicsProjectHistory');

/**
 * GET /api/dynamics/health
 * Production дээр тохиргоог шалгах (auth шаардахгүй)
 */
router.get('/health', async (req, res) => {
  const config = {
    dynamicsUrl: process.env.DYNAMICS_INSTANCE_URL ? 'SET' : 'NOT SET',
    azureTenantId: process.env.AZURE_TENANT_ID ? 'SET' : 'NOT SET',
    azureClientId: process.env.AZURE_CLIENT_ID ? 'SET' : 'NOT SET',
    azureClientSecret: process.env.AZURE_CLIENT_SECRET ? 'SET' : 'NOT SET',
    timestamp: new Date().toISOString()
  };

  // Token авах туршилт
  try {
    const { getDynamicsAccessToken } = require('../controllers/dynamicsAuth');
    await getDynamicsAccessToken();
    config.tokenTest = 'SUCCESS';
  } catch (error) {
    config.tokenTest = 'FAILED';
    config.tokenError = error.message;
  }

  res.json(config);
});

// Бүх route-д authentication шаардана
router.use(authMiddleware);

/**
 * GET /api/dynamics/accounts
 * Account-уудын жагсаалт (dropdown-д)
 */
router.get('/accounts', async (req, res) => {
  try {
    const { search, top } = req.query;
    const accounts = await getAccounts({
      search: search || '',
      top: top ? parseInt(top) : 100
    });
    res.json(accounts);
  } catch (error) {
    console.error('Error fetching accounts:', error.message);
    res.status(500).json({ error: 'Failed to fetch accounts', details: error.message });
  }
});

/**
 * GET /api/dynamics/contacts
 * Contact-уудын жагсаалт (dropdown-д)
 */
router.get('/contacts', async (req, res) => {
  try {
    const { search, top, accountId } = req.query;
    const contacts = await getContacts({
      search: search || '',
      top: top ? parseInt(top) : 100,
      accountId: accountId || ''
    });
    res.json(contacts);
  } catch (error) {
    console.error('Error fetching contacts:', error.message);
    res.status(500).json({ error: 'Failed to fetch contacts', details: error.message });
  }
});

/**
 * GET /api/dynamics/emails
 * Нэвтэрсэн хэрэглэгчийн email хаягаар имэйлүүдийг авах
 * Query params:
 *   - top - Хэдэн имэйл авах (default: 50)
 */
router.get('/emails', async (req, res) => {
  try {
    const { top } = req.query;

    // Нэвтэрсэн хэрэглэгчийн мэдээллийг JWT-ээс авах
    const userEmail = req.user?.username; // username нь email хаяг

    if (!userEmail) {
      return res.status(400).json({ error: 'User email not found in token' });
    }

    // Хэрэглэгчийн email хаягаар имэйлүүдийг хайх
    const result = await getEmailsByEmailAddress(userEmail, {
      top: top ? parseInt(top) : 50
    });

    res.json(result);
  } catch (error) {
    console.error('Error fetching emails:', error.message);
    res.status(500).json({ error: 'Failed to fetch emails', details: error.message });
  }
});

/**
 * GET /api/dynamics/emails/:id
 * Нэг имэйлийн дэлгэрэнгүй
 */
router.get('/emails/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const email = await getEmailById(id);
    res.json(email);
  } catch (error) {
    console.error('Error fetching email:', error.message);
    res.status(500).json({ error: 'Failed to fetch email', details: error.message });
  }
});

/**
 * POST /api/dynamics/emails/:id/reply
 * Имэйлд хариулах
 * Body: { body: string }
 */
router.post('/emails/:id/reply', async (req, res) => {
  try {
    const { id } = req.params;
    const { body } = req.body;

    if (!body) {
      return res.status(400).json({ error: 'Reply body is required' });
    }

    // fromUserId - Dynamics systemuser ID (optional)
    const fromUserId = req.user?.dynamicsUserId || process.env.DYNAMICS_DEFAULT_USER_ID || null;

    console.log(`Reply request - emailId: ${id}, fromUserId: ${fromUserId}, body length: ${body.length}`);

    const result = await replyToEmail(id, body, fromUserId);
    res.json({ success: true, emailId: result.activityid || result.id });
  } catch (error) {
    console.error('Error sending reply:', error);
    res.status(500).json({
      error: 'Failed to send reply',
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * POST /api/dynamics/emails/:id/forward
 * Имэйл дамжуулах
 * Body: { to: string, body: string }
 */
router.post('/emails/:id/forward', async (req, res) => {
  try {
    const { id } = req.params;
    const { to, body } = req.body;

    if (!to) {
      return res.status(400).json({ error: 'Recipient email (to) is required' });
    }

    const fromUserId = req.user?.dynamicsUserId || process.env.DYNAMICS_DEFAULT_USER_ID;

    const result = await forwardEmail(id, to, body || '', fromUserId);
    res.json({ success: true, emailId: result.activityid });
  } catch (error) {
    console.error('Error forwarding email:', error.message);
    res.status(500).json({ error: 'Failed to forward email', details: error.message });
  }
});

/**
 * GET /api/dynamics/activities
 * Нэвтэрсэн хэрэглэгчийн бүх activities (timeline)
 * Query params:
 *   - top - Хэдэн activity авах (default: 100)
 *   - type - Activity төрөл (email, task, phonecall, appointment)
 *   - projectId - Сонгосон проектийн ID (Dynamics GUID)
 *   - companyId - Холбогдсон компани ID (regardingobjectid) - давхар шүүлт
 */
router.get('/activities', async (req, res) => {
  try {
    const { top, type, projectId, companyId } = req.query;

    // Нэвтэрсэн хэрэглэгчийн email хаягийг JWT-ээс авах
    const userEmail = req.user?.username;
    // JWT-ээс компани ID авах (хэрэв query-д өгөөгүй бол)
    const userCompanyId = companyId || req.user?.companyId || null;

    if (!userEmail) {
      return res.status(400).json({ error: 'User email not found in token' });
    }

    const result = await getMyActivities(userEmail, {
      top: top ? parseInt(top) : 100,
      activityType: type || null,
      companyId: userCompanyId,
      projectId: projectId || null
    });

    res.json(result);
  } catch (error) {
    console.error('Error fetching activities:', error.message);
    res.status(500).json({ error: 'Failed to fetch activities', details: error.message });
  }
});

/**
 * GET /api/dynamics/activities/:id
 * Нэг activity-ийн дэлгэрэнгүй
 */
router.get('/activities/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const activity = await getActivityById(id);
    res.json(activity);
  } catch (error) {
    console.error('Error fetching activity:', error.message);
    res.status(500).json({ error: 'Failed to fetch activity', details: error.message });
  }
});

/**
 * GET /api/dynamics/projects
 * Нэвтэрсэн хэрэглэгчийн компанитай холбоотой проектууд
 */
router.get('/projects', async (req, res) => {
  try {
    // JWT-ээс компани ID авах
    const companyId = req.user?.companyId;

    if (!companyId) {
      return res.status(400).json({ error: 'Company ID not found in token' });
    }

    const projects = await getProjectsByCompany(companyId);
    res.json(projects);
  } catch (error) {
    console.error('Error fetching projects:', error.message);
    res.status(500).json({ error: 'Failed to fetch projects', details: error.message });
  }
});

/**
 * GET /api/dynamics/project-history
 * Компанитай холбоотой Project History бичлэгүүд
 */
router.get('/project-history', async (req, res) => {
  try {
    // JWT-ээс компани ID авах
    const companyId = req.user?.companyId;

    if (!companyId) {
      return res.status(400).json({ error: 'Company ID not found in token' });
    }

    const history = await getProjectHistoryByCompany(companyId);
    res.json(history);
  } catch (error) {
    console.error('Error fetching project history:', error.message);
    res.status(500).json({ error: 'Failed to fetch project history', details: error.message });
  }
});

module.exports = router;
