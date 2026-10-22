const sql = require('mssql');

const config = {
  user: 'smartpls_user',
  password: 'SmartPLS@2026!',
  server: 'localhost',
  database: 'Test_Soft',
  options: {
    encrypt: false,
    trustServerCertificate: true,
    enableArithAbort: true
  }
};

async function test() {
  try {
    console.log('Connecting to SQL Server as smartpls_user...');
    const pool = await new sql.ConnectionPool(config).connect();
    console.log('SUCCESS! Connected to Test_Soft.');
    const res = await pool.request().query('SELECT COUNT(*) as sysCount FROM tst_systems');
    console.log('tst_systems count:', res.recordset[0].sysCount);
    const surveys = await pool.request().query('SELECT SurveyId, SurveyName FROM tst_survey');
    console.log('Surveys in DB:', surveys.recordset);
    await pool.close();
    process.exit(0);
  } catch (err) {
    console.error('Connection failed:', err.message);
    process.exit(1);
  }
}

test();
