'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const express = require('express');
const cookieSession = require('cookie-session');

const { loadUser } = require('./middleware/auth');

const app = express();
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(cookieSession({
  name: 'arkia_fr',
  secret: process.env.SESSION_SECRET || 'dev-insecure-secret-change-me',
  maxAge: 12 * 60 * 60 * 1000, // 12 שעות
  httpOnly: true,
  sameSite: 'lax',
}));

// טעינת המשתמש הנוכחי לכל בקשה
app.use(loadUser);

// ---- API ----
app.use('/api/auth', require('./routes/auth'));
app.use('/api/companies', require('./routes/companies'));
app.use('/api/periods', require('./routes/periods'));
app.use('/api/versions', require('./routes/versions'));
app.use('/api/trial-balance', require('./routes/trial-balance'));
app.use('/api/index-map', require('./routes/index-map'));
app.use('/api/fs-lines', require('./routes/fs-lines'));
app.use('/api/adjustments', require('./routes/adjustments'));
app.use('/api/reclass', require('./routes/reclass'));
app.use('/api/reclass-rules', require('./routes/reclass-rules'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/consolidation', require('./routes/consolidation'));
app.use('/api/statements', require('./routes/statements'));
app.use('/api/users', require('./routes/users'));
app.use('/api/audit', require('./routes/audit'));

// ---- פרונט סטטי ----
app.use(express.static(path.join(__dirname, '..', 'client')));

// טיפול בשגיאות אחיד
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'שגיאת שרת' });
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`מערכת דוחות כספיים · ארקיע — פועלת על פורט ${PORT}`));
}

module.exports = app;
