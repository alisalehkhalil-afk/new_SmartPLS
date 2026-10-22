const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const db = require('./config/db');
const authRoutes = require('./routes/auth');
const systemsRoutes = require('./routes/systems');
const surveysRoutes = require('./routes/surveys');
const questionsRoutes = require('./routes/questions');
const evaluationsRoutes = require('./routes/evaluations');
const analyticsRoutes = require('./routes/analytics');
const usersRoutes = require('./routes/users');
const groupsRoutes = require('./routes/groups');
const sessionsRoutes = require('./routes/sessions');
const reportsRoutes = require('./routes/reports');
const whatsappRoutes = require('./routes/whatsapp');

const app = express();
const PORT = process.env.PORT || 3000;

// Process stability handlers
process.on('uncaughtException', (err) => {
  console.error('[Process Uncaught Exception]:', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Process Unhandled Rejection]:', reason);
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// Mount API routes
app.use('/api/auth', authRoutes);
app.use('/api/systems', systemsRoutes);
app.use('/api/surveys', surveysRoutes);
app.use('/api/questions', questionsRoutes);
app.use('/api/evaluations', evaluationsRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/groups', groupsRoutes);
app.use('/api/sessions', sessionsRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/whatsapp', whatsappRoutes);

// Health check and status
app.get('/api/status', (req, res) => {
  res.json({
    status: 'online',
    appName: 'New_SmartPLS - منصة تقييم الأنظمة المالية الحكومية',
    version: '1.0.0',
    databaseLive: db.isLive(),
    timestamp: new Date().toISOString()
  });
});

// HTML Page routing fallbacks
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/builder', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'survey_builder.html'));
});

app.get('/builder.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'survey_builder.html'));
});

app.get('/evaluate', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'evaluate.html'));
});

app.get('/survey', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'survey_form.html'));
});

app.get('/survey.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'survey_form.html'));
});

app.get('/survey_form', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'survey_form.html'));
});

app.get('/survey_form.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'survey_form.html'));
});

app.get('/analytics', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'analytics.html'));
});

app.get('/report', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'report.html'));
});

app.get('/users', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'users.html'));
});

app.get('/users.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'users.html'));
});

app.get('/groups', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'groups.html'));
});

app.get('/groups.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'groups.html'));
});

app.get('/benchmark', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'benchmark.html'));
});

app.get('/benchmark.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'benchmark.html'));
});

app.get('/presentation', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'presentation.html'));
});

app.get('/presentation.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'presentation.html'));
});

app.get('/whatsapp-settings', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'whatsapp_settings.html'));
});

app.get('/whatsapp_settings.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'whatsapp_settings.html'));
});

// Start server
async function startServer() {
  try {
    // Attempt DB connection
    await db.getPool();

    const server = app.listen(PORT, () => {
      console.log('================================================================');
      console.log(`[New_SmartPLS] المنصة تعمل بنجاح على المنفذ: http://localhost:${PORT}`);
      console.log(`[New_SmartPLS] بوابة وزارة المالية: http://localhost:${PORT}/index.html`);
      console.log(`[New_SmartPLS] لوحة التحليلات الذكية: http://localhost:${PORT}/analytics.html`);
      console.log('================================================================');
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        const altPort = parseInt(PORT) + 1;
        console.warn(`[New_SmartPLS] المنفذ ${PORT} قيد الاستخدام حالياً بواسطة جلسة سابقة. جاري التحويل للمنفذ البديل: ${altPort}`);
        const altServer = app.listen(altPort, () => {
          console.log('================================================================');
          console.log(`[New_SmartPLS] المنصة تعمل بنجاح على المنفذ البديل: http://localhost:${altPort}`);
          console.log(`[New_SmartPLS] بوابة وزارة المالية: http://localhost:${altPort}/index.html`);
          console.log(`[New_SmartPLS] لوحة التحليلات الذكية: http://localhost:${altPort}/analytics.html`);
          console.log('================================================================');
        });
        altServer.on('error', (err2) => {
          console.error(`[New_SmartPLS] كلا المنفذين ${PORT} و ${altPort} مشغولان:`, err2.message);
        });
      } else {
        console.error('Server error:', err);
      }
    });
  } catch (err) {
    console.error('Failed to start server:', err);
  }
}

startServer();

module.exports = app;
