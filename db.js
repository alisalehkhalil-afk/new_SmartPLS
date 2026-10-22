const sql = require('mssql');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const dbConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER || 'localhost',
  database: process.env.DB_NAME || 'Test_Soft',
  options: {
    encrypt: false,
    trustServerCertificate: true,
    enableArithAbort: true,
    connectTimeout: 5000,
    requestTimeout: 15000
  },
  pool: {
    max: 15,
    min: 0,
    idleTimeoutMillis: 30000
  }
};

let pool = null;
let isLive = false;
let mockData = null;

function loadMockData() {
  try {
    const mockPath = path.join(__dirname, '..', 'database', 'mock_data.json');
    if (fs.existsSync(mockPath)) {
      const content = fs.readFileSync(mockPath, 'utf8');
      mockData = JSON.parse(content);
      console.log('Mock/fallback data loaded successfully.');
    }
  } catch (err) {
    console.error('Error loading mock data:', err.message);
  }
}

async function getPool() {
  if (pool && isLive) return pool;

  try {
    const newPool = new sql.ConnectionPool(dbConfig);
    newPool.on('error', err => {
      console.warn('[Database Pool Warning]:', err.message);
      // Reset pool on connection error so subsequent requests reconnect cleanly
      isLive = false;
      pool = null;
    });
    pool = await newPool.connect();
    isLive = true;
    console.log(`[Database] Successfully connected to live SQL Server: ${dbConfig.server}/${dbConfig.database}`);
    return pool;
  } catch (err) {
    console.warn(`[Database] Live SQL Server connection failed (${err.message}). Activating internal high-speed mock connector.`);
    isLive = false;
    pool = null;
    if (!mockData) loadMockData();
    return null;
  }
}

// Unified query wrapper that works with both live SQL Server and fallback
async function query(sqlText, params = {}) {
  const activePool = await getPool();
  if (activePool && isLive) {
    try {
      const request = activePool.request();
      for (const [key, value] of Object.entries(params)) {
        request.input(key, value);
      }
      const result = await request.query(sqlText);
      return result;
    } catch (err) {
      console.error('[Database Query Error]:', err.message, 'Query:', sqlText);
      throw err;
    }
  }

  // Fallback memory connector
  if (!mockData) loadMockData();
  return executeMockQuery(sqlText, params);
}

