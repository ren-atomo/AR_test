/**
 * シェアスケジュール - Google Apps Script バックエンド
 *
 * 【通信方式】
 * - ロード: JSONP (callback パラメータ付き GET)
 * - 保存: no-cors fetch POST
 *
 * 【シート構成】
 * users / events / classes / assignments / dates / goals / future / buckets / settings
 */

const SPREADSHEET_ID = '1MuC1vGyhhJo2j0IJVLXqSsIeoypnptRAtiovGNiOt1E';
const LOCK_TIMEOUT = 10000;

// ========== GET ハンドラ（JSONP対応）==========

function doGet(e) {
  const action = (e.parameter && e.parameter.action) || 'load';
  const callback = e.parameter && e.parameter.callback;
  let result;
  try {
    if (action === 'load') result = loadData();
    else if (action === 'ping') result = { ok: true, message: 'pong', time: new Date().toISOString() };
    else result = { ok: false, error: 'Unknown action: ' + action };
  } catch (err) {
    result = { ok: false, error: err.toString() };
  }
  const json = JSON.stringify(result);
  if (callback) {
    return ContentService.createTextOutput(callback + '(' + json + ')').setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

// ========== POST ハンドラ ==========

function doPost(e) {
  try {
    let stateData;
    if (e.parameter && e.parameter.data) {
      stateData = JSON.parse(e.parameter.data);
    } else if (e.postData && e.postData.contents) {
      const body = JSON.parse(e.postData.contents);
      stateData = body.state || body;
    }
    const result = saveData(stateData);
    return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: err.toString() })).setMimeType(ContentService.MimeType.JSON);
  }
}

// ========== ロード ==========

function loadData() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const state = {};

  // users
  state.users = { A: { name: '', avatar: '🌸', univ: '', memo: '' }, B: { name: '', avatar: '🌟', univ: '', memo: '' } };
  const usersSheet = ss.getSheetByName('users');
  if (usersSheet && usersSheet.getLastRow() > 1) {
    readRows(usersSheet, ['key', 'name', 'avatar', 'univ', 'memo']).forEach(row => {
      if (row.key) state.users[row.key] = { name: row.name, avatar: row.avatar, univ: row.univ, memo: row.memo };
    });
  }

  // 配列データ
  state.events      = readSheet(ss, 'events',      ['id', 'title', 'date', 'time', 'userId', 'type', 'note']);
  state.classes     = readSheet(ss, 'classes',     ['id', 'userId', 'day', 'period', 'name', 'room', 'color', 'teacher', 'note']);
  state.assignments = readSheet(ss, 'assignments', ['id', 'classId', 'title', 'dueDate', 'dueTime', 'userId', 'done', 'priority', 'note']);
  state.dates       = readSheet(ss, 'dates',       ['id', 'title', 'date', 'time', 'place', 'note', 'done', 'mood']);
  state.goals       = readSheet(ss, 'goals',       ['id', 'userId', 'title', 'done', 'deadline', 'note']);
  state.future      = readSheet(ss, 'future',      ['id', 'userId', 'title', 'category', 'done', 'note']);
  state.buckets     = readSheet(ss, 'buckets',     ['id', 'userId', 'title', 'done', 'note']);

  // boolean 変換
  ['assignments', 'dates', 'goals', 'future', 'buckets'].forEach(key => {
    state[key].forEach(item => { item.done = item.done === true || item.done === 'TRUE' || item.done === 'true'; });
  });

  // settings
  const defaults = {
    anniversary: null, activeUser: 'A',
    calYear: new Date().getFullYear(), calMonth: new Date().getMonth(),
    ttUser: 'A', hwFilter: 'all', hwUserFilter: null, dateFilter: 'all', editingId: null
  };
  Object.assign(state, defaults);
  const settingsSheet = ss.getSheetByName('settings');
  if (settingsSheet && settingsSheet.getLastRow() > 1) {
    readRows(settingsSheet, ['key', 'value']).forEach(({ key, value }) => {
      if (!key) return;
      if (value === 'null')        state[key] = null;
      else if (value === 'true')   state[key] = true;
      else if (value === 'false')  state[key] = false;
      else if (value !== '' && !isNaN(value)) state[key] = Number(value);
      else state[key] = value;
    });
  }

  return { ok: true, state };
}

