// GHG İşə Qəbul — Google Apps Script v13 (FINAL)
// Deploy: New deployment → Web app → Execute as: Me → Access: Anyone

const SHEETS = {
  users:    'Istifadeciler',
  requests: 'Teleb_Formalari',
  evals:    'Deyerlendirmeler',
  chains:   'Tesdiq_Zencirleri',
  logs:     'Sistem_Loglari',
  logins:   'Girisler'
};

const HEADERS = {
  users:    ['ID','AdSoyad','Login','Sifre','Rol','Vezife','Email','BU','Sobe','Struct','Yaradildi'],
  requests: ['ID','ReqID','Vezife','Dept','Derece','Maas','BaslamaTarixi','Sebeb','JobDesc',
             'Ingilis','Rus','Azeri','DigerDil','Word','Excel','Outlook',
             'ZencirID','YaradanAd','YaradanID','Yaradildi','Status',
             'ReddEden','ReddSebeb','T1Ad','T1Tarix','T2Ad','T2Tarix','T3Ad','T3Tarix','NamizadSayi'],
  evals:    ['ID','TelebID','Namizad','Tarix','Musahibeci','MuracietVez',
             'R1','R2','R3','R4','R5','R6','R7','R8',
             'Maas','AvailDate','RecTovsiye','RecQerar','RecQeyd','RecTarix',
             'LM_ID','LM1','LM2','LM3','LM4','LM5','LM6','LM7','LM8',
             'LM_Maas','LM_Tovsiye','LM_Qerar','LM_Qeyd','LM_Tarix',
             'RecTesdiq','LMTesdiq','CEOTehkim','CEOTesdiq',
             'IseQebul','IseQebulTarix','IseQebulEden','YaradanAd','Yaradildi'],
  chains:   ['ID','Ad','T1_ID','T2_ID','T3_ID'],
  logs:     ['ID','Hadise','Tip','Tarix'],
  logins:   ['Tarix','Ad','Login','Rol','IP','Cihaz','Brauzer','Ekran','Dil','TZ']
};

const ROLE    = {admin:'Admin', recruiter:'Recruiter', user:'User', bv:'BV_Rehberi'};
const ROLE_R  = {Admin:'admin', Recruiter:'recruiter', User:'user', BV_Rehberi:'bv'};
const ST      = {pending_approval:'Tesdiqde', inprog:'Prosesde', approved:'Tesdiq', rejected:'Redd', hired:'IseQebul'};
const ST_R    = {Tesdiqde:'pending_approval', Prosesde:'inprog', Tesdiq:'approved', Redd:'rejected', IseQebul:'hired'};
const LVL     = {1:'B', 2:'O', 3:'E'};
const LVL_R   = {B:1, O:2, E:3};
const RAT     = {excellent:'Ela', good:'Yaxsi', average:'Orta', poor:'Zeyif'};
const RAT_R   = {Ela:'excellent', Yaxsi:'good', Orta:'average', Zeyif:'poor'};

// ═══════════════════════════════════════════════════════════════════
// MAIN HANDLERS
// ═══════════════════════════════════════════════════════════════════

function doGet(e) {
  return handleRequest(e);
}

function doPost(e) {
  return handleRequest(e);
}

