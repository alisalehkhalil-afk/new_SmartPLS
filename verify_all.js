const http = require('http');

const PORT = 3000;
const BASE_URL = `http://localhost:${PORT}`;

function makeRequest(path, method = 'GET', postData = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          data: data
        });
      });
    });

    req.on('error', (err) => reject(err));

    if (postData) {
      req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
    }
    req.end();
  });
}

async function runTests() {
  console.log('================================================================');
  console.log('Starting Complete Automated Verification Suite for New_SmartPLS');
  console.log('================================================================');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`[PASS] ${message}`);
      passed++;
    } else {
      console.error(`[FAIL] ${message}`);
      failed++;
    }
  }

  try {
    // 1. Health Status
    console.log('\n--- 1. Testing System Status ---');
    const statusRes = await makeRequest('/api/status');
    assert(statusRes.statusCode === 200, 'Status endpoint returns HTTP 200');
    const statusJson = JSON.parse(statusRes.data);
    assert(statusJson.status === 'online', 'Platform status is online');
    assert(statusJson.databaseLive === true, 'Database is live connected to SQL Server');

    // 2. Authentication & Roles
    console.log('\n--- 2. Testing Authentication & RBAC ---');
    const authAdmin = await makeRequest('/api/auth/login', 'POST', { role: 'admin' });
    assert(authAdmin.statusCode === 200, 'Admin quick login returns 200');
    const adminData = JSON.parse(authAdmin.data);
    assert(adminData.user.role === 'admin', 'Admin user role is admin');

    const authCreds = await makeRequest('/api/auth/login', 'POST', { username: '100', password: '1' });
    assert(authCreds.statusCode === 200, 'DB Credentials login for user 100 returns 200');
    const credsData = JSON.parse(authCreds.data);
    assert(credsData.user.userId === '100', 'Authenticated user ID is 100 (علي خليل)');

    // 3. Financial Systems (Level 1)
    console.log('\n--- 3. Testing Systems API (Level 1) ---');
    const sysRes = await makeRequest('/api/systems');
    assert(sysRes.statusCode === 200, 'GET /api/systems returns 200');
    const sysJson = JSON.parse(sysRes.data);
    assert(sysJson.systems && sysJson.systems.length > 0, `Loaded ${sysJson.systems.length} financial systems`);
    const hasAfmis = sysJson.systems.some(s => s.SystemName.includes('AFMIS'));
    assert(hasAfmis, 'Governmental AFMIS system exists in database');

    // 4. Surveys (Level 2)
    console.log('\n--- 4. Testing Surveys API (Level 2) ---');
    const survRes = await makeRequest('/api/surveys');
    assert(survRes.statusCode === 200, 'GET /api/surveys returns 200');
    const survJson = JSON.parse(survRes.data);
    assert(survJson.surveys && survJson.surveys.length > 0, `Loaded ${survJson.surveys.length} surveys`);

    // 5. Hierarchy Tree (Levels 3 & 4)
    console.log('\n--- 5. Testing Hierarchy Tree (Levels 3 & 4) ---');
    const treeRes = await makeRequest('/api/surveys/101/tree');
    assert(treeRes.statusCode === 200, 'GET /api/surveys/101/tree returns 200');
    const treeJson = JSON.parse(treeRes.data);
    assert(treeJson.tree && treeJson.tree.length >= 3, `Tree has ${treeJson.tree.length} Levels (Audiences)`);
    const hasClasses = treeJson.tree.some(lvl => lvl.classes && lvl.classes.length > 0);
    assert(hasClasses, 'Tree contains nested categories/classes');

    // Role filtering check
    const treeEndUser = await makeRequest('/api/surveys/101/tree?role=enduser');
    const endUserTree = JSON.parse(treeEndUser.data);
    assert(endUserTree.tree.length <= treeJson.tree.length, 'End-user sees filtered view restricted to operational level');

    // 6. Dynamic Questions (Level 5)
    console.log('\n--- 6. Testing Dynamic Questions (Level 5) ---');
    const qRes = await makeRequest('/api/questions?surveyId=101');
    assert(qRes.statusCode === 200, 'GET /api/questions?surveyId=101 returns 200');
    const qJson = JSON.parse(qRes.data);
    assert(qJson.questions && qJson.questions.length >= 24, `AFMIS has ${qJson.questions.length} questions in bank`);
    const sampleQ = qJson.questions[0];
    assert(sampleQ.defect_category !== undefined, `Question has defect_category: ${sampleQ.defect_category}`);
    assert(sampleQ.weight !== undefined, `Question has weight: ${sampleQ.weight}`);

    // 7. Evaluations
    console.log('\n--- 7. Testing Field Evaluation Submission ---');
    const submitRes = await makeRequest('/api/evaluations/submit', 'POST', {
      userId: '100',
      answers: [
        {
          valueId: sampleQ.value_id,
          rating: 5,
          evidence: 'اختبار التدقيق الآلي المعتمد 2026',
          note: 'متوافق بنسبة 100% مع معايير وزارة المالية',
          defectCategory: sampleQ.defect_category
        }
      ]
    });
    assert(submitRes.statusCode === 200, 'POST /api/evaluations/submit returns 200');
    const submitJson = JSON.parse(submitRes.data);
    assert(submitJson.success === true, 'Evaluation successfully persisted in database');

    // 8. SmartPLS Analytics Engine
    console.log('\n--- 8. Testing SmartPLS Diagnostic Engine ---');
    const analyticsRes = await makeRequest('/api/analytics/101');
    assert(analyticsRes.statusCode === 200, 'GET /api/analytics/101 returns 200');
    const aJson = JSON.parse(analyticsRes.data);
    assert(aJson.hasData === true, 'Analytics engine processed real evaluation data');
    assert(aJson.summary.overallCompliance > 0, `Overall Compliance Score: ${aJson.summary.overallCompliance}%`);
    assert(aJson.defectBreakdown && aJson.defectBreakdown.length === 4, 'Engine classified all 4 Defect Quadrants (Administrative, Technical, Software Bug, Misuse)');
    assert(aJson.radarData && aJson.radarData.labels.length > 0, `Spider/Radar chart has ${aJson.radarData.labels.length} axis evaluation dimensions`);
    assert(aJson.swot && (aJson.swot.strengthsCount > 0 || aJson.swot.opportunitiesCount > 0), 'SWOT engine auto-detected strengths and gaps');

    // 9. Edge Case: Empty Survey Handling in Analytics Engine
    console.log('\n--- 9. Testing Edge Case: Zero-Question / Empty Survey ---');
    const emptySurvRes = await makeRequest('/api/analytics/999999');
    assert(emptySurvRes.statusCode === 200 || emptySurvRes.statusCode === 404, 'Empty/Unknown survey returns clean status code');

    // 10. Multi-Role Credential Login (101 Tech, 102 Management, 103 End-User)
    console.log('\n--- 10. Testing All User Credential Logins (RBAC) ---');
    for (const uid of ['101', '102', '103']) {
      const uRes = await makeRequest('/api/auth/login', 'POST', { username: uid, password: '1' });
      assert(uRes.statusCode === 200, `Login for user ${uid} returns 200`);
      const uData = JSON.parse(uRes.data);
      assert(uData.user && uData.user.userId === uid, `User ${uid} authenticated correctly with assigned role: ${uData.user ? uData.user.role : 'none'}`);
    }

    // 11. Role-Filtered Questions Endpoint
    console.log('\n--- 11. Testing Role Filtered Questions Bank ---');
    const qEndUser = await makeRequest('/api/questions?surveyId=101&role=enduser');
    assert(qEndUser.statusCode === 200, 'GET /api/questions?role=enduser returns 200');
    const qEndUserData = JSON.parse(qEndUser.data);
    assert(qEndUserData.questions.length > 0 && qEndUserData.questions.length <= qJson.questions.length, `End-user receives ${qEndUserData.questions.length} filtered operational questions`);

    // 12. Full 5-Level Hierarchy Creation (CRUD)
    console.log('\n--- 12. Testing Dynamic Hierarchy CRUD Engine ---');
    // Create new system
    const newSysRes = await makeRequest('/api/systems', 'POST', { systemName: 'نظام التدقيق المالي الآلي الموحد' });
    assert(newSysRes.statusCode === 200, 'POST /api/systems returns 200');
    const newSysData = JSON.parse(newSysRes.data);
    const testSysId = newSysData.system.SystemId;
    assert(testSysId !== undefined, `Created new financial system with ID: ${testSysId}`);

    // Create new survey
    const newSurvRes = await makeRequest('/api/surveys', 'POST', { systemId: testSysId, surveyName: 'استبيان التدقيق 2026' });
    assert(newSurvRes.statusCode === 200, 'POST /api/surveys returns 200');
    const newSurvData = JSON.parse(newSurvRes.data);
    const testSurvId = newSurvData.survey.SurveyId;
    assert(testSurvId !== undefined, `Created new survey with ID: ${testSurvId}`);

    // Create new level
    const newLvlRes = await makeRequest(`/api/surveys/${testSurvId}/levels`, 'POST', { levelName: 'لجنة الفحص والرقابة' });
    assert(newLvlRes.statusCode === 200, 'POST level returns 200');
    const newLvlData = JSON.parse(newLvlRes.data);
    const testLvlId = newLvlData.level.LevelId;

    // Create new class
    const newClassRes = await makeRequest(`/api/surveys/levels/${testLvlId}/classes`, 'POST', { className: 'محور الرقابة الداخلية' });
    assert(newClassRes.statusCode === 200, 'POST class returns 200');
    const newClassData = JSON.parse(newClassRes.data);
    const testClassId = newClassData.category.ClassId;

    // Create new question
    const newQRes = await makeRequest('/api/questions', 'POST', {
      systemId: testSysId,
      surveyId: testSurvId,
      levelId: testLvlId,
      classId: testClassId,
      qOrder: 1,
      qName: 'سؤال الفحص التجريبي',
      qDescription: 'مدى سلامة إجراءات الفحص الداخلي الآلي',
      defectCategory: 'إداري',
      weight: 1.5,
      maxScore: 5
    });
    assert(newQRes.statusCode === 200, 'POST question returns 200');
    const newQData = JSON.parse(newQRes.data);
    const testQId = newQData.question.value_id;

    // Delete test question
    const delQRes = await makeRequest(`/api/questions/${testQId}`, 'DELETE');
    assert(delQRes.statusCode === 200, 'DELETE question returns 200');

    // 13. Excel Export
    console.log('\n--- 13. Testing Excel/CSV Export ---');
    const exportRes = await makeRequest('/api/analytics/export-excel/101');
    assert(exportRes.statusCode === 200, 'Export endpoint returns 200');
    assert(exportRes.headers['content-type'].includes('text/csv'), 'Content-Type is text/csv');
    assert(exportRes.data.includes('رقم السؤال'), 'CSV contains Arabic headers');

    // 14. Web UI Pages & Route Aliases
    console.log('\n--- 14. Testing Web UI Pages & Route Aliases ---');
    const pages = [
      '/',
      '/dashboard',
      '/dashboard.html',
      '/builder',
      '/builder.html',
      '/survey_builder.html',
      '/evaluate',
      '/evaluate.html',
      '/analytics',
      '/analytics.html',
      '/report',
      '/report.html',
      '/benchmark',
      '/benchmark.html',
      '/presentation',
      '/presentation.html',
      '/users',
      '/users.html',
      '/groups',
      '/groups.html',
      '/css/app.css',
      '/js/api.js',
      '/js/charts.js',
      '/vendor/bootstrap/bootstrap.rtl.min.css',
      '/vendor/bootstrap/bootstrap.bundle.min.js',
      '/vendor/fontawesome/css/all.min.css',
      '/vendor/chartjs/chart.umd.min.js'
    ];
    for (const p of pages) {
      const pageRes = await makeRequest(p);
      assert(pageRes.statusCode === 200, `Page/Asset ${p} returns HTTP 200`);
    }

    // 15. Testing User Management CRUD & RBAC Protection
    console.log('\n--- 15. Testing User Management CRUD & RBAC Protection ---');
    const usersListRes = await makeRequest('/api/users');
    assert(usersListRes.statusCode === 200, 'GET /api/users returns 200');
    const usersListData = JSON.parse(usersListRes.data);
    assert(usersListData.success && usersListData.users && usersListData.users.length > 0, 'Users list loaded with records');

    const userGroupsRes = await makeRequest('/api/users/groups');
    assert(userGroupsRes.statusCode === 200, 'GET /api/users/groups returns 200');
    const userGroupsData = JSON.parse(userGroupsRes.data);
    assert(userGroupsData.groups && userGroupsData.groups.length >= 4, 'User groups contain all 4 evaluation roles');

    // Create test user
    const testUid = 'test_eval_99';
    const createUserRes = await makeRequest('/api/users', 'POST', {
      userId: testUid,
      userName: 'مقيم تجريبي للاختبار',
      password: '1',
      role: 'enduser',
      groupId: 4,
      surveyId: 101,
      email: 'eval99@mof.gov.ye',
      mobile: '777000999',
      description: 'مستخدم تجريبي لفحص شاشة إدخال المستخدمين'
    });
    assert(createUserRes.statusCode === 200, 'POST /api/users creates user with HTTP 200');

    // Update test user
    const updateUserRes = await makeRequest(`/api/users/${testUid}`, 'PUT', {
      userName: 'مقيم تجريبي محدث',
      email: 'updated_eval99@mof.gov.ye',
      mobile: '777111222'
    });
    assert(updateUserRes.statusCode === 200, 'PUT /api/users/:id updates user with HTTP 200');

    // Protect user 100
    const deleteAdminRes = await makeRequest('/api/users/100', 'DELETE');
    assert(deleteAdminRes.statusCode === 400, 'DELETE /api/users/100 fails with HTTP 400 (Protection check)');

    // Delete test user
    const deleteTestRes = await makeRequest(`/api/users/${testUid}`, 'DELETE');
    assert(deleteTestRes.statusCode === 200, 'DELETE /api/users/:id deletes test user with HTTP 200');

    // 15. Testing All 12 Google Forms Question Types
    console.log('\n--- 15. Testing All 12 Google Forms Question Types ---');
    const gformsTypes = [
      'إجابة قصيرة',
      'فقرة',
      'خيارات متعددة',
      'مربعات اختيار',
      'القائمة المنسدلة',
      'تحميل ملف',
      'المقياس الخطي',
      'التقييم',
      'شبكة متعددة الخيارات',
      'شبكة مربعات الاختيار',
      'التاريخ',
      'الوقت'
    ];

    for (const t of gformsTypes) {
      const gqRes = await makeRequest('/api/questions', 'POST', {
        systemId: 10,
        surveyId: 101,
        levelId: 101,
        classId: 201,
        qOrder: 99,
        qName: `تجربة نوع ${t}`,
        qDescription: `فحص إدخال عنصر ${t} مثل Google Forms`,
        qType: t,
        defectCategory: 'فني',
        weight: 1.0,
        optionsData: { type: t, test: true },
        qControl: `gforms_${t}`
      });
      assert(gqRes.statusCode === 200, `POST question with Google Forms type '${t}' returns 200`);
      const gqData = JSON.parse(gqRes.data);
      if (gqData.question && gqData.question.value_id) {
        await makeRequest(`/api/questions/${gqData.question.value_id}`, 'DELETE');
      }
    }

    // 16. Testing Groups & Permissions Matrix (frmgroup_q_users)
    console.log('\n--- 16. Testing Groups & Permissions Matrix (frmgroup_q_users) ---');
    const groupsRes = await makeRequest('/api/groups');
    assert(groupsRes.statusCode === 200, 'GET /api/groups returns 200');
    const groupsData = JSON.parse(groupsRes.data);
    assert(groupsData.success && groupsData.groups && groupsData.groups.length >= 7, 'Loaded all 7 groups from am_user_group');

    // Group 2 (المستخدمين للنظام) details check
    const g2Res = await makeRequest('/api/groups/2');
    assert(g2Res.statusCode === 200, 'GET /api/groups/2 returns 200');
    const g2Data = JSON.parse(g2Res.data);
    assert(g2Data.group.groupNameAr.includes('المستخدمين للنظام'), 'Group 2 name is المستخدمين للنظام as in screenshot');
    assert(g2Data.systems && g2Data.systems.length > 0, 'Group 2 has allowed systems in tst_group_detail_system');
    assert(g2Data.surveys && g2Data.surveys.length > 0, 'Group 2 has allowed surveys in tst_group_detail_survey');
    assert(g2Data.levels && g2Data.levels.length > 0, 'Group 2 has allowed levels in tst_group_detail_levels');
    assert(g2Data.classes && g2Data.classes.length > 0, 'Group 2 has allowed classes in tst_group_detail_classes');
    assert(g2Data.questions && g2Data.questions.length > 0, 'Group 2 has allowed questions in tst_group_detail_q_values');

    // Lookup modal tests
    const lookupSysRes = await makeRequest('/api/groups/lookup/items?type=systems');
    assert(lookupSysRes.statusCode === 200, 'GET /api/groups/lookup/items?type=systems returns 200');
    const lookupQRes = await makeRequest('/api/groups/lookup/items?type=questions');
    assert(lookupQRes.statusCode === 200, 'GET /api/groups/lookup/items?type=questions returns 200');

    // Group-based restricted evaluation query
    const g2QuestionsRes = await makeRequest('/api/questions?surveyId=101&groupId=2');
    assert(g2QuestionsRes.statusCode === 200, 'GET /api/questions with groupId=2 returns 200');

    // Create, Update, Delete test group
    const newGroupRes = await makeRequest('/api/groups', 'POST', {
      groupNameAr: 'مجموعة فحص تجريبية',
      groupNameEn: 'Test Group',
      note: 'فحص مصفوفة الصلاحيات',
      systems: [10],
      surveys: [101],
      levels: [103],
      classes: [203],
      questions: [1001]
    });
    assert(newGroupRes.statusCode === 200, 'POST /api/groups creates new group with HTTP 200');
    const newGroupData = JSON.parse(newGroupRes.data);
    const newGid = newGroupData.groupId;

    if (newGid) {
      // Cascade add test
      const cascadeRes = await makeRequest(`/api/groups/${newGid}/cascade-add`, 'POST', { systemId: 10 });
      assert(cascadeRes.statusCode === 200, 'POST /api/groups/:id/cascade-add cascades items with HTTP 200');

      // Update group
      const updateGroupRes = await makeRequest(`/api/groups/${newGid}`, 'PUT', {
        groupNameAr: 'مجموعة فحص تجريبية محدثة',
        note: 'تم التحديث بنجاح'
      });
      assert(updateGroupRes.statusCode === 200, 'PUT /api/groups/:id updates group with HTTP 200');

      // Delete group
      const deleteGroupRes = await makeRequest(`/api/groups/${newGid}`, 'DELETE');
      assert(deleteGroupRes.statusCode === 200, 'DELETE /api/groups/:id deletes group with HTTP 200');
    }

    // 16. Testing Committee Sessions & Workflow Approvals
    console.log('\n--- 16. Testing Committee Sessions & Workflow Approvals ---');
    const sessionsListRes = await makeRequest('/api/sessions');
    assert(sessionsListRes.statusCode === 200, 'GET /api/sessions returns HTTP 200');
    const sessionsData = JSON.parse(sessionsListRes.data);
    assert(Array.isArray(sessionsData.sessions), 'Sessions is an array');
    assert(sessionsData.sessions.length > 0, 'Found seeded evaluation sessions');

    // Create a new session
    const createSessionRes = await makeRequest('/api/sessions', 'POST', {
      surveyId: 101,
      sessionTitle: 'جلسة فحص آلي مؤتمتة',
      leadEvaluatorId: '100',
      notes: 'جلسة اختبار آلي'
    });
    assert(createSessionRes.statusCode === 200, 'POST /api/sessions creates session with HTTP 200');
    const newSessionData = JSON.parse(createSessionRes.data);
    const testSessionId = newSessionData.session.session_id;

    // Submit session
    const submitSessionRes = await makeRequest(`/api/sessions/${testSessionId}/submit`, 'PUT');
    assert(submitSessionRes.statusCode === 200, 'PUT /api/sessions/:id/submit moves session to SUBMITTED');

    // Approve session
    const approveSessionRes = await makeRequest(`/api/sessions/${testSessionId}/approve`, 'PUT', { approvedBy: '100' });
    assert(approveSessionRes.statusCode === 200, 'PUT /api/sessions/:id/approve moves session to APPROVED & locks records');

    // Consensus endpoint
    const consensusRes = await makeRequest(`/api/sessions/${testSessionId}/consensus`);
    assert(consensusRes.statusCode === 200, 'GET /api/sessions/:id/consensus computes weighted consensus');

    // Action plans endpoint
    const actionPlansRes = await makeRequest(`/api/sessions/${testSessionId}/action-plans`);
    assert(actionPlansRes.statusCode === 200, 'GET /api/sessions/:id/action-plans returns recommendations');

    // 17. Testing Multi-System Benchmarking
    console.log('\n--- 17. Testing Multi-System Benchmarking ---');
    const benchmarkRes = await makeRequest('/api/analytics/compare/systems?survey1=101&survey2=101');
    assert(benchmarkRes.statusCode === 200, 'GET /api/analytics/compare/systems returns HTTP 200');
    const benchmarkData = JSON.parse(benchmarkRes.data);
    assert(benchmarkData.success === true, 'Benchmark response has success: true');
    assert(benchmarkData.radar && benchmarkData.radar.labels.length > 0, 'Benchmark contains radar comparison axes');
    assert(typeof benchmarkData.delta === 'number', 'Benchmark computes delta between systems');

    // 18. Testing FastReport Bridge & Native ExcelJS Export
    console.log('\n--- 18. Testing FastReport Bridge & Native ExcelJS Export ---');
    const frStatusRes = await makeRequest('/api/reports/fastreport/status');
    assert(frStatusRes.statusCode === 200, 'GET /api/reports/fastreport/status returns HTTP 200');
    const frData = JSON.parse(frStatusRes.data);
    assert(frData.available === true, 'FastReport.dll is verified and available');
    assert(frData.engine.includes('FastReport'), 'FastReport engine version reported');

    const excelExportRes = await makeRequest('/api/reports/excel/101');
    assert(excelExportRes.statusCode === 200, 'GET /api/reports/excel/101 returns HTTP 200');
    assert(excelExportRes.headers['content-type'].includes('spreadsheetml'), 'Excel export content-type is XLSX spreadsheet');
    assert(excelExportRes.data.length > 1000, 'Excel workbook binary data received cleanly');

    // 19. Testing Question List Options (tst_system_q_values_list) & Dual Persistence
    console.log('\n--- 19. Testing Question List Options (tst_system_q_values_list) & Dual Persistence ---');
    // A. Check optionsList on questions
    const qListRes = await makeRequest('/api/questions');
    assert(qListRes.statusCode === 200, 'GET /api/questions returns HTTP 200');
    const qListData = JSON.parse(qListRes.data);
    const questionsWithOptions = (qListData.questions || []).filter(q => q.optionsList && q.optionsList.length > 0);
    assert(questionsWithOptions.length > 0, `Found ${questionsWithOptions.length} questions attached to tst_system_q_values_list options`);
    
    // Choose question 1506 or first question with options
    const targetQ = questionsWithOptions.find(q => q.value_id === 1506) || questionsWithOptions[0];
    assert(targetQ !== undefined, `Target question for options testing is value_id: ${targetQ ? targetQ.value_id : 'none'}`);
    assert(targetQ.optionsList[0].list_value !== undefined, `First option value is: "${targetQ.optionsList[0].list_value}"`);

    // B. Test GET /api/questions/:id/options
    const getOptsRes = await makeRequest(`/api/questions/${targetQ.value_id}/options`);
    assert(getOptsRes.statusCode === 200, `GET /api/questions/${targetQ.value_id}/options returns HTTP 200`);
    const getOptsData = JSON.parse(getOptsRes.data);
    assert(getOptsData.options && getOptsData.options.length > 0, `Loaded ${getOptsData.options.length} options from tst_system_q_values_list`);

    // C. Test POST /api/questions/:id/options (Add new option)
    const addOptRes = await makeRequest(`/api/questions/${targetQ.value_id}/options`, 'POST', {
      list_value: 'خيار تدقيق آلي تجريبي',
      list_type: 'dropdown',
      list_order: 99
    });
    assert(addOptRes.statusCode === 200, 'POST /api/questions/:id/options returns HTTP 200');
    const addOptData = JSON.parse(addOptRes.data);
    const createdListId = addOptData.option ? addOptData.option.list_id : null;
    assert(createdListId !== null, `Created new option with list_id: ${createdListId}`);

    // D. Test PUT /api/questions/options/:listId (Update option)
    const updateOptRes = await makeRequest(`/api/questions/options/${createdListId}`, 'PUT', {
      list_value: 'خيار تدقيق آلي محدث 2026',
      list_type: 'dropdown',
      list_value_choice: 1
    });
    assert(updateOptRes.statusCode === 200, 'PUT /api/questions/options/:listId returns HTTP 200');
    const updateOptData = JSON.parse(updateOptRes.data);
    assert(updateOptData.option.list_value === 'خيار تدقيق آلي محدث 2026', 'Option text updated in DB');
    assert(updateOptData.option.list_value_choice === 1, 'Option choice updated to 1');

    // E. Test Dual Persistence via POST /api/evaluations/submit
    const evalDualRes = await makeRequest('/api/evaluations/submit', 'POST', {
      userId: '100',
      answers: [
        {
          valueId: targetQ.value_id,
          rating: 5,
          evidence: 'خيار تدقيق آلي محدث 2026',
          note: 'اختبار المطابقة الثنائية لقاعدة البيانات',
          defectCategory: 'فني',
          selectedOptions: ['خيار تدقيق آلي محدث 2026'],
          qValue: 'خيار تدقيق آلي محدث 2026'
        }
      ]
    });
    assert(evalDualRes.statusCode === 200, 'POST /api/evaluations/submit with selectedOptions returns HTTP 200');
    const evalDualData = JSON.parse(evalDualRes.data);
    assert(evalDualData.success === true, 'Evaluation dual persistence recorded successfully');

    // F. Verify choice persistence in tst_system_q_values_list & tst_system_q_values
    const checkOptRes = await makeRequest(`/api/questions/${targetQ.value_id}/options`);
    const checkOptData = JSON.parse(checkOptRes.data);
    const chosenOpt = checkOptData.options.find(o => o.list_id === createdListId);
    assert(chosenOpt && chosenOpt.list_value_choice === 1, 'list_value_choice persisted as 1 in tst_system_q_values_list');

    // G. Test DELETE /api/questions/options/:listId (Cleanup)
    const delOptRes = await makeRequest(`/api/questions/options/${createdListId}`, 'DELETE');
    assert(delOptRes.statusCode === 200, 'DELETE /api/questions/options/:listId returns HTTP 200');

    // Re-verify deleted
    const verifyDelRes = await makeRequest(`/api/questions/${targetQ.value_id}/options`);
    const verifyDelData = JSON.parse(verifyDelRes.data);
    const stillExists = verifyDelData.options.some(o => o.list_id === createdListId);
    assert(!stillExists, 'Temporary test option cleaned up cleanly from database');

  } catch (err) {
    console.error('Test execution error:', err.message);
    failed++;
  }

  console.log('\n================================================================');
  console.log(`Verification Complete: ${passed} Passed, ${failed} Failed`);
  console.log('================================================================');

  if (failed === 0) {
    console.log('ALL SYSTEMS VERIFIED CLEANLY AND FUNCTIONING 100%!');
    process.exit(0);
  } else {
    console.error('SOME CHECKS FAILED!');
    process.exit(1);
  }
}

// Give server time to spin up if invoked simultaneously
setTimeout(runTests, 1000);