// ========== セーブ ==========

function saveData(state) {
  if (!state) return { ok: false, error: 'データがありません' };
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(LOCK_TIMEOUT);
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

    // users
    writeSheet(ss, 'users', ['key', 'name', 'avatar', 'univ', 'memo'],
      Object.entries(state.users || {}).map(([k, u]) => [k, u.name, u.avatar, u.univ, u.memo]));

    // 配列データ
    writeSheet(ss, 'events', ['id', 'title', 'date', 'time', 'userId', 'type', 'note'],
      (state.events || []).map(e => [e.id, e.title, e.date, e.time, e.userId, e.type, e.note]));

    writeSheet(ss, 'classes', ['id', 'userId', 'day', 'period', 'name', 'room', 'color', 'teacher', 'note'],
      (state.classes || []).map(c => [c.id, c.userId, c.day, c.period, c.name, c.room, c.color, c.teacher, c.note]));

    writeSheet(ss, 'assignments', ['id', 'classId', 'title', 'dueDate', 'dueTime', 'userId', 'done', 'priority', 'note'],
      (state.assignments || []).map(a => [a.id, a.classId, a.title, a.dueDate, a.dueTime, a.userId, a.done, a.priority, a.note]));

    writeSheet(ss, 'dates', ['id', 'title', 'date', 'time', 'place', 'note', 'done', 'mood'],
      (state.dates || []).map(d => [d.id, d.title, d.date, d.time, d.place, d.note, d.done, d.mood]));

    writeSheet(ss, 'goals', ['id', 'userId', 'title', 'done', 'deadline', 'note'],
      (state.goals || []).map(g => [g.id, g.userId, g.title, g.done, g.deadline, g.note]));

    writeSheet(ss, 'future', ['id', 'userId', 'title', 'category', 'done', 'note'],
      (state.future || []).map(f => [f.id, f.userId, f.title, f.category, f.done, f.note]));

    writeSheet(ss, 'buckets', ['id', 'userId', 'title', 'done', 'note'],
      (state.buckets || []).map(b => [b.id, b.userId, b.title, b.done, b.note]));

    // settings
    const settingsKeys = ['anniversary', 'activeUser', 'calYear', 'calMonth', 'ttUser', 'hwFilter', 'hwUserFilter', 'dateFilter'];
    writeSheet(ss, 'settings', ['key', 'value'],
      settingsKeys.map(k => [k, state[k] === null || state[k] === undefined ? 'null' : String(state[k])]));

    SpreadsheetApp.flush();
    return { ok: true, savedAt: new Date().toISOString() };
  } catch (err) {
    return { ok: false, error: '保存に失敗しました: ' + err.toString() };
  } finally {
    lock.releaseLock();
  }
}

// ========== ヘルパー ==========

function readSheet(ss, sheetName, columns) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() <= 1) return [];
  return readRows(sheet, columns).filter(row => row[columns[0]] !== '' && row[columns[0]] !== null);
}

function readRows(sheet, columns) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];
  const values = sheet.getRange(2, 1, lastRow - 1, columns.length).getValues();
  return values.map(row => {
    const obj = {};
    columns.forEach((col, i) => { obj[col] = row[i] === '' ? null : row[i]; });
    return obj;
  });
}

function writeSheet(ss, sheetName, headers, rows) {
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) sheet = ss.insertSheet(sheetName);
  sheet.clearContents();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }
}

// ========== 旧データ移行（1回だけ実行）==========

function migrate() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const oldSheet = ss.getSheetByName('data');
  if (!oldSheet) { Logger.log('data シートが見つかりません'); return; }
  const raw = oldSheet.getRange('B1').getValue();
  if (!raw) { Logger.log('移行するデータがありません'); return; }
  const state = JSON.parse(raw);
  const result = saveData(state);
  Logger.log('移行完了: ' + JSON.stringify(result));
}

// ========== デバッグ用 ==========

function testLoad() { Logger.log(JSON.stringify(loadData())); }
function testSave() { Logger.log(JSON.stringify(saveData({ users: { A: { name: 'test', avatar: '🔵', univ: '', memo: '' }, B: { name: 'test', avatar: '🟢', univ: '', memo: '' } }, events: [], classes: [], assignments: [], dates: [], goals: [], future: [], buckets: [] }))); }