function handleRequest(e) {
  var params = e.parameter;
  var postData = null;

  // POST data parsing — body is sent as text/plain containing JSON
  if (e.postData && e.postData.contents) {
    try {
      postData = JSON.parse(e.postData.contents);
    } catch(err) {
      // Fall back to form-encoded parameters
    }
  }

  var action   = postData ? postData.action   : params.action;
  var table    = postData ? postData.table    : params.table;
  var data     = postData ? postData.data     : (params.data ? JSON.parse(params.data) : {});
  var callback = postData ? postData.callback : params.callback;

  Logger.log('Action: ' + action + ' | Table: ' + table);

  var result;
  try {
    result = route(action, table, data);
  } catch(err) {
    result = {ok: false, error: err.toString()};
  }

  var jsonOutput = JSON.stringify(result);

  if (callback && /^[a-zA-Z0-9_]+$/.test(callback)) {
    return ContentService
      .createTextOutput(callback + '(' + jsonOutput + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return ContentService
    .createTextOutput(jsonOutput)
    .setMimeType(ContentService.MimeType.JSON);
}

function route(action, table, data) {
  if (action === 'ping') {
    initSheets();
    return {ok: true, msg: 'GHG v13 aktiv', time: new Date().toISOString()};
  }

  if (action === 'getAll') {
    initSheets();
    var reqs = readRequests();
    var maxReqId = reqs.reduce(function(m, r) { return Math.max(m, r.reqId || 0); }, 1000);
    return {
      ok:        true,
      users:     readUsers(),
      requests:  reqs,
      evals:     readEvals(),
      chains:    readChains(),
      logs:      readLogs(),
      nextReqId: maxReqId + 1
    };
  }

  if (action === 'addRow') {
    return addRow(table, data);
  }

  if (action === 'updateRow') {
    return updateRow(table, data.id, data);
  }

  if (action === 'deleteRow') {
    return deleteRow(table, data.id || data);
  }

  if (action === 'write') {
    return writeAll(table, data);
  }

  if (action === 'logLogin') {
    return addLoginLog(data);
  }

  return {ok: false, msg: 'Unknown action: ' + action};
}

// ═══════════════════════════════════════════════════════════════════
// SHEET OPERATIONS
// ═══════════════════════════════════════════════════════════════════

function initSheets() {
  for (var key in SHEETS) {
    getOrCreateSheet(key);
  }
}

function getOrCreateSheet(key) {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var name  = SHEETS[key];
  var sheet = ss.getSheetByName(name);

  if (!sheet) {
    sheet = ss.insertSheet(name);
    var headers = HEADERS[key];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length)
      .setBackground('#7c6dfa')
      .setFontColor('#ffffff')
      .setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function findRowById(sheet, id) {
  var lr = sheet.getLastRow();
  if (lr < 2) return -1;

  var ids = sheet.getRange(2, 1, lr - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (ids[i][0].toString() === id.toString()) {
      return i + 2; // 1-based row number
    }
  }
  return -1;
}

function addRow(table, item) {
  if (!item || !item.id) return {ok: false, msg: 'No ID'};

  var sheet       = getOrCreateSheet(table);
  var existingRow = findRowById(sheet, item.id);
  var rowData     = toRow(table, item);

  if (existingRow > 0) {
    sheet.getRange(existingRow, 1, 1, rowData.length).setValues([rowData]);
    return {ok: true, updated: true, id: item.id};
  }

  sheet.appendRow(rowData);
  return {ok: true, added: true, id: item.id};
}

function updateRow(table, id, item) {
  if (!id) return {ok: false, msg: 'No ID'};

  var sheet       = getOrCreateSheet(table);
  var existingRow = findRowById(sheet, id);
  var rowData     = toRow(table, item);

  if (existingRow > 0) {
    sheet.getRange(existingRow, 1, 1, rowData.length).setValues([rowData]);
    return {ok: true, updated: true, id: id};
  }

  // Not found — append as new row
  sheet.appendRow(rowData);
  return {ok: true, added: true, id: id};
}

function deleteRow(table, id) {
  if (!id) return {ok: false, msg: 'No ID'};

  var sheet = getOrCreateSheet(table);
  var row   = findRowById(sheet, id);

  if (row > 0) {
    sheet.deleteRow(row);
    return {ok: true, deleted: true, id: id};
  }

  return {ok: false, msg: 'Not found'};
}

function writeAll(table, items) {
  if (!Array.isArray(items)) return {ok: false, msg: 'Not an array'};

  var sheet = getOrCreateSheet(table);
  var lr    = sheet.getLastRow();

  // Clear existing data rows (keep header)
  if (lr > 1) {
    sheet.getRange(2, 1, lr - 1, sheet.getLastColumn()).clearContent();
  }

  if (items.length === 0) return {ok: true, count: 0};

  // Filter valid items; never write admin users
  var validItems = items.filter(function(x) {
    return x && x.id && (table !== 'users' || x.role !== 'admin');
  });

  if (validItems.length === 0) return {ok: true, count: 0};

  var rows = validItems.map(function(x) { return toRow(table, x); });

  sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  return {ok: true, count: rows.length};
}

// ═══════════════════════════════════════════════════════════════════
// READ FUNCTIONS
// ═══════════════════════════════════════════════════════════════════

function readSheet(key) {
  var sheet = getOrCreateSheet(key);
  var lr    = sheet.getLastRow();
  if (lr < 2) return [];
  return sheet.getRange(2, 1, lr - 1, HEADERS[key].length).getValues();
}

function readUsers() {
  return readSheet('users').filter(function(r) { return r[0]; }).map(function(r) {
    return {
      id: r[0], name: r[1], login: r[2], pass: r[3],
      role: ROLE_R[r[4]] || 'user', position: r[5], email: r[6],
      bu: r[7], department: r[8], struct: r[9], createdAt: r[10] || ''
    };
  });
}

function readRequests() {
  return readSheet('requests').filter(function(r) { return r[0]; }).map(function(r) {
    var appr = [];
    if (r[23]) appr.push({name: r[23], time: r[24], action: 'approved'});
    if (r[25]) appr.push({name: r[25], time: r[26], action: 'approved'});
    if (r[27]) appr.push({name: r[27], time: r[28], action: 'approved'});

    return {
      id: r[0], reqId: parseInt(r[1]) || 0, positionTitle: r[2],
      department: r[3], grade: r[4], salary: r[5], startDate: r[6],
      reason: r[7], jobDesc: r[8],
      langs: [LVL_R[r[9]] || null, LVL_R[r[10]] || null, LVL_R[r[11]] || null],
      langOther: r[12] || '',
      comp:  [LVL_R[r[13]] || null, LVL_R[r[14]] || null, LVL_R[r[15]] || null],
      chainCatId:    r[16] || null,
      createdByName: r[17], createdById: r[18], createdAt: r[19],
      status:        ST_R[r[20]] || 'inprog',
      rejectedBy:    r[21] || '', rejectReason: r[22] || '',
      approvals:     appr,
      candidates:    r[29] ? r[29].toString().split(',').filter(Boolean) : []
    };
  });
}

function readEvals() {
  return readSheet('evals').filter(function(r) { return r[0]; }).map(function(r) {
    function rt(v) { return RAT_R[v] || null; }
    return {
      id: r[0], requestId: r[1], candidateName: r[2], interviewDate: r[3],
      interviewerName: r[4], applyPosition: r[5],
      ratings: [rt(r[6]), rt(r[7]), rt(r[8]), rt(r[9]), rt(r[10]), rt(r[11]), rt(r[12]), rt(r[13])],
      salaryExp: r[14], availDate: r[15], recs: r[16],
      recommendation: r[17] || null, additionalComments: r[18],
      recruiterFilledAt: r[19], lineManagerId: r[20] || null,
      lmRatings: [rt(r[21]), rt(r[22]), rt(r[23]), rt(r[24]), rt(r[25]), rt(r[26]), rt(r[27]), rt(r[28])],
      lmSalaryExp: r[29], lmRecs: r[30], lmRecommendation: r[31] || null,
      lmAdditionalComments: r[32], lmFilledAt: r[33], lmFormFilled: !!r[33],
      recruiterApproved: r[34] === 'Beli', recruiterApprovedAt: r[34] || '',
      lineManagerApproved: r[35] === 'Beli', lineManagerApprovedAt: r[35] || '',
      ceoAssigned: r[36] || null, ceoApproved: r[37] === 'Beli',
      hired: r[38] === 'Beli', hiredAt: r[39] || '', hiredBy: r[40] || '',
      createdByName: r[41], createdAt: r[42]
    };
  });
}

function readChains() {
  return readSheet('chains').filter(function(r) { return r[0]; }).map(function(r) {
    var steps = [];
    if (r[2]) steps.push({order: 1, uid: r[2]});
    if (r[3]) steps.push({order: 2, uid: r[3]});
    if (r[4]) steps.push({order: 3, uid: r[4]});
    return {id: r[0], name: r[1], steps: steps};
  });
}

function readLogs() {
  return readSheet('logs').map(function(r) {
    return {id: r[0], txt: r[1], type: r[2], ts: r[3]};
  }).slice(0, 200);
}

// ═══════════════════════════════════════════════════════════════════
// CONVERTERS
// ═══════════════════════════════════════════════════════════════════

function toRow(table, x) {
  if (table === 'users')    return toUserRow(x);
  if (table === 'requests') return toRequestRow(x);
  if (table === 'evals')    return toEvalRow(x);
  if (table === 'chains')   return toChainRow(x);
  if (table === 'logs')     return [x.id || '', x.txt || '', x.type || 'B', x.ts || ''];
  return [];
}

function toUserRow(u) {
  return [u.id, u.name, u.login, u.pass, ROLE[u.role] || u.role,
          u.position || '', u.email || '', u.bu || '', u.department || '',
          u.struct || '', u.createdAt || ''];
}

function toRequestRow(r) {
  function lv(v) { return LVL[v] || ''; }
  var a = r.approvals || [];
  return [
    r.id, r.reqId, r.positionTitle, r.department || '', r.grade || '',
    r.salary || '', r.startDate || '', (r.reason || '').substring(0, 500),
    (r.jobDesc || '').substring(0, 1000),
    lv(r.langs ? r.langs[0] : null), lv(r.langs ? r.langs[1] : null),
    lv(r.langs ? r.langs[2] : null), r.langOther || '',
    lv(r.comp ? r.comp[0] : null), lv(r.comp ? r.comp[1] : null),
    lv(r.comp ? r.comp[2] : null), r.chainCatId || '',
    r.createdByName || '', r.createdById || '', r.createdAt || '',
    ST[r.status] || r.status || '', r.rejectedBy || '',
    (r.rejectReason || '').substring(0, 300),
    a[0] ? a[0].name : '', a[0] ? a[0].time : '',
    a[1] ? a[1].name : '', a[1] ? a[1].time : '',
    a[2] ? a[2].name : '', a[2] ? a[2].time : '',
    (r.candidates || []).join(',')
  ];
}

function toEvalRow(e) {
  function rt(v) { return RAT[v] || ''; }
  function bl(v) { return v ? 'Beli' : 'Xeyr'; }
  var r = e.ratings || [], lm = e.lmRatings || [];
  return [
    e.id, e.requestId, e.candidateName, e.interviewDate,
    e.interviewerName || '', e.applyPosition || '',
    rt(r[0]), rt(r[1]), rt(r[2]), rt(r[3]), rt(r[4]), rt(r[5]), rt(r[6]), rt(r[7]),
    e.salaryExp || '', e.availDate || '', (e.recs || '').substring(0, 300),
    e.recommendation || '', (e.additionalComments || '').substring(0, 300),
    e.recruiterFilledAt || e.createdAt || '', e.lineManagerId || '',
    rt(lm[0]), rt(lm[1]), rt(lm[2]), rt(lm[3]), rt(lm[4]), rt(lm[5]), rt(lm[6]), rt(lm[7]),
    e.lmSalaryExp || '', (e.lmRecs || '').substring(0, 300),
    e.lmRecommendation || '', (e.lmAdditionalComments || '').substring(0, 300),
    e.lmFilledAt || '', bl(e.recruiterApproved), bl(e.lineManagerApproved),
    e.ceoAssigned || '', bl(e.ceoApproved), bl(e.hired), e.hiredAt || '',
    e.hiredBy || '', e.createdByName || '', e.createdAt || ''
  ];
}

function toChainRow(c) {
  var s = c.steps || [];
  function sid(o) {
    for (var i = 0; i < s.length; i++) {
      if (s[i].order === o) return s[i].uid;
    }
    return '';
  }
  return [c.id, c.name, sid(1), sid(2), sid(3)];
}

// ═══════════════════════════════════════════════════════════════════
// LOGIN LOG
// ═══════════════════════════════════════════════════════════════════

function addLoginLog(d) {
  var sheet = getOrCreateSheet('logins');
  var row = [
    d.time || '', d.name || '', d.login || '', d.role || '',
    d.ip || '-', d.device || '-', d.browser || '-',
    d.screen || '-', d.lang || '-', d.tz || '-'
  ];
  sheet.insertRowBefore(2);
  sheet.getRange(2, 1, 1, row.length).setValues([row]);
  return {ok: true};
}

// ═══════════════════════════════════════════════════════════════════
// TEST
// ═══════════════════════════════════════════════════════════════════

function test() {
  Logger.log('=== TEST ===');
  initSheets();

  var testUser = {
    id:         'test_' + Date.now(),
    name:       'Test User',
    login:      'test',
    pass:       '1234',
    role:       'user',
    position:   'Test',
    email:      'test@test.com',
    bu:         'Test BU',
    department: 'Test Dept',
    struct:     ''
  };

  var r1 = addRow('users', testUser);
  Logger.log('Add: ' + JSON.stringify(r1));

  var users = readUsers();
  Logger.log('Read: ' + users.length + ' users');

  deleteRow('users', testUser.id);
  Logger.log('Deleted');

  return 'Test complete - check logs';
}