function executeMockQuery(sqlText, params) {
  const normalized = sqlText.toLowerCase().trim();

  // am_user: INSERT / UPDATE / DELETE / SELECT
  if (normalized.includes('delete from am_user')) {
    const uid = (params.userId || '').toString();
    mockData.users = (mockData.users || []).filter(u => u.user_id !== uid);
    return { recordset: [], rowsAffected: [1] };
  }

  if (normalized.includes('insert into am_user') || normalized.includes('update am_user')) {
    const uid = (params.userId || '').toString();
    if (!mockData.users) mockData.users = [];
    const existing = mockData.users.find(u => u.user_id === uid);
    if (existing) {
      if (params.userName) existing.user_name_a = params.userName;
      if (params.password) existing.user_password = params.password;
      if (params.email !== undefined) existing.email = params.email;
      if (params.mobile !== undefined) existing.mobile = params.mobile;
      if (params.description !== undefined) existing.description = params.description;
    } else {
      mockData.users.push({
        user_id: uid,
        user_name_a: params.userName || uid,
        user_name_e: params.userName || uid,
        user_password: params.password || '1',
        group_id: params.groupId || 4,
        group_name: 'المستخدمون الميدانيون',
        email: params.email || '',
        mobile: params.mobile || ''
      });
    }
    return { recordset: [], rowsAffected: [1] };
  }

  if (normalized.includes('from am_user')) {
    const username = (params.username || '').toString().trim();
    if (username) {
      const user = (mockData.users || []).find(u => u.user_id === username || (u.user_name_a && u.user_name_a.includes(username)));
      if (user) {
        return {
          recordset: [{
            user_id: user.user_id,
            user_name_a: user.user_name_a,
            user_password: user.user_password || '1',
            group_id: user.group_id || 1,
            group_name_a: user.group_name || 'اللجنة الإشرافية العليا',
            group_name_e: 'Supervisory Committee'
          }]
        };
      }
      return { recordset: [] };
    }

    // Return all users
    const all = (mockData.users || []).map(u => ({
      user_id: u.user_id,
      user_name_a: u.user_name_a,
      user_name_e: u.user_name_e || u.user_name_a,
      user_password: u.user_password || '1',
      description: u.description || '',
      email: u.email || '',
      mobile: u.mobile || '',
      status_code: 'ge_active_status',
      group_id: u.group_id || 4,
      group_name_a: u.group_name || 'المستخدمون الميدانيون',
      SurveyId: 101,
      SurveyName: 'التقييم الشامل لنظام AFMIS',
      SystemName: 'نظام المعلومات المالية والمحاسبية الحكومي (AFMIS)'
    }));
    return { recordset: all };
  }

  // Groups query: SELECT
  if (normalized.includes('from am_user_group')) {
    if (!mockData.groups) {
      mockData.groups = [
        { group_id: 1, group_name_a: 'الجانب الاداري', group_name_e: 'Administrator', status_code_id: 'ge_active_status', note: 'كامل الصلاحيات' },
        { group_id: 2, group_name_a: 'المستخدمين للنظام', group_name_e: 'End Users', status_code_id: 'ge_active_status', note: 'كبار المحاسبين' },
        { group_id: 3, group_name_a: 'الفريق الفني', group_name_e: 'tech suports', status_code_id: 'ge_active_status', note: 'المدرسين' },
        { group_id: 4, group_name_a: 'المبرمجين', group_name_e: 'Programmers', status_code_id: 'ge_active_status', note: '' },
        { group_id: 5, group_name_a: 'المستشارين', group_name_e: 'mostashars', status_code_id: 'ge_active_status', note: '' },
        { group_id: 6, group_name_a: 'الوكلاء', group_name_e: 'الوكلاء', status_code_id: 'ge_active_status', note: '' },
        { group_id: 7, group_name_a: 'أخرى ', group_name_e: 'اخرى', status_code_id: 'ge_active_status', note: '' }
      ];
    }
    if (params.groupId) {
      return { recordset: mockData.groups.filter(g => g.group_id == params.groupId) };
    }
    const allG = mockData.groups.map(g => ({
      ...g,
      systems_count: g.group_id === 2 ? 1 : 1,
      surveys_count: g.group_id === 2 ? 1 : 1,
      levels_count: g.group_id === 2 ? 1 : 1,
      classes_count: g.group_id === 2 ? 2 : 3,
      questions_count: g.group_id === 2 ? 78 : 100,
      users_count: g.group_id === 2 ? 4 : 5
    }));
    return { recordset: allG };
  }

  // Groups query: INSERT
  if (normalized.includes('insert into am_user_group')) {
    if (!mockData.groups) mockData.groups = [];
    const nextId = mockData.groups.reduce((max, g) => Math.max(max, g.group_id || 0), 0) + 1;
    const newG = {
      group_id: nextId,
      group_name_a: params.nameAr || 'مجموعة جديدة',
      group_name_e: params.nameEn || 'New Group',
      status_code_id: params.statusCode || 'ge_active_status',
      note: params.groupNote || ''
    };
    mockData.groups.push(newG);
    return { recordset: [{ group_id: newG.group_id }], rowsAffected: [1] };
  }

  // Group Details: systems, surveys, levels, classes, questions
  if (normalized.includes('from tst_group_detail_system')) {
    return { recordset: [{ group_id: '2', system_id: 1, system_name: 'نظام AFMIS المالي الحكومي', note: '' }] };
  }
  if (normalized.includes('from tst_group_detail_survey')) {
    return { recordset: [{ group_id: '2', survey_id: 101, survey_name: 'التقييم الشامل لنظام AFMIS', system_name: 'نظام AFMIS', note: '' }] };
  }
  if (normalized.includes('from tst_group_detail_levels')) {
    return { recordset: [{ group_id: '2', level_id: 4, level_name: 'مستوى المستخدم', survey_name: 'التقييم الشامل', note: '' }] };
  }
  if (normalized.includes('from tst_group_detail_classes')) {
    return { recordset: [
      { group_id: '2', class_id: 1010, class_name: 'عام', level_name: 'مستوى المستخدم', note: '' },
      { group_id: '2', class_id: 1017, class_name: 'التكامل', level_name: 'مستوى المستخدم', note: '' }
    ]};
  }
  if (normalized.includes('from tst_group_detail_q_values')) {
    return { recordset: [
      { group_id: '2', value_id: 1602, value_name: 'من وجهة نظرك كمستخدم، ما مدى سهولة التعامل مع التكامل...', class_name: 'التكامل', note: '' },
      { group_id: '2', value_id: 1603, value_name: 'هل التكامل مع الموارد البشرية ساعدك في العمليات...', class_name: 'التكامل', note: '' },
      { group_id: '2', value_id: 1604, value_name: 'هل التكامل مع المخازن والمشتريات ساعدك...', class_name: 'التكامل', note: '' }
    ]};
  }
  if (normalized.includes('delete from tst_group_detail')) {
    return { recordset: [], rowsAffected: [1] };
  }
  if (normalized.includes('insert into tst_group_detail')) {
    return { recordset: [], rowsAffected: [1] };
  }

  // Systems query: INSERT
  if (normalized.includes('insert into tst_systems')) {
    const nextId = (mockData.systems || []).reduce((max, s) => Math.max(max, s.SystemId || 0), 0) + 1;
    const newSys = {
      SystemId: nextId,
      SystemName: params.systemName || 'نظام مالي جديد',
      system_counter: 0
    };
    mockData.systems.push(newSys);
    return {
      recordset: [{ SystemId: newSys.SystemId, SystemName: newSys.SystemName }],
      rowsAffected: [1]
    };
  }

  // Systems query: UPDATE
  if (normalized.includes('update tst_systems')) {
    const sys = (mockData.systems || []).find(s => s.SystemId == params.systemId);
    if (sys && params.systemName) {
      sys.SystemName = params.systemName;
    }
    return { recordset: [], rowsAffected: [sys ? 1 : 0] };
  }

  // Systems query: SELECT single or all
  if (normalized.includes('from tst_systems')) {
    if (params.systemId) {
      const single = (mockData.systems || []).filter(s => s.SystemId == params.systemId);
      return { recordset: single };
    }
    const rows = (mockData.systems || []).map(s => {
      const surveyCount = (mockData.surveys || []).filter(sur => sur.SystemId == s.SystemId).length;
      const questionCount = (mockData.questions || []).filter(q => q.system_id == s.SystemId).length;
      return {
        ...s,
        surveyCount,
        questionCount
      };
    });
    return { recordset: rows };
  }

  // Surveys query: INSERT
  if (normalized.includes('insert into tst_survey')) {
    const nextId = (mockData.surveys || []).reduce((max, s) => Math.max(max, s.SurveyId || 0), 0) + 1;
    const newSurv = {
      SurveyId: nextId,
      SystemId: params.systemId,
      SurveyName: params.surveyName
    };
    mockData.surveys.push(newSurv);
    return {
      recordset: [{ SurveyId: newSurv.SurveyId, SystemId: newSurv.SystemId, SurveyName: newSurv.SurveyName }],
      rowsAffected: [1]
    };
  }

  // Surveys query: SELECT single or all
  if (normalized.includes('from tst_survey')) {
    let rows = (mockData.surveys || []).map(sur => {
      const sys = (mockData.systems || []).find(s => s.SystemId == sur.SystemId);
      const levelCount = (mockData.levels || []).filter(l => l.SurveyId == sur.SurveyId).length;
      const questionCount = (mockData.questions || []).filter(q => q.survey_id == sur.SurveyId).length;
      return {
        ...sur,
        SystemName: sys ? sys.SystemName : 'نظام مالي حكومي',
        levelCount,
        questionCount
      };
    });
    if (params.surveyId) {
      rows = rows.filter(s => s.SurveyId == params.surveyId);
    }
    if (params.systemId) {
      rows = rows.filter(s => s.SystemId == params.systemId);
    }
    return { recordset: rows };
  }

  // Survey levels: INSERT
  if (normalized.includes('insert into tst_survey_levels')) {
    const nextId = (mockData.levels || []).reduce((max, l) => Math.max(max, l.LevelId || 0), 0) + 1;
    const newLvl = {
      LevelId: nextId,
      SurveyId: params.surveyId,
      LevelName: params.levelName
    };
    mockData.levels.push(newLvl);
    return {
      recordset: [{ LevelId: newLvl.LevelId, SurveyId: newLvl.SurveyId, LevelName: newLvl.LevelName }],
      rowsAffected: [1]
    };
  }

  // Survey levels: SELECT
  if (normalized.includes('from tst_survey_levels') && !normalized.includes('from tst_survey_levels_class')) {
    let rows = [...(mockData.levels || [])];
    if (params.surveyId) {
      rows = rows.filter(l => l.SurveyId == params.surveyId);
    }
    return { recordset: rows };
  }

  // Survey classes: INSERT
  if (normalized.includes('insert into tst_survey_levels_class')) {
    const nextId = (mockData.classes || []).reduce((max, c) => Math.max(max, c.ClassId || 0), 0) + 1;
    const newClass = {
      ClassId: nextId,
      LevelId: params.levelId,
      ClassName: params.className
    };
    mockData.classes.push(newClass);
    return {
      recordset: [{ ClassId: newClass.ClassId, LevelId: newClass.LevelId, ClassName: newClass.ClassName }],
      rowsAffected: [1]
    };
  }

  // Survey classes: SELECT
  if (normalized.includes('from tst_survey_levels_class') && !normalized.includes('from tst_system_q_values')) {
    let rows = [...(mockData.classes || [])];
    const inMatch = sqlText.match(/levelid\s+in\s*\(([^)]+)\)/i);
    if (inMatch) {
      const allowedIds = inMatch[1].split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
      rows = rows.filter(c => allowedIds.includes(c.LevelId));
    } else if (params.levelId) {
      rows = rows.filter(c => c.LevelId == params.levelId);
    }
    rows = rows.map(c => {
      const questionCount = (mockData.questions || []).filter(q => q.q_class_id == c.ClassId).length;
      return {
        ...c,
        questionCount
      };
    });
    return { recordset: rows };
  }

  // Evaluations: UPSERT (IF EXISTS / MERGE / INSERT)
  if (normalized.includes('tst_user_detail_q_values') && (normalized.includes('if exists') || normalized.includes('merge') || normalized.includes('insert into tst_user_detail_q_values'))) {
    const uid = (params.userId || '100').toString();
    const vid = parseInt(params.valueId);
    if (!mockData.evaluations) mockData.evaluations = [];
    const existing = mockData.evaluations.find(e => e.user_id == uid && e.value_id == vid);
    if (existing) {
      existing.rating = parseInt(params.rating) || existing.rating;
      existing.score = parseFloat(params.score) || existing.score;
      if (params.evidence !== undefined) existing.evidence = params.evidence;
      if (params.note !== undefined) existing.note = params.note;
      if (params.defectCategory) existing.defect_category = params.defectCategory;
      existing.eval_date = new Date().toISOString();
    } else {
      mockData.evaluations.push({
        user_id: uid,
        value_id: vid,
        rating: parseInt(params.rating) || 3,
        score: parseFloat(params.score) || 3.0,
        defect_category: params.defectCategory || 'فني',
        evidence: params.evidence || '',
        note: params.note || '',
        eval_date: new Date().toISOString()
      });
    }
    return { recordset: [], rowsAffected: [1] };
  }

  // Questions: DELETE
  if (normalized.includes('delete from tst_system_q_values')) {
    const vid = parseInt(params.valueId);
    mockData.questions = (mockData.questions || []).filter(q => q.value_id != vid);
    return { recordset: [], rowsAffected: [1] };
  }

  // Evaluations: DELETE
  if (normalized.includes('delete from tst_user_detail_q_values')) {
    const vid = parseInt(params.valueId);
    mockData.evaluations = (mockData.evaluations || []).filter(e => e.value_id != vid);
    return { recordset: [], rowsAffected: [1] };
  }

  // Questions: INSERT
  if (normalized.includes('insert into tst_system_q_values')) {
    const nextId = (mockData.questions || []).reduce((max, q) => Math.max(max, q.value_id || 0), 0) + 1;
    const newQ = {
      value_id: nextId,
      system_id: parseInt(params.systemId) || 10,
      survey_id: parseInt(params.surveyId) || 101,
      sur_level: parseInt(params.levelId) || 101,
      q_class_id: parseInt(params.classId) || 201,
      q_order: parseInt(params.qOrder) || ((mockData.questions || []).length + 1),
      q_name: params.qName || `Q_${nextId}`,
      q_description: params.qDescription || '',
      q_type_a: params.qType || 'المقياس الخطي',
      q_control: params.qControl || `gforms_${params.qType || 'linear_scale'}`,
      q_value: params.qValue || '5',
      defect_category: params.defectCategory || 'فني',
      weight: parseFloat(params.weight) || 1.0,
      max_score: parseInt(params.maxScore) || 5,
      is_required: params.isRequired === undefined ? 1 : params.isRequired
    };
    mockData.questions.push(newQ);
    return {
      recordset: [{
        value_id: newQ.value_id,
        q_description: newQ.q_description,
        defect_category: newQ.defect_category,
        weight: newQ.weight,
        q_type_a: newQ.q_type_a,
        q_control: newQ.q_control,
        q_value: newQ.q_value
      }],
      rowsAffected: [1]
    };
  }

  // Questions: UPDATE
  if (normalized.includes('update tst_system_q_values')) {
    const vid = parseInt(params.valueId);
    const q = (mockData.questions || []).find(item => item.value_id == vid);
    if (q) {
      if (params.qOrder !== null && params.qOrder !== undefined) q.q_order = params.qOrder;
      if (params.qName !== null && params.qName !== undefined) q.q_name = params.qName;
      if (params.qDescription !== null && params.qDescription !== undefined) q.q_description = params.qDescription;
      if (params.qType !== null && params.qType !== undefined) q.q_type_a = params.qType;
      if (params.qControl !== null && params.qControl !== undefined) q.q_control = params.qControl;
      if (params.qValue !== null && params.qValue !== undefined) q.q_value = params.qValue;
      if (params.defectCategory !== null && params.defectCategory !== undefined) q.defect_category = params.defectCategory;
      if (params.weight !== null && params.weight !== undefined) q.weight = params.weight;
      if (params.maxScore !== null && params.maxScore !== undefined) q.max_score = params.maxScore;
      if (params.isRequired !== null && params.isRequired !== undefined) q.is_required = params.isRequired;
      if (params.classId !== null && params.classId !== undefined) q.q_class_id = params.classId;
      if (params.levelId !== null && params.levelId !== undefined) q.sur_level = params.levelId;
    }
    return { recordset: [], rowsAffected: [q ? 1 : 0] };
  }

  // Evaluations: SELECT query (e.g. GET /api/evaluations/:surveyId)
  if (normalized.includes('from tst_user_detail_q_values ev') && normalized.includes('join tst_system_q_values q')) {
    let rows = (mockData.evaluations || []).map(ev => {
      const q = (mockData.questions || []).find(item => item.value_id == ev.value_id);
      if (!q) return null;
      const c = (mockData.classes || []).find(item => item.ClassId == q.q_class_id);
      const l = (mockData.levels || []).find(item => item.LevelId == q.sur_level);
      return {
        ...ev,
        q_order: q.q_order,
        q_name: q.q_name,
        q_description: q.q_description,
        weight: q.weight,
        q_class_id: q.q_class_id,
        sur_level: q.sur_level,
        survey_id: q.survey_id,
        ClassName: c ? c.ClassName : 'عام',
        LevelName: l ? l.LevelName : 'عام'
      };
    }).filter(Boolean);

    if (params.surveyId) {
      rows = rows.filter(r => r.survey_id == params.surveyId);
    }
    if (params.userId) {
      rows = rows.filter(r => r.user_id == params.userId);
    }
    rows.sort((a, b) => (a.q_order || 0) - (b.q_order || 0));
    return { recordset: rows };
  }

  // Questions query with JOINs (routes/questions.js, routes/analytics.js, export-excel)
  if (normalized.includes('from tst_system_q_values')) {
    if (params.valueId) {
      const q = (mockData.questions || []).filter(item => item.value_id == params.valueId);
      return { recordset: q };
    }

    let rows = (mockData.questions || []).map(q => {
      const c = (mockData.classes || []).find(item => item.ClassId == q.q_class_id);
      const l = (mockData.levels || []).find(item => item.LevelId == q.sur_level);
      const s = (mockData.systems || []).find(item => item.SystemId == q.system_id);
      
      const evMatches = (mockData.evaluations || []).filter(e => e.value_id == q.value_id);
      const ev = evMatches.length > 0 ? evMatches[evMatches.length - 1] : null;

      return {
        ...q,
        ClassName: c ? c.ClassName : 'عام',
        LevelName: l ? l.LevelName : 'عام',
        SystemName: s ? s.SystemName : 'AFMIS',
        user_rating: ev ? ev.rating : 3,
        user_score: ev ? ev.score : 3.0,
        rating: ev ? ev.rating : 3,
        score: ev ? ev.score : 3.0,
        note: ev ? ev.note : '',
        evidence: ev ? ev.evidence : '',
        eval_date: ev ? ev.eval_date : '2026-10-10'
      };
    });

    if (params.surveyId) {
      rows = rows.filter(q => q.survey_id == params.surveyId);
    }
    if (params.levelId) {
      rows = rows.filter(q => q.sur_level == params.levelId);
    }
    if (params.classId) {
      rows = rows.filter(q => q.q_class_id == params.classId);
    }
    const inClassMatch = sqlText.match(/q\.q_class_id\s+in\s*\(([^)]+)\)/i);
    if (inClassMatch) {
      const cids = inClassMatch[1].split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n));
      if (cids.length > 0) {
        rows = rows.filter(q => cids.includes(q.q_class_id));
      }
    }
    rows.sort((a, b) => (a.q_order || 0) - (b.q_order || 0));
    return { recordset: rows };
  }

  // tst_system_q_values_list: SELECT / INSERT / UPDATE / DELETE (Mock Support)
  if (normalized.includes('tst_system_q_values_list')) {
    if (!mockData.questionOptions) mockData.questionOptions = [];

    if (normalized.includes('select isnull(max(list_order), 0) + 1 as nextorder')) {
      const opts = mockData.questionOptions.filter(o => o.value_id == params.valueId);
      const maxOrd = opts.reduce((m, o) => Math.max(m, o.list_order || 0), 0);
      return { recordset: [{ nextOrder: maxOrd + 1 }] };
    }

    if (normalized.includes('insert into tst_system_q_values_list')) {
      const nextId = mockData.questionOptions.reduce((m, o) => Math.max(m, o.list_id || 0), 0) + 1;
      const newOpt = {
        list_id: nextId,
        value_id: parseInt(params.valueId) || params.valueId,
        list_order: params.nextOrder || params.order || 1,
        list_type: params.finalType || params.listType || 'dropdown',
        list_value: params.listValue,
        list_value_choice: params.finalChoice || params.isChoice || 0,
        entry_date_time: new Date().toISOString()
      };
      mockData.questionOptions.push(newOpt);
      return { recordset: [newOpt], rowsAffected: [1] };
    }

    if (normalized.includes('delete from tst_system_q_values_list')) {
      if (params.listId) {
        mockData.questionOptions = mockData.questionOptions.filter(o => o.list_id != params.listId);
      } else if (params.valueId) {
        mockData.questionOptions = mockData.questionOptions.filter(o => o.value_id != params.valueId);
      }
      return { recordset: [], rowsAffected: [1] };
    }

    if (normalized.includes('update tst_system_q_values_list')) {
      const opt = mockData.questionOptions.find(o => o.list_id == (params.listId || params.lid));
      if (opt) {
        if (params.listValue !== null && params.listValue !== undefined) opt.list_value = params.listValue;
        if (params.listValueChoice !== null && params.listValueChoice !== undefined) opt.list_value_choice = params.listValueChoice;
        if (params.listOrder !== null && params.listOrder !== undefined) opt.list_order = params.listOrder;
        if (params.order !== undefined) opt.list_order = params.order;
        if (params.listType) opt.list_type = params.listType;
      }
      return { recordset: opt ? [opt] : [], rowsAffected: [opt ? 1 : 0] };
    }

    // SELECT
    let rows = [...mockData.questionOptions];
    const inMatch = sqlText.match(/value_id\s+in\s*\(([^)]+)\)/i);
    if (inMatch) {
      const ids = inMatch[1].split(',').map(n => parseInt(n.trim()));
      rows = rows.filter(o => ids.includes(o.value_id));
    } else if (params.valueId) {
      rows = rows.filter(o => o.value_id == params.valueId);
    } else if (params.listId) {
      rows = rows.filter(o => o.list_id == params.listId);
    }
    rows.sort((a, b) => (a.list_order || 0) - (b.list_order || 0));
    return { recordset: rows };
  }

  return { recordset: [], rowsAffected: [0] };
}

module.exports = {
  getPool,
  query,
  sql,
  isLive: () => isLive,
  getMockData: () => mockData
};
